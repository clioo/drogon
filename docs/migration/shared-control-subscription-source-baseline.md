# Shared-control subscription lifecycle — original baseline

Three whole original suites passed **11/11**, zero failures, skips or todos, using three bounded test workers, Node24.19.0 and source Vitest4.1.11. No original test imports or assertions changed. This is source baseline preparation, not candidate behavioral RED/GREEN or a product implementation release.

| Original suite | Cases | Evidence boundary |
| --- | ---: | --- |
| remote-runtime-shared-control-subscriptions | 5 | Established unsubscribe; close deferred during replay until the new subscription id; never-sent local close; replay failure before/after close. Sends and responses are spies, not a real server. |
| remote-runtime-shared-control-subscription-close | 2 | Retire original and successfully sent cleanup ids; do not retire an unsent cleanup id. No server acknowledgement is asserted. |
| remote-runtime-shared-control-keepalive-refresh | 4 | Short-RPC absolute deadline despite keepalives; opt-in refresh survives three simulated seconds; ordinary expiry; abort one pending request without disturbing its peer. Fake clocks, not remote-process cancellation. |

## Admission and verification

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only reference. Root read all three original suites and immediate implementations. The static runtime closure contains respectively30/32/30 files; every non-test module hash matches the already reviewed shared-control connection closure. No unresolved dynamic imports were found. Definitions imported indirectly include ws/tweetnacl/zod, but these test bodies do not open sockets, profiles, processes or external services. Keepalive tests restore their fake clocks.

Root independently reopened all result files and stage receipts: all11 case records passed. All36 distinct source/license files match the staged bytes, source checkout and pinned Git blobs. After execution, all858 dependency files and their links match the pinned package trees. Exact paths, hashes, assertions and configuration differences are in `shared-control-subscription-source-baseline.json`.

The original MIT notice, Copyright2026 Lovecast Inc., is retained in each capsule. The46-package/9037-file allocation is unchanged; these three suites still belong to WP-ENG-SHARED. No new coverage is claimed for previously accepted suites. One read-only inspection initially used the wrong transport-wrapper filename; file discovery resolved it without changing or rerunning any test.

## Reproduction

Run from the rewrite checkout with the existing reviewed runner. Each run creates fresh local evidence; it does not overwrite earlier receipts.

```sh
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-parity-baseline-batch.mjs \
  --batch tests/parity/baseline-batches/shared-control-subscription-lifecycle.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --concurrency 3 --execute --timeout-ms 30000 \
  --node-bin /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs
```

## Remaining obligations

These local fixtures do not establish actual reconnect delivery, server cleanup, native timing, SSH/Tailscale recovery, mixed-version behavior, or rewritten-product parity. Full original configuration equivalence is not claimed. In particular, three simulated seconds of opt-in refresh are not proof of indefinite stability, and client AbortError is not evidence that remote work exited. Preserve the separate execution-host liveness vocabulary and all original allocations during the Rust port.

Sol must preserve these assertions in the candidate port, demonstrate actual behavioral RED, then implementation and integrated GREEN, alongside the remaining full-scope fixtures. The original repository-wide shared-control boundary suite remains unadmitted: checking a partial staged tree would not prove its whole-tree import constraint.

Audit remains **11/12 =91.7%, delta0, medium source-characterization confidence**. E5 publication/provenance/service dispositions remain open; the complete source-audit gate still precedes actual Sol implementation leads. The flexible24-hour full-fidelity target remains high risk with no defensible ETA. Product code, installed preview, user data and source reference were not changed by this block.
