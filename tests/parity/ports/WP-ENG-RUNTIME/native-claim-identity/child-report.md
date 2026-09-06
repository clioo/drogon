# Native claim identity — child report (Kimi For Coding leaf, task_e34dcfe25a76)

## Scope and ownership

Complete native port of the Orca agent-session claim-identity capability per
`docs/migration/native-claim-identity-contract.md`. Sole implementer; no
delegation. Files owned and written exclusively by this leaf:

- `crates/drogon-core/src/claim_identity/mod.rs`
- `crates/drogon-core/src/claim_identity/resume.rs`
- `crates/drogon-core/src/claim_identity/signer.rs`
- `crates/drogon-core/tests/claim_identity.rs`
- `tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/reference-vectors/generate-vectors.mjs`
- `tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/reference-vectors/vectors.json`
- this report and `child-report.json`

No other file was modified: no Cargo manifests, lockfiles, `lib.rs` exports,
protocol, Git state, frozen tests, or Sol lead docs were touched. The
production module is exercised through `#[path =
"../src/claim_identity/mod.rs"]` from the Rust test target until root registers
the public library export (explicitly allowed by the contract; it is the same
implementation, not a second one or an adapter).

## Source basis (read-only reference, never a runner cwd)

Reference checkout `/Users/carlos/Documents/Drogon-mentu-session` was used
read-only at pinned revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. One pre-existing untracked
`.mentu/plans/drogon-rewrite-preflight.md` was observed there; it was not
created by this leaf and was left untouched. Source files read in full:

- `src/main/runtime/agent-session-claim-identity.ts` (canonicalization,
  signer, ephemeral signer, persistent key loading)
- `src/shared/agent-session-resume.ts` (resumable agents, metadata
  normalization, control-character rejection, per-agent resume argv rules)
- `src/shared/agent-session-host-authority.ts` (claim type, digest version 1,
  error-code catalog)
- `src/shared/agent-session-resume.test.ts` and
  `src/main/runtime/agent-session-claim-identity.test.ts` (admitted suite +
  additional relevant tests)
- `LICENSE` (MIT, Copyright (c) 2026 Lovecast Inc. — attribution preserved in
  module docs; the `orca-...` digest labels are retained as compatibility
  bytes per the contract)

Out of finite scope (recorded, not silently reduced): hook-payload extraction
(`extractAgentProviderSession`), lease ownership/handle transitions, RPC
wiring, public library registration, protocol negotiation, packaged
execution. A signing claim does not grant lease ownership or prove liveness —
stated in module docs and here.

## Runtime and command record

- Host: macOS (Darwin), cargo 1.98.0, rustc 1.98.0 (Homebrew).
- Node vectors generated with the pinned Node 24 runtime
  `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
  v24.19.0.
- Formatting: `rustfmt --edition 2024` applied to exactly the four owned Rust
  files (workspace-wide `cargo fmt` deliberately not used to avoid touching
  other dirty files); `--check` is clean.
- All cargo commands run with `--locked` from the Drogon-rewrite checkout;
  no installs, no dependency changes.

## Tests-first gate (setup vs behavioral RED vs GREEN)

1. **Setup (compile/import) failure — recorded, not RED.** Test target
   written first; `cargo test -p drogon-core --test claim_identity --locked
   --no-run` failed with
   `couldn't read crates/drogon-core/tests/../src/claim_identity/mod.rs: No such file or directory`.
2. **Behavioral RED.** A deliberately wrong but compiling stub module was
   placed at the same path; the suite compiled and ran, producing **8 passed /
   24 failed of 32 tests, 0 skipped** — every failure an assertion panic or
   wrong-value mismatch (e.g. stub key id `"stub-key-id"`, stub digests,
   unconditional `IdentityRequired`), not an import error. The 8 incidental
   passes are rejection-path assertions a fully-rejecting stub satisfies;
   they were not counted as parity.
3. **GREEN.** The stub was fully replaced by the production implementation
   (no stub remnants; `grep -rn "stub\|todo!\|unimplemented!\|FIXME"` over
   owned files is empty) and `cargo test -p drogon-core --locked` passes:
   **claim_identity 32/32**, all other drogon-core targets unchanged and
   green (16 engine, 4, 3, 2, 2, 2, 1, plus empty harness targets).
   `cargo check --workspace --locked` passes. The concurrency test was also
   run 40× in isolation plus full-suite repetitions without a flake after the
   race fix documented below.

## Frozen source suite mapping (3 cases / 7 assertion evaluations)

