# V3 — Git worktree-list parser + safe-creation validator

Bounded change: `crates/drogon-core/src/git_worktree.rs` +
`crates/drogon-core/tests/git_worktree.rs`. Pure/std-only, no process
spawning, no filesystem I/O — data structures and parsers only. Not wired
into `lib.rs` or the RPC surface yet (same `#[path]`-include pattern as
`git_baseline.rs` / `workspace_files_explorer.rs`). `crates/drogon-core/src/git.rs`,
`lib.rs`, Cargo files and the protocol crate were read for context only and
were **not** modified by this change.

## Environment baseline (real, observed on this host)

```
$ git --version
git version 2.50.1 (Apple Git-155)
```

Recorded 2026-09-07 on this development host (macOS, Apple Git build), the
same host `git-capability-baseline.md` records. This binary is well above
the Git 2.25 compatibility floor and above the `worktree list -z` (2.36)
threshold, so it exercises the preferred `-z` path natively.

### Live-verified real-Git facts that shaped this module

Both captured directly against the installed `git worktree` on this host,
run against this worktree checkout's own multi-worktree state:

- `git worktree list -z` **without** `--porcelain` fails on this real Git
  2.50.1 binary:
  ```
  $ git worktree list -z
  fatal: the option '-z' requires '--porcelain'
  ```
  Update (probe-fix leaf, verified by V3 leader against real Git):
  `crates/drogon-core/src/git.rs`'s `baseline_probe_plan()` now lists the
  `WorktreeListZ` preferred command as `["worktree", "list", "--porcelain",
  "-z"]` with fallback `["worktree", "list", "--porcelain"]`, matching what
  this host's real Git accepts; `tests/git_baseline.rs` (31 tests) asserts
  the flag and the fallback shape. This module's own
  `worktree_list_probe_plan()` (see below) agrees with the corrected plan.
- `git worktree list --porcelain -z` output shape, confirmed with `od -c`:
  fields are NUL-terminated (`worktree <path>\0HEAD <sha>\0branch <ref>\0`),
  and each record ends with an extra NUL producing an empty field
  (`...\0\0`) as the record separator. `parse_worktree_list_porcelain`'s
  NUL-delimited branch matches this exactly.
- `git worktree list --porcelain` (no `-z`) output shape, confirmed
  directly: the same field vocabulary, one `key value` (or bare `key`) per
  line, records separated by a blank line. This is the pre-2.36 line-block
  fallback the parser's second branch implements.

### Synthetic-only on this host

No Git binary older than 2.50.1 is installed here, so the following are
exercised only via hand-constructed fixtures in `git_worktree.rs`, not
against a real older binary:

- The legacy `--porcelain` line-block form itself (real Git 2.50.1 still
  emits it when `-z` is omitted, so the *shape* is live-verified above, but
  its status as "the pre-2.36 fallback" — i.e. that older Git accepts
  `--porcelain` without understanding `-z` — is not verified against an
  actual pre-2.36 binary).
- `locked`/`prunable` annotations on Git 2.31–2.35: same field shape tested
  here (`locked`, `locked <reason>`, `prunable`, `prunable <reason>`), not
  verified against a binary in that version range.
- The path-existence probe that restores `prunable` detection for Git
  before 2.31 (per `docs/reference/git-compatibility.md`'s
  `worktree-list-z` row): **not implemented in this module.** This module
  is pure/std-only with no filesystem access (matching `git.rs`'s
  convention), and that probe requires stat-ing each listed worktree path,
  which is I/O. It is out of scope here and would need to live in a caller
  that has filesystem access; flagged as an explicit gap, not silently
  assumed.

## Parser: `parse_worktree_list_porcelain`

Single entry point; auto-detects form by NUL-byte presence in the input
(`-z` output always contains embedded NULs, the legacy line-block form
never does):

- NUL-delimited: splits on `\0`; an empty token ends the current record.
- Legacy line-block: splits on `\n`; a blank line ends the current record.

Both branches share one record builder. Recognized field lines per record:
`worktree <path>` (must be first, non-empty), `HEAD <sha>`,
`branch <ref>`, bare `bare`, bare `detached`, `locked` / `locked <reason>`,
`prunable` / `prunable <reason>`. `WorktreeEntry.locked` /
`.prunable` capture presence only (bool) — the optional free-text reason
after either keyword is not preserved, matching this module's field list.
An unrecognized line, a record missing its leading `worktree` line, or an
empty `worktree` path returns `invalid_argument` (`error::invalid_argument`
from `crates/drogon-core/src/error.rs`) rather than panicking or silently
dropping the record.

## `worktree-list-z` probe plan (string-keyed, no enum duplication)

