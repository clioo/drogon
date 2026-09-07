//! Behavioral tests for the Git capability baseline module: per-host
//! capability rejection memory, retry-after-interval self-heal, single-flight
//! probe coalescing shape, and the `status --porcelain=v2` baseline parser.
//! Compiles `src/git.rs` and `src/error.rs` directly via `#[path]` (no
//! `lib.rs` change needed in this change; the module is not wired into the
//! RPC surface yet), the same trick `workspace_files_explorer.rs` uses, so
//! error codes stay exact with `docs/migration/protocol-v1.md`'s frozen set.

// Most of error.rs's constructors are unused by this test crate but ARE used
// by the real drogon-core lib build; don't let clippy flag them dead.
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[path = "../src/git.rs"]
mod git;
// Only used to prove the WorktreeListZ fallback command's output shape
// (`worktree list --porcelain`, no `-z`) is the exact line-block form this
// parser already handles; not otherwise exercised by this test file.
#[allow(dead_code)]
#[path = "../src/git_worktree.rs"]
mod git_worktree;

use std::time::Duration;

use git::{
    Capability, CapabilityCache, HostScope, ProbeGuard, ProbeOutcome, StatusEntry, StatusHeader,
    baseline_probe_plan, parse_status_porcelain_v2, parse_status_porcelain_v2_z,
};
use git_worktree::parse_worktree_list_porcelain;

// --- per-scope isolation --------------------------------------------------

#[test]
fn rejection_on_ssh_scope_does_not_affect_native_scope() {
    let cache = CapabilityCache::new();
    let ssh = HostScope::ssh("github");
    let native = HostScope::native();

    cache.record_rejection(&ssh, Capability::MergeTreeWriteTree);

    assert!(cache.is_rejected(&ssh, Capability::MergeTreeWriteTree));
    assert!(!cache.is_rejected(&native, Capability::MergeTreeWriteTree));
}

#[test]
fn rejection_on_native_scope_does_not_affect_wsl_scope() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    let wsl = HostScope::wsl("Ubuntu-22.04");

    cache.record_rejection(&native, Capability::WorktreeListZ);

    assert!(cache.is_rejected(&native, Capability::WorktreeListZ));
    assert!(!cache.is_rejected(&wsl, Capability::WorktreeListZ));
}

#[test]
fn capability_key_matches_the_source_table_identifiers() {
    assert_eq!(Capability::FetchNoWriteFetchHead.key(), "fetch-no-write-fetch-head");
    assert_eq!(Capability::WorktreeListZ.key(), "worktree-list-z");
    assert_eq!(Capability::RevParsePathFormat.key(), "rev-parse-path-format");
    assert_eq!(Capability::ForEachRefExclude.key(), "for-each-ref-exclude");
    assert_eq!(Capability::MergeTreeWriteTree.key(), "merge-tree-write-tree");
    assert_eq!(Capability::MergeTreeMergeBase.key(), "merge-tree-merge-base");
    assert_eq!(Capability::DecoratePlaceholder.key(), "decorate-placeholder");
}

#[test]
fn rejection_on_relay_scope_does_not_affect_native_scope() {
    let cache = CapabilityCache::new();
    let relay = HostScope::relay("relay-42");
    let native = HostScope::native();

    cache.record_rejection(&relay, Capability::DecoratePlaceholder);

    assert!(cache.is_rejected(&relay, Capability::DecoratePlaceholder));
    assert!(!cache.is_rejected(&native, Capability::DecoratePlaceholder));
}

#[test]
fn distinct_ssh_providers_are_isolated_scopes() {
    let cache = CapabilityCache::new();
    let github = HostScope::ssh("github");
    let gitlab = HostScope::ssh("gitlab");

    cache.record_rejection(&github, Capability::ForEachRefExclude);

    assert!(cache.is_rejected(&github, Capability::ForEachRefExclude));
    assert!(!cache.is_rejected(&gitlab, Capability::ForEachRefExclude));
}

#[test]
fn distinct_capabilities_on_same_scope_are_independent() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();

    cache.record_rejection(&native, Capability::FetchNoWriteFetchHead);

    assert!(cache.is_rejected(&native, Capability::FetchNoWriteFetchHead));
    assert!(!cache.is_rejected(&native, Capability::RevParsePathFormat));
}

