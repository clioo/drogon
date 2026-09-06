# Root review: Bots test preparation and first Sol cycle

2026-09-06. Accept the four files as **preserved test preparation**, not four
completed candidate ports. E5 remains open; technical work is authorized by the
separate user exception. T1–T4 and full fidelity remain required.

Root independently parsed source and prepared tests with the installed Babel
parser (TypeScript/JSX). After excluding import declarations and source-location/
comment metadata, all four program ASTs are identical. All four original file
hashes match WP-CAP-BOTS in the unchanged allocation manifest. The responsibility
test also matches byte-for-byte. This verifies preserved assertion bodies, not
that the new import targets exist or are architecturally approved.

The lead's count of 52 expanded cases/138 assertion evaluations is a static
enumeration, not executed candidate tests. Its index explicitly records zero
bound suites, zero behavioral RED and zero GREEN. Root reviewed the candidate
execution record and observed the lead's actual failed-collection output for
the three parent suites; missing modules/environment are setup failures, not
evidence of behavioral failure. No assertion-count increase changes audit 11/12.

## Required corrections and retained debt

- `portedSuites: 4` in the frozen index means bodies staged, not T2 accepted.
  Future progress consumers must use binding and execution status as well.
- Proposed `apps/desktop/src/main/bots/...` imports are not an architecture
  decision. Preserve pure TS validation/presentation where appropriate; durable
  ownership, execution and persistence belong to the Rust service. Do not build
  a duplicate stateful desktop Bot backend merely to satisfy old unit imports.
- Historical Node24 baselines cover reactive dispatch and responsibility owner.
  Schemas and BotsPage still need isolated original baselines. Source/form label
  differences require actual source execution, not changed assertions to get green.
- The child's ambient-Node26 test run in the read-only source wrote an ignored
  Vitest cache. Reject that run from admitted evidence; do not write there again
  to restore the cache. Use existing isolated capsule machinery.
- The child map's `transitiveTypeOnlyDependencies` includes runtime dependencies
  such as normalizeDrogonBot. Treat the grouping as an inaccurate label, not a
  safe basis for omitting runtime imports from a stage.

## Lifecycle acceptance is qualified

Actual Sol high led a real depth-two Claude Sonnet5 medium child through Orca,
with a completed report and independently compared output. That establishes a
working delegation cycle, not a flawless cleanup procedure. The lead's report
states that it manually closed the child after `worker-release` returned
retained/external. This violates the required retention handling; do not repeat
it or infer authority to close other retained terminals. Updated AGENTS.md
requires accepting retention, releasing before ack and never force-closing.

Root released the settled parent `ctx_fa4afa295bf9` using the documented command,
receipt `8c334701-f34b-4b24-9fc3-09ac0047787e`: retained/external, no process action.
Root then acknowledged `delivery_69b74767abc4`. No active authority remains on
that attempt. Independent UI/ENG Sol Tasks may proceed under the corrected
instructions; this is not blanket acceptance of test migration or product code.
