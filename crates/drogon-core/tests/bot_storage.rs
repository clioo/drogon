//! Parity tests for native `Bot` records/normalization and their SQLite
//! storage (`crate::bots::{records, storage}`, not yet registered by root
//! -- see `docs/migration/native-bot-state-contract.md`,
//! `docs/migration/native-locale-ordering.md`, and
//! `tests/parity/ports/WP-CAP-BOTS/native-state/`).
//!
//! These tests import the real, root-registered `drogon_core` crate
//! (`drogon_core::bots::{records,storage}`,
//! `drogon_core::automations::{records,storage}`) -- production binding,
//! not a test-local path seam.
#![allow(dead_code)]

use drogon_core::automations;
use drogon_core::automations::storage::AutomationOwnerPrecondition;
use drogon_core::bots::records::*;
use drogon_core::bots::storage as bstorage;
use rusqlite::Connection;

const HOST: &str = "host-1";
const FOLDER: &str = "/repo";
const LOCALE: &str = "en-US";

fn conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    automations::storage::migrate(&conn).unwrap();
    bstorage::migrate(&conn).unwrap();
    conn
}

fn sample_bot(id: &str, display_name: &str, now: f64) -> Bot {
    Bot {
        id: id.to_string(),
        character_preset: "none".to_string(),
        display_identity: DisplayIdentity {
            display_name: display_name.to_string(),
            handle: None,
            title: None,
        },
        harness_policy: HarnessModelPolicy {
            default_harness: DEFAULT_DROGON_BOT_HARNESS.to_string(),
            explicit_model: None,
        },
        instructions: String::new(),
        memories: Vec::new(),
        responsibilities: Vec::new(),
        current_session: None,
        created_at: now,
        updated_at: now,
    }
}

fn is_known_harness(h: &str) -> bool {
    matches!(h, "codex" | "claude" | "pi")
}

// --- normalize_bot / normalize_responsibility (legacy tolerance) --------

#[test]
fn normalize_bot_returns_none_for_a_missing_id_or_empty_display_name() {
    assert!(
        normalize_bot(
            &serde_json::json!({"displayIdentity": {"displayName": "x"}}),
            is_known_harness,
            0.0
        )
        .is_none()
    );
    assert!(
        normalize_bot(
            &serde_json::json!({"id": "b1", "displayIdentity": {"displayName": "   "}}),
            is_known_harness,
            0.0
        )
        .is_none()
    );
}

#[test]
fn normalize_bot_ecmascript_trims_display_name_handle_and_title() {
    let value = serde_json::json!({
        "id": "b1",
        "displayIdentity": {"displayName": "  Arya Stark  ", "handle": "  @arya  ", "title": "\t Assistant \n"},
    });
    let bot = normalize_bot(&value, is_known_harness, 0.0).unwrap();
    assert_eq!(bot.display_identity.display_name, "Arya Stark");
    assert_eq!(bot.display_identity.handle.as_deref(), Some("arya"));
    assert_eq!(bot.display_identity.title.as_deref(), Some("Assistant"));
}

#[test]
fn normalize_bot_is_legacy_tolerant_of_any_non_empty_explicit_model() {
    // Unlike the strict IPC parser, the loader normalizer accepts any
    // non-empty explicitModel string, even one that would be rejected on
    // write by a stricter admission boundary.
    let value = serde_json::json!({
        "id": "b1",
        "displayIdentity": {"displayName": "Bot"},
        "harnessPolicy": {"defaultHarness": "codex", "explicitModel": "some-legacy-model-string"},
    });
    let bot = normalize_bot(&value, is_known_harness, 0.0).unwrap();
    assert_eq!(
        bot.harness_policy.explicit_model.as_deref(),
        Some("some-legacy-model-string")
    );
}

#[test]
fn normalize_bot_falls_back_to_default_harness_for_an_unknown_harness() {
    let value = serde_json::json!({
        "id": "b1",
        "displayIdentity": {"displayName": "Bot"},
        "harnessPolicy": {"defaultHarness": "not-a-real-harness"},
    });
    let bot = normalize_bot(&value, is_known_harness, 0.0).unwrap();
    assert_eq!(
        bot.harness_policy.default_harness,
        DEFAULT_DROGON_BOT_HARNESS
    );
}

#[test]
fn normalize_responsibility_rejects_malformed_persisted_evidence_instead_of_trusting_partial_rows()
{
    // Missing id.
    assert!(
        normalize_responsibility(
            &serde_json::json!({"name": "n", "kind": "reactive", "trigger": {"kind": "reactive"}}),
            0.0
        )
        .is_none()
    );
    // trigger.kind disagrees with declared kind.
    assert!(normalize_responsibility(
        &serde_json::json!({"id": "r1", "name": "n", "kind": "scheduled", "trigger": {"kind": "reactive"}}),
        0.0
    )
    .is_none());
    // Scheduled trigger missing automationId.
    assert!(normalize_responsibility(
        &serde_json::json!({"id": "r1", "name": "n", "kind": "scheduled", "trigger": {"kind": "scheduled"}}),
        0.0
    )
    .is_none());
}

#[test]
fn normalize_responsibility_accepts_a_well_formed_scheduled_responsibility() {
    let value = serde_json::json!({
        "id": "r1",
        "name": "  Nightly sweep  ",
        "kind": "scheduled",
        "trigger": {"kind": "scheduled", "automationId": "a1"},
        "enabled": true,
    });
    let r = normalize_responsibility(&value, 0.0).unwrap();
    assert_eq!(r.name, "Nightly sweep");
    assert!(
        matches!(r.trigger, ResponsibilityTrigger::Scheduled { ref automation_id } if automation_id == "a1")
    );
}

#[test]
fn link_mentu_run_links_only_a_real_run_record_and_leaves_unavailable_evidence_unlinked() {
    let real = serde_json::json!({
        "run": {"value": {"recipe_ref": "recipe-a", "run_id": "run-123"}}
    });
    let link = link_mentu_run(&real, Some("evidence.json".to_string())).unwrap();
    assert_eq!(link.recipe_ref, "recipe-a");
    assert_eq!(link.run_id.as_deref(), Some("run-123"));
    assert_eq!(link.evidence_path.as_deref(), Some("evidence.json"));

    // Falls back to recipe_name when recipe_ref is absent.
    let by_name = serde_json::json!({"run": {"value": {"recipe_name": "recipe-b"}}});
    let link2 = link_mentu_run(&by_name, None).unwrap();
    assert_eq!(link2.recipe_ref, "recipe-b");
    assert_eq!(link2.run_id, None);

    // No "run" key at all (an unavailable Mentu result) -> unlinked, never synthesized.
    let unavailable = serde_json::json!({"error": "mentu unavailable"});
    assert!(link_mentu_run(&unavailable, Some("evidence.json".to_string())).is_none());
}

