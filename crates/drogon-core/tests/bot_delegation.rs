//! P3 delegation-chain proof: a committed monitor change in the P2 outbox
//! makes a Bot dispatch exactly one headless responsibility run — the
//! worktree/session/prompt delegation — with replay-join idempotency, an
//! outage grace, a per-day cap, and a prompt template that cannot carry
//! watched bytes.
//!
//! Two layers sharing one fixture: [`FakeDispatchSeam`] drives
//! [`drain_delegation_events`](drogon_core::bots::delegation::drain_delegation_events)
//! directly for seam-level precision (prompt bytes, dispatch counts, no
//! processes spawned), while the state itself is created by a real
//! [`Engine`] (aggregate migrations, workspace/bot/monitor RPCs) so the
//! outbox table drained here is the genuine P2 table — never a copy.
//! Fixture-only throughout: no models, no network, no daemon.

use std::cell::RefCell;
use std::path::PathBuf;

use drogon_core::Engine;
use drogon_core::automations::runner::SessionObservation;
use drogon_core::automations::runner::{DispatchSeam, DispatchSeamError, HarnessStarted};
use drogon_core::bots::delegation::{
    self, DELEGATION_GRACE_MS, MAX_DELEGATIONS_PER_BOT_PER_DAY, utc_day_number,
    worktree_name_for_event,
};
use drogon_core::bots::monitors::commit::{CommitDecision, CommitInput, RetainReason};
use drogon_core::bots::monitors::result::MonitorCheckResult;
use drogon_core::bots::storage as bstorage;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

const RESOURCE: &str = "notes/status.md";

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn ok(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

/// Counting seam: every `harness_start` mints a fresh session id (so two
/// dispatches are distinguishable) and records its params (so the prompt
/// is inspectable). Never spawns anything.
struct FakeDispatchSeam {
    harness_start_calls: RefCell<Vec<(String, Value)>>,
    session_counter: RefCell<usize>,
    fail_start: RefCell<Option<DispatchSeamError>>,
}

impl FakeDispatchSeam {
    fn new() -> Self {
        Self {
            harness_start_calls: RefCell::new(Vec::new()),
            session_counter: RefCell::new(0),
            fail_start: RefCell::new(None),
        }
    }

    fn dispatch_count(&self) -> usize {
        self.harness_start_calls.borrow().len()
    }

    fn prompts(&self) -> Vec<String> {
        self.harness_start_calls
            .borrow()
            .iter()
            .map(|(_, params)| {
                params
                    .get("prompt")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            })
            .collect()
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
            verdict: "live".to_string(),
            exit_code: None,
        })
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    _engine: Engine,
    db_path: PathBuf,
    workspace_id: String,
    host_id: String,
    bot_id: String,
    folder: String,
    monitor_id: String,
    responsibility_id: String,
    seam: FakeDispatchSeam,
}

impl Fixture {
    /// Real Engine for state creation (migrations + RPCs) plus a direct
    /// second connection for outbox/history inspection. The Engine itself
    /// stays idle: drains below call [`drain_delegation_events`] directly
    /// with the fake seam, so no process ever spawns.
    fn new() -> Self {
        Self::with_monitor(json!({"manual": true}))
    }

