//! Tests for the `bot.run` bridge (`bot_run_rpc`) against a real
//! `Engine::open` store. Engine-created schema is exercised through a second
//! raw connection to the same `drogon.sqlite3` file (the established
//! `bot_automation_engine_startup` pattern); dispatches use an injected
//! fake seam so no test ever completes a real `harness.start` admission --
//! successful-dispatch paths assert through the fake, and every other test
//! asserts refusals/validation/errors only.
//!
//! V4-A6d: the monolithic `handle_bot_run` + `ReceiptLedger` seam are gone.
//! This module now exposes independently testable staged primitives
//! (`authorize_caller`, `parse_bot_run_request`, `revalidate_run_scope`,
//! `authorized_prepare`, `execute`, `record`, `build_receipt`) that ROOT's
//! wiring composes onto the admitted `RequestLedger::run_staged`. Since
//! `RequestLedger`/`run_staged` are `pub(crate)` to `drogon-core` and this
//! is an external integration-test crate, `ScopeLedgerDouble` below
//! re-implements `run_staged`'s own admission SEQUENCING (authorize before
//! any stored-row inspection; fresh-only prepare; in-memory replay store)
//! using the REAL staged primitives underneath -- the only fake is the
//! bookkeeping shell a real ledger would supply, never any policy/storage
//! decision.
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
    DispatchSeam, DispatchSeamError, HarnessStarted, RunnerOutcome, SessionObservation,
    derive_request_id,
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

use bot_run_rpc::{BotRunCaller, BotRunPrepare};

/// A deterministic, monotonically-increasing server clock: each `.next()`
/// call returns a distinct, larger sample than the last. Never the wall
/// clock -- receipts must be byte-stable and every sample boundary must be
/// exactly attributable in assertions.
struct ScriptedClock {
    next: Cell<f64>,
}

impl ScriptedClock {
    fn starting_at(start: u64) -> Self {
        Self {
            next: Cell::new(start as f64),
        }
    }

    fn next(&self) -> f64 {
        let value = self.next.get();
        self.next.set(value + 1.0);
        value
    }
}

/// 2026-09-09T00:00:00Z, second resolution.
const NOW_UNIX: u64 = 1_797_724_800;

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

/// A seam whose `harness_start` runs an arbitrary hook before returning --
/// used to prove nothing blocks a second connection to the same database
/// file while [`bot_run_rpc::execute`] is in flight (it takes no
/// `Connection`/lock at all, so this is an empirical regression guard on
/// top of the type-level proof).
struct DuringDispatchSeam<F: Fn()> {
    on_start: F,
}

