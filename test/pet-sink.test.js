import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLedgerReader } from "../src/ledger-reader.js";
import { createLedgerReducer } from "../src/ledger-reducer.js";
import { createPetMapper } from "../src/pet-mapper.js";
import { createPetSink } from "../src/pet-sink.js";

async function fakePetServer({ statuses = [] } = {}) {
  const received = [];
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requestCount += 1;
    let payload;
    try { payload = JSON.parse(body); } catch { response.writeHead(400).end(); return; }
    received.push({ payload, headers: request.headers });
    const status = statuses[requestCount - 1] ?? 200;
    response.writeHead(status).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    received,
    endpoint: `http://127.0.0.1:${port}/state`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "shipcat-m2-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const silentLogger = { debug() {}, warn() {} };

test("fake-server integration allows only identity/state fields and dedupes per home/task", async () => {
  const server = await fakePetServer();
  const sink = createPetSink({ agentId: "custom-shipcat-test", endpoint: server.endpoint, logger: silentLogger });
  const mapper = createPetMapper({ logger: silentLogger });
  try {
    const states = ["dispatched", "working", "needs-decision", "working", "pr-ready", "merged", "cleaned-up"];
    const reducer = createLedgerReducer();
    for (let i = 0; i < states.length; i += 1) {
      const status = states[i];
      const envelope = {
        home: "project-alpha", offset: i + 1,
        record: status === "dispatched"
          ? { type: "dispatch", task_id: "task-1", event_id: "dispatch", title: "secret title" }
          : { type: "status", task_id: "task-1", status, event_id: `event-${i}`, timestamp: i + 1,
              title: "private title", summary: "raw ledger decision text", secret: "token-value" },
      };
      reducer.apply(envelope);
      sink.update(mapper.mapSnapshot(reducer.snapshot()));
      await sink.flush();
    }
    sink.update(mapper.mapSnapshot(reducer.snapshot()));
    await sink.flush();

    const expected = [
      ["idle", "SessionStart"], ["working", "PreToolUse"], ["notification", "Notification"],
      ["working", "PreToolUse"], ["attention", "Stop"], ["idle", "Stop"], ["idle", "SessionEnd"],
    ];
    assert.deepEqual(server.received.map(({ payload }) => [payload.state, payload.event]), expected);
    assert.equal(new Set(server.received.map(({ payload }) => payload.session_id)).size, 1);
    for (const { payload, headers } of server.received) {
      assert.deepEqual(Object.keys(payload).sort(), ["agent_id", "event", "session_id", "state"]);
      assert.equal(payload.agent_id, "custom-shipcat-test");
      assert.equal(headers["content-type"], "application/json");
      assert.equal(headers.origin, undefined);
      assert.equal(JSON.stringify(payload).includes("private"), false);
      assert.equal(JSON.stringify(payload).includes("token-value"), false);
    }
  } finally {
    await sink.stop();
    await server.close();
  }
});

test("different homes and tasks get distinct pet sessions", async () => {
  const server = await fakePetServer();
  const sink = createPetSink({ agentId: "custom-shipcat-test", endpoint: server.endpoint, logger: silentLogger });
  const mapper = createPetMapper({ logger: silentLogger });
  try {
    sink.update(mapper.mapSnapshot([
      { home: "alpha", taskId: "same", status: "working" },
      { home: "beta", taskId: "same", status: "working" },
      { home: "alpha", taskId: "other", status: "working" },
    ]));
    await sink.flush();
    assert.equal(new Set(server.received.map(({ payload }) => payload.session_id)).size, 3);
  } finally {
    await sink.stop();
    await server.close();
  }
});

test("discovers the endpoint from validated local runtime metadata", async () => {
  await withTempDir(async (dir) => {
    const server = await fakePetServer();
    const runtimeJsonPath = join(dir, "runtime.json");
    const port = new URL(server.endpoint).port;
    await writeFile(runtimeJsonPath, JSON.stringify({ app: "clawd-on-desk", port: Number(port) }));
    const sink = createPetSink({ agentId: "custom-shipcat-test", runtimeJsonPath, logger: silentLogger });
    try {
      sink.update({ sessionId: "runtime-session", state: "working", event: "PreToolUse" });
      await sink.flush();
      assert.equal(server.received.length, 1);
    } finally {
      await sink.stop();
      await server.close();
    }
  });
});

test("retries endpoint errors with bounded exponential backoff", async () => {
  const server = await fakePetServer({ statuses: [503, 503, 200] });
  const delays = [];
  const sink = createPetSink({
    agentId: "custom-shipcat-test", endpoint: server.endpoint, logger: silentLogger,
    baseDelayMs: 3, maxDelayMs: 4, maxAttempts: 4,
    sleep: async (delay) => { delays.push(delay); },
  });
  try {
    sink.update({ sessionId: "s", state: "working", event: "PreToolUse" });
    await sink.flush();
    assert.deepEqual(delays, [3, 4]);
    assert.equal(server.received.length, 3);
    assert.equal(sink.pending, 0);
  } finally {
    await sink.stop();
    await server.close();
  }
});

test("endpoint outage is bounded and does not block ledger reading", async () => {
  await withTempDir(async (dir) => {
    const ledger = join(dir, "ledger.jsonl");
    await writeFile(ledger, '{"type":"status","task_id":"t","status":"working"}\n');
    let attempts = 0;
    const sink = createPetSink({
      agentId: "custom-shipcat-test", endpoint: "http://127.0.0.1:1/state", logger: silentLogger,
      maxAttempts: 3, baseDelayMs: 5, sleep: async () => new Promise((resolve) => setTimeout(resolve, 5)),
      fetchImpl: async () => { attempts += 1; throw new Error("connection refused"); },
    });
    try {
      sink.update({ sessionId: "s", state: "working", event: "PreToolUse" });
      const reader = createLedgerReader([{ path: ledger, home: "alpha" }]);
      const started = Date.now();
      const entries = await reader.read();
      assert.equal(entries.length, 1);
      assert.ok(Date.now() - started < 100);
      assert.equal(sink.pending, 1);
      await sink.flush();
      assert.equal(attempts, 3);
      assert.equal(sink.pending, 0);
    } finally {
      await sink.stop();
    }
  });
});

test("204 and non-retryable client errors fail open without retry", async () => {
  const server = await fakePetServer({ statuses: [204, 400] });
  let delays = 0;
  const sink = createPetSink({
    agentId: "custom-shipcat-test", endpoint: server.endpoint, logger: silentLogger,
    sleep: async () => { delays += 1; },
  });
  try {
    sink.update([
      { sessionId: "one", state: "working", event: "PreToolUse" },
      { sessionId: "two", state: "working", event: "PreToolUse" },
    ]);
    await sink.flush();
    assert.equal(server.received.length, 2);
    assert.equal(delays, 0);
  } finally {
    await sink.stop();
    await server.close();
  }
});