    /// `extra` extends the `bot.monitor_create` params (e.g. a cron for a
    /// Scheduled monitor, or no binding for a NotificationOnly one).
    /// Returns the fixture plus whether a responsibility was bound.
    fn with_monitor(extra: Value) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let folder = dir.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        std::fs::create_dir(folder.join("notes")).unwrap();
        std::fs::write(folder.join(RESOURCE), b"v1 bytes").unwrap();
        let registered = ok(engine.dispatch(request(
            "ws-register",
            "workspace.register",
            json!({"path": folder}),
        )));
        let workspace_id = registered["id"].as_str().unwrap().to_string();
        let host_id = registered["hostId"].as_str().unwrap().to_string();
        // Delegation resolves event.project_id as a workspace id, then
        // requires the separately registered Project id for worktree.create.
        ok(engine.dispatch(request(
            "project-add",
            "project.add",
            json!({"path": folder}),
        )));
        let bot = ok(engine.dispatch(request(
            "bot-create",
            "bot.create",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {"displayName": "Watcher", "handle": null, "title": null},
                    "harnessPolicy": {"defaultHarness": "codex", "explicitModel": null},
                    "instructions": "Guard the realm.",
                    "memories": [],
                },
            }),
        )));
        let bot_id = bot["id"].as_str().unwrap().to_string();
        let mut create_params = json!({
            "workspaceId": workspace_id,
            "hostId": host_id,
            "botId": bot_id,
            "monitorId": "mon-1",
            "resource": RESOURCE,
            "responsibilityName": "triage",
            "instructions": "Triage the change.",
        });
        for (k, v) in extra.as_object().unwrap() {
            create_params[k] = v.clone();
        }
        let created = ok(engine.dispatch(request("m-create", "bot.monitor_create", create_params)));
        assert_eq!(created["approved"], false);
        let responsibility_id = created["responsibilityId"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let approved = ok(engine.dispatch(request(
            "m-approve",
            "bot.monitor_approve",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "botId": bot_id,
                "monitorId": "mon-1",
            }),
        )));
        assert_eq!(approved["approved"], true);
        Self {
            db_path: dir.path().join("drogon.sqlite3"),
            _dir: dir,
            _engine: engine,
            workspace_id,
            host_id,
            bot_id,
            // Canonicalized: bot scopes stamp the canonical folder
            // (the /private-prefixed canonical path on macOS), and history reads fence on it.
            folder: std::fs::canonicalize(&folder)
                .unwrap()
                .to_string_lossy()
                .to_string(),
            monitor_id: "mon-1".to_string(),
            responsibility_id,
            seam: FakeDispatchSeam::new(),
        }
    }

    fn conn(&self) -> Connection {
        Connection::open(&self.db_path).unwrap()
    }

    fn now_ms() -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64
    }

    /// Enqueue one well-formed P2 outbox row through the genuine P2
    /// writer. `event_no` distinguishes events; `at` sets the observed
    /// clock (backdate it to model an outage).
    fn enqueue(&self, event_no: u64, at: f64) -> String {
        self.enqueue_for(&self.monitor_id.clone(), event_no, at)
    }

    fn enqueue_for(&self, monitor_id: &str, event_no: u64, at: f64) -> String {
        self.enqueue_resource_for(monitor_id, event_no, at, RESOURCE)
    }

    fn enqueue_resource_for(
        &self,
        monitor_id: &str,
        event_no: u64,
        at: f64,
        resource: &str,
    ) -> String {
        let digest = drogon_core::bots::monitors::eval::digest_bytes(
            format!("payload {monitor_id} {event_no} {resource}").as_bytes(),
        );
        let cursor = drogon_core::bots::monitors::eval::cursor_for_digest(&digest);
        let event_id =
            drogon_core::bots::monitors::eval::event_id_for(monitor_id, &"aa".repeat(32), &digest);
        let payload = json!({
            "eventId": event_id,
            "monitorId": monitor_id,
            "monitorVersion": 1,
            "cursor": cursor,
            "hostId": self.host_id,
            "projectId": self.workspace_id,
            "resource": resource,
            "botId": self.bot_id,
            "observedAtMs": at,
        });
        let conn = self.conn();
        let tx = conn.unchecked_transaction().unwrap();
        drogon_core::bot_self_mgmt::record_monitor_event_in_tx(
            &tx,
            &event_id,
            monitor_id,
            Some(&self.bot_id),
            at,
            &payload,
        )
        .unwrap();
        tx.commit().unwrap();
        event_id
    }

    fn drain(&self, now_ms: f64) -> delegation::DelegationSummary {
        let conn = self.conn();
        let db = std::sync::Mutex::new(conn);
        delegation::drain_delegation_events(&db, &self.host_id, &self.seam, now_ms)
    }

    fn outbox_len(&self) -> usize {
        self.conn()
            .query_row("SELECT COUNT(*) FROM bot_monitor_events", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap() as usize
    }

    fn run_history_len(&self) -> usize {
        let conn = self.conn();
        bstorage::history_for_bot(&conn, &self.host_id, &self.folder, &self.bot_id)
            .unwrap()
            .len()
    }

    fn used_today(&self, now_ms: f64) -> i64 {
        let conn = self.conn();
        delegation::delegations_used_today(&conn, &self.bot_id, now_ms).unwrap()
    }
}

// --- The chain: one event → exactly one dispatch ---------------------------

#[test]
fn one_event_produces_exactly_one_dispatch() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    let event_id = fixture.enqueue(1, now);
    assert_eq!(fixture.outbox_len(), 1);

    let drained = fixture.drain(now);
    assert_eq!(
        drained.dispatched, 1,
        "one event → one dispatch: {drained:?}"
    );
    assert_eq!(fixture.seam.dispatch_count(), 1);
    assert_eq!(
        fixture.outbox_len(),
        0,
        "dispatched events leave the outbox"
    );
    assert_eq!(fixture.run_history_len(), 1);

    let conn = fixture.conn();
    let history =
        bstorage::history_for_bot(&conn, &fixture.host_id, &fixture.folder, &fixture.bot_id)
            .unwrap();
    assert_eq!(
        history[0].responsibility_run.responsibility_id,
        fixture.responsibility_id
    );
    assert!(history[0].responsibility_run.automation_id.is_none());
    assert!(history[0].responsibility_run.automation_run_id.is_none());

    // The delegation prompt carries the deterministic worktree name and the
    // event id, and instructs the Bot's worktree/session/prompt sequence.
    let prompts = fixture.seam.prompts();
    assert_eq!(prompts.len(), 1);
    assert!(prompts[0].contains(&worktree_name_for_event(&event_id)));
    assert!(prompts[0].contains(&event_id));
    assert!(prompts[0].contains("drogon-cli worktree create"));
    assert!(prompts[0].contains("drogon-cli harness start"));
    assert!(prompts[0].contains("--permission-mode unattended"));
    assert!(prompts[0].contains("terminal wait --session <id>"));
    assert!(prompts[0].contains("terminal read"));
    assert!(!prompts[0].contains("terminal send"));
}

