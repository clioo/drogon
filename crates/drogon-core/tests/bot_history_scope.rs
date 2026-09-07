//! Regression tests for the P2-1 history-scope fence (see
//! `docs/migration/verticals/V5/bot-snapshot-review.md` and
//! `drogon_core::bots::storage`'s module doc "Run history scope fence"):
//! `history_for_bot` must not reattach runs orphaned by `delete_bot` to a
//! later Bot that reuses the same freed id in a different `(host, folder)`
//! scope, while the orphaned rows themselves must stay on disk as
//! evidence. Also pins the storage-internal `ResponsibilityTrigger::Scheduled`
//! JSON shape (compatibility choice (b): snake_case `automation_id` on
//! disk, camelCase normalization only at the V5-owned snapshot boundary).
//!
//! Extended for the V4-W write fence (create-deny, partial-stamp
//! fail-closed, dedup restamp guard -- see the module doc's "Create-deny
//! fence (W1)", "Partial scope stamp (W2)" and "Dedup restamp guard (W3)"):
//! since W1 now refuses to ever recreate a bot id that still has a
//! retained run row (same scope or not), the original id-reuse scenario
//! above is exercised without ever calling `create_bot` a second time for
//! the same id -- `history_for_bot`'s read-time scope fence is proven
//! directly against the orphaned row instead.

use drogon_core::automations;
use drogon_core::bots::records::*;
use drogon_core::bots::storage as bstorage;
use rusqlite::Connection;

const HOST: &str = "host-1";
const FOLDER_A: &str = "/repo-a";
const FOLDER_B: &str = "/repo-b";

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
        responsibilities: vec![Responsibility {
            id: "r1".to_string(),
            name: "reactive".to_string(),
            instructions: String::new(),
            kind: ResponsibilityKind::Reactive,
            trigger: ResponsibilityTrigger::Reactive { event: None },
            enabled: true,
            recipe: None,
            created_at: now,
            updated_at: now,
        }],
        current_session: None,
        created_at: now,
        updated_at: now,
    }
}

/// Like [`sample_bot`], but its single responsibility is Scheduled against
/// `automation_id` instead of Reactive -- needed for the W3 dedup-guard
/// tests, which require a real `automation_run_id` merge path (only
/// reachable for a Scheduled responsibility; see
/// `record_responsibility_run`'s ownership checks).
fn sample_bot_with_scheduled_responsibility(
    id: &str,
    display_name: &str,
    automation_id: &str,
    now: f64,
) -> Bot {
    let mut bot = sample_bot(id, display_name, now);
    bot.responsibilities = vec![Responsibility {
        id: "r1".to_string(),
        name: "scheduled".to_string(),
        instructions: String::new(),
        kind: ResponsibilityKind::Scheduled,
        trigger: ResponsibilityTrigger::Scheduled {
            automation_id: automation_id.to_string(),
        },
        enabled: true,
        recipe: None,
        created_at: now,
        updated_at: now,
    }];
    bot
}

