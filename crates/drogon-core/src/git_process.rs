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
//! Wired into `lib.rs` as `pub mod git_process`, alongside `crate::git` and
//! `crate::git_worktree`. Exercised both by this crate's own real build and
//! by `tests/git_process.rs`'s/`tests/git_process_bounds.rs`'s pre-existing
//! `#[path]` inclusion (kept for those files' own reasons; no longer needed
//! for this module to compile as part of the crate) and by
//! `tests/git_public_api.rs`, which exercises it purely through this crate's
//! public API.
//!
//! # (2) Host scope is a cache key for the native case, a fail-closed gate
//! # for every remote case, and never a routing instruction
//!
//! `run_read_only_git` takes an explicit `workspace_root: &Path` and
//! `scope: &HostScope`. This module ALWAYS spawns `git` as a plain child
//! process of the OS process it runs in. For `HostScope::Native`, `scope` is
//! used exclusively to key `CapabilityCache` lookups/writes, never to decide
//! *where* to run the command. There is no WSL/SSH/relay transport here (per
//! the proposal's "Scope" section, this wrapper only runs a probe once a
//! caller has already resolved which host is authoritative), so for
//! `HostScope::Wsl`/`Ssh`/`Relay` both public entry points (`run_read_only_git`
//! and `run_read_only_git_with_bin`) refuse with `unsupported_host` before
//! any admission/cache/spawn — see `reject_remote_scope` — rather than
//! silently running the command locally and merely labeling the result with
//! a remote scope. Concretely: **resolving which physical host is
//! authoritative for a given registered workspace, and actually executing on
//! a non-native host, happens later, at the RPC boundary, in a future
//! execution-host adapter** (not in this module, and not built by this
//! change). This mirrors `crate::workspace::owned_path`'s `unsupported_host`
//! precedent: a process must never mislabel its own local output as another
//! host's output — calling this function locally and merely labeling the
//! result with a remote `HostScope` would be exactly that, which is why the
//! remote variants are refused outright instead of ever being allowed to
//! reach a spawn.

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
    run_read_only_git_with_bin(
        operation,
        workspace_root,
        scope,
        cache,
        budget,
        Path::new("git"),
    )
}

/// Same as `run_read_only_git`, but spawns `git_bin` directly instead of
/// resolving `git` from `PATH`. Exists as a narrow test seam: a caller that
/// wants to exercise a slow/misbehaving `git` (e.g. a wrapper script that
/// sleeps past the budget) can point `git_bin` straight at it, with zero
/// process-global `PATH` mutation — see `tests/git_process.rs`'s
/// `run_read_only_git_maps_a_real_timeout_to_unverifiable`, which is the only
/// reason this entry point exists.
pub fn run_read_only_git_with_bin(
    operation: ReadOnlyGitOperation,
    workspace_root: &Path,
    scope: &HostScope,
    cache: &CapabilityCache,
    budget: GitProbeBudget,
    git_bin: &Path,
) -> Result<ParsedGitOutput, RpcError> {
    reject_remote_scope(scope)?;
    match operation {
        ReadOnlyGitOperation::Status => run_status(workspace_root, &budget, git_bin),
        ReadOnlyGitOperation::WorktreeList => {
            run_worktree_list(workspace_root, scope, cache, &budget, git_bin)
        }
    }
}

/// Fail-closed guard for every non-native `HostScope`: this module has no
/// execution-host adapter for WSL/SSH/relay (see this module's doc comment,
/// "(2)"), so a caller-supplied remote scope must be refused before this
/// function's admission gate, `CapabilityCache` lookup, or process spawn
/// ever run — never merely spawned locally and mislabeled as remote output.
/// Mirrors `crate::workspace::owned_path`'s `unsupported_host` precedent.
fn reject_remote_scope(scope: &HostScope) -> Result<(), RpcError> {
    let (kind, detail) = match scope {
        HostScope::Native => return Ok(()),
        HostScope::Wsl(distro) => ("WSL", distro.as_str()),
        HostScope::Ssh(provider) => ("SSH", provider.as_str()),
        HostScope::Relay(relay_id) => ("relay", relay_id.as_str()),
    };
    Err(RpcError::new(
        "unsupported_host",
        format!(
            "this process has no execution-host adapter for {kind} scope \"{detail}\"; \
             refusing to run git locally and mislabel the output as remote output"
        ),
    ))
}

fn run_status(
    workspace_root: &Path,
    budget: &GitProbeBudget,
    git_bin: &Path,
) -> Result<ParsedGitOutput, RpcError> {
    let argv = status_argv();
    let outcome = spawn_git_and_capture(workspace_root, &argv, budget, git_bin)?;
    let stdout = require_success(&outcome, &argv)?;
    let mut parsed = if stdout.contains('\0') {
        parse_status_porcelain_v2_z(stdout)?
    } else {
        parse_status_porcelain_v2(stdout)?
    };
    // Remote names ride along with every status read so the panel can tell
    // "no remote configured" apart from "no upstream on an existing
    // remote" without a second RPC (see #176). `git remote` is config-only
    // (no network) and prints names, never URLs.
    parsed.remotes = run_remote_names(workspace_root, budget, git_bin)?;
    Ok(ParsedGitOutput::Status(parsed))
}