| # | Source case / assertion (source lines) | Rust result |
|---|----------------------------------------|-------------|
| 1 | case 1 `stable-opaque-digests`: identical inputs → equal claims (line 32) | PASS — `source_case_stable_opaque_identity_and_worktree_digests`, `assert_eq!(first, second)` |
| 2 | case 1: identity digest does not expose `session-1` (line 33) | PASS — `!first.identity_digest.contains("session-1")` |
| 3 | case 1: identity digest stable across worktrees (line 34) | PASS — cross-worktree identity digest equality |
| 4 | case 1: worktree scope digest changes across worktrees (line 35) | PASS — `assert_ne!` on worktree digests |
| 5 | case 2: leading-hyphen Codex id rejected with `agent_session_identity_required` (line 39) | PASS — exact `ClaimIdentityError::IdentityRequired`, Display string matches the source error code |
| 6 | case 2: unsupported agent rejected with `agent_session_identity_required` (line 42) | PASS — same typed error |
| 7 | case 3: Prime identity canonicalizes transcript path via `realpathSync` (line 53) | PASS — transcript path equals `fs::canonicalize` of the file; agent/key/id preserved |

All 7 evaluations map to real Rust assertions; none were weakened, skipped, or
adapted through expected-value shims.

## Additional coverage (32 test functions total)

- **20 deterministic Node crypto reference vectors** (HMAC-SHA256 digests and
  key ids computed independently by `generate-vectors.mjs` mirroring the
  source math) covering every supported agent, both provider keys,
  transcript/no-transcript variants, Unicode ids, domain/namespace
  separation and a second key. `vectors.json`
  SHA256 `5c7c6df9ffa53f0b63a1d65dd299f91e404da26c326f197aa0f62c474d73c949`.
- All 14 supported agents recognized; unsupported spellings (incl.
  case variants) rejected.
- Every agent × provider-key combination accepted/rejected per source rules;
  full `getAgentResumeArgv` matrix (21 rows) incl. omp resume-file JS-trim
  fallback.
- JS UTF-16 length semantics: 512/513-unit boundaries, astral-pair counting
  (256 astral chars = 512 units accepted, 257 rejected), mixed BMP+astral.
- JS `String.prototype.trim` semantics: all 25 ECMAScript WhiteSpace /
  LineTerminator code points trimmed; inner control chars rejected; DEL; NBSP
  padding; hyphen-after-trim rejection.
- Metadata normalization: non-object/null/array/number raws, wrong key
  spellings, non-string ids, camelCase-only transcriptPath, snake_case
  ignored, control-character and empty transcript paths dropped (not fatal).
- Transcript path cases: relative → identity rejection; missing → explicit
  native `Io` error (source `realpathSync` behavior); directory → identity
  rejection; symlink→file resolves to target canonical path; symlink→dir and
  broken symlink rejected appropriately; `/./`+`/..` segments canonicalized;
  16 KiB UTF-8 byte bound enforced before fs access (16385 rejected as
  identity; 16384 passes the bound and then fails as a native fs error —
  such a path cannot exist on Darwin, PATH_MAX ~1024; recorded honestly).
- Darwin canonicalization: `/tmp` → `/private/tmp`, tempdirs under
  `/private/var/folders` (cfg-gated; see platform limitations).
- Domain/namespace/worktree separation: each namespace field, authority
  domain, agent, session id, worktree id; label/field-order separation
  (no digest collisions across HMAC domains).
- Claim wire shape: digest version 1, 22-char base64url key id, 43-char
  base64url digests without padding.
- Ephemeral signers: system entropy (`getrandom 0.4.3`), distinct key ids,
  deterministic per signer.
- Persistent keys: exclusive create (`create_new`, mode 0o600 subject to
  umask — asserted as no group/other bits), 32 bytes, reload stability,
  pre-seeded valid key reused without rotation, corrupt/replaced lengths
  (0/31/33/64) fail closed with `agent_session_ownership_unknown` and are
  never rewritten, directory-at-key-path is a native `Io` error, 8-thread
  concurrent first creators converge on exactly one winner key.
- Secret hygiene: hand-rolled `Debug` for the signer is redacted; hex and
  base64 encodings of the key are asserted absent from both signer and claim
  `Debug` output.
- Typed errors: `agent_session_identity_required` and
  `agent_session_ownership_unknown` exact Display strings; native filesystem
  failures are an explicit `Io { operation, path, message }` variant.

## Deliberate, documented translation decisions

1. **Concurrent-create settle window.** The source runs `openSync('wx')` +
   `writeFileSync` synchronously on a single-threaded event loop, so its
   post-race re-read always sees the winner's bytes; the equivalent race
   exists cross-process there too. In Rust, threads sharing a process can
   read the winner's file after `create_new` but before `write_all` (both
   the initial read and the loser re-read; reproduced 4/10 and 2/16 runs
   before the fix). `read_settled_key` retries any non-32-byte read for up
   to ~100 ms, never writes, and fails closed (`OwnershipUnknown` / native
   `Io`) if the winner never materializes. Pre-seeded corrupt keys still
   fail closed with `OwnershipUnknown` after the bounded window, file
   untouched. Verified non-flaky across 40 targeted runs and repeated full
   suites.
