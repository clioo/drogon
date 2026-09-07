//! Behavioral tests for the four production corrections applied to the
//! bounded read-only Git process wrapper (`src/git_process.rs`): EOF/error-
//! proven capture (never `String::from_utf8_lossy`, never a success built
//! from an unfinished/errored stream snapshot), bounded reap (never an
//! unbounded `wait()`), Follower coalescing (a Follower never spawns the
//! preferred probe), and the fixed `GIT_DIR`/etc. env denylist. Companion to
//! `tests/git_process.rs` (which owns the original happy-path/timeout/byte-
//! cap/argv-determinism coverage) — this file only covers the new
//! corrections, so it does not duplicate that file's scope. Compiles
//! `src/error.rs`, `src/git.rs`, `src/git_worktree.rs` and
//! `src/git_process.rs` directly via `#[path]`, the same trick both
//! `tests/git_baseline.rs` and `tests/git_process.rs` already use.
//!
//! Fixtures are OWNED: either a real temp git repo created by this file's own
//! helpers, or a self-spawn of this very test binary via `current_exe()`
//! (never a `sleep` binary, never any dependence on an installed Git
//! version) acting as its own bounded, disposable fixture process.

#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[allow(dead_code)]
#[path = "../src/git.rs"]
mod git;
#[allow(dead_code)]
#[path = "../src/git_worktree.rs"]
mod git_worktree;
// This file only exercises `WorktreeList`/`SpawnOutcome`/env-scrub
// corrections, never `ReadOnlyGitOperation::Status` (that's
// `tests/git_process.rs`'s coverage) — mirrored `#[allow(dead_code)]`
// treatment, narrowed to this file's own scope.
#[allow(dead_code)]
#[path = "../src/git_process.rs"]
mod git_process;

use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use git::{Capability, CapabilityCache, HostScope, ProbeOutcome};
use git_process::{
    GitProbeBudget, ParsedGitOutput, ReadOnlyGitOperation, SpawnOutcome, run_read_only_git,
};

const GENEROUS_TIMEOUT: Duration = Duration::from_secs(30);
const GENEROUS_CAP: usize = 16 * 1024 * 1024;

fn generous_budget() -> GitProbeBudget {
    GitProbeBudget {
        timeout: GENEROUS_TIMEOUT,
        max_combined_output_bytes: GENEROUS_CAP,
    }
}

// --- owned fixture helpers ---------------------------------------------------

fn unique_dir(tag: &str) -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "drogon_git_process_bounds_{tag}_{}_{}_{unique}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

/// A minimal owned temp git repo: just enough for `worktree list
/// --porcelain[-z]` to succeed (no commit needed — the main worktree entry
/// is always present). Self-cleaning on drop.
struct TempRepo {
    dir: PathBuf,
}

impl TempRepo {
    fn init(tag: &str) -> Self {
        let dir = unique_dir(tag);
        std::fs::create_dir_all(&dir).expect("create temp repo dir");
        let output = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&dir)
            .output()
            .expect("spawn real git binary for fixture generation");
        assert!(
            output.status.success(),
            "git init failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        TempRepo { dir }
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

// =============================================================================
// Fix 1: EOF/error-proven capture
// =============================================================================

// --- read error: SharedStream records the first read error, never silently
//     swallows it ------------------------------------------------------------

/// Errors on its very first `read` call. An owned, in-process synthetic
/// fixture (mirrors `tests/git_process.rs`'s `InfiniteReader` pattern for the
/// byte-cap test), not a real subprocess — real OS pipes give no portable,
/// deterministic way to force a read error.
struct ErroringReader;

impl Read for ErroringReader {
    fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other(
            "synthetic read error for git_process_bounds",
        ))
    }
}

#[test]
fn spawn_stream_reader_records_the_first_read_error() {
    let combined_len = Arc::new(AtomicUsize::new(0));
    let cap_hit = Arc::new(AtomicBool::new(false));

    let stream = git_process::spawn_stream_reader(ErroringReader, combined_len, 1024, cap_hit);

    let deadline = Instant::now() + Duration::from_secs(5);
    while !stream.finished.load(Ordering::SeqCst) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(
        stream.finished.load(Ordering::SeqCst),
        "reader thread should stop after a read error"
    );

    let recorded = stream.read_error.lock().unwrap().clone();
    assert!(
        recorded.is_some(),
        "a real Read::read error must be recorded, never silently dropped"
    );
}

