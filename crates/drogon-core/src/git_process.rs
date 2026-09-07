//! Bounded, read-only process wrapper for exactly two Git operations:
//! `git status --porcelain=v2 -z` and `git worktree list --porcelain -z`
//! (with their pre-baseline fallbacks). Implements
//! `docs/migration/verticals/V3/git-readonly-wrapper-proposal.md`'s scope
//! decision, narrowed and finalized per that proposal's own "flagged for
//! review" items (see doc comments below for what changed and why). Reuses
//! `crate::git`'s parsers/`CapabilityCache`/`ProbeGuard` and
//! `crate::git_worktree`'s parser, both pure/std-only; this module is the
//! first thing in the crate that actually spawns `git`.
//!
//! Not wired into `lib.rs` yet (see this crate's other V3 modules' doc
//! comments for the same note) — root registers it. Exercised today only via
//! `tests/git_process.rs`'s `#[path]` inclusion, the same trick
//! `tests/git_baseline.rs` already uses for `src/git.rs`.
//!
//! # (2) Host scope is a cache key here, never a routing instruction
//!
//! `run_read_only_git` takes an explicit `workspace_root: &Path` and
//! `scope: &HostScope`. This module ALWAYS spawns `git` as a plain child
//! process of the OS process it runs in — `scope` is used exclusively to key
//! `CapabilityCache` lookups/writes, never to decide *where* to run the
//! command. There is no WSL/SSH/relay transport here (per the proposal's
//! "Scope" section, this wrapper only runs a probe once a caller has already
//! resolved which host is authoritative). Concretely: **resolving which
//! physical host is authoritative for a given registered workspace happens
//! later, at the RPC boundary** (not in this module, and not built by this
//! change). A caller must not invoke this function's `Wsl`/`Ssh`/`Relay`
//! scopes unless the *current process* is already physically running on
//! that host (e.g. inside the right WSL distro, or as the right SSH
//! provider's remote agent) — output produced by calling this function
//! locally and merely labeling it with a remote `HostScope` is NOT remote
//! output; it is local output mislabeled with someone else's cache key, and
//! must never be reported to a caller as if it came from that remote host.

use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;

use crate::error;
use crate::git::{
    Capability, CapabilityCache, HostScope, ParsedStatus, ProbeGuard, ProbeOutcome,
    parse_status_porcelain_v2, parse_status_porcelain_v2_z,
};
use crate::git_worktree::{WorktreeEntry, parse_worktree_list_porcelain};

// --- public operation surface ----------------------------------------------

/// Which of the two approved read-only operations to run. Not a general
/// "run any git subcommand" API: every variant corresponds to exactly one
/// fixed argv shape built inside this module, so adding an operation
/// requires a reviewed code change, never a caller-supplied string.
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
    /// kills the child and returns `unverifiable` (see "Bounded cleanup
    /// strategy" below), never a partial/truncated success.
    pub timeout: Duration,
    /// Maximum COMBINED stdout+stderr bytes read from the child before this
    /// wrapper stops reading and kills it. One cap across both streams
    /// (not one each), since both are captured concurrently and both count
    /// against the same memory/parse-cost concern this cap protects.
    pub max_combined_output_bytes: usize,
}

/// Discriminated parse result: `Status` and `WorktreeList` parse to
/// different types (`crate::git::ParsedStatus` vs.
/// `Vec<crate::git_worktree::WorktreeEntry>`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedGitOutput {
    Status(ParsedStatus),
    WorktreeList(Vec<WorktreeEntry>),
}

/// The self-heal retry interval for a cached `worktree-list-z` rejection: how
/// long this wrapper keeps using the fallback command before trying the
/// preferred form again. A judgment call (no existing precedent in this
/// crate pins a value) — 5 minutes is short enough that an in-place Git
/// upgrade self-heals within one typical work session, long enough that a
/// confirmed-old Git isn't re-probed on every single worktree-list call.
const WORKTREE_LIST_Z_RETRY_INTERVAL: Duration = Duration::from_secs(300);

/// The fallback-caching decision in isolation: true when this wrapper should
/// spend a preferred-command attempt (never rejected before, or the
/// rejection is old enough to self-heal-retry per
/// `WORKTREE_LIST_Z_RETRY_INTERVAL`), false when it should go straight to
/// the fallback argv, skipping a preferred-command spawn already known to
/// fail. `pub(crate)` so `tests/git_process.rs` can exercise this narrow
/// decision directly against a `CapabilityCache` pre-seeded with
/// `record_rejection`, without needing a real pre-2.36 Git binary (none
/// installed on this development host) to actually trigger it end-to-end.
pub(crate) fn should_try_preferred_worktree_list(
    scope: &HostScope,
    cache: &CapabilityCache,
) -> bool {
    cache.should_retry(
        scope,
        Capability::WorktreeListZ,
        WORKTREE_LIST_Z_RETRY_INTERVAL,
    )
}

/// Runs one bounded, read-only Git operation and parses its output.
///
/// # (1) Owns the `ProbeGuard` end to end — callers cannot forget it
///
/// This is the ONLY public entry point this module exposes for actually
/// running Git. There is no separate "resolve an invocation" / "run an
/// invocation" pair of public functions (unlike the earlier proposal
/// sketch): argv construction (`worktree_list_preferred_argv` /
/// `worktree_list_fallback_argv` / `status_argv`) and the fallback decision
/// stay private module functions, never returning a caller-usable
/// "invocation" value, precisely so no caller can obtain a resolved
/// invocation and run it without this function's internal `begin_probe` →
/// `ProbeGuard` → resolve → spawn → `record_*` sequence in between. For
/// `WorktreeList` (the only operation with a real
/// `CapabilityCache` entry, `Capability::WorktreeListZ`) the guard is held
/// across that entire sequence, including every early-return error path, so
/// a caller-side failure (timeout, spawn error, parse error) can never leave
/// the `(scope, capability)` pair stuck reporting `Follower` forever. `Drop`
/// on `ProbeGuard` is what makes this true regardless of which `?` returns
/// early — see `crate::git::ProbeGuard`'s own doc comment.
///
/// `Status` has no corresponding `Capability` variant in `crate::git` (see
/// the proposal's "No fallback needed for `status`": `--porcelain=v2 -z` is
/// well inside the Git 2.25 baseline, so there is nothing for a cache/guard
/// to protect) and this function does not invent one — it runs directly,
/// with no `CapabilityCache` interaction at all.
pub fn run_read_only_git(
    operation: ReadOnlyGitOperation,
    workspace_root: &Path,
    scope: &HostScope,
    cache: &CapabilityCache,
    budget: GitProbeBudget,
) -> Result<ParsedGitOutput, RpcError> {
    match operation {
        ReadOnlyGitOperation::Status => run_status(workspace_root, &budget),
        ReadOnlyGitOperation::WorktreeList => {
            run_worktree_list(workspace_root, scope, cache, &budget)
        }
    }
}

