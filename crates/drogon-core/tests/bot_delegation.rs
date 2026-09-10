//! P3 delegation-chain proof: a `local_file_digest.v1` monitor change
//! makes a Bot dispatch exactly one headless responsibility run — the
//! worktree/session/prompt delegation — with replay-join idempotency, an
//! outage grace, a per-day cap, and a prompt template that cannot carry
//! watched bytes.
//!
//! Fixture-only: a counting [`FakeDispatchSeam`] stands in for
//! `harness.start`/`session.read`, and a temp dir stands in for the
//! watched project. No models, no network, no daemon, no Electron.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;

use drogon_core::automations;
use drogon_core::automations::runner::{
    DispatchSeam, DispatchSeamError, HarnessStarted, SessionObservation,
};
use drogon_core::bots::delegation::{
    self, DELEGATION_GRACE_MS, MAX_DELEGATIONS_PER_BOT_PER_DAY, utc_day_number,
    worktree_name_for_event,
};
use drogon_core::bots::monitors::commit::{CommitDecision, CommitInput, RetainReason};
use drogon_core::bots::monitors::record::{MonitorTrigger, bind_responsibility, new_monitor};
use drogon_core::bots::monitors::storage as mstorage;
use drogon_core::bots::monitors::tick;
use drogon_core::bots::records::*;
use drogon_core::bots::storage as bstorage;
use rusqlite::Connection;
use serde_json::Value;

const HOST: &str = "host-1";
const FOLDER: &str = "/repo";
const PROJECT: &str = "proj-1";
const RESOURCE: &str = "notes/status.md";
const BOT: &str = "bot-1";
const RESP: &str = "resp-1";
const MONITOR: &str = "mon-1";

const WORKSPACES_DDL: &str = "CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    host_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);";

/// Counting seam: every `harness_start` mints a fresh session id (so two
/// dispatches are distinguishable) and records its params (so the prompt
/// is inspectable). Never spawns anything.
struct FakeDispatchSeam {
    harness_start_calls: RefCell<Vec<(String, Value)>>,
    session_counter: RefCell<usize>,
    verdict: RefCell<String>,
    fail_start: RefCell<Option<DispatchSeamError>>,
}

impl FakeDispatchSeam {
    fn new() -> Self {
        Self {
            harness_start_calls: RefCell::new(Vec::new()),
            session_counter: RefCell::new(0),
            verdict: RefCell::new("live".to_string()),
            fail_start: RefCell::new(None),
        }
    }

    fn dispatch_count(&self) -> usize {
        self.harness_start_calls.borrow().len()
    }

    fn last_prompt(&self) -> String {
        self.harness_start_calls
            .borrow()
            .last()
            .expect("a dispatch happened")
            .1
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    }
}

impl DispatchSeam for FakeDispatchSeam {
    fn harness_start(
        &self,
        request_id: &str,
        params: Value,
    ) -> Result<HarnessStarted, DispatchSeamError> {
        self.harness_start_calls
            .borrow_mut()
            .push((request_id.to_string(), params));
        if let Some(err) = self.fail_start.borrow().clone() {
            return Err(err);
        }
        let mut counter = self.session_counter.borrow_mut();
        *counter += 1;
        Ok(HarnessStarted {
            session_id: format!("sess-{counter}"),
            incarnation: format!("inc-{counter}"),
        })
    }

    fn session_read(
        &self,
        _session_id: &str,
        _incarnation: &str,
    ) -> Result<SessionObservation, DispatchSeamError> {
        Ok(SessionObservation {
            verdict: self.verdict.borrow().clone(),
            exit_code: None,
        })
    }
}

struct Fixture {
    db: Mutex<Connection>,
    roots: HashMap<(String, String), String>,
    _project_dir: tempfile::TempDir,
    seam: FakeDispatchSeam,
}

