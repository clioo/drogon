# WP-CAP-BOTS first test-port wave

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Allocation: all four files in
`WP-CAP-BOTS` from `parity-test-work-packages.json` (manifest SHA256
`e1ffc0deee15b2b8ae0a7a0ca91ef624384b3903d7c92f2606df423282e83d9a`). No
product implementation, dependency install, service, credential, publication,
recipe, root manifest, lockfile, or Git mutation was performed.

## Outcome

All **4/4 original suites** now have actual assertion-preserving artifacts under
`tests/parity/ports/WP-CAP-BOTS/`. Together they preserve **52 original test
cases, 100 lexical `expect(...)` call sites, and 138 assertion evaluations**
(including the 12-row reactive validation table, its three assertions per row,
the four-value timeout loop, and the three-row UI fallback table).

The complete package index is
`tests/parity/ports/WP-CAP-BOTS/assertion-binding-map.json`; detailed per-case
maps are beside each port. Normalized diffs for the three parent ports exited 0
after allowing only provenance comments and import-only seams. The child-owned
responsibility test is byte-identical to source, SHA256
`f4ae1f7e05c58cb3019c61777b0599821243535c378bb420b13c11e582edef6f`.

None of the four suites is candidate-bound. Candidate search found no Bot
service, reactive dispatch, IPC schema, shared Bot contract, or BotsPage module
in `apps/` or `crates/`; the current renderer explicitly says Mentu and Bots are
not connected. The BotsPage runner is additionally blocked because the current
installed candidate test environment has neither `happy-dom` nor
`@testing-library/react`. These are setup/import failures with zero executed
cases, therefore **not behavioral RED**, not skips, and not passes.

## Suite ledger

| Original suite | Cases / assertion evaluations | Port | Binding verdict |
| --- | ---: | --- | --- |
| `bot-reactive-dispatch.test.ts` | 29 / 92 | `reactive-dispatch/bot-reactive-dispatch.contract.test.ts` | missing `apps/desktop/src/main/bots/bot-reactive-dispatch.ts` |
| `bot-responsibility-owner.test.ts` | 11 / 25 | `responsibility-owner/src/main/bots/bot-responsibility-owner.test.ts` | entire responsibility-owner import closure absent |
| `bot-schemas.test.ts` | 3 / 6 | `bot-schemas/bot-schemas.contract.test.ts` | missing `apps/desktop/src/main/bots/bot-schemas.ts` |
| `BotsPage.test.tsx` | 9 / 15 | `bots-page/BotsPage.contract.test.tsx` | missing component/contract and happy-dom/testing-library harness |

The two retained source baselines were reused rather than reopened as audit
census work: `bot-reactive-dispatch` passed 29/29 and
`bot-responsibility-owner` passed 11/11 under the existing Node 24.19.0 /
Vitest 4.1.11 receipt in `source-regression-node-20260906.json`. No established
baseline receipt exists for `bot-schemas` or `BotsPage`; retained audit records
describe their bodies as read but not run. Static review also shows several
BotsPage assertions no longer align with the pinned source form labels/preset
behavior; without an admitted run, that is a caution, not a behavioral verdict.

Exact candidate commands and results are in
`tests/parity/ports/WP-CAP-BOTS/execution-evidence.json`. All four used the
installed Node 24.19.0 binary and candidate Vitest 5.0.0. The three Node suites
failed module collection with exit 1 and zero tests; BotsPage failed worker
startup on missing `happy-dom`, exit 1 and zero tests.

## Child orchestration and review

The required depth-two cycle ran through Orca Run `run_09a5518e819c`, child
Task `task_5e3bd9a8cab6`, Dispatch `ctx_14d31e59ef4c`, depth 2. A fresh Claude
Code 2.1.263 terminal was launched per invocation as
`claude --model claude-sonnet-5 --effort medium --dangerously-skip-permissions
--name cap-responsibility-owner`; process inspection matched that argv, and
`worker-read` returned a verified Claude transcript source. The child completed
successfully and sent exactly one `worker_done`.

Independent parent review read all three child files and all 324 source test
lines, compared the frozen port byte-for-byte, validated the 11-case map, read
the exercised source behavior, and reran collection with Node 24.19.0. That run
confirmed `ERR_MODULE_NOT_FOUND`, exit 1, zero tests. The first `worker-release`
correctly reported the custom terminal as external with no process action; the
parent then closed that exact terminal (`ptyKilled: true`), repeated
`worker-release` to a final `released` receipt, and acknowledged the child
delivery, so no child remains live or owned.

One child-process deviation is explicitly rejected from acceptance evidence:
the child independently reran the old source suite with ambient Node 26 despite
the instruction to reuse the existing receipt, and Vitest updated the ignored
legacy cache file
`/Users/carlos/Documents/Drogon-mentu-session/node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`.
Tracked legacy source stayed unchanged (only the pre-existing untracked Mentu
plan is reported by Git), but the reference was supposed to remain read-only.
This report does not use that rerun; the pre-existing Node 24.19.0 receipt is the
only source-baseline evidence admitted here. The cache is left untouched rather
than making another out-of-scope write.

## Gate status and next milestone

- Audit closure: **11/12 = 91.7%**, medium confidence, change **+0**. E5
  publication/resources/services remain held.
- Test migration: **4/4 suites frozen**, but **0/4 candidate-bound**, **0/4
  behavioral RED**, and **0/4 GREEN**. This is preparation, not acceptance.
- Product fidelity: **0/4 proven** for this package; no candidate behavior ran.
- Next closure milestone: root accepts the maps/ports, chooses reviewed
  candidate contract locations, and supplies the missing renderer test harness
  before any implementation begins.
- Flexible 24-hour full-fidelity deadline risk: **high**; no defensible full
  parity ETA follows from this port wave.