/// Names from `git remote`, one per line. Empty when the repo has no remote
/// configured. Plain `git remote` (never `-v`): URLs can carry credentials
/// and must never reach the renderer.
fn run_remote_names(
    workspace_root: &Path,
    budget: &GitProbeBudget,
    git_bin: &Path,
) -> Result<Vec<String>, RpcError> {
    let argv = remote_argv();
    let outcome = spawn_git_and_capture(workspace_root, &argv, budget, git_bin)?;
    let stdout = require_success(&outcome, &argv)?;
    Ok(stdout
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect())
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
    git_bin: &Path,
) -> Result<ParsedGitOutput, RpcError> {
    let capability = Capability::WorktreeListZ;
    let is_leader = cache.begin_probe(scope, capability) == ProbeOutcome::Leader;

    if !is_leader {
        wait_for_leader_bounded(scope, cache, capability);
        let fallback_argv = follower_worktree_list_argv();
        let outcome = spawn_git_and_capture(workspace_root, &fallback_argv, budget, git_bin)?;
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
        let outcome = spawn_git_and_capture(workspace_root, &preferred_argv, budget, git_bin)?;
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

    let outcome = spawn_git_and_capture(workspace_root, &fallback_argv, budget, git_bin)?;
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
    // `--branch` is what makes porcelain v2 emit the `# branch.*` header
    // lines at all (verified live: without it a dirty repo prints only the
    // `1`/`2`/`?` entries, no headers). `--untracked-files=all` matches the
    // fork's status read (src/main/git/source-control/status-read.ts): an
    // untracked directory expands to its individual files, so the panel
    // lists `docs/readme.md`, never a collapsed `docs/` row. Still read-only
    // and deterministic.
    argv.extend(
        [
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    argv
}

/// Fixed `git remote` argv: names only, never `-v` — URLs can carry
/// credentials and must never reach the renderer. Read-only, config-local,
/// no network.
pub(crate) fn remote_argv() -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("remote".to_string());
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

/// `#[allow(dead_code)]`: every real production call site resolves through
/// `build_git_command_with_bin` directly (via `spawn_git_and_capture`); this
/// PATH-resolving wrapper exists solely as the `tests/git_process.rs`/
/// `tests/git_process_bounds.rs` seam described above, mirroring
/// `crate::git::CapabilityCache::is_in_flight`'s identical `#[allow(dead_code)]`
/// precedent for a pub(crate) test-only item.
#[allow(dead_code)]
pub(crate) fn build_git_command(cwd: &Path, argv: &[String]) -> Command {
    build_git_command_with_bin(Path::new("git"), cwd, argv)
}

/// Same as `build_git_command`, but spawns `git_bin` instead of resolving
/// `git` from `PATH` — the seam `run_read_only_git_with_bin` threads through
/// to `spawn_git_and_capture` so a test can point directly at a slow wrapper
/// script with zero process-global `PATH` mutation.
pub(crate) fn build_git_command_with_bin(git_bin: &Path, cwd: &Path, argv: &[String]) -> Command {
    let mut cmd = Command::new(git_bin);
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

/// How one `Child::try_wait` poll on a retained child resolves. Only
/// `Exited` proves the child is done. `Running` means it is still alive;
/// `Unverifiable` (an `Err` from `try_wait`) means this process can no
/// longer learn anything about it — but that uncertainty must NEVER count
/// as done: treating it as done would free the admission permit and let
/// repeated uncertain children defeat the cross-call cap. `pub(crate)` as
/// the deterministic Err/None/Some test seam, so
/// `tests/git_process_bounds.rs` can pin this decision table directly with
/// synthetic poll values — a real `try_wait` `Err` is not reliably
/// producible on demand, so no end-to-end fixture can prove it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChildPollReadiness {
    Exited,
    Running,
    Unverifiable,
}

/// Classifies one already-observed `try_wait` poll: only `Ok(Some(_))`
/// proves the child exited; `Err` is quarantined uncertainty, never proof
/// of completion.
pub(crate) fn classify_child_poll(
    poll: &Result<Option<ExitStatus>, std::io::Error>,
) -> ChildPollReadiness {
    match poll {
        Ok(Some(_)) => ChildPollReadiness::Exited,
        Ok(None) => ChildPollReadiness::Running,
        Err(_) => ChildPollReadiness::Unverifiable,
    }
}

/// A probe's full readiness: both reader threads finished (EOF, read error,
/// or byte cap — see `SharedStream::finished`), AND, if a child is still
/// being retained because a prior kill's reap was unconfirmed, `try_wait`
/// now confirms it exited. A poll error on the retained child is
/// `Unverifiable`, never finished: polling further could never resolve an
/// already-unverifiable child, but `release_when_finished` quarantines it
/// (permit and child retained without reopening capacity) instead of
/// releasing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProbeReadiness {
    Finished,
    Unfinished,
    Unverifiable,
}

pub(crate) fn probe_readiness(
    stdout: &SharedStream,
    stderr: &SharedStream,
    retained_child: &mut Option<Child>,
) -> ProbeReadiness {
    if !(stdout.finished.load(Ordering::SeqCst) && stderr.finished.load(Ordering::SeqCst)) {
        return ProbeReadiness::Unfinished;
    }
    match retained_child {
        None => ProbeReadiness::Finished,
        Some(child) => match classify_child_poll(&child.try_wait()) {
            ChildPollReadiness::Exited => ProbeReadiness::Finished,
            ChildPollReadiness::Running => ProbeReadiness::Unfinished,
            ChildPollReadiness::Unverifiable => ProbeReadiness::Unverifiable,
        },
    }
}

/// True once a probe's outstanding resources are genuinely done — see
/// `probe_readiness`. A poll error on the retained child is NOT done (it is
/// `Unverifiable`, quarantined by `release_when_finished`). `pub(crate)` so
/// `tests/git_process_bounds.rs` can exercise this exact predicate
/// deterministically with synthetic streams, without needing a real
/// unreaped-after-kill child (not reliably producible on demand) to prove
/// the retention logic.
///
/// `#[allow(dead_code)]`: every real production call site uses
/// `probe_readiness` directly (`release_when_finished`); this convenience
/// wrapper exists solely as the `tests/git_process_bounds.rs` seam described
/// above, mirroring `crate::git::CapabilityCache::is_in_flight`'s identical
/// `#[allow(dead_code)]` precedent for a pub(crate) test-only item.
#[allow(dead_code)]
pub(crate) fn resources_are_finished(
    stdout: &SharedStream,
    stderr: &SharedStream,
    retained_child: &mut Option<Child>,
) -> bool {
    matches!(
        probe_readiness(stdout, stderr, retained_child),
        ProbeReadiness::Finished
    )
}

/// Quarantines an unverifiable probe: polling further could never resolve
/// a child whose `try_wait` already errors, so stop — but NEVER reopen
/// admission capacity on that uncertainty. Leaking both the permit (its
/// `Drop` would free a slot) and the retained child keeps the cross-call
/// cap fail-closed: at most `MAX_CONCURRENT_PROBES` such quarantines can
/// ever be outstanding, after which admission fails closed outright. No
/// retry, no kill-by-PID: the child's true fate is unknown and this
/// wrapper must not act on a process it cannot observe.
fn quarantine_unverifiable(permit: AdmissionPermit, retained_child: Option<Child>) {
    std::mem::forget(retained_child);
    std::mem::forget(permit);
}

/// Releases `permit` (and waits out `retained_child`, if any) only once
/// `probe_readiness` reports `Finished` — never merely once this is called.
/// If everything is already finished, this releases immediately with no
/// extra thread; if the probe is unverifiable, this quarantines immediately
/// (see `quarantine_unverifiable`); otherwise it spawns exactly one
/// background watcher that owns `permit`/`retained_child`/the stream
/// handles until they are genuinely done, then drops them — or quarantines
/// them if the retained child ever becomes unverifiable while waiting. An
/// unreaped `retained_child` is therefore never simply discarded: dropping
/// a `Child` neither kills nor waits it, which would leave its true fate
/// (and, on Unix, a potential zombie) unknown forever — this keeps it as
/// an active, polled cleanup owner until `try_wait` actually confirms it
/// exited, or quarantines it if `try_wait` stops answering.
fn release_when_finished(
    permit: AdmissionPermit,
    stdout: SharedStream,
    stderr: SharedStream,
    retained_child: Option<Child>,
) {
    let mut retained_child = retained_child;
    match probe_readiness(&stdout, &stderr, &mut retained_child) {
        ProbeReadiness::Finished => {
            drop(retained_child);
            drop(permit);
        }
        ProbeReadiness::Unverifiable => {
            quarantine_unverifiable(permit, retained_child);
        }
        ProbeReadiness::Unfinished => {
            thread::spawn(move || {
                loop {
                    match probe_readiness(&stdout, &stderr, &mut retained_child) {
                        ProbeReadiness::Finished => {
                            drop(retained_child);
                            drop(permit);
                            return;
                        }
                        ProbeReadiness::Unverifiable => {
                            quarantine_unverifiable(permit, retained_child);
                            return;
                        }
                        ProbeReadiness::Unfinished => thread::sleep(POLL_INTERVAL),
                    }
                }
            });
        }
    }
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
    git_bin: &Path,
) -> Result<SpawnOutcome, RpcError> {
    let cmd = build_git_command_with_bin(git_bin, cwd, argv);
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

// --- bounded mutating git operations (journey J2) ---------------------------
//
// Same bounded-spawn policy as the read-only half above (admission gate,
// timeout, combined byte cap, bounded reap/drain, no shell), extended to the
// five review mutations the Changes panel needs: stage, unstage, commit,
// push and `gh pr create`. Argv stays fully module-built: callers pass only
// typed values (paths, message, title), never strings that reach argv or a
// shell. Paths are passed after `--` so a leading `-` can never become a
// flag; see `literal_pathspec` for the remaining `:(...)` magic edge.

/// Wall-clock budget for one mutating git spawn: generous enough for a hook
/// or a slow remote, still fail-closed via `unverifiable` on expiry.
pub const GIT_MUTATION_TIMEOUT: Duration = Duration::from_secs(60);
/// Combined stdout+stderr cap for mutations (push progress is chatty).
pub const GIT_MUTATION_MAX_OUTPUT: usize = 1024 * 1024;
/// Raw capture cap for `git diff`; the RPC layer truncates to its smaller
/// wire budget with `truncated: true` instead of failing.
pub const GIT_DIFF_MAX_CAPTURE: usize = 256 * 1024;

/// Which review mutation to run. One variant per fixed argv shape, so adding
/// an operation requires a reviewed code change, never a caller string.
#[derive(Debug, Clone)]
pub enum GitMutation {
    Stage {
        paths: Vec<String>,
    },
    Unstage {
        paths: Vec<String>,
    },
    Commit {
        message: String,
        amend: bool,
    },
    Push,
    /// Restore tracked paths from the index: `git checkout -- <paths>`.
    /// Only ever the caller-selected paths, after `--`.
    DiscardTracked {
        paths: Vec<String>,
    },
    /// Remove untracked paths: `git clean -fd -- <paths>`. Scoped to the
    /// selected paths, never `-x` (ignored files survive) and never without
    /// the pathspec (bare `git clean` would sweep the whole worktree).
    DiscardUntracked {
        paths: Vec<String>,
    },
    /// Fast-forward-only pull: never invents a merge commit from a panel click.
    Pull,
    /// Default-remote fetch.
    Fetch,
}

/// Both streams on success: mutations (notably `push`) report on stderr.
#[derive(Debug, Clone)]
pub struct GitCommandOutput {
    pub stdout: String,
    pub stderr: String,
}

pub fn git_mutation_budget() -> GitProbeBudget {
    GitProbeBudget {
        timeout: GIT_MUTATION_TIMEOUT,
        max_combined_output_bytes: GIT_MUTATION_MAX_OUTPUT,
    }
}

pub fn git_diff_budget() -> GitProbeBudget {
    GitProbeBudget {
        timeout: GIT_MUTATION_TIMEOUT,
        max_combined_output_bytes: GIT_DIFF_MAX_CAPTURE,
    }
}

/// A repo-relative path that git must treat literally: pathspec magic such
/// as `:(exclude)` stays active even after `--`, so a (legal, if unusual)
/// filename starting with `:` gets a `./` prefix, which disables magic
/// detection without changing what the path resolves to under cwd=root.
fn literal_pathspec(path: &str) -> String {
    if path.starts_with(':') {
        format!("./{path}")
    } else {
        path.to_string()
    }
}

pub(crate) fn diff_argv(path: &str, staged: bool) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("diff".to_string());
    argv.push("--no-color".to_string());
    argv.push("--no-ext-diff".to_string());
    if staged {
        argv.push("--cached".to_string());
    }
    argv.push("--".to_string());
    argv.push(literal_pathspec(path));
    argv
}

pub(crate) fn stage_argv(paths: &[String]) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("add".to_string());
    argv.push("--".to_string());
    argv.extend(paths.iter().map(|p| literal_pathspec(p)));
    argv
}

pub(crate) fn unstage_argv(paths: &[String]) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(["restore", "--staged", "--"].iter().map(|s| s.to_string()));
    argv.extend(paths.iter().map(|p| literal_pathspec(p)));
    argv
}

