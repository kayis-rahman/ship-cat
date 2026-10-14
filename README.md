# Shipcat Bridge

Local-only macOS adapter that mirrors Firstmate fleet-ledger task state to a desktop pet. It is ESM, targets Node.js 20+, has zero runtime dependencies, and uses `node:test`.

## Commands

Run `npm test` to execute all tests. The CLI is available as `shipcat` through the package `bin` entry, or directly with `node src/cli.js` in this checkout.

Each ledger command requires `--ledger PATH --home NAME`. Pet commands also require `--agent-id ID` and exactly one of `--endpoint http://127.0.0.1:PORT/state` or `--runtime-json PATH` (validated Clawd runtime metadata).

```sh
node src/cli.js once --ledger ./fleet-ledger.jsonl --home project-a \
  --agent-id custom-agent-id --runtime-json "$HOME/.clawd/runtime.json"
node src/cli.js watch --ledger ./fleet-ledger.jsonl --home project-a \
  --agent-id custom-agent-id --runtime-json "$HOME/.clawd/runtime.json" --interval-ms 1000
node src/cli.js status --ledger ./fleet-ledger.jsonl --home project-a
```

`once` submits the reduced current state and exits. `watch` tails complete ledger records and keeps reading while sink retries happen in the background; stop it with Ctrl-C. `status` prints text-free aggregate counts and never contacts the pet. Optional `--checkpoint PATH` atomically records reader byte offsets only. On restart Shipcat replays the canonical ledger to reconstruct reducer state, then refreshes the checkpoint. Options are listed by `node src/cli.js --help`.

Repeated alert nudges are off by default. Enable them only for `watch` with `--nudges`; set `--nudge-interval-ms` from 1000 to 86400000 (default 300000). Nudges repeat only the existing allowlisted pet state/event, never ledger text.

## Generated service artifact

`node src/cli.js service plist ...` prints a LaunchAgent plist, or `service install ... --output ./output/shipcat.plist` writes one beneath the current repository/output directory. `service uninstall --output ./output/shipcat.plist` only prints guidance. These commands never call `launchctl`, load a LaunchAgent, or modify system/user launchd state. The generated artifact is not live-verified.

See [configuration reference](docs/configuration.md), [milestone criteria](docs/milestones.md), and [verification status](docs/verification.md).

## Protocol and verification boundary

The mapper sends one session per `(home, task)`. The sink allowlists the documented Clawd custom-agent state/event values, sends only `agent_id`, a derived project/task `session_id`, `state`, and `event`, and applies bounded retry/backoff without blocking ledger reads. No prompts, summaries, titles, decision keys, secrets, or other ledger text reach pet payloads.

Integration coverage uses a local fake HTTP pet server. Live Clawd registration, endpoint acceptance, alert visibility, pet motion, and LaunchAgent operation remain unverified. Do not treat source inspection or fake-server tests as live Clawd proof.

For an explicitly authorized manual smoke against a registered local Clawd agent, set `SHIPCAT_AGENT_ID` (and optionally `SHIPCAT_RUNTIME_JSON`) and run `scripts/live-smoke.sh`. It sends only a synthetic working state followed by session cleanup. This script is opt-in, is not part of `npm test`, and was not run for this delivery.
