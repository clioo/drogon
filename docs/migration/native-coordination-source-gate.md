# Native coordination source gate

This records source evidence, not an implemented Drogon capability. The original
full parity inventory remains binding. Audit closure stays 11/12 (91.7%, medium
confidence); this gate does not close E5 or establish an overall product percentage.

## Accepted source evidence

Store baseline commit `a265ec1` preserves seven manifests and the per-case map in
`tests/parity/ports/WP-ENG-RUNTIME/native-coordination-store/`. Source revision:
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Existing Vitest 4.1.11 ran on Node
24.19.0 with isolated capsule working directories, never the reference checkout.

| Source family | Actual passing cases |
| --- | ---: |
| Dispatch capability | 2 |
| Run delivery | 9 |
| Task readiness | 8 |
| Dispatch races | 3 |
| Lifecycle guards | 19 |
| Message batch | 6 |
| Mutation receipt capacity | 4 |
| **Unique total** | **51** |

Root independently inspected the report, complete map and verification scripts,
reproduced all 717 manifest/license digest checks against the pinned source,
rehashed staged modules against their receipts, and examined all seven actual
Vitest result files and their assertion names. All 51 passed, with zero failures,
pending or todo cases. Repeated map references are not additional tests: nine
references identify seven distinct test files. The generated Node test config
does not import the reference project's application configuration.

The map retains exact capsule roots, manifest hashes and result counts. Private
stage/result files remain ignored; their absence on another machine must be
reported as unavailable evidence, not a reproduced PASS. Source baselines must
remain reproducible from the declared source pin and dependencies.

## What this does not prove

- No candidate Rust coordination implementation or behavioral RED is established.
- Gate, legacy sibling, federation and capacity assertions remain explicit port
  obligations even where the first native method group does not expose them.
- These seven files do not exhaust report duplication, stalled-prompt recovery,
  mutation identity or report/mail/receipt atomicity. Those source gaps are being
  evaluated before the final typed seam and candidate implementation.
- The baseline verifier's old comment about absent runtime, its repeated-file
  count and its claimed-but-unimplemented receipt cross-check require correction.
  Root verified the actual evidence separately; source hashing alone is not a
  behavioral test or a trustworthy execution-receipt validator.

## CLI recovery

The prior CLI worker process visibly ended while its shell remained live. A live
PTY was not treated as a live model. The assignment was abandoned without process
effects after exact lifecycle inspection refused ownership of that external
terminal. Partial manifests and failed capsules were preserved. A fresh instance
of the same approved GLM provider now owns only the unfinished CLI source baseline.

Its first retained capsule had zero executed tests because an import was missing.
That is setup failure, not behavioral RED and not evidence of an Orca defect.

Next: complete CLI source execution and the report/receipt gaps, freeze typed
contracts, establish executable candidate failures, then implement store/CLI and
integrate the engine. The installed verified preview remains unchanged until the
combined native, packaged and installed checks pass.