#[test]
fn workspace_without_registered_project_is_refused_without_dispatch() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    fixture
        .conn()
        .execute("DELETE FROM projects WHERE path = ?1", [&fixture.folder])
        .unwrap();
    fixture.enqueue(1, now);

    let drained = fixture.drain(now);
    assert_eq!(drained.refused, 1, "{drained:?}");
    assert_eq!(fixture.seam.dispatch_count(), 0);
    assert_eq!(fixture.outbox_len(), 0);
    let evidence =
        delegation::firing_evidence_for_monitor(&fixture.conn(), &fixture.monitor_id, now)
            .expect("refusal is durable");
    let detail = evidence.detail.expect("refusal detail");
    assert!(detail.contains("drogon-cli project add"), "{detail}");
    assert!(detail.contains(&fixture.workspace_id), "{detail}");
}

#[test]
fn file_resource_named_pull_is_not_treated_as_a_pull_request_case() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    fixture.enqueue_resource_for(&fixture.monitor_id, 17, now, "pull/17");

    let event_id = fixture
        .conn()
        .query_row(
            "SELECT event_id FROM bot_monitor_events LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    let drained = fixture.drain(now);
    assert_eq!(drained.dispatched, 1, "{drained:?}");
    let prompt = fixture.seam.prompts().pop().expect("prompt");
    assert!(prompt.contains(&format!("deleg-{}", &event_id[4..12])));
    assert!(
        !prompt.contains("This case is pull request #17"),
        "{prompt}"
    );
}

// --- Second identical tick: no new dispatch --------------------------------

#[test]
fn second_identical_tick_produces_no_new_dispatch() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    fixture.enqueue(1, now);
    assert_eq!(fixture.drain(now).dispatched, 1);

    // Outbox drained: the next tick has nothing to claim.
    let drained = fixture.drain(now + 15_000.0);
    assert_eq!(drained.claimed, 0);
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 1, "no second session opened");
    assert_eq!(fixture.run_history_len(), 1);
}

#[test]
fn replayed_changed_result_collapses_to_duplicate_tick() {
    // The race the CAS guards: two evaluations of the same new bytes before
    // either commits. The second commit must retain as DuplicateTick and
    // enqueue nothing — unit-level pin of the mechanism the tick relies on.
    use drogon_core::bots::monitors::eval::{cursor_for_digest, digest_bytes, event_id_for};

    let stored = drogon_core::bots::monitors::commit::StoredMonitorState {
        monitor_id: "mon-1".to_string(),
        version: 1,
        cursor: None,
        last_event_id: None,
        enabled: true,
    };
    let digest = digest_bytes(b"payload");
    let cursor = cursor_for_digest(&digest);
    let event_id = event_id_for("mon-1", &"aa".repeat(32), &digest);
    let result = MonitorCheckResult::changed("mon-1", 1, event_id.clone(), cursor.clone(), 10.0);
    let first = drogon_core::bots::monitors::commit::decide_commit(
        &stored,
        "host-1",
        "proj-1",
        RESOURCE,
        Some("bot-1"),
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
    let committed = drogon_core::bots::monitors::commit::StoredMonitorState {
        cursor: Some(cursor),
        last_event_id: Some(intent.event_id),
        ..stored
    };
    assert_eq!(
        drogon_core::bots::monitors::commit::decide_commit(
            &committed,
            "host-1",
            "proj-1",
            RESOURCE,
            Some("bot-1"),
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
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    let event_id = fixture.enqueue(1, now);
    let expected_worktree = worktree_name_for_event(&event_id);
    assert_eq!(fixture.drain(now).dispatched, 1);
    assert!(fixture.seam.prompts()[0].contains(&expected_worktree));

    // Crash-redelivery of the same event (row back, same content-bound id).
    fixture.enqueue(1, now);
    let drained = fixture.drain(now + 1_000.0);
    assert_eq!(drained.joined_existing, 1, "replay joins: {drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(
        fixture.seam.dispatch_count(),
        1,
        "no second harness.start: no second session, and the prompt's \
         deterministic worktree name means no second worktree either"
    );
    assert_eq!(fixture.run_history_len(), 1, "still exactly one run row");
}

// --- Outage past grace: skip, resume, no catch-up storm -------------------

#[test]
fn outage_past_grace_skips_without_catch_up_storm() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    // Queue an event, then let the daemon "die" past the grace window.
    fixture.enqueue(1, now);
    assert_eq!(fixture.outbox_len(), 1);
    let drained = fixture.drain(now + DELEGATION_GRACE_MS + 1.0);
    assert_eq!(drained.skipped_stale, 1, "stale event skipped: {drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    assert_eq!(fixture.outbox_len(), 0);
    assert_eq!(fixture.run_history_len(), 0);

    // A genuinely new change after the outage still delegates exactly
    // once — one skip's worth of history, never a storm.
    let later = now + DELEGATION_GRACE_MS + 2_000.0;
    fixture.enqueue(2, later);
    let drained = fixture.drain(later);
    assert_eq!(drained.dispatched, 1);
    assert_eq!(fixture.run_history_len(), 1);
}

// --- Per-day cap: honest state, no flood ----------------------------------

#[test]
fn already_capped_bot_settles_every_peeked_excess_event() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    let day = utc_day_number(now);
    fixture
        .conn()
        .execute(
            "INSERT INTO bot_delegation_daily (bot_id, day_utc, count) VALUES (?1, ?2, ?3)",
            params![fixture.bot_id, day, MAX_DELEGATIONS_PER_BOT_PER_DAY],
        )
        .unwrap();
    for event_no in 1..=12u64 {
        fixture.enqueue(event_no, now + event_no as f64);
    }

    let drained = fixture.drain(now + 100.0);
    assert_eq!(drained.claimed, delegation::MAX_DRAIN_PER_TICK);
    assert_eq!(drained.cap_exceeded, delegation::MAX_DRAIN_PER_TICK);
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.outbox_len(), 12 - delegation::MAX_DRAIN_PER_TICK);
}

#[test]
fn delegation_cap_trips_with_an_honest_state() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    // Eleven distinct changes, no drains yet.
    for event_no in 1..=11u64 {
        fixture.enqueue(event_no, now);
    }
    assert_eq!(fixture.outbox_len(), 11);

    // Drain until empty (bounded claims per pass).
    let mut totals = delegation::DelegationSummary::default();
    for _ in 0..8 {
        let drained = fixture.drain(now + 1_000.0);
        totals.dispatched += drained.dispatched;
        totals.cap_exceeded += drained.cap_exceeded;
        totals.claimed += drained.claimed;
        if fixture.outbox_len() == 0 {
            break;
        }
    }
    assert_eq!(totals.dispatched, MAX_DELEGATIONS_PER_BOT_PER_DAY as usize);
    assert_eq!(totals.cap_exceeded, 1, "the 11th event exceeds the cap");
    assert_eq!(
        fixture.seam.dispatch_count(),
        MAX_DELEGATIONS_PER_BOT_PER_DAY as usize
    );
    assert_eq!(fixture.outbox_len(), 0);
    assert_eq!(
        fixture.run_history_len(),
        MAX_DELEGATIONS_PER_BOT_PER_DAY as usize
    );

    // Honest state: the durable counter reads back used/max.
    assert_eq!(
        fixture.used_today(now + 1_000.0),
        MAX_DELEGATIONS_PER_BOT_PER_DAY
    );

    // A fresh change the same day still trips the cap, honestly.
    fixture.enqueue(12, now + 2_000.0);
    let drained = fixture.drain(now + 2_000.0);
    assert_eq!(drained.cap_exceeded, 1);
    assert_eq!(
        fixture.seam.dispatch_count(),
        MAX_DELEGATIONS_PER_BOT_PER_DAY as usize
    );

    // Next UTC day: budget renews, delegation flows again.
    let next_day = (utc_day_number(now) + 1) as f64 * 86_400_000.0 + 1_000.0;
    fixture.enqueue(13, next_day);
    let drained = fixture.drain(next_day);
    assert_eq!(drained.dispatched, 1, "new day, new budget: {drained:?}");
}

