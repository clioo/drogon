# Native claim Windows compatibility — Sol-ENG lead review

Status: **host-validated correction accepted for root integration review; native Windows parity remains unverified**. The bounded production correction preserves the existing native claim behavior and maps Rust canonical spellings to the pinned source's signing spellings without adding a second stateful backend. This review does not approve or prove ordinary or namespaced long-path behavior on Windows, and it is not final integrated or packaged acceptance.

## Delegation and lifecycle

- One existing approved OpenCode worker was used: `kimi-for-coding/kimi-for-coding`, OpenCode 1.18.29, per-invocation `--auto`, terminal `term_e6ecb4fa-9345-4e40-8806-136dc6f67f81`, incarnation `6a053fdb-744a-4d93-ac10-3f97cbaa63b8`. The observed UI identified `Kimi K2.7 Code Kimi For Coding` and `Build auto`; the prior verified smoke response was `KIMI_SMOKE_OK`.
- Child Run: `run_0aa61fe2fbc8`.
- Implementation Task/Dispatch: `task_8381e7b4ffa2` / `ctx_b82079aeeb62`, depth 2.
- Dot-namespace review correction: `task_bc62f713fc08` / `ctx_49908fa96270`, same terminal/incarnation and depth.
- Raw-canonical-validation and visibility correction: `task_9009fbf0bf1d` / `ctx_e4a350ff5b15`, same terminal/incarnation and depth.
- Evidence-accuracy correction: `task_16ae3bb28240` / `ctx_091d67c81a93`, same terminal/incarnation and depth.
- Each immediate follow-up transferred the same worker through official `worker-start --terminal` before the preceding delivery was acknowledged. After final focused review, `worker-release --dispatch ctx_091d67c81a93` returned `state: retained`, `reason: external_terminal`, `processAction: none`; final delivery `delivery_7415c961b9fa` was then acknowledged. The external terminal was not force-closed. No second worker and no child delegation were used.

## Source contract and correction

The source contract remains pinned to revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The leaf read the actual claim source plus Node 24.19.0 `lib/fs.js` and `lib/path.js`, and the Rust `std::fs::canonicalize` documentation. Root separately reports that the original source signer still matches all **20/20** reference vectors; Sol did not rerun the source checkout and never used it as a runner cwd.

The source-backed string expectations are:

| Input kind | Rust canonical spelling | Signed source-compatible spelling |
| --- | --- | --- |
| ordinary drive | `\\?\C:\...` | `c:\...` |
| ordinary UNC | `\\?\UNC\server\share\...` | `\\server\share\...` |
| explicit `\\?\` drive/UNC | `\\?\...` | preserve `\\?\...`, lowercased |
| explicit `\\.\` drive/device-UNC | Rust reports `\\?\...` | reconstruct `\\.\...`, lowercased |
| symlink input | canonical target | target spelling under the same namespace rule |

The production flow now keeps the raw `fs::canonicalize` `PathBuf` through regular-file metadata validation. Only the string returned and signed is normalized through the internal `pub(crate)` seam. The signer comment now accurately says synchronous source calls give only a same-process ordering property: separate source processes can race, while the deliberate bounded Rust settle behavior remains unchanged.

## Tests-first and independent review

The leaf preserved all 32 pre-existing native claim tests and recorded assertion-level RED before each behavior correction:

- Round 1 pure normalization RED: 3 passed / 2 failed; ordinary drive and UNC still retained Rust's extended prefix.
- Round 1 GREEN: 37/37 host-executed (32 preserved + 5 pure normalization).
- Round 2 dot-namespace RED: 0 passed / 2 failed; `\\.\` input was returned as `\\?\`.
- Final host GREEN: 39/39 (32 preserved + 7 pure normalization); 3 additional `cfg(windows)` real-filesystem tests exist but did not execute on macOS.

Sol's focused review ran from the rewrite repository:

```text
cargo test -p drogon-core --test claim_identity --locked
```

Exit 0: **39 passed, 0 failed, 0 ignored, 0 filtered**. Root independently reported the same **39/39** result.

```text
rustfmt --edition 2024 --check crates/drogon-core/src/claim_identity/mod.rs crates/drogon-core/src/claim_identity/resume.rs crates/drogon-core/src/claim_identity/signer.rs crates/drogon-core/src/claim_identity/windows_path.rs crates/drogon-core/tests/claim_identity.rs
jq empty tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/windows-compatibility/report.json
```

Both exited 0. A focused scan found no ignored tests, `todo!`, or `unimplemented!`. Recorded SHA-256 values matched the files reviewed:

- `mod.rs`: `d8e5621358aa78063bcc22639cd1915ea0c1993d9ca2299a6f0b3af997f45d00`
- `resume.rs`: `4b0a00ea7dee39bbd5f2850d0fcc634bfc0a0c6c29b90d207c6f2d173fe95d54`
- `signer.rs`: `a3b85db9866c893fbc2d697489ba7f39241eaa4d20b54606e918c1a14aa764c6`
- `windows_path.rs`: `84d2336ad808463f02698698e91b23ce07d293dc7cbf4dca90f12cdc33d6b866`
- `claim_identity.rs`: `3341422aeb42d8ddfcda871ce689a637c96b06a83c68552752e881f9de5f897b`

The additive child report preserves the four rounds and final 3-test Windows count in its round-3/round-4 sections and JSON. One earlier markdown “Platform limitations” paragraph remains historically worded as “2 `cfg(windows)` tests”; it predates the added long-path case and is not the final count. This lead review uses the verified final count of **42 test functions: 39 host-executed + 3 Windows-gated** and does not modify the leaf report manually.

## Windows acceptance boundary

The pure mapping tests prove only deterministic string transformations on macOS. The three gated tests cover ordinary canonical spelling, symlink target resolution, and a long-path production flow, but none has run on Windows; the symlink case may require Developer Mode or `SeCreateSymbolicLinkPrivilege`.

In particular, source inspection does not establish whether ordinary or explicitly namespaced paths over `MAX_PATH` succeed or fail through Node 24's native filesystem bindings, nor whether Rust's metadata conversion behaves identically in the same environment. A comparative native-Windows run must execute the pinned Node 24 source behavior and the Rust module against ordinary drive, UNC, explicit `\\?\`, explicit `\\.\`, symlink, ordinary long-path, and namespaced long-path fixtures, recording OS/version and relevant process manifest configuration. Until then, neither parity nor divergence is approved or claimed.

## Handoff status

- **Original source baseline:** already admitted and independently retained by root; source signer vectors 20/20 per root evidence.
- **Native module validation:** 39/39 host tests pass; source-backed mapping is implemented and the signer race comment is corrected.
- **Candidate parity:** not accepted on Windows and not integrated. Root owns public export/registration, manifests and lockfile, RPC/protocol/callers, Git, integration, comparative Windows execution, packaging, and installation.

Audit closure remains **11/12 = 91.7%**, medium confidence, change **+0**. Test migration/native capability evidence improved without closing the publication-held E5 group or proving whole-product fidelity. The next milestone is comparative native-Windows execution followed by root-owned integration; the 24-hour completion risk remains **high**.