#[test]
fn create_bot_preserves_multiple_proactive_responsibilities_for_one_persistent_bot() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.responsibilities = vec![
        Responsibility {
            id: "r1".to_string(),
            name: "watch PRs".to_string(),
            instructions: "watch".to_string(),
            kind: ResponsibilityKind::Reactive,
            trigger: ResponsibilityTrigger::Reactive {
                event: Some("pr_opened".to_string()),
            },
            enabled: true,
            recipe: None,
            created_at: 0.0,
            updated_at: 0.0,
        },
        Responsibility {
            id: "r2".to_string(),
            name: "watch issues".to_string(),
            instructions: "watch".to_string(),
            kind: ResponsibilityKind::Reactive,
            trigger: ResponsibilityTrigger::Reactive {
                event: Some("issue_opened".to_string()),
            },
            enabled: true,
            recipe: None,
            created_at: 0.0,
            updated_at: 0.0,
        },
    ];
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();
    let back = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    assert_eq!(back.responsibilities.len(), 2);
    // A later update (session rotation) must not drop either responsibility.
    let rotated = bstorage::rotate_session(&c, HOST, FOLDER, "b1", None, 5.0).unwrap();
    assert_eq!(rotated.responsibilities.len(), 2);
}

// --- Storage: CRUD, scope, migration -------------------------------------

#[test]
fn migrate_is_idempotent_and_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        let c = Connection::open(&path).unwrap();
        automations::storage::migrate(&c).unwrap();
        bstorage::migrate(&c).unwrap();
        bstorage::migrate(&c).unwrap();
        bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    }
    {
        let c = Connection::open(&path).unwrap();
        bstorage::migrate(&c).unwrap();
        let bot = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
        assert_eq!(bot.id, "b1");
    }
}

#[test]
fn migrate_from_a_genuine_v1_bots_schema_applies_the_v2_and_v3_steps_and_preserves_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        let c = Connection::open(&path).unwrap();
        automations::storage::migrate(&c).unwrap();
        // Hand-build a genuine v1 bots database: no `rev` column, no dedupe index.
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             CREATE TABLE bots (
                id TEXT PRIMARY KEY, host_id TEXT NOT NULL, folder TEXT NOT NULL,
                updated_at REAL NOT NULL, payload_json TEXT NOT NULL
             );
             CREATE INDEX bots_scope ON bots(host_id, folder);
             CREATE TABLE bot_responsibility_runs (
                id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, automation_run_id TEXT,
                started_at REAL NOT NULL, payload_json TEXT NOT NULL
             );
             CREATE INDEX bot_responsibility_runs_bot_id ON bot_responsibility_runs(bot_id);
             INSERT INTO schema_versions(component, version) VALUES ('bots', 1);",
        )
        .unwrap();
        c.execute(
            "INSERT INTO bots (id, host_id, folder, updated_at, payload_json) VALUES ('b1', ?1, ?2, 0.0, ?3)",
            rusqlite::params![HOST, FOLDER, serde_json::to_string(&sample_bot("b1", "Alice", 0.0)).unwrap()],
        )
        .unwrap();
    }
    {
        let c = Connection::open(&path).unwrap();
        bstorage::migrate(&c).unwrap();
        let recorded: i64 = c
            .query_row(
                "SELECT version FROM schema_versions WHERE component = 'bots'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(recorded, 3);
        // Pre-existing data survived, and rev is now usable (defaulted to 0).
        let bot = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
        assert_eq!(bot.id, "b1");
        assert_eq!(
            bstorage::current_rev(&c, HOST, FOLDER, "b1").unwrap(),
            Some(0)
        );
        // The dedupe index now exists.
        let index_exists: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'bot_responsibility_runs_dedupe'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(index_exists, 1);
        // The v3 step's bot_messages table now exists and is usable.
        let messages_table_exists: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'bot_messages'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(messages_table_exists, 1);
        assert_eq!(
            bstorage::history_for_bot_messages(&c, HOST, FOLDER, "b1", 50).unwrap(),
            Vec::new()
        );
    }
}

#[test]
fn get_bot_never_reads_across_host_or_folder_scope() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    assert!(
        bstorage::get_bot(&c, "other-host", FOLDER, "b1")
            .unwrap()
            .is_none()
    );
    assert!(
        bstorage::get_bot(&c, HOST, "/other-folder", "b1")
            .unwrap()
            .is_none()
    );
    assert!(bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().is_some());
}

// --- list_bots: locale-aware ordering ------------------------------------

#[test]
fn list_bots_orders_by_display_name_under_the_given_locale() {
    let c = conn();
    // Insertion order deliberately not display-name order.
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b-charlie", "Charlie", 0.0)).unwrap();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b-alice", "alice", 1.0)).unwrap();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b-bob", "Bob", 2.0)).unwrap();
    let names: Vec<String> = bstorage::list_bots(&c, HOST, FOLDER, LOCALE)
        .unwrap()
        .into_iter()
        .map(|b| b.display_identity.display_name)
        .collect();
    assert_eq!(names, vec!["alice", "Bob", "Charlie"]);
}

#[test]
fn list_bots_preserves_insertion_order_for_display_names_the_collator_treats_as_equal() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("first", "dup", 0.0)).unwrap();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("second", "dup", 1.0)).unwrap();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("third", "dup", 2.0)).unwrap();
    let ids: Vec<String> = bstorage::list_bots(&c, HOST, FOLDER, LOCALE)
        .unwrap()
        .into_iter()
        .map(|b| b.id)
        .collect();
    assert_eq!(ids, vec!["first", "second", "third"]);
}

#[test]
fn list_bots_reports_an_invalid_locale_tag_as_an_error_never_a_binary_sort_fallback() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let err = bstorage::list_bots(&c, HOST, FOLDER, "not a locale!!").unwrap_err();
    assert!(matches!(err, bstorage::StorageError::LocaleOrdering(_)));
}

// --- Cross-connection contention -----------------------------------------