fn sample_automation(id: &str, bot_id: &str) -> automations::records::Automation {
    automations::records::Automation {
        id: id.to_string(),
        creation_key: None,
        name: "sweep".to_string(),
        prompt: "p".to_string(),
        precheck: None,
        agent_id: "codex".to_string(),
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

fn sample_automation_run(id: &str, automation_id: &str) -> automations::records::AutomationRun {
    automations::records::AutomationRun {
        id: id.to_string(),
        automation_id: automation_id.to_string(),
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
    }
}

fn sample_run(id: &str, bot_id: &str, started_at: f64) -> ResponsibilityRun {
    ResponsibilityRun {
        id: id.to_string(),
        bot_id: bot_id.to_string(),
        responsibility_id: "r1".to_string(),
        automation_id: None,
        automation_run_id: None,
        started_at,
        ended_at: None,
        recipe: None,
        host_observation: None,
    }
}

fn raw_run_row_count(conn: &Connection, bot_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM bot_responsibility_runs WHERE bot_id = ?1",
        [bot_id],
        |r| r.get(0),
    )
    .unwrap()
}

/// Reads a row's raw `payload_json` directly, bypassing every storage-level
/// helper, so a test can assert on the exact on-disk envelope shape (e.g.
/// whether a scope stamp was attached) rather than only on what a read API
/// chooses to expose.
fn raw_payload_json(conn: &Connection, run_id: &str) -> serde_json::Value {
    let json: String = conn
        .query_row(
            "SELECT payload_json FROM bot_responsibility_runs WHERE id = ?1",
            [run_id],
            |r| r.get(0),
        )
        .unwrap();
    serde_json::from_str(&json).unwrap()
}

#[test]
fn history_for_bot_excludes_a_cross_scope_stamped_run_for_the_same_bot_id() {
    // Folder A: create bot "x", record a run (stamped host-1/repo-a by
    // record_responsibility_run), delete the bot (the run is retained as
    // orphaned evidence -- see delete_bot's doc).
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("x", "Alice-A", 0.0)).unwrap();
    bstorage::record_responsibility_run(&c, HOST, FOLDER_A, sample_run("run-a-era", "x", 1.0))
        .unwrap();
    assert!(bstorage::delete_bot(&c, HOST, FOLDER_A, "x").unwrap());
    assert_eq!(
        raw_run_row_count(&c, "x"),
        1,
        "delete_bot must preserve the run row as orphaned evidence"
    );

    // create_bot now refuses to ever recreate id "x" anywhere (see the
    // create-deny tests below), so folder B never gets its own bot "x" --
    // history_for_bot's read-time scope fence is exercised directly
    // against folder B without one.
    let history_b = bstorage::history_for_bot(&c, HOST, FOLDER_B, "x").unwrap();
    assert!(
        history_b.is_empty(),
        "folder B's history must exclude folder A's era run despite the shared bot id"
    );

    // The retained row is still on disk, never deleted by this fence --
    // direct row-count evidence that the fence excludes at read time only.
    assert_eq!(
        raw_run_row_count(&c, "x"),
        1,
        "the fence must exclude at read time, never delete the orphaned evidence row"
    );

    // Folder A no longer has a bot "x" (it was deleted); its era's run row
    // is still directly inspectable on disk (already proven above).
    assert!(
        bstorage::get_bot(&c, HOST, FOLDER_A, "x")
            .unwrap()
            .is_none()
    );
}

#[test]
fn legacy_unstamped_run_rows_stay_visible_under_bot_id_match() {
    // Documents the explicit legacy rule (see the module doc's "Run
    // history scope fence"): a row written before this fence existed (no
    // scope stamp in its JSON payload) is still returned by
    // history_for_bot for any scope that can resolve its bot_id, exactly
    // like the pre-fence behavior -- its true original scope was never
    // recorded and cannot be reconstructed.
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("legacy", "Legacy", 0.0)).unwrap();

    // Insert a bare ResponsibilityRun payload directly, bypassing
    // record_responsibility_run, to simulate a row written before the
    // scope stamp existed.
    let legacy_run = sample_run("legacy-run", "legacy", 1.0);
    let payload = serde_json::to_string(&legacy_run).unwrap();
    c.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            legacy_run.id,
            legacy_run.bot_id,
            Option::<String>::None,
            legacy_run.started_at,
            payload
        ],
    )
    .unwrap();

    let history = bstorage::history_for_bot(&c, HOST, FOLDER_A, "legacy").unwrap();
    let ids: Vec<&str> = history
        .iter()
        .map(|h| h.responsibility_run.id.as_str())
        .collect();
    assert_eq!(ids, vec!["legacy-run"]);
}

#[test]
fn responsibility_trigger_scheduled_keeps_the_storage_internal_snake_case_shape() {
    // Storage-shape pin (compatibility choice (b)): wire camelCase
    // normalization for `automationId` happens only at the V5-owned
    // snapshot boundary, never in storage -- this must stay `automation_id`
    // on disk, or every already-persisted Scheduled trigger becomes
    // unreadable. Fails if the field is renamed or re-cased.
    let trigger = ResponsibilityTrigger::Scheduled {
        automation_id: "auto-1".to_string(),
    };
    let value = serde_json::to_value(&trigger).unwrap();
    assert_eq!(
        value,
        serde_json::json!({"kind": "scheduled", "automation_id": "auto-1"})
    );
}

