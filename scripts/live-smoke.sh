#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
AGENT_ID=${SHIPCAT_AGENT_ID:-}
RUNTIME_JSON=${SHIPCAT_RUNTIME_JSON:-"$HOME/.clawd/runtime.json"}

if [ -z "$AGENT_ID" ]; then
  echo "Set SHIPCAT_AGENT_ID to a registered Clawd custom-agent ID." >&2
  exit 2
fi
if [ ! -f "$RUNTIME_JSON" ]; then
  echo "Clawd runtime metadata not found: $RUNTIME_JSON" >&2
  exit 2
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/shipcat-live-smoke.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM
LEDGER="$TMP_DIR/smoke.jsonl"
HOME_ID="shipcat-live-smoke"
TASK_ID="smoke-$(date +%s)-$$"

node --input-type=module - "$LEDGER" "$TASK_ID" <<'NODE'
import { appendFile } from "node:fs/promises";
const [path, taskId] = process.argv.slice(2);
const row = { type: "status", task_id: taskId, status: "working", event_id: "smoke-working" };
await appendFile(path, `${JSON.stringify(row)}\n`);
NODE

node "$ROOT/src/cli.js" once \
  --ledger "$LEDGER" --home "$HOME_ID" --agent-id "$AGENT_ID" \
  --runtime-json "$RUNTIME_JSON"

node --input-type=module - "$LEDGER" "$TASK_ID" <<'NODE'
import { appendFile } from "node:fs/promises";
const [path, taskId] = process.argv.slice(2);
const row = { type: "status", task_id: taskId, status: "cleaned-up", event_id: "smoke-cleanup", timestamp: Date.now() };
await appendFile(path, `${JSON.stringify(row)}\n`);
NODE

node "$ROOT/src/cli.js" once \
  --ledger "$LEDGER" --home "$HOME_ID" --agent-id "$AGENT_ID" \
  --runtime-json "$RUNTIME_JSON"

echo "Clawd accepted the local working and cleanup smoke states."
