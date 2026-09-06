# Pinned transport dependencies for source capsules

Test infrastructure only. This extends the accepted capsule runner so full original WebSocket/crypto suites can be admitted without substituting imports with mocks or modifying source assertions. It does not itself admit those suites or establish a working remote Drogon transport.

## Change and boundary

The existing renderer dependency resolver/linker/verifier was factored into `capsule-package-runtime.mjs`; the original renderer wrapper/API remains intact. A separate transport wrapper allows exactly `ws` and `tweetnacl`, both with explicit versions and complete package-tree SHA-256 fingerprints in the manifest. No arbitrary dependency names, unpinned declarations or combined renderer/transport mode are accepted.

The snapshot includes sorted relative paths and SHA-256 of every regular file. It rejects internal symlinks, non-files, depth over16, more than4096 entries or more than64MiB. Resolution checks the tree against the manifest; the stage receipt binds it; pre-execution verification checks the canonical dependency links, metadata and tree again. Existing receipt validation, original-source/license checks and immutable result paths remain active. Old capsules without transport declarations keep the same behavior.

The runner links already-installed package directories into only the new capsule. It never installs packages or changes those dependency files. Optional `bufferutil` and `utf-8-validate` peers are excluded using `WS_NO_BUFFER_UTIL=1` and `WS_NO_UTF_8_VALIDATE=1` for the child invocation only. The inspected ws8.21.3 source honors those guards. Node's built-in UTF-8 validation may still be used; this is not a claim of JavaScript-only implementation at every layer or native-addon/performance equivalence. No user-level environment setting changes.

Current read-only dependency preflight:

| Package | Files | Bytes | Package-tree SHA-256 |
| --- | ---: | ---: | --- |
| ws8.21.3 | 19 | 150929 | aad13c0d5b988c454b067e8f6d9d0e8ed938293ec60989a2207cf8614ef9a4a0 |
| tweetnacl1.0.3 | 11 | 174912 | 79d76ce10a07a02d66cba99b0f11b00724e8095e0a5004ed62c8bc2f43183793 |

These hashes bind the observed installed trees; they are not package publisher attestations or authorization to execute an unreviewed source closure. The runner remains a guardrail, not a security sandbox: reviewed code and linked dependencies can have effects. Host-platform behavior, dependency mutation races after verification, process-tree cleanup and real remote-service boundaries still need their own evidence.

## Verified regressions

- **94/94** Vitest5.0.0 infrastructure cases passed under Node24.19.0: unchanged renderer7, capsule-runner73 (including two added transport integration cases), and transport14. The integration fixture verifies both child invocations receive the explicit environment and that transport state cannot be stripped from a receipt.
- **11/11** existing batch-coordinator cases passed using their actual `node:test` runner. An initial mixed invocation incorrectly sent this file to Vitest, which rejected it with “No test suite found”; that failed command is not a passing suite. Correctly routed reruns passed without weakening tests.
- The unchanged previous four original capsules passed **18/18** again under source Vitest4.1.11/Node24.19.0 with concurrency3. This is a compatibility rerun, not18 additional unique original cases. Exact new nonce roots and results are in `transport-capsule-regression.json`; the earlier directories were preserved.
- Actual source-installed ws/tweetnacl trees resolved and matched their observed30 files. No original encrypted connection/reconnect test has run yet in this block.

The regression commands use `node .../vitest/vitest.mjs run` for the three Vitest files and `node --test scripts/run-parity-baseline-batch.test.mjs` for the batch tests. All test fixtures are disposable directories owned by those tests. No user repositories, profiles, running Orca terminals or services were removed or restarted.

## Next action and phase

Finish reviewing the whole import/effect closure for original `remote-runtime-request-connection.test.ts` and the shared-control reconnect suites. Admit each complete file with its real dependencies, loopback-only server/cleanup behavior and explicit config differences; then run and independently inspect results. Do not call this infrastructure pass encrypted-transport acceptance, SSH proof, test migration or product parity.

Audit remains11/12=91.7%, delta0; E5 rights/service decisions remain outstanding. Actual Sol leads still begin feature implementation after the complete source-audit gate. No product changes or preview replacement occurred; flexible24-hour risk remains high with no defensible ETA.