fn run_status(workspace_root: &Path, budget: &GitProbeBudget) -> Result<ParsedGitOutput, RpcError> {
    let argv = status_argv();
    let outcome = spawn_git_and_capture(workspace_root, &argv, budget)?;
    let stdout = require_success(&outcome, &argv)?;
    let parsed = if stdout.contains('\0') {
        parse_status_porcelain_v2_z(stdout)?
    } else {
        parse_status_porcelain_v2(stdout)?
    };
    Ok(ParsedGitOutput::Status(parsed))
}

/// Bounded wait for a Follower: how long to poll `CapabilityCache::is_in_flight`
/// before giving up and spawning its own fallback anyway. A judgment call —
/// long enough that the Leader's one bounded spawn usually finishes first,
/// short enough this never becomes an unbounded wait if the Leader is itself
/// stuck (its own `budget.timeout` bounds that, but a Follower must not
/// additionally wait past a fixed cap of its own on top of that).
const FOLLOWER_LEADER_WAIT_BOUND: Duration = Duration::from_millis(500);

fn wait_for_leader_bounded(scope: &HostScope, cache: &CapabilityCache, capability: Capability) {
    let deadline = Instant::now() + FOLLOWER_LEADER_WAIT_BOUND;
    while cache.is_in_flight(scope, capability) && Instant::now() < deadline {
        thread::sleep(POLL_INTERVAL);
    }
}

/// The argv a Follower must use: always the fallback, never the preferred
/// form. `pub(crate)` so `tests/git_process_bounds.rs` can assert this
/// directly — a Follower calling this can NEVER return
/// `worktree_list_preferred_argv()`, regardless of cache state, which is
/// exactly what makes many concurrent first-ever callers safe: at most one
/// of them (the Leader) ever spawns the preferred form per rejection
/// episode.
pub(crate) fn follower_worktree_list_argv() -> Vec<String> {
    worktree_list_fallback_argv()
}

/// `WorktreeList`'s single-flight + fallback sequence.
///
/// Follower policy: `CapabilityCache::finish_probe` is an unconditional
/// `HashMap::remove` keyed only by `(scope, capability)`, not a reference
/// count (see `crate::git::CapabilityCache`) — a `Follower` must NOT
/// construct its own `ProbeGuard` (its `Drop` would prematurely clear the
/// real `Leader`'s in-flight entry) and must NOT spawn the preferred probe
/// (only the Leader spends that one attempt per rejection episode, so N
/// concurrent first-ever callers never become N concurrent preferred
/// spawns). A `Follower` bounded-waits for the Leader to finish, then always
/// runs the fallback argv itself — correct whether the Leader's preferred
/// attempt succeeded or was rejected, so a Follower never needs to inspect
/// the Leader's outcome to pick a safe command.
fn run_worktree_list(
    workspace_root: &Path,
    scope: &HostScope,
    cache: &CapabilityCache,
    budget: &GitProbeBudget,
) -> Result<ParsedGitOutput, RpcError> {
    let capability = Capability::WorktreeListZ;
    let is_leader = cache.begin_probe(scope, capability) == ProbeOutcome::Leader;

    if !is_leader {
        wait_for_leader_bounded(scope, cache, capability);
        let fallback_argv = follower_worktree_list_argv();
        let outcome = spawn_git_and_capture(workspace_root, &fallback_argv, budget)?;
        let stdout = require_success(&outcome, &fallback_argv)?;
        let entries = parse_worktree_list_porcelain(stdout)?;
        return Ok(ParsedGitOutput::WorktreeList(entries));
    }

    // Leader: holds the guard across the entire resolve→spawn→record
    // sequence below, including every early-return `?`, so a caller-side
    // failure (timeout, spawn error, parse error) can never leave this
    // `(scope, capability)` pair stuck reporting `Follower` forever — see
    // `ProbeGuard`'s own doc comment for why `Drop` makes this true
    // regardless of which `?` returns early.
    let _guard = ProbeGuard::new(cache, scope.clone(), capability);

    let try_preferred = should_try_preferred_worktree_list(scope, cache);
    let preferred_argv = worktree_list_preferred_argv();
    let fallback_argv = worktree_list_fallback_argv();

    if try_preferred {
        let outcome = spawn_git_and_capture(workspace_root, &preferred_argv, budget)?;
        match &outcome {
            SpawnOutcome::Exited { status, stdout, .. } if status.success() => {
                let entries = parse_worktree_list_porcelain(stdout)?;
                cache.record_success(scope, capability);
                return Ok(ParsedGitOutput::WorktreeList(entries));
            }
            SpawnOutcome::Exited { status, stderr, .. }
                if !status.success() && is_worktree_list_z_unsupported(stderr) =>
            {
                // Narrow predicate matched: this Git does not understand the
                // preferred `-z` form. Record the rejection and retry with
                // the baseline-compatible fallback, still inside the same
                // guard scope.
                cache.record_rejection(scope, capability);
            }
            // Every remaining case (timeout, byte-cap, or a non-zero exit
            // that does NOT match the narrow predicate) is a real failure,
            // never a version gap: surface it exactly as `require_success`
            // maps it, without falling back. `require_success` only ever
            // returns `Ok` for the `status.success()` case already handled
            // above, so this is always the `Err` branch.
            _ => return Err(require_success(&outcome, &preferred_argv).unwrap_err()),
        }
    }

    let outcome = spawn_git_and_capture(workspace_root, &fallback_argv, budget)?;
    let stdout = require_success(&outcome, &fallback_argv)?;
    let entries = parse_worktree_list_porcelain(stdout)?;
    Ok(ParsedGitOutput::WorktreeList(entries))
}