impl<F: Fn()> DispatchSeam for DuringDispatchSeam<F> {
    fn harness_start(
        &self,
        _request_id: &str,
        _params: Value,
    ) -> Result<HarnessStarted, DispatchSeamError> {
        (self.on_start)();
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

/// Full end-to-end orchestration through the staged primitives, standing in
/// for the ROOT adapter this module is not authorized to apply (see the
/// A6d delivery report for the exact hunk). Mirrors `run_staged`'s own
/// sequencing: `authorize` runs on EVERY admission attempt, fresh or
/// replay, strictly BEFORE any stored-row inspection; `prepare` runs only
/// when no stored row exists for this key.
struct ScopeLedgerDouble {
    stored: RefCell<HashMap<String, (bot_run_rpc::BotRunRequest, Value)>>,
    admits: RefCell<Vec<String>>,
}

impl ScopeLedgerDouble {
    fn new() -> Self {
        Self {
            stored: RefCell::new(HashMap::new()),
            admits: RefCell::new(Vec::new()),
        }
    }

    fn admits(&self) -> Vec<String> {
        self.admits.borrow().clone()
    }

    /// Tamper with a stored receipt so a replay that returns it verbatim is
    /// distinguishable from a rebuild.
    fn mark_stored(&self, request_id: &str) {
        let mut stored = self.stored.borrow_mut();
        if let Some((_, receipt)) = stored.get_mut(request_id) {
            receipt["storageProbe"] = json!("returned-from-ledger");
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn call(
        &self,
        conn: &rusqlite::Connection,
        derived_host_id: &str,
        request_id: &str,
        params: &Value,
        caller: &BotRunCaller,
        seam: &impl DispatchSeam,
        clock: &ScriptedClock,
    ) -> Result<Value, RpcError> {
        // Denied before parsing or the ledger: consumes no admission.
        bot_run_rpc::authorize_caller(caller)?;
        let request = bot_run_rpc::parse_bot_run_request(params)?;

        self.admits.borrow_mut().push(request_id.to_string());
        // `authorize`: every attempt, replay included, BEFORE any stored-row
        // inspection.
        bot_run_rpc::revalidate_run_scope(conn, derived_host_id, &request)?;

        if let Some((saved_request, saved_receipt)) = self.stored.borrow().get(request_id) {
            return if *saved_request == request {
                Ok(saved_receipt.clone())
            } else {
                Err(RpcError::new(
                    "request_conflict",
                    "requestId was already used with different parameters.",
                ))
            };
        }

        // FRESH-ONLY from here.
        let recorded_at = clock.next();
        let receipt =
            match bot_run_rpc::authorized_prepare(conn, derived_host_id, &request, recorded_at)? {
                BotRunPrepare::Refused {
                    workspace_id,
                    refusal,
                    error,
                } => bot_run_rpc::build_receipt(
                    request_id,
                    derived_host_id,
                    &workspace_id,
                    "refused",
                    refusal,
                    Value::Null,
                    None,
                    None,
                    None,
                    Value::String(error),
                    None,
                    recorded_at,
                ),
                BotRunPrepare::Unsupported {
                    workspace_id,
                    reason,
                    error,
                } => bot_run_rpc::build_receipt(
                    request_id,
                    derived_host_id,
                    &workspace_id,
                    "unsupported",
                    Value::Null,
                    reason,
                    None,
                    None,
                    None,
                    Value::String(error),
                    None,
                    recorded_at,
                ),
                BotRunPrepare::Ready { plan, workspace_id } => {
                    let outcome = bot_run_rpc::execute(&plan, seam);
                    let observed_at = clock.next();
                    bot_run_rpc::record(conn, &plan, &outcome, observed_at)?;
                    let automation_run_id = format!("ar:{}", plan.request_id);
                    let (session, error, outcome_name, observed_at_opt) = match &outcome {
                        RunnerOutcome::Observed {
                            session_id,
                            incarnation,
                            ..
                        } => (
                            Some(json!({"sessionId": session_id, "incarnation": incarnation})),
                            Value::Null,
                            "dispatched",
                            Some(observed_at),
                        ),
                        RunnerOutcome::ObservationFailed {
                            session_id,
                            incarnation,
                            error,
                        } => (
                            Some(json!({"sessionId": session_id, "incarnation": incarnation})),
                            Value::String(error.to_string()),
                            "dispatched",
                            Some(observed_at),
                        ),
                        RunnerOutcome::DispatchFailed(error) => {
                            (None, Value::String(error.to_string()), "refused", None)
                        }
                    };
                    bot_run_rpc::build_receipt(
                        request_id,
                        derived_host_id,
                        &workspace_id,
                        outcome_name,
                        Value::Null,
                        Value::Null,
                        session,
                        Some(automation_run_id),
                        Some(plan.request_id.clone()),
                        error,
                        observed_at_opt,
                        recorded_at,
                    )
                }
            };
        self.stored
            .borrow_mut()
            .insert(request_id.to_string(), (request, receipt.clone()));
        Ok(receipt)
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

#[test]
fn strict_schema_rejects_unknown_fields_missing_fields_and_non_admitted_harness() {
    let (_dir, _engine, _conn, host) = fixture();

    // Unknown top-level field is denied.
    let err = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"extra": 1}))).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("unknown field"), "{err:?}");

    // `requestId` lives on the native envelope, not in params: a params
    // requestId is an unknown field and is denied.
    let err = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"requestId": "smuggled"})))
        .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("requestId"), "{err:?}");

    // Required responsibilityId is missing in v1.
    let err = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"responsibilityId": null})))
        .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("responsibilityId"), "{err:?}");

    // Empty bot id.
    let err =
        bot_run_rpc::parse_bot_run_request(&params(&host, json!({"botId": "  "}))).unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // reason is an explicit enum; eventIdentity never infers it.
    let err = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"reason": "whenever"})))
        .unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // Unknown field inside the harness overrides object.
    let err = bot_run_rpc::parse_bot_run_request(&params(
        &host,
        json!({"harness": {"harnessId": "codex", "forge": true}}),
    ))
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("harness"), "{err:?}");
}

