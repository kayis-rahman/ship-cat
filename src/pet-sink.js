import { readFile } from "node:fs/promises";

const BODY_LIMIT = 16 * 1024;
const ALLOWED_STATES = new Set(["idle", "thinking", "working", "juggling", "error", "attention", "notification"]);
const ALLOWED_EVENTS = new Set([
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart",
  "PostToolUseFailure", "Stop", "Notification", "SessionEnd",
]);

/**
 * Create a fire-and-forget, loopback-only Clawd custom-agent sink.
 * update() never waits for network I/O; flush() is intended for tests/shutdown.
 */
export function createPetSink({
  agentId,
  endpoint,
  runtimeJsonPath,
  fetchImpl = globalThis.fetch,
  logger = console,
  maxAttempts = 5,
  baseDelayMs = 100,
  maxDelayMs = 2_000,
  nudges = false,
  nudgeIntervalMs = 300_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof agentId !== "string" || !agentId) throw new TypeError("agentId is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError("maxAttempts must be positive");
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new RangeError("backoff delays must be non-negative");
  }
  if (typeof nudges !== "boolean" || typeof now !== "function") throw new TypeError("nudges must be boolean and now must be a function");
  if (!Number.isSafeInteger(nudgeIntervalMs) || nudgeIntervalMs < 1 || nudgeIntervalMs > 86_400_000) {
    throw new RangeError("nudgeIntervalMs must be between 1 and 86400000");
  }

  const queue = [];
  const desired = new Map();
  const delivered = new Map();
  const lastNudgeAt = new Map();
  const successfulPayloads = [];
  let running = false;
  let stopped = false;
  let waiters = [];

  function log(level, message) {
    try { logger?.[level]?.(message); } catch { /* logging must not break ledger processing */ }
  }

  async function resolveEndpoint() {
    let target = endpoint;
    if (!target && runtimeJsonPath) {
      const metadata = JSON.parse(await readFile(runtimeJsonPath, "utf8"));
      if (metadata?.app !== "clawd-on-desk" || !Number.isInteger(metadata.port) || metadata.port < 1 || metadata.port > 65535) {
        throw new Error("invalid Clawd runtime metadata");
      }
      target = `http://127.0.0.1:${metadata.port}/state`;
    }
    if (typeof target !== "string") throw new Error("pet endpoint is unavailable");
    const url = new URL(target);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("pet endpoint must use loopback HTTP");
    }
    return url.href;
  }

  function commandSignature(command) {
    return JSON.stringify([command.state, command.event, Boolean(command.end)]);
  }

  function update(commands) {
    if (stopped) return;
    for (const command of Array.isArray(commands) ? commands : [commands]) {
      if (!command || typeof command.sessionId !== "string" || !command.sessionId ||
          !ALLOWED_STATES.has(command.state) || !ALLOWED_EVENTS.has(command.event)) {
        log("debug", "Ignoring pet command outside the documented state/event allowlist");
        continue;
      }
      const signature = commandSignature(command);
      const queued = queue.some((item) => item.command.sessionId === command.sessionId && item.signature === signature);
      const sameDesired = desired.get(command.sessionId) === signature;
      const sameDelivered = delivered.get(command.sessionId) === signature;
      if (sameDesired && queued) continue;
      if (sameDesired && sameDelivered) {
        const lastNudge = lastNudgeAt.get(command.sessionId) ?? now();
        if (!nudges || !command.alert || now() - lastNudge < nudgeIntervalMs) continue;
      } else if (sameDelivered && !queued) {
        continue;
      }
      desired.set(command.sessionId, signature);
      queue.push({ command: { ...command }, signature });
    }
    kick();
  }

  function kick() {
    if (running || stopped || queue.length === 0) return;
    running = true;
    void drain();
  }

  async function drain() {
    try {
      while (!stopped && queue.length) {
        const item = queue[0];
        let deliveredItem = false;
        for (let attempt = 1; attempt <= maxAttempts && !stopped; attempt += 1) {
          try {
            const target = await resolveEndpoint();
            const payload = {
              agent_id: agentId,
              session_id: item.command.sessionId,
              state: item.command.state,
              event: item.command.event,
            };
            const body = JSON.stringify(payload);
            if (Buffer.byteLength(body, "utf8") > BODY_LIMIT) {
              log("warn", "Discarding pet payload over the 16 KiB protocol limit");
              deliveredItem = true;
              break;
            }
            const response = await fetchImpl(target, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
            });
            if (response?.status === 200) {
              delivered.set(item.command.sessionId, item.signature);
              if (item.command.alert) lastNudgeAt.set(item.command.sessionId, now());
              else lastNudgeAt.delete(item.command.sessionId);
              successfulPayloads.push(payload);
              deliveredItem = true;
              break;
            }
            if (response?.status === 204 || (response?.status >= 400 && response.status < 500)) {
              log("debug", `Pet endpoint declined state update (${response.status})`);
              deliveredItem = true;
              break;
            }
            throw new Error(`retryable pet endpoint response: ${response?.status ?? "unknown"}`);
          } catch (error) {
            if (attempt === maxAttempts) {
              log("debug", `Pet endpoint unavailable after ${maxAttempts} attempts: ${error.message}`);
              break;
            }
            const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
            await sleep(delay);
          }
        }
        if (stopped) break;
        if (deliveredItem || queue[0] === item) queue.shift();
      }
    } finally {
      running = false;
      settleWaiters();
      if (!stopped && queue.length) kick();
    }
  }

  function settleWaiters() {
    if (running || queue.length) return;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  }

  function flush() {
    if (!running && queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => waiters.push(resolve));
  }

  async function stop() {
    stopped = true;
    queue.length = 0;
    settleWaiters();
    await flush();
  }

  return {
    update,
    flush,
    stop,
    get pending() { return queue.length; },
    snapshot() {
      return {
        pending: queue.length,
        delivered: [...delivered.keys()],
        payloads: successfulPayloads.map((payload) => ({ ...payload })),
      };
    },
  };
}
