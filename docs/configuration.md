# Configuration reference

Shipcat has no runtime dependencies and reads the ledger read-only. Pass all paths and identities explicitly; it does not discover or write Firstmate state.

## Ledger options

- `--ledger PATH`: JSONL fleet-ledger file.
- `--home NAME`: project/home identity attached to reader records and used with the task ID to derive a stable pet session ID.
- `--interval-ms N`: `watch` polling interval, integer at least 10 ms (default 1000).

`status` needs only `--ledger` and `--home`; it outputs aggregate counts, not task descriptions or raw records. Optional `--checkpoint PATH` atomically stores the reader's byte offsets (source path, home, and offset), not ledger contents. A process restart replays the canonical ledger to rebuild the reducer, then updates the checkpoint; the current reader API does not seek from a saved offset.

## Pet options

- `--agent-id ID`: registered Clawd custom-agent identity; it is not a secret.
- Exactly one of `--endpoint URL` or `--runtime-json PATH` is required for pet commands. URLs must use loopback (`127.0.0.1`, `localhost`, or `[::1]`). Runtime metadata must identify `clawd-on-desk` and a valid port.
- The sink sends only the documented `agent_id`, `session_id`, `state`, and `event` fields. Payload state/event values are allowlisted. It uses bounded retry/backoff and does not block ledger reads.

## Optional nudges

Nudges are disabled unless `watch --nudges` is supplied. They repeat an active alert's same state/event only, never attach text, and are rate-limited by `--nudge-interval-ms` (1000 to 86400000 ms; default 300000). This is a repeated pet-state update, not an operating-system notification.

## Service artifact

`service install --output PATH` writes a plist only beneath the current repository directory. `service plist` prints XML unless an output path is supplied. `service uninstall --output PATH` prints manual guidance; it does not delete the file. No service command loads launchd or changes system/user service state.