// --- W1: create-deny -----------------------------------------------------

#[test]
fn create_bot_denies_cross_scope_id_reuse_after_delete() {
    // Any retained row in bot_responsibility_runs for this bot_id --
    // regardless of which scope wrote it -- refuses create_bot's INSERT.
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("x", "Alice-A", 0.0)).unwrap();
    bstorage::record_responsibility_run(&c, HOST, FOLDER_A, sample_run("run-a-era", "x", 1.0))
        .unwrap();
    assert!(bstorage::delete_bot(&c, HOST, FOLDER_A, "x").unwrap());

    let err =
        bstorage::create_bot(&c, HOST, FOLDER_B, &sample_bot("x", "Bob-B", 10.0)).unwrap_err();
    assert!(matches!(err, bstorage::StorageError::BotIdCollision));
    assert!(
        bstorage::get_bot(&c, HOST, FOLDER_B, "x")
            .unwrap()
            .is_none(),
        "the denied create must not have inserted a row"
    );
    assert_eq!(
        raw_run_row_count(&c, "x"),
        1,
        "the denied create must not have touched the retained run row"
    );
}

#[test]
fn create_bot_denies_same_scope_id_reuse_after_delete() {
    // Same-scope recreate is denied too: a retained run's legacy-vs-stamped
    // origin is indistinguishable from this check's point of view, so
    // "same scope" gets no special exemption -- callers must mint a new id.
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("x", "Alice-A", 0.0)).unwrap();
    bstorage::record_responsibility_run(&c, HOST, FOLDER_A, sample_run("run-a-era", "x", 1.0))
        .unwrap();
    assert!(bstorage::delete_bot(&c, HOST, FOLDER_A, "x").unwrap());

    let err =
        bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("x", "Alice-A-2", 20.0)).unwrap_err();
    assert!(matches!(err, bstorage::StorageError::BotIdCollision));
    assert!(
        bstorage::get_bot(&c, HOST, FOLDER_A, "x")
            .unwrap()
            .is_none()
    );
}

#[test]
fn create_bot_still_succeeds_for_a_brand_new_id_with_no_retained_runs() {
    // Sanity check that the new probe does not overreach: a genuinely new
    // id, with zero rows in bot_responsibility_runs, is unaffected.
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("brand-new", "New", 0.0)).unwrap();
    assert!(
        bstorage::get_bot(&c, HOST, FOLDER_A, "brand-new")
            .unwrap()
            .is_some()
    );
}

// --- W2: partial-stamp fail-closed ----------------------------------------

#[test]
fn history_for_bot_fails_closed_on_a_partial_scope_stamp() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("p1", "Partial", 0.0)).unwrap();

    // Simulate a malformed envelope carrying only scope_host, never
    // produced by this module's own writer -- must fail closed, not be
    // treated as legacy (both None) or fully scoped (both Some).
    let payload = serde_json::json!({
        "id": "partial-run",
        "botId": "p1",
        "responsibilityId": "r1",
        "automationId": null,
        "automationRunId": null,
        "startedAt": 1.0,
        "endedAt": null,
        "recipe": null,
        "hostObservation": null,
        "scope_host": HOST,
    })
    .to_string();
    c.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["partial-run", "p1", Option::<String>::None, 1.0, payload],
    )
    .unwrap();

    let err = bstorage::history_for_bot(&c, HOST, FOLDER_A, "p1").unwrap_err();
    assert!(matches!(err, bstorage::StorageError::PartialScopeStamp));

    // Fail-closed at read time only: the malformed row stays on disk.
    assert_eq!(raw_run_row_count(&c, "p1"), 1);
}

#[test]
fn history_for_bot_fails_closed_on_a_partial_scope_stamp_carrying_only_folder() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("p2", "Partial2", 0.0)).unwrap();

    let payload = serde_json::json!({
        "id": "partial-run-2",
        "botId": "p2",
        "responsibilityId": "r1",
        "automationId": null,
        "automationRunId": null,
        "startedAt": 1.0,
        "endedAt": null,
        "recipe": null,
        "hostObservation": null,
        "scope_folder": FOLDER_A,
    })
    .to_string();
    c.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["partial-run-2", "p2", Option::<String>::None, 1.0, payload],
    )
    .unwrap();

    let err = bstorage::history_for_bot(&c, HOST, FOLDER_A, "p2").unwrap_err();
    assert!(matches!(err, bstorage::StorageError::PartialScopeStamp));
    assert_eq!(raw_run_row_count(&c, "p2"), 1);
}

