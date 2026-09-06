# Windows path-compatibility correction — evidence record

Leaf: Kimi For Coding (`kimi-for-coding/kimi-for-coding`), task_8381e7b4ffa2.
This is an **additive** record under
`tests/parity/ports/WP-ENG-RUNTIME/native-claim-identity/windows-compatibility/`;
no existing vector inputs or historical reports were modified. Root's
independently verified 20 vectors and prior child reports remain valid and are
**not** relabeled as final integrated acceptance.

## The compatibility bug

`canonicalize_agent_session_identity` signs the canonical transcript path for
Pi/Prime identities. On Windows:

- **Rust `std::fs::canonicalize`** documents: "On Windows, this converts the
  path to use extended length path syntax" — i.e. it returns
  `\\?\C:\Foo\Bar` for ordinary drive paths and `\\?\UNC\Server\Share\X`
  for ordinary UNC paths (CreateFile + GetFinalPathNameByHandle).
- **The pinned source** signs `normalize(realpathSync(value))` lowercased
  with `toLocaleLowerCase('en-US')`, and Node 24.19.0's `realpathSync`
  (lib/fs.js, lines 2772–2900) is a pure-JS walk over
  `path.resolve(p)` output that returns **ordinary** spellings
  (`C:\Foo\Bar`, `\\Server\Share\X`) and preserves only **explicitly typed**
  device namespaces.

The previous port lowercased Rust's canonical output as-is, so on Windows it
would sign `\\?\c:\...` where the source signs `c:\...` — different identity
digest bytes for the same session, breaking wire compatibility.

## Source-backed expected behavior (established before editing)

Primary sources read (all pinned/fetched for this correction):

