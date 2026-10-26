#!/usr/bin/env bash
# Send one isolated status JSON sample for the requested data class.
# Usage: fleet-status-send.sh <live_status|snapshot|backlog_changes|history_hour>
set -u
CLASS="${1:-live_status}"
FM_HOME="${FM_HOME:-/Users/kayisrahman/Documents/workspace/firstmate}"
OUT="${FM_STATUS_OUT:-$FM_HOME/state/fleet-status}"
PI_HOST="${PI_FLEET_HOST:-http://192.168.0.100:8765}"
mkdir -p "$OUT"
SNAP="$FM_HOME/bin/fm-fleet-snapshot.sh"
if [ -x "$SNAP" ]; then
  "$SNAP" --json > "$OUT/$CLASS.json" 2>/dev/null || printf '{}\n' > "$OUT/$CLASS.json"
else
  printf '{}\n' > "$OUT/$CLASS.json"
fi
curl -sS -X POST --data-binary "@$OUT/$CLASS.json" "$PI_HOST/ingest/$CLASS" >/dev/null 2>&1 || true
