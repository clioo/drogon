# V3 — Bounded read-only Git operation wrapper (PROPOSAL — UNAPPROVED)

> **STATUS: PROPOSAL ONLY. NOT APPROVED. NOT IMPLEMENTED.**
> Every function signature, type, and constant below is a design sketch for
> review, not a committed API. This document does not authorize writing
> `crates/drogon-core/src/git_process.rs` (or any other new module file) —
> the task that produced this document was scoped to parser corrections in
> `git.rs` / `git_worktree.rs` plus this proposal, with wrapper
> *implementation* explicitly excluded. No code in this repository calls or
> depends on anything named here.

## Scope

A bounded wrapper around exactly two read-only Git operations, over the
**authoritative workspace host** only (native execution — see
`docs/migration/verticals/V3/host-routing-contracts.md` for the
authoritative-host concept; this proposal does not address routing a probe
to a remote/WSL/relay host, only running it once a caller has already
resolved which host is authoritative):

- `git status --porcelain=v2 [-z]`
- `git worktree list --porcelain [-z]`

No other Git subcommand. Explicitly and permanently **out of scope for this
wrapper**: `fetch`, any network operation, any mutating operation (`worktree
add`, `commit`, `merge`, `rebase`, `push`, etc.), and the `merge-tree` /
`for-each-ref` / `rev-parse` / `log --decorate` capabilities `git.rs`'s
`baseline_probe_plan()` already flags as unsafe-to-spawn-as-written. A future
wrapper for those is a separate proposal; this one is deliberately narrow so
its safety properties (bounded time, bounded bytes, no side effects) are
easy to audit in one document.

## Why a wrapper is needed at all

`git.rs` and `git_worktree.rs` are pure/std-only: no process spawning, no
I/O (see both files' module doc comments). Something has to actually run
`git` and feed its stdout to `parse_status_porcelain_v2[_z]` /
`parse_worktree_list_porcelain`. Today nothing in this crate does that for
these two operations — `baseline_probe_plan()`'s table is explicitly
documented as **inert data, not a runnable plan** (`git.rs`'s `# INERT
DATA` doc comment on that function), and there is no other call site. This
proposal is that missing execution layer, scoped to the two operations safe
enough to run unconditionally on every workspace-status-refresh /
worktree-list request.

## Reused native process abstraction (read-only inspection only)

`crates/drogon-core/src/session.rs` is this crate's only existing
process-spawning code (`session::spawn`, read for context, **not modified**
by this proposal or by the change that produced it). It uses
`portable_pty::{CommandBuilder, native_pty_system}`: `CommandBuilder::new(command)`
followed by discrete `.arg(...)`/`.args(...)` calls — never a shell string —
and a PTY (`native_pty_system().openpty(...)`) sized by `cols`/`rows`, with
the resulting `Box<dyn Child>` reaped by a dedicated reader thread
(`spawn_reader_thread`) into a ring buffer (`crate::ring::RingBuffer`)
consumed via `session.read`'s cursor/`limitBytes` pair.

Two things about `session::spawn` this proposal deliberately does **not**
reuse, and why:

- **The PTY itself.** `session::spawn` exists for interactive, potentially
  long-lived terminal sessions the caller resizes and streams from over
  time. A `git status`/`git worktree list` probe is a single bounded
  request/response with no terminal semantics (no cols/rows, no interactive
  input) — allocating a PTY for it is unnecessary OS resource use and, on
  some platforms, changes Git's own output behavior (a PTY can make some
  tools emit color/paging escape codes that a pipe would not; `--porcelain`
  forms shouldn't trigger this, but a plain pipe removes the question
  entirely).
- **The durable session row / incarnation / ring-buffer-with-cursor
  machinery** (`db.rs` session table, `SessionHandle`, `session.list`
  visibility). A read-only probe has no reason to persist a row, survive a
  service restart, or be independently resumable — it either finishes
  inside its own timeout or it didn't happen, and the caller already has
  the answer synchronously.

What **is** reused, as an explicit pattern precedent (not a shared type):
the "always build the child's argv as a discrete vector, never a shell
string" discipline `CommandBuilder::new(command).args(args)` already
establishes in this crate. The proposed wrapper below applies the same
discipline via plain `std::process::Command`, which is the correct-shaped
primitive for a bounded, non-interactive, piped-output child process (it
natively supports `stdout(Stdio::piped())` capture and doesn't require
tearing down a PTY master/slave pair for a single-shot call).

## Proposed types and signatures (UNAPPROVED)

```rust
// Proposed location: a NEW module, crates/drogon-core/src/git_process.rs.
// Not created by this proposal. Depends on crate::git (HostScope,
// CapabilityCache, Capability, ProbeGuard) and crate::git_worktree
// (parse_worktree_list_porcelain), which per both modules' doc comments are
// not currently declared in lib.rs — wiring `mod git;` / `mod git_worktree;`
// (or an equivalent path) is itself an unapproved, undecided prerequisite
// this proposal does not resolve.

use std::time::Duration;

/// Which of the two approved read-only operations to run. Intentionally not
/// a general "run any git subcommand" API — every variant here corresponds
/// to exactly one row in `RUNNABLE_OPERATIONS` below, so adding a new
/// operation requires a reviewed code change, not a caller-supplied string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadOnlyGitOperation {
    Status,
    WorktreeList,
}

/// Caller-supplied execution bounds. Both fields are mandatory (no
/// "unbounded" default) so a call site cannot silently opt out of the two
/// properties that make this wrapper safe to run unconditionally.
#[derive(Debug, Clone, Copy)]
pub struct GitProbeBudget {
    /// Wall-clock budget for the child process, start to reap. Exceeding it
    /// kills the child (see "Timeout handling" below) and returns
    /// `unverifiable`, never a partial/truncated success.
    pub timeout: Duration,
    /// Maximum stdout bytes read from the child before the wrapper stops
    /// reading and kills it. Protects the caller's own memory/parse cost
    /// from a pathologically large repository; NOT a Git-side flag (Git has
    /// no "cap my own output" option for these subcommands).
    pub max_stdout_bytes: usize,
}

/// One resolved, ready-to-run invocation. Never holds a shell string —
/// `argv` is the exact `Vec<String>` `std::process::Command` will receive
/// one element at a time via `.args()`. Built by `resolve_invocation` below;
/// callers never hand-assemble one, so there is exactly one code path that
/// decides preferred-vs-fallback and applies the global `-c` prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedGitInvocation {
    pub argv: Vec<String>,
    /// True when this is the pre-2.36 / pre-`-z` fallback form (i.e. the
    /// caller's preferred command was rejected by the narrow predicate in
    /// `is_capability_unsupported_error` and this is the retry). Exposed so
    /// callers can log/metric a fallback event without re-deriving it from
    /// `argv`.
    pub used_fallback: bool,
}