pub(crate) fn commit_argv(message: &str, amend: bool) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("commit".to_string());
    if amend {
        argv.push("--amend".to_string());
    }
    argv.push("-m".to_string());
    argv.push(message.to_string());
    argv
}

pub(crate) fn push_argv() -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("push".to_string());
    argv
}

pub(crate) fn discard_tracked_argv(paths: &[String]) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(["checkout", "--"].iter().map(|s| s.to_string()));
    argv.extend(paths.iter().map(|p| literal_pathspec(p)));
    argv
}

pub(crate) fn discard_untracked_argv(paths: &[String]) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(["clean", "-fd", "--"].iter().map(|s| s.to_string()));
    argv.extend(paths.iter().map(|p| literal_pathspec(p)));
    argv
}

pub(crate) fn pull_argv() -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(["pull", "--ff-only"].iter().map(|s| s.to_string()));
    argv
}

pub(crate) fn fetch_argv() -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("fetch".to_string());
    argv
}

pub(crate) fn numstat_argv(paths: &[String], staged: bool) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("diff".to_string());
    argv.push("--numstat".to_string());
    argv.push("-z".to_string());
    // Keep records 1:1 with paths: with rename detection a rename record
    // carries its origPath as a second NUL token, which `parse_numstat_z`
    // must never mistake for the next record. `--no-renames` reports the
    // pair as delete+add instead; counts stay truthful per path.
    argv.push("--no-renames".to_string());
    if staged {
        argv.push("--cached".to_string());
    }
    argv.push("--".to_string());
    argv.extend(paths.iter().map(|p| literal_pathspec(p)));
    argv
}