1. Rust std docs, `std::fs::canonicalize`
   (https://doc.rust-lang.org/std/fs/fn.canonicalize.html, std 1.98.1):
   "On Windows, this converts the path to use extended length path syntax".
2. Node **v24.19.0** `lib/fs.js` (fetched from
   `raw.githubusercontent.com/nodejs/node/v24.19.0/lib/fs.js`):
   - `realpathSync` (lines 2772–2900) does `p = pathModule.resolve(p)` and
     walks symlinks in JS; no `toNamespacedPath`, no prefix stripping; result
     returned via `encodeRealpathResult` unchanged.
   - Windows `splitRoot` (lines 2719–2726), regex
     `/^(?:[a-zA-Z]:|[\\/]{2}[^\\/]+[\\/][^\\/]+)?[\\/]*/`, keeps
     `\\?\C:\`-style device roots intact through the walk.
3. Node **v24.19.0** `lib/path.js`, `win32.resolve` (lines 190–344): a leading
   `\\?` / `\\.` is recognized as a *device root* (`firstPart !== '.' && '?'`
   test at line 280) and preserved; UNC roots are matched and kept as
   `\\server\share`.

Expected transformations on the canonical spelling (both sides then apply
en-US lowercasing, which erases casing differences between the FS-reported
casing Rust uses and the input casing Node keeps):

| Transcript input (Windows) | Node realpathSync spelling (signed by source) | Rust canonicalize spelling | Seam output |
|---|---|---|---|
| Ordinary drive `C:\Foo\Bar.txt` | `C:\Foo\Bar.txt` → `c:\foo\bar.txt` | `\\?\C:\Foo\Bar.txt` | `c:\foo\bar.txt` (strip `\\?\`) |
| Ordinary UNC `\\Server\Share\X.jsonl` | `\\Server\Share\X.jsonl` → `\\server\share\x.jsonl` | `\\?\UNC\Server\Share\X.jsonl` | `\\server\share\x.jsonl` (strip `\\?\`, remap `UNC\` → `\\`) |
| Namespaced drive `\\?\C:\Foo` (also `//?/C:/Foo`) | prefix preserved → `\\?\c:\foo` | `\\?\C:\Foo` | `\\?\c:\foo` (prefix kept) |
| Namespaced UNC `\\?\UNC\Server\Share\X` | prefix preserved → `\\?\unc\server\share\x` | `\\?\UNC\Server\Share\X` | `\\?\unc\server\share\x` (prefix kept) |
| Dot-namespace drive `\\.\C:\Foo` (also `//./C:/Foo`) | device root preserved → `\\.\c:\foo` | `\\?\C:\Foo` | `\\.\c:\foo` (reconstruct `\\.` on canonical bytes) |
| Dot-namespace UNC `\\.\UNC\Server\Share\X` | device root preserved → `\\.\unc\server\share\x` | `\\?\UNC\Server\Share\X` | `\\.\unc\server\share\x` (reconstruct `\\.` on canonical bytes) |
| Symlink `...\Link.jsonl` → target `...\Target.jsonl` | target spelling, ordinary form → lowercased | `\\?\`-prefixed target | prefix-stripped lowercased target |

The dot-namespace rows were added in the second correction round
(task_bc62f713fc08). Source proof: Node v24.19.0 `lib/path.js`
`win32.resolve` (lines 280–289) treats a leading `\\?`/`\\.` as a device
root — "We matched a device root (e.g. \\\\.\\PHYSICALDRIVE0)" — and keeps
the typed namespace character verbatim in `resolvedDevice`; `isPathSeparator`
(lines 65–67) accepts both `/` and `\`, so `//./C:/Foo` normalizes to
`\\.\C:\Foo`; and `lib/fs.js` `splitRoot` (lines 2719–2726) keeps the device
root through the realpath walk. Rust canonicalize, by contrast, always
reports the `\\?\` form, so the seam reconstructs the source namespace
spelling on the canonical target bytes (single-character prefix swap).

Not handled (documented limitations, not silently equated):

- Volume-GUID spellings (`\\?\Volume{GUID}\...`): never remapped; only the
  `\\?\` prefix (or `\\?\UNC\`) that Rust documents for ordinary paths is
  touched. For an explicitly typed `\\.\Volume{GUID}\...` input the seam
  swaps the namespace character on the canonical bytes just like drive/UNC
  forms; exotic `\\.\` device objects beyond drive/UNC paths (e.g.
  `\\.\PHYSICALDRIVE0`) are not realistic transcript paths and their
  canonicalization is not guaranteed to succeed at all.
- `toLocaleLowerCase('en-US')` is approximated with Unicode default
  lowercasing (`str::to_lowercase`); these agree for every realistic path
  character (locale-specific differences only exist for tr/lt/az-style
  special casings).

## The correction

- New pure seam `crates/drogon-core/src/claim_identity/windows_path.rs`:
  `normalize_windows_canonical_path(original, canonical)` — no filesystem
  access, callable (and tested) on any host; applied only under
  `cfg(windows)` in `canonical_path_for_platform`.
- It strips `\\?\` and remaps `\\?\UNC\` → `\\` **only when the original
  input was not explicitly namespaced** (`\\?`/`\\.` device root in either
  separator style, matching Node's `path.win32.resolve`); explicitly
  namespaced inputs keep the prefix, matching the source. No blanket prefix
  removal.
- `signer.rs` doc comment corrected: it now states explicitly that separate
  source processes can race (one reading between another's `openSync('wx')`
  and `writeFileSync`), that the source's synchronous guarantee is
  same-process only, and that the deliberate bounded Rust settle behavior is
  retained unchanged.

## Tests-first gate

- **Setup failure:** none — the seam landed with a compiling
  prefix-preserving (wrong) implementation, so the new tests compiled.
- **Behavioral RED, round 1 (recorded):**
  `cargo test -p drogon-core --test claim_identity --locked windows_pure`
  → **3 passed, 2 failed** (assertion mismatches, not import errors): got
  `\\?\c:\foo\bar.txt` vs expected `c:\foo\bar.txt`, and
  `\\?\unc\server\share\x.jsonl` vs expected `\\server\share\x.jsonl`.
- **GREEN round 1:**
  `cargo test -p drogon-core --test claim_identity --locked` → **37 passed,
  0 failed, 0 skipped** (32 pre-existing tests/assertions preserved
  unchanged + 5 pure normalization tests; 2 `cfg(windows)` real-filesystem
  tests compiled out on this macOS host).
- **Behavioral RED, round 2 (dot namespace, task_bc62f713fc08):** the two new
  dot-namespace regressions failed against the round-1 behavior —
  `\\?\c:\foo` vs expected `\\.\c:\foo` and `\\?\unc\server\share\x` vs
  expected `\\.\unc\server\share\x` — before the seam learned to reconstruct
  the source namespace spelling.
- **GREEN round 2:**
  `cargo test -p drogon-core --test claim_identity --locked` → **39 passed,
  0 failed, 0 skipped** (all 37 round-1 tests preserved + 2 new pure
  dot-namespace tests; the 2 `cfg(windows)` real-filesystem tests remain
  compiled out on this host). `cargo test -p drogon-core --locked` all
  targets green; `cargo check --workspace --locked` clean.

## Platform limitations (honest)

- All pure mapping tests execute on macOS and prove the **string
  transformation only**; they are **not** Windows runtime evidence.
- The 2 `cfg(windows)` real-filesystem tests (ordinary path + symlink
  resolution through the production canonicalization) **executed nowhere in
  this correction: Windows execution unavailable on the macOS development
  host**. They will run only on a Windows CI/dev machine; the symlink test
  additionally requires developer mode or `SeCreateSymbolicLinkPrivilege`.
  No Windows parity is claimed until such a run records results.
- Linux remains untested (unchanged code path, but no Linux run was made).

## Commands and environment

- cargo 1.98.0 / rustc 1.98.0 (Homebrew), macOS (Darwin); all cargo commands
  with `--locked`; no installs, no manifest/lockfile/export/RPC/protocol/Git
  changes; no services or global settings touched.
- `rustfmt --edition 2024 --check` clean on the owned Rust files.
- `cargo test -p drogon-core --locked`: all targets green (claim_identity
  **39/39** macOS-executed as of round 2; engine 16; others unchanged).
- `cargo check --workspace --locked`: clean.

## Round 3 — validation ordering + `pub(crate)` seam (task_9009fbf0bf1d, dispatch ctx_e4a350ff5b15)

Follow-up Sol review correction, same leaf and ownership scope.

- **Ordering fix:** the production flow previously mapped the canonical path
  through `normalize_windows_canonical_path` (producing a prefix-stripped
  PathBuf) *before* `fs::metadata` regular-file validation, discarding the
  filesystem-safe extended-length spelling that alone makes long
  (>MAX_PATH) paths statable on Windows. Refactored minimally:
  `canonical_path_for_platform` now returns the RAW `fs::canonicalize`
  PathBuf, `fs::metadata` validates the regular file on that raw PathBuf,
  and only the returned/signed transcript string passes through
  `platform_canonical_string` (the seam). Symlink target segments stay
  canonical; non-Windows behavior is byte-identical to round 2 (all 39
  host-executed tests pass unchanged — no test was weakened or removed).
- **Visibility:** `normalize_windows_canonical_path` and its re-export are
  now `pub(crate)`; root owns public interfaces. The integration test still
  reaches the seam through the path-included module (same crate).
- **Coverage:** added a third `cfg(windows)` real-filesystem test
  (`windows_long_path_survives_production_canonicalization_validation_and_signed_mapping`)
  that builds a real >MAX_PATH transcript (created via explicit `\\?\`
  filesystem calls) and, **when actually run on Windows**, exercises that
  long paths survive the production flow — `fs::canonicalize`, raw-PathBuf
  regular-file validation, and the signed-string mapping seam — and asserts
  the resulting signed string. Not executed on this macOS host; **no Windows
  runtime execution is claimed**, and the test by itself proves neither the
  ordering rationale nor any parity/divergence claim.
- **Unverified question (explicitly NOT a claim):** whether ordinary
  >MAX_PATH inputs fail in the pinned Node source on Windows (its pure-JS
  realpath stats unprefixed components) while the Rust port succeeds via
  std's internal verbatim switch — and how namespaced long inputs compare —
  is an **open question that requires an actual Windows Node 24 vs Rust
  run**. From macOS execution plus JavaScript source inspection alone,
  **neither parity nor divergence is claimed** here; JavaScript source alone
  does not prove the behavior of Node's native `lstat` bindings, and Rust
  `fs::metadata` path conversion is likewise unverified on Windows.
- **Counts:** 42 `#[test]` functions total (39 executed on macOS + 3
  `cfg(windows)` gated: ordinary, symlink, long-path). GREEN round 3:
  `cargo test -p drogon-core --test claim_identity --locked` → **39 passed,
  0 failed, 0 skipped**; `cargo test -p drogon-core --locked` all targets
  green; `cargo check --workspace --locked` clean. No new RED round was
  needed (pure tests untouched; refactor verified by the preserved suite).

