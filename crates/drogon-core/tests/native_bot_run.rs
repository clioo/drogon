//! Tests for the `bot.run` bridge (`bot_run_rpc`) against a real
//! `Engine::open` store. Engine-created schema is exercised through a second
//! raw connection to the same `drogon.sqlite3` file (the established
//! `bot_automation_engine_startup` pattern); dispatches use an injected
//! fake seam so no test ever completes a real `harness.start` admission —
//! successful-dispatch paths assert through the fake, and every other test
//! asserts refusals/validation/errors only.
//!
//! Idempotency is DELEGATED (ROOT directive, A6c): this module owns no DDL
//! and no table. The suite injects an in-memory `LedgerDouble` implementing
//! the module's `ReceiptLedger` seam (admit semantics mirroring the admitted
//! `RequestLedger`: identical replay returns the stored receipt verbatim,
//! changed fingerprint under the same envelope id is the frozen
//! `request_conflict` rejection). Ledger-backed end-to-end replay against
//! the real `RequestLedger` is ROOT-wiring-tested — see the A6c delivery
//! report for the exact plan.
//!
//! PROVISIONAL BINDING SEAM: `bot_run_rpc` is not yet registered in
//! `lib.rs` (ROOT owns registration). It is compiled into this integration
//! test via `#[path]`, and the module itself only uses `drogon_core::`
//! paths, so after ROOT adds `pub mod bot_run_rpc;` the seam below can be
//! replaced by `use drogon_core::bot_run_rpc;` with zero test changes.

#[path = "../src/bot_run_rpc.rs"]
mod bot_run_rpc;

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use drogon_core::automations::records::{
    Automation, ExecutionTargetType, MissedRunPolicy, SchedulerOwner, WorkspaceMode,
};
use drogon_core::automations::runner::{
    DispatchSeam, DispatchSeamError, HarnessStarted, SessionObservation, derive_request_id,
};
use drogon_core::automations::storage as astorage;
use drogon_core::bots::records::{
    Bot, DEFAULT_DROGON_BOT_HARNESS, DisplayIdentity, HarnessModelPolicy, Responsibility,
    ResponsibilityKind, ResponsibilityTrigger,
};
use drogon_core::bots::storage as bstorage;
use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, RpcError};
use serde_json::{Value, json};

use bot_run_rpc::{BotRunCaller, ReceiptLedger, handle_bot_run};

/// One deterministic server clock for the whole suite; receipts must be
/// byte-stable across replays, so `recordedAt` must never call the wall clock.
const NOW_UNIX: u64 = 1_797_724_800; // 2026-09-09T00:00:00Z, second resolution

struct CountingSeam {
    starts: Cell<usize>,
}

