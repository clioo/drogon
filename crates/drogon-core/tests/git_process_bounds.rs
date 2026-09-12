//! Behavioral tests for the production corrections applied to the bounded
//! read-only Git process wrapper (`src/git_process.rs`): EOF/error-proven
//! capture (never `String::from_utf8_lossy`, never a success built from an
//! unfinished/errored stream snapshot), bounded reap (never an unbounded
//! `wait()`), Follower coalescing (a Follower never spawns the preferred
//! probe), the fixed `GIT_DIR`/etc. env denylist, the `drain_or_snapshot`
//! finished-before-buf ordering fix, the broad `GIT_`-prefixed config-
//! injection env scrub, and the cross-call admission bound (fail-closed at
//! capacity, permits/retained children released only once genuinely done).
//! Companion to `tests/git_process.rs` (which owns the original happy-path/
//! timeout/byte-cap/argv-determinism coverage) — this file only covers the
//! new corrections, so it does not duplicate that file's scope. Compiles
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
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use std::thread;
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
    // Long enough to reliably outlast `READER_DRAIN_GRACE` (5s) so this
    // test is not flaky under load AND so the grandchild cannot close the
    // pipe inside the grace and flip the outcome to a (bogus here)
    // trusted exit; short enough to keep the orphaned grandchild's
    // lifetime bounded and unobtrusive.
    cmd.env("DROGON_TEST_HOLD_PIPE_GRANDCHILD_SLEEP_MS", "7000");
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

// =============================================================================
// Correction 1(a): drain_or_snapshot never mislabels a stale buf snapshot
// as complete
// =============================================================================

fn synthetic_shared_stream() -> git_process::SharedStream {
    git_process::SharedStream {
        buf: Arc::new(Mutex::new(Vec::new())),
        finished: Arc::new(AtomicBool::new(false)),
        read_error: Arc::new(Mutex::new(None)),
    }
}

#[test]
fn drain_or_snapshot_never_reports_finished_true_with_a_pre_final_buf_snapshot() {
    // Deterministic, barrier-synchronized regression for the fix: a writer
    // thread mirrors `spawn_stream_reader`'s own program order exactly
    // (append the final chunk to `buf`, THEN set `finished`) while the main
    // thread calls `drain_or_snapshot` with an ALREADY-EXPIRED deadline, so
    // its internal wait loop never spins — it reads `finished`/`buf`
    // immediately, racing the writer as tightly as two real threads can. A
    // `Barrier` synchronizes only the START of the race (never used to
    // "hope" for a specific interleave via sleep timing); the invariant
    // checked below must hold regardless of how the two threads are then
    // scheduled, and is run over many iterations to make a real regression
    // overwhelmingly likely to surface.
    const ITERATIONS: usize = 500;
    const FINAL_CHUNK: &[u8] = b"final-chunk-bytes";

    for _ in 0..ITERATIONS {
        let stream = synthetic_shared_stream();
        let buf = Arc::clone(&stream.buf);
        let finished = Arc::clone(&stream.finished);
        let barrier = Arc::new(Barrier::new(2));
        let barrier_writer = Arc::clone(&barrier);

        let writer = thread::spawn(move || {
            barrier_writer.wait();
            buf.lock().unwrap().extend_from_slice(FINAL_CHUNK);
            finished.store(true, Ordering::SeqCst);
        });

        barrier.wait();
        // Already in the past: `drain_or_snapshot`'s bounded wait loop exits
        // immediately without spinning, maximizing overlap with the writer
        // thread above instead of waiting it out.
        let expired_deadline = Instant::now() - Duration::from_millis(1);
        let drained = git_process::drain_or_snapshot(&stream, expired_deadline);

        writer.join().unwrap();

        // The only invariant the fix guarantees: whenever `finished` reads
        // true, the bytes must be the COMPLETE final content — never a
        // shorter, pre-final snapshot mislabeled as complete. Observing
        // `finished == false` here is also valid (the writer simply hadn't
        // run yet) and asserts nothing further.
        if drained.finished {
            assert_eq!(
                drained.bytes, FINAL_CHUNK,
                "finished == true must never be paired with a buf snapshot taken \
                 before the writer's final append"
            );
        }
    }
}

// =============================================================================
// Correction 2: config-injection env scrub (broad GIT_-prefixed removal)
// =============================================================================

