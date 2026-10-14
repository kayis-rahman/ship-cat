# M0 protocol verification

## Scope and evidence

This document records static inspection of the public `rullerzhou-afk/clawd-on-desk` source at commit [`c52e2df6ff778bf85310166882c516385f2f6eab`](https://github.com/rullerzhou-afk/clawd-on-desk/commit/c52e2df6ff778bf85310166882c516385f2f6eab), inspected on 2026-10-14 using `gh-axi`. No Clawd installation or checkout was present locally. No request was sent to a running Clawd process, no pet or dashboard was observed, and no ledger data was captured. Static-source facts below are not live verification.

Labels:

- **Verified (source)** - directly stated by the cited guide or visible in cited source at the inspected commit.
- **Inferred** - a likely consequence of source behavior that has not been demonstrated live.
- **Not verified** - requires a running app, registered agent, ledger capture, or UI demonstration.

## Clawd custom HTTP `/state` contract

**Verified (source):** The custom-agent guide says registration creates a stable `agent_id`, display name, and enable switch; registration itself does not report activity. A user registers an executable through Settings → AI Coding Tools, then copies the agent ID and current state endpoint from its card. Custom HTTP agents are state-only and cannot use the permission approval protocol. [Guide: Custom HTTP Agent Integration](https://github.com/rullerzhou-afk/clawd-on-desk/blob/c52e2df6ff778bf85310166882c516385f2f6eab/docs/guides/custom-agent-http.md)

**Verified (source):** Clawd binds to `127.0.0.1`, selects an available port in `23333–23337`, and writes `~/.clawd/runtime.json`. Senders are instructed to read and validate `{ "app": "clawd-on-desk", "port": number }` for each new sender process instead of hard-coding a port. Missing/malformed runtime metadata or refused connections mean Clawd is offline; senders should fail open.

**Verified (source):** `POST /state` uses JSON. The guide requires a literal loopback authority (`127.0.0.1`, `localhost`, or `[::1]`, optionally with a valid port), no `Origin` header, exactly one `Host` and one `Content-Type` header, and JSON media type. `src/server.js` enforces unsafe local transport rejection before handing the request to the state route; it rejects an `Origin` or invalid host with 403, duplicate host/content-type with 400, and missing or non-JSON content type with 415. The route is `POST /state`. [Route server](https://github.com/rullerzhou-afk/clawd-on-desk/blob/c52e2df6ff778bf85310166882c516385f2f6eab/src/server.js)

**Verified (source):** Minimum body (all four values are strings):

```json
{
  "agent_id": "custom-nova-ai-0123456789ab",
  "session_id": "project-a",
  "state": "working",
  "event": "PreToolUse"
}
```

The `agent_id` must match a currently registered custom agent. `src/server-route-state.js` obtains registered custom IDs from `ctx.getCustomAgentIds()` and resolves the supplied ID; custom session IDs are namespaced as `<agent_id>:<session_id>` to avoid collisions with another custom agent or built-in agent. **Verified (source).** This ID check is an application registration gate, not a secret or cryptographic credential: the route source explicitly notes that local transport checks do not authenticate unrestricted processes running as the same OS user. This is a sample from Clawd's public integration guide, not a Firstmate ledger fixture.

**Verified (source):** Request body cap is 16 KiB. Unknown states return 400. The guide lists these common mappings (the active theme must support the selected state):

| Situation | `state` | Suggested `event` |
| --- | --- | --- |
| Session started or waiting | `idle` | `SessionStart` |
| Prompt submitted | `thinking` | `UserPromptSubmit` |
| Tool/model work running | `working` | `PreToolUse` / `PostToolUse` |
| Parallel/subagent work | `juggling` | `SubagentStart` |
| Work failed | `error` | `PostToolUseFailure` |
| Turn completed | `attention` | `Stop` |
| Informational alert | `notification` | `Notification` |
| Session ended | `idle` | `SessionEnd` |

Optional fields documented by Clawd: `cwd`, `tool_name`, `tool_use_id`, positive integer `source_pid` and `agent_pid`, positive integer array `pid_chain`, `platform`, `editor` (`code` or `cursor`), and boolean `headless`. Do not send prompts, tool input, files, secrets, or other conversation content. Clawd reports 200 for accepted payload, 204 for disabled/removed/unsupported custom ID, 400 for invalid payload/state, 403 for unsafe origin/host, 415 for bad content type, and 413 for a body over the limit. **Verified (source).**

## Session lifecycle, layout, and stale cleanup

**Verified (source):** The guide states that `SessionEnd` removes the session rather than leaving an idle card. Custom session IDs are namespaced by registered `agent_id` in the route implementation. The guide's optional `headless` field is described as excluding a background session from HUD/focus UI.

**Verified (source):** Clawd's session-HUD renderer has state chips for at least `thinking`, `working`, and `juggling`; this is source inspection only, not proof of visible rendering in a running HUD. The Dashboard and HUD behavior for five, ten, or twenty custom sessions was not tested. [HUD renderer](https://github.com/rullerzhou-afk/clawd-on-desk/blob/c52e2df6ff778bf85310166882c516385f2f6eab/src/session-hud-renderer.js)

**Verified (source):** `src/state-stale-cleanup.js` declares generic idle-session stale timeout 600,000 ms (10 minutes), working-state timeout 300,000 ms (5 minutes), and detached-idle timeout 30,000 ms (30 seconds). Working-like states there are `working`, `juggling`, and `thinking`; a timed-out working session is changed to idle, while ordinary stale sessions are eventually deleted. There are agent-specific exceptions and configurable values.

**Inferred, not live-verified:** The generic stale thresholds may apply to custom-agent sessions absent an agent-specific override. The cleanup source does not establish how a specific running Clawd installation's configuration or custom sessions behave over time. **Not verified:** stale session cleanup, session end removal, or UI display in a live app.

## M0 evidence still missing

- No live Clawd route/authentication check, custom-agent registration, manual POST, or pet-motion observation.
- No Dashboard or HUD test at five, ten, or twenty concurrent sessions; usable five-session rendering is unproven.
- No confirmation that an alert state is visibly available in the selected theme. If live work cannot demonstrate concurrency or alert state, the M0 decision gate requires stopping and proposing the AgentPet fork; this source-only follow-up does not satisfy that gate.
- No real Firstmate ledger records were captured. The sample payload above is protocol documentation, not a ledger record. No fixtures are added rather than fabricate records or touch protected state.

Accordingly, this is partial M0 protocol documentation only. Live proof remains blocked because no existing local Clawd installation or checkout was available, and this worker was instructed not to install or run Clawd.
