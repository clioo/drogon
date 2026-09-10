//! C04 domain acceptance tests: versioned identity and project-scoped
//! memory operations, the scoped prompt-composition freeze, and the
//! legacy migration rule. These exercise the pure domain layer the
//! storage/RPC owners integrate (the C04 contract checkpoint); they use
//! deterministic injected ids/clocks, no daemon and no external process.

use drogon_core::bots::identity::{
    EditOrigin, EditProvenance, INITIAL_IDENTITY_VERSION, IdentityEditRequest, IdentityError,
    IdentityState, apply_identity_edit,
};
use drogon_core::bots::memory::{
    BotMemory, MemoryError, MemoryScope, NewMemoryRequest, assert_project_access, delete_memory,
    edit_memory, migrate_legacy_memories, new_memory,
};
use drogon_core::bots::prompt::{
    FrozenPromptContext, ScopedPromptError, build_operating_prompt, build_scoped_operating_prompt,
};
use drogon_core::bots::records::{Bot, DisplayIdentity, HarnessModelPolicy};

fn bot() -> Bot {
    Bot {
        id: "bot-1".to_string(),
        character_preset: "arya".to_string(),
        display_identity: DisplayIdentity {
            display_name: "Arya".to_string(),
            handle: Some("arya".to_string()),
            title: Some("Scout".to_string()),
        },
        harness_policy: HarnessModelPolicy {
            default_harness: "codex".to_string(),
            explicit_model: None,
        },
        instructions: "Review incoming PRs.".to_string(),
        memories: vec!["Legacy global note.".to_string()],
        responsibilities: Vec::new(),
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    }
}

fn memory(id: &str, scope: MemoryScope, project: Option<&str>, content: &str) -> BotMemory {
    BotMemory {
        id: id.to_string(),
        bot_id: "bot-1".to_string(),
        scope,
        project_id: project.map(str::to_string),
        content: content.to_string(),
        version: 1,
        provenance: EditProvenance::user(Some("req-seed".to_string())),
        created_at: 1.0,
        updated_at: 1.0,
    }
}

fn create_request(scope: MemoryScope, project: Option<&str>, content: &str) -> NewMemoryRequest {
    NewMemoryRequest {
        bot_id: "bot-1".to_string(),
        scope,
        project_id: project.map(str::to_string),
        content: content.to_string(),
        provenance: EditProvenance::user(Some("req-create".to_string())),
    }
}

/// Acceptance 1 (domain half): one bot, two projects -- a turn in project
/// A carries the global memory and A's memory, never B's; reverse for B.
#[test]
fn scoped_turn_context_is_global_plus_own_project_only() {
    let subject = bot();
    let memories = vec![
        memory("m-g", MemoryScope::Global, None, "Global fact."),
        memory(
            "m-a",
            MemoryScope::Project,
            Some("proj-a"),
            "Project A fact.",
        ),
        memory(
            "m-b",
            MemoryScope::Project,
            Some("proj-b"),
            "Project B fact.",
        ),
    ];
    let (prompt_a, _) =
        build_scoped_operating_prompt(&subject, "Status?", &memories, Some("proj-a"), 1, 5.0)
            .expect("composes for A");
    assert!(prompt_a.contains("- Global fact."));
    assert!(prompt_a.contains("- Project A fact."));
    assert!(!prompt_a.contains("Project B fact."));
    let (prompt_b, _) =
        build_scoped_operating_prompt(&subject, "Status?", &memories, Some("proj-b"), 1, 5.0)
            .expect("composes for B");
    assert!(prompt_b.contains("- Global fact."));
    assert!(prompt_b.contains("- Project B fact."));
    assert!(!prompt_b.contains("Project A fact."));
}

/// Acceptance 1 (RPC half's rule): wrong-scope access to a project memory
/// is rejected by the same function the backend list/mutation paths must
/// call -- never renderer-side filtering alone.
#[test]
fn wrong_scope_access_to_project_memory_is_rejected() {
    let project_a = memory("m-a", MemoryScope::Project, Some("proj-a"), "A");
    assert_eq!(
        assert_project_access(&project_a, Some("proj-b")).unwrap_err(),
        MemoryError::AccessDenied {
            memory_id: "m-a".to_string(),
            required_project_id: "proj-a".to_string(),
        }
    );
    // Project-less contexts (the app-global Bots snapshot scope) see no
    // project memory at all.
    assert!(assert_project_access(&project_a, None).is_err());
    // Global memories are the explicit exception: accessible everywhere.
    let global = memory("m-g", MemoryScope::Global, None, "G");
    assert!(assert_project_access(&global, Some("proj-b")).is_ok());
    assert!(assert_project_access(&global, None).is_ok());
}

