# Native session authority — dependency slice 1 (provider record) — leaf report

- **Task**: `task_1cddc148cebf` (delivery) · **Review correction**: `task_409e1056b0a9` · **Acceptance correction**: `task_0970a0550c79` · **Root-review continuation**: `task_496eabe1ef0c` — **Dispatches**: `ctx_09689a2eb286`, `ctx_afada235a4cc`, `ctx_16049bee8b80`
- **Leaf**: sole approved non-OpenAI implementation leaf (OpenCode Kimi K2.7
  Code, `kimi-for-coding/kimi-for-coding`, per-invocation `--auto`)
- **Date**: 2026-09-06
- **Contract**: `docs/migration/native-session-authority-contract.md`
  (dependency slice 1 exactly: provider handle chain + schema-v2 record
  model + persisted-record admission/serialization + the one assigned record
  transition; lease acquisition/adjudication policy, the durable store, RPC,
  and callers are later, root-owned slices)
- **Source pin**: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
  (`/Users/carlos/Documents/Drogon-mentu-session`, read-only reference; never
  used as runner cwd, no Git commands run there)

## Scope of this slice (corrected per Sol review)

In production, `crates/drogon-core/src/session_authority/` now contains only:

- `provider_handle.rs` — port of `src/shared/agent-session-provider-handle.ts`:
  exactly `claude`/`codex` discriminants (unknown never impersonates Codex);
  JS-exact `JSON.stringify` key/root embedding (`claude:["sess","leaf"]`,
  `claude:["sess",null]`, `codex:"thread"`) with the ECMAScript escape matrix
  (`\b`/`\f` shorthands, lowercase `\u00xx` for other <0x20, DEL/U+2028/
  U+2029/non-ASCII verbatim); UTF-16 code-unit field bounds; JavaScript
  `trim` semantics by **reuse of the established
  `crate::claim_identity::js_trim`** (no local trim table remains in this
  module); link validation; append invariants with
  exact source error precedence; persisted-chain validation that replays
  append. Numeric fields extract through the single
  `json_safe_integer` path (below).
- `record.rs` — port of `src/shared/agent-session-record.ts`: full schema-v2
  model (execution location with host/WSL distro/workspace kind, pinned
  account home, provider options, launch args, full handle chain, lease with
  every optional recovery/settlement field, timestamps); all source
  validators with the exact null-vs-absent matrix; `launchArgs` bound on the
  exact JS serialization bytes; live-lease invariants; NUL-joined scope key;
  `admit_persisted_record` quarantining unknown versions as
  `unsupported_schema` and invalid v2 as `invalid_record`, raw value
  preserved, never rewritten. `minimumNextFence` is **not validated by the
  source lease validator**, so the port accepts the record and carries the
  raw persisted JSON value verbatim — non-integer data is neither rejected
  nor dropped; later-slice fence policy interprets it separately.
- `transition.rs` — only `record_agent_session_provider_handle` (the two
  admitted live vs new-owner-proving cases), ported from
  `src/main/runtime/agent-session-provider-handle-transition.ts`.
- `error.rs` — only the codes raised by the assigned surface:
  `agent_session_provider_handle_{invalid,provider_mismatch,stale_fence,forked,chain_overflow}`,
  `agent_session_stale_fence`, `agent_session_ownership_unknown`.

**Removed as out of scope (were in the first, unaccepted delivery):**
`admission.rs` in full (writer admission, CAS fence acquisition, restart
adjudication, process probes, spawn-token orphan classification, next-fence
policy) and the lease transitions reserve / commit process identity / prove /
renew / evict / set-handoff-stage / set-journal-checkpoint, with their tests.
Those exact source suites remain in `source-case-map.json` with honest
`pending_slice2_or_later` dispositions — **no claim is made that pure
coverage completed them**.

## Numeric extraction (root-review continuation, `task_496eabe1ef0c`)

Root review (`docs/migration/sol-wave/eng-identity/root-provider-record-boundaries.md`,
guidance `msg_4858386acfb9`) found two numeric defects; both were reproduced
as genuine candidate failures before correction and are preserved in the
bounded capture `red-round-numeric.txt` (separate from `red-round-stub.txt`):

