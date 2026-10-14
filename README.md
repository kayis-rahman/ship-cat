# Shipcat Bridge

Local-only macOS adapter that mirrors Firstmate fleet-ledger task state to a desktop pet.

M1 provides a read-only JSONL fleet-ledger tailer with per-home offsets and a pure in-memory task reducer. M2 adds a lifecycle mapper and a non-blocking Clawd custom-agent `/state` sink with bounded retries. The sink sends only agent/session identity and allowed state/event values; it never forwards ledger text.

Run the test suite with `npm test` (Node.js 20+). Sink integration tests use a local fake HTTP pet server. Live Clawd registration, endpoint behavior, alert visibility, and pet motion remain unverified. No CLI, notifications, or launch services are included.