/// Self-spawn helper test: when invoked directly (via the env vars the
/// parent test below sets), proves two things inside a process that
/// genuinely inherits ROOT's exact captured injection shape
/// (`GIT_CONFIG_COUNT=1`/`GIT_CONFIG_KEY_0=core.worktree`/
/// `GIT_CONFIG_VALUE_0=<foreign path>`), never via `get_envs()` assertions
/// alone:
/// (1) a raw `git <GLOBAL_ARGS> config --get core.worktree` probe, built
///     and spawned through this module's own `build_git_command`/
///     `spawn_and_capture_bounded`, must never echo the foreign path back —
///     proving the scrub actually reaches a real spawned `git` process
///     (mirrors ROOT's own captured receipt, which used exactly this
///     `config --get` shape to demonstrate the injection).
/// (2) `run_read_only_git`'s real `WorktreeList` operation, called against
///     the SELECTED of two real owned repos, must report the selected
///     repo's own path — never the foreign one — despite the injected env.
/// Under a normal `cargo test` run (no env vars set) this is a fast no-op.
#[test]
fn helper_assert_config_env_injection_is_scrubbed_and_selected_cwd_is_read() {
    let (Ok(selected_dir), Ok(foreign_dir)) = (
        std::env::var("DROGON_TEST_SELECTED_REPO_DIR"),
        std::env::var("DROGON_TEST_FOREIGN_REPO_DIR"),
    ) else {
        return;
    };

    assert_eq!(
        std::env::var("GIT_CONFIG_COUNT").as_deref(),
        Ok("1"),
        "test setup error: the injected env must be present in THIS process for the scrub \
         (which scans this process's real environment) to have anything real to remove"
    );

    let mut argv: Vec<String> = git_process::GLOBAL_ARGS
        .iter()
        .map(|s| s.to_string())
        .collect();
    argv.extend(
        ["config", "--get", "core.worktree"]
            .iter()
            .map(|s| s.to_string()),
    );
    let cmd = git_process::build_git_command(Path::new(&selected_dir), &argv);
    let outcome = git_process::spawn_and_capture_bounded(cmd, &generous_budget())
        .expect("spawning the config probe itself must not fail");
    match outcome {
        SpawnOutcome::Exited { status, stdout, .. } => {
            assert!(
                !status.success(),
                "core.worktree must read back unset once the injected env is scrubbed \
                 (a freshly-init'd repo never sets it itself), got stdout: {stdout:?}"
            );
            assert!(
                !stdout.contains(&foreign_dir),
                "the foreign injected core.worktree value must never leak into a spawned \
                 git process, got stdout: {stdout:?}"
            );
        }
        other => panic!("expected a completed config probe, got {other:?}"),
    }

    let cache = CapabilityCache::new();
    let scope = HostScope::native();
    let result = run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        Path::new(&selected_dir),
        &scope,
        &cache,
        generous_budget(),
    )
    .expect("run_read_only_git must succeed against the selected repo despite injected config");

    match result {
        ParsedGitOutput::WorktreeList(entries) => {
            assert_eq!(
                entries.len(),
                1,
                "the selected repo has exactly one worktree entry"
            );
            let reported = std::fs::canonicalize(&entries[0].path)
                .expect("reported worktree path must resolve to a real directory");
            let expected = std::fs::canonicalize(&selected_dir)
                .expect("selected fixture dir must exist and canonicalize");
            assert_eq!(
                reported, expected,
                "must report the SELECTED repo's own path, never the foreign one"
            );
            assert!(
                !entries[0].path.contains(&foreign_dir),
                "must never leak the foreign injected worktree path into real output"
            );
        }
        other => panic!("expected WorktreeList output, got {other:?}"),
    }
}