#[test]
fn cas_write_detects_a_stale_snapshot_across_two_real_connections_to_the_same_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    let c1 = Connection::open(&path).unwrap();
    automations::storage::migrate(&c1).unwrap();
    bstorage::migrate(&c1).unwrap();
    bstorage::create_bot(&c1, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();

    let c2 = Connection::open(&path).unwrap();
    // c2 reads the row while it is still at rev = 0 (its "stale snapshot").
    let stale_snapshot = bstorage::get_bot(&c2, HOST, FOLDER, "b1").unwrap().unwrap();
    let stale_rev = bstorage::current_rev(&c2, HOST, FOLDER, "b1")
        .unwrap()
        .unwrap();
    assert_eq!(stale_rev, 0);

    // c1 (a genuinely different connection) writes first, moving rev to 1.
    bstorage::update_bot(&c1, HOST, FOLDER, "b1", 5.0, |b| {
        b.instructions = "from c1".to_string()
    })
    .unwrap();

    // c2 now attempts to write using its stale snapshot's rev (0) as the
    // expected value: this must fail as StaleUpdate, not silently overwrite c1's write.
    let mut attempted = stale_snapshot.clone();
    attempted.instructions = "from c2 (stale)".to_string();
    attempted.updated_at = 10.0;
    let err = bstorage::cas_write(&c2, HOST, FOLDER, &attempted, stale_rev).unwrap_err();
    assert!(matches!(err, bstorage::StorageError::StaleUpdate));

    // c1's write must have survived untouched.
    let current = bstorage::get_bot(&c1, HOST, FOLDER, "b1").unwrap().unwrap();
    assert_eq!(current.instructions, "from c1");
    assert_eq!(current.updated_at, 5.0);

    // c2 retries correctly after re-reading the current value: this must succeed.
    let refreshed = bstorage::get_bot(&c2, HOST, FOLDER, "b1").unwrap().unwrap();
    let refreshed_rev = bstorage::current_rev(&c2, HOST, FOLDER, "b1")
        .unwrap()
        .unwrap();
    let mut retried = refreshed.clone();
    retried.instructions = "from c2 (retried)".to_string();
    retried.updated_at = 10.0;
    bstorage::cas_write(&c2, HOST, FOLDER, &retried, refreshed_rev).unwrap();
    let final_state = bstorage::get_bot(&c1, HOST, FOLDER, "b1").unwrap().unwrap();
    assert_eq!(final_state.instructions, "from c2 (retried)");
}

/// The exact bug this bounded correction replaces: keying the CAS
/// discriminant off the caller-supplied `updated_at` timestamp instead of
/// an independent monotonic `rev`. Two connections that happen to compute
/// the *same* new `updated_at` (a deterministic clock, or two writes in
/// the same tick) would leave the old guard column's value numerically
/// unchanged after the first write, so a second connection holding that
/// same stale value would incorrectly pass a `WHERE updated_at =
/// <snapshot>`-style check and silently clobber the first write. `rev`
/// cannot exhibit this: it always advances by exactly 1 regardless of
/// what `updated_at` value either write supplies.
#[test]
fn cas_write_detects_a_same_timestamp_two_connection_clobber_race() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    let c1 = Connection::open(&path).unwrap();
    automations::storage::migrate(&c1).unwrap();
    bstorage::migrate(&c1).unwrap();
    let deterministic_timestamp = 123.456;
    bstorage::create_bot(
        &c1,
        HOST,
        FOLDER,
        &sample_bot("b1", "Alice", deterministic_timestamp),
    )
    .unwrap();

    let c2 = Connection::open(&path).unwrap();
    let c1_snapshot = bstorage::get_bot(&c1, HOST, FOLDER, "b1").unwrap().unwrap();
    let c2_snapshot = bstorage::get_bot(&c2, HOST, FOLDER, "b1").unwrap().unwrap();
    let c1_rev = bstorage::current_rev(&c1, HOST, FOLDER, "b1")
        .unwrap()
        .unwrap();
    let c2_rev = bstorage::current_rev(&c2, HOST, FOLDER, "b1")
        .unwrap()
        .unwrap();
    assert_eq!(
        c1_rev, c2_rev,
        "both connections read the same pre-write rev"
    );

    // Both connections independently compute the exact same new
    // updated_at (a deterministic/mocked clock) -- this is the scenario
    // that broke the old updated_at-keyed CAS.
    let mut from_c1 = c1_snapshot.clone();
    from_c1.instructions = "from c1".to_string();
    from_c1.updated_at = deterministic_timestamp; // unchanged: same tick
    bstorage::cas_write(&c1, HOST, FOLDER, &from_c1, c1_rev).unwrap();

    let mut from_c2 = c2_snapshot.clone();
    from_c2.instructions = "from c2".to_string();
    from_c2.updated_at = deterministic_timestamp; // the SAME value c1 just wrote
    let err = bstorage::cas_write(&c2, HOST, FOLDER, &from_c2, c2_rev).unwrap_err();
    assert!(
        matches!(err, bstorage::StorageError::StaleUpdate),
        "a rev-keyed fence must reject c2's write even though updated_at never numerically changed"
    );

    let current = bstorage::get_bot(&c1, HOST, FOLDER, "b1").unwrap().unwrap();
    assert_eq!(
        current.instructions, "from c1",
        "c1's write must not have been silently clobbered by c2"
    );
}

#[test]
fn cas_write_distinguishes_a_deleted_row_notfound_from_a_changed_row_staleupdate() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let snapshot = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    let rev = bstorage::current_rev(&c, HOST, FOLDER, "b1")
        .unwrap()
        .unwrap();
    bstorage::delete_bot(&c, HOST, FOLDER, "b1").unwrap();
    let mut attempted = snapshot.clone();
    attempted.updated_at = 1.0;
    let err = bstorage::cas_write(&c, HOST, FOLDER, &attempted, rev).unwrap_err();
    assert!(matches!(err, bstorage::StorageError::NotFound("bot")));
}

#[test]
fn rotate_session_never_touches_instructions_memories_character_responsibilities_or_history() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.instructions = "keep me".to_string();
    bot.memories = vec!["m1".to_string()];
    bot.character_preset = "arya".to_string();
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();
    let rotated = bstorage::rotate_session(
        &c,
        HOST,
        FOLDER,
        "b1",
        Some(BotSession {
            session_id: "s2".to_string(),
            harness: "codex".to_string(),
            model: None,
            started_at: 10.0,
            rotated_at: Some(10.0),
        }),
        10.0,
    )
    .unwrap();
    assert_eq!(rotated.instructions, "keep me");
    assert_eq!(rotated.memories, vec!["m1".to_string()]);
    assert_eq!(rotated.character_preset, "arya");
    assert_eq!(rotated.current_session.unwrap().session_id, "s2");
}

// --- create_scheduled_responsibility: one-transaction atomicity ---------

fn sample_automation(id: &str, bot_id: &str) -> automations::records::Automation {
    automations::records::Automation {
        id: id.to_string(),
        creation_key: None,
        name: "sweep".to_string(),
        prompt: "p".to_string(),
        precheck: None,
        agent_id: "codex".to_string(),
        model: None,
        provider: None,
        run_context: None,
        source_context: None,
        project_id: "proj".to_string(),
        execution_target_type: automations::records::ExecutionTargetType::Local,
        execution_target_id: "local".to_string(),
        execution_target_generation: None,
        scheduler_owner: automations::records::SchedulerOwner::LocalHostService,
        workspace_mode: automations::records::WorkspaceMode::Existing,
        workspace_id: None,
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: "UTC".to_string(),
        rrule: "FREQ=DAILY".to_string(),
        dtstart: 0.0,
        enabled: true,
        next_run_at: 100.0,
        last_run_at: None,
        missed_run_policy: automations::records::MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: 30.0,
        created_at: 0.0,
        updated_at: 0.0,
        bot_id: Some(bot_id.to_string()),
    }
}