// --- narrow unsupported-`-z` predicate --------------------------------------

/// Narrow, version-scoped predicate: true only for the exact "does not
/// understand `-z`" shape a pre-2.36 Git is expected to produce for
/// `worktree list --porcelain -z`.
///
/// NOT a general "looks like an unsupported-flag error" heuristic — a
/// blanket rule (any non-zero exit, or any stderr mentioning `-z`) would
/// silently reclassify a real failure (permission denied, not-a-git-
/// repository, corrupted `.git`) as a mere version gap. Must NOT match the
/// already-live-verified `fatal: the option '-z' requires '--porcelain'`
/// (`git-capability-baseline.md`): that quotes `-z` WITH the dash, unlike
/// Git's short-option `unknown switch `z'` phrasing this predicate targets,
/// which quotes only the bare letter.
///
/// Bounded citation, not a local run: no pre-2.36 Git binary is installed on
/// this development host (same gap `git-worktree-safety.md`'s
/// "Synthetic-only on this host" section documents for the identical
/// predicate shape), so this predicate is verified against ROOT's own
/// captured real-Git 2.25.5 receipt rather than a binary run here: for
/// `git worktree list --porcelain -z`, real Git 2.25.5 exits 129 with
/// stderr containing exactly `unknown switch `z'`, and the fallback
/// `git worktree list --porcelain` (no `-z`) exits 0. Quoted textually from
/// that receipt, not re-derived from `parse-options.c` phrasing.
pub(crate) fn is_worktree_list_z_unsupported(stderr: &str) -> bool {
    let mentions_unknown_switch =
        stderr.contains("unknown switch") || stderr.contains("unknown option");
    let quotes_bare_z =
        stderr.contains("`z'") || stderr.contains("'z'") || stderr.contains("\u{2018}z\u{2019}");
    mentions_unknown_switch && quotes_bare_z
}

// --- argv construction (no shell, no caller-supplied parameters) -----------

/// Frozen, reviewed global `-c`/global-flag options every invocation carries
/// before its subcommand. Neither operation takes any caller-supplied
/// argument (no path, ref, or pattern reaches Git's argv — `cwd` reaches Git
/// only via `Command::current_dir`, resolved by the OS without shell
/// involvement), so these are the only argv elements this module ever
/// varies, and a caller can never inject, reorder, or suppress any of them.
///
/// - `-c core.quotePath=true` pins the status-parser's C-quoting assumption
///   (`crate::git::c_unquote`) against a local override in the target
///   repo's own config; irrelevant to the `-z` form (which never quotes
///   regardless of `core.quotePath`, verified live) but load-bearing for the
///   line-form fallback.
/// - `-c color.ui=never` belt-and-suspenders against a global
///   `color.ui=always`; `--porcelain` forms are documented to never emit
///   color, so this should be a no-op, but costs nothing to pin.
/// - `-c core.fsmonitor=false` prevents Git from spawning/querying a
///   configured fsmonitor hook process as a side effect of `status`. Note
///   `worktree list` has no fsmonitor interaction at all; the flag is
///   harmless there.
/// - `--no-pager` (a global flag, not `-c core.pager=cat`, so it needs no
///   external `cat` binary and works identically on Windows) disables any
///   pager Git might otherwise invoke. Neither `status --porcelain` nor
///   `worktree list --porcelain` pages by default, but this wrapper never
///   trusts that invariant silently.
///
/// Hooks: neither `git status` nor `git worktree list` invokes any user
/// hook (see `githooks(5)`) — there is no hook target for either
/// subcommand, so there is nothing to suppress via config here. This is
/// stated explicitly rather than enforced by a flag, since inventing a
/// `core.hooksPath` override for operations that never consult hooks would
/// be undocumented, untested behavior with no real effect to verify.
pub(crate) const GLOBAL_ARGS: &[&str] = &[
    "--no-pager",
    "-c",
    "core.quotePath=true",
    "-c",
    "color.ui=never",
    "-c",
    "core.fsmonitor=false",
];

/// `pub(crate)`, along with the other two argv builders below and
/// `GLOBAL_ARGS`/`BOUNDED_ENV`, purely so `tests/git_process.rs` can assert
/// on the exact built argv/env ("env determinism" in the test matrix)
/// without needing a portable way to introspect a real spawned OS process —
/// `std::process::Command::get_args`/`get_envs` (stable since Rust 1.57) are
/// used by those tests directly against the `Command` `build_git_command`
/// produces, so this is "where observable" from inside this crate's own
/// test binary, not a live process inspection.
pub(crate) fn status_argv() -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(
        ["status", "--porcelain=v2", "-z"]
            .iter()
            .map(|s| s.to_string()),
    );
    argv
}

pub(crate) fn worktree_list_preferred_argv() -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(
        ["worktree", "list", "--porcelain", "-z"]
            .iter()
            .map(|s| s.to_string()),
    );
    argv
}

pub(crate) fn worktree_list_fallback_argv() -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(
        ["worktree", "list", "--porcelain"]
            .iter()
            .map(|s| s.to_string()),
    );
    argv
}

// --- bounded env set ---------------------------------------------------------