2. **`getrandom` failure surface.** The source's `randomBytes` throws a raw
   error; the port maps it to the explicit `Io` variant with operation
   `random_bytes`.
3. **Ephemeral signer returns `Result`.** Same honesty rationale; the only
   failure mode is system-entropy failure.

## Side effects and environment notes

- All key/transcript files are created only under `tempfile`-owned
  directories inside the test process, and every such directory is owned by an
  RAII fixture (`tempfile::TempDir` / `TranscriptFixture`) that is dropped and
  removed normally — no temp directories are intentionally leaked.
- No credentials, profiles, providers, sessions or services were contacted;
  no background services launched; no global settings changed.
- The read-only reference checkout was never used as a runner cwd; its
  untracked `.mentu/plans/drogon-rewrite-preflight.md` predates this task and
  was left alone.

## Review correction (second pass, task_e9b5fdceb064)

- **Test fixture hygiene.** The first pass kept Pi/Prime test transcripts
  alive with `Box::leak`-ed `tempfile::TempDir`s (a bounded set of temp dirs
  intentionally leaked for process lifetime). That pattern is replaced by a
  test-owned `TranscriptFixture` RAII struct: canonicalization resolves the
  transcript synchronously during the call, so the fixture only needs to
  outlive the call and is dropped (dir removed) normally. No
  `Box::leak`/intentional-leak pattern remains in the test target; the full
  32-test suite and all assertions are preserved with zero skips.
- **Process deviation, recorded honestly.** During the first pass this leaf
  ran one read-only `git status` (plus `rev-parse`) on the reference checkout
  despite the explicit no-Git rule for this work. That command is a read and
  **does not constitute proof of clean state**, and this report no longer
  claims it does; correctness of the no-modification statement rests on this
  leaf's write actions (all writes were confined to the owned paths listed
  above). No further Git command was run in this pass, and **no write-side
  Git operation** (add/commit/push/reset/rebase or any other mutation) occurred
  at any point in either pass.
- **Re-verification after the correction:** `rustfmt --edition 2024 --check`
  clean on `crates/drogon-core/tests/claim_identity.rs`;
  `cargo test -p drogon-core --test claim_identity --locked` → **32 passed, 0
  failed, 0 skipped** (full 32-test suite intact).

## Platform limitations (honest, per contract)

- **Darwin (tested):** canonicalization matches Node `realpathSync` +
  `normalize`, including `/var` → `/private/var` alias resolution; verified.
- **Windows (untested):** the source lowercases canonical paths with
  `toLocaleLowerCase('en-US')`; the port applies Unicode default lowercasing
  under `cfg(windows)` as the closest equivalent. Mode bits are inert (as in
  the source). No Windows evidence is claimed.
- **Linux (untested):** expected to follow the same code path as Darwin; no
  Linux run was performed.
- Non-UTF-8 on-disk path components are lossy-converted (`to_string_lossy`)
  and then rejected if the canonical path is not valid UTF-8; JSON-sourced
  inputs are always UTF-8, matching the source's string-only surface.

## Acceptance boundary

Passing this module is not full-session parity, RPC wiring, lease/ownership
implementation, public export registration, packaged execution, or
integration acceptance — those remain root-owned next steps. The suite is
GREEN against the production Rust module with the frozen 3-case/7-assertion
mapping complete.

## File hashes (SHA256, final)

- `crates/drogon-core/src/claim_identity/mod.rs`: `bc6f45af9753a6a6e2149f9252101d20145da46e48dbc8d848d9d14bae7d34f9`
- `crates/drogon-core/src/claim_identity/resume.rs`: `4b0a00ea7dee39bbd5f2850d0fcc634bfc0a0c6c29b90d207c6f2d173fe95d54`
- `crates/drogon-core/src/claim_identity/signer.rs`: `4713d68a7c95bf0359426578bd227a1144c855a9e40313c66b0c78119b36471f`
- `crates/drogon-core/tests/claim_identity.rs`: `a15ed9638d4f8c81e1e567c6a9850ee3ccea48d888fbde5c00fce8f312fd463e` (post review correction; supersedes `8bbe9ebb…`)
- `reference-vectors/generate-vectors.mjs`: `88251fb139d8691380f27a0720018c4afb5a3823e8836afa8ada233169094b2e`
- `reference-vectors/vectors.json`: `5c7c6df9ffa53f0b63a1d65dd299f91e404da26c326f197aa0f62c474d73c949`