fn sample_scheduled_responsibility(id: &str, automation_id: &str) -> Responsibility {
    Responsibility {
        id: id.to_string(),
        name: "sweep".to_string(),
        instructions: String::new(),
        kind: ResponsibilityKind::Scheduled,
        trigger: ResponsibilityTrigger::Scheduled {
            automation_id: automation_id.to_string(),
        },
        enabled: true,
        recipe: None,
        created_at: 0.0,
        updated_at: 0.0,
    }
}

#[test]
fn create_scheduled_responsibility_commits_the_automation_and_bot_update_together() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "a1");
    let (bot, _) = bstorage::create_scheduled_responsibility(
        &c,
        HOST,
        FOLDER,
        "b1",
        responsibility,
        automation,
    )
    .unwrap();
    assert_eq!(bot.responsibilities.len(), 1);
    assert!(
        automations::storage::get_automation(&c, "a1")
            .unwrap()
            .is_some()
    );
}

#[test]
fn create_scheduled_responsibility_rejects_a_trigger_automation_id_mismatch_before_any_write() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "WRONG-ID");
    let err = bstorage::create_scheduled_responsibility(
        &c,
        HOST,
        FOLDER,
        "b1",
        responsibility,
        automation,
    )
    .unwrap_err();
    assert!(matches!(err, bstorage::StorageError::OwnershipViolation(_)));
    // No orphan automation was written.
    assert!(
        automations::storage::get_automation(&c, "a1")
            .unwrap()
            .is_none()
    );
}

/// The exact hijack this bounded correction closes: an earlier revision
/// used an upsert for the automation insert inside
/// `create_scheduled_responsibility`, so passing an `id` that already
/// named a foreign-owned (or merely pre-existing) automation would
/// silently overwrite it instead of failing.
#[test]
fn create_scheduled_responsibility_cannot_hijack_an_existing_foreign_automation_id() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b2", "Bob", 0.0)).unwrap();

    let foreign = sample_automation("shared-id", "b2");
    automations::storage::insert_new_automation(&c, &foreign).unwrap();

    let hijack_attempt = sample_automation("shared-id", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "shared-id");
    let err = bstorage::create_scheduled_responsibility(
        &c,
        HOST,
        FOLDER,
        "b1",
        responsibility,
        hijack_attempt,
    )
    .unwrap_err();
    assert!(matches!(err, bstorage::StorageError::AutomationIdCollision));

    // The foreign automation must be completely untouched.
    let survivor = automations::storage::get_automation(&c, "shared-id")
        .unwrap()
        .unwrap();
    assert_eq!(survivor, foreign);
    // b1 must not have gained a responsibility either.
    let bot1 = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    assert!(bot1.responsibilities.is_empty());
}

#[test]
fn create_scheduled_responsibility_cannot_hijack_an_existing_same_id_automation_even_with_the_same_owner()
 {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let existing = sample_automation("a1", "b1");
    automations::storage::insert_new_automation(&c, &existing).unwrap();

    // Same id, same owner, but this must still be treated as a NEW
    // automation create, not an update -- create_scheduled_responsibility
    // is not an update path.
    let mut recreate_attempt = sample_automation("a1", "b1");
    recreate_attempt.name = "different name".to_string();
    let responsibility = sample_scheduled_responsibility("r1", "a1");
    let err = bstorage::create_scheduled_responsibility(
        &c,
        HOST,
        FOLDER,
        "b1",
        responsibility,
        recreate_attempt,
    )
    .unwrap_err();
    assert!(matches!(err, bstorage::StorageError::AutomationIdCollision));
    let survivor = automations::storage::get_automation(&c, "a1")
        .unwrap()
        .unwrap();
    assert_eq!(
        survivor.name, "sweep",
        "the existing automation's fields must not have been replaced"
    );
}

/// A real post-automation-insert SQLite-transaction failure: the
/// automation insert (the transaction's first write) succeeds, then the
/// bot lookup fails (`bot_id` names no real Bot) *after* that insert but
/// *before* commit. Proves the automation insert does not survive --
/// checked against a fresh connection after a genuine close+reopen of the
/// database file, not merely "the in-memory `Result` was an error".
#[test]
fn create_scheduled_responsibility_rolls_back_the_automation_insert_on_a_later_failure_and_stays_absent_after_reopen()
 {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        let c = Connection::open(&path).unwrap();
        automations::storage::migrate(&c).unwrap();
        bstorage::migrate(&c).unwrap();
        // Deliberately do NOT create bot "ghost-bot": the automation insert
        // (first write in the transaction) will succeed, then get_bot_with_rev
        // will fail with NotFound, forcing a rollback of the whole transaction.
        let automation = sample_automation("a1", "ghost-bot");
        let responsibility = sample_scheduled_responsibility("r1", "a1");
        let err = bstorage::create_scheduled_responsibility(
            &c,
            HOST,
            FOLDER,
            "ghost-bot",
            responsibility,
            automation,
        )
        .unwrap_err();
        assert!(matches!(err, bstorage::StorageError::NotFound("bot")));
    }
    {
        // Genuine reopen: a fresh connection, fresh process-level state.
        let c = Connection::open(&path).unwrap();
        assert!(
            automations::storage::get_automation(&c, "a1")
                .unwrap()
                .is_none(),
            "the automation insert must have rolled back with the rest of the transaction"
        );
    }
}

// --- record_responsibility_run: dedup + null-merge semantics -------------

