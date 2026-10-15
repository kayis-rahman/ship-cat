# Native macOS pet app contract

## Product

Shipcat is one native SwiftUI and AppKit application. It presents a floating desktop pet and a menu-bar control. There is no Go daemon, IPC layer, Clawd dependency, or network client. Minimum supported OS is macOS 14.

The pet communicates lifecycle state only. Task names, summaries, status text, decision keys, and other ledger content never appear in the pet UI, notifications, accessibility labels, or logs. Notifications are opt-in and never repeat. Login at launch is controlled through `SMAppService`.

## Interaction and prototype acceptance

- A borderless, transparent, floating pet window stays above ordinary app windows and does not activate the app when shown.
- The pet is not click-through: users can interact with it; its menu-bar companion offers show/hide, pause/resume animation, and quit.
- Animation reflects lifecycle only: idle, working, attention, and paused. The menu-bar item and pet expose descriptive accessibility labels without task content.
- **Lifecycle is expressed through shape, accent or tint only, never through text or props.** The pet is the Ember fox sprite (`App/Assets/Ember/ember.png`, provenance in `App/Assets/Ember/PROVENANCE.md`) and the lifecycle is carried by an accent ring and the pause dimming. Accessible labels stay outside the artwork.
- The app supports hide and pause independently. Closing/hiding the pet does not terminate the menu-bar app; Quit terminates it.
- Space/full-screen and multi-display behavior requires live macOS GUI verification before release.

## Data boundary

Consume only explicitly supplied ledger paths. Process canonical Firstmate v1 JSONL records read-only and only as complete lines. Support `task.dispatched`, `task.status`, `task.pr_ready`, `task.merged`, and `task.cleaned_up`; ignore unknown events. Scope task identity by home plus task ID. No network and no writes to Firstmate state.

### Lifecycle is a derived property

The state the pet displays is **derived, at a single boundary, from the reducer**. It is never read off the last accepted event, because the reducer's rules are deliberate and a raw event cannot express them:

- A `task.dispatched` is only an initial state. It must not erase a `task.status` seen earlier, even when the dispatch record is written after the status record (re-dispatch, multi-writer ledger, replay). The reducer already preserves the earlier status.
- An `attention` on any one task outranks a `working` on any other task or home. "Last accepted event wins" would let a late working hide an unresolved alert.

`PetLifecycleSource` in `Sources/ShipcatCore/LedgerReader.swift` owns this boundary: it tails the ledger, applies the reducer, and returns the displayed lifecycle. `PetController` (in `App/ShipcatPetApp.swift`) reads only that result. Notifications fire only when the displayed lifecycle actually moved.

### Unmappable states are ignored, not reset

A `task.status` record whose `state` is absent, null, or unrecognised carries **no** lifecycle (`LedgerEvent.lifecycle == nil`). Such a record must be ignored, which is what the retired Node adapter did (`src/pet-mapper.js` mapped an unknown lifecycle to null and left `task.status` untouched). It must not fall back to `.idle`, which would clear an active alert and make the pet drop from pink to blue.

Raw status text may contain sensitive information. Do not retain it in UI projections or emit it in logs or notification content. Test this boundary using fabricated records with a unique secret marker.

## Distribution

Direct Developer ID distribution, not the Mac App Store: sandbox disabled, hardened runtime enabled, notarize with `notarytool`, and staple a DMG or ZIP. Signing and notarization commands must be documented and dry-run verified, not executed without the captain's certificate and Apple credentials.

## Historical scope

The superseded Path A charter is retained in [archive](archive/legacy-path-a-charter.md). Its Clawd M0 was not passed. The legacy JS tree remains reference until the parity checklist passes; no history is deleted.
