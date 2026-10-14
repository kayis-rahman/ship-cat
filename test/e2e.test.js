import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSessionId } from "../src/pet-mapper.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "shipcat-e2e-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function fakePetServer() {
  const attempts = [];
  const accepted = [];
  const waiters = [];
  let available = true;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    attempts.push(payload);
    if (!available) {
      response.destroy();
      return;
    }
    accepted.push(payload);
    response.writeHead(200).end();
    for (const waiter of [...waiters]) {
      if (waiter.predicate(payload)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(payload);
      }
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/state`,
    attempts,
    accepted,
    setAvailable(value) { available = value; },
    waitFor(predicate, timeoutMs = 5_000) {
      const existing = accepted.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error("timed out waiting for fake pet request"));
        }, timeoutMs) };
        waiters.push(waiter);
      });
    },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function launch(args) {
  const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, exited };
}

function record(type, taskId, id, extra = {}) {
  return { type, task_id: taskId, event_id: id, ...extra };
}

async function runOnce(ledger, home, checkpoint, endpoint, agentId) {
  const child = launch([
    "once", "--ledger", ledger, "--home", home, "--agent-id", agentId,
    "--endpoint", endpoint, "--checkpoint", checkpoint,
  ]);
  const result = await child.exited;
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(await readFile(checkpoint, "utf8"));
}

test("real CLI end-to-end once/watch, outage recovery, restart offsets, and SIGTERM", async (t) => {
  await withTempDir(async (dir) => {
    const pet = await fakePetServer();
    t.after(() => pet.close());
    const agentId = "custom-shipcat-e2e";
    const ledgerA = join(dir, "home-a.jsonl");
    const ledgerB = join(dir, "home-b.jsonl");
    const checkpointA = join(dir, "checkpoint-a.json");
    const checkpointB = join(dir, "checkpoint-b.json");
    await writeFile(ledgerA, [
      record("dispatched", "task-start", "a-1", { title: "never send this title" }),
      record("status", "task-work", "a-2", { status: "working", summary: "private summary" }),
      record("status", "task-decision", "a-3", { status: "needs-decision", decision: "private decision text" }),
    ].map((row) => `${JSON.stringify(row)}\n`).join(""));
    await writeFile(ledgerB, [
      record("status", "task-blocked", "b-1", { status: "blocked", title: "secret blocked task" }),
      record("status", "task-done", "b-2", { status: "done" }),
      record("status", "task-failed", "b-3", { status: "failed" }),
    ].map((row) => `${JSON.stringify(row)}\n`).join(""));

    const checkpointAFirst = await runOnce(ledgerA, "home-a", checkpointA, pet.endpoint, agentId);
    const checkpointBFirst = await runOnce(ledgerB, "home-b", checkpointB, pet.endpoint, agentId);
    const initialExpected = new Map([
      [deriveSessionId("home-a", "task-start"), ["idle", "SessionStart"]],
      [deriveSessionId("home-a", "task-work"), ["working", "PreToolUse"]],
      [deriveSessionId("home-a", "task-decision"), ["notification", "Notification"]],
      [deriveSessionId("home-b", "task-blocked"), ["notification", "Notification"]],
      [deriveSessionId("home-b", "task-done"), ["idle", "Stop"]],
      [deriveSessionId("home-b", "task-failed"), ["error", "PostToolUseFailure"]],
    ]);
    assert.equal(pet.accepted.length, 6);
    for (const [sessionId, [state, event]] of initialExpected) {
      assert.equal(pet.accepted.filter((item) => item.session_id === sessionId).length, 1);
      assert.ok(pet.accepted.some((item) => item.session_id === sessionId && item.state === state && item.event === event));
    }
    assert.equal(JSON.stringify(pet.accepted).includes("private"), false);
    assert.equal(JSON.stringify(pet.accepted).includes("secret"), false);

    // A restarted once process replays the canonical ledger, but the durable byte offsets remain recorded.
    const beforeRestartCount = pet.accepted.length;
    const checkpointARestart = await runOnce(ledgerA, "home-a", checkpointA, pet.endpoint, agentId);
    assert.deepEqual(checkpointARestart.offsets, checkpointAFirst.offsets);
    assert.equal(pet.accepted.length - beforeRestartCount, 3);

    const watchLedger = join(dir, "watch-home.jsonl");
    const watchCheckpoint = join(dir, "watch-checkpoint.json");
    await writeFile(watchLedger, `${JSON.stringify(record("dispatched", "watch-task", "w-1"))}\n`);
    const watch = launch([
      "watch", "--ledger", watchLedger, "--home", "watch-home", "--agent-id", agentId,
      "--endpoint", pet.endpoint, "--interval-ms", "20", "--checkpoint", watchCheckpoint,
    ]);
    t.after(() => { if (watch.child.exitCode === null) watch.child.kill("SIGKILL"); });
    const watchSession = deriveSessionId("watch-home", "watch-task");
    await pet.waitFor((item) => item.session_id === watchSession && item.event === "SessionStart");

    const appendStatus = async (status, id, taskId = "watch-task") => {
      await appendFile(watchLedger, `${JSON.stringify(record("status", taskId, id, { status, title: "never expose ledger text" }))}\n`);
      const expected = status === "working" ? ["working", "PreToolUse"]
        : status === "needs-decision" || status === "blocked" ? ["notification", "Notification"]
          : status === "done" ? ["idle", "Stop"]
            : status === "failed" ? ["error", "PostToolUseFailure"] : null;
      assert.ok(expected, `unexpected test lifecycle ${status}`);
      return pet.waitFor((item) => item.session_id === deriveSessionId("watch-home", taskId) && item.state === expected[0] && item.event === expected[1]);
    };
    await appendStatus("working", "w-2");
    await appendStatus("needs-decision", "w-3");
    await appendStatus("done", "w-4");
    await appendStatus("blocked", "w-5", "blocked-task");

    // Simulate a refused pet endpoint during a state transition, then recover it.
    const recoverySession = deriveSessionId("watch-home", "recovery-task");
    pet.setAvailable(false);
    await appendFile(watchLedger, `${JSON.stringify(record("dispatched", "recovery-task", "w-6"))}\n`);
    const attemptsBeforeOutage = pet.attempts.length;
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(pet.attempts.slice(attemptsBeforeOutage).some((item) => item.session_id === recoverySession));
    pet.setAvailable(true);
    await pet.waitFor((item) => item.session_id === recoverySession && item.event === "SessionStart");
    const acceptedRecovery = pet.accepted.filter((item) => item.session_id === recoverySession);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(pet.accepted.filter((item) => item.session_id === recoverySession).length, acceptedRecovery.length);
    assert.ok(pet.attempts.filter((item) => item.session_id === recoverySession).length <= 5);

    await appendStatus("failed", "w-7", "failed-task");
    const beforeSignal = JSON.parse(await readFile(watchCheckpoint, "utf8"));
    assert.ok(beforeSignal.offsets.some((item) => item.path === watchLedger && item.offset > 0));
    watch.child.kill("SIGTERM");
    const watchResult = await watch.exited;
    assert.equal(watchResult.code, 0, watchResult.stderr);
    const afterRestart = await runOnce(watchLedger, "watch-home", watchCheckpoint, pet.endpoint, agentId);
    assert.ok(afterRestart.offsets[0].offset >= beforeSignal.offsets[0].offset);
  });
});