// --- Template rule: raw watched content never reaches the prompt ----------

#[test]
fn delegation_prompt_never_contains_raw_watched_content() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    // A canary smuggled into the outbox payload body (the one free-text
    // surface a future producer could abuse): the template must still not
    // carry it into the prompt, because the prompt is built from
    // structured fields only.
    let canary = "CANARY-WATCHED-BYTES-9f3c-do-not-paste";
    let digest = drogon_core::bots::monitors::eval::digest_bytes(canary.as_bytes());
    let cursor = drogon_core::bots::monitors::eval::cursor_for_digest(&digest);
    let event_id = drogon_core::bots::monitors::eval::event_id_for(
        &fixture.monitor_id,
        &"aa".repeat(32),
        &digest,
    );
    let payload = json!({
        "eventId": event_id,
        "monitorId": fixture.monitor_id,
        "monitorVersion": 1,
        "cursor": cursor,
        "hostId": fixture.host_id,
        "projectId": fixture.workspace_id,
        "resource": RESOURCE,
        "botId": fixture.bot_id,
        "observedAtMs": now,
        "note": canary,
    });
    let conn = fixture.conn();
    let tx = conn.unchecked_transaction().unwrap();
    drogon_core::bot_self_mgmt::record_monitor_event_in_tx(
        &tx,
        &event_id,
        &fixture.monitor_id,
        Some(&fixture.bot_id),
        now,
        &payload,
    )
    .unwrap();
    tx.commit().unwrap();

    let drained = fixture.drain(now);
    assert_eq!(drained.dispatched, 1);
    let prompts = fixture.seam.prompts();
    assert_eq!(prompts.len(), 1);
    assert!(
        !prompts[0].contains(canary),
        "raw watched bytes in the prompt"
    );
    // Structured fields ARE present: the delegation is still actionable.
    assert!(prompts[0].contains(&fixture.monitor_id));
    assert!(prompts[0].contains(RESOURCE));
    assert!(prompts[0].contains("triage"));
}

// --- Claim protocol pin: delete-on-record, no claim column -----------------

