# Shipcat milestones

All milestones remain local-only, Node.js 20+, ESM, zero-runtime-dependency, and tested with `node:test`. Ledger content is private: only home/task identity and documented pet state/event values may reach the pet endpoint. Live Clawd behavior is not assumed from fake-server tests.

## M3 - CLI

- Provide `shipcat once`, `shipcat watch`, and `shipcat status` for an explicitly selected JSONL ledger and home identity.
- `once` reads available records, reduces them, maps current tasks, and submits to the configured local pet endpoint; `watch` repeats without waiting for sink retries; `status` prints a text-free aggregate summary.
- Validate arguments, support `--help`, and keep reader/reducer APIs unchanged. Exercise commands end-to-end with temporary ledgers and a fake HTTP pet server.

## M4 - Resident service artifact

- Generate a user LaunchAgent plist from explicit CLI configuration; output is printed or written only beneath the selected repository/output directory.
- Provide install/uninstall guidance commands that never invoke `launchctl`, install system files, or start a resident process. Test XML escaping, arguments, and output-path containment.

## M5 - Notifications/nudges

- Keep repeated alert nudges off by default. An explicit `--nudges` option may repeat only the existing allowlisted alert state/event for an active alert, at a bounded configurable interval.
- Never include decision keys, ledger text, or task descriptions in a nudge. Test opt-in, default-off behavior, rate limiting, and payload allowlisting against a fake server.

## M6 - Packaging and docs

- Expose the CLI through a package `bin` entry without runtime dependencies; document commands, configuration, generated service-artifact behavior, and safe operation.
- Record what fake-server tests verify and what requires a live Clawd run. Run the full Node test suite; do not install Clawd, load a LaunchAgent, push, or open a PR.
