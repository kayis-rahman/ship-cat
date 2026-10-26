# Native macOS pet app contract

## Product

Shipcat is one native SwiftUI and AppKit application. It presents a floating desktop pet and a menu-bar control. There is no Go daemon, IPC layer, Clawd dependency, or network client. Minimum supported OS is macOS 14.

The pet communicates lifecycle state only. Task names, summaries, status text, decision keys, and other ledger content never appear in the pet UI, notifications, accessibility labels, or logs. Notifications are opt-in and never repeat. Login at launch is controlled through `SMAppService`.

## Discord unread indicator

The optional Discord indicator is a read-only consumer of one explicitly selected Firstmate `fm-inbox.sh` command. Shipcat runs only that executable with the fixed arguments `receipts --all-pending --all-handled`, clears its inherited environment, and bounds stdout to 1 MiB. Refreshes occur every five seconds while the app is running. The user must select the command; Shipcat does not discover Firstmate paths or read `.env`, Discord spool files, tokens, or other state files.

The adapter accepts only `fm-inbox-receipts.v1`, rejects malformed, oversized, or omitted/truncated receipts as **Unknown**, and counts pending `discord-*` request IDs that are not acknowledged. In this schema, unread candidates are in `pending`; handled rows appear separately in `handled` and are never counted. A pending row marked `acknowledged: true` is also excluded defensively. It projects only the receipt `source` as sender and `at` as time. Message bodies and all other receipt content are not retained or displayed. The status-item count and existing pet accent ring react to unread receipts; the menu may list sender, time, and unread state only. No open, refresh, or UI action acknowledges a message. Handling remains exclusively in Firstmate's normal inbox flow. Shipcat never writes to the command, inbox, or receipts. Discord arrival does not use macOS system notifications; existing lifecycle notifications remain explicitly opt-in.

This is a deliberately narrow read surface, not an OS-enforced filesystem sandbox. Direct distribution runs as the logged-in user, so selecting a command does not itself enforce a file-level ACL. The command must be a trusted `fm-inbox.sh` path supplied by the user. A valid empty receipt list displays zero; any uncertainty displays Unknown rather than a guessed count.

## Interaction and prototype acceptance

- A borderless, transparent, floating pet window stays above ordinary app windows and does not activate the app when shown.
- The pet is not click-through: users can interact with it; its menu-bar companion offers show/hide, pause/resume animation, and quit.
- Animation reflects lifecycle only: idle, working, attention, and paused. The menu-bar item and pet expose descriptive accessibility labels without task content.
- **Lifecycle is expressed through shape, accent or tint only, never through text or props.** The pet is the Ember fox sprite (`App/Assets/Ember/ember.png`, provenance in `App/Assets/Ember/PROVENANCE.md`) and the lifecycle is carried by an accent ring and the pause dimming. Accessible labels stay outside the artwork.
- The app supports hide and pause independently. Closing/hiding the pet does not terminate the menu-bar app; Quit terminates it.
- Space/full-screen and multi-display behavior requires live macOS GUI verification before release.

## Data boundary

Consume only explicitly supplied ledger paths. Process canonical Firstmate v1 JSONL records read-only and only as complete lines. Support `task.dispatched`, `task.status`, `task.pr_ready`, `task.merged`, and `task.cleaned_up`; ignore unknown events. Scope task identity by home plus task ID. The optional Discord indicator uses only the separately selected, bounded receipts command described above. No network and no writes to Firstmate state. Board scope: Shipcat reads from the Firstmate home and makes no Firstmate project files; status data classes use separate refresh durations (live status 30s, snapshot 60s, backlog changes 5m, history hourly).

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

The superseded Path A charter is retained in [archive](archive/legacy-path-a-charter.md). Its Clawd M0 was not passed. See the [legacy bridge archive note](archive/legacy-js-bridge.md) for parity and archive disposition.