#[test]
fn outbox_claim_is_delete_on_record_with_no_claim_column() {
    // The P2 outbox this drain consumes must have no claim column: the
    // claim is the delete in the record transaction (pinned here so a
    // future claim-column migration fails this test loudly instead of
    // silently changing the protocol).
    let fixture = Fixture::new();
    let columns: Vec<String> = fixture
        .conn()
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
    for required in ["event_id", "monitor_id", "payload_json"] {
        assert!(
            columns.iter().any(|c| c == required),
            "drain contract needs column {required}, found: {columns:?}"
        );
    }

    // Duplicate enqueue of the same content-bound id collapses: one row
    // (the P2 writer's INSERT OR IGNORE, asserted through the real writer).
    let now = Fixture::now_ms();
    fixture.enqueue(1, now);
    fixture.enqueue(1, now);
    assert_eq!(fixture.outbox_len(), 1);
}

// --- Policy gates: notification-only, disabled, orphaned -------------------

#[test]
fn notification_only_monitors_are_never_claimed() {
    // Unbound monitors' rows are another lane's retained evidence: the
    // drain must not claim, dispatch, or delete them.
    let fixture = Fixture::with_monitor(json!({"responsibilityName": null, "instructions": null}));
    let now = Fixture::now_ms();
    fixture.enqueue(1, now);
    let drained = fixture.drain(now);
    assert_eq!(
        drained.claimed, 0,
        "unbound rows are not claimed: {drained:?}"
    );
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    assert_eq!(fixture.outbox_len(), 1, "unbound row persists as evidence");
}

#[test]
fn unbound_backlog_does_not_starve_bound_events() {
    // An older unbound row sits ahead in the outbox; the bound event
    // behind it must still drain — the peek join skips unbound rows
    // instead of stalling on them.
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    // Second, unbound monitor on the same bot.
    let created = ok(fixture._engine.dispatch(request(
        "m-unbound",
        "bot.monitor_create",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "monitorId": "mon-unbound",
            "resource": RESOURCE,
            "manual": true,
        }),
    )));
    assert_eq!(created["approved"], false);
    ok(fixture._engine.dispatch(request(
        "m-unbound-approve",
        "bot.monitor_approve",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "monitorId": "mon-unbound",
        }),
    )));
    // Unbound event is OLDER (ahead in the queue).
    fixture.enqueue_for("mon-unbound", 1, now);
    fixture.enqueue(2, now + 1_000.0);
    assert_eq!(fixture.outbox_len(), 2);
    let drained = fixture.drain(now + 2_000.0);
    assert_eq!(drained.dispatched, 1, "bound event drains: {drained:?}");
    assert_eq!(fixture.seam.dispatch_count(), 1);
    assert_eq!(fixture.outbox_len(), 1, "only the unbound row remains");
    // …and it is the unbound one.
    let conn = fixture.conn();
    let remaining: String = conn
        .query_row("SELECT monitor_id FROM bot_monitor_events", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(remaining, "mon-unbound");
}