/// Fixed `gh pr create` argv: title/body ride as values, never a shell, and
/// no `--head`/`--base` is ever invented — the PR targets whatever the
/// current branch already tracks. `--body` always rides along (even empty:
/// gh ≥2.89 rejects a body-less non-interactive create, verified live),
/// so a missing body can never surface as a usage error; the UI mapper
/// (`toPrCreateDisplayError`) strips the echoed argv from failures instead
/// of the argv pretending the call was never half-built (see #176).
pub(crate) fn gh_pr_create_argv(title: &str, body: Option<&str>) -> Vec<String> {
    let mut argv = vec![
        "pr".to_string(),
        "create".to_string(),
        "--title".to_string(),
        title.to_string(),
    ];
    argv.push("--body".to_string());
    argv.push(body.unwrap_or("").to_string());
    argv
}

/// Same bounded-spawn error mapping as `require_success`, but keeps both
/// streams on success and names the real program in messages.
fn require_mutation_success(
    outcome: &SpawnOutcome,
    program: &str,
    argv: &[String],
) -> Result<GitCommandOutput, RpcError> {
    match outcome {
        SpawnOutcome::Exited {
            status,
            stdout,
            stderr,
        } if status.success() => Ok(GitCommandOutput {
            stdout: stdout.clone(),
            stderr: stderr.clone(),
        }),
        SpawnOutcome::Exited { status, stderr, .. } => Err(error::io_error(format!(
            "{program} {} exited with {}: {}",
            argv.join(" "),
            status,
            stderr.trim()
        ))),
        SpawnOutcome::TimedOut => Err(error::unverifiable(format!(
            "{program} {} timed out and was killed before completing",
            argv.join(" ")
        ))),
        SpawnOutcome::CapExceeded => Err(error::io_error(format!(
            "{program} {} exceeded the configured combined output byte cap and was killed",
            argv.join(" ")
        ))),
        SpawnOutcome::UnreapedAfterKill => Err(error::unverifiable(format!(
            "{program} {} was killed but could not be confirmed reaped",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureUnfinished => Err(error::unverifiable(format!(
            "{program} {} exited but its output capture had not finished draining",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureReadError(e) => Err(error::io_error(format!(
            "{program} {} output capture failed: {e}",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureInvalidUtf8(which) => Err(error::io_error(format!(
            "{program} {} produced {which} that is not valid UTF-8",
            argv.join(" ")
        ))),
    }
}

fn run_git_argv(
    workspace_root: &Path,
    argv: &[String],
    budget: &GitProbeBudget,
) -> Result<GitCommandOutput, RpcError> {
    let outcome = spawn_git_and_capture(workspace_root, argv, budget, Path::new("git"))?;
    require_mutation_success(&outcome, "git", argv)
}

/// Runs one typed review mutation with the module's bounded-spawn policy.
pub fn run_git_mutation(
    workspace_root: &Path,
    mutation: &GitMutation,
    budget: &GitProbeBudget,
) -> Result<GitCommandOutput, RpcError> {
    let argv = match mutation {
        GitMutation::Stage { paths } => stage_argv(paths),
        GitMutation::Unstage { paths } => unstage_argv(paths),
        GitMutation::Commit { message, amend } => commit_argv(message, *amend),
        GitMutation::Push => push_argv(),
        GitMutation::DiscardTracked { paths } => discard_tracked_argv(paths),
        GitMutation::DiscardUntracked { paths } => discard_untracked_argv(paths),
        GitMutation::Pull => pull_argv(),
        GitMutation::Fetch => fetch_argv(),
    };
    run_git_argv(workspace_root, &argv, budget)
}

/// One file's numstat line counts. `(None, None)` is binary or otherwise
/// uncountable — never conflated with a genuine zero-line change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NumstatCount {
    pub added: Option<u64>,
    pub removed: Option<u64>,
}

/// Parses `git diff --numstat -z` output: records are
/// `<added>\t<removed>\t<path>\0` (`-\t-` for binary). `-z` disables path
/// quoting, so paths are verbatim. Unknown trailing bytes are rejected
/// rather than silently dropped.
pub(crate) fn parse_numstat_z(output: &str) -> Result<Vec<(String, NumstatCount)>, RpcError> {
    // `-z` terminates every record with NUL; the only legitimate empty
    // token is the trailing artifact after the final terminator.
    let mut tokens: Vec<&str> = output.split('\0').collect();
    if tokens.last() == Some(&"") {
        tokens.pop();
    }
    let mut counts = Vec::with_capacity(tokens.len());
    for token in tokens {
        let mut parts = token.split('\t');
        let (added, removed, path) = match (parts.next(), parts.next(), parts.next()) {
            (Some(a), Some(r), Some(p)) => (a, r, p),
            _ => {
                return Err(error::invalid_argument(format!(
                    "malformed numstat record: {token:?}"
                )));
            }
        };
        if parts.next().is_some() {
            return Err(error::invalid_argument(format!(
                "malformed numstat record (extra field): {token:?}"
            )));
        }
        if path.is_empty() {
            return Err(error::invalid_argument(
                "malformed numstat record (empty path)",
            ));
        }
        let count = if added == "-" || removed == "-" {
            NumstatCount {
                added: None,
                removed: None,
            }
        } else {
            let parse = |field: &str| {
                field.parse::<u64>().map_err(|_| {
                    error::invalid_argument(format!("malformed numstat count: {token:?}"))
                })
            };
            NumstatCount {
                added: Some(parse(added)?),
                removed: Some(parse(removed)?),
            }
        };
        counts.push((path.to_string(), count));
    }
    Ok(counts)
}

/// Upper bound for counting lines of an untracked file as additions.
/// Untracked files over this size report no counts rather than forcing a
/// large read for a sidebar badge.
pub const UNTRACKED_COUNT_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Counts `\n` bytes in a file, capped at `UNTRACKED_COUNT_MAX_BYTES`.
/// Returns `None` for missing/unreadable files, files over budget, and
/// files containing a NUL byte in the scanned prefix (binary heuristic).
pub(crate) fn count_untracked_lines(path: &std::path::Path) -> Option<u64> {
    use std::io::Read as _;
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > UNTRACKED_COUNT_MAX_BYTES {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let mut lines: u64 = 0;
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        if chunk[..n].contains(&0) {
            return None;
        }
        lines += chunk[..n].iter().filter(|b| **b == b'\n').count() as u64;
    }
    Some(lines)
}

/// Numstat records for one side of the diff: `(path, counts)` per file.
pub type NumstatSide = Vec<(String, NumstatCount)>;

/// Per-file staged/unstaged line counts for exactly the given repo-relative
/// paths: one `--cached` and one worktree `git diff --numstat -z` spawn,
/// both bounded by `budget`. Paths absent from a numstat output simply have
/// no entry on that side (unchanged on that side).
pub fn run_git_numstat(
    workspace_root: &std::path::Path,
    paths: &[String],
    budget: &GitProbeBudget,
) -> Result<(NumstatSide, NumstatSide), RpcError> {
    let staged_argv = numstat_argv(paths, true);
    let staged_out = run_git_argv(workspace_root, &staged_argv, budget)?;
    let staged = parse_numstat_z(&staged_out.stdout)?;
    let unstaged_argv = numstat_argv(paths, false);
    let unstaged_out = run_git_argv(workspace_root, &unstaged_argv, budget)?;
    let unstaged = parse_numstat_z(&unstaged_out.stdout)?;
    Ok((staged, unstaged))
}

/// `git rev-parse HEAD` for the just-created commit oid. Read-only and
/// fixed-argv like the rest; fails honestly (non-zero exit) on an unborn
/// HEAD instead of inventing an oid.
pub fn run_git_head_oid(
    workspace_root: &Path,
    budget: &GitProbeBudget,
) -> Result<String, RpcError> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.extend(["rev-parse", "HEAD"].iter().map(|s| s.to_string()));
    let output = run_git_argv(workspace_root, &argv, budget)?;
    Ok(output.stdout.trim().to_string())
}

/// Unified diff for one path: `git diff [--cached] -- <path>`, deterministic
/// flags only (`--no-color --no-ext-diff`). Untracked paths diff empty.
/// `git ls-files --error-unmatch -- <path>` exits 1 exactly when the path
/// has no index entry (untracked); a staged-new file matches, so only a
/// genuinely untracked path takes the `--no-index` route below.
fn is_untracked_path(
    workspace_root: &Path,
    path: &str,
    budget: &GitProbeBudget,
) -> Result<bool, RpcError> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("ls-files".to_string());
    argv.push("--error-unmatch".to_string());
    argv.push("--".to_string());
    argv.push(literal_pathspec(path));
    let outcome = spawn_git_and_capture(workspace_root, &argv, budget, Path::new("git"))?;
    match outcome {
        SpawnOutcome::Exited { status, .. } => Ok(!status.success()),
        // Why: an unverifiable probe must fail the diff, not silently
        // mislabel a tracked file as untracked (or vice versa).
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
            "failed to read git {} output: {e}",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureInvalidUtf8(which) => Err(error::io_error(format!(
            "git {} produced {which} that is not valid UTF-8",
            argv.join(" ")
        ))),
    }
}

/// Read-only all-added diff for one untracked file: `/dev/null` against the
/// working-tree file. `git diff --no-index` already emits the new-file
/// shape (`diff --git a/<path> b/<path>` / `new file mode` / `--- /dev/null`);
/// only the `+++` line carries the bare repo-relative path without the `b/`
/// prefix, which `relocate_untracked_diff_header` rewrites so downstream
/// hunk reconstruction sees the same shape as a tracked-file diff.
fn untracked_diff_argv(path: &str) -> Vec<String> {
    let mut argv: Vec<String> = GLOBAL_ARGS.iter().map(|s| s.to_string()).collect();
    argv.push("diff".to_string());
    argv.push("--no-color".to_string());
    argv.push("--no-ext-diff".to_string());
    argv.push("--no-index".to_string());
    argv.push("--".to_string());
    argv.push("/dev/null".to_string());
    argv.push(literal_pathspec(path));
    argv
}

/// Rewrites the single `+++ <path>` line of a `--no-index` new-file diff to
/// `+++ b/<path>`, matching the `b/` prefix every tracked-file diff carries.
fn relocate_untracked_diff_header(diff: &str, path: &str) -> String {
    let target = format!("+++ {path}");
    let replacement = format!("+++ b/{path}");
    diff.lines()
        .map(|line| {
            if line == target {
                replacement.as_str()
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn run_git_diff(
    workspace_root: &Path,
    path: &str,
    staged: bool,
    budget: &GitProbeBudget,
) -> Result<String, RpcError> {
    let argv = diff_argv(path, staged);
    let output = run_git_argv(workspace_root, &argv, budget)?;
    if !output.stdout.is_empty() {
        return Ok(output.stdout);
    }
    // Why the fallback: untracked files have no index/HEAD blob, so plain
    // `git diff` prints nothing. The fork still shows the file as an
    // all-added diff (its blob read returns an absent left side for
    // untracked paths), so mirror that with a read-only `--no-index` diff
    // against `/dev/null`. Only runs when the probe proves the path is
    // untracked; exit status 1 is `--no-index`'s documented "differences
    // found" signal, not an error.
    if !staged && is_untracked_path(workspace_root, path, budget)? {
        let no_index_argv = untracked_diff_argv(path);
        let outcome =
            spawn_git_and_capture(workspace_root, &no_index_argv, budget, Path::new("git"))?;
        return match outcome {
            SpawnOutcome::Exited { status, stdout, .. }
                if status.success() || status.code() == Some(1) =>
            {
                Ok(relocate_untracked_diff_header(&stdout, path))
            }
            SpawnOutcome::Exited { status, stderr, .. } => Err(error::io_error(format!(
                "git {} exited with {}: {}",
                no_index_argv.join(" "),
                status,
                stderr.trim()
            ))),
            SpawnOutcome::TimedOut => Err(error::unverifiable(format!(
                "git {} timed out and was killed before completing",
                no_index_argv.join(" ")
            ))),
            SpawnOutcome::CapExceeded => Err(error::io_error(format!(
                "git {} exceeded the configured combined output byte cap and was killed",
                no_index_argv.join(" ")
            ))),
            SpawnOutcome::UnreapedAfterKill => Err(error::unverifiable(format!(
                "git {} was killed but could not be confirmed reaped",
                no_index_argv.join(" ")
            ))),
            SpawnOutcome::CaptureUnfinished => Err(error::unverifiable(format!(
                "git {} exited but its output capture had not finished draining",
                no_index_argv.join(" ")
            ))),
            SpawnOutcome::CaptureReadError(e) => Err(error::io_error(format!(
                "failed to read git {} output: {e}",
                no_index_argv.join(" ")
            ))),
            SpawnOutcome::CaptureInvalidUtf8(which) => Err(error::io_error(format!(
                "git {} produced {which} that is not valid UTF-8",
                no_index_argv.join(" ")
            ))),
        };
    }
    Ok(output.stdout)
}

/// Builds a `gh` child with the same bounded env discipline as git (scrub
/// ambient `GIT_*` overrides, pin `LC_ALL=C` for deterministic stderr) but
/// WITHOUT `GIT_OPTIONAL_LOCKS`: `gh` is not git and must still see the
/// caller's `GH_TOKEN`/`GITHUB_TOKEN` auth, which this scrub preserves since
/// neither starts with `GIT_`.
pub(crate) fn build_gh_command_with_bin(gh_bin: &Path, cwd: &Path, argv: &[String]) -> Command {
    let mut cmd = Command::new(gh_bin);
    cmd.args(argv)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in ENV_REMOVE_DENYLIST {
        cmd.env_remove(key);
    }
    for (key, _) in std::env::vars_os() {
        let upper = key.to_string_lossy().to_ascii_uppercase();
        if upper.starts_with("GIT_") {
            cmd.env_remove(key);
        }
    }
    cmd.env("LC_ALL", "C");
    apply_platform_spawn_flags(&mut cmd);
    cmd
}

/// Narrow predicate for "gh cannot act for this host": the binary is missing
/// or it reports an auth-shaped failure. Kept narrow so a real repo error
/// (no remotes, no upstream, network down) stays `io_error`, never a
/// misleading "install/auth gh" hint.
pub(crate) fn is_gh_auth_failure(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    [
        "not authenticated",
        "not logged in",
        "gh auth login",
        "bad credentials",
        "http 401",
        "http 403",
        "missing token",
        "no oauth",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn gh_unavailable(message: String) -> RpcError {
    RpcError::new("gh_unavailable", message)
}

/// First `https?://` line of `gh pr create` output, if any.
pub(crate) fn extract_pr_url(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("https://") || line.starts_with("http://"))
        .map(str::to_string)
}

/// Creates a PR via `gh pr create` and returns its URL. Missing binary and
/// auth-shaped failures map to the typed `gh_unavailable` error; every other
/// failure keeps the git-style `io_error`/`unverifiable` mapping.
pub fn run_gh_pr_create(
    workspace_root: &Path,
    title: &str,
    body: Option<&str>,
    budget: &GitProbeBudget,
) -> Result<String, RpcError> {
    run_gh_pr_create_with_bin(Path::new("gh"), workspace_root, title, body, budget)
}

/// Same as `run_gh_pr_create` but spawns `gh_bin` directly: the test seam
/// for the typed `gh_unavailable` error with zero process-global `PATH`
/// mutation (mirrors `run_read_only_git_with_bin`'s rationale).
pub fn run_gh_pr_create_with_bin(
    gh_bin: &Path,
    workspace_root: &Path,
    title: &str,
    body: Option<&str>,
    budget: &GitProbeBudget,
) -> Result<String, RpcError> {
    let argv = gh_pr_create_argv(title, body);
    let outcome = match spawn_and_capture_bounded(
        build_gh_command_with_bin(gh_bin, workspace_root, &argv),
        budget,
    ) {
        Ok(outcome) => outcome,
        // Admission exhaustion (`runtime_busy`) is the caller's signal to
        // retry, never a statement about gh — only a spawn `io_error`
        // (missing binary) becomes `gh_unavailable`.
        Err(spawn_err) if spawn_err.code == "io_error" => {
            return Err(gh_unavailable(format!(
                "gh executable could not be spawned ({}): install gh or check PATH",
                spawn_err.message
            )));
        }
        Err(spawn_err) => return Err(spawn_err),
    };
    match outcome {
        SpawnOutcome::Exited { status, stdout, .. } if status.success() => extract_pr_url(&stdout)
            .ok_or_else(|| {
                error::io_error(format!(
                    "gh {} succeeded but printed no PR URL: {}",
                    argv.join(" "),
                    stdout.trim()
                ))
            }),
        SpawnOutcome::Exited { stderr, .. } if is_gh_auth_failure(&stderr) => {
            Err(gh_unavailable(format!(
                "gh is not authenticated for this host ({}): run `gh auth login`, then retry",
                stderr.trim()
            )))
        }
        other => Err(require_mutation_success(&other, "gh", &argv).unwrap_err()),
    }
}

/// #175/#176 argv-shape pins: bulk stage is always an explicit path list
/// (`git add -- <paths>`, never `-A`/`-u`), remote detection is names-only
/// (`git remote`, never `-v`), and `gh pr create` always carries `--body`.
#[cfg(test)]
mod scoped_argv_tests {
    use super::{gh_pr_create_argv, remote_argv, stage_argv};

    #[test]
    fn stage_argv_is_an_explicit_scoped_add() {
        let argv = stage_argv(&["a.txt".to_string(), "<!-- odd -->.html".to_string()]);
        assert!(argv.contains(&"add".to_string()));
        assert!(
            !argv
                .iter()
                .any(|arg| arg == "-A" || arg == "--all" || arg == "-u" || arg == "--update")
        );
        let dashdash = argv.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(
            &argv[dashdash + 1..],
            &["a.txt".to_string(), "<!-- odd -->.html".to_string()]
        );
    }

    #[test]
    fn remote_argv_lists_names_without_urls() {
        let argv = remote_argv();
        assert_eq!(argv.last().unwrap(), "remote");
        assert!(!argv.iter().any(|arg| arg == "-v" || arg == "--verbose"));
    }

    #[test]
    fn pr_create_argv_always_carries_a_body_flag() {
        // gh ≥2.89 rejects a body-less non-interactive create (verified
        // live against gh 2.89.0), so even a missing body rides as `--body
        // ""`; the UI mapper strips the echoed argv from failures.
        let bare = gh_pr_create_argv("Update index.html", None);
        assert_eq!(
            bare.join(" "),
            "pr create --title Update index.html --body "
        );
        let with_body = gh_pr_create_argv("T", Some("notes"));
        assert!(with_body.join(" ").ends_with("--body notes"));
    }
}

#[cfg(test)]
mod numstat_tests {
    use super::parse_numstat_z;

    #[test]
    fn parses_add_delete_and_binary_records() {
        let counts = parse_numstat_z("3\t1\tedit.txt\0-\t-\tblob.bin\0").unwrap();
        assert_eq!(counts.len(), 2);
        assert_eq!(counts[0].0, "edit.txt");
        assert_eq!(counts[0].1.added, Some(3));
        assert_eq!(counts[0].1.removed, Some(1));
        // Binary is uncountable, never zero.
        assert_eq!(counts[1].1.added, None);
        assert_eq!(counts[1].1.removed, None);
    }

    #[test]
    fn accepts_empty_output_and_rejects_malformed_records() {
        assert!(parse_numstat_z("").unwrap().is_empty());
        assert!(parse_numstat_z("3\t1\0").is_err());
        assert!(parse_numstat_z("x\ty\tfile.txt\0").is_err());
        assert!(parse_numstat_z("3\t1\tfile.txt\textra\0").is_err());
        assert!(parse_numstat_z("3\t1\t\0").is_err());
    }
}
