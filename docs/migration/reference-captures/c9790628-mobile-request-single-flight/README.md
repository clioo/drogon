# Original mobile-request-single-flight baseline

Five unchanged original cases passed; zero failed, pending or todo. Source c97906287bb7a390b25e2025b600d9fb3c25d9c3. Node24.19.0 / Vitest4.1.11 / macOS arm64; exit0, no timeout, strict count check accepted.

Manifest: tests/parity/baseline-capsules/mobile-request-single-flight.json. SHA256: be7ef86bf286285ddadf664223fa92b9df4334d0a6120d0b55df65c0fba274c7. Stage: /Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/audit-mobile-request-single-flight-rzSPmQ. Archived runner report, stage receipt and Vitest result JSON are the actual execution records, not synthesized assertions.

All runtime bodies read. In-memory WeakMap, deferred Promises and fake sendRequest only. RpcClient/RpcResponse imports are type-only and erased; no actual transport, filesystem, service or model calls. Minimal config is not a sandbox.

Original five cases, not candidate parity or mobile end-to-end. Latest-params-wins, synchronous throws and triggers during a trailing request are source contracts not separately asserted here.

Original bytes and MIT LICENSE were checked against both the read-only checkout and pinned Git blobs by the capsule runner. Assertions and imports were not changed. No installation, product-source edit or model inference occurred. Original mobile config differences are declared in the manifest and execution report; this is not evidence the original full mobile suite or candidate passes.