#[test]
fn record_responsibility_run_dedupes_on_automation_run_id_with_null_merge_semantics() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "a1");
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();
    automations::storage::upsert_automation_run(
        &c,
        &automations::records::AutomationRun {
            id: "run-1".to_string(),
            automation_id: "a1".to_string(),
            run_context: None,
            source_context: None,
            title: "t".to_string(),
            scheduled_for: 0.0,
            status: automations::records::AutomationRunStatus::Pending,
            trigger: automations::records::AutomationRunTrigger::Scheduled,
            workspace_id: None,
            workspace_display_name: None,
            session_kind: automations::records::SessionKind::Terminal,
            chat_session_id: None,
            terminal_session_id: None,
            terminal_pane_key: None,
            terminal_pty_id: None,
            output_snapshot: None,
            precheck_result: None,
            usage: None,
            error: None,
            started_at: None,
            dispatched_at: None,
            created_at: 0.0,
            run_number: None,
            occurrence_count: None,
            last_occurrence_at: None,
            session_incarnation: None,
            exit_code: None,
            observed_at: None,
        },
    )
    .unwrap();

    let first = bstorage::record_responsibility_run(
        &c,
        HOST,
        FOLDER,
        ResponsibilityRun {
            id: "run-record-1".to_string(),
            bot_id: "b1".to_string(),
            responsibility_id: "r1".to_string(),
            automation_id: Some("a1".to_string()),
            automation_run_id: Some("run-1".to_string()),
            started_at: 0.0,
            ended_at: None,
            recipe: Some(RecipeLink {
                recipe_ref: "recipe-a".to_string(),
                run_id: None,
                evidence_path: None,
            }),
            host_observation: Some(HostObservation::Live),
            invocation: Some(ResponsibilityRunInvocation::Scheduled),
        },
    )
    .unwrap();
    assert_eq!(first.recipe.as_ref().unwrap().recipe_ref, "recipe-a");

    // A second write with the SAME automation_run_id, ended_at now set, but
    // recipe/host_observation left None -- must dedupe onto the same row id
    // AND preserve the earlier recipe/host_observation (null-merge), not
    // overwrite them with None.
    let merged = bstorage::record_responsibility_run(
        &c,
        HOST,
        FOLDER,
        ResponsibilityRun {
            id: "run-record-2-different-id".to_string(),
            bot_id: "b1".to_string(),
            responsibility_id: "r1".to_string(),
            automation_id: Some("a1".to_string()),
            automation_run_id: Some("run-1".to_string()),
            started_at: 0.0,
            ended_at: Some(99.0),
            recipe: None,
            host_observation: None,
            invocation: None,
        },
    )
    .unwrap();
    assert_eq!(
        merged.id, "run-record-1",
        "must dedupe onto the existing row, not insert a second one"
    );
    assert_eq!(
        merged.ended_at,
        Some(99.0),
        "new non-null ended_at must apply"
    );
    assert_eq!(
        merged.recipe.as_ref().unwrap().recipe_ref,
        "recipe-a",
        "null incoming recipe must preserve the existing value"
    );
    assert_eq!(
        merged.host_observation,
        Some(HostObservation::Live),
        "null incoming host_observation must preserve the existing value"
    );
    assert_eq!(
        merged.invocation,
        Some(ResponsibilityRunInvocation::Scheduled),
        "the merge preserves the existing row's invocation, never the incoming one"
    );
}

/// Genuine two-connection concurrency (real OS threads, not a sequential
/// simulation): two different connections both attempt to record a
/// responsibility run for the *same* `automation_run_id` at the same
/// time. Without the `BEGIN IMMEDIATE` fence + the partial unique index
/// added in schema v2, both could read "no existing row yet" and each
/// insert their own row, producing two rows for one automation run. With
/// the fence, exactly one row survives, and it keeps whichever run's
/// `id` was inserted first (the loser's write becomes a *merge* onto the
/// winner's row, per null-merge semantics) -- proven again after a real
/// reopen.
#[test]
fn record_responsibility_run_is_atomic_across_two_real_concurrent_connections() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        let c = Connection::open(&path).unwrap();
        automations::storage::migrate(&c).unwrap();
        bstorage::migrate(&c).unwrap();
        let mut bot = sample_bot("b1", "Alice", 0.0);
        bot.responsibilities
            .push(sample_scheduled_responsibility("r1", "a1"));
        bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();
        automations::storage::insert_new_automation(&c, &sample_automation("a1", "b1")).unwrap();
        automations::storage::upsert_automation_run(
            &c,
            &automations::records::AutomationRun {
                id: "shared-run".to_string(),
                automation_id: "a1".to_string(),
                run_context: None,
                source_context: None,
                title: "t".to_string(),
                scheduled_for: 0.0,
                status: automations::records::AutomationRunStatus::Pending,
                trigger: automations::records::AutomationRunTrigger::Manual,
                workspace_id: None,
                workspace_display_name: None,
                session_kind: automations::records::SessionKind::Terminal,
                chat_session_id: None,
                terminal_session_id: None,
                terminal_pane_key: None,
                terminal_pty_id: None,
                output_snapshot: None,
                precheck_result: None,
                usage: None,
                error: None,
                started_at: None,
                dispatched_at: None,
                created_at: 0.0,
                run_number: None,
                occurrence_count: None,
                last_occurrence_at: None,
                session_incarnation: None,
                exit_code: None,
                observed_at: None,
            },
        )
        .unwrap();
    }

    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let path_a = path.clone();
    let barrier_a = barrier.clone();
    let thread_a = std::thread::spawn(move || {
        let c = Connection::open(&path_a).unwrap();
        barrier_a.wait();
        bstorage::record_responsibility_run(
            &c,
            HOST,
            FOLDER,
            ResponsibilityRun {
                id: "from-thread-a".to_string(),
                bot_id: "b1".to_string(),
                responsibility_id: "r1".to_string(),
                automation_id: Some("a1".to_string()),
                automation_run_id: Some("shared-run".to_string()),
                started_at: 0.0,
                ended_at: None,
                recipe: Some(RecipeLink {
                    recipe_ref: "from-a".to_string(),
                    run_id: None,
                    evidence_path: None,
                }),
                host_observation: None,
                invocation: None,
            },
        )
    });
    let path_b = path.clone();
    let barrier_b = barrier.clone();
    let thread_b = std::thread::spawn(move || {
        let c = Connection::open(&path_b).unwrap();
        barrier_b.wait();
        bstorage::record_responsibility_run(
            &c,
            HOST,
            FOLDER,
            ResponsibilityRun {
                id: "from-thread-b".to_string(),
                bot_id: "b1".to_string(),
                responsibility_id: "r1".to_string(),
                automation_id: Some("a1".to_string()),
                automation_run_id: Some("shared-run".to_string()),
                started_at: 0.0,
                ended_at: Some(42.0),
                recipe: None,
                host_observation: None,
                invocation: None,
            },
        )
    });
    thread_a.join().unwrap().unwrap();
    thread_b.join().unwrap().unwrap();

    // Reopen with a fresh connection: exactly one row for this pair.
    let c = Connection::open(&path).unwrap();
    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    let matching: Vec<_> = history
        .iter()
        .filter(|h| h.responsibility_run.automation_run_id.as_deref() == Some("shared-run"))
        .collect();
    assert_eq!(
        matching.len(),
        1,
        "the unique fence must prevent two rows for the same automation_run_id"
    );
    let winner_id = matching[0].responsibility_run.id.clone();
    assert!(
        winner_id == "from-thread-a" || winner_id == "from-thread-b",
        "the surviving id must be one of the two original ids, never a third value"
    );
    // Whichever thread's write landed first, the loser's write must have
    // MERGED onto it (ended_at from thread-b, recipe from thread-a),
    // never simply been discarded or overwritten wholesale.
    assert_eq!(matching[0].responsibility_run.ended_at, Some(42.0));
    assert_eq!(
        matching[0]
            .responsibility_run
            .recipe
            .as_ref()
            .unwrap()
            .recipe_ref,
        "from-a"
    );
}

