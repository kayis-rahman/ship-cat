# Archived implementation note: legacy JavaScript bridge

This is a tag-ready archive note for Shipcat's former Path A adapter. The JavaScript package remains in `src/`, `test/`, and `scripts/` as a migration reference; it has not been removed and its history is intact. The native macOS app is the current product. Do not use this adapter as an app dependency or infer native app parity from its tests.

The former package targeted Node.js 20+, read a local Firstmate ledger, and mapped lifecycle records to a Clawd-on-Desk loopback `/state` endpoint. It provided the `once`, `watch`, and `status` CLI commands, `service install` and `service uninstall` guidance for an opt-in LaunchAgent plist, and optional repeated nudges. Its opt-in `scripts/live-smoke.sh` is not part of `npm test`. Those CLI, Clawd, LaunchAgent, and nudge features are retired from the native product scope.

## Tag-ready note

The parity checklist below is verified complete: every item is covered by the current Swift suite, and the Release app build passes, as recorded in `docs/verification.md`. The remaining gate is the captain's approval of archive disposition; once granted, tag the final JS-reference commit as `legacy-js-bridge-v1`. This is a note only; no tag is created by this change. Retain repository history and do not delete the JS tree until that gate is met.

## Parity checklist

- [x] Contract-shaped fabricated fixtures cover canonical `task.dispatched`, `task.status`, `task.pr_ready`, `task.merged`, and `task.cleaned_up` events. `LedgerModelTests.acceptsCanonicalRecords` accepts full contract-shaped records, `recognizesAllContractEventsAndIgnoresUnknown` covers every contract event while rejecting unknown kinds, and `LifecycleRegressionTests` drives the remaining three through the reducer.
- [x] The two canonical v1 shapes rejected by the old JS reducer (dispatched record and status record with top-level string `task`) are represented and accepted by Swift. `LedgerEvent` requires a top-level string `task` on every kind, and `acceptsCanonicalRecords` accepts both shapes.
- [x] Unknown event, unknown field, partial-line, malformed-line, replacement, truncation, duplicate replay, status-before-dispatch, and multi-home acceptance cases pass in Swift. The canonical fixtures carry unknown fields the parser ignores, and `LedgerReaderTests` covers the rest: `completeLinesPartialAndMalformed`, `replacementAndTruncationReplayFromStart`, `reducerDeduplicatesSeparatesHomesAndKeepsStatusBeforeDispatch`, and `malformedAndUnknownAreIgnored`.
- [x] A unique secret marker in status `text` is absent from every UI projection, notification, accessibility label, and captured log output. `statusTextNeverEntersModelOrLogs` asserts it, and `LedgerEvent` retains no property that can hold status text, so the UI, notification, and accessibility label the app builds from the model cannot carry it.
- [x] The native app builds and the full Swift suite passes; remaining live OS checks are explicitly documented. `docs/verification.md` records the suite, the Release build, and the "Not verified live" coverage.

The old JS reducer rejected the actual canonical v1 record shapes, so the checklist is measured against the native Swift implementation, which the full suite now covers. See `docs/verification.md` and `docs/native-app-contract.md` for current native implementation boundaries.