## Round 4 — evidence-accuracy rewording, no behavior change (task_16ae3bb28240, dispatch ctx_091d67c81a93)

Final evidence-accuracy correction by the same leaf; test framing and reports
only.

- The round-3 long-path test and reports described Windows behavior the leaf
  cannot verify: primary JavaScript source alone does not prove the behavior
  of Node's native `lstat` bindings, and Rust `fs::metadata` path conversion
  is unverified on Windows. The test was renamed to
  `windows_long_path_survives_production_canonicalization_validation_and_signed_mapping`
  and its comments now state it **will exercise**, when actually run on
  Windows, that long paths survive production canonicalization, raw
  validation, and signed-string mapping — not that it proves the alternative
  ordering by itself. **No assertion, count, or production code changed.**
- The claimed ordinary/namespaced >MAX_PATH source divergence is replaced by
  an explicit **unverified question**: actual Windows Node 24 vs Rust
  execution is required before any parity or divergence claim; none is made
  from macOS/source inspection.
- Preserved intact: the source-backed ordinary drive/UNC/explicit-namespace/
  symlink mapping, all 39 host-executed tests, all 3 `cfg(windows)` gated
  tests, prior genuine RED records, the internal `pub(crate)` seam, and the
  round-1–3 provenance. GREEN re-verified after the comment-only edit:
  `cargo test -p drogon-core --test claim_identity --locked` → **39 passed,
  0 failed** (42 `#[test]` fns total, unchanged).

