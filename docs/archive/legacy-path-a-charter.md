# Archived charter: Path A Clawd adapter

This file preserves the superseded product direction for historical reference. It is not the current Shipcat product contract. The captain replaced it with a native macOS pet app; the old work remains in the JavaScript tree until a parity checklist passes.

## Historical scope

The former charter selected Path A: a local-only Node.js adapter that reads Firstmate's opt-in append-only JSONL fleet ledger and sends allowlisted lifecycle state to a separately installed Clawd-on-Desk custom agent through its loopback HTTP `/state` endpoint. It required Node.js 20+, no network beyond that local Clawd endpoint, no writes to the Firstmate ledger, and no sensitive task text in pet payloads. A CLI, optional LaunchAgent plist generator, optional repeated alert nudges, and npm distribution belonged to that design. Native UI, Swift, and a standalone pet app were explicit non-goals under that charter.

## Historical M0 gate: NOT PASSED

The original Clawd M0 required live route/registration/state verification, a usable five-session UI review (with larger concurrency checks), manual pet update/motion evidence, and actual fixture validation before proceeding. These were not completed. `docs/protocols.md` records static-source research only and explicitly lists the missing live evidence. Later implementation and passing fake-server tests did not satisfy that gate. Do not claim the historical M0 passed, and do not resume its Clawd verification as a prerequisite for the native product.

## Disposition

Retain the JavaScript implementation and its history as migration reference until native parity checks are complete. Do not delete it as part of this archive. The current native product contract is in `docs/native-app-contract.md`.
