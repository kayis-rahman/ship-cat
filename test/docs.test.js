import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const readme = await readFile(new URL("README.md", root), "utf8");
const configuration = await readFile(new URL("docs/configuration.md", root), "utf8");
const milestones = await readFile(new URL("docs/milestones.md", root), "utf8");
const verification = await readFile(new URL("docs/verification.md", root), "utf8");
const liveSmoke = await readFile(new URL("scripts/live-smoke.sh", root), "utf8");
const legacyArchive = await readFile(new URL("docs/archive/legacy-js-bridge.md", root), "utf8");

test("package exposes the CLI without runtime dependencies", async () => {
  assert.equal(packageJson.bin.shipcat, "./src/cli.js");
  assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), []);
  const executable = await readFile(new URL(packageJson.bin.shipcat, root), "utf8");
  assert.match(executable, /^#!\/usr\/bin\/env node/);
});

test("docs describe commands, safe service behavior, and fake/live verification boundary", () => {
  assert.match(readme, /swift test/);
  assert.match(readme, /floating desktop companion/);
  for (const command of ["once", "watch", "status", "service install", "service uninstall"]) assert.match(legacyArchive, new RegExp(command.replace(" ", "\\s+")));
  assert.match(configuration, /Nudges are disabled/);
  assert.match(configuration, /No service command loads launchd/);
  assert.match(milestones, /M3 - CLI[\s\S]*M6 - Packaging and docs/);
  assert.match(verification, /fake HTTP pet servers/);
  assert.match(verification, /Not verified live/);
  assert.match(configuration, /does not seek from a saved offset/);
  assert.match(legacyArchive, /scripts\/live-smoke.sh/);
  assert.match(legacyArchive, /not part of `npm test`/);
  assert.match(liveSmoke, /SHIPCAT_AGENT_ID/);
  assert.match(liveSmoke, /cleaned-up/);
});