// --- retry-after-interval self-heal ---------------------------------------

#[test]
fn should_retry_is_false_immediately_after_rejection() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    cache.record_rejection(&native, Capability::MergeTreeMergeBase);

    assert!(!cache.should_retry(&native, Capability::MergeTreeMergeBase, Duration::from_secs(60)));
}

#[test]
fn should_retry_is_true_once_interval_elapses() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    cache.record_rejection(&native, Capability::MergeTreeMergeBase);

    // A zero interval always permits an immediate retry, exercising the
    // "upgrade self-heals" path without a real sleep in the test.
    assert!(cache.should_retry(&native, Capability::MergeTreeMergeBase, Duration::from_secs(0)));
}

#[test]
fn should_retry_is_true_when_capability_was_never_rejected() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();

    assert!(cache.should_retry(&native, Capability::DecoratePlaceholder, Duration::from_secs(3600)));
}

#[test]
fn retry_after_elapsed_interval_clears_the_rejection_on_success() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    cache.record_rejection(&native, Capability::RevParsePathFormat);

    assert!(cache.should_retry(&native, Capability::RevParsePathFormat, Duration::from_secs(0)));
    cache.record_success(&native, Capability::RevParsePathFormat);

    assert!(!cache.is_rejected(&native, Capability::RevParsePathFormat));
}

// --- concurrent-probe coalescing shape -------------------------------------

#[test]
fn begin_probe_returns_leader_once_then_follower_for_concurrent_callers() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();

    let first = cache.begin_probe(&native, Capability::WorktreeListZ);
    let second = cache.begin_probe(&native, Capability::WorktreeListZ);

    assert_eq!(first, ProbeOutcome::Leader);
    assert_eq!(second, ProbeOutcome::Follower);
}

#[test]
fn finishing_a_probe_allows_a_fresh_single_flight_round() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();

    assert_eq!(
        cache.begin_probe(&native, Capability::ForEachRefExclude),
        ProbeOutcome::Leader
    );
    cache.finish_probe(&native, Capability::ForEachRefExclude);

    assert_eq!(
        cache.begin_probe(&native, Capability::ForEachRefExclude),
        ProbeOutcome::Leader
    );
}

#[test]
fn in_flight_probes_are_isolated_per_scope() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    let wsl = HostScope::wsl("Ubuntu-22.04");

    assert_eq!(
        cache.begin_probe(&native, Capability::MergeTreeWriteTree),
        ProbeOutcome::Leader
    );
    assert_eq!(
        cache.begin_probe(&wsl, Capability::MergeTreeWriteTree),
        ProbeOutcome::Leader
    );
}

// --- baseline_probe_plan ---------------------------------------------------

#[test]
fn baseline_probe_plan_covers_every_capability_with_a_fallback() {
    let plan = baseline_probe_plan();

    assert_eq!(plan.len(), 7);
    for entry in &plan {
        assert!(!entry.preferred_command.is_empty());
        assert!(!entry.fallback_command.is_empty());
    }
}

#[test]
fn baseline_probe_plan_orders_fetch_head_before_worktree_list() {
    let plan = baseline_probe_plan();
    let fetch_pos = plan
        .iter()
        .position(|p| p.capability == Capability::FetchNoWriteFetchHead)
        .unwrap();
    let worktree_pos = plan
        .iter()
        .position(|p| p.capability == Capability::WorktreeListZ)
        .unwrap();
    assert!(fetch_pos < worktree_pos);
}

#[test]
fn baseline_probe_plan_spawns_no_process() {
    // Purely a data-shape assertion: constructing the plan twice must be
    // side-effect-free and deterministic (no cache/process interaction).
    let a = baseline_probe_plan();
    let b = baseline_probe_plan();
    assert_eq!(a, b);
}

