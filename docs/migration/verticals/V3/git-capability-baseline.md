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

**This table is INERT DATA, not a runnable discovery plan.** Do not feed a
row's `preferred_command`/`fallback_command` straight to a process spawn as
a "try preferred, fall back on rejection" probe. As written, several rows
are unsafe or invalid to run bare:

- `fetch-no-write-fetch-head`'s commands are a real, unbounded `git fetch
  origin` — a mutating network call with no timeout or scope limit.
- `merge-tree-write-tree` / `merge-tree-merge-base`'s commands omit the
  revision arguments real `git merge-tree` requires, so as written they are
  not valid invocations at all, let alone safe probes.
- `decorate-placeholder`'s `git log` commands carry no `-n`/revision range
  and would walk the entire unbounded history.

A future execution layer must redesign each row as a bounded, revision-
scoped operation wrapper before any of these commands are ever spawned, and
must hold a `git::ProbeGuard` across every fallible call the wrapper makes
between `begin_probe` and completion — including calls that bail out early
via `?` — so `finish_probe` always runs (`ProbeGuard::drop` calls it
unconditionally; see the guard-semantics tests in `git_baseline.rs`).
Until that redesign lands, treat this table as documentation only.

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

`parse_status_porcelain_v2_z` parses the NUL-delimited (`-z`) form of the
same command: records are NUL-terminated instead of newline-terminated,
paths are never C-quoted (`-z` disables path quoting entirely — verified
live, see below), and a rename/copy entry's `origPath` is its own separate
NUL-terminated token rather than tab-appended to the same record (also
verified live via a hex dump of real `git status --porcelain=v2 -z` output
after `git mv`).

Paths in the line-oriented form may be **C-quoted** per `core.quotePath`
(see `git-config(1)`): wrapped in `"…"` with `\\`, `\"`, the standard C
control-char escapes (`\n`, `\t`, `\r`, `\a`, `\b`, `\f`, `\v`), and octal
`\NNN` byte escapes — verified live against real Git for a leading space
(not quoted — space is not a quoting metacharacter), a literal backslash,
a literal double quote, a literal tab, a literal newline, a lone control
byte (quoted as octal `\NNN`, not a named escape), and multi-byte non-ASCII
characters (each byte of the UTF-8 encoding gets its own chained `\NNN`,
reassembled by the parser before UTF-8 decoding). `parse_ab` (used for the
`branch.ab` header) is written char-by-char rather than byte-index
`split_at`, so a multi-byte UTF-8 byte in a malformed field can never panic
on a non-char-boundary split — it always falls through to
`invalid_argument`.

## ProbeGuard and the inert probe plan

`baseline_probe_plan()` is explicitly documented (module doc comment on the
function, and the matrix section above) as **inert data, not an executable
discovery procedure** — several rows are unsafe (unbounded `git fetch
origin`) or outright invalid (`merge-tree` calls missing required revision
arguments; unbounded `git log`) to spawn bare. `git::ProbeGuard` is the RAII
type a future execution layer must hold across every fallible probe call
between `begin_probe` and completion: `Drop` calls `finish_probe`
unconditionally, so a bail-out via `?` can never leave a `(scope,
capability)` pair permanently stuck reporting `Follower`. Guard semantics
(drop-calls-finish, in-flight-until-dropped, finish-runs-even-on-early-
`Err`-return) are covered by dedicated tests in `git_baseline.rs`.

## Verification

```
cargo test -p drogon-core --test git_baseline
```
Result: **59 passed; 0 failed; 0 ignored.**

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
- `ProbeGuard`: drop calls `finish_probe`, the probe stays in-flight until
  the guard drops, and `finish_probe` runs even when a fallible call bails
  out early via `?` before reaching the guard's natural scope end.
- `baseline_probe_plan`: covers all 7 capabilities with a non-empty
  fallback, a representative ordering assertion, and determinism (no
  process/cache side effects).
- Porcelain v2 line-form parsing: header + ordinary entry, rename, copy,
  unmerged conflict, untracked/ignored, a mixed multi-line document, and
  C-quote unescaping (backslash, double quote, newline, tab, a lone octal
  control byte, and chained-octal multi-byte non-ASCII characters, on both
  a `?` entry and a rename's `path`/`origPath`).
- Porcelain v2 `-z`-form parsing: header + ordinary entry, a rename with a
  NUL-separated (not tab-separated) `origPath`, proof that `-z` paths are
  never C-unquoted, leading-space preservation, and empty input.
- Leading-space preservation: a `?`/`!` path with one, two, or three extra
  leading spaces past the mandatory format-separator space keeps all but
  the separator, in both the line and `-z` forms.
- Malformed input rejection: too-few-fields for ordinary and unmerged,
  missing tab separator on rename, unknown line prefix, non-numeric
  `branch.ab` (including two non-ASCII regression cases that used to panic
  via `split_at(1)` on a non-char-boundary byte index), empty untracked
  path, and C-quote failures (truncated escape, truncated octal, unknown
  escape character).
- Real-fixture round-trips: a throwaway repo built with the actual local
  `git` binary (2.50.1), asserting the parser recovers exact filenames for
  a leading space, a non-ASCII character, an embedded tab, and a rename —
  for both the line form and the `-z` form. These are **not** a substitute
  for the separate 2.25.5/2.38.1/2.49.1 CI matrix (see below); they prove
  agreement with one real, modern Git binary, not the full compatibility
  floor.

## Explicitly out of scope for this change

- No process spawning in `src/git.rs` itself — `baseline_probe_plan` is
  data only; the real-git fixture generation lives in the test file
  (`git_baseline.rs`), not in the module under test.
- No wiring into `lib.rs` or the RPC surface.
- No live 2.25.5/2.38.1/2.49.1 CI matrix run (unverifiable on this host;
  see environment baseline above). The real-fixture tests added here run
  only against the installed 2.50.1 binary — they close the "does the
  parser survive real Git's actual byte-for-byte quoting/NUL-delimiting
  behavior" gap, not the "does it survive the historical floor" gap. That
  older-binary gap remains a synthetic-only matrix (unit tests against
  hand-written fixtures modeled on the documented format), honestly
  unverified against a real pre-2.25/2.36 binary on this host.
- No redesign of `baseline_probe_plan` into safe operation wrappers — this
  change only documents the plan as inert and adds the `ProbeGuard` shape
  a future execution layer must use; it does not implement that layer.
