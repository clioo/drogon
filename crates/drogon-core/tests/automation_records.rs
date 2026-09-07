//! Parity tests for the native `Automation`/`AutomationRun` records and
//! their SQLite storage (`crate::automations::{records, storage}`, not yet
//! registered by root -- see `docs/migration/native-bot-state-contract.md`
//! and `tests/parity/ports/WP-CAP-BOTS/native-state/`).
//!
//! Field shapes/behavior are pinned against
//! `src/shared/automations-types.ts` and
//! `src/main/persistence/scheduling-automations/automation-definition-operations.ts`
//! at source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, verified
//! directly via `git -C <checkout> show <rev>:<path>` from this repository's
//! own cwd (never the reference checkout as cwd) -- see the native-state
//! evidence for exact digests/line numbers.
#![allow(dead_code)]

use drogon_core::automations::records;
use drogon_core::automations::storage;
use records::*;
use rusqlite::Connection;
use storage::{AutomationOwnerPrecondition, StorageError};

fn conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    storage::migrate(&conn).unwrap();
    conn
}

fn sample_automation(id: &str, bot_id: Option<&str>) -> Automation {
    Automation {
        id: id.to_string(),
        creation_key: None,
        name: "nightly sweep".to_string(),
        prompt: "do the thing".to_string(),
        precheck: None,
        agent_id: "codex".to_string(),
        run_context: None,
        source_context: None,
        project_id: "proj-1".to_string(),
        execution_target_type: ExecutionTargetType::Local,
        execution_target_id: "local".to_string(),
        execution_target_generation: None,
        scheduler_owner: SchedulerOwner::LocalHostService,
        workspace_mode: WorkspaceMode::Existing,
        workspace_id: None,
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: "UTC".to_string(),
        rrule: "FREQ=DAILY".to_string(),
        dtstart: 0.0,
        enabled: true,
        next_run_at: 1000.0,
        last_run_at: None,
        missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: 30.0,
        created_at: 0.0,
        updated_at: 0.0,
        bot_id: bot_id.map(str::to_string),
    }
}

fn sample_run(id: &str, automation_id: &str) -> AutomationRun {
    AutomationRun {
        id: id.to_string(),
        automation_id: automation_id.to_string(),
        run_context: None,
        source_context: None,
        title: "run title".to_string(),
        scheduled_for: 1000.0,
        status: AutomationRunStatus::Pending,
        trigger: AutomationRunTrigger::Scheduled,
        workspace_id: None,
        workspace_display_name: None,
        session_kind: SessionKind::Terminal,
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
    }
}

// --- Absent vs. null field semantics -------------------------------------

#[test]
fn optional_non_nullable_fields_are_absent_from_json_when_none() {
    let a = sample_automation("a1", None);
    let json = serde_json::to_value(&a).unwrap();
    let obj = json.as_object().unwrap();
    assert!(
        !obj.contains_key("creationKey"),
        "creationKey must be absent, not null, when None"
    );
    assert!(
        !obj.contains_key("botId"),
        "botId must be absent, not null, when None"
    );
    assert!(!obj.contains_key("executionTargetGeneration"));
    assert!(!obj.contains_key("setupDecision"));
    assert!(!obj.contains_key("lastRunAt"));
}

#[test]
fn required_nullable_fields_are_explicit_json_null_when_none() {
    let a = sample_automation("a1", None);
    let json = serde_json::to_value(&a).unwrap();
    let obj = json.as_object().unwrap();
    assert_eq!(obj.get("precheck"), Some(&serde_json::Value::Null));
    assert_eq!(obj.get("workspaceId"), Some(&serde_json::Value::Null));
    assert_eq!(obj.get("baseBranch"), Some(&serde_json::Value::Null));

    let run = sample_run("r1", "a1");
    let rjson = serde_json::to_value(&run).unwrap();
    let robj = rjson.as_object().unwrap();
    for key in [
        "workspaceId",
        "chatSessionId",
        "terminalSessionId",
        "terminalPaneKey",
        "terminalPtyId",
        "outputSnapshot",
        "precheckResult",
        "usage",
        "error",
        "startedAt",
        "dispatchedAt",
    ] {
        assert_eq!(
            robj.get(key),
            Some(&serde_json::Value::Null),
            "{key} must be explicit null, not absent"
        );
    }
}