#[test]
fn worktree_list_z_preferred_and_fallback_commands_carry_porcelain() {
    // Real Git rejects a bare `-z`: "fatal: the option '-z' requires
    // '--porcelain'" (verified live against Git 2.50.1). Both the preferred
    // and fallback commands must request `--porcelain` for either form to
    // be parseable at all.
    let plan = baseline_probe_plan();
    let entry = plan
        .iter()
        .find(|p| p.capability == Capability::WorktreeListZ)
        .unwrap();

    assert_eq!(
        entry.preferred_command,
        vec!["worktree", "list", "--porcelain", "-z"]
    );
    assert_eq!(entry.fallback_command, vec!["worktree", "list", "--porcelain"]);
    assert!(entry.preferred_command.contains(&"--porcelain".to_string()));
    assert!(entry.fallback_command.contains(&"--porcelain".to_string()));
}

#[test]
fn worktree_list_z_fallback_command_shape_is_parseable_line_block_output() {
    // The fallback command (`worktree list --porcelain`, no `-z`) is real
    // Git's pre-2.36 line-block porcelain form. Feed a representative
    // sample of that exact shape through the worktree parser to prove the
    // fallback command and the parser agree on what "parseable" means.
    let sample = "worktree /repo\nHEAD abcdef1234567890abcdef1234567890abcdef12\nbranch refs/heads/main\n\n";
    let entries = parse_worktree_list_porcelain(sample).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, "/repo");
    assert_eq!(entries[0].branch.as_deref(), Some("refs/heads/main"));
}

// --- porcelain v2 parsing ----------------------------------------------------

#[test]
fn parses_header_lines_and_ordinary_entries() {
    let input = "\
# branch.oid abcdef1234567890abcdef1234567890abcdef12
# branch.head main
# branch.upstream origin/main
# branch.ab +1 -2
1 M. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 src/lib.rs
";
    let parsed = parse_status_porcelain_v2(input).unwrap();
    assert_eq!(
        parsed.header,
        StatusHeader {
            oid: Some("abcdef1234567890abcdef1234567890abcdef12".to_string()),
            head: Some("main".to_string()),
            upstream: Some("origin/main".to_string()),
            ahead: Some(1),
            behind: Some(2),
        }
    );
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::Ordinary { path, xy, .. } => {
            assert_eq!(path, "src/lib.rs");
            assert_eq!(xy, "M.");
        }
        other => panic!("expected ordinary entry, got {other:?}"),
    }
}

#[test]
fn parses_rename_entry_with_score_and_both_paths() {
    let input = "2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 new_name.rs\told_name.rs\n";
    let parsed = parse_status_porcelain_v2(input).unwrap();
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::RenameOrCopy {
            path,
            orig_path,
            score,
            xy,
            ..
        } => {
            assert_eq!(path, "new_name.rs");
            assert_eq!(orig_path, "old_name.rs");
            assert_eq!(score, "R100");
            assert_eq!(xy, "R.");
        }
        other => panic!("expected rename/copy entry, got {other:?}"),
    }
}

#[test]
fn parses_copy_entry() {
    let input = "2 C. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 C075 copied.rs\tsource.rs\n";
    let parsed = parse_status_porcelain_v2(input).unwrap();
    match &parsed.entries[0] {
        StatusEntry::RenameOrCopy { xy, score, .. } => {
            assert_eq!(xy, "C.");
            assert_eq!(score, "C075");
        }
        other => panic!("expected copy entry, got {other:?}"),
    }
}

#[test]
fn parses_unmerged_conflict_entry() {
    let input = "u UU N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 conflicted.rs\n";
    let parsed = parse_status_porcelain_v2(input).unwrap();
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::Unmerged { path, xy, .. } => {
            assert_eq!(path, "conflicted.rs");
            assert_eq!(xy, "UU");
        }
        other => panic!("expected unmerged entry, got {other:?}"),
    }
}

#[test]
fn parses_untracked_and_ignored_lines() {
    let input = "? untracked.txt\n! ignored.log\n";
    let parsed = parse_status_porcelain_v2(input).unwrap();
    assert_eq!(parsed.entries.len(), 2);
    assert!(matches!(&parsed.entries[0], StatusEntry::Untracked { path } if path == "untracked.txt"));
    assert!(matches!(&parsed.entries[1], StatusEntry::Ignored { path } if path == "ignored.log"));
}

#[test]
fn parses_multiple_mixed_entries_in_order() {
    let input = "\
1 M. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 a.rs
? new.rs
u UU N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 conflict.rs
";
    let parsed = parse_status_porcelain_v2(input).unwrap();
    assert_eq!(parsed.entries.len(), 3);
    assert!(matches!(parsed.entries[0], StatusEntry::Ordinary { .. }));
    assert!(matches!(parsed.entries[1], StatusEntry::Untracked { .. }));
    assert!(matches!(parsed.entries[2], StatusEntry::Unmerged { .. }));
}