## Integration boundary

This correction fixes string-level canonical-path compatibility for the
claim-identity module. It does not register the public library export, wire
RPC, implement leases/handle transitions, or constitute packaged execution or
integrated acceptance; those remain root-owned steps.

## Hashes (SHA256, final — round 4, task_16ae3bb28240)

- `crates/drogon-core/src/claim_identity/mod.rs`: `d8e5621358aa78063bcc22639cd1915ea0c1993d9ca2299a6f0b3af997f45d00` (unchanged since round 3)
- `crates/drogon-core/src/claim_identity/resume.rs`: `4b0a00ea7dee39bbd5f2850d0fcc634bfc0a0c6c29b90d207c6f2d173fe95d54` (unchanged)
- `crates/drogon-core/src/claim_identity/signer.rs`: `a3b85db9866c893fbc2d697489ba7f39241eaa4d20b54606e918c1a14aa764c6` (unchanged since round 1)
- `crates/drogon-core/src/claim_identity/windows_path.rs`: `84d2336ad808463f02698698e91b23ce07d293dc7cbf4dca90f12cdc33d6b866` (unchanged since round 3)
- `crates/drogon-core/tests/claim_identity.rs`: `3341422aeb42d8ddfcda871ce689a637c96b06a83c68552752e881f9de5f897b` (round 4: comment-only rewording and rename of the cfg(windows) long-path test; assertions/counts unchanged)

Round 3 hashes superseded: `tests/claim_identity.rs`
`1b469227226a6b739f21a3895a9e49f0ed6eaf39fafbc484723622b47f05a246`.

Round 2 hashes superseded: `mod.rs`
`ae2156c38b9169b7cbc4e9d7024df8247ed41ab0e52353fcc0e821144bd370ce`,
`windows_path.rs` `b98e14438976082deedc45ceb9e487c8eba6e763d26a4c54b0602522c55321f3`,
`tests/claim_identity.rs` `87a11bdc11706142cf9b3d2540e29a3960f00038d354f9ed41899324931bf985`.