fn sample_bot() -> Bot {
    Bot {
        id: BOT.to_string(),
        character_preset: "none".to_string(),
        display_identity: DisplayIdentity {
            display_name: "Deleg".to_string(),
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
            id: RESP.to_string(),
            name: "triage".to_string(),
            instructions: "Triage the change.".to_string(),
            kind: ResponsibilityKind::Reactive,
            trigger: ResponsibilityTrigger::Reactive { event: None },
            enabled: true,
            recipe: None,
            created_at: 0.0,
            updated_at: 0.0,
        }],
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    }
}

fn fixture() -> Fixture {
    let conn = Connection::open_in_memory().unwrap();
    automations::storage::migrate(&conn).unwrap();
    bstorage::migrate(&conn).unwrap();
    mstorage::migrate(&conn).unwrap();
    delegation::migrate(&conn).unwrap();
    conn.execute_batch(WORKSPACES_DDL).unwrap();
    conn.execute(
        "INSERT INTO workspaces (id, path, name, kind, host_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params!["ws-1", FOLDER, "ws", "folder", HOST, "2026-09-07T00:00:00Z"],
    )
    .unwrap();
    bstorage::create_bot(&conn, HOST, FOLDER, &sample_bot()).unwrap();

    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join(RESOURCE), b"v1 bytes").unwrap();

    let rule = drogon_core::bots::monitors::rule::MonitorRule::LocalFileDigest(
        drogon_core::bots::monitors::rule::LocalFileRule {
            host_id: HOST.to_string(),
            project_id: PROJECT.to_string(),
            resource: RESOURCE.to_string(),
            max_bytes: 64 * 1024,
        },
    );
    let hash = rule.approval_hash();
    let record = new_monitor(
        MONITOR.to_string(),
        Some(BOT.to_string()),
        rule,
        MonitorTrigger::Manual,
        hash,
        1.0,
    )
    .unwrap();
    let bound = bind_responsibility(record, RESP.to_string(), 2.0).unwrap();
    mstorage::create_monitor(&conn, &bound).unwrap();

    let mut roots = HashMap::new();
    roots.insert(
        (HOST.to_string(), PROJECT.to_string()),
        dir.path().to_string_lossy().to_string(),
    );
    Fixture {
        db: Mutex::new(conn),
        roots,
        _project_dir: dir,
        seam: FakeDispatchSeam::new(),
    }
}

fn write_watched(fixture: &Fixture, bytes: &[u8]) {
    std::fs::write(fixture._project_dir.path().join(RESOURCE), bytes).unwrap();
}

fn outbox_len(fixture: &Fixture) -> usize {
    let conn = fixture.db.lock().unwrap();
    conn.query_row("SELECT COUNT(*) FROM bot_monitor_events", [], |r| {
        r.get::<_, i64>(0)
    })
    .unwrap() as usize
}

fn run_history_len(fixture: &Fixture) -> usize {
    let conn = fixture.db.lock().unwrap();
    bstorage::history_for_bot(&conn, HOST, FOLDER, BOT)
        .unwrap()
        .len()
}

fn tick(fixture: &Fixture, now_ms: f64) -> tick::MonitorTickSummary {
    tick::tick_monitors(&fixture.db, &fixture.roots, now_ms)
}

fn drain(fixture: &Fixture, now_ms: f64) -> delegation::DelegationSummary {
    delegation::drain_delegation_events(&fixture.db, HOST, &fixture.seam, now_ms)
}

// --- The chain: one file change → exactly one dispatch -------------------

#[test]
fn one_file_change_produces_exactly_one_dispatch() {
    let fixture = fixture();
    let summary = tick(&fixture, 1_000.0);
    assert_eq!(summary.advanced, 1, "first read is a change: {summary:?}");
    assert_eq!(outbox_len(&fixture), 1);

    let drained = drain(&fixture, 1_000.0);
    assert_eq!(
        drained.dispatched, 1,
        "one event → one dispatch: {drained:?}"
    );
    assert_eq!(fixture.seam.dispatch_count(), 1);
    assert_eq!(
        outbox_len(&fixture),
        0,
        "dispatched events leave the outbox"
    );
    assert_eq!(run_history_len(&fixture), 1);

    // The run is visible in history with the reactive run recorded.
    let conn = fixture.db.lock().unwrap();
    let history = bstorage::history_for_bot(&conn, HOST, FOLDER, BOT).unwrap();
    assert_eq!(history[0].responsibility_run.responsibility_id, RESP);
    assert!(history[0].responsibility_run.automation_id.is_none());
    assert!(history[0].responsibility_run.automation_run_id.is_none());
    drop(conn);

    // The delegation prompt names the deterministic worktree.
    let prompt = fixture.seam.last_prompt();
    assert!(prompt.contains("drogon-cli worktree create"));
    assert!(prompt.contains("drogon-cli harness start"));
    assert!(prompt.contains(&worktree_name_for_event(&history_event_id(&fixture))));
}

