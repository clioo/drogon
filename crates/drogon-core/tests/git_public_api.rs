//! Behavioral tests for the Git read-only surface exercised purely through
//! `drogon-core`'s PUBLIC API (`drogon_core::git`/`git_worktree`/
//! `git_process`), now that `crates/drogon-core/src/lib.rs` wires all three
//! modules in as `pub mod`. Unlike `tests/git_baseline.rs`/`git_process.rs`/
//! `git_process_bounds.rs`/`git_worktree.rs` (which predate that wiring and
//! keep their own `#[path]` inclusion of the source files directly), this
//! file uses ONLY `use drogon_core::...` imports — no `#[path]` mod at all.
//!
//! Fixtures are OWNED, self-cleaning temporary directories created by this
//! file's own helpers below. Real `git init`/`git worktree add` is only ever
//! run inside those owned temp directories, never against the project
//! checkout, and no test here mutates `PATH` or any other process-global
//! state.

use std::path::PathBuf;

use drogon_core::git::{Capability, CapabilityCache, HostScope, StatusEntry};
use drogon_core::git_process::{
    GitProbeBudget, ParsedGitOutput, ReadOnlyGitOperation, run_read_only_git,
    run_read_only_git_with_bin,
};
use drogon_core::git_worktree::WorktreeEntry;

const GENEROUS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const GENEROUS_CAP: usize = 16 * 1024 * 1024;

fn generous_budget() -> GitProbeBudget {
    GitProbeBudget {
        timeout: GENEROUS_TIMEOUT,
        max_combined_output_bytes: GENEROUS_CAP,
    }
}

// --- owned fixture helpers ---------------------------------------------------

fn unique_dir(tag: &str) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "drogon_git_public_api_{tag}_{}_{}_{unique}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

/// An owned, self-cleaning real git repository used as this file's fixture.
/// Never the project checkout — always a throwaway temp directory.
struct TempRepo {
    dir: PathBuf,
}

