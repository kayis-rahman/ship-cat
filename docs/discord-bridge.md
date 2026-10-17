# Discord bridge prototype boundary

`src/discord-bridge.js` is an isolated protocol/queue prototype. It is not wired into Shipcat or a live Discord connection. The native macOS app remains a network-free, read-only ledger consumer.

`EventQueue` persists synthetic or caller-supplied validated event records and deduplicates by event ID. `createBridgeServer` exposes only authenticated pull and acknowledgement routes; its default bind address is loopback. It requires a long token and deliberately has no Discord credentials, Gateway client, bot API, deployment unit, or internet-facing configuration. Do not bind it to a public interface. A private-network deployment still requires separately reviewed transport and secret provisioning.

`MacPuller` demonstrates outbound pull, schema validation, stable inbox request IDs, and acknowledgement only after handoff. Its inbox, audio-fetch, and transcriber functions are injected boundaries, not live integrations. Voice tests use a stub transcriber only. The caller must provide a local MLX implementation; there is no hosted fallback. Temporary audio returned by `fetchAudio` is removed after success or failure.

Run `npm test` for isolated tests. Tests use local loopback and synthetic events only. No credentials, real Discord requests, live services, or external network access are involved. This prototype does not implement production TLS, Discord allowlist policy, durable cursor recovery across queue compaction, or MLX/FFmpeg integration; those require separate implementation and review before deployment.