#[test]
fn record_responsibility_run_with_no_automation_run_id_never_dedupes() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.responsibilities.push(Responsibility {
        id: "r1".to_string(),
        name: "reactive".to_string(),
        instructions: String::new(),
        kind: ResponsibilityKind::Reactive,
        trigger: ResponsibilityTrigger::Reactive { event: None },
        enabled: true,
        recipe: None,
        created_at: 0.0,
        updated_at: 0.0,
    });
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();

    for i in 0..2 {
        bstorage::record_responsibility_run(
            &c,
            HOST,
            FOLDER,
            ResponsibilityRun {
                id: format!("run-{i}"),
                bot_id: "b1".to_string(),
                responsibility_id: "r1".to_string(),
                automation_id: None,
                automation_run_id: None,
                started_at: i as f64,
                ended_at: None,
                recipe: None,
                host_observation: None,
                invocation: None,
            },
        )
        .unwrap();
    }
    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    assert_eq!(
        history.len(),
        2,
        "each run without an automationRunId must insert a distinct row"
    );
}

// --- History: newest-first, orphan-safe -----------------------------------

#[test]
fn history_for_bot_is_newest_first_with_null_joins_for_orphans() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.responsibilities.push(Responsibility {
        id: "r1".to_string(),
        name: "reactive".to_string(),
        instructions: String::new(),
        kind: ResponsibilityKind::Reactive,
        trigger: ResponsibilityTrigger::Reactive { event: None },
        enabled: true,
        recipe: None,
        created_at: 0.0,
        updated_at: 0.0,
    });
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();
    for (id, started_at) in [("run-old", 1.0), ("run-new", 2.0)] {
        bstorage::record_responsibility_run(
            &c,
            HOST,
            FOLDER,
            ResponsibilityRun {
                id: id.to_string(),
                bot_id: "b1".to_string(),
                responsibility_id: "r1".to_string(),
                automation_id: None,
                automation_run_id: None,
                started_at,
                ended_at: None,
                recipe: None,
                host_observation: None,
                invocation: None,
            },
        )
        .unwrap();
    }
    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    let ids: Vec<&str> = history
        .iter()
        .map(|h| h.responsibility_run.id.as_str())
        .collect();
    assert_eq!(ids, vec!["run-new", "run-old"]);
    assert!(
        history[0].automation.is_none(),
        "no automation_id -> no synthesized automation"
    );
    assert!(history[0].responsibility.is_some());
}

// --- Deletion semantics ----------------------------------------------------

#[test]
fn delete_bot_removes_owned_automations_with_their_runs_but_preserves_responsibility_history() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "a1");
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();
    automations::storage::upsert_automation_run(
        &c,
        &automations::records::AutomationRun {
            id: "run-1".to_string(),
            automation_id: "a1".to_string(),
            run_context: None,
            source_context: None,
            title: "t".to_string(),
            scheduled_for: 0.0,
            status: automations::records::AutomationRunStatus::Pending,
            trigger: automations::records::AutomationRunTrigger::Scheduled,
            workspace_id: None,
            workspace_display_name: None,
            session_kind: automations::records::SessionKind::Terminal,
            chat_session_id: None,
            terminal_session_id: None,
            terminal_pane_key: None,
            terminal_pty_id: None,
            output_snapshot: None,
            precheck_result: None,
            usage: None,
            error: None,
            started_at: None,
            dispatched_at: None,
            created_at: 0.0,
            run_number: None,
            occurrence_count: None,
            last_occurrence_at: None,
            session_incarnation: None,
            exit_code: None,
            observed_at: None,
        },
    )
    .unwrap();
    bstorage::record_responsibility_run(
        &c,
        HOST,
        FOLDER,
        ResponsibilityRun {
            id: "run-record-1".to_string(),
            bot_id: "b1".to_string(),
            responsibility_id: "r1".to_string(),
            automation_id: Some("a1".to_string()),
            automation_run_id: Some("run-1".to_string()),
            started_at: 0.0,
            ended_at: None,
            recipe: None,
            host_observation: None,
            invocation: Some(ResponsibilityRunInvocation::Manual),
        },
    )
    .unwrap();

    assert!(bstorage::delete_bot(&c, HOST, FOLDER, "b1").unwrap());
    assert!(bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().is_none());
    assert!(
        automations::storage::get_automation(&c, "a1")
            .unwrap()
            .is_none(),
        "the owned automation must be deleted with the Bot, never stranded ownerless"
    );
    assert!(
        automations::storage::get_automation_run(&c, "run-1")
            .unwrap()
            .is_none(),
        "the owned automation's runs go with it"
    );
    // The responsibility run survives as orphaned evidence with null joins.
    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    assert_eq!(history.len(), 1);
    assert!(history[0].responsibility.is_none());
    assert!(history[0].automation.is_none());
    assert!(history[0].automation_run.is_none());
    assert_eq!(
        history[0].responsibility_run.invocation,
        Some(ResponsibilityRunInvocation::Manual)
    );
    // A missing Bot is not an error, just `false`.
    assert!(!bstorage::delete_bot(&c, HOST, FOLDER, "b1").unwrap());
}

#[test]
fn delete_automation_everywhere_removes_every_bot_scheduled_responsibility_that_referenced_it() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "a1");
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    assert!(bstorage::delete_automation_everywhere(&c, "a1", None).unwrap());
    assert!(
        automations::storage::get_automation(&c, "a1")
            .unwrap()
            .is_none()
    );
    let bot = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    assert!(bot.responsibilities.is_empty());
}

// --- delete_automation_everywhere: Bot-ownership precondition, required
//     before mutation (NOT the source's SSH host-authority
//     assertAutomationOwnerFence -- see automations::storage's module doc
//     and the native-state evidence's mandatory follow-on gate) ---------

#[test]
fn delete_automation_everywhere_rejects_a_foreign_owner_expectation_before_any_mutation() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "a1");
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let err = bstorage::delete_automation_everywhere(
        &c,
        "a1",
        Some(AutomationOwnerPrecondition::Owned(
            "some-other-bot".to_string(),
        )),
    )
    .unwrap_err();
    assert!(matches!(
        err,
        bstorage::StorageError::AutomationOwnerConflict
    ));
    assert!(
        automations::storage::get_automation(&c, "a1")
            .unwrap()
            .is_some(),
        "must not delete on a rejected fence"
    );
    let bot = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    assert_eq!(
        bot.responsibilities.len(),
        1,
        "must not touch responsibilities on a rejected fence either"
    );
}