// --- unfinished inherited pipe: never success on a 200ms snapshot of a
//     stream that never reached EOF ------------------------------------------

/// Self-spawn helper test: when invoked directly (env var set), spawns a
/// grandchild that inherits ITS OWN stdout/stderr (which are, in turn, the
/// piped fds this file's real test below gave to this very process), then
/// returns immediately — reproducing "a grandchild inherited the pipe's
/// write end and kept it open after the immediate child exited" without any
/// external `sleep` binary or Git version dependency. Under a normal `cargo
/// test` run (no env var set) this is a fast no-op.
#[test]
fn helper_hold_pipe_open() {
    let Ok(grandchild_sleep_ms) = std::env::var("DROGON_TEST_HOLD_PIPE_GRANDCHILD_SLEEP_MS") else {
        return;
    };
    let exe = std::env::current_exe().expect("current_exe for self-spawn fixture");
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "helper_sleep_ms",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]);
    cmd.env("DROGON_TEST_SLEEP_MS", grandchild_sleep_ms);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::inherit());
    cmd.stderr(Stdio::inherit());
    // Deliberately never waited on: this "immediate child" (as observed by
    // the real code under test) must exit while the grandchild below keeps
    // the inherited pipe open. Dropping `Child` neither kills nor waits for
    // it; the grandchild self-terminates via its own bounded sleep.
    #[allow(clippy::zombie_processes)]
    let _grandchild = cmd
        .spawn()
        .expect("spawn self-spawn grandchild pipe holder");
}

/// Self-spawn helper test: when invoked directly (env var set), sleeps for
/// the requested duration then exits. Under a normal `cargo test` run this
/// is a fast no-op.
#[test]
fn helper_sleep_ms() {
    let Ok(ms) = std::env::var("DROGON_TEST_SLEEP_MS") else {
        return;
    };
    let ms: u64 = ms
        .parse()
        .expect("DROGON_TEST_SLEEP_MS must be a valid u64");
    std::thread::sleep(Duration::from_millis(ms));
}

#[test]
fn spawn_and_capture_bounded_reports_capture_unfinished_when_a_grandchild_holds_the_pipe_open() {
    let exe = std::env::current_exe().expect("current_exe for self-spawn fixture");
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "helper_hold_pipe_open",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]);
    // Long enough to reliably outlast `READER_DRAIN_GRACE` (200ms) so this
    // test is not flaky under load; short enough to keep the orphaned
    // grandchild's lifetime bounded and unobtrusive.
    cmd.env("DROGON_TEST_HOLD_PIPE_GRANDCHILD_SLEEP_MS", "1500");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let budget = GitProbeBudget {
        timeout: Duration::from_secs(10),
        max_combined_output_bytes: GENEROUS_CAP,
    };
    let outcome = git_process::spawn_and_capture_bounded(cmd, &budget)
        .expect("bounded capture should not itself error on an unfinished drain");

    assert!(
        matches!(outcome, SpawnOutcome::CaptureUnfinished),
        "expected CaptureUnfinished (never a trusted Exited success) while a grandchild \
         still holds the pipe open, got {outcome:?}"
    );
}

// --- invalid-UTF8 stdout: String::from_utf8, never from_utf8_lossy ---------

/// Self-spawn helper test: when invoked directly (env var set), writes raw
/// invalid-UTF-8 bytes to stdout then exits. Under a normal `cargo test` run
/// this is a fast no-op.
#[test]
fn helper_write_invalid_utf8_stdout() {
    if std::env::var("DROGON_TEST_WRITE_INVALID_UTF8").is_err() {
        return;
    }
    // 0xFF is not a valid UTF-8 lead byte in any position; 0xC0 0x80 is an
    // overlong encoding, also invalid. Together they are unambiguous, real
    // invalid UTF-8 that `String::from_utf8` must reject.
    let _ = io::stdout().write_all(&[b'o', b'k', 0xFF, 0xC0, 0x80]);
    let _ = io::stdout().flush();
}

#[test]
fn spawn_and_capture_bounded_reports_capture_invalid_utf8_never_lossy() {
    let exe = std::env::current_exe().expect("current_exe for self-spawn fixture");
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "helper_write_invalid_utf8_stdout",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]);
    cmd.env("DROGON_TEST_WRITE_INVALID_UTF8", "1");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let outcome = git_process::spawn_and_capture_bounded(cmd, &generous_budget())
        .expect("bounded capture should not itself error on invalid UTF-8");

    assert!(
        matches!(outcome, SpawnOutcome::CaptureInvalidUtf8("stdout")),
        "expected CaptureInvalidUtf8(\"stdout\") — String::from_utf8_lossy must never be used \
         to silently paper over invalid UTF-8, got {outcome:?}"
    );
}