/// The exact, additive environment override set every spawned `git` child
/// carries on top of its otherwise-inherited environment (this wrapper does
/// NOT `env_clear()`: a full wipe would risk breaking `PATH`-based `git`
/// resolution or `HOME`-based user gitconfig lookup that these read-only
/// operations are still entitled to see; it only pins the specific
/// variables below):
///
/// - `GIT_OPTIONAL_LOCKS=0` — tells Git not to opportunistically write the
///   index/refresh the stat cache or take other advisory locks it would
///   otherwise take even for a nominally read-only command; keeps this
///   wrapper's "read-only" claim true at the filesystem level, not just at
///   the argv level.
/// - `LC_ALL=C` — deterministic, untranslated stderr/stdout text. This
///   matters beyond cosmetics: `is_worktree_list_z_unsupported`'s narrow
///   predicate matches specific English substrings, and a translated
///   locale's error text would silently defeat it (never falling back, or
///   worse, matching by accident).
pub(crate) const BOUNDED_ENV: &[(&str, &str)] = &[("GIT_OPTIONAL_LOCKS", "0"), ("LC_ALL", "C")];

/// Fixed denylist of Git worktree/index-selection and top-level env-config
/// variables this wrapper must never inherit from its own process,
/// mirroring `src/session.rs`'s inherited-env scrub for the same class of
/// ambient state: an inherited `GIT_DIR`/`GIT_WORK_TREE`/etc. from whatever
/// spawned THIS process could silently redirect either read-only operation
/// at a different repository/worktree/index than `cwd` implies, and an
/// inherited `GIT_CONFIG_COUNT`/`GIT_CONFIG_PARAMETERS` could inject
/// arbitrary config into it. `pub(crate)` alongside `BOUNDED_ENV` so tests
/// can assert removal via `Command::get_envs` even when the ambient test
/// process happens not to have these set.
///
/// `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` are deliberately NOT listed
/// here: their index `<n>` is unbounded (as many pairs as
/// `GIT_CONFIG_COUNT` declares), so no fixed list can name them all ahead of
/// time. `build_git_command` closes that gap separately, by scanning the
/// real ambient environment for every `GIT_`-prefixed variable (case-
/// insensitively, for Windows) rather than relying on a fixed list for that
/// part — this fixed list exists only so the always-removed core set stays
/// deterministic and test-assertable independent of ambient environment.
pub(crate) const ENV_REMOVE_DENYLIST: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_PREFIX",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
];

pub(crate) fn build_git_command(cwd: &Path, argv: &[String]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(argv)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in ENV_REMOVE_DENYLIST {
        cmd.env_remove(key);
    }
    // Broad scrub, on top of the fixed list above: an inherited
    // `GIT_CONFIG_KEY_<n>`/`GIT_CONFIG_VALUE_<n>` pair (any index) — or any
    // other ambient `GIT_`-prefixed variable — can inject arbitrary Git
    // config into every invocation this wrapper makes (proven live: with
    // `GIT_CONFIG_COUNT=1`/`GIT_CONFIG_KEY_0=core.worktree`/
    // `GIT_CONFIG_VALUE_0=<foreign path>` inherited, plain `git config --get
    // core.worktree` echoes the foreign path back). Removing only the fixed
    // names above would miss any index other than a hand-picked one, so
    // this scans this process's REAL environment instead of guessing
    // indices, mirroring `src/session.rs`'s `ORCA_`/`DROGON_` prefix scrub
    // for the same class of ambient-state closure. `BOUNDED_ENV` below is
    // reapplied after this scrub, so `GIT_OPTIONAL_LOCKS` (also
    // `GIT_`-prefixed) ends up set to this wrapper's own documented value,
    // never left removed nor left at whatever the ambient environment had.
    for (key, _) in std::env::vars_os() {
        let upper = key.to_string_lossy().to_ascii_uppercase();
        if upper.starts_with("GIT_") {
            cmd.env_remove(key);
        }
    }
    for (key, value) in BOUNDED_ENV {
        cmd.env(key, value);
    }
    apply_platform_spawn_flags(&mut cmd);
    cmd
}