#[test]
fn empty_input_parses_to_empty_header_and_no_entries() {
    let parsed = parse_status_porcelain_v2("").unwrap();
    assert_eq!(parsed.header, StatusHeader::default());
    assert!(parsed.entries.is_empty());
}

// --- malformed input rejection ----------------------------------------------

#[test]
fn rejects_ordinary_entry_with_too_few_fields() {
    let err = parse_status_porcelain_v2("1 M. N... 100644 100644\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_unmerged_entry_with_too_few_fields() {
    let err = parse_status_porcelain_v2("u UU N... 100644\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_rename_entry_missing_tab_separated_orig_path() {
    let err = parse_status_porcelain_v2(
        "2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 only_one_path.rs\n",
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_unknown_line_prefix() {
    let err = parse_status_porcelain_v2("x this is not a real line\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_malformed_branch_ab_header() {
    let err = parse_status_porcelain_v2("# branch.ab not-numbers\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_empty_untracked_path() {
    let err = parse_status_porcelain_v2("?\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- ROOT fix (1): parse_ab must never panic on non-ASCII ------------------

#[test]
fn malformed_branch_ab_with_non_ascii_sign_is_rejected_not_panicked() {
    // A multi-byte UTF-8 character (the euro sign, 3 bytes) as the "sign"
    // byte used to panic in `split_at(1)`, which slices by byte index and
    // lands mid-character rather than on a char boundary. This must now
    // return `invalid_argument` like any other malformed field.
    let err = parse_status_porcelain_v2("# branch.ab €1 -2\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn malformed_branch_ab_with_lone_non_ascii_field_is_rejected_not_panicked() {
    let err = parse_status_porcelain_v2("# branch.ab 日\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn well_formed_branch_ab_after_a_non_ascii_first_part_still_panics_never() {
    // Two whitespace-separated parts; only the first is malformed. Proves
    // the char-based split doesn't panic partway through a multi-part field
    // either.
    let err = parse_status_porcelain_v2("# branch.ab ✓5 -2\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- ROOT fix (2): leading spaces in ?/! paths ------------------------------

#[test]
fn untracked_path_with_legitimate_leading_space_keeps_it() {
    // Raw line: "?" + one format-separator space + one more space that is
    // part of the real filename + "leading.txt". The old `trim_start`
    // devoured both; only the separator space may be stripped.
    let parsed = parse_status_porcelain_v2("?  leading.txt\n").unwrap();
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, " leading.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }
}

#[test]
fn ignored_path_with_legitimate_leading_space_keeps_it() {
    let parsed = parse_status_porcelain_v2("!  leading.log\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Ignored { path } => assert_eq!(path, " leading.log"),
        other => panic!("expected ignored entry, got {other:?}"),
    }
}

#[test]
fn untracked_path_with_multiple_legitimate_leading_spaces_keeps_all_but_the_separator() {
    let parsed = parse_status_porcelain_v2("?   triple.txt\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "  triple.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }
}

// --- ROOT fix (3): C-quote unescaping ---------------------------------------

#[test]
fn unquotes_backslash_and_doublequote_escapes() {
    let parsed = parse_status_porcelain_v2("? \"back\\\\slash.txt\"\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "back\\slash.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }

    let parsed = parse_status_porcelain_v2("? \"quote\\\"name.txt\"\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "quote\"name.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }
}

#[test]
fn unquotes_newline_and_tab_control_escapes() {
    let parsed = parse_status_porcelain_v2("? \"newline\\nname.txt\"\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "newline\nname.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }

    let parsed = parse_status_porcelain_v2("? \"tab\\tname.txt\"\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "tab\tname.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }
}

#[test]
fn unquotes_octal_escaped_control_byte() {
    // Real git quotes a lone control byte (SOH, 0x01) as octal, not a named
    // C escape (verified live: `git status --porcelain=v2` on a file named
    // "ctrl\x01name.txt" emits `"ctrl\001name.txt"`).
    let parsed = parse_status_porcelain_v2("? \"ctrl\\001name.txt\"\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "ctrl\u{1}name.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }
}

#[test]
fn unquotes_octal_escaped_multibyte_non_ascii_chars() {
    // Real git (verified live) quotes "héllo.txt" as
    // `"h\303\251llo.txt"` (0xC3 0xA9 is 'é' in UTF-8) and "emoji😀.txt" as
    // `"emoji\360\237\230\200.txt"` (0xF0 0x9F 0x98 0x80 is the emoji's
    // 4-byte UTF-8 encoding) — chained octal escapes must reassemble into
    // the original multi-byte character, not be decoded one octal group at
    // a time.
    let parsed = parse_status_porcelain_v2("? \"h\\303\\251llo.txt\"\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "héllo.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }

    let parsed = parse_status_porcelain_v2("? \"emoji\\360\\237\\230\\200.txt\"\n").unwrap();
    match &parsed.entries[0] {
        StatusEntry::Untracked { path } => assert_eq!(path, "emoji😀.txt"),
        other => panic!("expected untracked entry, got {other:?}"),
    }
}

#[test]
fn unquotes_c_quoted_rename_path_and_orig_path() {
    let input = "2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 \"h\\303\\251llo.txt\"\t\"tab\\tname.txt\"\n";
    let parsed = parse_status_porcelain_v2(input).unwrap();
    match &parsed.entries[0] {
        StatusEntry::RenameOrCopy {
            path, orig_path, ..
        } => {
            assert_eq!(path, "héllo.txt");
            assert_eq!(orig_path, "tab\tname.txt");
        }
        other => panic!("expected rename/copy entry, got {other:?}"),
    }
}

#[test]
fn rejects_truncated_octal_escape() {
    let err = parse_status_porcelain_v2("? \"broken\\12\"\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_truncated_backslash_at_end_of_quoted_path() {
    let err = parse_status_porcelain_v2("? \"broken\\\"\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn rejects_unknown_c_quote_escape() {
    let err = parse_status_porcelain_v2("? \"unknown\\qname.txt\"\n").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- ROOT fix (4): NUL-delimited (-z) status parsing ------------------------

#[test]
fn parses_z_form_header_and_ordinary_entry() {
    let input = "# branch.oid abcdef1234567890abcdef1234567890abcdef12\0# branch.head main\0# branch.ab +1 -2\x001 M. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 src/lib.rs\0";
    let parsed = parse_status_porcelain_v2_z(input).unwrap();
    assert_eq!(parsed.header.head.as_deref(), Some("main"));
    assert_eq!(parsed.header.ahead, Some(1));
    assert_eq!(parsed.header.behind, Some(2));
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::Ordinary { path, xy } => {
            assert_eq!(path, "src/lib.rs");
            assert_eq!(xy, "M.");
        }
        other => panic!("expected ordinary entry, got {other:?}"),
    }
}

#[test]
fn parses_z_form_rename_entry_with_nul_separated_orig_path() {
    // Real-git-shaped: `git mv old_name.txt new_name.txt` then
    // `git status --porcelain=v2 -z` (verified live) emits the rename
    // record's `path` and `origPath` as two independent NUL-terminated
    // tokens — NOT tab-separated the way the non-`-z` line form is (see
    // `parses_rename_entry_with_score_and_both_paths` above for that form).
    let input = "2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 new_name.txt\0old_name.txt\0";
    let parsed = parse_status_porcelain_v2_z(input).unwrap();
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::RenameOrCopy {
            path,
            orig_path,
            score,
            xy,
        } => {
            assert_eq!(path, "new_name.txt");
            assert_eq!(orig_path, "old_name.txt");
            assert_eq!(score, "R100");
            assert_eq!(xy, "R.");
        }
        other => panic!("expected rename/copy entry, got {other:?}"),
    }
}

#[test]
fn z_form_paths_are_never_c_unquoted() {
    // `-z` disables quoting entirely: a raw non-ASCII byte sequence and a
    // raw embedded tab/newline pass through verbatim, never through the
    // C-quote path used by the line form.
    let input = "? h\u{e9}llo.txt\0! tab\tname.txt\0";
    let parsed = parse_status_porcelain_v2_z(input).unwrap();
    assert_eq!(parsed.entries.len(), 2);
    assert!(matches!(&parsed.entries[0], StatusEntry::Untracked { path } if path == "héllo.txt"));
    assert!(matches!(&parsed.entries[1], StatusEntry::Ignored { path } if path == "tab\tname.txt"));
}

#[test]
fn z_form_untracked_path_with_legitimate_leading_space_keeps_it() {
    let input = "?  leading.txt\0";
    let parsed = parse_status_porcelain_v2_z(input).unwrap();
    assert!(matches!(&parsed.entries[0], StatusEntry::Untracked { path } if path == " leading.txt"));
}

#[test]
fn z_form_rejects_rename_missing_nul_separated_orig_path() {
    let input = "2 R. N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 R100 only_one_path.txt\0";
    let err = parse_status_porcelain_v2_z(input).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn z_form_rejects_unknown_line_prefix() {
    let err = parse_status_porcelain_v2_z("x not a real entry\0").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn z_form_empty_input_parses_to_empty_header_and_no_entries() {
    let parsed = parse_status_porcelain_v2_z("").unwrap();
    assert_eq!(parsed.header, StatusHeader::default());
    assert!(parsed.entries.is_empty());
}

// --- ROOT fix (5): fixtures generated from the real local git binary -------
//
// These spawn the actual `git` binary installed on this development host
// (verified 2.50.1, see git-capability-baseline.md) against a throwaway
// temp repo, so the fixture bytes are exactly what real Git emits — not a
// hand-written approximation of the format. If `git` is not on PATH these
// fail loudly (no silent skip): a "parses synthetic input" test proves
// nothing about whether the parser agrees with the real tool.

struct TempRepo {
    dir: std::path::PathBuf,
}

impl TempRepo {
    fn init(tag: &str) -> Self {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "drogon_git_baseline_fixture_{tag}_{}_{}_{unique}",
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

    fn status_v2(&self) -> String {
        String::from_utf8(self.git(&["status", "--porcelain=v2"]).stdout)
            .expect("git status output is valid UTF-8")
    }

    fn status_v2_z(&self) -> String {
        String::from_utf8(self.git(&["status", "--porcelain=v2", "-z"]).stdout)
            .expect("git status -z output is valid UTF-8")
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn write_file(repo: &TempRepo, name: &str) {
    std::fs::write(repo.dir.join(name), b"fixture\n").expect("write fixture file");
}

#[test]
fn real_git_status_v2_round_trips_special_filenames() {
    let repo = TempRepo::init("line");
    write_file(&repo, " leading.txt");
    write_file(&repo, "héllo.txt");
    write_file(&repo, "tab\tname.txt");

    let raw = repo.status_v2();
    let parsed = parse_status_porcelain_v2(&raw).unwrap_or_else(|e| {
        panic!("parser rejected real git output: {e:?}\nraw:\n{raw}");
    });

    let paths: Vec<&str> = parsed
        .entries
        .iter()
        .map(|e| match e {
            StatusEntry::Untracked { path } => path.as_str(),
            other => panic!("expected untracked entry, got {other:?}"),
        })
        .collect();

    assert!(paths.contains(&" leading.txt"), "paths: {paths:?}");
    assert!(paths.contains(&"héllo.txt"), "paths: {paths:?}");
    assert!(paths.contains(&"tab\tname.txt"), "paths: {paths:?}");
}

#[test]
fn real_git_status_v2_z_round_trips_special_filenames() {
    let repo = TempRepo::init("z");
    write_file(&repo, " leading.txt");
    write_file(&repo, "héllo.txt");
    write_file(&repo, "tab\tname.txt");

    let raw = repo.status_v2_z();
    let parsed = parse_status_porcelain_v2_z(&raw).unwrap_or_else(|e| {
        panic!("parser rejected real git -z output: {e:?}\nraw (debug): {raw:?}");
    });

    let paths: Vec<&str> = parsed
        .entries
        .iter()
        .map(|e| match e {
            StatusEntry::Untracked { path } => path.as_str(),
            other => panic!("expected untracked entry, got {other:?}"),
        })
        .collect();

    assert!(paths.contains(&" leading.txt"), "paths: {paths:?}");
    assert!(paths.contains(&"héllo.txt"), "paths: {paths:?}");
    assert!(paths.contains(&"tab\tname.txt"), "paths: {paths:?}");
}

#[test]
fn real_git_status_v2_round_trips_a_rename() {
    let repo = TempRepo::init("rename-line");
    write_file(&repo, "old_name.txt");
    repo.git(&["add", "old_name.txt"]);
    repo.git(&["commit", "-q", "-m", "init"]);
    repo.git(&["mv", "old_name.txt", "new_name.txt"]);

    let raw = repo.status_v2();
    let parsed = parse_status_porcelain_v2(&raw).unwrap_or_else(|e| {
        panic!("parser rejected real git output: {e:?}\nraw:\n{raw}");
    });
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::RenameOrCopy {
            path, orig_path, ..
        } => {
            assert_eq!(path, "new_name.txt");
            assert_eq!(orig_path, "old_name.txt");
        }
        other => panic!("expected rename/copy entry, got {other:?}"),
    }
}

#[test]
fn real_git_status_v2_z_round_trips_a_rename_with_nul_separated_orig_path() {
    let repo = TempRepo::init("rename-z");
    write_file(&repo, "old_name.txt");
    repo.git(&["add", "old_name.txt"]);
    repo.git(&["commit", "-q", "-m", "init"]);
    repo.git(&["mv", "old_name.txt", "new_name.txt"]);

    let raw = repo.status_v2_z();
    let parsed = parse_status_porcelain_v2_z(&raw).unwrap_or_else(|e| {
        panic!("parser rejected real git -z output: {e:?}\nraw (debug): {raw:?}");
    });
    assert_eq!(parsed.entries.len(), 1);
    match &parsed.entries[0] {
        StatusEntry::RenameOrCopy {
            path, orig_path, ..
        } => {
            assert_eq!(path, "new_name.txt");
            assert_eq!(orig_path, "old_name.txt");
        }
        other => panic!("expected rename/copy entry, got {other:?}"),
    }
}

// --- ROOT fix (6): baseline_probe_plan is inert data + ProbeGuard ----------

#[test]
fn probe_guard_calls_finish_probe_on_drop() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    assert_eq!(
        cache.begin_probe(&native, Capability::MergeTreeWriteTree),
        ProbeOutcome::Leader
    );
    {
        let _guard = ProbeGuard::new(&cache, native.clone(), Capability::MergeTreeWriteTree);
        // Guard drops at the end of this block.
    }
    // Drop already ran finish_probe, so a fresh leader round is available.
    assert_eq!(
        cache.begin_probe(&native, Capability::MergeTreeWriteTree),
        ProbeOutcome::Leader
    );
}

#[test]
fn probe_guard_finishes_the_probe_even_when_a_fallible_call_bails_out_early() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    assert_eq!(
        cache.begin_probe(&native, Capability::RevParsePathFormat),
        ProbeOutcome::Leader
    );

    fn simulate_fallible_probe_body(cache: &CapabilityCache, scope: HostScope) -> Result<(), ()> {
        let _guard = ProbeGuard::new(cache, scope, Capability::RevParsePathFormat);
        // Simulates a fallible call bailing out early via `?` before the
        // probe body reaches its normal end.
        Err(())
    }

    assert!(simulate_fallible_probe_body(&cache, native.clone()).is_err());
    // Even though the body returned early, Drop still ran finish_probe.
    assert_eq!(
        cache.begin_probe(&native, Capability::RevParsePathFormat),
        ProbeOutcome::Leader
    );
}

#[test]
fn probe_guard_keeps_probe_in_flight_until_dropped() {
    let cache = CapabilityCache::new();
    let native = HostScope::native();
    assert_eq!(
        cache.begin_probe(&native, Capability::ForEachRefExclude),
        ProbeOutcome::Leader
    );
    let guard = ProbeGuard::new(&cache, native.clone(), Capability::ForEachRefExclude);

    // While the guard is alive, a concurrent caller still sees Follower.
    assert_eq!(
        cache.begin_probe(&native, Capability::ForEachRefExclude),
        ProbeOutcome::Follower
    );

    drop(guard);

    assert_eq!(
        cache.begin_probe(&native, Capability::ForEachRefExclude),
        ProbeOutcome::Leader
    );
}