fn history_event_id(fixture: &Fixture) -> String {
    // Recover the event id from the run id: run id == delegation request id,
    // which ends with the event identity by construction of derive_request_id
    // — instead read it back from the prompt the seam recorded.
    let prompt = fixture.seam.last_prompt();
    let marker = "Monitor delegation ";
    let start = prompt.find(marker).expect("prompt carries the event id") + marker.len();
    prompt[start..start + 36].to_string()
}

// --- Second identical tick: no new event, no new dispatch -----------------

#[test]
fn second_identical_tick_produces_no_new_dispatch() {
    let fixture = fixture();
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    assert_eq!(drain(&fixture, 1_000.0).dispatched, 1);

    // Same bytes, second tick: no new outbox row, no new session.
    let summary = tick(&fixture, 2_000.0);
    assert_eq!(summary.advanced, 0, "no new change: {summary:?}");
    assert_eq!(summary.no_change, 1);
    assert_eq!(outbox_len(&fixture), 0);
    let drained = drain(&fixture, 2_000.0);
    assert_eq!(drained.claimed, 0);
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 1, "no second session opened");
    assert_eq!(run_history_len(&fixture), 1);
}

#[test]
fn replayed_changed_result_collapses_to_duplicate_tick() {
    // The race the CAS guards: two evaluations of the same new bytes before
    // either commits. The second commit must retain as DuplicateTick and
    // enqueue nothing — unit-level pin of the mechanism the tick relies on.
    use drogon_core::bots::monitors::commit::{StoredMonitorState, decide_commit};
    use drogon_core::bots::monitors::eval::{cursor_for_digest, digest_bytes, event_id_for};
    use drogon_core::bots::monitors::result::MonitorCheckResult;

    let stored = StoredMonitorState {
        monitor_id: MONITOR.to_string(),
        version: 1,
        cursor: None,
        last_event_id: None,
        enabled: true,
    };
    let digest = digest_bytes(b"payload");
    let cursor = cursor_for_digest(&digest);
    let event_id = event_id_for(MONITOR, &"aa".repeat(32), &digest);
    let result = MonitorCheckResult::changed(MONITOR, 1, event_id.clone(), cursor.clone(), 10.0);
    let first = decide_commit(
        &stored,
        HOST,
        PROJECT,
        RESOURCE,
        Some(BOT),
        &result,
        &CommitInput {
            expected_version: 1,
        },
    );
    let intent = match first {
        CommitDecision::Advance { intent, .. } => intent,
        other => panic!("expected advance, got {other:?}"),
    };
    assert_eq!(intent.event_id, event_id);
    // After the first commit, the same result replays as a duplicate.
    let committed = StoredMonitorState {
        cursor: Some(cursor),
        last_event_id: Some(intent.event_id),
        ..stored
    };
    assert_eq!(
        decide_commit(
            &committed,
            HOST,
            PROJECT,
            RESOURCE,
            Some(BOT),
            &result,
            &CommitInput {
                expected_version: 1
            },
        ),
        CommitDecision::Retain {
            reason: RetainReason::DuplicateTick
        }
    );
}

// --- Replay joins: same event id, no second session or worktree -----------

