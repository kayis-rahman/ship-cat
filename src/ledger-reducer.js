const DISPATCH_EVENTS = new Set(["dispatch", "dispatched", "task_dispatch", "task_dispatched"]);
const STATUS_EVENTS = new Set(["status", "task_status", "status_changed", "task_status_changed"]);
const TERMINAL_EVENTS = new Set(["completed", "failed", "cancelled", "canceled", "finished"]);

/** Purely reduce one reader envelope into an immutable reducer state. */
export function reduceLedger(state = { tasks: [], seen: [] }, envelope) {
  if (!envelope?.record || typeof envelope.record !== "object") return state;
  const record = envelope.record;
  const home = String(envelope.home ?? record.home ?? "default");
  const event = eventName(record);
  const taskId = taskIdentifier(record);
  if (!event || !taskId) return state;
  const dedupeKey = `${home}\0${eventIdentity(record, envelope)}`;
  if (state.seen.includes(dedupeKey)) return state;

  const isDispatch = DISPATCH_EVENTS.has(event);
  const isStatus = STATUS_EVENTS.has(event);
  const isTerminal = TERMINAL_EVENTS.has(event);
  if (!isDispatch && !isStatus && !isTerminal) return state;

  const taskIndex = state.tasks.findIndex((task) => task.home === home && task.taskId === taskId);
  const prior = taskIndex < 0
    ? { home, taskId, dispatched: false, provisional: true, status: null, fields: {}, _statusOrder: null }
    : state.tasks[taskIndex];
  const task = { ...prior, fields: { ...prior.fields } };
  if (isDispatch) {
    task.dispatched = true;
    task.provisional = false;
    copySafeFields(task, record);
  }
  if (isStatus || isTerminal) {
    const nextStatus = isTerminal ? event : statusValue(record);
    const order = recordOrder(record, envelope);
    if (nextStatus !== null && (task._statusOrder === null || compareOrder(order, task._statusOrder) >= 0)) {
      task.status = nextStatus;
      task._statusOrder = order;
    }
    copySafeFields(task, record);
  }

  const tasks = state.tasks.slice();
  if (taskIndex < 0) tasks.push(task);
  else tasks[taskIndex] = task;
  return { tasks, seen: [...state.seen, dedupeKey] };
}

/** Stateful convenience wrapper around the pure reduceLedger function. */
export function createLedgerReducer() {
  let state = { tasks: [], seen: [] };
  function apply(envelope) {
    const next = reduceLedger(state, envelope);
    if (next === state) return false;
    state = next;
    return true;
  }
  function snapshot() {
    return state.tasks
      .slice()
      .sort((a, b) => a.home.localeCompare(b.home) || a.taskId.localeCompare(b.taskId))
      .map(({ _statusOrder, ...task }) => ({ ...task, fields: { ...task.fields } }));
  }
  return { apply, snapshot, getState: snapshot, get size() { return state.tasks.length; } };
}

function eventName(record) {
  const value = record.type ?? record.event_type ?? record.kind ?? (typeof record.event === "string" ? record.event : null);
  return typeof value === "string" ? value.toLowerCase().replace(/[ -]/g, "_") : null;
}

function taskIdentifier(record) {
  const value = record.task_id ?? record.taskId ?? record.task?.id ?? record.task?.task_id ?? record.id;
  return value === undefined || value === null || value === "" ? null : String(value);
}

function statusValue(record) {
  const value = record.status ?? record.state;
  return typeof value === "string" && value.length ? value : null;
}

function eventIdentity(record, envelope) {
  const id = record.event_id ?? record.eventId ?? record.sequence ?? record.seq;
  return id !== undefined ? `id:${String(id)}` : `line:${envelope.path ?? ""}:${envelope.offset ?? ""}:${stableStringify(record)}`;
}

function recordOrder(record, envelope) {
  const value = record.timestamp ?? record.created_at ?? record.createdAt ?? record.sequence ?? record.seq ?? envelope.offset ?? 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : String(value);
}

function compareOrder(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function copySafeFields(task, record) {
  // Keep the projection deliberately small. Ledger text/details are not exposed to UI adapters.
  const candidates = ["title", "summary", "worker", "worker_id", "started_at", "updated_at"];
  for (const key of candidates) if (typeof record[key] === "string") task.fields[key] = record[key];
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
