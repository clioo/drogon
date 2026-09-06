# WP-CAP-BOTS missing source baselines

Both previously unadmitted original suites now have complete isolated execution
outcomes at source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`:

- `bot-schemas.test.ts`: **3/3 passed**, no failure, skip, todo or setup block.
- `BotsPage.test.tsx`: **6/8 passed, 2/8 failed**, no skip, todo or setup block.

These are source results only. They do not establish candidate behavioral RED,
GREEN, implementation, architecture or parity. Machine-readable commands,
digests, lifecycle receipts and per-case outcomes are in
`docs/migration/sol-wave/cap-bots/source-baselines.json`; suite-level evidence
is under `tests/parity/ports/WP-CAP-BOTS/source-baselines/`.

## Denominator correction

Actual Vitest 4.1.11 execution expands `BotsPage.test.tsx` to **8 cases**, not
the prior static count of 9: its `it.each` table has three rows and the file has
five additional `it` calls. WP-CAP-BOTS therefore contains **51 original
cases**, not 52. This corrects enumeration only; the frozen test body and its
15 possible assertion evaluations are unchanged, leaving the prior package
assertion-evaluation enumeration at 138.

The first UI nonce stage, `wp-cap-bots-page-hCDjWw`, is retained but not
admitted because its manifest expected the incorrect count. The corrected
manifest produced fresh stage `wp-cap-bots-page-GicgDb`, whose 8 discovered
cases match the manifest.

## Schema baseline

The Kimi child used the reviewed capsule runner from the rewrite checkout, with
Node 24.19.0 and the legacy installation's exact Vitest 4.1.11 entry. The
runner verified every source byte against both the working reference and the
pinned Git blobs, staged a fresh closure, reverified it, and wrote its test
cache/results only inside `wp-cap-bots-schemas-otoIL4`.

All three unchanged cases passed: bounded create payload acceptance, refusal
of unsupported harness/undeclared fields, and responsibility trigger
semantics. `zod` 4.5.4 is the only imported external runtime. The accepted
transport helper also stages hash-pinned `ws` and `tweetnacl`; neither is
imported, and their presence is recorded as fixture overhead rather than
product behavior.

Independent parent review matched all manifest entries against source working
bytes, pinned blobs and staged bytes; matched the copied receipt/results to the
nonce stage; and parsed 3 passed, 0 failed/pending/todo. Passing proves the
schema parsing boundary only, not IPC registration, persistence or a candidate.

## BotsPage baseline

The parent staged the unchanged original test plus its exact Bot component,
UI primitive and shared runtime closure using the reviewed capsule runner.
React, React DOM and happy-dom use the existing renderer dependency helper;
six additional genuine installed packages are linked inside only the nonce
stage and bound by version, package metadata SHA-256 and full-tree SHA-256.
Node 24.19.0 invokes the pinned source Vitest 4.1.11 from the staged directory,
with a stage-local cache, results file and temporary directory.

The fixture preserves JSX, aliases, feature-wall define, Node worker flags,
timeouts, happy-dom annotation, OffscreenCanvas setup and MutationObserver
retention. It omits the unrelated host-port setup because every case injects
`loadSnapshot` and the source test hoists its store mock; running that setup
would add a temporary user-data and host/secret-store closure unrelated to the
assertions.

No media was copied. A fixture plugin maps unobserved `?url` imports to a
deterministic stage URL. The store target and uncalled session-launch boundary
are throwing placeholders; `getAgentLabel` preserves `codex → Codex`, but it
is called during rendering, so environment equivalence remains explicitly
qualified even though no original assertion observes that label.

The two reproducible source failures are concrete:

1. `keeps model selection at the harness default...` stops at line 80 because
   the test expects `model.value === "Harness default"`, while the pinned form
   renders an empty value (with a different placeholder). Later assertions in
   that case do not execute.
2. `does not invent a harness...` stops at line 92 because it queries the
   label `Display name`, while the pinned form exposes `Name (optional)`.
   Later assertions in that case do not execute.

The remaining six cases pass, including all three description-table rows,
empty state, responsibility routing and recoverable error. This is a source
behavioral failure, not a setup block and not candidate RED.

During the final integrity pass, the parent supplied `--check` to the fixture
runner; the runner has no dry-check mode, so it created verification-only nonce
stage `wp-cap-bots-page-UVxdVx`. That replay independently reproduced 6/8
passed and the same two failures. Its exact command and output/config hashes
are recorded in the machine-readable report; the admitted evidence remains
`wp-cap-bots-page-GicgDb`.

## Orchestration and safety

The sole child ran through Orca Run `run_d5e814165307`, Task
`task_ece5c72ecad1`, Dispatch `ctx_4bc2e9601d41`, depth 2. The observed fresh
OpenCode process used exact argv
`opencode --model kimi-for-coding/kimi-for-coding --auto`; Orca identified the
agent as OpenCode but reported `provider_unsupported` for transcript extraction,
so provider evidence is limited to that exact configured provider/model plus
the root-owned verified smoke stated in the assignment.

After independent review, `worker-release` ran before delivery acknowledgment.
Receipt `32de52ea-20eb-4bf9-b1cb-8fc11d7f5a6f` returned
`retained / external_terminal / processAction:none`; the terminal was not
manually closed. Delivery `delivery_92957bc477a7` was then acknowledged. The
child created no descendants.

The root-owned reference build at `.preflight/reference-build-Z1ylje` is named
only as existing reuse evidence; it was not used as a test input or working
directory and was not modified. The legacy source checkout stayed read-only
and reports only its pre-existing untracked Mentu plan.

## Gate status

- Audit closure: **11/12 = 91.7%**, medium confidence, delta **0**; E5 remains
  held.
- Test migration: both missing baselines are ready for root admission; across
  them, 11 cases executed, 9 passed and 2 failed. All four WP-CAP-BOTS source
  suites then have source outcomes, subject to root acceptance of this record.
- Product fidelity: no candidate behavior ran; no parity is proven.
- Next milestone: root accepts the evidence and corrects the package case
  denominator before choosing candidate contract locations.
- Flexible 24-hour full-fidelity risk: **high**.