#[cfg(windows)]
fn apply_platform_spawn_flags(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    // Suppresses the flash of a console window a piped/no-stdin child would
    // otherwise briefly own on Windows. Unverified on this development host
    // (Darwin) — see this crate's other cfg(windows) modules for the same
    // "untested on this host" honesty convention.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_platform_spawn_flags(_cmd: &mut Command) {}

// --- bounded spawn + concurrent combined-cap capture ------------------------
//
// # Bounded cleanup strategy (read this before the spawn path below)
//
// `std::process::Command::spawn` returns a `Child` immediately; `std` has no
// "wait with timeout" primitive and no non-blocking pipe read. This module's
// strategy, used identically for both operations:
//
// 1. Spawn with `stdin(Stdio::null())` and piped stdout/stderr.
// 2. Hand each pipe to its OWN dedicated reader thread. Each thread does
//    plain BLOCKING `Read::read` calls in a loop — that blocking happens
//    only on that thread, never on the control-loop thread below, and each
//    chunk it reads is appended to a `Arc<Mutex<Vec<u8>>>` shared buffer
//    (critical section is just the `extend_from_slice`, never the blocking
//    read itself) plus a shared `AtomicUsize` combined-byte counter checked
//    against `max_combined_output_bytes` after every chunk from either
//    stream. The first thread to cross the combined cap sets a shared
//    `AtomicBool` and stops reading; it does not kill the child itself (only
//    the control loop does that, so there is exactly one kill/reap path).
// 3. The control-loop thread NEVER performs a blocking read. It only polls
//    `Child::try_wait()` in a short sleep loop against `Instant::now()`,
//    also checking the shared cap-exceeded flag each iteration. This is the
//    "never a blocking read between polls" requirement: the control loop's
//    only blocking operation is a short, fixed `thread::sleep`.
// 4. On timeout OR cap-exceeded, the control loop calls `kill_and_reap`,
//    which bounds its own `try_wait` polling by `REAP_GRACE` rather than
//    calling `Child::wait()` unboundedly. An unconfirmed reap maps to
//    `SpawnOutcome::UnreapedAfterKill` (unverifiable), never to a trusted
//    `TimedOut`/`CapExceeded`.
// 5. Cleanup NEVER joins a reader thread unboundedly. A grandchild process
//    that inherited a pipe's write end (not expected for `status`/`worktree
//    list`, which don't fork helpers, but not something this module can
//    prove never happens) could keep that pipe open indefinitely after the
//    immediate child exits/is killed, and a reader thread blocked in
//    `read()` on that pipe would then never return. So the control loop
//    waits for each reader thread's "finished" flag for at most
//    `READER_DRAIN_GRACE`, using a cheap poll (not a join), and then takes
//    whatever bytes/state are in the shared buffer regardless of whether the
//    thread ever finished — if it didn't, the thread is simply left
//    detached (dropped `Arc`/`JoinHandle`), never joined, and may keep
//    running in the background for the lifetime of whatever process still
//    holds the pipe open. This is a deliberate, documented resource
//    trade-off (an orphaned thread costs a small stack, nothing else) over
//    the alternative of this function itself hanging. An unfinished drain
//    on the `Exited` path maps to `SpawnOutcome::CaptureUnfinished`, never
//    silently treated as a complete capture.

const READ_CHUNK_BYTES: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const READER_DRAIN_GRACE: Duration = Duration::from_millis(200);

#[derive(Debug)]
pub(crate) enum SpawnOutcome {
    /// The child exited with a status, AND both reader threads reached a
    /// clean EOF, AND both captured byte buffers are valid UTF-8. Never
    /// returned for an unfinished, errored, or non-UTF-8 capture — see the
    /// other variants below, which exist precisely so this one stays a
    /// fully EOF/error-proven success.
    Exited {
        status: ExitStatus,
        stdout: String,
        stderr: String,
    },
    /// The child was killed after exceeding `budget.timeout`, and was
    /// confirmed reaped. Distinct from `Exited` so callers can map it to
    /// `unverifiable` without inspecting an exit code that was never really
    /// observed.
    TimedOut,
    /// The child was killed after the combined stdout+stderr byte count
    /// exceeded `budget.max_combined_output_bytes`, and was confirmed
    /// reaped. Distinct from `Exited` for the same reason as `TimedOut`.
    CapExceeded,
    /// The child was killed (timeout or byte-cap) but `kill_and_reap` could
    /// not confirm it was reaped within `REAP_GRACE`. The process's true
    /// fate is unknown, so this maps to `unverifiable` regardless of which
    /// kill trigger produced it.
    UnreapedAfterKill,
    /// The child exited, but at least one reader thread had not reached EOF
    /// (or an error, or the cap) within `READER_DRAIN_GRACE` — for example a
    /// grandchild inherited the pipe's write end and kept it open. The bytes
    /// captured so far are an unproven partial snapshot, never trusted as a
    /// complete `Exited` capture.
    CaptureUnfinished,
    /// A reader thread's blocking `Read::read` returned an OS-level error
    /// before EOF. Carries that error's message. Distinct from
    /// `CaptureUnfinished`: this is a confirmed I/O failure, not merely "no
    /// EOF observed yet".
    CaptureReadError(String),
    /// The child exited and both reader threads reached a clean EOF, but the
    /// captured bytes on the named stream (`"stdout"`/`"stderr"`) are not
    /// valid UTF-8. Decoding via `String::from_utf8_lossy` would silently
    /// substitute replacement characters and change path/content identity,
    /// so this wrapper never does that — invalid UTF-8 is a hard failure.
    CaptureInvalidUtf8(&'static str),
}

/// `pub(crate)` with `pub(crate)` fields solely so `tests/git_process.rs`/
/// `tests/git_process_bounds.rs` can drive `spawn_stream_reader` directly
/// with a synthetic in-process `Read` (no real child process) to exercise
/// the combined-byte-cap and read-error paths deterministically, isolated
/// from both Git and OS process specifics.
pub(crate) struct SharedStream {
    pub(crate) buf: Arc<Mutex<Vec<u8>>>,
    pub(crate) finished: Arc<AtomicBool>,
    /// First OS-level `Read::read` error this stream's reader thread hit, if
    /// any — never silently swallowed like the old `Err(_) => break`. Kept
    /// separate from `finished` because both a clean EOF and a read error
    /// end the loop with `finished = true`; only this field distinguishes
    /// them, which is exactly what the `Exited` outcome below must never
    /// blur (see "EOF/error-proven capture" at the call site).
    pub(crate) read_error: Arc<Mutex<Option<String>>>,
}

pub(crate) fn spawn_stream_reader(
    mut stream: impl Read + Send + 'static,
    combined_len: Arc<AtomicUsize>,
    cap: usize,
    cap_hit: Arc<AtomicBool>,
) -> SharedStream {
    let buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let finished = Arc::new(AtomicBool::new(false));
    let read_error: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let buf_thread = Arc::clone(&buf);
    let finished_thread = Arc::clone(&finished);
    let read_error_thread = Arc::clone(&read_error);
    thread::spawn(move || {
        let mut chunk = [0u8; READ_CHUNK_BYTES];
        loop {
            let n = match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    *read_error_thread.lock().unwrap() = Some(e.to_string());
                    break;
                }
            };
            {
                let mut guard = buf_thread.lock().unwrap();
                guard.extend_from_slice(&chunk[..n]);
            }
            let total = combined_len.fetch_add(n, Ordering::SeqCst) + n;
            if total > cap {
                cap_hit.store(true, Ordering::SeqCst);
                break;
            }
        }
        finished_thread.store(true, Ordering::SeqCst);
    });
    SharedStream {
        buf,
        finished,
        read_error,
    }
}

/// A bounded snapshot of one `SharedStream`, taken by `drain_or_snapshot`.
/// `pub(crate)` fields alongside `drain_or_snapshot` itself, for the same
/// test-only reason.
pub(crate) struct DrainedStream {
    pub(crate) bytes: Vec<u8>,
    /// False when the reader thread had not reached EOF/error/cap by
    /// `deadline` — e.g. a grandchild still holds the pipe's write end
    /// open. The caller must never treat `bytes` as a complete capture when
    /// this is false.
    pub(crate) finished: bool,
    pub(crate) read_error: Option<String>,
}

