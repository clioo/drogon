//! Tests for the `bot.run` bridge (`bot_run_rpc`), now that `pub mod
//! bot_run_rpc;` and the `"bot.run"` dispatch arm are applied in `lib.rs`
//! (V4 PR13).
//!
//! Two layers of coverage:
//!
//! - The 8 PURE bridge tests below exercise the staged primitives directly
//!   (`parse_bot_run_request`, `revalidate_run_scope`, `authorized_prepare`,
//!   `execute`, `record`) against a raw seeded connection -- no ledger
//!   sequencing, no `Engine::dispatch` involved. These are unchanged from
//!   the pre-registration version of this file (only the import path moved
//!   from a `#[path]`-included module to `use drogon_core::bot_run_rpc;`,
//!   now that the module is `pub`).
//! - The 9 REAL-ENGINE tests exercise the applied `Engine::bot_run` adapter
//!   through `engine.dispatch`/`engine.dispatch_authenticated` end to end:
//!   admission sequencing (`authorize` before replay, fresh-only `prepare`),
//!   atomic record-or-stay-pending finalize, quiescent-shutdown fencing, and
//!   the worker-route fail-closed boundary. These replace the previous
//!   `ScopeLedgerDouble`-based re-implementation of `run_staged`'s own
//!   sequencing (deleted along with `ScriptedClock`) with proof against the
//!   real ledger.
//!
//! Every dispatched bot always resolves a harness id that is guaranteed
//! never to exist (`"no-such-harness-for-tests"`). `drogon_harness::HarnessId`
//! is a closed enum of the real installable harnesses, so this string fails
//! `harness.start`'s own strict deserialization (`invalid_argument`)
//! immediately, before harness discovery ever runs -- `RunnerOutcome::DispatchFailed`
//! with a real seam error, never a real PTY spawn or session. This is
//! deliberately safer than picking a real `HarnessId` variant that happens
//! not to be installed here: this sandbox may well have one of the real
//! harness binaries on `PATH`, which would risk actually spawning it.

use std::cell::Cell;

use drogon_core::automations::records::{
    Automation, AutomationRun, AutomationRunStatus, AutomationRunTrigger, ExecutionTargetType,
    MissedRunPolicy, SchedulerOwner, SessionKind, WorkspaceMode,
};
use drogon_core::automations::runner::{
    DispatchSeam, DispatchSeamError, HarnessStarted, RunnerOutcome, SessionObservation,
    derive_request_id,
};
use drogon_core::automations::storage as astorage;
use drogon_core::bot_run_rpc::{self, BotRunCaller, BotRunPrepare};
use drogon_core::bots::records::{
    Bot, DEFAULT_DROGON_BOT_HARNESS, DisplayIdentity, HarnessModelPolicy, Responsibility,
    ResponsibilityKind, ResponsibilityTrigger,
};
use drogon_core::bots::storage as bstorage;
use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response, RpcError};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------
// Shared envelope helpers (used by both the pure and real-engine tests).
// ---------------------------------------------------------------------

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

fn err(response: Response) -> RpcError {
    assert!(!response.ok, "expected error, got {response:?}");
    response.error.unwrap()
}

// ---------------------------------------------------------------------
// PURE bridge tests: raw seeded connection, no ledger, no dispatch.
// ---------------------------------------------------------------------

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

