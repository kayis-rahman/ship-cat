# Repository Guidelines

## Agent Skills & Critical Conventions

- Rust-only fleet host: implement fleet-host capability in `fleet-host/`; no Python or Node host in the fleet path.
- Host defaults to `127.0.0.1`; non-loopback binding requires explicit `--host` and a reviewed launch agent.
- `build` must not overwrite `data/*.json`; producer data is preserved.
- All ingest/file destinations must pass `safe_name`; test traversal and nested names.
- Per-class data files and cadences must be updated together across sender, config, and plists.
- LaunchAgents must point to `~/.local/bin/fleet-status-send.sh`, not the source tree.
- Host config JSON is not parsed by the current host; reconcile its diff with agent cadences.
- Keep dashboard fetches under `data/` or `reports/` so `fetchJson` mapping stays valid (`assets/fleet-ui/index.html:2009-2016`).
- Load `.agents/skills/shipcat-fleet-host-ingest/SKILL.md` before changing `fleet-host/src/main.rs`, `/ingest/*`, `/data/*`, HTTP handling, build output, or dashboard data fetches.
- Load `.agents/skills/shipcat-fleet-status-classes/SKILL.md` before changing `scripts/fleet-status-send.sh`, `config/fleet-ui-host.json`, `launchd/com.shipcat.fleet-status-send.*.plist`, or adding a status data class.
- Data-boundary and privacy rules remain in `docs/native-app-contract.md`; Shipcat reads Firstmate state read-only and makes no Firstmate project files.
- Verification: run `swift test`, `node --test`, and `cargo build` (in `fleet-host/`) before claiming host-related changes complete.
