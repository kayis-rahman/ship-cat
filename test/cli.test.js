import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "shipcat-cli-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function fakePetServer() {
  const payloads = [];
  // A separate queue makes watch tests deterministic without polling the server.
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    payloads.push(JSON.parse(body));
    requests.shift()?.();
    response.writeHead(200).end();
  });
  const waitForRequest = () => new Promise((resolve) => requests.push(resolve));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/state`,
    payloads,
    waitForRequest,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function streams() {
  let out = "";
  let err = "";
  return {
    stdout: { write: (text) => { out += text; } },
    stderr: { write: (text) => { err += text; } },
    output: () => out,
    errors: () => err,
  };
}

test("once reads, reduces, maps, and sends only allowlisted state via fake server", async () => {
  await withTempDir(async (dir) => {
    const ledger = join(dir, "ledger.jsonl");
    await writeFile(ledger, `${JSON.stringify({ type: "status", task_id: "task-1", status: "needs-decision", title: "secret title", summary: "private text" })}\n`);
    const pet = await fakePetServer();
    const io = streams();
    try {
      const code = await runCli(["once", "--ledger", ledger, "--home", "project", "--agent-id", "custom-shipcat-test", "--endpoint", pet.endpoint], io);
      assert.equal(code, 0);
      assert.equal(pet.payloads.length, 1);
      assert.deepEqual(Object.keys(pet.payloads[0]).sort(), ["agent_id", "event", "session_id", "state"]);
      assert.equal(pet.payloads[0].state, "notification");
      assert.equal(JSON.stringify(pet.payloads).includes("secret"), false);
      assert.equal(JSON.stringify(pet.payloads).includes("private"), false);
    } finally {
      await pet.close();
    }
  });
});

test("status prints aggregate counts without ledger text or pet connection", async () => {
  await withTempDir(async (dir) => {
    const ledger = join(dir, "ledger.jsonl");
    await writeFile(ledger, `${JSON.stringify({ type: "status", task_id: "task-1", status: "blocked", title: "do not print this" })}\n`);
    const io = streams();
    const code = await runCli(["status", "--ledger", ledger, "--home", "project"], io);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(io.output()), { home: "project", tasks: 1, dispatched: 0, provisional: 1, alerts: 1 });
    assert.equal(io.output().includes("do not print"), false);
  });
});

test("watch continues independently and stops cleanly on SIGINT", async () => {
  await withTempDir(async (dir) => {
    const ledger = join(dir, "ledger.jsonl");
    await writeFile(ledger, `${JSON.stringify({ type: "status", task_id: "task-1", status: "working" })}\n`);
    const pet = await fakePetServer();
    const io = streams();
    const signals = new EventEmitter();
    try {
      const running = runCli([
        "watch", "--ledger", ledger, "--home", "project", "--agent-id", "custom-shipcat-test",
        "--endpoint", pet.endpoint, "--interval-ms", "10",
      ], { ...io, signalHandlers: signals });
      await pet.waitForRequest();
      signals.emit("SIGINT");
      assert.equal(await running, 0);
      assert.ok(pet.payloads.length >= 1);
    } finally {
      await pet.close();
    }
  });
});

test("CLI rejects missing and unknown options", async () => {
  const io = streams();
  assert.equal(await runCli(["once", "--ledger", "/tmp/ledger"], io), 2);
  assert.match(io.errors(), /Missing required/);
  const bad = streams();
  assert.equal(await runCli(["status", "--ledger", "/tmp/ledger", "--home", "h", "--oops", "x"], bad), 2);
  assert.match(bad.errors(), /Unknown option/);
});