fn fixture() -> (tempfile::TempDir, Engine, rusqlite::Connection, String) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch(request("discover-host", "status", json!({})));
    let host = ok(response)["hostId"].as_str().unwrap().to_string();
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
    let error = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"extra": 1}))).unwrap_err();
    assert_eq!(error.code, "invalid_argument");
    assert!(error.message.contains("unknown field"), "{error:?}");

    // `requestId` lives on the native envelope, not in params: a params
    // requestId is an unknown field and is denied.
    let error = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"requestId": "smuggled"})))
        .unwrap_err();
    assert_eq!(error.code, "invalid_argument");
    assert!(error.message.contains("requestId"), "{error:?}");

    // Required responsibilityId is missing in v1.
    let error = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"responsibilityId": null})))
        .unwrap_err();
    assert_eq!(error.code, "invalid_argument");
    assert!(error.message.contains("responsibilityId"), "{error:?}");

    // Empty bot id.
    let error =
        bot_run_rpc::parse_bot_run_request(&params(&host, json!({"botId": "  "}))).unwrap_err();
    assert_eq!(error.code, "invalid_argument");

    // reason is an explicit enum; eventIdentity never infers it.
    let error = bot_run_rpc::parse_bot_run_request(&params(&host, json!({"reason": "whenever"})))
        .unwrap_err();
    assert_eq!(error.code, "invalid_argument");

    // Unknown field inside the harness overrides object.
    let error = bot_run_rpc::parse_bot_run_request(&params(
        &host,
        json!({"harness": {"harnessId": "codex", "forge": true}}),
    ))
    .unwrap_err();
    assert_eq!(error.code, "invalid_argument");
    assert!(error.message.contains("harness"), "{error:?}");
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
fn asserted_host_mismatch_is_refused_as_structured_foreign_workspace_host() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, &host);
    seed_scheduled_bot(&conn, &host, true);

    let request =
        bot_run_rpc::parse_bot_run_request(&params(&host, json!({"hostId": "host-evil"}))).unwrap();
    let prepared = bot_run_rpc::authorized_prepare(&conn, &host, &request, 1_797_724_800.0).unwrap();
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
    let error = bot_run_rpc::revalidate_run_scope(&conn, &host, &request).unwrap_err();
    assert_eq!(error.code, "unauthorized");
}