/// Waits for `stream`'s reader thread to finish, up to `deadline`, then
/// takes a snapshot of whatever bytes/state it has so far regardless. Never
/// joins the thread — see the module-level "Bounded cleanup strategy" doc
/// comment above.
///
/// Loads `finished` BEFORE cloning `buf` — never the reverse. The reader
/// thread's own program order (`spawn_stream_reader`) always appends a
/// chunk to `buf` before it can possibly set `finished`, so observing
/// `finished == true` here guarantees every byte the reader will ever write
/// is already visible when `buf` is cloned immediately after. Cloning `buf`
/// first would let the reader append its final chunk and flip `finished` to
/// true in the gap between the two reads, so this function would report a
/// short, PRE-final `buf` snapshot as if `finished == true` meant it was
/// complete. If `finished` is observed false here, this reports false even
/// if the reader completes a moment later — a genuinely unfinished snapshot,
/// never mislabeled either way.
///
/// `pub(crate)` (with `pub(crate)` fields on `DrainedStream` below) solely so
/// `tests/git_process_bounds.rs` can drive this exact ordering with a
/// barrier-synchronized synthetic writer thread, deterministically
/// reproducing the race window this fix closes instead of relying on
/// `thread::sleep` timing to hope for it.
pub(crate) fn drain_or_snapshot(stream: &SharedStream, deadline: Instant) -> DrainedStream {
    while !stream.finished.load(Ordering::SeqCst) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(2));
    }
    let finished = stream.finished.load(Ordering::SeqCst);
    let bytes = stream.buf.lock().unwrap().clone();
    let read_error = stream.read_error.lock().unwrap().clone();
    DrainedStream {
        bytes,
        finished,
        read_error,
    }
}

/// Explicit grace bound for confirming a killed child was actually reaped.
/// Bounded `try_wait` polling only — never an unbounded `wait()`, which is a
/// `waitpid`/`WaitForSingleObject` call this module cannot prove terminates
/// if the OS/process is sufficiently wedged.
const REAP_GRACE: Duration = Duration::from_millis(500);

/// Whether `kill_and_reap` confirmed the child was actually reaped within
/// `REAP_GRACE`. `reaped: false` means the true fate of the process is
/// unknown, not that cleanup failed outright — callers must map that to an
/// uncertain outcome, never to a confirmed success or a confirmed failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ReapOutcome {
    pub(crate) reaped: bool,
}