#[test]
fn optional_and_nullable_fields_distinguish_absent_null_and_value() {
    let mut a = sample_automation("a1", None);
    // Absent (outer None).
    let json_absent = serde_json::to_value(&a).unwrap();
    assert!(!json_absent.as_object().unwrap().contains_key("runContext"));

    // Explicit null (outer Some(None)).
    a.run_context = Some(None);
    let json_null = serde_json::to_value(&a).unwrap();
    assert_eq!(
        json_null.as_object().unwrap().get("runContext"),
        Some(&serde_json::Value::Null)
    );

    // Present value (outer Some(Some(v))).
    a.run_context = Some(Some(serde_json::json!({"projectId": "p"})));
    let json_value = serde_json::to_value(&a).unwrap();
    assert_eq!(
        json_value.as_object().unwrap().get("runContext"),
        Some(&serde_json::json!({"projectId": "p"}))
    );

    // Round-trips back through all three states.
    let de_absent: Automation = serde_json::from_value(json_absent).unwrap();
    assert_eq!(de_absent.run_context, None);
    let de_null: Automation = serde_json::from_value(json_null).unwrap();
    assert_eq!(de_null.run_context, Some(None));
    let de_value: Automation = serde_json::from_value(json_value).unwrap();
    assert_eq!(
        de_value.run_context,
        Some(Some(serde_json::json!({"projectId": "p"})))
    );
}

#[test]
fn unavailable_reason_round_trips_as_the_closed_seven_value_enum() {
    for reason in [
        AutomationRunUsageUnavailableReason::RunNotFinished,
        AutomationRunUsageUnavailableReason::ProviderUnsupported,
        AutomationRunUsageUnavailableReason::RemoteUsageUnavailable,
        AutomationRunUsageUnavailableReason::UsageNotEnabled,
        AutomationRunUsageUnavailableReason::ScanFailed,
        AutomationRunUsageUnavailableReason::NoMatchingSession,
        AutomationRunUsageUnavailableReason::AmbiguousSession,
    ] {
        let usage = AutomationRunUsage {
            status: AutomationRunUsageStatus::Unavailable,
            provider: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            reasoning_output_tokens: None,
            total_tokens: None,
            estimated_cost_usd: None,
            estimated_cost_source: None,
            provider_session_id: None,
            attribution: None,
            collected_at: 0.0,
            unavailable_reason: Some(reason),
            unavailable_message: None,
        };
        let json = serde_json::to_string(&usage).unwrap();
        let back: AutomationRunUsage = serde_json::from_str(&json).unwrap();
        assert_eq!(back.unavailable_reason, Some(reason));
    }
    // An unrecognized 8th value is a hard deserialize error, not silently accepted.
    let bad = r#"{"status":"unavailable","provider":null,"model":null,"inputTokens":null,"outputTokens":null,"cacheReadTokens":null,"cacheWriteTokens":null,"reasoningOutputTokens":null,"totalTokens":null,"estimatedCostUsd":null,"estimatedCostSource":null,"providerSessionId":null,"attribution":null,"collectedAt":0.0,"unavailableReason":"made_up_value","unavailableMessage":null}"#;
    assert!(serde_json::from_str::<AutomationRunUsage>(bad).is_err());
}

#[test]
fn belongs_to_bot_matches_source_automation_belongs_to_bot() {
    let owned = sample_automation("a1", Some("bot-1"));
    let unowned = sample_automation("a2", None);
    assert!(owned.belongs_to_bot("bot-1"));
    assert!(!owned.belongs_to_bot("bot-2"));
    assert!(!unowned.belongs_to_bot("bot-1"));
}

// --- Storage: migration, CRUD, cascade semantics -------------------------

#[test]
fn migrate_is_idempotent_and_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        let conn = Connection::open(&path).unwrap();
        storage::migrate(&conn).unwrap();
        storage::migrate(&conn).unwrap(); // idempotent within the same connection
        storage::upsert_automation(&conn, &sample_automation("a1", None)).unwrap();
    }
    {
        // Reopen: migrate again must be a no-op and the row must survive.
        let conn = Connection::open(&path).unwrap();
        storage::migrate(&conn).unwrap();
        let a = storage::get_automation(&conn, "a1").unwrap().unwrap();
        assert_eq!(a.id, "a1");
    }
}

