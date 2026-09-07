# V3 — Git capability baseline module

Bounded change: `crates/drogon-core/src/git.rs` +
`crates/drogon-core/tests/git_baseline.rs`. Pure/std-only, no process
spawning in this change — data structures and parsers only. Not wired into
`lib.rs` or the RPC surface yet (same `#[path]`-include pattern as
`workspace_files_explorer.rs`, per `docs/migration/parity-test-porting.md`
row T10).

## Environment baseline (real, observed on this host)

```
$ git --version
git version 2.50.1 (Apple Git-155)
```

Recorded 2026-09-07 on this development host (macOS, Apple Git build). This
is the **installed** binary the module was developed against — it is well
above the 2.25 compatibility floor, so it exercises none of the fallback
paths at runtime on this machine. **Unverified on this host:** a real Git
2.25.x binary is not installed here, so the pre-2.25 fallback branches
(serialized `FETCH_HEAD`, line-block `worktree list`, legacy `rev-parse`
output, `for-each-ref` without `--exclude`, `merge-tree` without
`--write-tree`/`--merge-base`, `%D` decoration) are validated only by the
unit tests in `git_baseline.rs` against synthetic input, not by a live
2.25.5/2.38.1/2.49.1 matrix run. Per
`docs/reference/git-compatibility.md#ci-contract`, that three-binary matrix
is a separate CI obligation this change does not attempt to satisfy or
fake.

## Probe / fallback matrix

Source of truth: `docs/reference/git-compatibility.md#current-capabilities`.
`baseline_probe_plan()` returns this table as data (preferred command,
fallback command); it does not spawn Git.

| Capability key                | Preferred command                                              | Fallback command                    |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| `fetch-no-write-fetch-head`    | `git fetch --no-write-fetch-head origin`                         | `git fetch origin` (serialize per worktree Git dir before 2.29) |
| `worktree-list-z`              | `git worktree list -z`                                           | `git worktree list` (line-block parse) |
| `rev-parse-path-format`        | `git rev-parse --path-format=absolute --git-dir`                 | `git rev-parse --git-dir` (resolve relative output against scanned repo) |
| `for-each-ref-exclude`         | `git for-each-ref --exclude=refs/remotes/*/HEAD refs/remotes`    | `git for-each-ref refs/remotes` (filter remote HEAD in Orca) |
| `merge-tree-write-tree`        | `git merge-tree --write-tree`                                    | `git merge-tree` (older two-commit form, no conflict summary) |
| `merge-tree-merge-base`        | `git merge-tree --write-tree --merge-base`                       | `git merge-tree --write-tree` (caller supplies no pre-resolved base) |
| `decorate-placeholder`         | `git log --format=%(decorate:separator=<0x1f>)`                  | `git log --format=%D` (fails open: unexpanded placeholder Git echoes verbatim, so both forms are requested and picked at parse time — see `docs/reference/git-compatibility.md#placeholders-that-fail-open`) |

## Capability cache semantics

- `HostScope`: `Native`, `Wsl(distro)`, `Ssh(provider)`, `Relay(relay_id)`.
  A rejection recorded under one scope is invisible to every other scope
  (including a different WSL distro or SSH provider).
- `record_rejection(scope, capability)` remembers a rejection with a
  timestamp; `is_rejected` reads it back.
- `should_retry(scope, capability, interval)` is `true` when the capability
  was never rejected for that scope, or the rejection is at least `interval`
  old — the self-heal path for an in-place Git upgrade. `record_success`
  clears the memory once a retried probe succeeds.
- `begin_probe`/`finish_probe` give single-flight coalescing shape per
  `(scope, capability)`: the first caller is the `Leader` (must run the
  probe), concurrent callers before `finish_probe` get `Follower` (must not
  duplicate the spawn). This module does not itself spawn or block; it only
  hands back the leader/follower decision.

## `status --porcelain=v2` baseline parser

`parse_status_porcelain_v2` covers the stable v2 subset only: `# branch.*`
header lines (`oid`, `head`, `upstream`, `ab`) and entry lines `1`
(ordinary), `2` (rename/copy, tab-separated `path`/`origPath` with a
`R###`/`C###` score), `u` (unmerged/conflict), `?` (untracked), `!`
(ignored). It never assumes a field introduced after Git 2.25. Malformed
lines (too few fields, missing tab separator, unknown line prefix, non-
numeric `branch.ab`, empty path) return `invalid_argument` — never a panic
or a silently dropped entry.

## Verification

```
cargo test -p drogon-core --test git_baseline
```
Result: **29 passed; 0 failed; 0 ignored.**

```
cargo clippy -p drogon-core --all-targets --locked -- -D warnings
```
Result: **zero warnings/errors.** No file-top `#[allow(dead_code)]`; the
only lint suppression is the single `#[allow(dead_code)]` on the
path-included `error.rs` module in the test file (mirrors
`workspace_files_explorer.rs`), because that module's unused-by-this-test
constructors are real, used-by-the-lib code, not actually dead.

## Test coverage summary

- Per-scope isolation: native/WSL/SSH/relay, and distinct SSH providers,
  and distinct capabilities on the same scope.
- Retry-after-interval self-heal: no retry immediately after rejection,
  retry once the interval elapses (a zero interval proves the boundary
  without a real sleep), retry when never rejected, and `record_success`
  clearing a healed rejection.
- Concurrent-probe coalescing shape: leader-then-follower for the same
  `(scope, capability)`, a fresh leader round after `finish_probe`, and
  independent in-flight state per scope.
- `baseline_probe_plan`: covers all 7 capabilities with a non-empty
  fallback, a representative ordering assertion, and determinism (no
  process/cache side effects).
- Porcelain v2 parsing: header + ordinary entry, rename, copy, unmerged
  conflict, untracked/ignored, and a mixed multi-line document.
- Malformed input rejection: too-few-fields for ordinary and unmerged,
  missing tab separator on rename, unknown line prefix, non-numeric
  `branch.ab`, and empty untracked path.

## Explicitly out of scope for this change

- No process spawning — `baseline_probe_plan` is data only.
- No wiring into `lib.rs` or the RPC surface.
- No live 2.25.5/2.38.1/2.49.1 CI matrix run (unverifiable on this host;
  see environment baseline above).