// --- W3: dedup restamp guard ----------------------------------------------

#[test]
fn record_responsibility_run_refuses_a_cross_scope_dedup_replay_against_a_fully_stamped_row() {
    // Simulates a database that (before W1's create-deny fence existed)
    // already had the same bot id "live" in two different scopes at once
    // -- raw-inserted here since create_bot itself now refuses to ever
    // produce this shape going forward (see the create-deny tests above).
    let c = conn();
    bstorage::create_bot(
        &c,
        HOST,
        FOLDER_A,
        &sample_bot_with_scheduled_responsibility("d1", "Dedup-A", "a1", 0.0),
    )
    .unwrap();
    let automation = sample_automation("a1", "d1");
    automations::storage::insert_new_automation(&c, &automation).unwrap();
    automations::storage::upsert_automation_run(&c, &sample_automation_run("run-1", "a1")).unwrap();

    // First write, under folder A: creates a fully-stamped row.
    let first = bstorage::record_responsibility_run(
        &c,
        HOST,
        FOLDER_A,
        ResponsibilityRun {
            id: "run-record-1".to_string(),
            bot_id: "d1".to_string(),
            responsibility_id: "r1".to_string(),
            automation_id: Some("a1".to_string()),
            automation_run_id: Some("run-1".to_string()),
            started_at: 0.0,
            ended_at: None,
            recipe: None,
            host_observation: None,
        },
    )
    .unwrap();
    assert_eq!(first.id, "run-record-1");

    // Delete the folder-A bot (its run stays as orphaned evidence, stamped
    // to folder A -- see delete_bot's doc), freeing the globally-unique
    // `bots.id` primary key so a second row for the same id can exist at
    // all. Then raw-insert a bot row for the SAME id "d1" directly into
    // folder B (bypassing create_bot's own gate, which would otherwise now
    // refuse this -- this reproduces exactly the pre-W1 legacy shape being
    // guarded against: a bot id that already lived, with runs, in a
    // different scope).
    assert!(bstorage::delete_bot(&c, HOST, FOLDER_A, "d1").unwrap());
    // delete_bot clears ownership of every automation owned by this bot_id
    // (bot_id is a global key on Automation, not scoped) -- re-claim "a1"
    // for the recreated "d1" so the test actually reaches the dedup/merge
    // path below instead of failing earlier on a plain ownership check.
    let mut reclaimed = automation.clone();
    reclaimed.bot_id = Some("d1".to_string());
    automations::storage::upsert_automation(&c, &reclaimed).unwrap();
    let bot_b = sample_bot_with_scheduled_responsibility("d1", "Dedup-B", "a1", 10.0);
    let payload_b = serde_json::to_string(&bot_b).unwrap();
    c.execute(
        "INSERT INTO bots (id, host_id, folder, updated_at, rev, payload_json) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        rusqlite::params![bot_b.id, HOST, FOLDER_B, bot_b.updated_at, payload_b],
    )
    .unwrap();

    // Replaying the SAME automation_run_id from folder B's scope must be
    // refused: the existing row is fully stamped to folder A, and folder
    // B's scope does not match.
    let err = bstorage::record_responsibility_run(
        &c,
        HOST,
        FOLDER_B,
        ResponsibilityRun {
            id: "run-record-2-different-id".to_string(),
            bot_id: "d1".to_string(),
            responsibility_id: "r1".to_string(),
            automation_id: Some("a1".to_string()),
            automation_run_id: Some("run-1".to_string()),
            started_at: 0.0,
            ended_at: Some(99.0),
            recipe: None,
            host_observation: None,
        },
    )
    .unwrap_err();
    assert!(matches!(err, bstorage::StorageError::OwnershipViolation(_)));

    // The existing row must be completely untouched: still exactly one
    // row for this automation_run_id, still the original id, still no
    // ended_at.
    assert_eq!(raw_run_row_count(&c, "d1"), 1);
    let survivor = raw_payload_json(&c, "run-record-1");
    assert_eq!(survivor.get("endedAt"), Some(&serde_json::Value::Null));
}

