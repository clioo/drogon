# Encrypted request-connection source baseline

## Result

The complete unchanged original `remote-runtime-request-connection.test.ts` passed **2/2**, zero failures/skips, on Node24.19.0 / source Vitest4.1.11 (darwin-arm64). This is original-source baseline evidence, not migrated Drogon behavior.

- Two RPCs reuse one real encrypted WebSocket, with authentication capability payload and response assertions.
- Aborting one pending request clears that request; a later request still succeeds on the same connection.

The test creates an ephemeral loopback server, throwaway keys and fixture credentials. No personal profile, external service or existing Orca session is involved. Original cleanup closes connections and the test server. Client and server share the crypto implementation: this is not an independent cryptographic audit.

## Admission and independent verification

The manifest pins33 complete source files plus the MIT license at source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Root reviewed the import/effect closure, including the error-export barrel's additional transport modules. Original assertions and imports were not rewritten. Already-installed ws8.21.3, tweetnacl1.0.3 and zod4.5.4 remain real implementations; their858 package files are bound by full-tree hashes.

Root independently reopened results and the receipt, checked pinned source/staged bytes and dependency trees, and verified the unchanged WP-ENG-SHARED allocation (46 packages /9037 files). Exact hashes, assertions, environment differences and nonce paths are in [the evidence record](remote-runtime-connection-source-baseline.json).

The transport wrapper now accepts optional zod only with an exact version and tree hash. Required ws/tweetnacl and all previous restrictions remain. **95/95 infrastructure tests** passed; these are separate fixture regressions, not95 original or product cases.

## Reproduce

Use Node24.19.0 with the existing source checkout and its installed Vitest:

```sh
node scripts/run-parity-baseline-capsule.mjs \
  --manifest tests/parity/baseline-capsules/remote-runtime-request-connection.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --execute \
  --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs \
  --approved-manifest-sha256 144d492abf17f09f41707621d24beade2675a9b06d652da58497dec970bae490 \
  --timeout-ms 30000
```

## Limits and next gate

Client cancellation is not proof that remote work stopped. General reconnect, dropped/half-open sockets, SSH/Tailscale, independent mixed-version negotiation, real runtime dispatch and packaged Electron remain unverified here. Shared-control reconnect suites require their own whole-closure admission. The minimal test configuration and child-only optional-native-peer exclusions are recorded explicitly.

Audit remains11/12=91.7%, delta0. E5 publication/provenance/service dispositions remain open. Astra is audit-only; actual Sol implementation leads and their approved workers follow complete source-audit acceptance. No product installation or lead launch occurred in this block.