#[test]
fn migrate_refuses_a_future_schema_version_without_touching_tables() {
    let conn = conn();
    conn.execute(
        "UPDATE schema_versions SET version = version + 1 WHERE component = 'automations'",
        [],
    )
    .unwrap();
    let err = storage::migrate(&conn).unwrap_err();
    assert!(matches!(
        err,
        StorageError::UnsupportedSchemaVersion {
            component: "automations",
            ..
        }
    ));
}

#[test]
fn upsert_and_get_round_trip_every_field_via_json_payload() {
    let conn = conn();
    let a = sample_automation("a1", Some("bot-1"));
    storage::upsert_automation(&conn, &a).unwrap();
    let back = storage::get_automation(&conn, "a1").unwrap().unwrap();
    assert_eq!(back, a);
}

#[test]
fn list_automations_owned_by_bot_filters_by_bot_id() {
    let conn = conn();
    storage::upsert_automation(&conn, &sample_automation("a1", Some("bot-1"))).unwrap();
    storage::upsert_automation(&conn, &sample_automation("a2", Some("bot-2"))).unwrap();
    storage::upsert_automation(&conn, &sample_automation("a3", None)).unwrap();
    let owned = storage::list_automations_owned_by_bot(&conn, "bot-1").unwrap();
    assert_eq!(
        owned.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
        vec!["a1"]
    );
}

#[test]
fn clear_automation_owner_strips_only_bot_id() {
    let conn = conn();
    let a = sample_automation("a1", Some("bot-1"));
    storage::upsert_automation(&conn, &a).unwrap();
    storage::clear_automation_owner(&conn, "a1").unwrap();
    let back = storage::get_automation(&conn, "a1").unwrap().unwrap();
    assert_eq!(back.bot_id, None);
    assert_eq!(back.name, a.name, "every other field must be untouched");
}

