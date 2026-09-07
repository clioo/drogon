//! Regression tests for the P2-1 history-scope fence (see
//! `docs/migration/verticals/V5/bot-snapshot-review.md` and
//! `drogon_core::bots::storage`'s module doc "Run history scope fence"):
//! `history_for_bot` must not reattach runs orphaned by `delete_bot` to a
//! later Bot that reuses the same freed id in a different `(host, folder)`
//! scope, while the orphaned rows themselves must stay on disk as
//! evidence. Also pins the storage-internal `ResponsibilityTrigger::Scheduled`
//! JSON shape (compatibility choice (b): snake_case `automation_id` on
//! disk, camelCase normalization only at the V5-owned snapshot boundary).

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

#[test]
fn history_for_bot_excludes_orphaned_runs_after_delete_and_id_reuse_in_another_folder() {
    let c = conn();

    // Folder A: create bot "x", record a run, delete the bot (the run is
    // retained as orphaned evidence -- see delete_bot's doc).
    bstorage::create_bot(&c, HOST, FOLDER_A, &sample_bot("x", "Alice-A", 0.0)).unwrap();
    bstorage::record_responsibility_run(&c, HOST, FOLDER_A, sample_run("run-a-era", "x", 1.0))
        .unwrap();
    assert!(bstorage::delete_bot(&c, HOST, FOLDER_A, "x").unwrap());
    assert_eq!(
        raw_run_row_count(&c, "x"),
        1,
        "delete_bot must preserve the run row as orphaned evidence"
    );

    // Folder B: a *different* bot reuses the freed id "x".
    bstorage::create_bot(&c, HOST, FOLDER_B, &sample_bot("x", "Bob-B", 10.0)).unwrap();
    bstorage::record_responsibility_run(&c, HOST, FOLDER_B, sample_run("run-b-era", "x", 20.0))
        .unwrap();

    let history_b = bstorage::history_for_bot(&c, HOST, FOLDER_B, "x").unwrap();
    let ids: Vec<&str> = history_b
        .iter()
        .map(|h| h.responsibility_run.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec!["run-b-era"],
        "folder B's history must exclude folder A's era run despite the shared bot id"
    );

    // The retained row is still on disk: 2 total rows for bot id "x"
    // across both eras, never deleted by this fence -- direct row-count
    // evidence that the fence excludes at read time only.
    assert_eq!(
        raw_run_row_count(&c, "x"),
        2,
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