#[test]
fn requests_normalize_to_the_same_parsed_value_regardless_of_wire_key_order() {
    let (_dir, _engine, _conn, host) = fixture();
    let a = params(&host, json!({}));
    let reordered = json!({
        "harness": { "harnessId": "codex" },
        "eventIdentity": "evt-1",
        "reason": "manual",
        "responsibilityId": "resp-1",
        "botId": "bot-1",
        "hostId": host,
        "workspaceId": "ws-1",
    });
    assert_eq!(
        bot_run_rpc::parse_bot_run_request(&a).unwrap(),
        bot_run_rpc::parse_bot_run_request(&reordered).unwrap(),
        "wire key order must never affect the normalized request \
         the delegated ledger fingerprints"
    );
}

#[test]
fn worker_callers_are_denied_before_parsing_and_consume_no_admission() {
    let (_dir, _engine, conn, host) = fixture();
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = ScopeLedgerDouble::new();
    let clock = ScriptedClock::starting_at(NOW_UNIX);

    let err = bot_run_rpc::authorize_caller(&BotRunCaller::Worker {
        host_id: host.clone(),
        run_id: "run-1".to_string(),
        dispatch_id: "dispatch-1".to_string(),
    })
    .unwrap_err();
    assert_eq!(err.code, "unauthorized");
    assert_eq!(
        err.message,
        "bot.run is desktop-only: worker dispatch credentials are denied on this auth path"
    );

    let err = ledger
        .call(
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
            &clock,
        )
        .unwrap_err();
    assert_eq!(err.code, "unauthorized");
    assert_eq!(seam.starts.get(), 0);
    assert!(
        ledger.admits().is_empty(),
        "a caller denial must not reach the ledger at all"
    );
}

#[test]
fn asserted_host_mismatch_is_refused_as_structured_foreign_workspace_host() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);

    let request =
        bot_run_rpc::parse_bot_run_request(&params(&host, json!({"hostId": "host-evil"}))).unwrap();
    let prepared =
        bot_run_rpc::authorized_prepare(&conn, &host, &request, NOW_UNIX as f64).unwrap();
    let BotRunPrepare::Refused {
        workspace_id,
        refusal,
        error,
    } = prepared
    else {
        panic!("expected Refused, got {prepared:?}");
    };
    assert_eq!(workspace_id, "ws-1");
    assert_eq!(
        refusal,
        json!({
            "type": "workspace",
            "kind": "foreignWorkspaceHost",
            "workspaceId": "ws-1",
            "assertedHostId": "host-evil",
            "currentHostId": host,
        })
    );
    assert_eq!(
        error,
        format!(
            "foreign workspace host: asserted host host-evil does not match derived host {host}"
        )
    );

    // The very same scope violation is a hard, propagated denial when it
    // runs through the replay-time `authorize` gate instead.
    let err = bot_run_rpc::revalidate_run_scope(&conn, &host, &request).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn workspace_owned_by_another_host_is_refused_even_when_the_assertion_matches() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "host-other");
    seed_scheduled_bot(&conn, "host-other", true);

    let request = bot_run_rpc::parse_bot_run_request(&params(&host, json!({}))).unwrap();
    let prepared =
        bot_run_rpc::authorized_prepare(&conn, &host, &request, NOW_UNIX as f64).unwrap();
    let BotRunPrepare::Refused { refusal, error, .. } = prepared else {
        panic!("expected Refused, got {prepared:?}");
    };
    assert_eq!(
        refusal,
        json!({
            "type": "workspace",
            "kind": "foreignWorkspaceHost",
            "workspaceId": "ws-1",
            "workspaceHostId": "host-other",
            "currentHostId": host,
        })
    );
    assert!(error.starts_with("foreign workspace host: workspace ws-1 belongs to host host-other"));
}