impl DispatchSeam for CountingSeam {
    fn harness_start(
        &self,
        _request_id: &str,
        _params: Value,
    ) -> Result<HarnessStarted, DispatchSeamError> {
        self.starts.set(self.starts.get() + 1);
        Ok(HarnessStarted {
            session_id: "session-1".to_string(),
            incarnation: "incarnation-1".to_string(),
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

/// In-memory ledger double implementing the module's `ReceiptLedger` seam.
/// Admit semantics mirror the admitted `RequestLedger`: identical
/// (id, fingerprint) replay returns the stored receipt verbatim; a changed
/// fingerprint under the same id is the frozen `request_conflict` rejection;
/// first admission runs `work` exactly once and stores the receipt. Every
/// consult is logged so delegation itself is observable. Never a real table.
struct LedgerDouble {
    stored: RefCell<HashMap<String, (String, Value)>>,
    log: RefCell<Vec<String>>,
}

impl LedgerDouble {
    fn new() -> Self {
        Self {
            stored: RefCell::new(HashMap::new()),
            log: RefCell::new(Vec::new()),
        }
    }

    fn consults(&self) -> Vec<String> {
        self.log.borrow().clone()
    }

    /// Tamper with the stored receipt so a replay that returns it verbatim
    /// is distinguishable from a rebuild.
    fn mark_stored(&self, request_id: &str) {
        let mut stored = self.stored.borrow_mut();
        if let Some((_, receipt)) = stored.get_mut(request_id) {
            receipt["storageProbe"] = json!("returned-from-ledger");
        }
    }
}

impl ReceiptLedger for LedgerDouble {
    fn admit<F>(&self, request_id: &str, fingerprint: &str, work: F) -> Result<Value, RpcError>
    where
        F: FnOnce() -> Result<Value, RpcError>,
    {
        self.log.borrow_mut().push(format!("admit:{request_id}"));
        let mut stored = self.stored.borrow_mut();
        match stored.get(request_id) {
            Some((stored_fingerprint, receipt)) if stored_fingerprint == fingerprint => {
                Ok(receipt.clone())
            }
            Some(_) => Err(RpcError::new(
                "request_conflict",
                "requestId was already used with different parameters.",
            )),
            None => {
                let receipt = work()?;
                stored.insert(
                    request_id.to_string(),
                    (fingerprint.to_string(), receipt.clone()),
                );
                Ok(receipt)
            }
        }
    }
}

fn fixture() -> (tempfile::TempDir, Engine, rusqlite::Connection, String) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "discover-host".to_string(),
        auth: None,
        method: "status".to_string(),
        params: json!({}),
    });
    assert!(response.ok, "status must succeed: {response:?}");
    let host = response.result.unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    (dir, engine, conn, host)
}

fn seed_workspace(conn: &rusqlite::Connection, host: &str) {
    conn.execute(
        "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params!["ws-1", "/repo", "repo", "folder", host, "2026-09-09T00:00:00Z"],
    )
    .unwrap();
}

fn seed_scheduled_bot(conn: &rusqlite::Connection, host: &str, responsibility_enabled: bool) {
    let bot = Bot {
        id: "bot-1".to_string(),
        character_preset: "none".to_string(),
        display_identity: DisplayIdentity {
            display_name: "Watcher".to_string(),
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
            id: "resp-1".to_string(),
            name: "Nightly review".to_string(),
            instructions: String::new(),
            kind: ResponsibilityKind::Scheduled,
            trigger: ResponsibilityTrigger::Scheduled {
                automation_id: "auto-1".to_string(),
            },
            enabled: responsibility_enabled,
            recipe: None,
            created_at: 0.0,
            updated_at: 0.0,
        }],
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    };
    bstorage::create_bot(conn, host, "/repo", &bot).unwrap();
    let automation = Automation {
        id: "auto-1".to_string(),
        creation_key: None,
        name: "Nightly review".to_string(),
        prompt: "inspect the workspace".to_string(),
        precheck: None,
        agent_id: "codex".to_string(),
        run_context: None,
        source_context: None,
        project_id: "proj-1".to_string(),
        execution_target_type: ExecutionTargetType::Local,
        execution_target_id: host.to_string(),
        execution_target_generation: None,
        scheduler_owner: SchedulerOwner::LocalHostService,
        workspace_mode: WorkspaceMode::Existing,
        workspace_id: Some("ws-1".to_string()),
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: "UTC".to_string(),
        rrule: "FREQ=DAILY".to_string(),
        dtstart: 0.0,
        enabled: true,
        next_run_at: 100.0,
        last_run_at: None,
        missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: 30.0,
        created_at: 0.0,
        updated_at: 0.0,
        bot_id: Some("bot-1".to_string()),
    };
    astorage::upsert_automation(conn, &automation).unwrap();
}

/// `requestId` is NOT an admitted param: the envelope carries it, so the
/// overrides here must never add one.
fn params(host: &str, overrides: Value) -> Value {
    let mut value = json!({
        "workspaceId": "ws-1",
        "hostId": host,
        "botId": "bot-1",
        "responsibilityId": "resp-1",
        "reason": "manual",
        "eventIdentity": "evt-1",
        "harness": { "harnessId": "codex" },
    });
    for (key, val) in overrides.as_object().unwrap() {
        if val.is_null() {
            value.as_object_mut().unwrap().remove(key);
        } else {
            value[key] = val.clone();
        }
    }
    value
}

