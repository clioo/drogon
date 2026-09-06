# Native claim identity — Sol-ENG lead review

Status: **accepted as a native Rust capability module, pending root-owned integration**. One verified OpenCode Kimi worker implemented and corrected the finite capability; Sol-ENG performed focused source, code, evidence, fixture-hygiene, hash, formatting, and test review. This is not full session parity, lease ownership, provider-handle transition parity, RPC wiring, public export registration, packaged execution, or integration acceptance.

## Worker provenance and lifecycle

- Provider smoke: exact response `KIMI_SMOKE_OK` from OpenCode 1.18.29 launched with `opencode --model kimi-for-coding/kimi-for-coding --auto`; the live UI identified `Kimi K2.7 Code Kimi For Coding` and `Build auto`.
- Child Run: `run_515d60c7b482`.
- Implementation Task/Dispatch: `task_e34dcfe25a76` / `ctx_3bfc08a56fa1`, depth 2, injected into exact terminal/process incarnation `term_e6ecb4fa-9345-4e40-8806-136dc6f67f81` / `6a053fdb-744a-4d93-ac10-3f97cbaa63b8`.
- Review correction Task/Dispatch: `task_e9b5fdceb064` / `ctx_2c050b7c89ad`, same terminal/incarnation and depth 2. It replaced intentionally leaked transcript fixtures with test-owned RAII fixtures and re-ran the focused suite.
- Final report-consistency Task/Dispatch: `task_87c328c2dc5d` / `ctx_5faa92f375b4`, same worker; it removed stale side-effect wording only.
- All three child deliveries reported `succeeded`, were independently reviewed, released through `worker-release`, and acknowledged. Each release returned `retained / no_owned_resource / processAction:none`, as expected for the pre-created custom OpenCode terminal. No second worker or child delegation was used.

## Delivered capability

The production Rust module is in `crates/drogon-core/src/claim_identity/{mod,resume,signer}.rs`. Until root registers the public export, `crates/drogon-core/tests/claim_identity.rs` includes that exact production module through `#[path]`; there is no duplicate stateful TypeScript backend or expected-value adapter.

The implementation covers the complete ratified boundary:

- all 14 resumable agents, exact provider-key rules, resume argv behavior, metadata normalization, ECMAScript trim, UTF-16 session-id limits, and control-character rejection;
- Pi/Prime absolute bounded transcript identity, execution-host realpath/stat canonicalization, regular-file enforcement, and honest Darwin/untested Windows/Linux posture;
- digest version 1 with exact `orca-agent-session-claim-v1` and `orca-agent-session-worktree-v1` compatibility bytes, field order, u32 big-endian UTF-8 length prefixes, HMAC-SHA256, unpadded base64url, and 22-character key-id derivation;
- 32-byte ephemeral system-entropy and persistent coordination keys, exclusive restrictive creation, fail-closed corrupt-key behavior, concurrent first-creator convergence, and redacted secret Debug output;
- exact typed `agent_session_identity_required` and `agent_session_ownership_unknown` errors, with native filesystem failures kept explicit.

The bounded approximately 100 ms read-settle loop is a documented Rust concurrency translation: losers can observe the winner's exclusively created file between create and write, whereas the source's same-process calls are synchronous on one event loop. It never writes or rotates the loser-visible file, and corrupt keys still fail closed.

## Tests-first evidence

The source reference remained read-only at `/Users/carlos/Documents/Drogon-mentu-session`, pinned to `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, and was never a runner cwd.

| Gate | Classification | Result |
| --- | --- | --- |
| Module absent | setup/import failure, not RED | compile failed because `claim_identity/mod.rs` did not exist; 0 behavioral results |
| Compiling deliberately wrong stub | genuine behavioral RED | 8 passed / 24 failed of 32, 0 skipped; failures were assertion/value failures |
| Production module | native GREEN | 32 passed / 0 failed / 0 ignored |

All 3 admitted original cases and all 7 original assertion evaluations map to actual Rust assertions and pass: stable/equal claims, opaque identity digest, cross-worktree identity stability, worktree digest separation, malformed Codex rejection, unsupported-agent rejection, and canonical Prime transcript identity. Additional evidence includes 20 deterministic Node 24 HMAC/key-id vectors, the complete agent/key/argv matrix, Unicode and control boundaries, filesystem/symlink/platform cases, namespace/domain separation, persistent-key corruption and concurrency, and secret-debug hygiene.

The child report and vector evidence are under `tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/`. Final recorded hashes matched Sol's independent `shasum -a 256` check, including Rust test hash `a15ed9638d4f8c81e1e567c6a9850ee3ccea48d888fbde5c00fce8f312fd463e` and vector hash `5c7c6df9ffa53f0b63a1d65dd299f91e404da26c326f197aa0f62c474d73c949`.

## Independent review commands

All commands ran from `/Users/carlos/Documents/Drogon-rewrite` with no install or dependency mutation.

```text
cargo test -p drogon-core --test claim_identity --locked
```

Exit 0: 32 passed, 0 failed, 0 ignored, 0 filtered; 0.52 s.

```text
rustfmt --edition 2024 --check crates/drogon-core/src/claim_identity/mod.rs crates/drogon-core/src/claim_identity/resume.rs crates/drogon-core/src/claim_identity/signer.rs crates/drogon-core/tests/claim_identity.rs
```

Exit 0. A focused scan found no `Box::leak`, `mem::forget`, ignored tests, `todo!`, `unimplemented!`, or `FIXME` in code/tests. All test key/transcript directories are now owned by RAII fixtures and removed normally.

## Source, native module, and integrated candidate status

- **Original source baseline:** previously admitted, 3/3 cases and 7/7 assertion evaluations for this suite at the pinned revision.
- **Native module validation:** accepted, 32/32 focused Rust tests plus 20 Node reference vectors; complete ratified claim canonicalization/signing/key-loading boundary.
- **Integrated candidate parity:** not yet claimed. Root still owns `lib.rs` export registration, callers/RPC/protocol wiring, durable lease and provider-handle transition capabilities, full integration testing, Git, packaging, and installation.

Durable ownership and lease records remain Rust execution-host responsibilities. A parallel stateful TypeScript backend merely satisfying legacy imports would split authority and is not an acceptable integration path.

## Compliance note and remaining risk

The Kimi worker disclosed that its first pass ran read-only `git status` and `rev-parse` on the reference despite the explicit no-Git rule. Those reads are not treated as proof of source cleanliness; no further Git command and no write-side Git operation occurred, and artifact acceptance rests on owned-path review and reproducible tests. This was a process deviation, not hidden or normalized.

Audit closure remains **11/12 = 91.7%**, medium confidence, change **+0**. The next closure milestone is root registration and genuine versioned integration of the Rust claim module alongside the still-separate lease/handle capabilities. The 24-hour risk remains **high** until root completes and accepts that integration; this delivery closes the finite native module only.