#[test]
fn unknown_workspace_is_refused_as_a_structured_receipt() {
    let (_dir, _engine, conn, host) = fixture();
    // No workspace row seeded at all.
    let request = bot_run_rpc::parse_bot_run_request(&params(&host, json!({}))).unwrap();
    let prepared =
        bot_run_rpc::authorized_prepare(&conn, &host, &request, NOW_UNIX as f64).unwrap();
    let BotRunPrepare::Refused {
        workspace_id,
        refusal,
        error,
    } = prepared
    else {
        panic!("expected Refused, got {prepared:?}");
    };
    assert_eq!(workspace_id, "ws-1");
    assert_eq!(
        refusal,
        json!({"type": "workspace", "kind": "unknownWorkspace", "workspaceId": "ws-1"})
    );
    assert_eq!(error, "workspace ws-1 not found");

    let err = bot_run_rpc::revalidate_run_scope(&conn, &host, &request).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn absent_harness_is_unsupported_without_dispatch_or_defaults() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = ScopeLedgerDouble::new();
    let clock = ScriptedClock::starting_at(NOW_UNIX);

    let receipt = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({"harness": null})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(receipt["outcome"], "unsupported");
    assert_eq!(receipt["reason"], json!({"kind": "harnessMappingAbsent"}));
    assert_eq!(
        receipt["error"],
        "no harness mapping exists for this bot: supply admitted harness overrides"
    );
    assert!(receipt["session"].is_null());
    assert_eq!(receipt["recordedAt"], NOW_UNIX as f64);
    assert!(receipt["observedAt"].is_null());
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
    let ledger = ScopeLedgerDouble::new();
    let clock = ScriptedClock::starting_at(NOW_UNIX);

    let first = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(first["outcome"], "dispatched");

    let err = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({"reason": "scheduledDue"})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap_err();
    assert_eq!(err.code, "request_conflict");
    assert_eq!(
        err.message,
        "requestId was already used with different parameters."
    );
    assert_eq!(seam.starts.get(), 1, "a conflict must never dispatch");
}

#[test]
fn double_click_replay_returns_the_ledger_stored_receipt_with_a_single_session() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = ScopeLedgerDouble::new();
    let clock = ScriptedClock::starting_at(NOW_UNIX);
    let request = params(&host, json!({}));
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

    let first = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &request,
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(first["outcome"], "dispatched");
    assert_eq!(first["requestId"], "req-1");
    assert_eq!(first["session"]["sessionId"], "session-1");
    assert_eq!(first["session"]["incarnation"], "incarnation-1");
    // recorded_at is sampled at admission (the first clock sample);
    // observed_at is a genuinely LATER, distinct sample taken after
    // `execute` returns -- never the same value, never attempt-time.
    assert_eq!(first["recordedAt"], NOW_UNIX as f64);
    assert_eq!(first["observedAt"], (NOW_UNIX + 1) as f64);

    // Tamper with the stored receipt: a true ledger replay returns the
    // STORED value (probe visible); a rebuild would drop the probe.
    ledger.mark_stored("req-1");
    let second = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &reordered,
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(second["storageProbe"], "returned-from-ledger");
    let mut expected = first.clone();
    expected["storageProbe"] = json!("returned-from-ledger");
    assert_eq!(
        second, expected,
        "replay must be exactly the stored receipt, wire-order independent"
    );

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
    // The delegation itself is observable: one admit attempt per call.
    assert_eq!(
        ledger.admits(),
        vec!["req-1".to_string(), "req-1".to_string()]
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
    let ledger = ScopeLedgerDouble::new();
    let clock = ScriptedClock::starting_at(NOW_UNIX);

    let before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'bot_run_receipts'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let receipt = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
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
        "receipt persistence is the delegated ledger's job, not DDL here"
    );
}

