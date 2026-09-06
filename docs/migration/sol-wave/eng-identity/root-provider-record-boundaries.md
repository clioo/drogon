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

## Independent original-source oracle, 17:54 UTC

Root added and ran `scripts/verify-native-provider-source-boundaries.mjs`.
It reuses the admitted `eng-identity-provider-20260906-a1-p6nXh6` capsule,
checks the exact source manifest plus all six source/license entries, bundles
only allowlisted first-party inputs in memory, and rejects external imports.
The existing source esbuild 0.25.12 is used as the transformer; this local
verifier requires that retained capsule/runtime and is not portable CI evidence.

Node 24.19.0 execution produced 266 actual-source validator cases, 163 accepted
and 103 rejected, digest
`e942e2f26becdcf9d8a29418fc949aadb8f8dd76eddb9ec67be282dc18f323c0`.
Root additionally asserted selected outcomes for numeric schema version 2.0,
process PID 1.0, rejected minimum-i64 observation time, accepted NEL-boundary
handle and rejected FEFF-boundary handle. The command writes no files and
does not execute native candidate tests.

Use `--fixtures` to emit the bounded records including each `rawJson` string;
the default prints only the summary. Preserve those strings when replaying
through serde: a JavaScript parse/stringify round-trip would erase the numeric
representation cases. Besides the complete numeric field matrix, the oracle
covers selected Unicode/UTF-16 boundaries, unvalidated minimumNextFence, and
missing/null lease fields. This supplements, not replaces, the original suites.

Guidance `msg_f01878eea0f5` and one parent-terminal nudge assign candidate replay
to the current Kimi correction `task_496eabe1ef0c / ctx_16049bee8b80` under
Sol; its earlier 46-case result was not accepted as the numeric fix. No duplicate
worker was launched and no root-written candidate policy was substituted.