#[test]
fn disabled_responsibility_refuses_without_spinning() {
    let fixture = Fixture::new();
    {
        let conn = fixture.conn();
        bstorage::update_bot(
            &conn,
            &fixture.host_id,
            &fixture.folder,
            &fixture.bot_id,
            Fixture::now_ms(),
            |bot| {
                bot.responsibilities[0].enabled = false;
            },
        )
        .unwrap();
    }
    let now = Fixture::now_ms();
    fixture.enqueue(1, now);
    let drained = fixture.drain(now);
    assert_eq!(drained.refused, 1, "{drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    // Deterministic refusal deletes: no poison retry next tick.
    assert_eq!(fixture.outbox_len(), 0);
    let drained = fixture.drain(now + 1_000.0);
    assert_eq!(drained.claimed, 0);
}

#[test]
fn deleting_a_monitor_settles_its_queued_event_with_a_visible_orphaned_verdict() {
    // The bar: a queued event must never sit where nothing will ever
    // happen to it and nothing tells the owner so. Deleting a monitor
    // settles its queued outbox events AT DELETE TIME: the receipt names
    // them, the rows are gone, and a durable firing row records the
    // honest reason (the drain's own orphaned path covers the reverse
    // race — an event queued after the monitor row is gone).
    let fixture = Fixture::new();
    provision_home(&fixture);
    let now = Fixture::now_ms();
    let event_id = fixture.enqueue(1, now);
    let deleted = ok(fixture._engine.dispatch(request(
        "self-delete-monitor",
        "bot.self_delete_monitor",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "actorBotId": fixture.bot_id,
            "monitorId": fixture.monitor_id,
        }),
    )));
    assert_eq!(deleted["removed"], true);
    assert_eq!(
        deleted["abandonedEvents"], 1,
        "the receipt tells the owner at the decision moment: {deleted}"
    );
    assert_eq!(deleted["abandonedEventIds"][0], json!(event_id));
    assert_eq!(fixture.outbox_len(), 0, "nothing is left queued forever");
    let drained = fixture.drain(now);
    assert_eq!(drained.claimed, 0, "the drain has nothing left to pick up");
    // The visible truthful record survives the monitor's deletion: an
    // `orphaned` firing row with the reason, never a silent drop.
    let conn = fixture.conn();
    let row: (String, String, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT outcome, detail, run_id, resource FROM bot_monitor_firings
             WHERE event_id = ?1",
            params![event_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(row.0, "orphaned");
    assert!(
        row.1.contains("monitor deleted before its queued event"),
        "the recorded reason is honest: {}",
        row.1
    );
    assert_eq!(row.2, None, "no run was invented for an abandoned event");
    assert_eq!(
        row.3.as_deref(),
        Some(RESOURCE),
        "the abandoned event still names what it would have released"
    );
}

#[test]
fn an_event_queued_after_its_monitor_was_deleted_is_orphaned_by_the_drain() {
    use drogon_core::bots::monitors::storage as mstorage;

    // The reverse race: the monitor row goes away BETWEEN the queue and
    // the drain (a producer tick that read the monitor before the delete
    // commits after it). The LEFT-JOIN peek must still REACH the event
    // and settle it with a visible, truthful verdict — never leave it in
    // a state where nothing will ever happen to it.
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    let event_id = fixture.enqueue(1, now);
    {
        let conn = fixture.conn();
        assert!(mstorage::delete_monitor(&conn, &fixture.monitor_id).unwrap());
    }
    let drained = fixture.drain(now);
    assert_eq!(drained.orphaned, 1, "the orphan is reached: {drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    assert_eq!(fixture.outbox_len(), 0, "a terminal verdict never retries");
    let conn = fixture.conn();
    let row: (String, String) = conn
        .query_row(
            "SELECT outcome, detail FROM bot_monitor_firings WHERE event_id = ?1",
            params![event_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(row.0, "orphaned");
    assert_eq!(row.1, "monitor row is gone");
}

#[test]
fn harness_failure_records_honestly_without_retry_storm() {
    let fixture = Fixture::new();
    fixture.seam.fail_start.replace(Some(DispatchSeamError {
        code: "harness_unavailable".to_string(),
        message: "no such harness".to_string(),
    }));
    let now = Fixture::now_ms();
    fixture.enqueue(1, now);
    let drained = fixture.drain(now);
    // The attempt happened (one seam call) and its outcome was recorded:
    // the event is gone, the run row exists with no host observation.
    assert_eq!(drained.dispatched, 1, "{drained:?}");
    assert_eq!(fixture.seam.dispatch_count(), 1);
    assert_eq!(fixture.outbox_len(), 0);
    assert_eq!(fixture.run_history_len(), 1);
    let conn = fixture.conn();
    let history =
        bstorage::history_for_bot(&conn, &fixture.host_id, &fixture.folder, &fixture.bot_id)
            .unwrap();
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
fn pr_case_worktree_names_are_case_scoped_and_stable() {
    use drogon_core::bots::delegation::worktree_name_for_pr_case;
    let a = worktree_name_for_pr_case(17, "clioo/drogon");
    assert_eq!(a, "review-pr-17-clioo-drogon");
    // A redelivery of the same case reuses the exact name.
    assert_eq!(a, worktree_name_for_pr_case(17, "clioo/drogon"));
    // Two different repositories sharing a PR number never collapse into
    // one worktree.
    assert_ne!(a, worktree_name_for_pr_case(17, "clioo/other"));
    // Branch-safe: the slug is alphanumeric and dashes only.
    assert!(a.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-'));
}

#[test]
fn delegation_identity_is_the_case_for_pull_requests_and_the_event_otherwise() {
    use drogon_core::bots::delegation::{DelegationEvent, delegation_identity};
    let base = DelegationEvent {
        event_id: "mev_a".to_string(),
        monitor_id: "mon-1".to_string(),
        monitor_version: 1,
        cursor: "v1:aa".to_string(),
        host_id: "h".to_string(),
        project_id: "p".to_string(),
        resource: "pull/17".to_string(),
        bot_id: Some("bot-1".to_string()),
        observed_at_ms: 1.0,
    };
    // Two DIFFERENT events (two watches) for the same PR case share one
    // identity: the second release joins the first run.
    let mut other = base.clone();
    other.event_id = "mev_b".to_string();
    assert_eq!(
        delegation_identity(&base, Some("clioo/drogon"), Some(17)),
        delegation_identity(&other, Some("clioo/drogon"), Some(17))
    );
    // A different repo (or number) is a different case, and a non-PR
    // event keeps its own event id as the identity.
    assert_ne!(
        delegation_identity(&base, Some("clioo/drogon"), Some(17)),
        delegation_identity(&base, Some("clioo/other"), Some(17))
    );
    assert_ne!(
        delegation_identity(&base, Some("clioo/drogon"), Some(17)),
        delegation_identity(&base, Some("clioo/drogon"), Some(18))
    );
    assert_eq!(delegation_identity(&base, None, None), base.event_id);
}

#[test]
fn a_version_2_database_gains_the_firing_resource_column_in_place() {
    // Schema version 3 is additive: databases that already carry the
    // version-2 firing table gain the released case's `resource` column
    // via ALTER (never a rebuild), rows written before the upgrade keep
    // NULL, and the recorded component version advances.
    let dir = tempfile::tempdir().unwrap();
    let conn = Connection::open(dir.path().join("drogon.db")).unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );
        CREATE TABLE bot_monitor_firings (
            event_id TEXT PRIMARY KEY,
            monitor_id TEXT NOT NULL,
            bot_id TEXT,
            responsibility_id TEXT,
            outcome TEXT NOT NULL,
            run_id TEXT,
            detail TEXT,
            at_ms REAL NOT NULL
        );
        INSERT INTO schema_versions(component, version) VALUES ('bot_delegation', 2);
        INSERT INTO bot_monitor_firings
            (event_id, monitor_id, outcome, at_ms)
            VALUES ('mev_old', 'mon-1', 'dispatched', 1.0);",
    )
    .unwrap();
    drogon_core::bots::delegation::migrate(&conn).unwrap();
    let version: i64 = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = 'bot_delegation'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        version,
        drogon_core::bots::delegation::DELEGATION_SCHEMA_VERSION
    );
    // The pre-upgrade row survives with a NULL resource — the view must
    // never fabricate a case for evidence written before the column.
    let resource: Option<String> = conn
        .query_row(
            "SELECT resource FROM bot_monitor_firings WHERE event_id = 'mev_old'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(resource, None);
    // Re-running the migration is idempotent (the pragma guard).
    drogon_core::bots::delegation::migrate(&conn).unwrap();
}

#[test]
fn delegation_request_ids_are_stable_per_event() {
    let host = "host-1";
    let a = delegation::delegation_request_id(host, "/repo", "bot-1", "resp-1", "mev_aaa");
    let b = delegation::delegation_request_id(host, "/repo", "bot-1", "resp-1", "mev_aaa");
    assert_eq!(a, b);
    assert_ne!(
        a,
        delegation::delegation_request_id(host, "/repo", "bot-1", "resp-1", "mev_aab")
    );
}

#[test]
fn outbox_row_with_unparseable_payload_is_orphaned_not_retried() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    {
        let conn = fixture.conn();
        conn.execute(
            "INSERT INTO bot_monitor_events (event_id, monitor_id, bot_id, at, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                "mev_poison",
                "mon-1",
                fixture.bot_id,
                now,
                "this is not json{{{"
            ],
        )
        .unwrap();
    }
    let drained = fixture.drain(now);
    assert_eq!(drained.orphaned, 1, "{drained:?}");
    assert_eq!(drained.claimed, 1);
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.outbox_len(), 0);
}

// --- The self lane: a Bot's own monitor declares and releases an action ----

/// Adds a provisioned home to the fixture, so the `bot.self_*` lane is
/// authorized for the fixture bot.
fn provision_home(fixture: &Fixture) {
    ok(fixture._engine.dispatch(request(
        "self-provision",
        "bot.self_provision",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "actorBotId": fixture.bot_id,
        }),
    )));
}

