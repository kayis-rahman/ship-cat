import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLedgerReader } from "../src/ledger-reader.js";
import { createLedgerReducer, reduceLedger } from "../src/ledger-reducer.js";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "shipcat-ledger-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

const row = (record, home = "home-a", offset = 0, path = "/ledger") => ({ home, path, offset, record });

test("reader handles empty files, partial and malformed JSONL, and arbitrary chunk boundaries", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "fleet-ledger.jsonl");
    await writeFile(path, "");
    const reader = createLedgerReader([{ path, home: "alpha" }], { chunkSize: 3 });
    assert.deepEqual(await reader.read(), []);
    await appendFile(path, '{"type":"dispatch","task_id":"a"');
    assert.deepEqual(await reader.read(), []);
    await appendFile(path, '}\nnot-json\n\n{"type":"status","task_id":"a","status":"working"}\n');
    const entries = await reader.read();
    assert.equal(entries.length, 3);
    assert.deepEqual(entries[0].record, { type: "dispatch", task_id: "a" });
    assert.equal(entries[1].record, null);
    assert.equal(entries[1].error, "Malformed JSONL record");
    assert.equal(entries[2].record.status, "working");
    assert.deepEqual(await reader.read(), []);
  });
});

test("reader detects truncation and replacement and keeps home identity", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ledger.jsonl");
    await writeFile(path, '{"id":"old"}\n');
    const reader = createLedgerReader([{ path, home: "one" }]);
    assert.equal((await reader.read())[0].record.id, "old");
    await writeFile(path, '{"id":"new-content-longer-than-the-old-record"}\n');
    assert.equal((await reader.read())[0].record.id, "new-content-longer-than-the-old-record");
    const replacement = join(dir, "replacement.jsonl");
    await writeFile(replacement, '{"id":"replacement"}\n');
    await rename(replacement, path);
    assert.equal((await reader.read())[0].record.id, "replacement");
    assert.equal((await readFile(path, "utf8")).includes("replacement"), true);
    assert.equal(reader.offsets()[0].home, "one");
  });
});

test("reducer tolerates status before dispatch, unknown fields/events, and malformed envelopes", () => {
  const reducer = createLedgerReducer();
  assert.equal(reducer.apply({ record: null }), false);
  assert.equal(reducer.apply(row({ type: "mystery", task_id: "x" })), false);
  assert.equal(reducer.apply(row({ type: "status", task_id: "x", status: "working", secret: "ignore" }, "a")), true);
  assert.equal(reducer.snapshot()[0].provisional, true);
  reducer.apply(row({ type: "dispatch", task_id: "x", title: "Task", extra: { nope: true } }, "a"));
  const state = reducer.snapshot()[0];
  assert.equal(state.provisional, false);
  assert.equal(state.status, "working");
  assert.deepEqual(state.fields, { title: "Task" });
  reducer.apply(row({ type: "status", task_id: "x", status: "done", timestamp: 20 }, "a", 20));
  reducer.apply(row({ type: "status", task_id: "x", status: "stale", timestamp: 10 }, "a", 10));
  assert.equal(reducer.snapshot()[0].status, "done");
});

test("functional reducer preserves prior state and ignores duplicate input", () => {
  const initial = { tasks: [], seen: [] };
  const event = row({ type: "dispatch", task_id: "pure", event_id: "once" });
  const next = reduceLedger(initial, event);
  assert.deepEqual(initial, { tasks: [], seen: [] });
  assert.notEqual(next, initial);
  assert.equal(reduceLedger(next, event), next);
});

test("reducer is idempotent under duplicate records and keeps homes distinct", () => {
  const records = [
    row({ type: "status", task_id: "same", status: "running", event_id: "e2", timestamp: 2 }, "a", 2),
    row({ type: "dispatch", task_id: "same", event_id: "e1", timestamp: 1 }, "a", 1),
    row({ type: "dispatch", task_id: "same", event_id: "e1", timestamp: 1 }, "a", 1),
    row({ type: "dispatch", task_id: "same", event_id: "e1", timestamp: 1 }, "b", 1),
  ];
  const expected = createLedgerReducer();
  for (const event of records) expected.apply(event);
  const replay = createLedgerReducer();
  for (const event of [...records, ...records]) replay.apply(event);
  assert.deepEqual(replay.snapshot(), expected.snapshot());
  assert.equal(replay.snapshot().length, 2);
});

test("reducer replay result is independent of reader chunk size", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ledger.jsonl");
    const content = [
      { type: "status", task_id: "t", status: "ready", event_id: "s", timestamp: 2 },
      { type: "dispatch", task_id: "t", event_id: "d", timestamp: 1 },
      { type: "completed", task_id: "t", event_id: "c", timestamp: 3 },
    ].map((event) => JSON.stringify(event) + "\n").join("");
    await writeFile(path, content);
    const outcomes = [];
    for (const chunkSize of [1, 7, 64 * 1024]) {
      const reader = createLedgerReader([{ path, home: "home" }], { chunkSize });
      const reducer = createLedgerReducer();
      for (const event of await reader.read()) reducer.apply(event);
      outcomes.push(reducer.snapshot());
    }
    assert.deepEqual(outcomes[1], outcomes[0]);
    assert.deepEqual(outcomes[2], outcomes[0]);
    assert.equal(outcomes[0][0].status, "completed");
  });
});