#[test]
fn delete_automation_everywhere_rejects_a_missing_automation_when_an_owner_is_expected() {
    let c = conn();
    let err = bstorage::delete_automation_everywhere(
        &c,
        "does-not-exist",
        Some(AutomationOwnerPrecondition::Owned("b1".to_string())),
    )
    .unwrap_err();
    assert!(matches!(
        err,
        bstorage::StorageError::NotFound("automation")
    ));
}

#[test]
fn delete_automation_everywhere_succeeds_when_the_expected_owner_matches() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "a1");
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();
    assert!(
        bstorage::delete_automation_everywhere(
            &c,
            "a1",
            Some(AutomationOwnerPrecondition::Owned("b1".to_string()))
        )
        .unwrap()
    );
}

#[test]
fn delete_automation_everywhere_detects_ownership_changed_by_a_concurrent_connection() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    let c1 = Connection::open(&path).unwrap();
    automations::storage::migrate(&c1).unwrap();
    bstorage::migrate(&c1).unwrap();
    bstorage::create_bot(&c1, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    bstorage::create_bot(&c1, HOST, FOLDER, &sample_bot("b2", "Bob", 0.0)).unwrap();
    automations::storage::insert_new_automation(&c1, &sample_automation("a1", "b1")).unwrap();

    // Caller opens a second connection and believes b1 owns it (as read moments ago).
    let c2 = Connection::open(&path).unwrap();
    let believed_owner = AutomationOwnerPrecondition::Owned("b1".to_string());

    // c1 (a different connection) reassigns ownership to b2 in the meantime.
    let mut reassigned = automations::storage::get_automation(&c1, "a1")
        .unwrap()
        .unwrap();
    reassigned.bot_id = Some("b2".to_string());
    automations::storage::upsert_automation(&c1, &reassigned).unwrap();

    let err = bstorage::delete_automation_everywhere(&c2, "a1", Some(believed_owner)).unwrap_err();
    assert!(matches!(
        err,
        bstorage::StorageError::AutomationOwnerConflict
    ));
    assert!(
        automations::storage::get_automation(&c1, "a1")
            .unwrap()
            .is_some()
    );
}

/// Deterministic WAL-mode contention coverage for the owner fence (no
/// threads, no sleeps): production `db::open` runs WAL, where a writer CAN
/// commit between another connection's read snapshot and its write
/// attempt. Sequenced explicitly: c2 takes the ownership snapshot the
/// fence would use, c1 commits a reassignment while that snapshot is open
/// (possible only in WAL), and c2's stale-snapshot write must FAIL CLOSED
/// with a SQLite busy/snapshot error (full rollback, no partial state) --
/// not proceed on the stale read. A change that lands BEFORE the caller's
/// read, by contrast, gets the documented structured
/// `AutomationOwnerConflict` through the real `delete_automation_everywhere`.
#[test]
fn wal_mode_ownership_change_during_a_stale_snapshot_fails_closed_not_with_a_structured_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    let c1 = Connection::open(&path).unwrap();
    // Match production's journal mode (see `db::open`).
    c1.pragma_update(None, "journal_mode", "WAL").unwrap();
    automations::storage::migrate(&c1).unwrap();
    bstorage::migrate(&c1).unwrap();
    bstorage::create_bot(&c1, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    bstorage::create_bot(&c1, HOST, FOLDER, &sample_bot("b2", "Bob", 0.0)).unwrap();
    automations::storage::insert_new_automation(&c1, &sample_automation("a1", "b1")).unwrap();

    let c2 = Connection::open(&path).unwrap();
    c2.pragma_update(None, "journal_mode", "WAL").unwrap();

    // c2 opens a read transaction and takes the snapshot the fence reads.
    let c2_tx = c2.unchecked_transaction().unwrap();
    let snapshot = automations::storage::get_automation(&c2_tx, "a1")
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.bot_id.as_deref(), Some("b1"));

    // c1 commits an ownership change while c2's read snapshot is still open.
    let mut reassigned = automations::storage::get_automation(&c1, "a1")
        .unwrap()
        .unwrap();
    reassigned.bot_id = Some("b2".to_string());
    automations::storage::upsert_automation(&c1, &reassigned).unwrap();

    // c2 writing through the now-stale snapshot must fail closed with a
    // SQLite busy/snapshot error, never a silent overwrite of c1's change.
    let mut stale = snapshot.clone();
    stale.bot_id = None;
    let err = automations::storage::upsert_automation(&c2_tx, &stale).unwrap_err();
    match err {
        automations::storage::StorageError::Sqlite(rusqlite::Error::SqliteFailure(e, _)) => {
            assert_eq!(
                e.code,
                rusqlite::ErrorCode::DatabaseBusy,
                "WAL snapshot invalidation must surface as a fail-closed busy error"
            );
        }
        other => panic!("expected a fail-closed sqlite busy error, got: {other:?}"),
    }
    drop(c2_tx); // the failed attempt's transaction rolls back

    // c1's committed change survived untouched.
    let survivor = automations::storage::get_automation(&c1, "a1")
        .unwrap()
        .unwrap();
    assert_eq!(survivor.bot_id.as_deref(), Some("b2"));

    // Once the change lands BEFORE the caller's read, the documented
    // structured refusal applies through the real deletion entry point.
    let believed_owner = AutomationOwnerPrecondition::Owned("b1".to_string());
    let err = bstorage::delete_automation_everywhere(&c2, "a1", Some(believed_owner)).unwrap_err();
    assert!(matches!(
        err,
        bstorage::StorageError::AutomationOwnerConflict
    ));
    assert!(
        automations::storage::get_automation(&c1, "a1")
            .unwrap()
            .is_some()
    );
}

// --- Cross-scope isolation: delete_automation_everywhere must clean every
//     scope; migrate_ownership must never touch another scope's Bots. ----

const OTHER_HOST: &str = "host-2";
const OTHER_FOLDER: &str = "/other-repo";

#[test]
fn delete_automation_everywhere_cleans_dangling_projections_in_every_scope_not_just_one() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    bstorage::create_bot(&c, OTHER_HOST, OTHER_FOLDER, &sample_bot("b2", "Bob", 0.0)).unwrap();

    // The SAME automation id is (unusually, but the schema allows it since
    // Automation has no host/folder column at all) referenced by scheduled
    // responsibilities in two different scopes.
    automations::storage::insert_new_automation(&c, &sample_automation("a1", "b1")).unwrap();
    let mut with_r1 = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    with_r1
        .responsibilities
        .push(sample_scheduled_responsibility("r1", "a1"));
    let rev1 = bstorage::current_rev(&c, HOST, FOLDER, "b1")
        .unwrap()
        .unwrap();
    bstorage::cas_write(&c, HOST, FOLDER, &with_r1, rev1).unwrap();

    let mut with_r2 = bstorage::get_bot(&c, OTHER_HOST, OTHER_FOLDER, "b2")
        .unwrap()
        .unwrap();
    with_r2
        .responsibilities
        .push(sample_scheduled_responsibility("r2", "a1"));
    let rev2 = bstorage::current_rev(&c, OTHER_HOST, OTHER_FOLDER, "b2")
        .unwrap()
        .unwrap();
    bstorage::cas_write(&c, OTHER_HOST, OTHER_FOLDER, &with_r2, rev2).unwrap();

    assert!(bstorage::delete_automation_everywhere(&c, "a1", None).unwrap());

    let bot1_after = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    let bot2_after = bstorage::get_bot(&c, OTHER_HOST, OTHER_FOLDER, "b2")
        .unwrap()
        .unwrap();
    assert!(
        bot1_after.responsibilities.is_empty(),
        "scope A's dangling projection must be cleared"
    );
    assert!(
        bot2_after.responsibilities.is_empty(),
        "scope B's dangling projection must ALSO be cleared -- this is the bug this correction fixes"
    );
}