fn call(
    conn: &rusqlite::Connection,
    host: &str,
    request_id: &str,
    params: &Value,
    caller: &BotRunCaller,
    seam: &CountingSeam,
    ledger: &LedgerDouble,
) -> Result<Value, RpcError> {
    handle_bot_run(
        conn, host, request_id, params, caller, seam, ledger, NOW_UNIX,
    )
}

#[test]
fn strict_schema_rejects_unknown_fields_missing_fields_and_non_admitted_harness() {
    let (_dir, _engine, conn, host) = fixture();
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    // Unknown top-level field is denied.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"extra": 1})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("unknown field"), "{err:?}");

    // `requestId` lives on the native envelope, not in params: a params
    // requestId is an unknown field and is denied.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"requestId": "smuggled"})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("requestId"), "{err:?}");

    // Required responsibilityId is missing in v1.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"responsibilityId": null})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("responsibilityId"), "{err:?}");

    // Empty bot id.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"botId": "  "})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // reason is an explicit enum; eventIdentity never infers it.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"reason": "whenever"})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // Unknown field inside the harness overrides object.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(
            &host,
            json!({"harness": {"harnessId": "codex", "forge": true}}),
        ),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("harness"), "{err:?}");

    assert_eq!(seam.starts.get(), 0, "no dispatch may ever be attempted");
    // Pure rejections consume no admission.
    assert!(
        ledger.consults().is_empty(),
        "validation failures must not touch the ledger"
    );
}

#[test]
fn worker_callers_are_denied_on_this_auth_path_and_consume_no_admission() {
    let (_dir, _engine, conn, host) = fixture();
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotRunCaller::Worker {
            host_id: host.clone(),
            run_id: "run-1".to_string(),
            dispatch_id: "dispatch-1".to_string(),
        },
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "unauthorized");
    assert_eq!(
        err.message,
        "bot.run is desktop-only: worker dispatch credentials are denied on this auth path"
    );
    assert_eq!(seam.starts.get(), 0);
    assert!(
        ledger.consults().is_empty(),
        "an auth denial must not touch the ledger"
    );
}

#[test]
fn foreign_host_assertion_is_refused_as_structured_foreign_workspace_host() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    let receipt = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"hostId": "host-evil"})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(receipt["outcome"], "refused");
    assert_eq!(receipt["hostId"], host.as_str());
    assert_eq!(receipt["workspaceId"], "ws-1");
    assert_eq!(
        receipt["refusal"],
        json!({
            "type": "workspace",
            "kind": "foreignWorkspaceHost",
            "workspaceId": "ws-1",
            "assertedHostId": "host-evil",
            "currentHostId": host,
        })
    );
    // The human message stays alongside the structured refusal.
    assert_eq!(
        receipt["error"],
        format!(
            "foreign workspace host: asserted host host-evil does not match derived host {host}"
        )
    );
    assert!(receipt["automationRunId"].is_null());
    assert!(receipt["responsibilityRunId"].is_null());
    assert!(receipt["session"].is_null());
    assert!(receipt["observedAt"].is_null());
    assert_eq!(receipt["recordedAt"], NOW_UNIX as f64);
    assert_eq!(seam.starts.get(), 0, "a refusal never dispatches");
}

#[test]
fn workspace_owned_by_another_host_is_refused_even_when_the_assertion_matches() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "host-other");
    seed_scheduled_bot(&conn, "host-other", true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    let receipt = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(receipt["outcome"], "refused");
    assert_eq!(
        receipt["refusal"],
        json!({
            "type": "workspace",
            "kind": "foreignWorkspaceHost",
            "workspaceId": "ws-1",
            "workspaceHostId": "host-other",
            "currentHostId": host,
        })
    );
    assert!(
        receipt["error"]
            .as_str()
            .unwrap()
            .starts_with("foreign workspace host: workspace ws-1 belongs to host host-other")
    );
    assert_eq!(seam.starts.get(), 0);
}