`crate::git::Capability` is not reachable from this module: `git.rs` is not
declared as `mod git;` in `lib.rs`; it exists only as a `#[path]`-included
test module today (per `git_baseline.rs`'s own comment). This module
therefore exposes `WORKTREE_LIST_Z_CAPABILITY_KEY = "worktree-list-z"` as a
plain string constant instead of importing or re-declaring the enum.
`tests/git_worktree.rs` cross-checks this constant against the real
`Capability::WorktreeListZ.key()` by `#[path]`-including `src/git.rs`
alongside `src/git_worktree.rs` and `src/error.rs`, so the string cannot
silently drift from the enum without a test failure — while production code
in `git_worktree.rs` stays independent of `git.rs`'s wiring state.

## Safe-creation validator: `validate_worktree_add(root, path, branch)`

Pure lexical validation — no filesystem access, so a symlink-based escape
cannot be detected here; that is an explicit limitation, not an oversight.

- `root`, `path`, `branch`: NUL byte anywhere → `invalid_argument`.
- `path`: empty → `invalid_argument`.
- `path`: absolute (leading `/`, leading `\`, or a Windows drive-letter form
  like `C:\x` / `C:/x`, checked even on a non-Windows build host because a
  worktree-add plan may target a Windows or WSL execution host) →
  `invalid_argument`.
- `path`: any `/`- or `\`-delimited segment equal to `..` → `invalid_argument`
  (this is the "escapes root" check: combined with the absolute-path
  rejection above, a path that is neither absolute nor contains a `..`
  segment cannot lexically leave `root`).
- `branch` (when `Some`): empty, containing whitespace or a control
  character, containing `~^:?*[`, starting with `-` or `/`, containing
  `..`, or ending in `.lock` → `invalid_argument`. `branch: None` skips
  branch validation entirely (path-only `worktree add` is valid).

## Verification

```
cargo test -p drogon-core --test git_worktree
```
Result: **41 passed; 0 failed; 0 ignored.** (Also demonstrated RED first:
temporarily moved `src/git_worktree.rs` aside and confirmed
`tests/git_worktree.rs` fails to *compile* — "couldn't read
.../src/git_worktree.rs: No such file or directory" — before restoring the
module and re-running to green.)

```
cargo clippy -p drogon-core --all-targets --locked -- -D warnings
```
Result: **zero warnings/errors.** The only lint suppression is
`#[allow(dead_code)]` on the `#[path]`-included `error.rs` and `git.rs`
modules in the test file (mirrors `git_baseline.rs`'s pattern), because
each module's constructors/methods unused by this specific test crate are
real, used-elsewhere code, not actually dead. `git_worktree.rs` itself
carries no lint suppressions.

## Test coverage summary

- NUL-delimited (`-z`) parsing: plain entry with branch, detached, bare,
  locked with/without a reason, prunable with a reason, a path containing
  spaces, and multiple entries in order.
- Legacy line-block parsing: the same matrix (branch entry, detached+bare,
  locked+prunable annotations, a path with spaces), plus empty input
  parsing to an empty list.
- Malformed rejection: a record missing its `worktree` line (both forms),
  an empty `worktree` path, and an unrecognized field line (both forms).
- `validate_worktree_add` accept matrix: plain relative path, a relative
  path with spaces, a valid branch name, and a nested relative path without
  `..`.
- `validate_worktree_add` reject matrix: absolute Unix path, Windows
  drive-letter absolute path, `..` traversal (direct, nested, and via
  backslash segments), NUL byte in path/root, empty path, and every branch
  rule (space, control character, each of `~^:?*[`, leading `-`, leading
  `/`, embedded `..`, `.lock` suffix, empty, NUL byte).
- Probe plan: the string capability key matches
  `Capability::WorktreeListZ.key()` from `git.rs`, and the preferred command
  carries `--porcelain` ahead of `-z` (the live-verified real-Git
  requirement above).

## Explicitly out of scope / unverified

- No process spawning anywhere in this module.
- No wiring into `lib.rs` or the RPC surface.
- No filesystem I/O; the pre-2.31 `prunable` path-existence probe is not
  implemented here (see "Synthetic-only on this host" above) — a real gap,
  not a silent omission.
- No live pre-2.36 Git binary was available to verify the legacy
  line-block fallback or the 2.31–2.35 locked/prunable annotation shape
  against; both are covered only by synthetic fixtures in
  `tests/git_worktree.rs`.
- Did not modify `crates/drogon-core/src/git.rs`'s existing (and, per the
  live check above, arguably incorrect) `WorktreeListZ` preferred command —
  out of this change's exclusive file list; flagged in the report instead.
