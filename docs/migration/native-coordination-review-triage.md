# Native coordination design review triage

Root review of the independent Muse assessment of `a9b66bf`, against product
baseline `252de85c`. Design review only: no production defect or passing runtime
test is established by this record.

## Accepted as decisions needed before implementation

- Complete typed actor resolution, restricted method allowlist and CLI credential
  precedence. The existing server accepts only its service token; extending it is
  planned work, not a regression introduced by this documentation.
- Specify transaction-aware actor-bound receipt storage, request-show scoping and
  authorization before lookup. The design already requires these properties; the
  precise integration API remains a freeze prerequisite.
- Freeze the reserved dispatch/session/incarnation record and its spawn seam.
  Keep single-active-attempt gating across different request IDs as well as
  same-request replay. A new request ID must not bypass an ambiguous active attempt.
- Freeze mailbox schema/sequence, allocation/ACK/takeover transactions, the
  per-method mutation table, and worker environment/preamble fields.
- Preserve exact duplicate-report behavior and inspect the source's
  `settledByUnobservedPrompt` exception before deciding how it maps to Drogon's
  readiness evidence. Do not add that exception based on its name alone.
- Keep waits outside the lifecycle admission lock, retain receipts/fences while
  resources are unresolved, and state Windows runtime support separately from
  successful compilation. Do not add automatic history/receipt GC in this wave.

## Severity corrections and rejected findings

The report labels the first three integration gaps P0. Root does **not** accept
that severity: they are explicitly described, gated future changes, not a live
exploit or failing implemented coordination path. They remain mandatory design
decisions before production work. A worker holding the existing service token has
admin authority by definition; preventing scoped launches from receiving that
token is part of the new implementation, not behavior this branch already claims.

The Qwen-default NIT is rejected. The exhausted cloud Qwen token plan and the
user's independent DGX endpoint are different providers. The user explicitly set
`qwen3.8-flash-next-nvidia-nvfp4`; root verified the exact Pi default and the
endpoint's loaded model. Both benchmark arms must use that same local model.

The differing source and document commits are intentional: `252de85c` pins the
product under design, while `a9b66bf` adds the proposal. No product code changed
between those revisions. The native session/claim-identity slices are already in
the baseline; they are not still being implemented by parallel workers.

`orchestration.reset` and retired scheduler aliases are outside this first native
group, not removed from the full parity inventory. Their absence must remain
visible until implemented and separately accepted.

## Source-baseline gate correction

The first Sonnet store report preserved a useful map but ran no source tests and
only partially read one selected test file. Root rejected it as a completed
baseline gate. Its claimed absent-Vitest blocker was disproved by read-only
resolution of installed source Vitest 4.1.11 and esbuild 0.25.12; the capsule runner
accepts an explicit external test-library entry while keeping cwd/output isolated.
Node24's real SQLite builtin is also available. A fresh scoped follow-up uses the
same worker and checkout to execute those tests, preserving the prior artifact
and not treating digest checks or setup failures as behavioral evidence.

The review worker settled and release returned external-terminal retention with
no process action. Root read its complete report before acknowledging delivery.
Store/CLI source baselines and the final typed contract remain pending.
