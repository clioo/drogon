# Root review: provider-record boundary admission

2026-09-06, 17:39 UTC. The second Kimi delivery is not accepted yet. Root
reviewed provider-handle parsing, its numeric helper and record conversion
paths; Sol independently found the NEL issue before receiving root's review.
Correction remains delegated to the same Kimi terminal, now Task
`task_0970a0550c79 / ctx_afada235a4cc`, not a new concurrent worker.

## Concrete findings

1. `char::is_whitespace() || FEFF` is not JavaScript trim: Rust includes NEL
   U+0085, while JavaScript leaves it intact. Node 24 checks confirmed leading
   and trailing NEL unchanged, and leading FEFF removed. The candidate
   `is_handle_field` therefore rejects source-valid NEL-boundary strings.
   Reuse the exact existing `claim_identity::js_trim` instead of duplicating
   another character table. Root will handle minimal registration if needed.
2. `is_safe_integer` uses `i64::abs`; the minimum signed integer overflows.
   Replace this with a non-overflowing range comparison and prove malformed
   raw persisted numeric input cannot panic or pass erroneously.
3. Safe integer readers use `Value::as_i64`, which rejects the floating JSON
   representation of integral values such as `1.0` or `1e0`. Node 24
   `Number.isSafeInteger(JSON.parse(raw))` accepts both and rejects raw
   `-9223372036854775808`. Validation, typed conversion and equality checks
   across handle fences, record fields and process identity must agree;
   checking only integer-constructed fixture values does not cover this.

These are code-review findings with executed JavaScript reference checks,
not claims that root ran a candidate reproduction. The leaf must first
reproduce the current candidate failures, then correct and rerun unchanged
assertions plus the new boundary regressions. No artificial defect is needed.
Source count 49 describes expectation sites, not necessarily dynamic assertion
evaluations. The prior deliberately wrong stub run demonstrates sensitivity,
not an observed defect in a real earlier production implementation.

Root guidance: `msg_4858386acfb9`; follow-up explicitly folds it into the
already-active correction rather than creating another Task. Shared files,
registration, database, RPC and commits remain root-owned. Current source
record hashes and historical reports remain unchanged evidence until the leaf
publishes its correction; no 45-case result establishes full session authority.

Audit remains 11/12 (91.7%, medium confidence, delta 0); E5 publication/resources
is the next audit closure milestone. Full-fidelity 24-hour delivery remains
high risk. Native record integration, lease/store policy and runtime tests are
still incomplete, not waived by this finite correction.
