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

use std::time::Duration;

use git::{
    Capability, CapabilityCache, HostScope, ProbeOutcome, StatusEntry, StatusHeader,
    baseline_probe_plan, parse_status_porcelain_v2,
};

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
