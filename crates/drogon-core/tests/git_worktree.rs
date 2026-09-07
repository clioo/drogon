//! Behavioral tests for the `git worktree list` parser (NUL-delimited `-z`
//! and legacy line-block porcelain forms) and the `worktree add` safety
//! validator. Compiles `src/git_worktree.rs` and `src/error.rs` directly via
//! `#[path]` (no `lib.rs` change needed; the module is not wired into the
//! RPC surface yet), the same trick `git_baseline.rs` uses, so error codes
//! stay exact with `docs/migration/protocol-v1.md`'s frozen set. Also
//! `#[path]`-includes `src/git.rs` for a single cross-check that this
//! module's string capability key has not drifted from the real
//! `Capability::WorktreeListZ` enum, without importing it in production
//! code (see `git_worktree.rs`'s module doc comment).

// Most of error.rs's constructors are unused by this test crate but ARE used
// by the real drogon-core lib build; don't let clippy flag them dead.
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[path = "../src/git_worktree.rs"]
mod git_worktree;
// git.rs pulls in the capability cache / status parser machinery this test
// crate does not otherwise exercise; only `Capability::WorktreeListZ.key()`
// is used below.
#[allow(dead_code)]
#[path = "../src/git.rs"]
mod git;

use git::Capability;
use git_worktree::{
    WorktreeEntry, parse_worktree_list_porcelain, validate_worktree_add, worktree_list_probe_plan,
};

// --- NUL-delimited (-z) parsing ---------------------------------------------

#[test]
fn parses_nul_delimited_entry_with_branch() {
    let input =
        "worktree /repo\0HEAD abcdef1234567890abcdef1234567890abcdef12\0branch refs/heads/main\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(
        entries,
        vec![WorktreeEntry {
            path: "/repo".to_string(),
            head: Some("abcdef1234567890abcdef1234567890abcdef12".to_string()),
            branch: Some("refs/heads/main".to_string()),
            bare: false,
            detached: false,
            locked: false,
            prunable: false,
        }]
    );
}

#[test]
fn parses_nul_delimited_detached_entry() {
    let input =
        "worktree /repo/detached\0HEAD 1111111111111111111111111111111111111111\0detached\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].detached);
    assert!(entries[0].branch.is_none());
}

#[test]
fn parses_nul_delimited_bare_entry() {
    let input = "worktree /repo/bare\0bare\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].bare);
}

#[test]
fn parses_nul_delimited_locked_entry_without_reason() {
    let input = "worktree /repo/locked\0HEAD 2222222222222222222222222222222222222222\0branch refs/heads/feature\0locked\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert!(entries[0].locked);
    assert!(!entries[0].prunable);
}

#[test]
fn parses_nul_delimited_locked_entry_with_reason() {
    let input = "worktree /repo/locked\0HEAD 2222222222222222222222222222222222222222\0locked manually locked for maintenance\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert!(entries[0].locked);
}

#[test]
fn parses_nul_delimited_prunable_entry_with_reason() {
    let input = "worktree /repo/gone\0HEAD 3333333333333333333333333333333333333333\0detached\0prunable gitdir file points to non-existent location\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert!(entries[0].prunable);
    assert!(entries[0].detached);
}

#[test]
fn parses_nul_delimited_path_with_spaces() {
    let input = "worktree /Users/carlos/My Worktrees/feature branch\0HEAD 4444444444444444444444444444444444444444\0branch refs/heads/main\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries[0].path, "/Users/carlos/My Worktrees/feature branch");
}

#[test]
fn parses_multiple_nul_delimited_entries_in_order() {
    let input = "worktree /repo\0HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0branch refs/heads/main\0\0worktree /repo/linked\0HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\0detached\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].path, "/repo");
    assert_eq!(entries[1].path, "/repo/linked");
    assert!(entries[1].detached);
}

#[test]
fn nul_delimited_path_starting_and_ending_with_literal_quote_is_kept_verbatim() {
    // Characterization test, not a "quoted path" test: verified live against
    // Git 2.50.1 that `worktree list --porcelain` (both -z and line-block
    // forms) never C-quotes the path field, even for paths containing a
    // literal `"`, control bytes, tabs, or non-ASCII bytes, and even with
    // `core.quotePath=true` forced. A path that happens to start and end
    // with a literal `"` character must therefore pass through raw, not be
    // mistaken for (and mangled by) C-quote unescaping.
    let input = "worktree /repo/\"quoted\"\0HEAD abcdef1234567890abcdef1234567890abcdef12\0branch refs/heads/main\0\0";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries[0].path, "/repo/\"quoted\"");
}