#[test]
fn workspace_owned_by_another_host_is_refused_even_when_the_assertion_matches() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "host-other");
    seed_scheduled_bot(&conn, "host-other", true);

    let request = bot_run_rpc::parse_bot_run_request(&params(&host, json!({}))).unwrap();
    let prepared = bot_run_rpc::authorized_prepare(&conn, &host, &request, 1_797_724_800.0).unwrap();
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
    let prepared = bot_run_rpc::authorized_prepare(&conn, &host, &request, 1_797_724_800.0).unwrap();
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

    let error = bot_run_rpc::revalidate_run_scope(&conn, &host, &request).unwrap_err();
    assert_eq!(error.code, "unauthorized");
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
            bot_run_rpc::authorized_prepare(&conn, &host, &request, 1_797_724_800.0).unwrap();
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
    bot_run_rpc::record(&reopened, &plan, &outcome, 1_797_724_801.0).unwrap();
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
    let prepared = bot_run_rpc::authorized_prepare(&conn, &host, &request, 1_797_724_800.0).unwrap();
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
    let prepared = bot_run_rpc::authorized_prepare(&conn, &host, &request, 1_797_724_800.0).unwrap();
    let BotRunPrepare::Ready { plan, .. } = prepared else {
        panic!("expected Ready, got {prepared:?}");
    };
    let outcome = bot_run_rpc::execute(&plan, &seam);
    assert!(matches!(outcome, RunnerOutcome::Observed { .. }));

    {
        let tx = conn.transaction().unwrap();
        bot_run_rpc::record(&tx, &plan, &outcome, 1_797_724_801.0).unwrap();
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

/// Tiny pure unit assertion for the worker-denied auth path -- no ledger, no
/// fixture. `bot.run`'s real worker denial is proven end-to-end by
/// [`worker_route_fail_closed`] below through `authorize_worker`'s
/// allowlist; this only pins `authorize_caller`'s own defensive check.
#[test]
fn authorize_caller_denies_worker_callers_before_any_ledger_interaction() {
    let error = bot_run_rpc::authorize_caller(&BotRunCaller::Worker {
        host_id: "host-1".to_string(),
        run_id: "run-1".to_string(),
        dispatch_id: "dispatch-1".to_string(),
    })
    .unwrap_err();
    assert_eq!(error.code, "unauthorized");
    assert_eq!(
        error.message,
        "bot.run is desktop-only: worker dispatch credentials are denied on this auth path"
    );
}

// ---------------------------------------------------------------------
// REAL-ENGINE tests: everything below dispatches through a real
// `Engine::open` store via `engine.dispatch`/`engine.dispatch_authenticated`
// -- never through the bridge's staged primitives or a double. Every
// dispatched bot resolves a definitely-unknown harness id, so the nested
// `harness.start` always fails fast at its own strict `HarnessId`
// deserialization (`invalid_argument`, `DispatchFailed`): no PTY spawn, no
// real session, fully deterministic, and never a real installed harness id.
// ---------------------------------------------------------------------

const UNKNOWN_HARNESS: &str = "no-such-harness-for-tests";

struct EngineFixture {
    root: tempfile::TempDir,
    engine: Engine,
    host: String,
    workspace_id: String,
    folder: String,
}

impl EngineFixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder_path = root.path().join("workspace-folder");
        std::fs::create_dir(&folder_path).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let workspace = ok(engine.dispatch(request(
            "register-workspace",
            "workspace.register",
            json!({"path": folder_path}),
        )));
        let host = workspace["hostId"].as_str().unwrap().to_string();
        let workspace_id = workspace["id"].as_str().unwrap().to_string();
        let folder = workspace["path"].as_str().unwrap().to_string();
        let fixture = Self {
            root,
            engine,
            host,
            workspace_id,
            folder,
        };
        fixture.seed_bot_and_automation();
        fixture
    }

    fn conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.root.path().join("data").join(DB_FILE_NAME)).unwrap()
    }

    fn seed_bot_and_automation(&self) {
        let conn = self.conn();
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
                enabled: true,
                recipe: None,
                created_at: 0.0,
                updated_at: 0.0,
            }],
            current_session: None,
            created_at: 0.0,
            updated_at: 0.0,
        };
        bstorage::create_bot(&conn, &self.host, &self.folder, &bot).unwrap();
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
            execution_target_id: self.host.clone(),
            execution_target_generation: None,
            scheduler_owner: SchedulerOwner::LocalHostService,
            workspace_mode: WorkspaceMode::Existing,
            workspace_id: Some(self.workspace_id.clone()),
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
        astorage::upsert_automation(&conn, &automation).unwrap();
    }

    fn params(&self, overrides: Value) -> Value {
        let mut value = json!({
            "workspaceId": self.workspace_id,
            "hostId": self.host,
            "botId": "bot-1",
            "responsibilityId": "resp-1",
            "reason": "manual",
            "eventIdentity": "evt-1",
            "harness": { "harnessId": UNKNOWN_HARNESS },
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

    fn run(&self, id: &str, params: Value) -> Response {
        self.engine.dispatch(request(id, "bot.run", params))
    }

    fn derived_id(&self) -> String {
        derive_request_id(&self.host, &self.folder, "bot-1", "resp-1", "evt-1")
    }

    fn count(&self, sql: &str) -> i64 {
        self.conn().query_row(sql, [], |r| r.get(0)).unwrap()
    }
}

#[test]
fn unsupported_absent_harness() {
    let fx = EngineFixture::new();
    let before_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    let params = fx.params(json!({"harness": null}));
    let receipt = ok(fx.run("req-1", params.clone()));
    let after_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;

    assert_eq!(receipt["outcome"], "unsupported");
    assert_eq!(receipt["reason"], json!({"kind": "harnessMappingAbsent"}));
    assert!(receipt["session"].is_null());
    assert!(receipt["observedAt"].is_null());
    let recorded_at = receipt["recordedAt"].as_f64().unwrap();
    assert!(
        (before_ms..=after_ms).contains(&recorded_at),
        "recordedAt {recorded_at} must be a plausible wall-clock sample in [{before_ms}, {after_ms}]"
    );

    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        0
    );
    assert_eq!(fx.count("SELECT COUNT(*) FROM automation_runs"), 0);

    let replay = ok(fx.run("req-1", params));
    assert_eq!(
        replay, receipt,
        "a replay of the same key+params must return the byte-identical stored receipt"
    );
}

#[test]
fn replay_returns_identical_stored_receipt() {
    let fx = EngineFixture::new();
    let params = fx.params(json!({}));
    let first = ok(fx.run("req-1", params.clone()));
    assert_eq!(first["outcome"], "refused", "{first:?}");
    assert!(first["session"].is_null());

    // Tamper with the persisted result_json directly: a true replay returns
    // the STORED value (probe visible); a rebuild would drop the probe.
    {
        let conn = fx.conn();
        let stored: String = conn
            .query_row(
                "SELECT result_json FROM requests WHERE request_id='req-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let mut tampered: Value = serde_json::from_str(&stored).unwrap();
        tampered["storageProbe"] = json!("returned-from-ledger");
        conn.execute(
            "UPDATE requests SET result_json=?1 WHERE request_id='req-1'",
            [tampered.to_string()],
        )
        .unwrap();
    }

    let replay = ok(fx.run("req-1", params));
    let mut expected = first.clone();
    expected["storageProbe"] = json!("returned-from-ledger");
    assert_eq!(
        replay, expected,
        "replay must be exactly the stored receipt, probe included"
    );

    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        1,
        "the replay must not re-dispatch"
    );
    assert_eq!(fx.count("SELECT COUNT(*) FROM automation_runs"), 1);
    assert_eq!(fx.count("SELECT COUNT(*) FROM bot_responsibility_runs"), 1);
}

#[test]
fn changed_params_conflict() {
    let fx = EngineFixture::new();
    let params = fx.params(json!({}));
    let first = ok(fx.run("req-1", params.clone()));
    assert_eq!(first["outcome"], "refused");

    let mut changed = params;
    changed["reason"] = json!("scheduledDue");
    let error = err(fx.run("req-1", changed));
    assert_eq!(error.code, "request_conflict");

    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        1,
        "a conflict must never dispatch beyond the first admission"
    );
    assert_eq!(fx.count("SELECT COUNT(*) FROM automation_runs"), 1);
}