/// Frozen, reviewed global `-c` options every invocation carries, in this
/// exact order, before the subcommand and its own arguments. "Preserved
/// verbatim" means: this wrapper never lets a caller inject, reorder, or
/// suppress any of these — they are compiled-in, not parameters.
///
/// - `-c core.quotePath=true` — pins the status-parser's C-quoting
///   assumption (`git.rs`'s `c_unquote`) against a local override in the
///   target repo's own config; without this pin a repo with
///   `core.quotePath=false` would emit raw non-ASCII/control bytes the
///   status parser's C-quote path does not expect for the *line* form (the
///   `-z` form is unaffected either way — verified live, `-z` always
///   disables quoting regardless of `core.quotePath`, see
///   `git-capability-baseline.md`).
/// - `-c color.ui=never` — belt-and-suspenders against a global
///   `color.ui=always` in the target repo's config; `--porcelain` forms are
///   documented to never emit color, so this should be a no-op, but costs
///   nothing to pin explicitly rather than trust that invariant silently.
pub const GLOBAL_OPTIONS: &[&str] = &["-c", "core.quotePath=true", "-c", "color.ui=never"];

/// Resolves `operation` against `scope`'s current `CapabilityCache` state
/// into one ready-to-run invocation, WITHOUT running it. Pure decision
/// logic: given the cache's rejection memory, decide preferred vs.
/// fallback; the caller is responsible for actually spawning `argv` via
/// `run_git_readonly` (or its own executor) and for calling
/// `record_success`/`record_rejection` afterward based on the real
/// outcome — this function only reads the cache, it never mutates it (only
/// `run_git_readonly`'s post-run bookkeeping does).
pub fn resolve_invocation(
    operation: ReadOnlyGitOperation,
    scope: &HostScope,
    cache: &CapabilityCache,
) -> ResolvedGitInvocation {
    todo!("PROPOSAL — not implemented")
}

