# Archived implementation note: legacy JavaScript bridge

This is a tag-ready archive note for Shipcat's former Path A adapter. The JavaScript package remains in `src/`, `test/`, and `scripts/` as a migration reference; it has not been removed and its history is intact. The native macOS app is the current product. Do not use this adapter as an app dependency or infer native app parity from its tests.

The former package targeted Node.js 20+, read a local Firstmate ledger, and mapped lifecycle records to a Clawd-on-Desk loopback `/state` endpoint. It provided the `once`, `watch`, and `status` CLI commands, an opt-in LaunchAgent plist generator, and optional repeated nudges. Those CLI, Clawd, LaunchAgent, and nudge features are retired from the native product scope.

## Tag-ready note

Once the parity checklist below passes and the captain approves archive disposition, tag the final JS-reference commit as `legacy-js-bridge-v1`. This is a note only; no tag is created by this change. Retain repository history and do not delete the JS tree until that gate is met.

## Parity checklist

- [ ] Contract-shaped fabricated fixtures cover canonical `task.dispatched`, `task.status`, `task.pr_ready`, `task.merged`, and `task.cleaned_up` events.
- [ ] The two canonical v1 shapes rejected by the old JS reducer (dispatched record and status record with top-level string `task`) are represented and accepted by Swift.
- [ ] Unknown event, unknown field, partial-line, malformed-line, replacement, truncation, duplicate replay, status-before-dispatch, and multi-home acceptance cases pass in Swift.
- [ ] A unique secret marker in status `text` is absent from every UI projection, notification, accessibility label, and captured log output.
- [ ] The native app builds and the full Swift suite passes; remaining live OS checks are explicitly documented.

The old JS reducer rejected actual canonical v1 record shapes, so this parity checklist is intentionally not complete. See `docs/verification.md` and `docs/native-app-contract.md` for current native implementation boundaries.