#[test]
fn worktree_list_and_config_reads_ignore_injected_git_config_env_pointing_at_a_foreign_worktree() {
    let selected = TempRepo::init("config-injection-selected");
    let foreign = TempRepo::init("config-injection-foreign");
    let isolated_home = unique_dir("config-injection-isolated-home");
    std::fs::create_dir_all(&isolated_home).expect("create isolated HOME for fixture hygiene");

    let exe = std::env::current_exe().expect("current_exe for self-spawn fixture");
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "helper_assert_config_env_injection_is_scrubbed_and_selected_cwd_is_read",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]);
    cmd.env(
        "DROGON_TEST_SELECTED_REPO_DIR",
        selected.dir.to_string_lossy().into_owned(),
    );
    cmd.env(
        "DROGON_TEST_FOREIGN_REPO_DIR",
        foreign.dir.to_string_lossy().into_owned(),
    );
    // ROOT's exact captured injection shape.
    cmd.env("GIT_CONFIG_COUNT", "1");
    cmd.env("GIT_CONFIG_KEY_0", "core.worktree");
    cmd.env(
        "GIT_CONFIG_VALUE_0",
        foreign.dir.to_string_lossy().into_owned(),
    );
    // Isolate the fixture's own git config: no inherited hooks/signing/
    // attributes from this development host's real user or system config —
    // never the user's real repo/config, and never mutated in place.
    cmd.env("HOME", &isolated_home);
    cmd.env("XDG_CONFIG_HOME", &isolated_home);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd.output().expect("spawn self-spawn helper process");
    assert!(
        output.status.success(),
        "helper assertion failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let _ = std::fs::remove_dir_all(&isolated_home);
}

// =============================================================================
// Correction 3: cross-call admission bound
// =============================================================================

/// Self-spawn helper test: when invoked directly (env var set), drains
/// EVERY real admission slot and asserts exhaustion/exact-recovery. Run in
/// its OWN process (own fresh `IN_FLIGHT_PROBES`), never inline in this
/// binary's normal parallel test run — intentionally draining the ENTIRE
/// process-wide admission pool would otherwise race every other
/// concurrently-running test in this file that also acquires a real
/// admission permit (there are several), exactly the kind of cross-test
/// interference this file's other `helper_*` self-spawn fixtures already
/// avoid for other shared, ambient state. Under a normal `cargo test` run
/// (no env var set) this is a fast no-op.
#[test]
fn helper_admission_gate_fails_closed_at_capacity_then_recovers_exactly_on_release() {
    if std::env::var("DROGON_TEST_RUN_ADMISSION_GATE_CHECK").is_err() {
        return;
    }

    let mut permits = Vec::with_capacity(git_process::MAX_CONCURRENT_PROBES);
    for _ in 0..git_process::MAX_CONCURRENT_PROBES {
        permits.push(
            git_process::try_acquire_admission()
                .expect("must be able to acquire up to MAX_CONCURRENT_PROBES permits"),
        );
    }

    assert!(
        git_process::try_acquire_admission().is_none(),
        "admission must fail closed once MAX_CONCURRENT_PROBES permits are held"
    );

    // Recovery is exact, not all-or-nothing: releasing exactly one permit
    // must free exactly one admission slot.
    permits.pop();
    let recovered = git_process::try_acquire_admission();
    assert!(
        recovered.is_some(),
        "releasing exactly one permit must free exactly one admission slot"
    );
    assert!(
        git_process::try_acquire_admission().is_none(),
        "the pool must be exhausted again immediately after that one recovered slot is retaken"
    );

    drop(recovered);
    drop(permits);
}

#[test]
fn admission_gate_fails_closed_at_capacity_then_recovers_exactly_on_release() {
    let exe = std::env::current_exe().expect("current_exe for self-spawn fixture");
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "helper_admission_gate_fails_closed_at_capacity_then_recovers_exactly_on_release",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]);
    cmd.env("DROGON_TEST_RUN_ADMISSION_GATE_CHECK", "1");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd.output().expect("spawn self-spawn helper process");
    assert!(
        output.status.success(),
        "admission gate exhaustion/recovery check failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn resources_are_finished_is_false_until_both_streams_finish() {
    let stdout = synthetic_shared_stream();
    let stderr = synthetic_shared_stream();
    let mut no_child: Option<std::process::Child> = None;

    assert!(
        !git_process::resources_are_finished(&stdout, &stderr, &mut no_child),
        "neither stream has finished yet"
    );

    stdout.finished.store(true, Ordering::SeqCst);
    assert!(
        !git_process::resources_are_finished(&stdout, &stderr, &mut no_child),
        "only one of the two streams has finished"
    );

    stderr.finished.store(true, Ordering::SeqCst);
    assert!(
        git_process::resources_are_finished(&stdout, &stderr, &mut no_child),
        "both streams finished and there is no child left to confirm"
    );
}

