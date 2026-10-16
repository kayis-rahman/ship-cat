# Shipcat milestones

## Native app milestones

The current milestones supersede the historical adapter plan. Native app acceptance and distribution are specified in [the product contract](native-app-contract.md) and [distribution guide](distribution.md).

- **M0 complete:** historical Clawd M0 marked NOT PASSED, Path A charter archived, native product contract recorded.
- **M1 complete:** Swift model for canonical v1 lifecycle events; unknown events ignored; fabricated dispatched/status fixtures and secret-text privacy test.
- **M2 complete:** read-only complete-line tailer and reducer with malformed/partial data, replacement/truncation, replay dedupe, multiple homes, and status-before-dispatch tests.
- **M3 complete:** SwiftUI/AppKit floating pet and menu bar controls, lifecycle animation, accessibility labels, and a launch-time window-property/PNG render assertion.
- **M4 implemented:** opt-in, non-repeating lifecycle notification flow and `SMAppService` login control. User permission and login-item behavior still need live GUI verification.
- **M5 complete:** Xcode app project, macOS 14 deployment target, hardened-runtime/non-sandbox entitlements, Developer ID DMG/notarization/staple script. Dry-run only; no Apple credentials or release operations used.
- **M6 complete:** native docs and legacy-JS parity checklist/archive note. Parity checklist verified complete; JS source/history retained pending the captain's archive-disposition decision.

## Historical Clawd adapter milestones

These Node.js milestones describe the superseded Path A implementation only. The original Clawd M0 was NOT PASSED: live route/registration/state, UI concurrency, and pet behavior were never verified. See [the archived charter](archive/legacy-path-a-charter.md) and [protocol evidence](protocols.md). Do not treat these milestones as the native app plan.

All historical milestones are local-only, Node.js 20+, ESM, zero-runtime-dependency, and tested with `node:test`. Ledger content is private: only home/task identity and documented pet state/event values may reach the pet endpoint. Live Clawd behavior is not assumed from fake-server tests.

## M3 - CLI

- Provide `shipcat once`, `shipcat watch`, and `shipcat status` for an explicitly selected JSONL ledger and home identity.
- `once` reads available records, reduces them, maps current tasks, and submits to the configured local pet endpoint; `watch` repeats without waiting for sink retries; `status` prints a text-free aggregate summary.
- Optional `--checkpoint PATH` atomically records byte offsets; restart reconstructs reducer state by replaying the canonical ledger and refreshes the saved offsets.
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
