import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("./cli.js", import.meta.url));

export function generateLaunchAgentPlist({
  ledger,
  home,
  agentId,
  endpoint,
  runtimeJsonPath,
  label = "local.shipcat.bridge",
  nudges = false,
  nudgeIntervalMs = 300_000,
  nodePath = process.execPath,
} = {}) {
  if (!ledger || !home || !agentId || Boolean(endpoint) === Boolean(runtimeJsonPath)) {
    throw new TypeError("ledger, home, agentId, and exactly one of endpoint or runtimeJsonPath are required");
  }
  if (typeof nudges !== "boolean" || (nudges && (!Number.isSafeInteger(nudgeIntervalMs) || nudgeIntervalMs < 1_000 || nudgeIntervalMs > 86_400_000))) {
    throw new RangeError("enabled nudge intervals must be between 1000 and 86400000 ms");
  }
  const argumentsList = [nodePath, CLI_PATH, "watch", "--ledger", ledger, "--home", home, "--agent-id", agentId];
  if (endpoint) argumentsList.push("--endpoint", endpoint);
  if (runtimeJsonPath) argumentsList.push("--runtime-json", runtimeJsonPath);
  if (nudges) argumentsList.push("--nudges", "--nudge-interval-ms", String(nudgeIntervalMs));
  const args = argumentsList.map((value) => `    <string>${escapeXml(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
`;
}

export function resolveLaunchAgentOutput(outputPath, { cwd = process.cwd() } = {}) {
  const root = resolve(cwd);
  const target = resolve(root, outputPath);
  const relativeTarget = relative(root, target);
  if (!relativeTarget || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) {
    throw new RangeError("plist output must be a file beneath the repository/output directory");
  }
  return target;
}

export async function writeLaunchAgentPlist(outputPath, options, { cwd = process.cwd() } = {}) {
  const target = resolveLaunchAgentOutput(outputPath, { cwd });
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, generateLaunchAgentPlist(options), { encoding: "utf8", flag: "w" });
  return target;
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