#[test]
fn delete_automation_cascades_its_own_runs() {
    let conn = conn();
    storage::upsert_automation(&conn, &sample_automation("a1", None)).unwrap();
    storage::upsert_automation_run(&conn, &sample_run("r1", "a1")).unwrap();
    storage::upsert_automation_run(&conn, &sample_run("r2", "a1")).unwrap();
    assert!(storage::delete_automation(&conn, "a1", None).unwrap());
    assert!(storage::get_automation(&conn, "a1").unwrap().is_none());
    assert!(
        storage::list_automation_runs(&conn, "a1")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn delete_automation_returns_false_for_a_missing_id_with_no_expected_owner() {
    let conn = conn();
    assert!(!storage::delete_automation(&conn, "does-not-exist", None).unwrap());
}

// --- insert_new_automation: hijack prevention ----------------------------

#[test]
fn insert_new_automation_fails_on_id_collision_instead_of_overwriting() {
    let conn = conn();
    let original = sample_automation("a1", Some("bot-1"));
    storage::insert_new_automation(&conn, &original).unwrap();

    let mut hijack_attempt = sample_automation("a1", Some("bot-2"));
    hijack_attempt.name = "hijacked".to_string();
    let err = storage::insert_new_automation(&conn, &hijack_attempt).unwrap_err();
    assert!(matches!(err, StorageError::IdCollision));

    let survivor = storage::get_automation(&conn, "a1").unwrap().unwrap();
    assert_eq!(
        survivor, original,
        "the original automation must be completely untouched"
    );
}

// --- Bot-ownership precondition (NOT the source's SSH host-authority
//     assertAutomationOwnerFence -- see the module doc): missing/foreign
//     Bot owners, two-connection contention -----------------------------

#[test]
fn delete_automation_with_no_expected_owner_never_checks_ownership() {
    let conn = conn();
    storage::upsert_automation(&conn, &sample_automation("a1", Some("bot-1"))).unwrap();
    assert!(storage::delete_automation(&conn, "a1", None).unwrap());
}

#[test]
fn delete_automation_rejects_a_missing_automation_when_an_owner_is_expected() {
    let conn = conn();
    let err = storage::delete_automation(
        &conn,
        "does-not-exist",
        Some(&AutomationOwnerPrecondition::Owned("bot-1".to_string())),
    )
    .unwrap_err();
    assert!(matches!(err, StorageError::NotFound("automation")));
}

#[test]
fn delete_automation_rejects_a_foreign_owner_mismatch() {
    let conn = conn();
    storage::upsert_automation(&conn, &sample_automation("a1", Some("bot-1"))).unwrap();
    let err = storage::delete_automation(
        &conn,
        "a1",
        Some(&AutomationOwnerPrecondition::Owned("bot-2".to_string())),
    )
    .unwrap_err();
    assert!(matches!(err, StorageError::OwnerConflict));
    assert!(
        storage::get_automation(&conn, "a1").unwrap().is_some(),
        "a rejected delete must not touch the row"
    );
}

#[test]
fn delete_automation_rejects_unowned_expectation_against_an_owned_automation() {
    let conn = conn();
    storage::upsert_automation(&conn, &sample_automation("a1", Some("bot-1"))).unwrap();
    let err = storage::delete_automation(&conn, "a1", Some(&AutomationOwnerPrecondition::Unowned))
        .unwrap_err();
    assert!(matches!(err, StorageError::OwnerConflict));
}

#[test]
fn delete_automation_succeeds_when_the_expected_owner_matches() {
    let conn = conn();
    storage::upsert_automation(&conn, &sample_automation("a1", Some("bot-1"))).unwrap();
    assert!(
        storage::delete_automation(
            &conn,
            "a1",
            Some(&AutomationOwnerPrecondition::Owned("bot-1".to_string()))
        )
        .unwrap()
    );
}

#[test]
fn delete_automation_detects_ownership_changed_by_a_different_connection() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    let c1 = Connection::open(&path).unwrap();
    storage::migrate(&c1).unwrap();
    storage::upsert_automation(&c1, &sample_automation("a1", Some("bot-1"))).unwrap();

    // Caller reads on c2 and believes bot-1 still owns it.
    let c2 = Connection::open(&path).unwrap();
    let believed_owner = AutomationOwnerPrecondition::Owned("bot-1".to_string());

    // A different connection (c1) reassigns ownership in the meantime.
    let mut reassigned = storage::get_automation(&c1, "a1").unwrap().unwrap();
    reassigned.bot_id = Some("bot-2".to_string());
    storage::upsert_automation(&c1, &reassigned).unwrap();

    // c2's stale belief must be refused, not silently honored.
    let err = storage::delete_automation(&c2, "a1", Some(&believed_owner)).unwrap_err();
    assert!(matches!(err, StorageError::OwnerConflict));
    assert!(
        storage::get_automation(&c1, "a1").unwrap().is_some(),
        "must survive the refused delete"
    );
}

// --- Migration: step-wise, not "any older version is already current" ---

#[test]
fn migrate_steps_an_older_supported_version_forward_instead_of_treating_it_as_current() {
    let conn = conn(); // migrated straight to CURRENT
    // Roll the recorded version back to 1 without reverting the schema
    // itself, to prove `migrate` inspects what's *recorded*, not just what
    // tables exist, when deciding whether to run the v2 step.
    conn.execute(
        "UPDATE schema_versions SET version = 1 WHERE component = 'automations'",
        [],
    )
    .unwrap();
    storage::migrate(&conn).unwrap();
    let recorded: i64 = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = 'automations'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(recorded, storage::AUTOMATIONS_SCHEMA_VERSION);
}

#[test]
fn migrate_from_a_genuine_v1_schema_applies_the_v2_step_and_preserves_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        // Hand-build a genuine v1 database: v1 tables, no v2 index, version row = 1.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             CREATE TABLE automations (id TEXT PRIMARY KEY, bot_id TEXT, payload_json TEXT NOT NULL);
             CREATE INDEX automations_bot_id ON automations(bot_id);
             CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, payload_json TEXT NOT NULL);
             CREATE INDEX automation_runs_automation_id ON automation_runs(automation_id);
             INSERT INTO schema_versions(component, version) VALUES ('automations', 1);",
        )
        .unwrap();
        storage::upsert_automation(&conn, &sample_automation("a1", None)).unwrap();
    }
    {
        let conn = Connection::open(&path).unwrap();
        storage::migrate(&conn).unwrap();
        let recorded: i64 = conn
            .query_row(
                "SELECT version FROM schema_versions WHERE component = 'automations'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(recorded, 2);
        // The v2 index now exists.
        let index_exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name = 'automation_runs_automation_id_id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(index_exists, 1);
        // Pre-existing data survived the step untouched.
        let a = storage::get_automation(&conn, "a1").unwrap().unwrap();
        assert_eq!(a.id, "a1");
    }
}