// =============================================================================
// Fix 2: bounded reap (never unbounded `wait()`)
// =============================================================================

#[test]
fn kill_and_reap_returns_reaped_true_for_a_real_child() {
    let mut child = std::env::current_exe()
        .map(|exe| {
            let mut cmd = std::process::Command::new(exe);
            cmd.args([
                "helper_sleep_ms",
                "--exact",
                "--nocapture",
                "--test-threads=1",
            ]);
            cmd.env("DROGON_TEST_SLEEP_MS", "5000");
            cmd.stdin(Stdio::null());
            cmd.stdout(Stdio::null());
            cmd.stderr(Stdio::null());
            cmd
        })
        .expect("current_exe for self-spawn fixture")
        .spawn()
        .expect("spawn a real long-running self-spawn child");

    let start = Instant::now();
    let outcome = git_process::kill_and_reap(&mut child);
    let elapsed = start.elapsed();

    assert!(
        outcome.reaped,
        "a real, freshly-killed child must be confirmed reaped"
    );
    assert!(
        elapsed < Duration::from_secs(2),
        "kill_and_reap must be bounded by REAP_GRACE, not an unbounded wait(); took {elapsed:?}"
    );
    assert!(
        matches!(child.try_wait(), Ok(Some(_))),
        "child must be reaped (no zombie) after kill_and_reap"
    );
}

// =============================================================================
// Fix 3: Follower coalescing
// =============================================================================

#[test]
fn follower_worktree_list_argv_is_always_the_fallback_form() {
    // A Follower must NEVER spawn the preferred probe, regardless of any
    // cache state — this function's return value is the sole source of
    // truth for what a Follower spawns, so pinning it here is sufficient to
    // prove the invariant independent of thread scheduling.
    let argv = git_process::follower_worktree_list_argv();
    assert_eq!(argv, git_process::worktree_list_fallback_argv());
    assert_ne!(argv, git_process::worktree_list_preferred_argv());
    assert!(!argv.contains(&"-z".to_string()));
}

#[test]
fn many_concurrent_first_probes_yield_exactly_one_leader() {
    // Reproduces "many concurrent first-ever callers" at the exact
    // decision point (`CapabilityCache::begin_probe`) that determines who
    // may spend the one preferred-command attempt: a `Barrier` forces every
    // thread to call `begin_probe` as close to simultaneously as possible,
    // so this is a real race, not a sequential approximation of one.
    const CONCURRENT_CALLERS: usize = 16;
    let cache = Arc::new(CapabilityCache::new());
    let scope = HostScope::native();
    let barrier = Arc::new(Barrier::new(CONCURRENT_CALLERS));

    let handles: Vec<_> = (0..CONCURRENT_CALLERS)
        .map(|_| {
            let cache = Arc::clone(&cache);
            let scope = scope.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                cache.begin_probe(&scope, Capability::WorktreeListZ)
            })
        })
        .collect();

    let outcomes: Vec<ProbeOutcome> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let leader_count = outcomes
        .iter()
        .filter(|o| **o == ProbeOutcome::Leader)
        .count();
    assert_eq!(
        leader_count, 1,
        "exactly one of {CONCURRENT_CALLERS} concurrent first-ever callers must become Leader"
    );
    assert_eq!(outcomes.len() - leader_count, CONCURRENT_CALLERS - 1);
}