#[test]
fn replayed_event_joins_the_existing_run() {
    let fixture = fixture();
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    // Capture the queued event id before the first drain consumes it.
    let event_id = {
        let conn = fixture.db.lock().unwrap();
        conn.query_row("SELECT event_id FROM bot_monitor_events", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap()
    };
    let expected_worktree = worktree_name_for_event(&event_id);
    assert_eq!(drain(&fixture, 1_000.0).dispatched, 1);
    assert!(fixture.seam.last_prompt().contains(&expected_worktree));

    // Crash-redelivery of the same event (outbox row back, same id).
    {
        let conn = fixture.db.lock().unwrap();
        let (record, _) = mstorage::get_monitor(&conn, MONITOR).unwrap().unwrap();
        let replay = delegation::DelegationEvent {
            event_id: event_id.clone(),
            monitor_id: MONITOR.to_string(),
            monitor_version: record.version,
            cursor: record.cursor.clone().unwrap(),
            host_id: HOST.to_string(),
            project_id: PROJECT.to_string(),
            resource: RESOURCE.to_string(),
            bot_id: Some(BOT.to_string()),
            observed_at_ms: 1_000.0,
        };
        let tx = conn.unchecked_transaction().unwrap();
        assert!(delegation::enqueue_event_in_tx(&tx, &replay).unwrap());
        tx.commit().unwrap();
    }
    let drained = drain(&fixture, 1_100.0);
    assert_eq!(drained.joined_existing, 1, "replay joins: {drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(
        fixture.seam.dispatch_count(),
        1,
        "no second harness.start: no second session, and the prompt's \
         deterministic worktree name means no second worktree either"
    );
    assert_eq!(run_history_len(&fixture), 1, "still exactly one run row");
}

// --- Outage past grace: skip, resume, no catch-up storm -------------------

#[test]
fn outage_past_grace_skips_without_catch_up_storm() {
    let fixture = fixture();
    // Queue an event, then let the daemon "die" past the grace window.
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    assert_eq!(outbox_len(&fixture), 1);
    let after_outage = 1_000.0 + DELEGATION_GRACE_MS + 1.0;
    let drained = drain(&fixture, after_outage);
    assert_eq!(drained.skipped_stale, 1, "stale event skipped: {drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    assert_eq!(outbox_len(&fixture), 0);
    assert_eq!(run_history_len(&fixture), 0);

    // High-water resumes: the monitor kept its cursor (no rollback), and a
    // genuinely new change after the outage still delegates exactly once —
    // one skip row's worth of history, never a storm.
    write_watched(&fixture, b"v2 bytes after outage");
    let summary = tick(&fixture, after_outage + 1_000.0);
    assert_eq!(summary.advanced, 1, "new change still fires: {summary:?}");
    let drained = drain(&fixture, after_outage + 1_000.0);
    assert_eq!(drained.dispatched, 1);
    assert_eq!(run_history_len(&fixture), 1);
}

// --- Per-day cap: honest state, no flood ----------------------------------

#[test]
fn delegation_cap_trips_with_an_honest_state() {
    let fixture = fixture();
    // Eleven distinct changes → eleven events, no drains yet.
    for i in 0..11 {
        write_watched(&fixture, format!("version {i}").as_bytes());
        let summary = tick(&fixture, 1_000.0 + i as f64 * 1_000.0);
        assert_eq!(summary.advanced, 1, "change {i} enqueues: {summary:?}");
    }
    assert_eq!(outbox_len(&fixture), 11);

    // Drain until empty (bounded claims per pass).
    let mut totals = delegation::DelegationSummary::default();
    for _ in 0..8 {
        let drained = drain(&fixture, 100_000.0);
        totals.dispatched += drained.dispatched;
        totals.cap_exceeded += drained.cap_exceeded;
        totals.claimed += drained.claimed;
        if outbox_len(&fixture) == 0 {
            break;
        }
    }
    assert_eq!(totals.dispatched, MAX_DELEGATIONS_PER_BOT_PER_DAY as usize);
    assert_eq!(totals.cap_exceeded, 1, "the 11th event exceeds the cap");
    assert_eq!(
        fixture.seam.dispatch_count(),
        MAX_DELEGATIONS_PER_BOT_PER_DAY as usize
    );
    assert_eq!(outbox_len(&fixture), 0);
    assert_eq!(
        run_history_len(&fixture),
        MAX_DELEGATIONS_PER_BOT_PER_DAY as usize
    );

    // Honest state: the durable counter reads back used/max.
    let conn = fixture.db.lock().unwrap();
    assert_eq!(
        delegation::delegations_used_today(&conn, BOT, 100_000.0).unwrap(),
        MAX_DELEGATIONS_PER_BOT_PER_DAY
    );
    drop(conn);

    // A fresh change the same day still trips the cap, honestly.
    write_watched(&fixture, b"version 11");
    assert_eq!(tick(&fixture, 200_000.0).advanced, 1);
    let drained = drain(&fixture, 200_000.0);
    assert_eq!(drained.cap_exceeded, 1);
    assert_eq!(
        fixture.seam.dispatch_count(),
        MAX_DELEGATIONS_PER_BOT_PER_DAY as usize
    );

    // Next UTC day: budget renews, delegation flows again.
    let next_day = (utc_day_number(200_000.0) + 1) as f64 * 86_400_000.0 + 1_000.0;
    write_watched(&fixture, b"version next day");
    assert_eq!(tick(&fixture, next_day).advanced, 1);
    let drained = drain(&fixture, next_day);
    assert_eq!(drained.dispatched, 1, "new day, new budget: {drained:?}");
}

// --- Template rule: raw watched content never reaches the prompt ----------

#[test]
fn delegation_prompt_never_contains_raw_watched_content() {
    let fixture = fixture();
    let canary = "CANARY-WATCHED-BYTES-9f3c-do-not-paste";
    write_watched(&fixture, format!("prefix {canary} suffix").as_bytes());
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    assert_eq!(drain(&fixture, 1_000.0).dispatched, 1);

    let prompt = fixture.seam.last_prompt();
    assert!(!prompt.contains(canary), "raw watched bytes in the prompt");
    // Structured fields ARE present: the delegation is still actionable.
    assert!(prompt.contains(MONITOR));
    assert!(prompt.contains(RESOURCE));
    assert!(prompt.contains("triage"));

    // The durable rows are metadata-only too.
    let conn = fixture.db.lock().unwrap();
    let payload: String = conn
        .query_row(
            "SELECT payload_json FROM bot_monitor_checks ORDER BY rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!payload.contains(canary), "canary in check history");
    let monitor_payload: String = conn
        .query_row(
            "SELECT payload_json FROM bot_monitors WHERE id = ?1",
            [MONITOR],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!monitor_payload.contains(canary), "canary in monitor row");
}

// --- Claim protocol pin: delete-on-record, no claim column -----------------

#[test]
fn outbox_claim_is_delete_on_record_with_no_claim_column() {
    let fixture = fixture();
    let conn = fixture.db.lock().unwrap();
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(bot_monitor_events)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for forbidden in [
        "claimed",
        "claimed_at",
        "locked",
        "locked_at",
        "status",
        "state",
    ] {
        assert!(
            !columns.iter().any(|c| c == forbidden),
            "outbox must have no claim column, found: {columns:?}"
        );
    }
    drop(conn);

    // Duplicate enqueue of the same content-bound id collapses: one row.
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    let event_id: String = {
        let conn = fixture.db.lock().unwrap();
        conn.query_row("SELECT event_id FROM bot_monitor_events", [], |r| r.get(0))
            .unwrap()
    };
    {
        let conn = fixture.db.lock().unwrap();
        let replay = delegation::DelegationEvent {
            event_id: event_id.clone(),
            monitor_id: MONITOR.to_string(),
            monitor_version: 1,
            cursor: "v1:00".to_string(),
            host_id: HOST.to_string(),
            project_id: PROJECT.to_string(),
            resource: RESOURCE.to_string(),
            bot_id: Some(BOT.to_string()),
            observed_at_ms: 1_000.0,
        };
        let tx = conn.unchecked_transaction().unwrap();
        assert!(
            !delegation::enqueue_event_in_tx(&tx, &replay).unwrap(),
            "INSERT OR IGNORE collapses the duplicate"
        );
        tx.commit().unwrap();
    }
    assert_eq!(outbox_len(&fixture), 1);
}

// --- Policy gates: notification-only, disabled, orphaned -------------------

#[test]
fn notification_only_monitors_drain_without_dispatch() {
    let fixture = fixture();
    // Unbind: back to the default policy.
    {
        let conn = fixture.db.lock().unwrap();
        let (mut record, rev) = mstorage::get_monitor(&conn, MONITOR).unwrap().unwrap();
        record.inference_policy =
            drogon_core::bots::monitors::policy::MonitorInferencePolicy::NotificationOnly;
        record.updated_at_ms = 3.0;
        mstorage::cas_write(&conn, &record, rev).unwrap();
    }
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    let drained = drain(&fixture, 1_000.0);
    assert_eq!(drained.drained_notification, 1, "{drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    assert_eq!(outbox_len(&fixture), 0);
}

#[test]
fn disabled_responsibility_refuses_without_spinning() {
    let fixture = fixture();
    {
        let conn = fixture.db.lock().unwrap();
        bstorage::update_bot(&conn, HOST, FOLDER, BOT, 5.0, |bot| {
            bot.responsibilities[0].enabled = false;
        })
        .unwrap();
    }
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    let drained = drain(&fixture, 1_000.0);
    assert_eq!(drained.refused, 1, "{drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    // Deterministic refusal deletes: no poison retry next tick.
    assert_eq!(outbox_len(&fixture), 0);
    let drained = drain(&fixture, 2_000.0);
    assert_eq!(drained.claimed, 0);
}

#[test]
fn deleted_monitor_leaves_an_orphan_not_a_dispatch() {
    let fixture = fixture();
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    {
        let conn = fixture.db.lock().unwrap();
        assert!(mstorage::delete_monitor(&conn, MONITOR).unwrap());
    }
    let drained = drain(&fixture, 1_000.0);
    assert_eq!(drained.orphaned, 1, "{drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
}

#[test]
fn harness_failure_records_honestly_without_retry_storm() {
    let fixture = fixture();
    fixture.seam.fail_start.replace(Some(DispatchSeamError {
        code: "harness_unavailable".to_string(),
        message: "no such harness".to_string(),
    }));
    assert_eq!(tick(&fixture, 1_000.0).advanced, 1);
    let drained = drain(&fixture, 1_000.0);
    // The attempt happened (one seam call) and its outcome was recorded:
    // the event is gone, the run row exists with no host observation.
    assert_eq!(drained.dispatched, 1, "{drained:?}");
    assert_eq!(fixture.seam.dispatch_count(), 1);
    assert_eq!(outbox_len(&fixture), 0);
    assert_eq!(run_history_len(&fixture), 1);
    let conn = fixture.db.lock().unwrap();
    let history = bstorage::history_for_bot(&conn, HOST, FOLDER, BOT).unwrap();
    assert!(history[0].responsibility_run.host_observation.is_none());
}

// --- Small pure pins -------------------------------------------------------

#[test]
fn worktree_names_are_deterministic_and_branch_safe() {
    let a = worktree_name_for_event("mev_0123456789abcdef0123456789abcdef");
    let b = worktree_name_for_event("mev_0123456789abcdef0123456789abcdef");
    assert_eq!(a, b);
    assert!(a.starts_with("deleg-"));
    assert!(a.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'));
    assert_ne!(
        a,
        worktree_name_for_event("mev_fedcba9876543210fedcba9876543210")
    );
}

#[test]
fn delegation_request_ids_are_stable_per_event() {
    let a = delegation::delegation_request_id(HOST, FOLDER, BOT, RESP, "mev_aaa");
    let b = delegation::delegation_request_id(HOST, FOLDER, BOT, RESP, "mev_aaa");
    assert_eq!(a, b);
    assert_ne!(
        a,
        delegation::delegation_request_id(HOST, FOLDER, BOT, RESP, "mev_aab")
    );
}