/// REQUIRED PROOF: the scope `authorize` gate reruns on EVERY admission
/// attempt, replay included -- a replay whose workspace moved to a
/// different host since the original admission is denied, never silently
/// handed the stale stored receipt.
#[test]
fn authorize_before_replay_after_host_scope_change() {
    let fx = EngineFixture::new();
    let params = fx.params(json!({}));
    let first = ok(fx.run("req-1", params.clone()));

    fx.conn()
        .execute(
            "UPDATE workspaces SET host_id='host-other' WHERE id=?1",
            [fx.workspace_id.as_str()],
        )
        .unwrap();

    let error = err(fx.run("req-1", params));
    assert_eq!(error.code, "unauthorized");

    let stored: String = fx
        .conn()
        .query_row(
            "SELECT result_json FROM requests WHERE request_id='req-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let stored_value: Value = serde_json::from_str(&stored).unwrap();
    assert_eq!(
        stored_value, first,
        "the stored receipt must be byte-identical before and after the denied replay"
    );
    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        1,
        "a denied replay must never re-dispatch"
    );
}

#[test]
fn one_effect_single_session_rows() {
    let fx = EngineFixture::new();
    let params = fx.params(json!({}));
    let first = ok(fx.run("req-1", params.clone()));
    let second = ok(fx.run("req-1", params));
    assert_eq!(first, second);

    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        1
    );
    assert_eq!(fx.count("SELECT COUNT(*) FROM automation_runs"), 1);
    assert_eq!(fx.count("SELECT COUNT(*) FROM bot_responsibility_runs"), 1);
}

/// REQUIRED PROOF: a finalize failure (here, a poisoned `automation_runs`
/// row with no linkage to this key's automation) leaves the `requests` row
/// `pending` forever -- never a fabricated `done` receipt -- and rolls back
/// every write `finalize` attempted, atomically, together. The retained
/// in-flight slot answers a same-process replay with the identical
/// `unverifiable` outcome without ever re-dispatching.
#[test]
fn atomic_finalize_failure_stays_pending() {
    let fx = EngineFixture::new();
    let derived = fx.derived_id();
    let poison_id = format!("ar:{derived}");
    {
        let conn = fx.conn();
        let poison = AutomationRun {
            id: poison_id.clone(),
            automation_id: "auto-OTHER".to_string(),
            run_context: None,
            source_context: None,
            title: String::new(),
            scheduled_for: 0.0,
            status: AutomationRunStatus::Dispatched,
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
        };
        astorage::upsert_automation_run(&conn, &poison).unwrap();
    }

    let params = fx.params(json!({}));
    let error = err(fx.run("req-1", params.clone()));
    assert_eq!(error.code, "unverifiable");

    let status: String = fx
        .conn()
        .query_row(
            "SELECT status FROM requests WHERE request_id='req-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "pending", "a finalize failure must never complete the request row");

    let poison_automation_id: String = fx
        .conn()
        .query_row(
            "SELECT automation_id FROM automation_runs WHERE id=?1",
            [&poison_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        poison_automation_id, "auto-OTHER",
        "the poisoned row must be rolled back untouched, not partially merged"
    );
    assert_eq!(
        fx.count("SELECT COUNT(*) FROM bot_responsibility_runs"),
        0,
        "no responsibility-run row may exist for a finalize that never committed"
    );
    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        1
    );

    // The retained in-flight slot answers a same-process replay without a
    // second dispatch.
    let replay_error = err(fx.run("req-1", params));
    assert_eq!(replay_error.code, "unverifiable");
    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        1,
        "the uncertain retained slot must never re-effect"
    );
}