#[test]
fn migrate_ownership_never_clears_an_automation_owned_by_a_bot_in_a_different_scope() {
    let c = conn();
    // b1 lives in a DIFFERENT scope and legitimately owns a1 (no responsibility
    // needed for this test -- migrate_ownership must never even consider it,
    // since it must not read across scope at all).
    bstorage::create_bot(
        &c,
        OTHER_HOST,
        OTHER_FOLDER,
        &sample_bot("b1", "Alice", 0.0),
    )
    .unwrap();
    automations::storage::insert_new_automation(&c, &sample_automation("a1", "b1")).unwrap();

    // A completely unrelated Bot exists in the scope migrate_ownership is
    // actually asked to repair.
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b2", "Bob", 0.0)).unwrap();

    bstorage::migrate_ownership(&c, HOST, FOLDER).unwrap();

    let a1_after = automations::storage::get_automation(&c, "a1")
        .unwrap()
        .unwrap();
    assert_eq!(
        a1_after.bot_id.as_deref(),
        Some("b1"),
        "an automation owned by a Bot in a different scope must be left completely untouched"
    );
}

#[test]
fn migrate_ownership_still_clears_a_dangling_owner_that_is_in_scope() {
    let c = conn();
    // b1 IS in this scope, and a1.bot_id claims b1, but b1 has no
    // responsibility actually referencing a1 -- a genuine in-scope dangling
    // owner, which migrate_ownership is entitled (and expected) to clear.
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    automations::storage::insert_new_automation(&c, &sample_automation("a1", "b1")).unwrap();

    bstorage::migrate_ownership(&c, HOST, FOLDER).unwrap();

    let a1_after = automations::storage::get_automation(&c, "a1")
        .unwrap()
        .unwrap();
    assert_eq!(
        a1_after.bot_id, None,
        "an in-scope dangling owner must still be cleared"
    );
}

// --- Ownership repair: first-Bot-wins, source-order preserving ----------

#[test]
fn migrate_ownership_resolves_conflicting_claims_with_first_bot_wins_by_insertion_order() {
    let c = conn();
    // Two Bots both claim the same automation via a scheduled responsibility
    // (a legacy-data conflict); the earlier-inserted Bot must win.
    let automation = sample_automation("a1", "b1");
    automations::storage::upsert_automation(&c, &automation).unwrap();

    let mut bot1 = sample_bot("b1", "Alice", 0.0);
    bot1.responsibilities
        .push(sample_scheduled_responsibility("r1", "a1"));
    bstorage::create_bot(&c, HOST, FOLDER, &bot1).unwrap();

    let mut bot2 = sample_bot("b2", "Bob", 1.0);
    bot2.responsibilities
        .push(sample_scheduled_responsibility("r2", "a1"));
    bstorage::create_bot(&c, HOST, FOLDER, &bot2).unwrap();

    bstorage::migrate_ownership(&c, HOST, FOLDER).unwrap();

    let resolved = automations::storage::get_automation(&c, "a1")
        .unwrap()
        .unwrap();
    assert_eq!(
        resolved.bot_id.as_deref(),
        Some("b1"),
        "first (earlier-inserted) Bot must keep ownership"
    );
    let bot1_after = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    let bot2_after = bstorage::get_bot(&c, HOST, FOLDER, "b2").unwrap().unwrap();
    assert_eq!(
        bot1_after.responsibilities.len(),
        1,
        "the winning Bot keeps its scheduled responsibility"
    );
    assert!(
        bot2_after.responsibilities.is_empty(),
        "the losing Bot's conflicting responsibility is dropped"
    );
}

#[test]
fn migrate_ownership_drops_a_scheduled_responsibility_whose_automation_is_missing() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.responsibilities
        .push(sample_scheduled_responsibility("r1", "does-not-exist"));
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();
    bstorage::migrate_ownership(&c, HOST, FOLDER).unwrap();
    let after = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    assert!(after.responsibilities.is_empty());
}

/// A corrupt automation payload must fail the whole ownership repair and
/// roll it back, never silently commit a Bot whose scheduled responsibility
/// was dropped because an unreadable automation temporarily *looked*
/// missing. (Review context: the old retain-closure coerced the lookup
/// error into "missing", but within the same transaction the later
/// `list_all_automations()?` repeats the failure, so the transaction is
/// dropped and rolls back — this test pins that full-rollback guarantee as
/// explicit coverage.)
#[test]
fn migrate_ownership_rolls_back_completely_when_an_automation_payload_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        let c = Connection::open(&path).unwrap();
        automations::storage::migrate(&c).unwrap();
        bstorage::migrate(&c).unwrap();
        let mut bot = sample_bot("b1", "Alice", 0.0);
        bot.responsibilities
            .push(sample_scheduled_responsibility("r1", "a1"));
        bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();
        // Hand-plant an automation row whose payload is not JSON at all.
        c.execute(
            "INSERT INTO automations (id, bot_id, payload_json) VALUES ('a1', 'b1', 'NOT JSON{')",
            [],
        )
        .unwrap();
    }
    {
        let c = Connection::open(&path).unwrap();
        let err = bstorage::migrate_ownership(&c, HOST, FOLDER).unwrap_err();
        assert!(
            matches!(
                err,
                bstorage::StorageError::Json(_) | bstorage::StorageError::Sqlite(_)
            ),
            "the corrupt payload must surface as an error, got: {err:?}"
        );
    }
    {
        // Genuine reopen: nothing the failed repair attempted may survive.
        let c = Connection::open(&path).unwrap();
        let bot = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
        assert_eq!(
            bot.responsibilities.len(),
            1,
            "the scheduled responsibility must NOT have been durably dropped by the failed repair"
        );
        let still_corrupt: String = c
            .query_row(
                "SELECT payload_json FROM automations WHERE id = 'a1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            still_corrupt, "NOT JSON{",
            "the corrupt row itself is untouched"
        );
    }
}