/// `pub(crate)` so `tests/git_process.rs` can verify the reap half of the
/// "no hang + kill" requirement directly: spawn a real long-running child,
/// call this, then assert `Child::try_wait()` returns `Ok(Some(_))`
/// (reaped, not a zombie) without needing to route through the full
/// timeout-polling loop to exercise just this primitive.
pub(crate) fn kill_and_reap(child: &mut Child) -> ReapOutcome {
    let _ = child.kill();
    let deadline = Instant::now() + REAP_GRACE;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return ReapOutcome { reaped: true },
            Err(_) => return ReapOutcome { reaped: false },
            Ok(None) => {
                if Instant::now() >= deadline {
                    return ReapOutcome { reaped: false };
                }
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

// --- cross-call admission bound ---------------------------------------------
//
// Every call above this point bounds ITS OWN resource use (timeout, combined
// byte cap, bounded reap, bounded reader-drain). Nothing previously bounded
// resource use ACROSS repeated calls: the module's own "Bounded cleanup
// strategy" doc comment already documents that a `CaptureUnfinished` reader
// thread (grandchild holding a pipe open) or an `UnreapedAfterKill` child is
// deliberately left running/unreaped past that ONE call's return — a
// documented per-call trade-off, not a per-process one. With no cross-call
// bound, repeated calls that each hit that trade-off could still accumulate
// an unbounded number of live threads/processes over time. This gate is
// process-wide (not per-workspace/per-scope) admission control for exactly
// that: a call is refused outright, before it spawns anything, once too many
// prior calls' resources are still genuinely in use.

/// Maximum bounded git probes (`spawn_and_capture_bounded` calls) allowed in
/// flight across this process at once. A judgment call — this crate's own
/// real callers spawn at most a handful of concurrent read-only probes today
/// (per `git-readonly-wrapper-proposal.md`'s scope: exactly two operations,
/// no fan-out), so this is generously far above realistic concurrency while
/// still being a REAL, fail-closed bound rather than an unbounded resource
/// sink. `pub(crate)` so `tests/git_process_bounds.rs` can size its
/// exhaustion/recovery test against the real constant instead of duplicating
/// it.
pub(crate) const MAX_CONCURRENT_PROBES: usize = 64;

static IN_FLIGHT_PROBES: AtomicUsize = AtomicUsize::new(0);

/// RAII admission slot: acquired by `try_acquire_admission` before a probe's
/// child is spawned, released on `Drop` — which callers must delay until
/// this probe's resources (reader threads, and any retained unreaped child)
/// are ACTUALLY done, never merely until `spawn_and_capture_bounded` returns
/// to its own caller. See `release_when_finished`.
pub(crate) struct AdmissionPermit;

impl Drop for AdmissionPermit {
    fn drop(&mut self) {
        IN_FLIGHT_PROBES.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Attempts to acquire one of `MAX_CONCURRENT_PROBES` cross-call admission
/// slots, fail-closed (`None`, never blocking) once they are exhausted.
/// `pub(crate)` so `tests/git_process_bounds.rs` can exercise exhaustion and
/// exact-recovery directly against the real production counter, without
/// needing to actually spawn `MAX_CONCURRENT_PROBES` real child processes to
/// do it.
pub(crate) fn try_acquire_admission() -> Option<AdmissionPermit> {
    let mut current = IN_FLIGHT_PROBES.load(Ordering::SeqCst);
    loop {
        if current >= MAX_CONCURRENT_PROBES {
            return None;
        }
        match IN_FLIGHT_PROBES.compare_exchange_weak(
            current,
            current + 1,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => return Some(AdmissionPermit),
            Err(observed) => current = observed,
        }
    }
}

/// True once a probe's outstanding resources are genuinely done: both
/// reader threads finished (EOF, read error, or byte cap — see
/// `SharedStream::finished`), AND, if a child is still being retained
/// because a prior kill's reap was unconfirmed, `try_wait` now confirms it
/// exited. A poll error on the retained child also counts as done — it
/// means this process can learn nothing further from `try_wait`, so
/// continuing to poll would only add another orphaned thread on top of an
/// already-unverifiable child, never actually resolving it. `pub(crate)` so
/// `tests/git_process_bounds.rs` can exercise this exact predicate
/// deterministically with synthetic streams, without needing a real
/// unreaped-after-kill child (not reliably producible on demand) to prove
/// the retention logic.
pub(crate) fn resources_are_finished(
    stdout: &SharedStream,
    stderr: &SharedStream,
    retained_child: &mut Option<Child>,
) -> bool {
    let streams_done =
        stdout.finished.load(Ordering::SeqCst) && stderr.finished.load(Ordering::SeqCst);
    let child_done = match retained_child {
        None => true,
        Some(child) => !matches!(child.try_wait(), Ok(None)),
    };
    streams_done && child_done
}

/// Releases `permit` (and waits out `retained_child`, if any) only once
/// `resources_are_finished` is true — never merely once this is called. If
/// everything is already finished, this releases immediately with no extra
/// thread; otherwise it spawns exactly one background watcher that owns
/// `permit`/`retained_child`/the stream handles until they are genuinely
/// done, then drops them. An unreaped `retained_child` is therefore never
/// simply discarded: dropping a `Child` neither kills nor waits it, which
/// would leave its true fate (and, on Unix, a potential zombie) unknown
/// forever — this keeps it as an active, polled cleanup owner until
/// `try_wait` actually confirms it exited.
fn release_when_finished(
    permit: AdmissionPermit,
    stdout: SharedStream,
    stderr: SharedStream,
    retained_child: Option<Child>,
) {
    let mut retained_child = retained_child;
    if resources_are_finished(&stdout, &stderr, &mut retained_child) {
        drop(retained_child);
        drop(permit);
        return;
    }
    thread::spawn(move || {
        while !resources_are_finished(&stdout, &stderr, &mut retained_child) {
            thread::sleep(POLL_INTERVAL);
        }
        drop(retained_child);
        drop(permit);
    });
}

/// The generic bounded spawn+capture primitive: takes an already-built
/// `Command` (stdout/stderr must already be `Stdio::piped()`) and applies
/// the admission/poll/timeout/combined-byte-cap/kill/reap policy above,
/// independent of any Git-specific argv. `pub(crate)` so
/// `tests/git_process.rs` can drive it directly with a synthetic
/// long-running/high-output child, isolating the timeout and byte-cap
/// mechanisms from Git specifics — mirroring
/// `docs/migration/verticals/V3/git-readonly-wrapper-proposal.md`'s own test
/// design note ("Spawn a trivial long-sleeping child... to isolate the
/// timeout mechanism from Git specifics").
pub(crate) fn spawn_and_capture_bounded(
    mut cmd: Command,
    budget: &GitProbeBudget,
) -> Result<SpawnOutcome, RpcError> {
    let permit = try_acquire_admission().ok_or_else(|| {
        error::runtime_busy(format!(
            "bounded git probe admission exhausted: {MAX_CONCURRENT_PROBES} probes already in \
             flight; retry once an earlier probe's resources finish"
        ))
    })?;

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            drop(permit);
            return Err(error::io_error(format!(
                "failed to spawn process for bounded git probe: {e}"
            )));
        }
    };
    let stdout = child
        .stdout
        .take()
        .expect("spawn_and_capture_bounded requires Stdio::piped() stdout");
    let stderr = child
        .stderr
        .take()
        .expect("spawn_and_capture_bounded requires Stdio::piped() stderr");

    let combined_len = Arc::new(AtomicUsize::new(0));
    let cap_hit = Arc::new(AtomicBool::new(false));
    let cap = budget.max_combined_output_bytes;

    let stdout_stream =
        spawn_stream_reader(stdout, Arc::clone(&combined_len), cap, Arc::clone(&cap_hit));
    let stderr_stream = spawn_stream_reader(stderr, combined_len, cap, Arc::clone(&cap_hit));

    let start = Instant::now();
    // Cap check comes BEFORE `try_wait()` in this loop, and is checked again
    // below even after an `Exited` break: a child can write past the cap
    // and then exit successfully in the same instant a fast command
    // completes, and this wrapper must never report that as a trusted
    // success with silently truncated output — the byte cap is about what
    // THIS wrapper is willing to trust having read, independent of whether
    // the child also happened to finish on its own.
    let poll_result = loop {
        if cap_hit.load(Ordering::SeqCst) {
            break PollResult::CapExceeded;
        }
        match child.try_wait() {
            Ok(Some(status)) => break PollResult::Exited(status),
            Ok(None) => {}
            Err(e) => {
                // Preserve owned cleanup on this branch too: never return
                // early leaving the child unkilled/unreaped and the reader
                // threads' admission slot unaccounted for. A confirmed
                // reap still surfaces the original poll failure (`io_error`);
                // an unconfirmed one maps to `unverifiable` (the child's
                // true fate is now unknown) and is retained, never dropped.
                let reap = kill_and_reap(&mut child);
                let deadline = Instant::now() + READER_DRAIN_GRACE;
                drain_or_snapshot(&stdout_stream, deadline);
                drain_or_snapshot(&stderr_stream, deadline);
                let retained_child = if reap.reaped { None } else { Some(child) };
                release_when_finished(permit, stdout_stream, stderr_stream, retained_child);
                return if reap.reaped {
                    Err(error::io_error(format!(
                        "failed to poll bounded git probe child status: {e}"
                    )))
                } else {
                    Err(error::unverifiable(format!(
                        "failed to poll bounded git probe child status ({e}) and the child \
                         could not be confirmed reaped after an attempted kill"
                    )))
                };
            }
        }
        if start.elapsed() >= budget.timeout {
            break PollResult::TimedOut;
        }
        thread::sleep(POLL_INTERVAL);
    };

    match poll_result {
        PollResult::Exited(status) => {
            let deadline = Instant::now() + READER_DRAIN_GRACE;
            let mut stdout_drained = drain_or_snapshot(&stdout_stream, deadline);
            let stderr_drained = drain_or_snapshot(&stderr_stream, deadline);
            // Final belt-and-suspenders check: the reader threads keep
            // running concurrently with the poll loop above, so a cap trip
            // that raced past the `try_wait()` check that produced this
            // `Exited(status)` will reliably be visible by now (the drain
            // above waited up to `READER_DRAIN_GRACE`, far longer than the
            // reader threads need to publish the flag).
            if cap_hit.load(Ordering::SeqCst) {
                release_when_finished(permit, stdout_stream, stderr_stream, None);
                return Ok(SpawnOutcome::CapExceeded);
            }
            // EOF/error-proven capture: a read error on either stream is a
            // confirmed I/O failure, checked before "finished" so it is
            // never masked by the loop having merely exited.
            if let Some(err) = stdout_drained
                .read_error
                .take()
                .or(stderr_drained.read_error)
            {
                release_when_finished(permit, stdout_stream, stderr_stream, None);
                return Ok(SpawnOutcome::CaptureReadError(err));
            }
            // Never report success on a mere 200ms (`READER_DRAIN_GRACE`)
            // snapshot of a stream that hasn't actually reached EOF yet.
            if !stdout_drained.finished || !stderr_drained.finished {
                release_when_finished(permit, stdout_stream, stderr_stream, None);
                return Ok(SpawnOutcome::CaptureUnfinished);
            }
            let outcome = match (
                String::from_utf8(stdout_drained.bytes),
                String::from_utf8(stderr_drained.bytes),
            ) {
                (Ok(stdout), Ok(stderr)) => SpawnOutcome::Exited {
                    status,
                    stdout,
                    stderr,
                },
                (Err(_), _) => SpawnOutcome::CaptureInvalidUtf8("stdout"),
                (_, Err(_)) => SpawnOutcome::CaptureInvalidUtf8("stderr"),
            };
            release_when_finished(permit, stdout_stream, stderr_stream, None);
            Ok(outcome)
        }
        PollResult::TimedOut => {
            let reap = kill_and_reap(&mut child);
            let deadline = Instant::now() + READER_DRAIN_GRACE;
            drain_or_snapshot(&stdout_stream, deadline);
            drain_or_snapshot(&stderr_stream, deadline);
            let outcome = if reap.reaped {
                SpawnOutcome::TimedOut
            } else {
                SpawnOutcome::UnreapedAfterKill
            };
            let retained_child = if reap.reaped { None } else { Some(child) };
            release_when_finished(permit, stdout_stream, stderr_stream, retained_child);
            Ok(outcome)
        }
        PollResult::CapExceeded => {
            let reap = kill_and_reap(&mut child);
            let deadline = Instant::now() + READER_DRAIN_GRACE;
            drain_or_snapshot(&stdout_stream, deadline);
            drain_or_snapshot(&stderr_stream, deadline);
            let outcome = if reap.reaped {
                SpawnOutcome::CapExceeded
            } else {
                SpawnOutcome::UnreapedAfterKill
            };
            let retained_child = if reap.reaped { None } else { Some(child) };
            release_when_finished(permit, stdout_stream, stderr_stream, retained_child);
            Ok(outcome)
        }
    }
}

enum PollResult {
    Exited(ExitStatus),
    TimedOut,
    CapExceeded,
}

fn spawn_git_and_capture(
    cwd: &Path,
    argv: &[String],
    budget: &GitProbeBudget,
) -> Result<SpawnOutcome, RpcError> {
    let cmd = build_git_command(cwd, argv);
    spawn_and_capture_bounded(cmd, budget)
}

// --- error mapping -----------------------------------------------------------

/// Maps a `SpawnOutcome` to its stdout on success, or a frozen `RpcError`
/// otherwise:
/// - `TimedOut` / `UnreapedAfterKill` / `CaptureUnfinished` → `unverifiable`
///   (the true outcome is unknown, not a confirmed failure, per this repo's
///   `live`/`unverifiable`/`exited` convention).
/// - `CapExceeded` / `CaptureReadError` / `CaptureInvalidUtf8` → `io_error`
///   (a confirmed I/O or decoding failure).
/// - `Exited` with a non-zero code → `io_error`, naming the observed exit
///   code so this case is distinguishable in logs/tests from the timeout
///   case above, which never observed a code at all.
fn require_success<'a>(outcome: &'a SpawnOutcome, argv: &[String]) -> Result<&'a str, RpcError> {
    match outcome {
        SpawnOutcome::Exited { status, stdout, .. } if status.success() => Ok(stdout.as_str()),
        SpawnOutcome::Exited { status, stderr, .. } => Err(error::io_error(format!(
            "git {} exited with {}: {}",
            argv.join(" "),
            status,
            stderr.trim()
        ))),
        SpawnOutcome::TimedOut => Err(error::unverifiable(format!(
            "git {} timed out and was killed before completing",
            argv.join(" ")
        ))),
        SpawnOutcome::CapExceeded => Err(error::io_error(format!(
            "git {} exceeded the configured combined output byte cap and was killed",
            argv.join(" ")
        ))),
        SpawnOutcome::UnreapedAfterKill => Err(error::unverifiable(format!(
            "git {} was killed but could not be confirmed reaped",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureUnfinished => Err(error::unverifiable(format!(
            "git {} exited but its output capture had not finished draining",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureReadError(e) => Err(error::io_error(format!(
            "git {} output capture failed: {e}",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureInvalidUtf8(which) => Err(error::io_error(format!(
            "git {} produced {which} that is not valid UTF-8",
            argv.join(" ")
        ))),
    }
}