1. **Panic**: `is_safe_integer` used `i64::abs`; raw persisted JSON
   `-9223372036854775808` parses as a plain `i64` and reached it, overflowing
   in debug builds. Reproduced: the regression test panicked at
   `core/src/num/mod.rs:451` pre-fix. Fix: range comparison
   `(-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value)` — never panics.
2. **Over-strict rejection**: safe-integer readers used `Value::as_i64`,
   rejecting integral spellings `1.0` and `1e0` that Node
   `JSON.parse` + `Number.isSafeInteger` accept (and rejecting exact
   boundary integers that serde_json stores as `u64`). Reproduced: three
   acceptance regression tests failed pre-fix on raw-JSON inputs.
   Fix: the single extraction primitive `json_safe_integer(&Value)` —
   `Number.isSafeInteger(JSON.parse(raw))` semantics over the parsed number:
   every JSON spelling (`1`, `1.0`, `1e0`) whose double value is an integer
   within ±(2^53−1) is accepted; fractions, magnitudes above the safe range,
   and `-9223372036854775808` are rejected. `minimumNextFence` raw
   preservation is untouched (the source validator ignores that field).

One consistent path now covers all persisted numeric fields: provider handle
fences/`observedAt` (parse + typed validation), record/lease fields
(`runtimeFence`, `leaseDeadlineAt`, `lastRenewedAt`, `createdAt`,
`updatedAt`, `processlessAt`), owner process identity (`pid`,
`processStartTimeMs`), journal checkpoint (`epoch`, `sequence`), death
evidence (`observedAt`), typed conversion, and the transition equality
comparisons (which operate on the typed values this path produces).

## Source counts (corrected)

- `src/shared/agent-session-provider-handle.test.ts`: **17 cases, 45 expect
  sites** (verified by counting `it(` / `expect(` at the pinned source).
- `src/main/runtime/agent-session-provider-handle-transition.test.ts`:
  **2 cases, 4 expect sites** (frozen byte-identical under
  `identity-leases/provider-transition/`, sha256
  `90affd020385be83ca5fe351272219710d4734f1bee163ff1085a6e9345138f1`).
- Total: **19 source cases / 49 static source expect sites** (verified by
  counting `it(` / `expect(` at the pinned source), every expect group mapped
  to named candidate assertions in `source-case-map.json`. Per the root
  review, 49 describes static expectation sites, **not** claimed dynamic
  assertion evaluations.

## Tests-first evidence

1. **Setup/compile**: the suite was written first against deliberately wrong
   stubs; authoring-time compile errors were fixed before the RED run and are
   not evidence.
2. **Genuine assertion RED**: `red-round-stub.txt` is a **bounded capture**:
   it preserves two verbatim failing lines from the recorded run
   (`source_case_chain_append_refuses_growth_past_cap … FAILED`,
   `source_case_transition_records_leaf_during_proof_without_granting_ownership
   … FAILED`) and the summary line **"7 passed; 62 failed; 0 ignored"** from
   `cargo test -p drogon-core --test session_authority --locked` against the
   deliberate stubs. It is not a full failure transcript; no missing output
   is fabricated.