/// Runs the resolved `invocation` against `cwd` (the target repository
/// working directory) with `budget`, and parses its stdout with the parser
/// matching `invocation`'s operation and NUL-vs-line form. This is the one
/// function that actually spawns a process; `resolve_invocation` above
/// never does.
///
/// # `ProbeGuard` contract (MANDATORY at the call site, not inside this fn)
///
/// This function does NOT itself acquire a `ProbeGuard` — `begin_probe` /
/// the guard must be acquired by the CALLER, before calling
/// `resolve_invocation`, and held across both `resolve_invocation` and this
/// call. Rationale: `resolve_invocation` reads cache state that a
/// concurrent `record_rejection`/`record_success` could race with if two
/// callers for the same `(scope, capability)` ran `resolve_invocation`
/// independently; single-flight coalescing (`CapabilityCache::begin_probe`)
/// exists precisely to prevent that duplicate work, and it only prevents it
/// if the guard spans the whole read-decide-run-record sequence, not just
/// the run. Concretely, every call site must look like:
///
/// ```rust,ignore
/// let outcome = cache.begin_probe(&scope, Capability::WorktreeListZ);
/// if outcome == ProbeOutcome::Follower {
///     // a concurrent caller already owns this (scope, capability); do not
///     // duplicate the spawn — wait/retry per the caller's own policy.
/// }
/// let _guard = ProbeGuard::new(&cache, scope.clone(), Capability::WorktreeListZ);
/// // `_guard`'s Drop calls `finish_probe` unconditionally, including on
/// // every early return below via `?` — this is the "concurrent-probe
/// // release on caller error" requirement: a caller-side error (timeout,
/// // spawn failure, parse failure, budget exceeded) must never leave the
/// // (scope, capability) pair stuck reporting Follower forever.
/// let invocation = resolve_invocation(operation, &scope, &cache);
/// let result = run_git_readonly(&invocation, &cwd, &budget)?;   // <-- guard still covers this bail-out
/// // success/failure recorded on `cache` here, still inside `_guard`'s scope
/// ```
///
/// `WorktreeList` has a real preferred/fallback capability
/// (`Capability::WorktreeListZ`) to guard this way. `Status` currently has
/// no corresponding `Capability` variant in `git.rs` (see "No fallback
/// needed for `status`" below) — a caller probing `Status` still MAY use a
/// guard for its own coalescing purposes, but there is no capability-cache
/// rejection state for it to protect.
pub fn run_git_readonly(
    invocation: &ResolvedGitInvocation,
    cwd: &std::path::Path,
    budget: &GitProbeBudget,
) -> Result<ParsedGitOutput, RpcError> {
    todo!("PROPOSAL — not implemented")
}