// --- legacy line-block parsing (pre-2.36 fallback) --------------------------

#[test]
fn parses_line_block_entry_with_branch() {
    let input =
        "worktree /repo\nHEAD abcdef1234567890abcdef1234567890abcdef12\nbranch refs/heads/main\n\n";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(
        entries,
        vec![WorktreeEntry {
            path: "/repo".to_string(),
            head: Some("abcdef1234567890abcdef1234567890abcdef12".to_string()),
            branch: Some("refs/heads/main".to_string()),
            bare: false,
            detached: false,
            locked: false,
            prunable: false,
        }]
    );
}

#[test]
fn parses_line_block_detached_and_bare_entries() {
    let input = "worktree /repo/detached\nHEAD 1111111111111111111111111111111111111111\ndetached\n\nworktree /repo/bare\nbare\n\n";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries[0].detached);
    assert!(entries[1].bare);
}

#[test]
fn parses_line_block_locked_and_prunable_annotations() {
    let input = "worktree /repo/locked\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/feature\nlocked manually locked\n\nworktree /repo/gone\nHEAD 3333333333333333333333333333333333333333\ndetached\nprunable gitdir file points to non-existent location\n\n";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries[0].locked);
    assert!(entries[1].prunable);
}

#[test]
fn parses_line_block_path_with_spaces() {
    let input = "worktree /Users/carlos/My Worktrees/feature branch\nHEAD 4444444444444444444444444444444444444444\nbranch refs/heads/main\n\n";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries[0].path, "/Users/carlos/My Worktrees/feature branch");
}

#[test]
fn empty_input_parses_to_empty_list_in_either_form() {
    assert!(parse_worktree_list_porcelain("").unwrap().is_empty());
}

#[test]
fn line_block_path_starting_and_ending_with_literal_quote_is_kept_verbatim() {
    let input = "worktree /repo/\"quoted\"\nHEAD abcdef1234567890abcdef1234567890abcdef12\nbranch refs/heads/main\n\n";
    let entries = parse_worktree_list_porcelain(input).unwrap();
    assert_eq!(entries[0].path, "/repo/\"quoted\"");
}

// --- malformed input rejection ----------------------------------------------

