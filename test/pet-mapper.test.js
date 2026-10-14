import test from "node:test";
import assert from "node:assert/strict";
import { createPetMapper, deriveSessionId, mapTaskToPet } from "../src/pet-mapper.js";

const task = (status, extra = {}) => ({ home: "project-a", taskId: "task-1", status, ...extra });

test("maps lifecycle values to documented Clawd states and events", () => {
  const cases = [
    ["dispatched", "idle", "SessionStart", false],
    ["working", "working", "PreToolUse", false],
    ["needs-decision", "notification", "Notification", true],
    ["blocked", "notification", "Notification", true],
    ["paused", "idle", "Stop", false],
    ["failed", "error", "PostToolUseFailure", false],
    ["done", "idle", "Stop", false],
    ["pr-ready", "attention", "Stop", true],
    ["merged", "idle", "Stop", false],
    ["cleaned-up", "idle", "SessionEnd", false],
  ];
  for (const [status, state, event, alert] of cases) {
    const command = mapTaskToPet(task(status));
    assert.equal(command.state, state, status);
    assert.equal(command.event, event, status);
    assert.equal(command.alert, alert, status);
  }
});

test("dispatched starts a session when enriching a provisional task without status", () => {
  assert.equal(mapTaskToPet({ home: "h", taskId: "t", dispatched: true }).event, "SessionStart");
  assert.equal(mapTaskToPet({ home: "h", taskId: "t", provisional: true }), null);
});

test("session identity is stable per home/task and distinct across either identity", () => {
  assert.equal(deriveSessionId("home", "task"), deriveSessionId("home", "task"));
  assert.notEqual(deriveSessionId("home-a", "task"), deriveSessionId("home-b", "task"));
  assert.notEqual(deriveSessionId("home", "task-a"), deriveSessionId("home", "task-b"));
});

test("matching resolved decision keys clear alerts without retaining key or ledger text", () => {
  const decision = mapTaskToPet(task("needs-decision", {
    decisionKey: "review-db", resolvedDecisionKeys: ["other", "review-db"],
    title: "private title", summary: "private decision text",
  }));
  assert.equal(decision.alert, false);
  assert.equal(decision.state, "idle");
  assert.equal(JSON.stringify(decision).includes("review-db"), false);
  assert.equal(JSON.stringify(decision).includes("private"), false);

  const unresolved = mapTaskToPet(task("needs-decision", {
    decisionKey: "review-db", resolvedDecisionKeys: ["different-key"],
  }));
  assert.equal(unresolved.alert, true);
  assert.equal(unresolved.state, "notification");
});

test("unknown statuses are ignored and logged once at debug", () => {
  const messages = [];
  const mapper = createPetMapper({ logger: { debug: (message) => messages.push(message) } });
  assert.deepEqual(mapper.mapSnapshot([task("mystery"), task("mystery")]), []);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /mystery/);
});