/// REQUIRED PROOF: the scope `authorize` gate reruns on EVERY admission
/// attempt, replay included -- a replay whose workspace moved to a
/// different host since the original admission is denied, never silently
/// handed the stale stored receipt.
#[test]
fn replay_authorize_denies_when_workspace_scope_changes_since_admission() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = ScopeLedgerDouble::new();
    let clock = ScriptedClock::starting_at(NOW_UNIX);

    let first = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(first["outcome"], "dispatched");
    assert_eq!(seam.starts.get(), 1);

    // The workspace moves to a different host after admission.
    conn.execute(
        "UPDATE workspaces SET host_id = ?1 WHERE id = 'ws-1'",
        ["host-other"],
    )
    .unwrap();

    let err = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap_err();
    assert_eq!(err.code, "unauthorized");
    assert_eq!(
        seam.starts.get(),
        1,
        "a denied replay must never re-dispatch"
    );
}

/// REQUIRED PROOF: readiness (harness mapping, bot/responsibility enabled)
/// is FRESH-ONLY -- a replay of an already-admitted key returns the stored
/// receipt verbatim even after readiness is revoked, while a genuinely
/// fresh admission against the same now-disabled responsibility is
/// refused.
#[test]
fn replay_returns_stored_receipt_verbatim_after_readiness_is_later_revoked() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let ledger = ScopeLedgerDouble::new();
    let clock = ScriptedClock::starting_at(NOW_UNIX);

    let first = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(first["outcome"], "dispatched");
    ledger.mark_stored("req-1");

    // Disable the responsibility: a FRESH admission would now be refused.
    bstorage::update_bot(&conn, &host, "/repo", "bot-1", 200.0, |bot| {
        bot.responsibilities[0].enabled = false;
    })
    .unwrap();

    let replay = ledger
        .call(
            &conn,
            &host,
            "req-1",
            &params(&host, json!({})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(replay["storageProbe"], "returned-from-ledger");
    assert_eq!(
        seam.starts.get(),
        1,
        "a cached replay must never re-dispatch or re-check readiness"
    );

    // A genuinely fresh admission (a different key) DOES see the disabled
    // responsibility.
    let fresh = ledger
        .call(
            &conn,
            &host,
            "req-2",
            &params(&host, json!({"eventIdentity": "evt-2"})),
            &BotRunCaller::Desktop,
            &seam,
            &clock,
        )
        .unwrap();
    assert_eq!(fresh["outcome"], "refused");
    assert_eq!(
        fresh["refusal"],
        json!({"type": "responsibility", "kind": "disabled"})
    );
    assert_eq!(seam.starts.get(), 1, "the fresh refusal never dispatches");
}

/// REQUIRED PROOF: an owned `Ready` plan from [`bot_run_rpc::authorized_prepare`]
/// outlives the `&Connection` scope that produced it -- `execute` runs with
/// no `Connection` in scope at all, and `record` reopens one afterward.
#[test]
fn owned_plan_outlives_the_connection_scope_that_prepared_it() {
    let (dir, _engine, plan) = {
        let (dir, engine, conn, host) = fixture();
        seed_workspace(&conn, &host);
        seed_scheduled_bot(&conn, &host, true);
        let request = bot_run_rpc::parse_bot_run_request(&params(&host, json!({}))).unwrap();
        let prepared =
            bot_run_rpc::authorized_prepare(&conn, &host, &request, NOW_UNIX as f64).unwrap();
        let BotRunPrepare::Ready { plan, .. } = prepared else {
            panic!("expected Ready, got {prepared:?}");
        };
        drop(conn);
        (dir, engine, plan)
    };
    // No `Connection` (or `Engine`) is in scope for the dispatch itself.
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let outcome = bot_run_rpc::execute(&plan, &seam);
    assert!(matches!(outcome, RunnerOutcome::Observed { .. }));
    assert_eq!(seam.starts.get(), 1);

    let reopened = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    bot_run_rpc::record(&reopened, &plan, &outcome, (NOW_UNIX + 1) as f64).unwrap();
    let runs: i64 = reopened
        .query_row("SELECT COUNT(*) FROM automation_runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(runs, 1);
}

/// REQUIRED PROOF: nothing in this module holds a database guard across
/// dispatch -- a second connection to the same file can write WHILE
/// `execute` is in flight (empirical guard on top of the type-level proof
/// that `execute` takes no `Connection` parameter at all, so the production
/// `Engine` wrapper can safely drop its own `MutexGuard` before calling it).
#[test]
fn no_lock_is_held_on_the_database_during_execute() {
    let (dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let request = bot_run_rpc::parse_bot_run_request(&params(&host, json!({}))).unwrap();
    let prepared =
        bot_run_rpc::authorized_prepare(&conn, &host, &request, NOW_UNIX as f64).unwrap();
    let BotRunPrepare::Ready { plan, .. } = prepared else {
        panic!("expected Ready, got {prepared:?}");
    };

    let path = dir.path().join(DB_FILE_NAME);
    let seam = DuringDispatchSeam {
        on_start: || {
            let secondary = rusqlite::Connection::open(&path).unwrap();
            secondary
                .execute(
                    "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params!["ws-2", "/repo-2", "repo-2", "folder", host, "2026-09-09T00:00:00Z"],
                )
                .expect("a second connection must be able to write while execute is in flight");
        },
    };

    let outcome = bot_run_rpc::execute(&plan, &seam);
    assert!(matches!(outcome, RunnerOutcome::Observed { .. }));
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2, "the second connection's write must have landed");
}

/// REQUIRED PROOF: [`bot_run_rpc::record`] opens no transaction of its own,
/// so a caller's OWN transaction fully governs atomicity -- rolling it back
/// leaves BOTH the linked `AutomationRun` row and the `ResponsibilityRun`
/// history row absent, never one committed without the other.
#[test]
fn callers_own_transaction_rollback_leaves_both_history_rows_absent() {
    let (_dir, _engine, mut conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);
    let seam = CountingSeam {
        starts: Cell::new(0),
    };
    let request = bot_run_rpc::parse_bot_run_request(&params(&host, json!({}))).unwrap();
    let prepared =
        bot_run_rpc::authorized_prepare(&conn, &host, &request, NOW_UNIX as f64).unwrap();
    let BotRunPrepare::Ready { plan, .. } = prepared else {
        panic!("expected Ready, got {prepared:?}");
    };
    let outcome = bot_run_rpc::execute(&plan, &seam);
    assert!(matches!(outcome, RunnerOutcome::Observed { .. }));

    {
        let tx = conn.transaction().unwrap();
        bot_run_rpc::record(&tx, &plan, &outcome, (NOW_UNIX + 1) as f64).unwrap();
        let runs: i64 = tx
            .query_row("SELECT COUNT(*) FROM automation_runs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(runs, 1, "the write is visible inside the caller's own tx");
        // The caller rolls back instead of committing (rusqlite's default
        // `Transaction` drop behavior is `Rollback`).
    }

    let runs: i64 = conn
        .query_row("SELECT COUNT(*) FROM automation_runs", [], |r| r.get(0))
        .unwrap();
    let history: i64 = conn
        .query_row("SELECT COUNT(*) FROM bot_responsibility_runs", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(runs, 0, "rollback must remove the automation run row too");
    assert_eq!(history, 0, "rollback must remove the history row");
}