#[test]
fn rejects_nul_delimited_record_missing_worktree_line() {
    let err = parse_worktree_list_porcelain("HEAD abcdef1234567890abcdef1234567890abcdef12\0\0")
        .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_line_block_record_missing_worktree_line() {
    let err = parse_worktree_list_porcelain("HEAD abcdef1234567890abcdef1234567890abcdef12\n\n")
        .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_empty_worktree_path() {
    let err = parse_worktree_list_porcelain("worktree \0\0").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_unknown_record_line_nul_delimited() {
    let err = parse_worktree_list_porcelain("worktree /repo\0not-a-real-field\0\0").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_unknown_record_line_legacy() {
    let err = parse_worktree_list_porcelain("worktree /repo\nnot-a-real-field\n\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- validate_worktree_add: accept matrix -----------------------------------

#[test]
fn accepts_plain_relative_path_without_branch() {
    assert!(validate_worktree_add("/repo", "../sibling-not-actually", None).is_err());
    assert!(validate_worktree_add("/repo", "feature-x", None).is_ok());
}

#[test]
fn accepts_relative_path_with_spaces() {
    assert!(validate_worktree_add("/repo", "feature branch/sub dir", None).is_ok());
}

#[test]
fn accepts_valid_branch_name() {
    assert!(
        validate_worktree_add("/repo", "wt", Some("codex/vertical-03-workspaces-remote")).is_ok()
    );
}

#[test]
fn accepts_nested_relative_path_without_dotdot() {
    assert!(validate_worktree_add("/repo", "a/b/c", None).is_ok());
}

// --- validate_worktree_add: reject matrix -----------------------------------

#[test]
fn rejects_absolute_unix_path() {
    let err = validate_worktree_add("/repo", "/etc/passwd", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_windows_drive_absolute_path() {
    let err = validate_worktree_add("/repo", "C:\\wt", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_windows_drive_relative_path() {
    // "C:foo" (no separator after the colon) is syntactically a relative
    // path but resolves on Windows against the current directory of drive
    // C:, not against `root` — must be rejected the same as a drive-
    // absolute path.
    let err = validate_worktree_add("/repo", "C:foo", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_bare_windows_drive_relative_path() {
    let err = validate_worktree_add("/repo", "C:", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_traversal_segment() {
    let err = validate_worktree_add("/repo", "../escape", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_traversal_segment_nested() {
    let err = validate_worktree_add("/repo", "sub/../../escape", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_backslash_traversal_segment() {
    let err = validate_worktree_add("/repo", "sub\\..\\escape", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_nul_byte_in_path() {
    let err = validate_worktree_add("/repo", "wt\0evil", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_nul_byte_in_root() {
    let err = validate_worktree_add("/repo\0evil", "wt", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_empty_path() {
    let err = validate_worktree_add("/repo", "", None).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_space() {
    let err = validate_worktree_add("/repo", "wt", Some("feature x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_control_character() {
    let err = validate_worktree_add("/repo", "wt", Some("feature\tx")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_forbidden_glyphs() {
    for glyph in ["~", "^", ":", "?", "*", "["] {
        let branch = format!("feature{glyph}x");
        let err = validate_worktree_add("/repo", "wt", Some(&branch)).unwrap_err();
        assert_eq!(
            err.code, "invalid_argument",
            "glyph {glyph} should be rejected"
        );
    }
}

#[test]
fn rejects_branch_with_leading_dash() {
    let err = validate_worktree_add("/repo", "wt", Some("-x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_leading_slash() {
    let err = validate_worktree_add("/repo", "wt", Some("/x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_containing_dotdot() {
    let err = validate_worktree_add("/repo", "wt", Some("feature/../x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_lock_suffix() {
    let err = validate_worktree_add("/repo", "wt", Some("main.lock")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_empty_branch_name() {
    let err = validate_worktree_add("/repo", "wt", Some("")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_nul_byte() {
    let err = validate_worktree_add("/repo", "wt", Some("main\0x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- validate_worktree_add: newly-covered check-ref-format shapes ----------
// Each rejection here was verified live against this host's installed
// `git check-ref-format --allow-onelevel` (Git 2.50.1) before being added.

#[test]
fn rejects_branch_with_backslash() {
    let err = validate_worktree_add("/repo", "wt", Some("feature\\x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_containing_at_brace() {
    let err = validate_worktree_add("/repo", "wt", Some("feature@{x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_that_is_only_at_sign() {
    let err = validate_worktree_add("/repo", "wt", Some("@")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_ending_with_a_dot() {
    let err = validate_worktree_add("/repo", "wt", Some("feature.")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn accepts_branch_with_an_interior_dot_before_a_slash() {
    // Verified live: `foo./bar` is ACCEPTED by real Git — rule 6 (trailing
    // dot) applies to the whole refname, not to every '/'-separated
    // component (contrast with rule 1's `.`-prefix / `.lock`-suffix checks,
    // which ARE per-component; see the two rejection tests below).
    assert!(validate_worktree_add("/repo", "wt", Some("foo./bar")).is_ok());
}

#[test]
fn rejects_branch_with_a_component_starting_with_a_dot() {
    let err = validate_worktree_add("/repo", "wt", Some("feature/.hidden")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_a_non_final_component_ending_in_lock() {
    let err = validate_worktree_add("/repo", "wt", Some("sub.lock/feature")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_trailing_slash() {
    let err = validate_worktree_add("/repo", "wt", Some("feature/")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_branch_with_double_slash() {
    let err = validate_worktree_add("/repo", "wt", Some("feature//x")).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- worktree-list-z probe plan / capability key reuse ----------------------

#[test]
fn probe_plan_capability_key_matches_the_git_rs_enum() {
    let plan = worktree_list_probe_plan();
    assert_eq!(plan.capability_key, Capability::WorktreeListZ.key());
}

#[test]
fn probe_plan_preferred_command_includes_porcelain_before_z() {
    // Verified live on this host (Git 2.50.1): a bare `worktree list -z`
    // fails with "fatal: the option '-z' requires '--porcelain'".
    let plan = worktree_list_probe_plan();
    assert_eq!(
        plan.preferred_command,
        vec!["worktree", "list", "--porcelain", "-z"]
    );
    assert_eq!(
        plan.fallback_command,
        vec!["worktree", "list", "--porcelain"]
    );
}
