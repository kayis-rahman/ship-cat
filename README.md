# Shipcat Bridge

Local-only macOS adapter that mirrors Firstmate fleet-ledger task state to a desktop pet.

M1 provides a read-only JSONL fleet-ledger tailer with per-home offsets and a pure in-memory task reducer. It is local-only and does not include pet integration, notifications, a CLI, or launch services.

Run the test suite with `npm test` (Node.js 20+).