/// Discriminated parse result, since `Status` and `WorktreeList` parse to
/// different types (`crate::git::ParsedStatus` vs.
/// `Vec<crate::git_worktree::WorktreeEntry>`).
pub enum ParsedGitOutput {
    Status(ParsedStatus),
    WorktreeList(Vec<WorktreeEntry>),
}
```

## Timeout handling

`std::process::Command::spawn` returns a `Child` immediately; there is no
`std`-only "wait with timeout" primitive. The proposal is: spawn with
piped stdout/stderr, then poll `Child::try_wait()` in a short sleep loop
(e.g. 10 ms) against `Instant::now()` measured from spawn, reading available
stdout incrementally (see byte-cap below) between polls; on timeout,
`Child::kill()` then `Child::wait()` to reap (never leave a zombie), and
return `error::unverifiable(...)` — per this repo's `live` / `unverifiable`
/ `exited` liveness-verdict convention (`AGENTS.md`): a killed-on-timeout
probe proves neither that Git would have succeeded nor that it was hung on
something real, so its outcome is unknown, not failed. This is a design
sketch, not a reviewed concurrency design — an alternative (a dedicated
reaper thread + channel, avoiding the poll-sleep loop) should be evaluated
during actual implementation review, not decided by this document.

## Byte-cap handling

Read stdout in fixed-size chunks (e.g. 64 KiB) into a growable buffer; if
the accumulated length would exceed `max_stdout_bytes`, stop reading, kill
the child (same kill-then-wait reap as the timeout path), and return
`error::io_error(...)` with a message naming the configured cap — chosen
deliberately over `invalid_argument` (the *caller's* configured budget is
not what's invalid; something about reading the child's output stream had
to be aborted, which is closer to this crate's existing use of `io_error`
for other "an I/O operation could not be completed as requested" cases in
`error.rs`) — flagged here as a judgment call for reviewers, not a settled
mapping; see "Error mapping" below for the rest of the matrix and the same
caveat.

## Safe argv construction (no shell)

Every invocation is `std::process::Command::new("git")` followed by
`.args(invocation.argv)` where `argv` is assembled as a `Vec<String>` by
`resolve_invocation`, in this exact order: `GLOBAL_OPTIONS`, then the
subcommand and its own flags (`["status", "--porcelain=v2", "-z"]` or
`["worktree", "list", "--porcelain", "-z"]`, mirroring
`baseline_probe_plan()` / `worktree_list_probe_plan()`'s existing preferred
command shapes verbatim), then `cwd` is passed via
`Command::current_dir`, never appended to `argv` or interpolated into any
string. No element of `argv` is ever built by string concatenation of
caller-controlled data — both operations take zero caller-supplied
arguments (no path, ref, or pattern parameter reaches Git's argv at all;
`cwd` reaches Git only via `current_dir`, which the OS resolves without
shell involvement). This is a direct consequence of the wrapper covering
exactly two fixed-shape commands; a future wrapper that accepts caller
parameters (e.g. a bounded `git log <path>`) would need its own argv-safety
section, not an extension of this one's "there are no parameters" argument.

## Preferred/fallback switching — narrow predicate only, Git 2.25 baseline

`WorktreeList`'s preferred command is
`["worktree", "list", "--porcelain", "-z"]`
(`worktree_list_probe_plan()`'s existing, live-verified-on-2.50.1 shape);
its fallback is `["worktree", "list", "--porcelain"]`. The switch from
preferred to fallback must trigger on **one narrow, specifically-matched
stderr shape**, never on "any non-zero exit" or "any stderr output" — a
blanket rule would silently reclassify a real failure (permission denied,
not-a-git-repository, corrupted `.git`) as a mere version gap and retry it
against a command that will fail identically or differently, hiding the
real error from the caller.

```rust
/// Narrow, version-scoped predicate: true only for the exact "does not
/// understand -z alongside --porcelain" shape a pre-2.36 Git is expected to
/// produce for `worktree list --porcelain -z`. NOT a general "looks like an
/// unsupported-flag error" heuristic (that would over-match real errors,
/// e.g. an actually-malformed invocation elsewhere).
///
/// UNVERIFIED against a real pre-2.36 binary (none installed on the
/// development host — same gap `git-worktree-safety.md`'s "Synthetic-only
/// on this host" section already documents). The exact stderr text below is
/// an assumption modeled on Git's conventional "unknown switch" phrasing,
/// not a captured live string, and MUST be corrected against a real 2.25.x
/// or 2.3x.x binary (the project's own 2.25.5/2.38.1/2.49.1 CI matrix, per
/// `docs/reference/git-compatibility.md#ci-contract` — a doc path that,
/// as of this proposal, does not exist in this checkout; see "Missing
/// source-of-truth doc" below) before this predicate is trusted in any
/// real fallback decision.
fn is_worktree_list_z_unsupported(stderr: &str) -> bool {
    stderr.contains("unknown switch") && stderr.contains("-z")
        || stderr.contains("unknown option") && stderr.contains("-z")
}
```

The already-live-verified stderr shape
(`fatal: the option '-z' requires '--porcelain'`, `git-capability-baseline.md`
/ `git-worktree-safety.md`) is NOT the fallback trigger — the preferred
command already includes `--porcelain`, so that specific error should never
occur for this wrapper's fixed argv; it is mentioned in both existing docs
only to explain why `--porcelain` is present in the preferred command at
all.

### No fallback needed for `status`

`git status --porcelain=v2 -z` requires no version-gated fallback:
`--porcelain=v2` (Git ≥ 2.11) and `-z` (present since `git status`'s
earliest porcelain support) are both well inside the 2.25 compatibility
floor. Accordingly `git.rs`'s `Capability` enum has no `Status*` variant and
`baseline_probe_plan()` has no row for it — this proposal's `Status`
operation always runs the one form, with no preferred/fallback branch and
no `CapabilityCache` interaction of its own (a caller MAY still wrap it in
a `ProbeGuard` purely for its own request-coalescing, as noted above, but
there is nothing for that guard to protect in the cache).

### Missing source-of-truth doc (found during this proposal, not caused by it)

Both `git.rs` and `git_worktree.rs` cite
`docs/reference/git-compatibility.md` as the source of truth for the
capability table and the 2.25 baseline / CI matrix contract. That path does
not exist anywhere in this checkout (`find . -iname git-compat*` returns
only `docs/migration/rewrite-parity-plan.md`, which is a different
document). This proposal was written against the enum/comments actually
present in `git.rs` and the two existing V3 docs instead, since those are
the only real artifacts available, but the gap itself is flagged here
because it directly affects how much confidence to place in any
"per the compatibility table" claim, including several in this document and
in the two files this task corrected. Not a file this task is authorized to
create (outside the exclusive path list); reported for the coordinator to
route.

## Error mapping to frozen codes (`crates/drogon-core/src/error.rs`)

| Condition | Frozen code | Rationale |
| --- | --- | --- |
| `cwd` does not exist / is not a directory | `error::not_found` | Mirrors `workspace::get_path`'s existing not-found convention for a bad workspace path. |
| Git reports "not a git repository" (or equivalent) | `error::not_found` | The target isn't a queryable git worktree; closer to "the thing you asked about doesn't exist" than a malformed request. |
| `git` executable not found on `PATH` (`Command::spawn` returns `ErrorKind::NotFound`) | `error::io_error` | Matches this crate's existing `io_error` use for "could not perform an OS-level I/O action," e.g. `Engine::open`'s `fs::create_dir_all` failure mapping. |
| Any other spawn failure (permission denied, `ENOMEM`, etc.) | `error::io_error` | Same rationale as above. |
| Timeout budget exceeded (child killed) | `error::unverifiable` | Per this repo's `live`/`unverifiable`/`exited` convention — a killed probe's true outcome is unknown, not a confirmed failure. **Flagged for review**: `error.rs`'s existing `unverifiable` use sites are all about session/process *liveness* across a service restart, not a single bounded child's timeout; reusing it here is this proposal's judgment call, not a precedent already established for this exact case. |
| Byte cap exceeded (child killed) | `error::io_error` | See "Byte-cap handling" above — explicitly flagged there as a judgment call, not a settled mapping. |
| Preferred command failed with an error that does NOT match the narrow unsupported-error predicate | the error `git` itself reported, mapped like any other non-fallback Git failure (typically `error::internal_error` with the real stderr text, since the wrapper cannot know in advance what a not-otherwise-classified Git failure means) | Never silently retried as if it were a version gap — see "narrow predicate only" above. |
| stdout does not parse (`parse_status_porcelain_v2[_z]` / `parse_worktree_list_porcelain` returns `Err`) | passed through verbatim (already an `RpcError` with `invalid_argument`) | The parser's own error already carries the right frozen code; the wrapper must not re-wrap or discard it. |
| `resolve_invocation` called for a `(scope, capability)` `CapabilityCache::is_rejected` still within its retry interval, but the caller bypasses `should_retry` and forces the preferred form anyway | not applicable — `resolve_invocation` itself must consult `should_retry` internally and never expose a "force preferred" parameter | Listed here to make explicit that this proposal intentionally provides no caller override of the self-heal interval; a caller that needs to force a fresh probe should call `record_success` to clear stale rejection memory, not bypass the check. |

This table is itself unapproved; several rows are explicitly marked as
judgment calls above because no existing frozen code maps cleanly onto a
bounded-subprocess timeout or an output-cap trip. A reviewer may prefer
introducing a new frozen code for one or both rather than overloading
`unverifiable`/`io_error` — that decision is out of this proposal's scope.

## Exact test matrix (PROPOSED — none of these tests exist yet)

1. **Real-binary fixtures (this host's installed Git 2.50.1)**, extending
   the `TempRepo` harness already in `git_baseline.rs` / equivalent for
   worktree list:
   - `Status`, clean repo → empty entries, header present.
   - `Status`, one untracked file with a space/non-ASCII/tab name (reuse the
     existing fixture filenames from `git_baseline.rs`'s
     `real_git_status_v2_round_trips_special_filenames`) → wrapper's parsed
     result matches the direct-parser result for the same raw bytes.
   - `Status`, a rename → same cross-check against
     `real_git_status_v2_round_trips_a_rename`.
   - `WorktreeList`, a repo with one linked worktree (real `git worktree
     add`) → wrapper's parsed result matches
     `parse_worktree_list_porcelain` fed the same raw bytes directly.
   - `WorktreeList` and `Status` both **complete within budget** on a
     reasonably-sized real repo (this checkout itself, read-only) — a
     coarse smoke that the happy path doesn't trip the timeout/byte-cap by
     accident.
   - Global `-c` options round-trip: run with a target repo whose local
     config sets `core.quotePath=false`, confirm the wrapper's pinned
     `-c core.quotePath=true` still produces C-quoted output for the line
     form (proves `GLOBAL_OPTIONS` actually overrides a hostile local
     config, not just that it's present in argv).
2. **Synthetic legacy shapes** (no real old binary available, same honesty
   convention as `git-worktree-safety.md`'s "Synthetic-only on this host"):
   - Fake a `Child` whose stdout is a hand-built pre-2.36 line-block
     `worktree list --porcelain` sample and whose stderr matches
     `is_worktree_list_z_unsupported` for a first (fake) preferred-command
     attempt → wrapper selects the fallback argv and successfully parses
     the fallback stdout.
   - Fake stderr that resembles but does NOT exactly match the narrow
     predicate (e.g. contains `-z` but not `unknown switch`/`unknown
     option`, simulating some unrelated error that happens to mention `-z`)
     → wrapper must NOT fall back; it must surface the original error.
   - `CapabilityCache` already holds a rejection for
     `(scope, WorktreeListZ)` within the retry interval →
     `resolve_invocation` returns the fallback argv directly, without a
     wasted preferred-command spawn.
   - `ProbeGuard` release on caller error: start a `Leader` probe, force
     `run_git_readonly` to return early (inject a timeout or a spawn
     failure), assert a concurrent `begin_probe` call for the same
     `(scope, capability)` sees `Leader` again immediately after — i.e. the
     guard's `Drop` still ran despite the early `?` return. (Mirrors
     `git_baseline.rs`'s existing
     `probe_guard_finishes_the_probe_even_when_a_fallible_call_bails_out_early`,
     applied to this wrapper's real call site instead of a simulated one.)
3. **Timeout and byte-cap enforcement** (deterministic, no real Git needed):
   - Spawn a trivial long-sleeping child (e.g. `sleep 5` via
     `std::process::Command` directly in the test, not through
     `resolve_invocation`, to isolate the timeout mechanism from Git
     specifics) with a short `GitProbeBudget.timeout` → asserts
     `unverifiable`, asserts the child is actually reaped (no zombie left:
     check `try_wait()` returns `Some` after the call returns), asserts
     elapsed wall-clock stayed close to the budget (upper-bounds the
     poll-loop's own overhead).
   - Spawn a child that writes more than `max_stdout_bytes` (e.g. `yes` in
     a test-only capped read, or a small helper script under the test's own
     temp dir) → asserts `io_error`, asserts the child is reaped, asserts no
     unbounded memory growth (e.g. run under a byte-counted reader and
     assert the read count never exceeds `max_stdout_bytes` plus one chunk).
4. **Matrix-binary gaps, stated explicitly** (this section documents what
   the test matrix above does NOT prove, mirroring both existing V3 docs'
   "Explicitly out of scope / unverified" sections):
   - No real pre-2.36 Git binary exists on this development host, so
     `is_worktree_list_z_unsupported`'s exact stderr predicate is verified
     only against a synthetic string this proposal invented (see the
     function's own doc comment above) — it MUST be corrected against a
     real binary in the project's 2.25.5/2.38.1/2.49.1 CI matrix (or
     whatever matrix actually gets established, given the missing
     source-of-truth doc noted above) before being trusted in production.
   - No test here exercises a genuinely slow/hung real `git` process (e.g.
     a repo on a stalled network filesystem) — the timeout test above uses
     a synthetic `sleep`, which proves the mechanism but not Git's actual
     behavior under real stalls.
   - No test exercises the wrapper against a remote/WSL/relay `HostScope`
     end-to-end (only the in-memory `CapabilityCache` per-scope isolation,
     already covered by `git_baseline.rs`'s existing per-scope tests, is
     assumed to still hold once real spawning is wired in) — this proposal
     is scoped to the authoritative host only, per "Scope" above.

## Explicitly NOT covered by this proposal

- Any mutating Git operation.
- `fetch` or any network-touching command, per the task's explicit
  exclusion.
- Wiring `git.rs` / `git_worktree.rs` into `lib.rs`'s module tree (a
  prerequisite this proposal depends on but does not itself decide or
  perform).
- Creating `docs/reference/git-compatibility.md` (missing; flagged above,
  not authorized by this task's exclusive path list).
- Any actual new source file. This document is the complete deliverable for
  Part B; `git.rs`, `git_worktree.rs`, and their two test files carry only
  the Part A parser corrections, per the task's exclusive path list.
