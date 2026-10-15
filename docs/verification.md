# Verification status

## Native macOS app

Run `swift test` for the native core suite and `xcodebuild -project Shipcat.xcodeproj -scheme ShipcatPet -configuration Debug -sdk macosx CODE_SIGNING_ALLOWED=NO build` for the app build. The Swift suite passed 26 tests in four suites. The app built successfully, and running its `--render-test` path asserted window style/level/Spaces properties and generated `/tmp/shipcat-pet-render.png` (15,958 bytes). The snapshot was inspected as an in-app render, not captured from the screen.

The Release build was also verified as a product: `ShipcatPet.app/Contents/Resources/ember.png` is byte-identical to the committed `App/Assets/Ember/ember.png` (SHA-256 `1eb1c514c7b925246902dadb249872fa0ecc8dc29ccd3f012dde1305f3ec9810`), so the sprite reaches the bundle, and six consecutive `--render-test` runs produced byte-identical renders (SHA-256 `c9732f648fd1970c93b550f27e34944036a625b1e5a52ed70b8ba707523b8a98`), so render measurement is reproducible. The pupils measure 13 green pixels under the margin-floor predicate (alpha > 200, green leads red and blue by >= 5) recorded in `App/Assets/Ember/PROVENANCE.md`; the floor is required because the background's anti-aliased blend against the coat otherwise counts as green.

The native suite uses fabricated records only. It covers the canonical dispatch and status wire shapes, all supported events, unknown-event ignore, secret-marker non-disclosure, complete and partial lines, malformed input, replacement/truncation, replay dedupe, multi-home identity, status-before-dispatch, and the two no-mistakes lifecycle findings: the pet's displayed state comes from the reducer rather than the last accepted event, and an absent or unrecognised `state` is ignored instead of resetting to `.idle`. Both findings are covered end to end through `PetLifecycleSource`, including the notification half: a re-dispatch or an unmappable state arriving in a later batch must not move the pet or produce a notification trigger. `EmberAssetTests` decodes the committed sprite and fails if the green pupils or the transparent background are lost. No real fleet ledger was read or written, and there is no network path in the native reader.

Not visually/live verified: actual desktop placement, Spaces/full-screen and multi-display behavior, accessibility in VoiceOver, user notification permission/delivery, Focus behavior, `SMAppService` login/logout, or a live ledger selected by a user. No screencapture was used. Signing, notarization, stapling, clean-user install, and actual release were not run; see [distribution prerequisites](distribution.md).

## Historical JavaScript adapter

Run `npm test` (Node.js 20+) for the legacy adapter validation suite. The suite uses temporary JSONL ledgers, fake HTTP pet servers, and generated plist text; it does not install Clawd or launch a background service. Its tests do not establish native app parity.

## Verified locally

- M1 reader/reducer behavior remains covered, including duplicates, reordered status input, and per-home task identity.
- M2 lifecycle mapping, one stable session per home/task, payload allowlisting, cleanup, duplicate updates, matching in-memory decision-key resolution, endpoint discovery, retry/backoff, bounded outage handling, and reader non-blocking behavior.
- M3 real CLI child-process end-to-end tests for two home ledgers, once/watch transitions, outage recovery, bounded retry attempts, checkpoint offsets across restarts, and clean SIGTERM shutdown; watch continues reading while the sink is unavailable.
- M4 plist XML escaping and output-path containment; service install writes only a plist and uninstall only prints guidance.
- M5 nudges are off by default and opt-in nudges respect their configured rate limit while preserving the payload allowlist.
- M6 package bin metadata, executable CLI, documented configuration, zero runtime dependencies, and the complete `node:test` suite. The opt-in live smoke script is not part of the test suite and was not run.

## Not verified live

- Clawd custom-agent registration, acceptance of the request against a running Clawd version/theme, actual alert visibility, pet motion, or real session cleanup.
- Any LaunchAgent load, start, restart, or uninstall behavior. Shipcat intentionally does not call `launchctl` or modify launchd state.
- Real Firstmate ledger files or any writes to Firstmate state. No live pet, OS notification, or telemetry was used.

Fake-server success proves only the legacy JavaScript adapter's local HTTP contract and payload construction. It is not evidence that Clawd or a selected theme accepts or visibly renders a state.