#[test]
fn resources_are_finished_also_waits_for_a_retained_child_to_be_confirmed_exited() {
    // Real self-spawn child (never a synthetic Read) so `Child::try_wait`
    // reflects a genuine, observable process lifecycle — deterministic in
    // outcome even though the exact moment of exit depends on the OS
    // scheduler, since the test only asserts before/after a bounded wait
    // for that exit, never a race window.
    let exe = std::env::current_exe().expect("current_exe for self-spawn fixture");
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "helper_sleep_ms",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ]);
    cmd.env("DROGON_TEST_SLEEP_MS", "300");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    let child = cmd
        .spawn()
        .expect("spawn a real short-lived self-spawn child");

    let stdout = synthetic_shared_stream();
    let stderr = synthetic_shared_stream();
    stdout.finished.store(true, Ordering::SeqCst);
    stderr.finished.store(true, Ordering::SeqCst);
    let mut retained = Some(child);

    assert!(
        !git_process::resources_are_finished(&stdout, &stderr, &mut retained),
        "both streams are finished, but the retained child has not exited yet — \
         it must still be waited on, never discarded early"
    );

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut confirmed = false;
    while Instant::now() < deadline {
        if git_process::resources_are_finished(&stdout, &stderr, &mut retained) {
            confirmed = true;
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        confirmed,
        "must eventually confirm the retained child exited, bounded by this test's own deadline"
    );
}

#[test]
fn child_poll_classification_counts_only_a_confirmed_exit_as_done() {
    // Deterministic Err/None/Some seam for the admission-retention rule: a
    // real `try_wait` `Err` is not reliably producible on demand, so the
    // decision table is pinned here against synthetic poll values. Only
    // `Ok(Some(_))` — a proven exit — may ever release admission capacity;
    // a poll error is quarantined uncertainty, never proof of completion.
    // The `Ok(Some(_))` value below carries a REAL `ExitStatus` (a
    // self-spawn child that exits immediately), so the seam is exercised
    // against a genuine OS exit status, not a fabricated one.
    let exited_status = std::process::Command::new(
        std::env::current_exe().expect("current_exe for a real ExitStatus"),
    )
    .args([
        "helper_sleep_ms",
        "--exact",
        "--nocapture",
        "--test-threads=1",
    ])
    .env("DROGON_TEST_SLEEP_MS", "0")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .expect("spawn a real immediately-exiting self-spawn child");
    assert!(
        exited_status.success(),
        "self-spawn fixture child must exit successfully"
    );

    assert_eq!(
        git_process::classify_child_poll(&Ok(Some(exited_status))),
        git_process::ChildPollReadiness::Exited,
        "a confirmed exit is the only poll outcome that proves the child is done"
    );
    assert_eq!(
        git_process::classify_child_poll(&Ok(None)),
        git_process::ChildPollReadiness::Running,
        "a still-running child must keep its admission permit held"
    );
    let poll_err: Result<Option<std::process::ExitStatus>, std::io::Error> =
        Err(std::io::Error::other("synthetic try_wait failure"));
    assert_eq!(
        git_process::classify_child_poll(&poll_err),
        git_process::ChildPollReadiness::Unverifiable,
        "a poll error must quarantine the permit, never free it as if done"
    );
}

#[test]
fn spawn_and_capture_bounded_repeated_calls_never_leak_admission_permits() {
    // Regression for "no cross-call bound": if admission were leaked (never
    // released) across calls, this loop would eventually start failing with
    // `runtime_busy` well before `MAX_CONCURRENT_PROBES` sequential
    // (non-overlapping) calls complete — real recovery, proven repeatedly,
    // not just once.
    for _ in 0..(git_process::MAX_CONCURRENT_PROBES * 2) {
        let exe = std::env::current_exe().expect("current_exe for self-spawn fixture");
        let mut cmd = std::process::Command::new(exe);
        cmd.args([
            "helper_sleep_ms",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ]);
        cmd.env("DROGON_TEST_SLEEP_MS", "1");
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Only the admission claim is asserted here, not the outcome shape:
        // under real scheduler load a self-spawned fixture can legitimately
        // land on `CaptureUnfinished`/`TimedOut` for reasons unrelated to
        // admission, and this test must not be sensitive to that. The one
        // thing that must never happen, repeatedly, is `runtime_busy` —
        // which is exactly what a leaked-forever admission slot would cause
        // well before `MAX_CONCURRENT_PROBES * 2` sequential calls complete.
        match git_process::spawn_and_capture_bounded(cmd, &generous_budget()) {
            Ok(_) => {}
            Err(e) => panic!(
                "a sequential call must never be rejected by a leaked-forever admission bound, \
                 got: {e:?}"
            ),
        }
    }
}
