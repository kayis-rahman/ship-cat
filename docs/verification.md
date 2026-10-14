# Verification status

Run `npm test` (Node.js 20+) for the local validation suite. The suite uses temporary JSONL ledgers, fake HTTP pet servers, and generated plist text; it does not install Clawd or launch a background service.

## Verified locally

- M1 reader/reducer behavior remains covered, including duplicates, reordered status input, and per-home task identity.
- M2 lifecycle mapping, one stable session per home/task, payload allowlisting, cleanup, duplicate updates, matching in-memory decision-key resolution, endpoint discovery, retry/backoff, bounded outage handling, and reader non-blocking behavior.
- M3 `once`, `watch`, and `status` command behavior against temporary ledgers and a fake pet endpoint; watch exits cleanly on SIGINT.
- M4 plist XML escaping and output-path containment; service install writes only a plist and uninstall only prints guidance.
- M5 nudges are off by default and opt-in nudges respect their configured rate limit while preserving the payload allowlist.
- M6 package bin metadata, documented configuration, zero runtime dependencies, and the complete `node:test` suite.

## Not verified live

- Clawd custom-agent registration, acceptance of the request against a running Clawd version/theme, actual alert visibility, pet motion, or real session cleanup.
- Any LaunchAgent load, start, restart, or uninstall behavior. Shipcat intentionally does not call `launchctl` or modify launchd state.
- Real Firstmate ledger files or any writes to Firstmate state. No live pet, OS notification, or telemetry was used.

Fake-server success proves only Shipcat's local HTTP contract and payload construction. It is not evidence that Clawd or a selected theme accepts or visibly renders a state.