impl TempRepo {
    fn init(tag: &str) -> Self {
        let dir = unique_dir(tag);
        std::fs::create_dir_all(&dir).expect("create temp repo dir");
        let repo = TempRepo { dir };
        repo.git(&["init", "-q"]);
        repo.git(&["config", "user.email", "fixture@example.com"]);
        repo.git(&["config", "user.name", "fixture"]);
        repo
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

/// A plain, non-git-initialized owned temp directory: used to produce a
/// real, deterministic "not a git repository" failure from real Git, without
/// faking any process or stderr text.
fn plain_dir(tag: &str) -> PathBuf {
    let dir = unique_dir(tag);
    std::fs::create_dir_all(&dir).expect("create plain temp dir");
    dir
}

fn remove_dir(dir: &std::path::Path) {
    let _ = std::fs::remove_dir_all(dir);
}

// --- (a) native Status: clean then dirty ------------------------------------

#[test]
fn native_status_on_a_clean_real_repo_reports_no_entries() {
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
fn native_status_on_a_dirty_real_repo_reports_the_untracked_entry() {
    let repo = TempRepo::init("status-dirty");
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
    .expect("status on a dirty repo should succeed");

    match result {
        ParsedGitOutput::Status(parsed) => {
            assert_eq!(parsed.entries.len(), 1);
            match &parsed.entries[0] {
                StatusEntry::Untracked { path } => assert_eq!(path, "untracked.txt"),
                other => panic!("expected untracked entry, got {other:?}"),
            }
        }
        other => panic!("expected Status output, got {other:?}"),
    }
}

// --- (b) native WorktreeList, including a linked worktree -------------------

#[test]
fn native_worktree_list_reports_the_main_and_a_linked_worktree() {
    let repo = TempRepo::init("worktree-list");
    repo.write_file("committed.txt");
    repo.git(&["add", "committed.txt"]);
    repo.git(&["commit", "-q", "-m", "init"]);

    let linked_dir = unique_dir("worktree-list-linked");
    // Real `git worktree add`, run only against this test's OWNED fixture
    // repo — never against the project checkout.
    repo.git(&[
        "worktree",
        "add",
        "-b",
        "public-api-linked-branch",
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
            assert!(entries.iter().any(|e: &WorktreeEntry| e.branch.as_deref()
                == Some("refs/heads/public-api-linked-branch")));
        }
        other => panic!("expected WorktreeList output, got {other:?}"),
    }

    remove_dir(&linked_dir);
}

// --- (c) timeout via the _with_bin seam maps to unverifiable ----------------

/// Resolves the real `git` binary from this process's own (unmodified) PATH.
/// Read-only lookup — never mutates `PATH`.
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
#[cfg(unix)]
fn timeout_via_the_with_bin_seam_maps_to_unverifiable() {
    let repo = TempRepo::init("status-timeout");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    let real_git = resolve_real_git_binary();
    let wrapper_dir = plain_dir("git-sleep-wrapper");
    let wrapper_path = wrapper_dir.join("git-sleep-wrapper");
    std::fs::write(
        &wrapper_path,
        format!(
            "#!/bin/sh\nsleep 5\nexec \"{}\" \"$@\"\n",
            real_git.display()
        ),
    )
    .expect("write slow git wrapper script");
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&wrapper_path, std::fs::Permissions::from_mode(0o755))
            .expect("make git wrapper executable");
    }

    let budget = GitProbeBudget {
        timeout: std::time::Duration::from_millis(100),
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

    remove_dir(&wrapper_dir);

    let err = result.expect_err("a 100ms budget must time out when git sleeps 5s");
    assert_eq!(err.code, "unverifiable");
}

// --- (d) a tiny combined-byte-cap maps to io_error --------------------------

#[test]
fn a_tiny_combined_byte_cap_on_a_real_repo_maps_to_io_error() {
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

// --- (e) folder-not-repo maps to io_error -----------------------------------

#[test]
fn status_on_a_non_git_folder_maps_to_io_error() {
    let dir = plain_dir("status-not-a-repo");
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
    remove_dir(&dir);
}

#[test]
fn worktree_list_on_a_non_git_folder_maps_to_io_error() {
    let dir = plain_dir("worktree-not-a-repo");
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
    remove_dir(&dir);
}

// --- (f) cache fallback: a recorded rejection still lets WorktreeList
//     succeed via the fallback command, and record_success clears it --------

#[test]
fn worktree_list_succeeds_via_fallback_after_a_recorded_rejection_and_record_success_clears_it() {
    let repo = TempRepo::init("cache-fallback");
    let cache = CapabilityCache::new();
    let scope = HostScope::native();

    cache.record_rejection(&scope, Capability::WorktreeListZ);
    assert!(cache.is_rejected(&scope, Capability::WorktreeListZ));

    let result = run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        &repo.dir,
        &scope,
        &cache,
        generous_budget(),
    )
    .expect("worktree list must still succeed via the fallback command after a recorded rejection");
    match result {
        ParsedGitOutput::WorktreeList(entries) => {
            assert_eq!(
                entries.len(),
                1,
                "a repo with no linked worktrees has exactly one entry"
            );
        }
        other => panic!("expected WorktreeList output, got {other:?}"),
    }
    // The real call never attempted (so never disproved) the preferred
    // form, so the pre-seeded rejection must survive exactly as recorded.
    assert!(cache.is_rejected(&scope, Capability::WorktreeListZ));

    cache.record_success(&scope, Capability::WorktreeListZ);
    assert!(!cache.is_rejected(&scope, Capability::WorktreeListZ));
}

// --- (g) remote scopes (Wsl/Ssh/Relay) on both public entries are refused
//     with unsupported_host, and never reach a spawn ------------------------

fn remote_scopes() -> [HostScope; 3] {
    [
        HostScope::wsl("Ubuntu-22.04"),
        HostScope::ssh("github"),
        HostScope::relay("relay-42"),
    ]
}

#[test]
fn remote_scopes_are_refused_with_unsupported_host_on_the_plain_entry() {
    // A real temp repo where an UNGUARDED call would succeed, proving the
    // rejection is the remote-scope guard and not merely "no such repo".
    let repo = TempRepo::init("remote-scope-plain-entry");
    let cache = CapabilityCache::new();

    for scope in remote_scopes() {
        for operation in [
            ReadOnlyGitOperation::Status,
            ReadOnlyGitOperation::WorktreeList,
        ] {
            let err = run_read_only_git(operation, &repo.dir, &scope, &cache, generous_budget())
                .expect_err(
                    "a remote scope must be refused before any local git spawn on the plain entry",
                );
            assert_eq!(err.code, "unsupported_host");
        }
    }
}

#[test]
#[cfg(unix)]
fn remote_scopes_via_with_bin_never_spawn_the_provided_binary() {
    // A real temp repo where an UNGUARDED call would succeed.
    let repo = TempRepo::init("remote-scope-with-bin-entry");
    let cache = CapabilityCache::new();

    let script_dir = plain_dir("remote-scope-sentinel-script");
    let sentinel_path = script_dir.join("sentinel");
    let script_path = script_dir.join("touch-sentinel.sh");
    std::fs::write(
        &script_path,
        format!("#!/bin/sh\ntouch \"{}\"\n", sentinel_path.display()),
    )
    .expect("write sentinel-touching script");
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
            .expect("make sentinel script executable");
    }

    for scope in remote_scopes() {
        for operation in [
            ReadOnlyGitOperation::Status,
            ReadOnlyGitOperation::WorktreeList,
        ] {
            let err = run_read_only_git_with_bin(
                operation,
                &repo.dir,
                &scope,
                &cache,
                generous_budget(),
                &script_path,
            )
            .expect_err("a remote scope must be refused before any spawn on the _with_bin entry");
            assert_eq!(err.code, "unsupported_host");
        }
    }

    assert!(
        !sentinel_path.exists(),
        "the remote-scope guard must prevent the provided binary from ever being spawned"
    );

    remove_dir(&script_dir);
}
