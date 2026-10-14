import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const documentation = await readFile(new URL("../docs/protocols.md", import.meta.url), "utf8");

const documentedExample = {
  agent_id: "custom-nova-ai-0123456789ab",
  session_id: "project-a",
  state: "working",
  event: "PreToolUse",
};

test("documented custom-agent request has required string fields and fits Clawd's body cap", () => {
  assert.deepEqual(Object.keys(documentedExample), ["agent_id", "session_id", "state", "event"]);
  for (const value of Object.values(documentedExample)) assert.equal(typeof value, "string");
  assert.ok(Buffer.byteLength(JSON.stringify(documentedExample), "utf8") <= 16 * 1024);
});

test("protocol notes distinguish source inspection from missing live evidence", () => {
  assert.match(documentation, /Verified \(source\)/);
  assert.match(documentation, /Inferred, not live-verified/);
  assert.match(documentation, /five, ten, or twenty/);
  assert.match(documentation, /No live Clawd route\/authentication check/);
  assert.match(documentation, /No real Firstmate ledger records were captured/);
  assert.match(documentation, /Do not send prompts, tool input, files, secrets/);
});