#[test]
fn many_concurrent_worktree_list_calls_against_a_real_repo_all_succeed_with_at_most_one_rejection_recorded()
 {
    // End-to-end: many concurrent real callers sharing one cache against one
    // real repo. Every caller must get a correct answer (Leader via
    // preferred-or-fallback, every Follower via `follower_worktree_list_argv`
    // per the unit test above), and the cache must end up in a single,
    // consistent state — never torn by a Follower racing the Leader's
    // record_success/record_rejection.
    const CONCURRENT_CALLERS: usize = 8;
    let repo = TempRepo::init("many-concurrent-worktree-list");
    let cache = Arc::new(CapabilityCache::new());
    let scope = HostScope::native();
    let barrier = Arc::new(Barrier::new(CONCURRENT_CALLERS));

    let handles: Vec<_> = (0..CONCURRENT_CALLERS)
        .map(|_| {
            let cache = Arc::clone(&cache);
            let scope = scope.clone();
            let barrier = Arc::clone(&barrier);
            let dir = repo.dir.clone();
            std::thread::spawn(move || {
                barrier.wait();
                run_read_only_git(
                    ReadOnlyGitOperation::WorktreeList,
                    &dir,
                    &scope,
                    &cache,
                    generous_budget(),
                )
            })
        })
        .collect();

    for handle in handles {
        let result = handle.join().unwrap();
        match result.expect("every concurrent caller must get a real worktree list") {
            ParsedGitOutput::WorktreeList(entries) => {
                assert_eq!(
                    entries.len(),
                    1,
                    "a repo with no linked worktrees has exactly one entry"
                );
            }
            other => panic!("expected WorktreeList output, got {other:?}"),
        }
    }

    // Real (modern) Git on this host accepts the preferred `-z` form, so the
    // Leader's attempt should have succeeded and no rejection should be
    // recorded for any Follower to have raced against.
    assert!(!cache.is_rejected(&scope, Capability::WorktreeListZ));
}

// --- retry-after-error: once a rejection is recorded, subsequent real calls
//     correctly retry via the fallback and still succeed -------------------

#[test]
fn worktree_list_retries_via_fallback_and_still_succeeds_after_a_recorded_rejection() {
    let repo = TempRepo::init("retry-after-error");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    // Pre-seed a fresh rejection, simulating a prior real probe against an
    // old Git that does not understand `-z`.
    cache.record_rejection(&scope, Capability::WorktreeListZ);
    assert!(!git_process::should_try_preferred_worktree_list(
        &scope, &cache
    ));

    let result = run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        &repo.dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect("a real call must still succeed via the fallback after a recorded rejection");

    match result {
        ParsedGitOutput::WorktreeList(entries) => assert_eq!(entries.len(), 1),
        other => panic!("expected WorktreeList output, got {other:?}"),
    }
    // The rejection is untouched: this call never attempted (and so never
    // disproved) the preferred form, so the self-heal record must survive
    // exactly as pre-seeded until `WORKTREE_LIST_Z_RETRY_INTERVAL` elapses.
    assert!(cache.is_rejected(&scope, Capability::WorktreeListZ));
}

// --- guard-release-on-error: ProbeGuard Drop releases in_flight on EVERY
//     failure path, including a pre-spawn error ------------------------------

#[test]
fn worktree_list_probe_guard_releases_on_a_pre_spawn_error() {
    // A `current_dir` pointing at a nonexistent directory makes the real OS
    // spawn call itself fail (before this wrapper can determine
    // success/rejection) — the exact "pre-spawn error" path the Leader's
    // `ProbeGuard` Drop must still cover, distinct from the
    // already-covered "real git exited non-zero" error path.
    let dir = unique_dir("worktree-guard-prespawn");
    // Deliberately never created.
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let err = run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        &dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect_err("worktree list with a nonexistent cwd must fail at spawn, before any outcome");
    assert_eq!(err.code, "io_error");

    // If the guard's Drop had not run on that pre-spawn early return, this
    // would observe Follower instead of Leader.
    assert_eq!(
        cache.begin_probe(&scope, Capability::WorktreeListZ),
        ProbeOutcome::Leader
    );
}

// =============================================================================
// Fix 4: env scrub — fixed GIT_* denylist
// =============================================================================

#[test]
fn build_git_command_removes_the_fixed_git_context_denylist() {
    let argv = git_process::status_argv();
    let cwd = std::path::Path::new(".");
    let cmd = git_process::build_git_command(cwd, &argv);

    // `Command::get_envs()` reports an explicit `env_remove` as `(key,
    // None)` unconditionally (verified against `std::process::Command`'s
    // own documented behavior), regardless of whether this test process
    // itself happens to have the variable set — so this assertion needs no
    // global `std::env::set_var` mutation, which would otherwise be racy
    // against this binary's other concurrently-running tests.
    let envs: std::collections::HashMap<String, Option<String>> = cmd
        .get_envs()
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                v.map(|v| v.to_string_lossy().into_owned()),
            )
        })
        .collect();

    for key in git_process::ENV_REMOVE_DENYLIST {
        assert_eq!(
            envs.get(*key),
            Some(&None),
            "{key} must be explicitly removed (Some(None) from get_envs), not merely absent"
        );
    }
}
