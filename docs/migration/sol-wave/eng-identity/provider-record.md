# Native provider record / handle chain — Sol handoff

Date: 2026-09-06

Status: **partial implementation handoff; not integrated acceptance**

## Outcome

The Kimi leaf produced the dependency-slice-1 Rust model and pure transition in
`crates/drogon-core/src/session_authority/`, plus a path-included test suite and
evidence under
`tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/`.
Focused lead execution is GREEN at **51 passed / 0 failed / 0 ignored**, but the
late root actual-source boundary oracle was not consumed by the Rust suite and
exposes at least one concrete remaining parity defect: the pinned source admits
raw JSON `schemaVersion: 2.0`, while the candidate still compares the record
version to an integer-shaped `serde_json::Number` and gates admission with
`Number::as_u64()`. This delivery is therefore preparation for root-owned
correction/integration, not full provider-record or session-authority success.

## Delegated provenance

- Run: `run_5ef473a02da0`
- Worker: OpenCode Kimi K2.7 Code, exact model
  `kimi-for-coding/kimi-for-coding`, per-invocation `--auto`
- Terminal: `term_e6ecb4fa-9345-4e40-8806-136dc6f67f81`
- Terminal incarnation:
  `6a053fdb-744a-4d93-ac10-3f97cbaa63b8`
- Initial Task/Dispatch: `task_1cddc148cebf` /
  `ctx_ae31d647c99d`
- Scope correction: `task_409e1056b0a9` / `ctx_09689a2eb286`
- NEL/evidence correction: `task_0970a0550c79` / `ctx_afada235a4cc`
- Last numeric-boundary continuation: `task_496eabe1ef0c` /
  `ctx_16049bee8b80`
- Last delivery: `delivery_4babb182f225`, acknowledged only after review and
  release.
- Release: `state=retained`, `reason=external_terminal`,
  `processAction=none`; the external terminal was not force-closed.

The same verified terminal was transferred sequentially for corrections; no
overlapping editor or second leaf was started. Sol made no product/test edits.

## Source baseline and mapping

The source pin is `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The already
admitted isolated baseline was reused; the read-only source checkout was never
a runner working directory.

- `src/shared/agent-session-provider-handle.test.ts`: 17 cases / 45 static
  `expect` sites.
- `src/main/runtime/agent-session-provider-handle-transition.test.ts`: 2 cases
  / 4 static `expect` sites.
- Total mapped source suite: 19 cases / 49 static `expect` sites. This is not a
  claim about dynamic assertion evaluations.
- Record-validator and fixture behavior is mapped separately as semantic/model
  coverage; lease/store/restart/RPC/caller suites remain pending.

The candidate models the schema-v2 location, provider, account-home provenance,
options, launch args, full provider-handle chain, lease/recovery/settlement
fields, timestamps, null-versus-absent rules, unknown-version quarantine, and
raw `minimumNextFence` preservation. The pure transition covers live ownership
and new-owner-proving behavior. It does not build a database, lease CAS policy,
process supervisor, RPC/CLI, or caller integration, and a conversation record
is not a PTY, signed claim, or liveness verdict.

## Tests-first evidence

- Historical compiling-stub RED: `7 passed / 62 failed`, bounded evidence in
  `red-round-stub.txt`; this demonstrates test sensitivity, not failure of a
  prior production implementation.
- Numeric correction RED: `47 passed / 4 failed`, bounded evidence in
  `red-round-numeric.txt`. The `i64::MIN` `abs()` panic is a clean production
  regression. The other three failures were contaminated by an independently
  invalid death-evidence fixture spelling, so they are not clean standalone RED
  proof even though the `Value::as_i64` divergence was mechanically confirmed.
- Final child-reported validation: focused 51/51; full `drogon-core` GREEN;
  workspace `cargo check --locked` clean; Node vector captures reproduced.
- Final lead-focused validation: focused 51/51; both Node vector captures match;
  all owned JSON parses.

The candidate now reuses `crate::claim_identity::js_trim`, preserves U+FEFF and
U+0085 behavior, avoids `i64::abs`, and uses one parsed-number safe-integer
extractor for persisted numeric fields. Raw `minimumNextFence` remains
uninterpreted, matching the source validator.

## Actual-source oracle and unresolved acceptance

Lead executed from the rewrite root:

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/verify-native-provider-source-boundaries.mjs --fixtures
```

