# Root review: Bots test preparation and first Sol cycle

## Follow-up source evidence: 2026-09-06, 15:23 UTC

Root recomputed both source-baseline manifest and raw-result hashes, every staged
source/license hash and the corresponding read-only source bytes: schema 9 files,
BotsPage 25 files. Raw results confirm schema 3/3 and BotsPage 6 passed / 2 failed
out of 8. The old static 52-case package count is corrected to 51 in the binding
maps; original test bytes and assertion requirements are unchanged. The 138 count
remains a potential assertion enumeration, not assertions executed by failing cases.

Schema PASS establishes the pure parsing baseline only. BotsPage is qualified
fixture evidence, not full source-environment equivalence: the called Codex label
stand-in and deterministic asset URLs remain explicit limitations. Its first
failures concern model value versus placeholder and Display name versus Name
(optional); later assertions in those cases did not execute. Do not weaken the
frozen tests or regress the user's optional-name UX merely to turn this green.

The old BotsPage launcher ignored `--check` and ran another isolated test stage.
Sol-CAP now directs Sonnet to require explicit execution and test side-effect-free
validation/import plus truthful failure classification. That work is not accepted
yet. Baseline records are source-only; no candidate Bot implementation is admitted.

## Runner hardening review, 15:27 UTC: not accepted

Root read the new runner and CLI tests and reproduced two classifier defects
without executing a source suite: a SIGKILL/null-exit record with full-count JSON
returns `source_behavioral_failure`; a full-total record with one pending case
and two failures also returns that completed-result classification. Both must
remain incomplete/setup-block evidence, with observed assertion failures retained
separately. Total discovered tests alone is not proof of completion. The leaf's
test explicitly blessing pending cases does not establish correct behavior.

Root requested delegated Sonnet regression coverage for signals, missing exit
status, pending/todo and malformed JSON, with raw process errors retained and
timeouts distinguished from other signals. Guidance `msg_a7a5e3a7a934` plus one
terminal nudge was sent to the active Sol-CAP lead; actual receipt/correction is
not yet confirmed. No manual root/Sol runner fix or real UI rerun was performed.

The first reply output was lost by the lead's execution bridge; root repeated
the same correction in `msg_1673e02240ed` and identified this file as the durable
fallback. Root also verified the timeout signal with a 30ms owned Node24 child:
`status:null`, `signal:SIGTERM`, `error.code:ETIMEDOUT`. The leaf's intermediate
claim that Node cannot distinguish timeout except by elapsed-time heuristics is
incorrect; use the actual error code and preserve raw diagnostics.

## Earlier preparation checkpoint

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