/// Acceptance 3: two concurrent editors holding the same expected version
/// -- exactly one apply wins, the loser conflicts, and nothing is lost
/// silently (the loser must re-read the winner's record). `live` models
/// the stored row both editors read version 1 from.
#[test]
fn concurrent_edits_with_same_expected_version_do_not_silently_lose() {
    let mut live = new_memory(
        &create_request(MemoryScope::Global, None, "Original."),
        || "m-1".to_string(),
        5.0,
    )
    .expect("creates");
    assert_eq!(live.version, 1);
    // Both editors read this snapshot (version 1):
    let _shared_snapshot = live.clone();
    // Editor one's request lands first: the row moves to version 2.
    live = edit_memory(&live, 1, "Editor one.", 6.0).expect("first writer wins");
    // Editor two attempts the SAME expected version against the moved
    // row: a structured conflict naming both versions, never a clobber.
    let conflict =
        edit_memory(&live, 1, "Editor two.", 6.0).expect_err("stale expected version conflicts");
    assert_eq!(
        conflict,
        MemoryError::VersionConflict {
            expected: 1,
            current: 2
        }
    );
    assert_eq!(live.content, "Editor one.");
    // ...and after re-reading, the loser's retry lands on the winner's
    // content instead of overwriting it.
    let retry = edit_memory(&live, 2, "Editor one + two.", 7.0).expect("retry applies");
    assert_eq!(retry.version, 3);
    assert_eq!(retry.provenance, live.provenance);
    assert_eq!(retry.created_at, live.created_at);
    // Deletes obey the same fence.
    assert!(delete_memory(&retry, 2).is_err());
    assert!(delete_memory(&retry, 3).is_ok());
}

/// Acceptance 4: legacy migration preserves EVERY entry verbatim, marks
/// each explicitly legacy-global, and refuses incompatible future data
/// instead of loading it.
#[test]
fn legacy_migration_preserves_entries_and_future_data_refuses() {
    let legacy = vec![
        "Prefers terse replies.".to_string(),
        "   ".to_string(),
        "Ships on Fridays.".to_string(),
    ];
    let mut counter = 0u32;
    let migrated = migrate_legacy_memories(
        "bot-1",
        &legacy,
        &mut || {
            counter += 1;
            format!("m-legacy-{counter}")
        },
        5.0,
    )
    .expect("migrates");
    assert_eq!(migrated.len(), legacy.len());
    for (entry, record) in legacy.iter().zip(&migrated) {
        assert_eq!(&record.content, entry, "verbatim, no trimming");
        assert_eq!(record.scope, MemoryScope::Global);
        assert_eq!(record.project_id, None);
        assert_eq!(record.provenance.origin, EditOrigin::LegacyGlobal);
        assert_eq!(record.version, 1);
        assert!(record.validate().is_ok());
    }
    // Migrated records keep their global meaning in scoped turns. The
    // blank entry stays preserved as a record but does not render: the
    // existing composer has always filtered blank memories, and the
    // scoped entrypoint delegates to it unchanged.
    let (prompt, _) = build_scoped_operating_prompt(
        &bot(),
        "Hi",
        &migrated,
        Some("proj-a"),
        INITIAL_IDENTITY_VERSION,
        5.0,
    )
    .expect("composes");
    assert!(prompt.contains("- Prefers terse replies."));
    assert!(prompt.contains("- Ships on Fridays."));

    // Incompatible future data refuses safely.
    let good =
        serde_json::to_value(memory("m-1", MemoryScope::Global, None, "x")).expect("serializes");
    let mut future_scope = good.clone();
    future_scope["scope"] = serde_json::Value::String("workspace".to_string());
    assert!(BotMemory::parse_record(&future_scope).is_err());
    let mut future_version = good;
    future_version["version"] = serde_json::Value::from(0);
    assert!(matches!(
        BotMemory::parse_record(&future_version).unwrap_err(),
        MemoryError::InvalidRecord(_)
    ));
}

