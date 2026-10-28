---
name: shipcat-fleet-status-classes
description: Load before changing scripts/fleet-status-send.sh, config/fleet-ui-host.json, launchd fleet-status-send plists, or adding a status data class.
user-invocable: true
metadata:
  project: shipcat-bridge
---

# shipcat fleet status classes

## Trigger

Load before changing `scripts/fleet-status-send.sh`, `config/fleet-ui-host.json`, `launchd/com.shipcat.fleet-status-send.*.plist`, or adding a status data class.

## Scope

In scope: sender script; per-class files; env defaults; LaunchAgent structure and cadences; stable installed script path; config/plist synchronization.

Out of scope: host HTTP internals; sensor payload contents; Firstmate task creation.

## Core rules

- One class, invocation, output file, and cadence per status class (`scripts/fleet-status-send.sh`, lines 3, 5, 10, 19; `config/fleet-ui-host.json`, lines 8-19; sender plists).
- LaunchAgent `ProgramArguments` must point to `/Users/kayisrahman/.local/bin/fleet-status-send.sh`, never the repository path (`launchd/com.shipcat.fleet-status-send.*.plist`, line 12).
- Update config `data_classes` and `cadences` and plist `StartInterval` in the same change.
- Keep curl failures ignored and the snapshot helper optional and non-fatal (`scripts/fleet-status-send.sh`, lines 10-19).
- Validate plists with `plutil` and extract `StartInterval` before claiming completion.
- Preserve env defaults: `FM_HOME`, `FM_STATUS_OUT`, `PI_FLEET_HOST`.
- `history_hour` is used by the sender plist/config cadence while `history` is the data_classes key; treat this as an unresolved naming inconsistency and do not rename one side without updating sender, config, plist, and host consumers together.
