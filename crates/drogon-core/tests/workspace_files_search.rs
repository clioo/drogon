//! Behavioral tests for the bounded workspace file search behind the
//! additive `files.search` RPC. Compiles `src/workspace_files.rs` directly
//! (like `workspace_files_explorer.rs`) and drives the real `search_files`
//! against temp dirs: a temp git repo for the `.gitignore`-honoring path
//! and a plain dir for the ignore-list walk.

// Most of error.rs's constructors are unused by this test crate but ARE
// used by the real drogon-core lib build; don't let clippy flag them dead.
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
// Only `search_files` is exercised here; the explorer primitives sharing
// this standalone-compiled module are covered by
// `workspace_files_explorer.rs`.
#[allow(dead_code)]
#[path = "../src/workspace_files.rs"]
mod workspace_files;

use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::tempdir;
use workspace_files::search_files;

fn git(args: &[&str], dir: &Path) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .status()
        .expect("git binary must be available for files.search tests");
    assert!(status.success(), "git {args:?} failed in test repo");
}

fn write(dir: &Path, rel: &str, content: &str) {
    let path = dir.join(rel);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn make_git_repo() -> tempfile::TempDir {
    let root = tempdir().unwrap();
    git(&["init", "-q"], root.path());
    write(root.path(), "src/app.ts", "export const a = 1;\n");
    write(root.path(), "src/ignored.tmp", "tmp\n");
    write(root.path(), ".gitignore", "*.tmp\ndist/\n");
    write(root.path(), "README.md", "# test\n");
    // Untracked but not ignored: surfaces via --others.
    write(root.path(), "notes/todo.txt", "todo\n");
    // Ignored: excluded via --exclude-standard in both passes.
    write(root.path(), "dist/bundle.js", "js\n");
    write(root.path(), "src/ignored2.tmp", "tmp\n");
    git(&["add", "-A"], root.path());
    root
}

fn search_sorted(root: &Path, query: &str, limit: usize) -> Vec<String> {
    let mut files = search_files(root, query, limit).unwrap().files;
    files.sort();
    files
}

// --- git repo: .gitignore honored ----------------------------------------

#[test]
fn search_in_git_repo_excludes_ignored_files() {
    let root = make_git_repo();
    let files = search_sorted(root.path(), "", 500);
    assert!(files.contains(&"src/app.ts".to_string()), "{files:?}");
    assert!(files.contains(&"README.md".to_string()), "{files:?}");
    assert!(files.contains(&"notes/todo.txt".to_string()), "{files:?}");
    assert!(
        !files.iter().any(|f| f.ends_with(".tmp")),
        "gitignored files must be excluded: {files:?}"
    );
    assert!(
        !files.iter().any(|f| f.starts_with("dist/")),
        "gitignored dirs must be excluded: {files:?}"
    );
    assert!(
        !files.iter().any(|f| f.starts_with(".git/")),
        ".git internals must never surface: {files:?}"
    );
}

#[test]
fn search_in_git_repo_matches_case_insensitive_subsequence() {
    let root = make_git_repo();
    let files = search_sorted(root.path(), "SAT", 500);
    assert!(files.contains(&"src/app.ts".to_string()), "{files:?}");
    assert!(!files.contains(&"README.md".to_string()), "{files:?}");
}

// --- plain walk: source ignore list ---------------------------------------

#[test]
fn search_plain_walk_applies_ignore_list_but_keeps_dotfiles() {
    let root = tempdir().unwrap();
    write(root.path(), "src/ok.ts", "x\n");
    write(root.path(), "node_modules/dep/index.js", "x\n");
    write(root.path(), ".cache/blob.bin", "x\n");
    write(root.path(), ".config/settings.json", "{}\n");
    let files = search_sorted(root.path(), "", 500);
    assert!(files.contains(&"src/ok.ts".to_string()), "{files:?}");
    assert!(
        files.contains(&".config/settings.json".to_string()),
        "hand-edited dotdirs stay discoverable: {files:?}"
    );
    assert!(
        !files.iter().any(|f| f.starts_with("node_modules/")),
        "{files:?}"
    );
    assert!(!files.iter().any(|f| f.starts_with(".cache/")), "{files:?}");
}

// --- bounds -----------------------------------------------------------------

#[test]
fn search_results_are_bounded_and_report_truncation() {
    let root = tempdir().unwrap();
    for i in 0..5 {
        write(root.path(), &format!("file-{i}.txt"), "x\n");
    }
    let full = search_files(root.path(), "", 500).unwrap();
    assert_eq!(full.files.len(), 5);
    assert!(!full.truncated);
    let capped = search_files(root.path(), "", 2).unwrap();
    assert_eq!(capped.files.len(), 2);
    assert!(
        capped.truncated,
        "a capped result set must report truncation"
    );
}

#[test]
fn search_empty_query_returns_walk_order_and_rejects_bad_input() {
    let root = tempdir().unwrap();
    write(root.path(), "b.txt", "x\n");
    write(root.path(), "a.txt", "x\n");
    let listing = search_files(root.path(), "   ", 500).unwrap();
    assert_eq!(
        listing.files,
        vec!["a.txt".to_string(), "b.txt".to_string()]
    );
    assert_eq!(
        search_files(root.path(), "a", 0).unwrap_err().code,
        "invalid_argument"
    );
    assert!(
        search_files(root.path(), "bad\0query", 10)
            .unwrap_err()
            .code
            == "invalid_argument"
    );
    let missing = root.path().join("does-not-exist");
    assert_eq!(
        search_files(&missing, "", 10).unwrap_err().code,
        "invalid_argument"
    );
}