/// Acceptance 5 (domain half): a turn composed on context v1 keeps its
/// frozen versions and hash after the record edits to v2; the NEXT turn
/// composes with v2 and a different hash. The legacy composed prompt
/// never changes underneath a caller either.
#[test]
fn active_turn_stays_v1_and_next_turn_uses_v2() {
    let subject = bot();
    let memories = vec![memory("m-1", MemoryScope::Global, None, "v1 text")];
    let (prompt_v1, frozen_v1) =
        build_scoped_operating_prompt(&subject, "Hi", &memories, None, 1, 5.0)
            .expect("composes v1");
    assert!(prompt_v1.contains("- v1 text"));

    let edited = edit_memory(&memories[0], 1, "v2 text", 9.0).expect("edits");
    let next = vec![edited];
    let (prompt_v2, frozen_v2) =
        build_scoped_operating_prompt(&subject, "Hi", &next, None, 1, 10.0).expect("composes v2");
    assert!(prompt_v2.contains("- v2 text"));
    assert!(!prompt_v2.contains("v1 text"));

    // The frozen v1 context is untouched by the v2 edit: same memory
    // versions, same hash, same frozen_at.
    let recomputed_v1_probe: FrozenPromptContext = frozen_v1.clone();
    assert_eq!(recomputed_v1_probe.memories[0].version, 1);
    assert_eq!(frozen_v2.memories[0].version, 2);
    assert_ne!(frozen_v1.context_hash, frozen_v2.context_hash);
    assert_eq!(frozen_v1.frozen_at, 5.0);
    assert_eq!(frozen_v2.frozen_at, 10.0);
    // Identity version freezes alongside the memories.
    assert_eq!(frozen_v1.identity_version, 1);
    assert_eq!(frozen_v2.identity_version, 1);
}

/// Identity editing: expected-version CAS, normalization parity with the
/// existing record normalizer, and structured conflicts.
#[test]
fn identity_edit_applies_and_conflicts_exactly() {
    let subject = IdentityState::from_bot(&bot(), 4).expect("reads");
    let request = IdentityEditRequest {
        bot_id: "bot-1".to_string(),
        expected_identity_version: 4,
        provenance: EditProvenance::user(Some("req-identity".to_string())),
        display_identity: DisplayIdentity {
            display_name: "  Arya Stark  ".to_string(),
            handle: Some("@arya".to_string()),
            title: Some("Scout".to_string()),
        },
        instructions: "Watch the realm.".to_string(),
    };
    let applied = apply_identity_edit(&subject, &request, 12.0).expect("applies");
    assert_eq!(applied.identity_version, 5);
    assert_eq!(applied.display_identity.display_name, "Arya Stark");
    assert_eq!(applied.display_identity.handle.as_deref(), Some("arya"));
    assert_eq!(applied.instructions, "Watch the realm.");

    // A stale writer conflicts with both versions named.
    let stale_request = IdentityEditRequest {
        expected_identity_version: 4,
        ..request.clone()
    };
    assert_eq!(
        apply_identity_edit(&applied, &stale_request, 13.0).unwrap_err(),
        IdentityError::VersionConflict {
            expected: 4,
            current: 5
        }
    );
    // The stored identity still carries the winner's edit.
    assert_eq!(applied.display_identity.display_name, "Arya Stark");
}

/// The legacy prompt composer is untouched: the unscoped path keeps its
/// exact existing behavior (the excluded bot_run_rpc caller keeps working
/// until the scoped entrypoint is wired there).
#[test]
fn legacy_composer_is_unchanged_for_existing_callers() {
    let subject = bot();
    let prompt = build_operating_prompt(&subject, "What is the status of PR 42?");
    assert!(prompt.contains("Name: Arya"));
    assert!(prompt.contains("Standing instructions\nReview incoming PRs."));
    assert!(prompt.contains("- Legacy global note."));
    assert!(prompt.contains("Chat message\nWhat is the status of PR 42?"));
}

/// The scoped entrypoint refuses invalid records instead of silently
/// narrowing the context.
#[test]
fn scoped_composition_refuses_bad_records_and_zero_identity_version() {
    let subject = bot();
    let broken = vec![memory("m-x", MemoryScope::Project, None, "no project id")];
    assert!(matches!(
        build_scoped_operating_prompt(&subject, "Hi", &broken, Some("proj-a"), 1, 5.0),
        Err(ScopedPromptError::InvalidMemoryRecord(_))
    ));
    let good = vec![memory("m-x", MemoryScope::Global, None, "ok")];
    assert_eq!(
        build_scoped_operating_prompt(&subject, "Hi", &good, None, 0, 5.0).unwrap_err(),
        ScopedPromptError::InvalidIdentityVersion(0)
    );
}