/// REQUIRED PROOF: a `harness.start` dispatch failure never fabricates a
/// live session -- the receipt's session is null, its outcome is `refused`
/// carrying the real seam error, and the durable `AutomationRun` row is
/// `DispatchFailed`, never `Completed`.
#[test]
fn no_false_live_verdict() {
    let fx = EngineFixture::new();
    let params = fx.params(json!({}));
    let receipt = ok(fx.run("req-1", params));

    assert_eq!(receipt["outcome"], "refused");
    assert!(receipt["session"].is_null());
    let error_text = receipt["error"].as_str().unwrap();
    assert!(
        error_text.contains("Invalid harness launch preferences"),
        "{error_text}"
    );
    assert!(
        !receipt.to_string().contains("\"live\""),
        "no live verdict may appear anywhere in a DispatchFailed receipt: {receipt}"
    );

    let stored = astorage::get_automation_run(&fx.conn(), &format!("ar:{}", fx.derived_id()))
        .unwrap()
        .expect("automation run row must exist");
    assert_eq!(stored.status, AutomationRunStatus::DispatchFailed);
    assert_ne!(stored.status, AutomationRunStatus::Completed);
}

#[test]
fn shutdown_admission() {
    let fx = EngineFixture::new();
    let status = ok(fx.engine.dispatch(request("status", "status", json!({}))));
    ok(fx.engine.dispatch(request(
        "shutdown",
        "runtime.shutdown",
        json!({
            "hostId": status["hostId"],
            "serviceInstanceId": status["serviceInstanceId"],
        }),
    )));
    assert!(fx.engine.is_quiescent());

    let error = err(fx.run("late", fx.params(json!({}))));
    assert_eq!(error.code, "runtime_busy");
    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE request_id='late'"),
        0,
        "a quiescence-refused admission must leave no requests row for that key"
    );
}

/// REQUIRED PROOF: `dispatch_worker` is never touched by this delivery --
/// `bot.run` stays fail-closed for a worker credential because it is not on
/// `coordination_access`'s allowlist, denied `unauthorized` before any
/// dispatcher match arm (never a stray `method_not_found` past the
/// allowlist, and never a fake success). No allowlist expansion is made.
#[test]
fn worker_route_fail_closed() {
    let fx = EngineFixture::new();
    const SERVICE_CREDENTIAL: &str = "bot-run-test-service-credential";
    const WORKER_SECRET: &str =
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    let digest = format!("{:x}", Sha256::digest(WORKER_SECRET.as_bytes()));
    {
        let conn = fx.conn();
        conn.execute(
            "INSERT INTO orchestration_dispatch_credentials
                (digest, host_id, run_id, task_id, dispatch_id, session_id, incarnation, revoked, created_at)
             VALUES (?1, ?2, 'run-1', 'task-1', 'dispatch-1', 'session-1', 'incarnation-1', 0, '2026-09-07T00:00:00Z')",
            rusqlite::params![digest, fx.host],
        )
        .unwrap();
    }

    let mut worker_request = request("worker-req", "bot.run", fx.params(json!({})));
    worker_request.auth = Some(WORKER_SECRET.to_string());
    let response = fx
        .engine
        .dispatch_authenticated(worker_request, SERVICE_CREDENTIAL);
    let error = err(response);
    assert!(
        matches!(error.code.as_str(), "unauthorized" | "method_not_found"),
        "{error:?}"
    );

    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE request_id='worker-req'"),
        0,
        "a fail-closed worker route must consume no admission for that key"
    );
    assert_eq!(
        fx.count("SELECT COUNT(*) FROM requests WHERE method='harness.start'"),
        0
    );
}
