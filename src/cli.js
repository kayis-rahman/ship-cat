import { pathToFileURL } from "node:url";
import { createLedgerReader } from "./ledger-reader.js";
import { createLedgerReducer } from "./ledger-reducer.js";
import { createPetMapper } from "./pet-mapper.js";
import { createPetSink } from "./pet-sink.js";
import { generateLaunchAgentPlist, resolveLaunchAgentOutput, writeLaunchAgentPlist } from "./launch-agent.js";

const HELP = `Usage:
  shipcat once --ledger PATH --home NAME --agent-id ID (--endpoint URL | --runtime-json PATH)
  shipcat watch --ledger PATH --home NAME --agent-id ID (--endpoint URL | --runtime-json PATH) [--interval-ms N]
  shipcat status --ledger PATH --home NAME
  shipcat service plist|install --ledger PATH --home NAME --agent-id ID (--endpoint URL | --runtime-json PATH) [--output PATH]
  shipcat service uninstall --output PATH

Commands:
  once    Read currently available ledger records and send current task states.
  watch   Poll the read-only ledger and update task states without waiting on retries.
  status  Print text-free aggregate state counts; does not contact the pet endpoint.
  service Generate or inspect a user LaunchAgent plist; never calls launchctl.
`;

export async function runCli(argv, { stdout = process.stdout, stderr = process.stderr, signalHandlers = process, cwd = process.cwd() } = {}) {
  const [command, ...args] = argv;
  if (command === "--help" || command === "-h" || command === "help") {
    stdout.write(HELP);
    return 0;
  }
  if (command === "service") return runServiceCommand(args, { stdout, stderr, cwd });
  if (!["once", "watch", "status"].includes(command)) {
    stderr.write(`${HELP}\nUnknown command.\n`);
    return 2;
  }
  const options = parseOptions(args);
  if (options.error) {
    stderr.write(`${options.error}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(HELP);
    return 0;
  }
  const required = ["ledger", "home"];
  if (command !== "status") required.push("agent-id");
  const missing = required.filter((name) => !options.values[name]);
  if (missing.length) {
    stderr.write(`Missing required option(s): ${missing.map((name) => `--${name}`).join(", ")}\n`);
    return 2;
  }
  const intervalMs = Number(options.values["interval-ms"] ?? 1000);
  if (command === "watch" && (!Number.isSafeInteger(intervalMs) || intervalMs < 10)) {
    stderr.write("--interval-ms must be an integer of at least 10\n");
    return 2;
  }
  if (command !== "status" && !options.values.endpoint && !options.values["runtime-json"]) {
    stderr.write("Specify --endpoint or --runtime-json\n");
    return 2;
  }

  try {
    const reader = createLedgerReader([{ path: options.values.ledger, home: options.values.home }]);
    const reducer = createLedgerReducer();
    const mapper = createPetMapper({ logger: { debug() {} } });
    const applyAvailable = async () => {
      for (const envelope of await reader.read()) reducer.apply(envelope);
      return reducer.snapshot();
    };

    if (command === "status") {
      const tasks = await applyAvailable();
      const summary = {
        home: options.values.home,
        tasks: tasks.length,
        dispatched: tasks.filter((task) => task.dispatched).length,
        provisional: tasks.filter((task) => task.provisional).length,
        alerts: tasks.filter((task) => ["needs-decision", "blocked"].includes(task.status)).length,
      };
      stdout.write(`${JSON.stringify(summary)}\n`);
      return 0;
    }

    const sink = createPetSink({
      agentId: options.values["agent-id"],
      endpoint: options.values.endpoint,
      runtimeJsonPath: options.values["runtime-json"],
    });
    if (command === "once") {
      try {
        sink.update(mapper.mapSnapshot(await applyAvailable()));
        await sink.flush();
        return 0;
      } finally {
        await sink.stop();
      }
    }

    let stopping = false;
    let wakeDelay;
    const stop = () => { stopping = true; wakeDelay?.(); };
    signalHandlers.once("SIGINT", stop);
    signalHandlers.once("SIGTERM", stop);
    try {
      while (!stopping) {
        sink.update(mapper.mapSnapshot(await applyAvailable()));
        if (stopping) break;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, intervalMs);
          wakeDelay = () => { clearTimeout(timer); resolve(); };
        });
        wakeDelay = undefined;
      }
      await sink.flush();
      return 0;
    } finally {
      signalHandlers.removeListener("SIGINT", stop);
      signalHandlers.removeListener("SIGTERM", stop);
      await sink.stop();
    }
  } catch (error) {
    stderr.write(`shipcat: ${error.message}\n`);
    return 1;
  }
}

async function runServiceCommand(args, { stdout, stderr, cwd }) {
  const [operation, ...optionArgs] = args;
  if (!["plist", "install", "uninstall"].includes(operation)) {
    stderr.write("Usage: shipcat service plist|install|uninstall [options]\\n");
    return 2;
  }
  const parsed = parseOptions(optionArgs);
  if (parsed.error) {
    stderr.write(`${parsed.error}\\n`);
    return 2;
  }
  const values = parsed.values;
  try {
    if (operation === "uninstall") {
      if (!values.output) throw new TypeError("--output is required for service uninstall");
      const target = resolveLaunchAgentOutput(values.output, { cwd });
      stdout.write(`Generated plist: ${target}\\nRemove that file manually if desired. No launchctl command was run.\\n`);
      return 0;
    }
    const options = {
      ledger: values.ledger, home: values.home, agentId: values["agent-id"],
      endpoint: values.endpoint, runtimeJsonPath: values["runtime-json"], label: values.label,
    };
    if (operation === "install" && !values.output) throw new TypeError("--output is required for service install");
    if (values.output) {
      const target = await writeLaunchAgentPlist(values.output, options, { cwd });
      stdout.write(`LaunchAgent plist written to ${target}. It was not loaded.\\n`);
    } else {
      stdout.write(generateLaunchAgentPlist(options));
    }
    return 0;
  } catch (error) {
    stderr.write(`shipcat service: ${error.message}\\n`);
    return 1;
  }
}

function parseOptions(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { values, help: true };
    if (!argument.startsWith("--")) return { values, error: `Unexpected argument: ${argument}` };
    const key = argument.slice(2);
    if (!["ledger", "home", "agent-id", "endpoint", "runtime-json", "interval-ms", "output", "label"].includes(key)) {
      return { values, error: `Unknown option: ${argument}` };
    }
    if (values[key] !== undefined) return { values, error: `Duplicate option: ${argument}` };
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) return { values, error: `Expected a value after ${argument}` };
    values[key] = value;
  }
  return { values };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