3. **Production GREEN (corrected scope)**: after the correction,
   `cargo test -p drogon-core --test session_authority --locked` → **45
   passed, 0 failed, 0 skipped** (the new final denominator after removing
   later-slice tests: 19 `source_case_*` ports + 26 schema/boundary tests);
   `cargo check --workspace --locked` clean; zero warnings in the
   session_authority build; `rustfmt --check` clean on all owned files.
   **Acceptance correction round**: focused suite then **46 passed** (one new
   trim allow-list test). **Root-review continuation round**: focused suite
   now **51 passed, 0 failed, 0 skipped** (five new numeric-extraction
   regression tests); `cargo test -p drogon-core --locked` → **all suites ok**
   (the previously failing `automation_records.rs` `Some(None)` round-trip
   was fixed by its own owner and now passes — 21 passed — outside this
   leaf's scope); `cargo check --workspace --locked` clean;
   `rustfmt --edition 2021 --check` clean on all owned files; zero warnings.

Boundary vectors were captured by executing `JSON.stringify` /
`String.length` on the pinned Node 24 runtime. The generator is retained at
`node-vectors/generate-vectors.mjs` (pure ASCII source — a literal NUL byte
in the `nul` vector was found by the acceptance correction and re-spelled as
`\u0000`; verified zero NUL bytes, `file` reports ASCII text — exact command
and runtime documented in its header, hash in `report.json`); its output
matches the original capture byte-for-byte.

The exact ECMAScript `trim` set is pinned by a second generator,
`node-vectors/trim-vectors.mjs` (pure ASCII; tested characters are spelled
as JS `\uXXXX` escapes patched into placeholder tokens, so the source never
contains raw control bytes), with its captured output
`trim-vectors.out.json`: U+0085 NEL, U+180E, U+200B, U+2060 are **not**
trimmed; U+000B, U+FEFF, U+2009, U+2028, U+2029 are trimmed.

## Divergences and limitations (corrected)

- **Options key order — non-contract byte-order limitation, not an original
  assertion divergence.** The source serializer
  (`agent-session-store-serialization.ts`) writes records through
  `JSON.stringify`, and the source record tests compare with `toEqual`, which
  is order-insensitive for objects; no source assertion pins key order. The
  port's serde_json object map sorts keys, so serialized byte order can
  differ from JS insertion order while logical object equality stays exact
  (round-trip tests compare `Value` equality, order-insensitive).
- **`minimumNextFence`**: source lease validator does not check it; the port
  preserves the raw persisted JSON value verbatim (including non-integer
  data) and never rejects a record on it.
- **JavaScript trim**: exact — `is_handle_field` reuses the established
  `crate::claim_identity::js_trim`, the single ECMAScript
  WhiteSpace + LineTerminator table shared across the crate (no local trim
  logic remains in session_authority; the test harness path-includes the
  existing claim_identity module, which the dispatch permits). Boundary
  tests cover the full 25-code-point allow-list plus negatives U+0085,
  U+180E, U+200B, U+2060 and control characters, all verified against the
  pinned Node 24 runtime (`trim-vectors.mjs` / `trim-vectors.out.json`).
- **JSON numbers**: values beyond ±(2^53−1) or fractional are rejected,
  matching `Number.isSafeInteger`.
- **No Windows/other-platform execution**: everything executed on macOS
  (darwin-arm64, cargo 1.98.0). No platform-specific behavior is claimed.
- **Slice boundary**: no SQLite store, no lease transitions batch, no RPC,
  no callers, no process supervision. A provider conversation record is not
  a PTY, a liveness verdict, or a signed claim.

## Process disclosures (per review instruction)

- **Temporary-file deviation (resolved)**: the worker first created the Node
  vector capture at `/var/folders/8g/w9x4n8ws4mx6vxjhmnrnwy640000gn/T/opencode/jsvec.mjs`,
  outside the owned paths. That exact file has been deleted; the retained
  generator now lives in the owned
  `native-session-authority/provider-record/node-vectors/` subtree with
  exact command/runtime/hash. Executions used the Drogon-rewrite repo as
  working directory, never the read-only reference checkout.
- **Prior Python rewrite (disclosed)**: the first delivery used inline
  Python for one bulk test-edit and string fixes despite the repository's
  patch preference. This correction used only the patch mechanism (file
  edits and one explicit line-range deletion); no Python, no other scripting
  rewrote repository files.
- **Second correction disclosures (acceptance round, `task_0970a0550c79`)**:
  1. `generate-vectors.mjs` still contained one literal NUL byte in the
     `nul` vector despite the pure-ASCII claim; it was re-spelled as the
     `\u0000` escape via a byte-level patch, verified zero NUL bytes
     (`file`: ASCII text), re-executed on the pinned Node 24 runtime, and
     its output still matches the original capture byte-for-byte.
  2. The test-suite header previously implied the lease-adjudication and
     lease-transition source suites were mapped case-by-case; it now limits
     the mapped claim to the 17-case handle suite, the 2-case transition
     suite, and the record validators, naming the lease policy/transitions
     as pending later slices.
  3. `rustfmt --check` in this round surfaced pre-existing formatting drift
     in `record.rs` / `transition.rs` import ordering and older test
     sections; `rustfmt` was applied to the owned files (formatting only, no
     behavioral change — verified by the 46/46 GREEN) so the format claim
     is now genuinely clean.
  4. `cargo test -p drogon-core --locked` exposed a pre-existing failure in
     `tests/automation_records.rs` (`Some(None)` serde round-trip) in files
     owned by other in-flight work; it was reported, not fixed (out of
     scope). In this continuation round that owner fixed it (21 passed), so
     the full-crate run is fully green; the record is retained above for
     provenance.
- **Third round disclosures (root-review continuation, `task_496eabe1ef0c`)**:
  1. Trim deduplication: the local ECMAScript trim allow-list added in the
     acceptance round was replaced by reuse of the established
     `crate::claim_identity::js_trim`; no trim logic remains in
     session_authority. The test harness path-includes the existing
     claim_identity module (permitted by the dispatch; the module itself was
     not edited) with a scoped `#[allow(unused_imports, dead_code)]` for the
     path-inclusion artifact. FEFF-positive and U+0085-negative assertions
     are retained.
  2. Numeric defects were reproduced before correction and preserved in
     `red-round-numeric.txt` (bounded, separate from `red-round-stub.txt`).
     Its addendum discloses that the three acceptance-test failures also
     involved an independent fixture bug (invalid deathEvidence kind
     spelling), fixed alongside; the i64::MIN panic reproduction is pure.
  3. One consistent numeric path: `json_safe_integer` + non-panicking
     `is_safe_integer` range comparison now cover every persisted numeric
     field (see the numeric section above); raw `minimumNextFence`
     preservation is unchanged.
  4. Source count wording corrected everywhere: 49 is static source expect
     sites, not claimed dynamic assertion evaluations (per root review).
  5. Mid-round, another worker's in-progress `automations/` module
     temporarily broke the drogon-core lib build; verification paused until
     its owner fixed it — no files outside the leaf scope were touched.

## Integration boundary

Root owns: `lib.rs` registration, `db.rs`/`session.rs` association of PTY
rows to conversation records, the durable store with CAS/batch atomicity,
lease acquisition/adjudication policy, versioned RPC/CLI, and the final live
vertical through real Drogon callers. Test path inclusion is temporary until
registration, never a parallel production backend.

## Hashes (SHA256, final — root-review continuation round)

- `crates/drogon-core/src/session_authority/mod.rs`: `1c0a2c722497c796c04ec40a7722d5cc3bfec3b4a5f3789deb796cd3e9f3abec`
- `crates/drogon-core/src/session_authority/error.rs`: `76a27aa680d5428a3425a31d45b13c921c5b4c62c95ecade68f0d836e9ee0302`
- `crates/drogon-core/src/session_authority/provider_handle.rs`: `0216c46f609625fb196fbed7b0ffe5e4347f1791e0bcf0f3549f0d1af915a625`
- `crates/drogon-core/src/session_authority/record.rs`: `cdf1cc0848df2203f872efbe7559dcedad8c20ee8fdf50ecca12188783e642fa`
- `crates/drogon-core/src/session_authority/transition.rs`: `38b4fb8acf855fb40eb8b798a19ceeff25d9c34eda55a27313dc8b403dbcbe41`
- `crates/drogon-core/tests/session_authority.rs`: `379336e7ea9b16544e2e6675b805bf6775ed1542b4299bcea83d2f241dee9ae3`
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/generate-vectors.mjs`: `2f48dda047d75ebd74eefacaa6f11075043c3d38374473299cc209d1681b741e`
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/generate-vectors.out.json`: `a199002b65e3d52b004ffdc94d5f93349fbf1cad7df6a99f33c84b0e5c0bf595`
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/trim-vectors.mjs`: `b4bb6afbb237b87ad636494c1377950a6e8d391f307491b6f5e6dab6950c74a6`
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/trim-vectors.out.json`: `bc0898a99afacc08dc0b1bd6740f394c61d162036fd96d83bc26983a63889f34`
- `tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/red-round-numeric.txt`: real-regression bounded RED capture (numeric defects, reproduced pre-fix)

`admission.rs` was deleted (nothing assigned remained). Source-file hashes
unchanged from the first delivery and listed in `report.json`.
