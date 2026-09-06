# Mobile relay stream original baseline

2026-09-06: **6/6 original tests passed**, no failures/skips, under Vitest4.1.11 / Node24.19.0 / macOS arm64. Seven exact pinned runtime/test files and the MIT notice were staged in a fresh capsule; root independently reopened all results and rechecked hashes. See `mobile-relay-stream-source-baseline.json` for command result, per-assertion names and evidence fingerprints.

All runtime imports were read before admission. The unchanged suite uses fake send/connection callbacks, deferred Promises, in-memory maps and pure binary/payload helpers. No socket, host, account, device, model or real application was invoked. The minimal Node configuration omits unrelated mobile React setup and collection/transform settings; it is not equivalent to the complete mobile test environment or a security sandbox.

The six cases exercise RPC error, connection-wait rejection, failed send, cancellation while queued, session clear before connection and a throwing error listener. They do not exercise a throwing **end** listener, successful server unsubscribe, method-specific receiver payloads, real reconnect or E2EE. S-M3's observed cleanup gaps remain explicit regression/correction obligations.

This is original source-baseline evidence, not Drogon behavioral RED/GREEN or product parity. All532 original mobile files and the complete9037 allocation remain. Audit unchanged at10/12 (83.3%, medium-low confidence).