#[test]
fn absent_harness_is_unsupported_without_dispatch_or_defaults() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    let receipt = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"harness": null})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(receipt["outcome"], "unsupported");
    assert_eq!(receipt["reason"], json!({"kind": "harnessMappingAbsent"}));
    assert_eq!(
        receipt["error"],
        "no harness mapping exists for this bot: supply admitted harness overrides"
    );
    assert!(receipt["session"].is_null());
    assert_eq!(seam.starts.get(), 0, "no defaults may be invented");
}

#[test]
fn same_envelope_request_id_with_changed_params_is_a_conflicting_params_reject() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    let first = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(first["outcome"], "dispatched");

    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"reason": "scheduledDue"})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "request_conflict");
    assert_eq!(
        err.message,
        "requestId was already used with different parameters."
    );
}

#[test]
fn reordered_params_are_the_same_fingerprint_and_replay_identically() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    // Same semantic request, keys in a different wire order.
    let reordered = json!({
        "harness": { "harnessId": "codex" },
        "eventIdentity": "evt-1",
        "reason": "manual",
        "responsibilityId": "resp-1",
        "botId": "bot-1",
        "hostId": host,
        "workspaceId": "ws-1",
    });

    let first = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    let replay = call(
        &conn,
        &host,
        "req-1",
        &reordered,
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(first, replay, "fingerprint must be wire-order independent");
    assert_eq!(seam.starts.get(), 1);
}

#[test]
fn double_click_replay_returns_the_ledger_stored_receipt_with_a_single_session() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();
    let request = params(&host, json!({}));

    let first = call(
        &conn,
        &host,
        "req-1",
        &request,
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(first["outcome"], "dispatched");
    assert_eq!(first["requestId"], "req-1");
    assert_eq!(first["session"]["sessionId"], "session-1");
    assert_eq!(first["session"]["incarnation"], "incarnation-1");
    assert_eq!(first["observedAt"], NOW_UNIX as f64);
    assert_eq!(first["recordedAt"], NOW_UNIX as f64);

    // Tamper with the stored receipt: a true ledger replay returns the
    // STORED value (probe visible); a rebuild would drop the probe.
    ledger.mark_stored("req-1");
    let second = call(
        &conn,
        &host,
        "req-1",
        &request,
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(second["storageProbe"], "returned-from-ledger");
    // The replay is EXACTLY the stored receipt: identical to the first
    // receipt plus only the deliberate probe — every real field is
    // untouched, nothing is recomputed.
    let mut expected = first.clone();
    expected["storageProbe"] = json!("returned-from-ledger");
    assert_eq!(second, expected);

    assert_eq!(seam.starts.get(), 1, "the replay must not re-dispatch");
    let derived = derive_request_id(&host, "/repo", "bot-1", "resp-1", "evt-1");
    assert_eq!(first["automationRunId"], format!("ar:{derived}").as_str());
    assert_eq!(first["responsibilityRunId"], derived.as_str());
    let runs: i64 = conn
        .query_row("SELECT COUNT(*) FROM automation_runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(runs, 1, "exactly one automation run row");
    let history: i64 = conn
        .query_row("SELECT COUNT(*) FROM bot_responsibility_runs", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(history, 1, "exactly one responsibility history row");
    // The delegation itself is observable: one admit per call, in order.
    assert_eq!(
        ledger.consults(),
        vec!["admit:req-1".to_string(), "admit:req-1".to_string()]
    );
}

#[test]
fn the_bridge_creates_no_tables_and_persists_nothing_itself() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = LedgerDouble::new();

    let before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'bot_run_receipts'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let receipt = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotRunCaller::Desktop,
        &seam,
        &ledger,
    )
    .unwrap();
    assert_eq!(receipt["outcome"], "dispatched");
    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'bot_run_receipts'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, 0);
    assert_eq!(
        after, 0,
        "receipt persistence is the ledger's job, not DDL here"
    );
}
