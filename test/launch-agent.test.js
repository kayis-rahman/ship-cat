import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLaunchAgentPlist, resolveLaunchAgentOutput, writeLaunchAgentPlist } from "../src/launch-agent.js";
import { runCli } from "../src/cli.js";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "shipcat-launch-agent-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

function streams() {
  let out = "";
  let err = "";
  return { stdout: { write: (v) => { out += v; } }, stderr: { write: (v) => { err += v; } }, output: () => out, errors: () => err };
}

const options = {
  ledger: "/data/ledger & archive.jsonl", home: "project <one>", agentId: "custom-shipcat-id",
  runtimeJsonPath: "/Users/test/.clawd/runtime.json", label: "local.shipcat<&>",
};

test("plist generator escapes XML and points only to the watch CLI", () => {
  const plist = generateLaunchAgentPlist(options);
  assert.match(plist, /&amp; archive/);
  assert.match(plist, /project &lt;one&gt;/);
  assert.match(plist, /local\.shipcat&lt;&amp;&gt;/);
  assert.match(plist, /<string>watch<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>/);
  assert.doesNotMatch(plist, /launchctl/);
});

test("plist write is restricted beneath the selected output directory", async () => {
  await withTempDir(async (dir) => {
    const target = await writeLaunchAgentPlist("output/agent.plist", options, { cwd: dir });
    assert.equal((await readFile(target, "utf8")).includes("custom-shipcat-id"), true);
    assert.equal(resolveLaunchAgentOutput("output/agent.plist", { cwd: dir }), target);
    assert.throws(() => resolveLaunchAgentOutput("../outside.plist", { cwd: dir }), /beneath/);
    assert.throws(() => resolveLaunchAgentOutput(".", { cwd: dir }), /beneath/);
  });
});

test("service install writes only the plist and uninstall prints guidance without deleting it", async () => {
  await withTempDir(async (dir) => {
    const installIo = streams();
    const args = ["service", "install", "--ledger", "/data/ledger.jsonl", "--home", "project", "--agent-id", "custom-id", "--runtime-json", "/tmp/clawd-runtime.json", "--output", "out/bridge.plist"];
    assert.equal(await runCli(args, { ...installIo, cwd: dir }), 0);
    const target = join(dir, "out/bridge.plist");
    assert.equal((await stat(target)).isFile(), true);
    assert.match(installIo.output(), /was not loaded/);

    const uninstallIo = streams();
    assert.equal(await runCli(["service", "uninstall", "--output", "out/bridge.plist"], { ...uninstallIo, cwd: dir }), 0);
    assert.match(uninstallIo.output(), /No launchctl command was run/);
    assert.equal((await stat(target)).isFile(), true);
  });
});
