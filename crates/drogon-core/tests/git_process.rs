//! Behavioral tests for the bounded read-only Git process wrapper
//! (`src/git_process.rs`): real-binary happy paths, timeout/kill, combined
//! byte-cap enforcement, nonzero-exit mapping, the narrow unsupported-`-z`
//! fallback predicate and its `CapabilityCache` decision, `ProbeGuard`
//! release on a real caller error, and env/argv determinism. Compiles
//! `src/error.rs`, `src/git.rs`, `src/git_worktree.rs` and
//! `src/git_process.rs` directly via `#[path]` (no `lib.rs` change needed;
//! none of these modules are wired into the RPC surface yet), the same
//! trick `tests/git_baseline.rs` already uses for `src/git.rs`.
//!
//! Fixtures are OWNED temporary directories created by this file's own
//! `TempRepo`/`plain_temp_dir` helpers, never the project checkout itself —
//! `git worktree add`/`git init` are only ever run inside those owned temp
//! directories.

// Most of error.rs's/git.rs's/git_worktree.rs's own surface (other
// capabilities, the WSL/relay host-scope constructors, the inert probe-plan
// tables, the worktree-add path/branch validators, etc.) is exercised by
// `tests/git_baseline.rs`, not by this file — this file only needs the
// `Status`/`WorktreeList`-relevant subset. Mirrors `git_baseline.rs`'s own
// `#[allow(dead_code)]` treatment of its `mod error`/`mod git_worktree`
// inclusions, extended here to `mod git` too since this file's usage of it
// is narrower still.
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[allow(dead_code)]
#[path = "../src/git.rs"]
mod git;
#[allow(dead_code)]
#[path = "../src/git_process.rs"]
mod git_process;
#[allow(dead_code)]
#[path = "../src/git_worktree.rs"]
mod git_worktree;