The script verified six admitted capsule files and emitted **266** raw-JSON
cases from the pinned implementation using Node `v24.19.0` and esbuild
`0.25.12`: **163 accepted / 103 rejected**, cases SHA-256
`e942e2f26becdcf9d8a29418fc949aadb8f8dd76eddb9ec67be282dc18f323c0`.
It explicitly reports `record:schemaVersion:2.0` as accepted.

Remaining root-owned work:

1. Feed all 266 emitted `rawJson` strings verbatim through the corresponding
   Rust production validators/admission path and require 266/266 agreement.
2. Fix schema-version validation/admission so numeric spellings equivalent to
   JavaScript number `2` (including `2.0`) are admitted, without weakening
   unknown-version quarantine or rewriting raw records.
3. Re-run the complete oracle after correction; the unexecuted matrix may
   reveal additional mismatches beyond the proven schema-version defect.
4. Run Rustfmt with the workspace edition. The lead command
   `rustfmt --edition 2024 --check ...` exited 1, including import-order diffs
   in leaf-owned `record.rs`, `transition.rs`, and the test file. The leaf's
   report used `--edition 2021`, but the workspace declares edition 2024.
5. Root registration, durable store/lease policy, RPC/callers, integrated tests,
   and non-Darwin execution remain outstanding.

## Focused lead commands

```text
cargo test -p drogon-core --test session_authority --locked
  PASS: 51 passed; 0 failed; 0 ignored

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/verify-native-provider-source-boundaries.mjs --fixtures
  PASS (source generation only): 266 cases, 163 accepted, 103 rejected

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/generate-vectors.mjs \
  | cmp - tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/generate-vectors.out.json
  PASS

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/trim-vectors.mjs \
  | cmp - tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/trim-vectors.out.json
  PASS

jq empty <all owned JSON evidence>
  PASS

rustfmt --edition 2024 --check crates/drogon-core/src/session_authority/*.rs \
  crates/drogon-core/tests/session_authority.rs
  FAIL: workspace-edition formatting diffs remain
```

## Final hashes

```text
76a27aa680d5428a3425a31d45b13c921c5b4c62c95ecade68f0d836e9ee0302  crates/drogon-core/src/session_authority/error.rs
1c0a2c722497c796c04ec40a7722d5cc3bfec3b4a5f3789deb796cd3e9f3abec  crates/drogon-core/src/session_authority/mod.rs
0216c46f609625fb196fbed7b0ffe5e4347f1791e0bcf0f3549f0d1af915a625  crates/drogon-core/src/session_authority/provider_handle.rs
cdf1cc0848df2203f872efbe7559dcedad8c20ee8fdf50ecca12188783e642fa  crates/drogon-core/src/session_authority/record.rs
38b4fb8acf855fb40eb8b798a19ceeff25d9c34eda55a27313dc8b403dbcbe41  crates/drogon-core/src/session_authority/transition.rs
379336e7ea9b16544e2e6675b805bf6775ed1542b4299bcea83d2f241dee9ae3  crates/drogon-core/tests/session_authority.rs
d8f118413ec7030d10d9afa5e0b07722c38dec537b1a6a72fbbcb04c459ddf1b  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/red-round-numeric.txt
6441946eaa9e19b9afa574cde92400f03489ea47c7d421c9486124fb3633722d  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/red-round-stub.txt
cbb0749f68cfd005ecaee1d1b07848192453fc8a9b437370964565ab8712506d  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/report.json
d55d22ae0efd2083418be1ab95a9d50a965cef8c12c71d232d1a1be925501120  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/report.md
a88fc38bd2f093303f75a0a721d1d18cb58789d4bdd73e617d9e913f361c41ec  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/source-case-map.json
2f48dda047d75ebd74eefacaa6f11075043c3d38374473299cc209d1681b741e  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/generate-vectors.mjs
a199002b65e3d52b004ffdc94d5f93349fbf1cad7df6a99f33c84b0e5c0bf595  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/generate-vectors.out.json
b4bb6afbb237b87ad636494c1377950a6e8d391f307491b6f5e6dab6950c74a6  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/trim-vectors.mjs
bc0898a99afacc08dc0b1bd6740f394c61d162036fd96d83bc26983a63889f34  tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/trim-vectors.out.json
```

Audit remains 11/12 = **91.7%** (medium confidence, delta 0). E5 publication /
resources remains the audit closure milestone; native registration, the
266-case correction, and store/lease integration are separate engineering
milestones. Full-fidelity delivery inside 24 hours remains high risk.
