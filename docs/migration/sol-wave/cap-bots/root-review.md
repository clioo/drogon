# Root review: Bots test preparation and first Sol cycle

## Final runner acceptance: 2026-09-06, 16:29 UTC

Root accepts the bounded baseline runner after independent 91/91 regression
verification, complete review of the new normalization/file-fixture cases and
the final Sol report. The actual execution path uses the reviewed helpers;
filesystem read, JSON parse and schema errors retain distinct diagnostics and
cannot become completed source results. Earlier signal/count/pending rejections
are covered. This supersedes the partial runner-safety acceptance below only.

The original manifest, historical evidence and three stand-in hashes remain
unchanged, independently rechecked at 16:21 UTC. Schema 3/3 and qualified
BotsPage 6/2 source outcomes are retained unchanged. No candidate behavior was
tested by these 91 runner tests; no full source-environment equivalence is claimed.

The settled Sol parent transferred to native input Task `task_d43ff0348684`,
Dispatch `ctx_6fafe36da2ca`, on the exact existing Sol terminal before delivery
acknowledgment. Root verified its actual Sonnet child `ctx_0ff3cf03977e`, depth 2,
ready/input accepted in the assigned rewrite checkout. Sol supervises only.
The current native validation work does not edit this accepted baseline tree.

## Runner acceptance checkpoint: 2026-09-06, 15:58 UTC

Root independently ran the delivered focused Vitest 5 suite with Node24:
60/60 passed, zero failures. Signal, missing exit, timeout, pending/todo and
incoherent count regressions now reject incomplete runs; this supersedes those
specific earlier rejections below. Root recomputed the manifest, historical
evidence and all three stand-in hashes; all five match the lead's preserved
digests. No real source `--execute` replay or candidate Bot test was performed.

One remaining report-boundary gap is not covered by these passing tests:
`runExecute` maps parsed `testResults`/`assertionResults` without checking their
shape before recording process evidence. Valid JSON with object-valued arrays or
null entries can throw; unreadable result paths also escape the parse helper.
This fails closed, but loses the structured diagnostics the runner promises.
Sol-CAP follow-up Task `task_7f202b64e510` delegates the narrow normalization and
regression fix to Sonnet; root/Sol do not edit the worker-owned runner. Historical
6/2 source results remain untouched and are not candidate GREEN.

The completed parent was released before acknowledgment; Orca returned
retained/external with no process action. Runner safety acceptance is partial,
not full source-environment equivalence or a product fidelity milestone.

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
# Native parser review — 2026-09-06, 16:49 UTC

The native parser is not accepted yet. Root inspected the current implementation
and returned these corrections to the same Sonnet leaf via Sol, without parent
manual implementation (`msg_45b904edc784` and accepted terminal nudge):

- Rust `str::trim` differs from ECMAScript trim; reuse the existing native
  `claim_identity::js_trim`, not another approximate whitespace table.
- The inclusive `u64::MAX as f64` timestamp bound rounds to 2^64 and permits a
  saturating cast that changes the source value. Preserve finite nonnegative
  source numbers without imposing an unsupported safe-integer constraint.
- Unknown object keys are input too; diagnostic paths must not echo arbitrary
  user-controlled keys containing sensitive content.

Root independently executed the actual pinned source parser in memory from the
previously admitted isolated `wp-cap-bots-schemas-otoIL4` capsule. Ten source/license
hashes matched; all three bundle inputs were manifest-listed; the sole external
import was staged Zod 4.5.4. No bundle/file writes or reference-cwd execution.
Source trim removed U+FEFF, retained U+0085, U+001C and U+200B. Source timestamps
preserved 0, 0.5, 2^64-2048, 2^64, 2^64+4096 and Number.MAX_VALUE.
These findings require source-derived regressions before native acceptance;
they are not evidence that the candidate corrections are complete.

Root provisionally registered `drogon_core::bots::input` for actual public-library
tests, exposed the existing trim function only within the core crate, and exported
the shared known-ID catalog from `drogon_harness`. Root owns these registration
files; the leaf retains input implementation/tests/evidence and catalog files.
Recognition remains separate from `HarnessId::ALL` (four launchable variants).
There is no RPC, Bot execution, persistence or installed-capability claim.
