# Original mobile-runtime-capability-negotiation baseline

Five unchanged original cases passed; zero failed, pending or todo. Source c97906287bb7a390b25e2025b600d9fb3c25d9c3. Node24.19.0 / Vitest4.1.11 / macOS arm64; exit0, no timeout, strict count check accepted.

Manifest: tests/parity/baseline-capsules/mobile-runtime-capability-negotiation.json. SHA256: 8454b3fc211d72cc12d948be7bca4cea0ddc9c33acefa8267f32907ef412629f. Stage: /Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/audit-mobile-runtime-capability-negotiation-d2lLbZ. Archived runner report, stage receipt and Vitest result JSON are the actual execution records, not synthesized assertions.

All runtime imports read through protocol-version, skill-install-capability and remote-server-update. Constants, arrays, Set/WeakSet, fake Promise requests and console warnings only. RpcResponse/UpdateStatus imports type-only and erased. No actual socket, host, filesystem, agent or model requests. Minimal config is not a sandbox.

Original five cases only. Two negative vi.waitFor assertions can pass before async settlement; do not count them as comprehensive stale-session fence proof. Actual transports marking ambiguous delivery, successful/explicitly refused advisory payloads, mixed hosts and candidate parity remain separate obligations.

Original bytes and MIT LICENSE were checked against both the read-only checkout and pinned Git blobs by the capsule runner. Assertions and imports were not changed. No installation, product-source edit or model inference occurred. Original mobile config differences are declared in the manifest and execution report; this is not evidence the original full mobile suite or candidate passes.