#[test]
fn self_created_monitor_with_action_dispatches_and_replays_join() {
    let fixture = Fixture::new();
    provision_home(&fixture);
    // The Bot creates its own monitor through the self lane AND declares
    // the action it releases — a fresh reactive responsibility minted
    // from a name plus standing instructions.
    let created = ok(fixture._engine.dispatch(request(
        "self-create-monitor",
        "bot.self_create_monitor",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "actorBotId": fixture.bot_id,
            "resource": RESOURCE,
            "trigger": {"kind": "scheduled", "cron": "* * * * *"},
            "responsibilityName": "Triage changes",
            "instructions": "Check the diff behind the event and report.",
        }),
    )));
    let self_monitor_id = created["monitorId"].as_str().unwrap().to_string();
    let bound_resp = created["responsibilityId"].as_str().unwrap().to_string();
    assert!(
        !bound_resp.is_empty(),
        "a self-created monitor with an action is bound at create time"
    );
    assert_eq!(created["approved"], true, "file digests self-approve");

    let now = Fixture::now_ms();
    let event_id = fixture.enqueue_for(&self_monitor_id, 1, now);
    let drained = fixture.drain(now);
    assert_eq!(
        drained.dispatched, 1,
        "the self-lane monitor's event must release its action: {drained:?}"
    );
    assert_eq!(fixture.seam.dispatch_count(), 1);
    assert_eq!(fixture.outbox_len(), 0);

    // The prompt is the template: standing instructions + event metadata,
    // never the watched bytes (the enqueue digest marker names content).
    let prompt = &fixture.seam.prompts()[0];
    assert!(
        prompt.contains("Check the diff behind the event and report."),
        "instructions reach the template: {prompt}"
    );
    assert!(prompt.contains(&event_id), "event id reaches the template");
    assert!(
        !prompt.contains("payload"),
        "watched bytes never enter the prompt: {prompt}"
    );

    // The run history records the origin honestly: a monitor-released
    // run is `reactive`, not a schedule fire and not a human click.
    let conn = fixture.conn();
    let history =
        bstorage::history_for_bot(&conn, &fixture.host_id, &fixture.folder, &fixture.bot_id)
            .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(
        history[0].responsibility_run.responsibility_id, bound_resp,
        "the dispatched responsibility is the self-lane action"
    );
    assert_eq!(
        history[0].responsibility_run.invocation,
        Some(drogon_core::bots::records::ResponsibilityRunInvocation::Reactive),
        "monitor-released runs carry their own invocation bucket"
    );

    // Replay of the SAME event joins the existing run — never a second
    // session — and the firing row updates, never duplicates.
    fixture.enqueue_for(&self_monitor_id, 1, now);
    let replayed = fixture.drain(now + 1.0);
    assert_eq!(replayed.joined_existing, 1, "{replayed:?}");
    assert_eq!(replayed.dispatched, 0);
    assert_eq!(fixture.seam.dispatch_count(), 1);
    let firings: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bot_monitor_firings WHERE monitor_id = ?1",
            params![&self_monitor_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        firings, 1,
        "replays refresh one firing row, never duplicate"
    );
}