#[test]
fn record_responsibility_run_keeps_an_existing_unstamped_row_unstamped_after_a_merge() {
    // W3's other half: merging onto an existing *unstamped* (legacy) row
    // must never attach a new scope stamp merely because the calling scope
    // is concretely known -- that would launder a legacy row into a scope
    // it was never actually proven to belong to.
    let c = conn();
    bstorage::create_bot(
        &c,
        HOST,
        FOLDER_A,
        &sample_bot_with_scheduled_responsibility("d2", "Dedup2", "a2", 0.0),
    )
    .unwrap();
    let automation = sample_automation("a2", "d2");
    automations::storage::insert_new_automation(&c, &automation).unwrap();
    automations::storage::upsert_automation_run(&c, &sample_automation_run("run-2", "a2")).unwrap();

    // Raw-insert a bare (unstamped) ResponsibilityRun payload directly,
    // simulating a row written before the scope-stamp fence existed, but
    // whose automation_run_id a later real call will now replay against.
    let legacy_run = ResponsibilityRun {
        id: "legacy-dedup-run".to_string(),
        bot_id: "d2".to_string(),
        responsibility_id: "r1".to_string(),
        automation_id: Some("a2".to_string()),
        automation_run_id: Some("run-2".to_string()),
        started_at: 0.0,
        ended_at: None,
        recipe: Some(RecipeLink {
            recipe_ref: "recipe-legacy".to_string(),
            run_id: None,
            evidence_path: None,
        }),
        host_observation: None,
    };
    let payload = serde_json::to_string(&legacy_run).unwrap();
    c.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            legacy_run.id,
            legacy_run.bot_id,
            legacy_run.automation_run_id,
            legacy_run.started_at,
            payload
        ],
    )
    .unwrap();

    let merged = bstorage::record_responsibility_run(
        &c,
        HOST,
        FOLDER_A,
        ResponsibilityRun {
            id: "irrelevant-incoming-id".to_string(),
            bot_id: "d2".to_string(),
            responsibility_id: "r1".to_string(),
            automation_id: Some("a2".to_string()),
            automation_run_id: Some("run-2".to_string()),
            started_at: 0.0,
            ended_at: Some(42.0),
            recipe: None,
            host_observation: None,
        },
    )
    .unwrap();

    assert_eq!(
        merged.id, "legacy-dedup-run",
        "must dedupe onto the existing legacy row, not insert a second one"
    );
    assert_eq!(merged.ended_at, Some(42.0));
    assert_eq!(
        merged.recipe.as_ref().unwrap().recipe_ref,
        "recipe-legacy",
        "null incoming recipe must preserve the existing legacy value"
    );

    // Dedup, never a second row.
    assert_eq!(raw_run_row_count(&c, "d2"), 1);

    // The on-disk envelope must still carry NO scope stamp: a merge must
    // not launder this legacy row into folder A's scope. `#[serde(default)]`
    // on a `None` still serializes as an explicit JSON `null`, never an
    // omitted key, so the absent-stamp shape is `Value::Null`, not a
    // missing key.
    let raw = raw_payload_json(&c, "legacy-dedup-run");
    assert_eq!(
        raw.get("scope_host"),
        Some(&serde_json::Value::Null),
        "merging onto a legacy row must not attach a scope_host stamp"
    );
    assert_eq!(
        raw.get("scope_folder"),
        Some(&serde_json::Value::Null),
        "merging onto a legacy row must not attach a scope_folder stamp"
    );

    // Legacy visibility unchanged: still visible under any bot_id match.
    let history = bstorage::history_for_bot(&c, HOST, FOLDER_A, "d2").unwrap();
    assert!(
        history
            .iter()
            .any(|h| h.responsibility_run.id == "legacy-dedup-run"),
        "the still-unstamped merged row must remain visible, exactly like pre-fence legacy rows"
    );
}
