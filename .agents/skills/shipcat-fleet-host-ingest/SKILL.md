---
name: shipcat-fleet-host-ingest
description: Load before changing fleet-host/src/main.rs, /ingest/*, /data/*, HTTP handling, build output, or dashboard data fetches.
user-invocable: true
metadata:
  project: shipcat-bridge
---

# shipcat fleet host ingest

## Trigger

Load before changing `fleet-host/src/main.rs`, `/ingest/*`, `/data/*`, HTTP handling, build output, or dashboard data fetches.

## Scope

In scope: endpoint behavior; path validation; MIME/static serving; build non-destructive invariant; method/status code contract; loopback/exposure rule.

Out of scope: business generation of status payloads; Firstmate ledger parsing; native AppKit code.

## Core rules

- Preserve loopback default and explicit host rule (`main.rs:8`, `main.rs:64-67`, `main.rs:288-292`).
- Route all data writes through `handle_post` (`main.rs:119-151`).
- Keep build non-clobbering: `build()` may create directories and copy static assets only (`main.rs:69-79`).
- Test traversal, nested names, empty body, method, and unknown route cases (PR #8 live validation table).
- Keep asset fetch path mapping aligned (`assets/fleet-ui/index.html:2009-2016`, `index.html:2086`).
- Preserve `safe_name` validation: reject empty input, `..`, `/`, and `\` (`main.rs:55-62`), and confine writes to the configured output root (`main.rs:119-151`).
- Treat the host, not the sender, as the trust boundary for paths.
- Keep direct data mutation and class naming as they exist today; do not rename or restrict classes in a skill-only change.