use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use git::{Capability, CapabilityCache, HostScope, ProbeOutcome};
use git_process::{
    GitProbeBudget, ParsedGitOutput, ReadOnlyGitOperation, run_read_only_git,
    run_read_only_git_with_bin,
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

struct TempRepo {
    dir: PathBuf,
}

impl TempRepo {
    fn init(tag: &str) -> Self {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "drogon_git_process_fixture_{tag}_{}_{}_{unique}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create temp repo dir");
        let repo = TempRepo { dir };
        repo.git(&["init", "-q"]);
        repo.git(&["config", "user.email", "fixture@example.com"]);
        repo.git(&["config", "user.name", "fixture"]);
        repo
    }

    /// A plain, non-git-initialized owned temp directory: used to produce a
    /// real, deterministic "not a git repository" failure from real Git,
    /// without faking any process or stderr text.
    fn plain_dir(tag: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "drogon_git_process_plain_{tag}_{}_{}_{unique}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create plain temp dir");
        dir
    }

    fn git(&self, args: &[&str]) -> std::process::Output {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(&self.dir)
            .output()
            .expect("spawn real git binary for fixture generation");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    fn write_file(&self, name: &str) {
        std::fs::write(self.dir.join(name), b"fixture\n").expect("write fixture file");
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn remove_plain_dir(dir: &std::path::Path) {
    let _ = std::fs::remove_dir_all(dir);
}

// --- (happy path) status -----------------------------------------------------

#[test]
fn status_happy_path_on_clean_real_repo() {
    let repo = TempRepo::init("status-clean");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let result = run_read_only_git(
        ReadOnlyGitOperation::Status,
        &repo.dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect("status on a clean repo should succeed");

    match result {
        ParsedGitOutput::Status(parsed) => assert!(parsed.entries.is_empty()),
        other => panic!("expected Status output, got {other:?}"),
    }
}

#[test]
fn status_happy_path_reports_untracked_file() {
    let repo = TempRepo::init("status-untracked");
    repo.write_file("untracked.txt");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let result = run_read_only_git(
        ReadOnlyGitOperation::Status,
        &repo.dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect("status should succeed");

    match result {
        ParsedGitOutput::Status(parsed) => {
            assert_eq!(parsed.entries.len(), 1);
            match &parsed.entries[0] {
                git::StatusEntry::Untracked { path } => assert_eq!(path, "untracked.txt"),
                other => panic!("expected untracked entry, got {other:?}"),
            }
        }
        other => panic!("expected Status output, got {other:?}"),
    }
}

// --- (happy path) worktree list ----------------------------------------------

#[test]
fn worktree_list_happy_path_on_real_repo_with_linked_worktree() {
    let repo = TempRepo::init("worktree-list");
    repo.write_file("committed.txt");
    repo.git(&["add", "committed.txt"]);
    repo.git(&["commit", "-q", "-m", "init"]);

    let linked_dir = std::env::temp_dir().join(format!(
        "drogon_git_process_linked_worktree_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    // Real `git worktree add`, run only against this test's OWNED fixture
    // repo — never against the project checkout.
    repo.git(&[
        "worktree",
        "add",
        "-b",
        "linked-branch",
        linked_dir.to_str().unwrap(),
    ]);

    let cache = CapabilityCache::new();
    let scope = HostScope::native();
    let result = run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        &repo.dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect("worktree list should succeed");

    match result {
        ParsedGitOutput::WorktreeList(entries) => {
            assert_eq!(
                entries.len(),
                2,
                "expected main + linked worktree: {entries:?}"
            );
            assert!(
                entries
                    .iter()
                    .any(|e| e.branch.as_deref() == Some("refs/heads/linked-branch"))
            );
        }
        other => panic!("expected WorktreeList output, got {other:?}"),
    }

    // Preferred `-z` form succeeded against this host's real (modern) Git,
    // so no rejection should have been recorded.
    assert!(!cache.is_rejected(&scope, Capability::WorktreeListZ));

    let _ = std::fs::remove_dir_all(&linked_dir);
}

// --- nonzero-exit mapping (real, deterministic Git failure) -----------------

#[test]
fn status_on_a_non_git_directory_maps_to_io_error() {
    let dir = TempRepo::plain_dir("status-not-a-repo");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let err = run_read_only_git(
        ReadOnlyGitOperation::Status,
        &dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect_err("status outside any git repo must fail");

    assert_eq!(err.code, "io_error");
    remove_plain_dir(&dir);
}

#[test]
fn worktree_list_on_a_non_git_directory_maps_to_io_error() {
    let dir = TempRepo::plain_dir("worktree-not-a-repo");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let err = run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        &dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect_err("worktree list outside any git repo must fail");

    assert_eq!(err.code, "io_error");
    remove_plain_dir(&dir);
}

// --- ProbeGuard release on a real caller error ------------------------------

#[test]
fn worktree_list_probe_guard_releases_on_a_real_git_error() {
    // Mirrors `tests/git_baseline.rs`'s
    // `probe_guard_finishes_the_probe_even_when_a_fallible_call_bails_out_early`,
    // applied to this wrapper's real call site (a genuine, deterministic
    // "not a git repository" failure) instead of a simulated one.
    let dir = TempRepo::plain_dir("worktree-guard-release");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let err = run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        &dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect_err("worktree list outside any git repo must fail");
    assert_eq!(err.code, "io_error");

    // If the guard's Drop had not run on that early return, this would
    // observe Follower instead of Leader.
    assert_eq!(
        cache.begin_probe(&scope, Capability::WorktreeListZ),
        ProbeOutcome::Leader
    );

    remove_plain_dir(&dir);
}

// --- narrow-predicate fallback caching ---------------------------------------

#[test]
fn unsupported_z_predicate_matches_the_expected_unknown_switch_shapes() {
    assert!(git_process::is_worktree_list_z_unsupported(
        "error: unknown switch `z'"
    ));
    assert!(git_process::is_worktree_list_z_unsupported(
        "error: unknown option `z'"
    ));
    // Fancy-quote variant some Git builds use.
    assert!(git_process::is_worktree_list_z_unsupported(
        "error: unknown switch \u{2018}z\u{2019}"
    ));
}

#[test]
fn unsupported_z_predicate_does_not_match_the_live_verified_requires_porcelain_error() {
    // This exact string is real Git's live-verified response to a bare `-z`
    // (see `git-capability-baseline.md`/`git-worktree-safety.md`); it must
    // NEVER trigger a fallback, since the preferred command here always
    // carries `--porcelain` already.
    assert!(!git_process::is_worktree_list_z_unsupported(
        "fatal: the option '-z' requires '--porcelain'"
    ));
}

#[test]
fn unsupported_z_predicate_does_not_match_unrelated_errors_that_merely_mention_z() {
    assert!(!git_process::is_worktree_list_z_unsupported(
        "fatal: not a git repository (or any of the parent directories): .git"
    ));
    assert!(!git_process::is_worktree_list_z_unsupported(
        "fatal: -z flag looks fine but this is a permission error"
    ));
}

#[test]
fn should_try_preferred_worktree_list_is_true_for_a_fresh_cache() {
    let cache = CapabilityCache::new();
    let scope = HostScope::native();
    assert!(git_process::should_try_preferred_worktree_list(
        &scope, &cache
    ));
}

#[test]
fn should_try_preferred_worktree_list_is_false_immediately_after_a_recorded_rejection() {
    let cache = CapabilityCache::new();
    let scope = HostScope::native();
    cache.record_rejection(&scope, Capability::WorktreeListZ);
    assert!(!git_process::should_try_preferred_worktree_list(
        &scope, &cache
    ));
}

#[test]
fn should_try_preferred_worktree_list_rejection_is_scoped_per_host() {
    let cache = CapabilityCache::new();
    let rejected_scope = HostScope::ssh("github");
    let other_scope = HostScope::native();
    cache.record_rejection(&rejected_scope, Capability::WorktreeListZ);

    assert!(!git_process::should_try_preferred_worktree_list(
        &rejected_scope,
        &cache
    ));
    assert!(git_process::should_try_preferred_worktree_list(
        &other_scope,
        &cache
    ));
}

// --- env/argv determinism ----------------------------------------------------

fn contains_window(argv: &[String], window: &[&str]) -> bool {
    argv.windows(window.len())
        .any(|w| w.iter().map(String::as_str).eq(window.iter().copied()))
}

#[test]
fn global_args_disable_the_pager_and_pin_quote_path_and_color() {
    let status = git_process::status_argv();
    assert!(status.contains(&"--no-pager".to_string()));
    assert!(contains_window(&status, &["-c", "core.quotePath=true"]));
    assert!(contains_window(&status, &["-c", "color.ui=never"]));
    assert!(contains_window(&status, &["-c", "core.fsmonitor=false"]));

    let preferred = git_process::worktree_list_preferred_argv();
    assert!(preferred.contains(&"--no-pager".to_string()));
    assert!(contains_window(
        &preferred,
        &["worktree", "list", "--porcelain", "-z"]
    ));

    let fallback = git_process::worktree_list_fallback_argv();
    assert!(fallback.contains(&"--no-pager".to_string()));
    assert!(contains_window(
        &fallback,
        &["worktree", "list", "--porcelain"]
    ));
    assert!(!fallback.contains(&"-z".to_string()));
}

#[test]
fn build_git_command_carries_the_bounded_env_via_commands_own_introspection() {
    // `std::process::Command::get_args`/`get_envs` (stable since 1.57) are
    // the only portable, "where observable" way to assert on a built
    // `Command`'s configured argv/env without actually spawning it or
    // parsing OS-specific process-table output.
    let argv = git_process::status_argv();
    let cmd = git_process::build_git_command(std::path::Path::new("."), &argv);

    let args: Vec<String> = cmd
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    assert_eq!(args, argv);

    let envs: std::collections::HashMap<String, Option<String>> = cmd
        .get_envs()
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                v.map(|v| v.to_string_lossy().into_owned()),
            )
        })
        .collect();
    for (key, value) in git_process::BOUNDED_ENV {
        assert_eq!(
            envs.get(*key).and_then(|v| v.as_deref()),
            Some(*value),
            "expected {key}={value} in the built command's env"
        );
    }
}

// --- timeout: prove no hang + a real kill/reap ------------------------------

#[test]
fn kill_and_reap_reaps_a_real_long_running_child_without_hanging() {
    // Isolated from Git specifics per the proposal's own test design note:
    // a trivial long-sleeping child, spawned directly, not through any
    // git_process argv builder.
    let mut child = std::process::Command::new("sleep")
        .arg("5")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn a real long-running `sleep` child (expects `sleep` on PATH)");

    let start = Instant::now();
    git_process::kill_and_reap(&mut child);
    let elapsed = start.elapsed();

    assert!(
        elapsed < Duration::from_secs(2),
        "kill_and_reap should reap promptly, took {elapsed:?}"
    );
    assert!(
        matches!(child.try_wait(), Ok(Some(_))),
        "child must be reaped (no zombie) after kill_and_reap"
    );
}

#[test]
fn spawn_and_capture_bounded_kills_a_real_slow_child_on_timeout() {
    let cmd_builder = || {
        let mut cmd = std::process::Command::new("sleep");
        cmd.arg("5")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        cmd
    };
    let budget = GitProbeBudget {
        timeout: Duration::from_millis(150),
        max_combined_output_bytes: GENEROUS_CAP,
    };

    let start = Instant::now();
    let outcome = git_process::spawn_and_capture_bounded(cmd_builder(), &budget)
        .expect("bounded capture should not itself error on a timeout");
    let elapsed = start.elapsed();

    assert!(
        matches!(outcome, git_process::SpawnOutcome::TimedOut),
        "expected TimedOut, got {outcome:?}"
    );
    // Upper-bounds the poll loop's own overhead: well under the 5s the child
    // would otherwise have run for, proving it was actually killed rather
    // than waited out.
    assert!(
        elapsed < Duration::from_secs(2),
        "expected a prompt kill well under the child's own 5s sleep, took {elapsed:?}"
    );
}

/// Resolves the real `git` binary from this process's own (unmodified) PATH.
/// Read-only lookup — never mutates `PATH`, so it is safe to call
/// concurrently with any other test in this binary.
fn resolve_real_git_binary() -> PathBuf {
    let path = std::env::var("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .map(|dir| dir.join("git"))
        .find(|candidate| {
            if !candidate.is_file() {
                return false;
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                candidate
                    .metadata()
                    .map(|m| m.permissions().mode() & 0o111 != 0)
                    .unwrap_or(false)
            }
            #[cfg(not(unix))]
            {
                true
            }
        })
        .expect("resolve the real git binary from PATH")
}

#[test]
fn run_read_only_git_maps_a_real_timeout_to_unverifiable() {
    let repo = TempRepo::init("status-timeout");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();
    // Create a wrapper script that takes far longer than the timeout budget,
    // and point `run_read_only_git_with_bin` directly at it. This is fully
    // process-isolated: no `std::env::set_var`/`remove_var` on `PATH` (or
    // anything else process-global), so it cannot race against any other
    // test running concurrently in this binary. It is also deterministic (no
    // race between spawn and first poll): the wrapper will definitely still
    // be running when polling begins, and will outlast the 100ms budget.
    // Chaining `exec <real-git>` after the sleep keeps the wrapper
    // semantically transparent (a real `git status`, just slow), though
    // since nothing else can observe this process's `git_bin` choice, the
    // exec is now purely a "prove it's really git underneath" nicety rather
    // than load-bearing for other tests' correctness.
    let real_git = resolve_real_git_binary();
    let wrapper_dir = TempRepo::plain_dir("git-sleep-wrapper");
    let wrapper_path = wrapper_dir.join("git-sleep-wrapper");
    std::fs::write(
        &wrapper_path,
        format!(
            "#!/bin/sh\nsleep 5\nexec \"{}\" \"$@\"\n",
            real_git.display()
        ),
    )
    .expect("write git wrapper script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&wrapper_path, std::fs::Permissions::from_mode(0o755))
            .expect("make git wrapper executable");
    }

    let budget = GitProbeBudget {
        timeout: Duration::from_millis(100),
        max_combined_output_bytes: GENEROUS_CAP,
    };

    let result = run_read_only_git_with_bin(
        ReadOnlyGitOperation::Status,
        &repo.dir,
        &scope,
        &cache,
        budget,
        &wrapper_path,
    );

    remove_plain_dir(&wrapper_dir);

    let err = result.expect_err("a 100ms budget must time out when git sleeps 5s");
    assert_eq!(err.code, "unverifiable");
}

// --- combined byte-cap enforcement (in-process, no subprocess needed) ------

/// Yields an unbounded stream of `'x'` bytes. Lets the byte-cap test drive
/// `spawn_stream_reader` (the REAL internal reader used by both Git
/// operations) directly and deterministically, without depending on any
/// external command's output rate or the OS pipe buffer size.
struct InfiniteReader;

impl Read for InfiniteReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        for byte in buf.iter_mut() {
            *byte = b'x';
        }
        Ok(buf.len())
    }
}

#[test]
fn spawn_stream_reader_stops_within_one_chunk_past_the_combined_cap() {
    let combined_len = Arc::new(AtomicUsize::new(0));
    let cap_hit = Arc::new(AtomicBool::new(false));
    let cap: usize = 10_000;

    let stream = git_process::spawn_stream_reader(
        InfiniteReader,
        Arc::clone(&combined_len),
        cap,
        Arc::clone(&cap_hit),
    );

    let deadline = Instant::now() + Duration::from_secs(5);
    while !cap_hit.load(Ordering::SeqCst) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(
        cap_hit.load(Ordering::SeqCst),
        "cap should have tripped within 5s"
    );

    let deadline = Instant::now() + Duration::from_secs(5);
    while !stream.finished.load(Ordering::SeqCst) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(
        stream.finished.load(Ordering::SeqCst),
        "reader thread should stop after tripping the cap"
    );

    let len = stream.buf.lock().unwrap().len();
    assert!(
        len > cap,
        "buffer should have grown past the cap before stopping: {len}"
    );
    // Bounded overshoot: the reader can overshoot by at most one chunk, so
    // it must never grow anywhere near unboundedly past the configured cap.
    assert!(
        len < cap * 10,
        "buffer grew far past the cap, byte-cap enforcement is not bounding growth: {len}"
    );
}

#[test]
fn run_read_only_git_maps_a_real_byte_cap_trip_to_io_error() {
    // A real repo whose `status -z` output is forced past a tiny cap by
    // writing many distinctly-named untracked files.
    let repo = TempRepo::init("status-bytecap");
    for i in 0..500 {
        repo.write_file(&format!(
            "untracked-file-number-{i}-with-a-long-name-to-inflate-output.txt"
        ));
    }
    let cache = CapabilityCache::new();
    let scope = HostScope::native();
    let budget = GitProbeBudget {
        timeout: GENEROUS_TIMEOUT,
        max_combined_output_bytes: 64,
    };

    let err = run_read_only_git(
        ReadOnlyGitOperation::Status,
        &repo.dir,
        &scope,
        &cache,
        budget,
    )
    .expect_err("a 64-byte cap must be exceeded by 500 untracked files");
    assert_eq!(err.code, "io_error");
}

// --- R16-AS: untracked expansion + untracked diffs ---------------------------

#[test]
fn status_argv_expands_untracked_directories_like_the_fork() {
    let argv = git_process::status_argv();
    assert!(
        argv.contains(&"--untracked-files=all".to_string()),
        "status argv must expand untracked directories to individual files \
         (fork parity: src/main/git/source-control/status-read.ts passes \
         --untracked-files=all): {argv:?}"
    );
}

#[test]
fn status_expands_an_untracked_directory_into_its_files() {
    let repo = TempRepo::init("status-untracked-dir");
    std::fs::create_dir_all(repo.dir.join("docs")).expect("create untracked dir");
    std::fs::write(repo.dir.join("docs/readme.md"), b"doc\n").expect("write file");
    std::fs::write(repo.dir.join("docs/guide.md"), b"guide\n").expect("write file");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let result = run_read_only_git(
        ReadOnlyGitOperation::Status,
        &repo.dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect("status should succeed");

    match result {
        ParsedGitOutput::Status(parsed) => {
            let mut paths: Vec<String> = parsed
                .entries
                .iter()
                .map(|entry| match entry {
                    git::StatusEntry::Untracked { path } => path.clone(),
                    other => panic!("expected untracked entry, got {other:?}"),
                })
                .collect();
            paths.sort();
            assert_eq!(
                paths,
                vec!["docs/guide.md".to_string(), "docs/readme.md".to_string()],
                "an untracked directory must list its files individually, never collapsed"
            );
        }
        other => panic!("expected Status output, got {other:?}"),
    }
}

#[test]
fn untracked_file_diff_is_an_all_added_diff_against_dev_null() {
    let repo = TempRepo::init("diff-untracked");
    std::fs::write(repo.dir.join("new.txt"), b"hello\nworld\n").expect("write untracked file");

    let diff = git_process::run_git_diff(&repo.dir, "new.txt", false, &generous_budget())
        .expect("untracked diff should succeed");

    assert!(
        diff.contains("--- /dev/null"),
        "left side of a new-file diff is /dev/null: {diff}"
    );
    assert!(
        diff.contains("+++ b/new.txt"),
        "right label must be repo-relative: {diff}"
    );
    assert!(
        diff.contains("+hello"),
        "content must appear as added lines: {diff}"
    );
    assert!(
        diff.contains("@@ -0,0 +1,2 @@"),
        "hunk must start at line 0/0: {diff}"
    );
}

#[test]
fn untracked_diff_is_not_used_for_tracked_files() {
    let repo = TempRepo::init("diff-tracked");
    repo.write_file("committed.txt");
    repo.git(&["add", "committed.txt"]);
    repo.git(&["commit", "-q", "-m", "init"]);

    // Clean tracked file: plain `git diff` is empty and the untracked
    // fallback must NOT fire (ls-files proves the path is tracked).
    let diff = git_process::run_git_diff(&repo.dir, "committed.txt", false, &generous_budget())
        .expect("tracked diff should succeed");
    assert!(diff.is_empty(), "clean tracked file has no diff: {diff}");
}

#[test]
fn untracked_subdirectory_file_diff_uses_repo_relative_labels() {
    let repo = TempRepo::init("diff-untracked-subdir");
    std::fs::create_dir_all(repo.dir.join("src")).expect("create dir");
    std::fs::write(repo.dir.join("src/index.ts"), b"export const x = 1;\n")
        .expect("write untracked file");

    let diff = git_process::run_git_diff(&repo.dir, "src/index.ts", false, &generous_budget())
        .expect("untracked diff should succeed");

    assert!(
        diff.contains("+++ b/src/index.ts"),
        "labels must stay repo-relative for nested paths: {diff}"
    );
    assert!(
        diff.contains("+export const x = 1;"),
        "added line missing: {diff}"
    );
}

#[test]
fn staged_untracked_lookup_is_not_a_no_index_diff() {
    // A staged NEW file is tracked in the index: `git diff --cached` shows
    // it against HEAD, and the untracked fallback must not fire either.
    let repo = TempRepo::init("diff-staged-new");
    repo.write_file("seed.txt");
    repo.git(&["add", "seed.txt"]);
    repo.git(&["commit", "-q", "-m", "init"]);
    std::fs::write(repo.dir.join("added.txt"), b"added\n").expect("write new file");
    repo.git(&["add", "added.txt"]);

    let staged = git_process::run_git_diff(&repo.dir, "added.txt", true, &generous_budget())
        .expect("staged diff should succeed");
    assert!(
        staged.contains("+added"),
        "staged new file diffs against HEAD: {staged}"
    );

    let unstaged = git_process::run_git_diff(&repo.dir, "added.txt", false, &generous_budget())
        .expect("unstaged diff should succeed");
    assert!(
        unstaged.is_empty(),
        "a fully staged new file has no unstaged diff: {unstaged}"
    );
}
