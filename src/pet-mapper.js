import { createHash } from "node:crypto";

const MAPPINGS = Object.freeze({
  dispatched: { state: "idle", event: "SessionStart", start: true },
  working: { state: "working", event: "PreToolUse" },
  needs_decision: { state: "notification", event: "Notification", alert: true },
  blocked: { state: "notification", event: "Notification", alert: true },
  paused: { state: "idle", event: "Stop" },
  failed: { state: "error", event: "PostToolUseFailure" },
  done: { state: "idle", event: "Stop" },
  completed: { state: "idle", event: "Stop" },
  pr_ready: { state: "attention", event: "Stop", alert: true },
  merged: { state: "idle", event: "Stop" },
  cleaned_up: { state: "idle", event: "SessionEnd", end: true },
  resolved: { state: "idle", event: "Stop", clearAlert: true },
});

const PET_STATES = new Set(["idle", "thinking", "working", "juggling", "error", "attention", "notification"]);

export function normalizeLifecycle(status) {
  return typeof status === "string" ? status.trim().toLowerCase().replace(/[\s-]+/g, "_") : null;
}

export function deriveSessionId(home, taskId) {
  if (home === undefined || home === null || taskId === undefined || taskId === null) {
    throw new TypeError("home and taskId are required");
  }
  const project = String(home);
  const task = String(taskId);
  const digest = createHash("sha256").update(`${project}\0${task}`).digest("hex");
  const slug = (value) => value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
  return `shipcat/${slug(project)}/${slug(task)}/${digest}`;
}

/** Map one reduced task snapshot to an allowlisted pet command, or null if unknown. */
export function mapTaskToPet(task) {
  if (!task || task.home === undefined || task.taskId === undefined) return null;
  let lifecycle = normalizeLifecycle(task.status);
  if (!lifecycle && task.dispatched) lifecycle = "dispatched";
  const mapping = MAPPINGS[lifecycle];
  if (!mapping) return null;

  // Resolution metadata is optional because M1's reducer intentionally exposes no ledger text.
  // Compare decision identifiers only in memory; never include them in a pet command.
  const key = task.decisionKey ?? task.decision_key;
  const resolved = task.resolvedDecisionKeys ?? task.resolved_decision_keys;
  const keyMatchesResolution = key !== undefined && Array.isArray(resolved) && resolved.includes(key);
  const clearAlert = Boolean(mapping.clearAlert || keyMatchesResolution);
  const result = {
    sessionId: deriveSessionId(task.home, task.taskId),
    state: mapping.state,
    event: mapping.event,
    end: Boolean(mapping.end),
    alert: Boolean(mapping.alert) && !clearAlert,
  };
  if (clearAlert && mapping.alert) {
    result.state = "idle";
    result.event = "Stop";
    result.alert = false;
  }
  if (!PET_STATES.has(result.state)) return null;
  return result;
}

/** Mapper with debug-once reporting for unsupported lifecycle values. */
export function createPetMapper({ logger = console } = {}) {
  const logged = new Set();
  function mapTask(task) {
    const command = mapTaskToPet(task);
    const lifecycle = normalizeLifecycle(task?.status) ?? (task?.dispatched ? "dispatched" : null);
    if (!command && lifecycle && !Object.hasOwn(MAPPINGS, lifecycle) && !logged.has(lifecycle)) {
      logged.add(lifecycle);
      logger?.debug?.(`Ignoring unknown task lifecycle: ${lifecycle}`);
    }
    return command;
  }
  return {
    mapTask,
    mapSnapshot(tasks) {
      return (Array.isArray(tasks) ? tasks : []).map(mapTask).filter(Boolean);
    },
  };
}
