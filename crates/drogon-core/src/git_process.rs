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
pub(crate) fn should_try_preferred_worktree_list(scope: &HostScope, cache: &CapabilityCache) -> bool {
    cache.should_retry(scope, Capability::WorktreeListZ, WORKTREE_LIST_Z_RETRY_INTERVAL)
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

/// `WorktreeList`'s single-flight + fallback sequence. Only the `Leader` of
/// `begin_probe` constructs a `ProbeGuard` — see "Follower policy" below for
/// why a `Follower` must NOT also construct one.
fn run_worktree_list(
    workspace_root: &Path,
    scope: &HostScope,
    cache: &CapabilityCache,
    budget: &GitProbeBudget,
) -> Result<ParsedGitOutput, RpcError> {
    let capability = Capability::WorktreeListZ;

    // Follower policy: `CapabilityCache::finish_probe` is an unconditional
    // `HashMap::remove` keyed only by `(scope, capability)`, not a reference
    // count (see `crate::git::CapabilityCache`). If a `Follower` also built
    // its own `ProbeGuard` here, that guard's `Drop` would call
    // `finish_probe` and prematurely clear the actual `Leader`'s in-flight
    // entry, breaking single-flight coalescing for every other concurrent
    // caller. So only the `Leader` gets a guard; a `Follower` still runs its
    // own real resolve→spawn→record sequence unguarded (this leaf has no
    // channel to await the leader's result and must still return a real,
    // synchronous answer to its own caller) — `record_rejection` /
    // `record_success` are plain idempotent map writes on a SEPARATE mutex
    // from `in_flight`, so a `Follower` racing a `Leader` there is safe, just
    // occasionally redundant (at most one extra spawn under a race, never
    // incorrect output).
    let is_leader = cache.begin_probe(scope, capability) == ProbeOutcome::Leader;
    let _guard = if is_leader {
        Some(ProbeGuard::new(cache, scope.clone(), capability))
    } else {
        None
    };

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
/// repository, corrupted `.git`) as a mere version gap. In particular this
/// must NOT match the already-live-verified-on-this-host error `fatal: the
/// option '-z' requires '--porcelain'` (`git-capability-baseline.md` /
/// `git-worktree-safety.md`): that string contains a quoted `-z` (with the
/// dash), which is exactly why this predicate looks for the unquoted `z`
/// alone, as Git's short-option `unknown switch` message quotes only the
/// letter after stripping the leading dash (`error: unknown switch `z'`).
/// The preferred command here already carries `--porcelain`, so that
/// specific "requires --porcelain" error should never occur for this
/// wrapper's fixed argv in the first place.
///
/// UNVERIFIED against a real pre-2.36 binary (none installed on this
/// development host — same gap `git-worktree-safety.md`'s "Synthetic-only on
/// this host" section already documents for the identical predicate shape).
/// The exact stderr text is modeled on Git's conventional short-option
/// `parse-options.c` phrasing, not a captured live string, and MUST be
/// corrected against a real 2.25.x/2.3x.x binary (this project's own CI
/// matrix, `docs/migration/verticals/V3/docs-reference-git-compatibility.md`
/// "CI Contract") before being trusted in production.
pub(crate) fn is_worktree_list_z_unsupported(stderr: &str) -> bool {
    let mentions_unknown_switch = stderr.contains("unknown switch") || stderr.contains("unknown option");
    let quotes_bare_z = stderr.contains("`z'") || stderr.contains("'z'") || stderr.contains("\u{2018}z\u{2019}");
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
    argv.extend(["status", "--porcelain=v2", "-z"].iter().map(|s| s.to_string()));
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
    argv.extend(["worktree", "list", "--porcelain"].iter().map(|s| s.to_string()));
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

pub(crate) fn build_git_command(cwd: &Path, argv: &[String]) -> Command {
    let mut cmd = Command::new("git");
    cmd.args(argv)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
// 4. On timeout OR cap-exceeded, the control loop calls `Child::kill()` then
//    `Child::wait()` to reap the immediate child (bounded: `wait()` blocks
//    on the child's own pid via `waitpid`/`WaitForSingleObject`, which is
//    unaffected by whether any pipe reader thread is stuck).
// 5. Cleanup NEVER joins a reader thread unboundedly. A grandchild process
//    that inherited a pipe's write end (not expected for `status`/`worktree
//    list`, which don't fork helpers, but not something this module can
//    prove never happens) could keep that pipe open indefinitely after the
//    immediate child exits/is killed, and a reader thread blocked in
//    `read()` on that pipe would then never return. So the control loop
//    waits for each reader thread's "finished" flag for at most
//    `READER_DRAIN_GRACE`, using a cheap poll (not a join), and then takes
//    whatever bytes are in the shared buffer regardless of whether the
//    thread ever finished — if it didn't, the thread is simply left
//    detached (dropped `Arc`/`JoinHandle`), never joined, and may keep
//    running in the background for the lifetime of whatever process still
//    holds the pipe open. This is a deliberate, documented resource
//    trade-off (an orphaned thread costs a small stack, nothing else) over
//    the alternative of this function itself hanging.

const READ_CHUNK_BYTES: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(10);
const READER_DRAIN_GRACE: Duration = Duration::from_millis(200);

#[derive(Debug)]
pub(crate) enum SpawnOutcome {
    /// The child exited (with or without a zero code) within budget, and
    /// both streams' reader threads finished (or were given up on after
    /// `READER_DRAIN_GRACE`) before this variant was returned.
    Exited {
        status: ExitStatus,
        stdout: String,
        stderr: String,
    },
    /// The child was killed after exceeding `budget.timeout`. Distinct from
    /// `Exited` so callers can map it to `unverifiable` without inspecting
    /// an exit code that was never really observed.
    TimedOut,
    /// The child was killed after the combined stdout+stderr byte count
    /// exceeded `budget.max_combined_output_bytes`. Distinct from `Exited`
    /// for the same reason.
    CapExceeded,
}

/// `pub(crate)` with `pub(crate)` fields solely so `tests/git_process.rs`
/// can drive `spawn_stream_reader` directly with a synthetic in-process
/// `Read` (no real child process) to exercise the combined-byte-cap
/// enforcement deterministically, isolated from both Git and OS process
/// specifics.
pub(crate) struct SharedStream {
    pub(crate) buf: Arc<Mutex<Vec<u8>>>,
    pub(crate) finished: Arc<AtomicBool>,
}

pub(crate) fn spawn_stream_reader(
    mut stream: impl Read + Send + 'static,
    combined_len: Arc<AtomicUsize>,
    cap: usize,
    cap_hit: Arc<AtomicBool>,
) -> SharedStream {
    let buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let finished = Arc::new(AtomicBool::new(false));
    let buf_thread = Arc::clone(&buf);
    let finished_thread = Arc::clone(&finished);
    thread::spawn(move || {
        let mut chunk = [0u8; READ_CHUNK_BYTES];
        loop {
            let n = match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
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
    SharedStream { buf, finished }
}

/// Waits for `stream`'s reader thread to finish, up to `deadline`, then
/// takes a snapshot of whatever bytes it has captured so far regardless.
/// Never joins the thread — see the module-level "Bounded cleanup strategy"
/// doc comment above.
fn drain_or_snapshot(stream: &SharedStream, deadline: Instant) -> Vec<u8> {
    while !stream.finished.load(Ordering::SeqCst) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(2));
    }
    stream.buf.lock().unwrap().clone()
}

/// `pub(crate)` so `tests/git_process.rs` can verify the reap half of the
/// "no hang + kill" requirement directly: spawn a real long-running child,
/// call this, then assert `Child::try_wait()` returns `Ok(Some(_))`
/// (reaped, not a zombie) without needing to route through the full
/// timeout-polling loop to exercise just this primitive.
pub(crate) fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// The generic bounded spawn+capture primitive: takes an already-built
/// `Command` (stdout/stderr must already be `Stdio::piped()`) and applies
/// the poll/timeout/combined-byte-cap/kill/reap policy above, independent of
/// any Git-specific argv. `pub(crate)` so `tests/git_process.rs` can drive
/// it directly with a synthetic long-running/high-output child, isolating
/// the timeout and byte-cap mechanisms from Git specifics — mirroring
/// `docs/migration/verticals/V3/git-readonly-wrapper-proposal.md`'s own test
/// design note ("Spawn a trivial long-sleeping child... to isolate the
/// timeout mechanism from Git specifics").
pub(crate) fn spawn_and_capture_bounded(
    mut cmd: Command,
    budget: &GitProbeBudget,
) -> Result<SpawnOutcome, RpcError> {
    let mut child = cmd.spawn().map_err(|e| {
        error::io_error(format!("failed to spawn process for bounded git probe: {e}"))
    })?;
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

    let stdout_stream = spawn_stream_reader(stdout, Arc::clone(&combined_len), cap, Arc::clone(&cap_hit));
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
                return Err(error::io_error(format!(
                    "failed to poll bounded git probe child status: {e}"
                )));
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
            let stdout_bytes = drain_or_snapshot(&stdout_stream, deadline);
            let stderr_bytes = drain_or_snapshot(&stderr_stream, deadline);
            // Final belt-and-suspenders check: the reader threads keep
            // running concurrently with the poll loop above, so a cap trip
            // that raced past the `try_wait()` check that produced this
            // `Exited(status)` will reliably be visible by now (the drain
            // above waited up to `READER_DRAIN_GRACE`, far longer than the
            // reader threads need to publish the flag).
            if cap_hit.load(Ordering::SeqCst) {
                return Ok(SpawnOutcome::CapExceeded);
            }
            Ok(SpawnOutcome::Exited {
                status,
                stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
                stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
            })
        }
        PollResult::TimedOut => {
            kill_and_reap(&mut child);
            let deadline = Instant::now() + READER_DRAIN_GRACE;
            drain_or_snapshot(&stdout_stream, deadline);
            drain_or_snapshot(&stderr_stream, deadline);
            Ok(SpawnOutcome::TimedOut)
        }
        PollResult::CapExceeded => {
            kill_and_reap(&mut child);
            let deadline = Instant::now() + READER_DRAIN_GRACE;
            drain_or_snapshot(&stdout_stream, deadline);
            drain_or_snapshot(&stderr_stream, deadline);
            Ok(SpawnOutcome::CapExceeded)
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
/// - `TimedOut` → `unverifiable` (a killed-on-timeout probe's true outcome
///   is unknown, not a confirmed failure, per this repo's
///   `live`/`unverifiable`/`exited` convention).
/// - `CapExceeded` → `io_error` (an I/O read had to be aborted before
///   completion).
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
    }
}
