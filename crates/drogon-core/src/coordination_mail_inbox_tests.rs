//! End-to-end `orchestration.inbox` over a real in-process Engine: newest-first
//! ordering, limit defaults, terminal filter, stale-handle emptiness,
//! read-only proof (no receipts, deliveries or read pointers), host
//! isolation and the worker fail-closed terminal rule. Runs and the worker
//! credential go through the real RPCs; no model inference, no daemons.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use drogon_protocol::orchestration_scope::COORDINATION_CONTRACT_VERSION;
use drogon_protocol::{PROTOCOL_VERSION, Request};

use crate::Engine;
use crate::coordination_access;

const WORKER_SECRET: &str = "inbox-worker-secret-00000000000000000000000000000001";
const SERVICE_CREDENTIAL: &str = "service-secret-token";
const COORD: &str = "coord-1";
const DISPATCH: &str = "dispatch-1";

fn digest(secret: &str) -> String {
    format!("{:x}", Sha256::digest(secret.as_bytes()))
}

fn request(id: &str, method: &str, params: Value, auth: Option<&str>) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": id,
        "auth": auth,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

struct Fixture {
    _dir: tempfile::TempDir,
    engine: Engine,
    host: String,
    run_id: String,
    task_id: String,
}

impl Fixture {
    fn open() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let host = engine.host_id.clone();
        let run_id = {
            let response = engine.dispatch(request(
                "run-create",
                "orchestration.runCreate",
                json!({
                    "contractVersion": COORDINATION_CONTRACT_VERSION,
                    "hostId": host,
                    "objective": "inbox sweep",
                    "coordinatorId": COORD,
                }),
                None,
            ));
            assert!(response.ok, "{:?}", response.error);
            response.result.unwrap()["run"]["runId"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let task_id = {
            let response = engine.dispatch(request(
                "task-create",
                "orchestration.taskCreate",
                json!({
                    "contractVersion": COORDINATION_CONTRACT_VERSION,
                    "hostId": host,
                    "runId": run_id,
                    "coordinatorId": COORD,
                    "consumerGeneration": 1,
                    "spec": {"instructions": "do work"},
                }),
                None,
            ));
            assert!(response.ok, "{:?}", response.error);
            response.result.unwrap()["task"]["taskId"]
                .as_str()
                .unwrap()
                .to_string()
        };
        {
            let mut conn = engine.db.lock().unwrap();
            let tx = conn.transaction().unwrap();
            coordination_access::register_in_tx(
                &tx,
                &digest(WORKER_SECRET),
                &host,
                &run_id,
                &task_id,
                DISPATCH,
                "session-1",
                "incarnation-1",
                "2026-09-07T00:00:00Z",
            )
            .unwrap();
            tx.commit().unwrap();
        }
        Self {
            _dir: dir,
            engine,
            host,
            run_id,
            task_id,
        }
    }

    fn coordinator_scope(&self) -> Value {
        json!({
            "actorKind": "coordinator",
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": self.host,
            "runId": self.run_id,
            "coordinatorId": COORD,
            "consumerGeneration": 1,
        })
    }

    fn dispatch_scope(&self) -> Value {
        json!({
            "actorKind": "dispatch",
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": self.host,
            "runId": self.run_id,
            "taskId": self.task_id,
            "dispatchId": DISPATCH,
        })
    }

    /// Addressed mail through the real storage function. A dispatch-addressed
    /// send via RPC additionally requires a live attempt (covered by the
    /// send-path tests); the sweep only reads the stored rows.
    fn seed_addressed(&self, message_id: &str, subject: &str) {
        use crate::coordination_mail::{Actor, NewMessage, Recipient};
        use drogon_protocol::orchestration_mail::MessageKind;
        let mut conn = self.engine.db.lock().unwrap();
        let tx = conn.transaction().unwrap();
        crate::coordination_mail::append_message_in_tx(
            &tx,
            NewMessage {
                message_id,
                host_id: &self.host,
                run_id: &self.run_id,
                kind: MessageKind::Guidance,
                from: &Actor::Coordinator(COORD.into()),
                to: &Recipient::Dispatch(DISPATCH.into()),
                subject,
                body: None,
                payload: None,
                thread_id: None,
                origin_request_id: "seed",
                created_at: "2026-09-07T00:00:00Z",
            },
        )
        .unwrap();
        tx.commit().unwrap();
    }

    /// Coordinator send through the real admin RPC.
    fn send_coordinator(&self, id: &str, kind: &str, subject: &str, to: Value) -> Value {
        let response = self.engine.dispatch(request(
            id,
            "orchestration.send",
            json!({
                "scope": self.coordinator_scope(),
                "kind": kind,
                "to": to,
                "subject": subject,
            }),
            None,
        ));
        assert!(response.ok, "{id}: {:?}", response.error);
        response.result.unwrap()
    }

    /// Worker send through the real authenticated RPC.
    fn send_worker(&self, id: &str, kind: &str, subject: &str, body: Option<&str>) -> Value {
        let mut params = json!({
            "scope": self.dispatch_scope(),
            "kind": kind,
            "subject": subject,
        });
        if let Some(body) = body {
            params["body"] = json!(body);
        }
        let response = self.engine.dispatch_authenticated(
            request(id, "orchestration.send", params, Some(WORKER_SECRET)),
            SERVICE_CREDENTIAL,
        );
        assert!(response.ok, "{id}: {:?}", response.error);
        response.result.unwrap()
    }

    fn inbox(&self, id: &str, params: Value, auth: Option<&str>) -> drogon_protocol::Response {
        let req = request(id, "orchestration.inbox", params, auth);
        match auth {
            None => self.engine.dispatch(req),
            Some(_) => self.engine.dispatch_authenticated(req, SERVICE_CREDENTIAL),
        }
    }

    fn inbox_params(&self, limit: Option<u32>, terminal: Option<&str>) -> Value {
        let mut params = json!({
            "scope": {
                "contractVersion": COORDINATION_CONTRACT_VERSION,
                "hostId": self.host,
            },
        });
        if let Some(limit) = limit {
            params["limit"] = json!(limit);
        }
        if let Some(terminal) = terminal {
            params["terminal"] = json!(terminal);
        }
        params
    }

    fn table_count(&self, table: &str) -> i64 {
        let conn = self.engine.db.lock().unwrap();
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }
}

#[test]
fn sweep_is_newest_first_with_count_and_limit() {
    let fx = Fixture::open();
    fx.send_worker("w1", "status", "first", None);
    fx.send_coordinator("c1", "guidance", "second", json!({"kind": "runHome"}));
    fx.seed_addressed("m-second-addressed", "second-addressed");
    fx.send_worker("w2", "question", "third?", Some("need input"));

    let response = fx.inbox("inbox-1", fx.inbox_params(None, None), None);
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    let subjects: Vec<&str> = result["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["subject"].as_str().unwrap())
        .collect();
    assert_eq!(
        subjects,
        vec!["third?", "second-addressed", "second", "first"]
    );
    assert_eq!(result["count"], json!(4));

    let limited = fx
        .inbox("inbox-2", fx.inbox_params(Some(2), None), None)
        .result
        .unwrap();
    let subjects: Vec<&str> = limited["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["subject"].as_str().unwrap())
        .collect();
    assert_eq!(subjects, vec!["third?", "second-addressed"]);
    assert_eq!(limited["count"], json!(2));
}

#[test]
fn terminal_filter_matches_only_addressed_mail_and_stale_reads_empty() {
    let fx = Fixture::open();
    fx.send_worker("w1", "status", "to home", None);
    fx.seed_addressed("m-to-dispatch", "to dispatch");

    let filtered = fx
        .inbox("inbox-t", fx.inbox_params(None, Some(DISPATCH)), None)
        .result
        .unwrap();
    let subjects: Vec<&str> = filtered["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["subject"].as_str().unwrap())
        .collect();
    assert_eq!(subjects, vec!["to dispatch"]);
    assert_eq!(filtered["count"], json!(1));

    let stale = fx
        .inbox(
            "inbox-stale",
            fx.inbox_params(None, Some("dispatch-gone")),
            None,
        )
        .result
        .unwrap();
    assert_eq!(stale["messages"], json!([]));
    assert_eq!(stale["count"], json!(0));
}

#[test]
fn sweep_allocates_no_receipts_deliveries_or_read_pointers() {
    let fx = Fixture::open();
    fx.send_worker("w1", "status", "hello", None);
    let before = fx.table_count("requests");
    assert_eq!(fx.table_count("orchestration_mail_deliveries"), 0);

    let response = fx.inbox("inbox-ro", fx.inbox_params(None, None), None);
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(fx.table_count("requests"), before, "reads never ledger");
    assert_eq!(
        fx.table_count("orchestration_mail_deliveries"),
        0,
        "no delivery minted"
    );
    assert_eq!(
        fx.table_count("orchestration_mail_read_pointers"),
        0,
        "no read pointer moved"
    );
}

#[test]
fn worker_may_sweep_but_not_under_another_terminal() {
    let fx = Fixture::open();
    fx.send_worker("w1", "status", "hello", None);

    let own = fx.inbox(
        "inbox-own",
        fx.inbox_params(None, Some(DISPATCH)),
        Some(WORKER_SECRET),
    );
    assert!(own.ok, "{:?}", own.error);

    let wide = fx.inbox(
        "inbox-wide",
        fx.inbox_params(None, None),
        Some(WORKER_SECRET),
    );
    assert!(wide.ok, "{:?}", wide.error);

    let other = fx.inbox(
        "inbox-other",
        fx.inbox_params(None, Some("dispatch-other")),
        Some(WORKER_SECRET),
    );
    assert!(!other.ok, "a foreign terminal must be refused");
    assert_eq!(other.error.unwrap().code, "invalid_argument");
}

#[test]
fn foreign_host_scope_is_refused() {
    let fx = Fixture::open();
    let response = fx.inbox(
        "inbox-xhost",
        json!({
            "scope": {
                "contractVersion": COORDINATION_CONTRACT_VERSION,
                "hostId": "some-other-host",
            },
        }),
        None,
    );
    assert!(!response.ok, "host scoping must hold");
}

#[test]
fn zero_limit_is_refused() {
    let fx = Fixture::open();
    let response = fx.inbox("inbox-zero", fx.inbox_params(Some(0), None), None);
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "invalid_argument");
}

#[test]
fn full_bodies_and_payloads_round_trip() {
    let fx = Fixture::open();
    // Worker sends travel the authenticated path, not the admin one.
    let authed = fx.engine.dispatch_authenticated(
        request(
            "w-payload",
            "orchestration.send",
            json!({
                "scope": fx.dispatch_scope(),
                "kind": "status",
                "subject": "rich",
                "body": "the body",
                "payload": {"answer": 42},
            }),
            Some(WORKER_SECRET),
        ),
        SERVICE_CREDENTIAL,
    );
    assert!(authed.ok, "{:?}", authed.error);

    let result = fx
        .inbox("inbox-full", fx.inbox_params(None, None), None)
        .result
        .unwrap();
    let message = &result["messages"][0];
    assert_eq!(message["subject"], json!("rich"));
    assert_eq!(message["body"], json!("the body"));
    assert_eq!(message["payload"], json!({"answer": 42}));
    assert_eq!(message["fromActor"], json!(format!("dispatch:{DISPATCH}")));
}

#[test]
fn empty_host_sweep_reads_no_messages() {
    let fx = Fixture::open();
    let result = fx
        .inbox("inbox-empty", fx.inbox_params(None, None), None)
        .result
        .unwrap();
    assert_eq!(result["messages"], json!([]));
    assert_eq!(result["count"], json!(0));
}