#[test]
fn self_created_monitor_without_action_stays_observes_only() {
    let fixture = Fixture::new();
    provision_home(&fixture);
    let created = ok(fixture._engine.dispatch(request(
        "self-create-plain",
        "bot.self_create_monitor",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "actorBotId": fixture.bot_id,
            "resource": RESOURCE,
            "trigger": {"kind": "scheduled", "cron": "* * * * *"},
        }),
    )));
    assert_eq!(
        created["responsibilityId"],
        json!(null),
        "no declared action: the monitor observes and records only"
    );
    let self_monitor_id = created["monitorId"].as_str().unwrap().to_string();
    let now = Fixture::now_ms();
    fixture.enqueue_for(&self_monitor_id, 1, now);
    let drained = fixture.drain(now);
    assert_eq!(
        drained.claimed, 0,
        "unbound rows stay another lane's evidence"
    );
    assert_eq!(fixture.seam.dispatch_count(), 0);
    assert_eq!(fixture.outbox_len(), 1, "the event persists untouched");
}

#[test]
fn firing_evidence_surfaces_through_monitor_list() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    let event_id = fixture.enqueue(1, now);
    let drained = fixture.drain(now);
    assert_eq!(drained.dispatched, 1);

    let listed = ok(fixture._engine.dispatch(request(
        "monitor-list",
        "bot.monitor_list",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
        }),
    )));
    let view = &listed["monitors"][0];
    assert_eq!(view["firing"]["lastOutcome"], "dispatched");
    assert_eq!(view["firing"]["countToday"], 1);
    let run_id = view["firing"]["lastRunId"].as_str().unwrap();
    let conn = fixture.conn();
    let history =
        bstorage::history_for_bot(&conn, &fixture.host_id, &fixture.folder, &fixture.bot_id)
            .unwrap();
    assert_eq!(
        history[0].responsibility_run.id, run_id,
        "the firing names the exact run row the user can open"
    );
    // No firing existed before this evidence path — the absence is
    // honest (a monitor that never released an action shows null), and
    // the fired event id is the one the enqueue produced.
    assert_eq!(view["firing"]["lastEventId"], json!(event_id));
}

#[test]
fn missing_responsibility_surfaces_an_honest_orphaned_firing() {
    let fixture = Fixture::new();
    // The bound responsibility is deleted after the monitor fired its
    // event; the drain must record the honest refusal, not swallow it.
    ok(fixture._engine.dispatch(request(
        "resp-delete",
        "bot.responsibility_delete",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "responsibilityId": fixture.responsibility_id,
        }),
    )));
    let now = Fixture::now_ms();
    fixture.enqueue(1, now);
    let drained = fixture.drain(now);
    assert_eq!(drained.orphaned, 1, "{drained:?}");
    assert_eq!(drained.dispatched, 0);
    assert_eq!(fixture.outbox_len(), 0, "a terminal verdict never retries");

    let listed = ok(fixture._engine.dispatch(request(
        "monitor-list",
        "bot.monitor_list",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
        }),
    )));
    let view = &listed["monitors"][0];
    assert_eq!(view["firing"]["lastOutcome"], "orphaned");
    let detail = view["firing"]["lastDetail"].as_str().unwrap();
    assert!(
        detail.contains("responsibility"),
        "the refusal names its real reason: {detail}"
    );
    assert_eq!(view["firing"]["lastRunId"], json!(null));
}

#[test]
fn stale_event_records_too_old_to_act() {
    let fixture = Fixture::new();
    let now = Fixture::now_ms();
    fixture.enqueue(1, now - (DELEGATION_GRACE_MS + 60_000.0));
    let drained = fixture.drain(now);
    assert_eq!(drained.skipped_stale, 1);
    assert_eq!(fixture.seam.dispatch_count(), 0);
    let listed = ok(fixture._engine.dispatch(request(
        "monitor-list",
        "bot.monitor_list",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
        }),
    )));
    let view = &listed["monitors"][0];
    assert_eq!(view["firing"]["lastOutcome"], "stale_skipped");
    assert!(
        view["firing"]["lastDetail"]
            .as_str()
            .unwrap()
            .contains("grace"),
        "the detail names the outage grace: {:?}",
        view["firing"]["lastDetail"]
    );
}
