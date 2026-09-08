use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn success(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

fn failure(response: Response, code: &str) {
    assert!(!response.ok, "{response:?}");
    assert_eq!(response.error.unwrap().code, code);
}

struct Fixture {
    root: tempfile::TempDir,
    engine: Engine,
    workspace: Value,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let workspace = success(engine.dispatch(request(
            "register",
            "workspace.register",
            json!({"path":folder}),
        )));
        Self {
            root,
            engine,
            workspace,
        }
    }

    fn conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.root.path().join("data").join(DB_FILE_NAME)).unwrap()
    }

    fn params(&self) -> Value {
        json!({
            "workspaceId": self.workspace["id"],
            "hostId": self.workspace["hostId"],
            "body": {
                "characterPreset": "none",
                "displayIdentity": {"displayName":"Watcher", "handle":null, "title":null},
                "harnessPolicy": {"defaultHarness":"codex", "explicitModel":null},
                "instructions": "Review changes",
                "memories": []
            }
        })
    }

    fn create(&self, id: &str, params: Value) -> Response {
        self.engine.dispatch(request(id, "bot.create", params))
    }

    fn counts(&self) -> (i64, i64, i64) {
        self.conn()
            .query_row(
                "SELECT (SELECT COUNT(*) FROM bots),
                    (SELECT COUNT(*) FROM requests WHERE method='bot.create'),
                    (SELECT COUNT(*) FROM sessions)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap()
    }
}

#[test]
fn create_is_born_empty_durable_scoped_and_never_starts_a_session() {
    let fx = Fixture::new();
    let before_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    let mut params = fx.params();
    params["botId"] = json!("chosen-bot");
    let created = success(fx.create("create", params));
    assert_eq!(created["id"], "chosen-bot");
    assert_eq!(created["responsibilities"], json!([]));
    assert_eq!(created["currentSession"], Value::Null);
    assert_eq!(created["displayIdentity"]["displayName"], "Watcher");
    let after_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    assert!((before_ms..=after_ms).contains(&created["createdAt"].as_f64().unwrap()));
    assert_eq!(created["createdAt"], created["updatedAt"]);
    assert_eq!(fx.counts(), (1, 1, 0));
    let snapshot = success(fx.engine.dispatch(request(
        "snapshot",
        "bot.snapshot",
        json!({
            "hostId":fx.workspace["hostId"], "workspaceId":fx.workspace["id"], "locale":"en-US"
        }),
    )));
    assert_eq!(snapshot["bots"], json!([created]));
    assert_eq!(snapshot["history"], json!([]));
}

#[test]
fn invalid_bot_ids_are_rejected_before_record_or_receipt_insertion() {
    let fx = Fixture::new();
    for (index, id) in [
        String::new(),
        "bad\nidentity".into(),
        "x".repeat(129),
        "bad\u{7f}".into(),
    ]
    .into_iter()
    .enumerate()
    {
        let mut params = fx.params();
        params["botId"] = json!(id);
        failure(
            fx.create(&format!("invalid-{index}"), params),
            "invalid_argument",
        );
        assert_eq!(fx.counts(), (0, 0, 0));
    }
}

#[test]
fn strict_shape_and_born_empty_rules_reject_without_effects() {
    let fx = Fixture::new();
    for (index, (field, value)) in [
        ("responsibilities", json!([{"id":"not-empty"}])),
        ("currentSession", json!({"sessionId":"not-empty"})),
        ("unknown", json!(true)),
    ]
    .into_iter()
    .enumerate()
    {
        let mut params = fx.params();
        params["body"][field] = value;
        failure(
            fx.create(&format!("strict-{index}"), params),
            "invalid_argument",
        );
        assert_eq!(fx.counts(), (0, 0, 0));
    }
    let mut params = fx.params();
    params["requestId"] = json!("params-cannot-own-envelope");
    failure(fx.create("nested-request", params), "invalid_argument");
    assert_eq!(fx.counts(), (0, 0, 0));
}

#[test]
fn foreign_or_missing_workspace_is_denied_without_receipt() {
    let fx = Fixture::new();
    let mut params = fx.params();
    params["hostId"] = json!("foreign-host");
    failure(fx.create("foreign", params), "foreign_workspace_host");
    let mut params = fx.params();
    params["workspaceId"] = json!("missing-workspace");
    failure(fx.create("missing", params), "unknown_workspace");
    assert_eq!(fx.counts(), (0, 0, 0));
}

#[test]
fn quiescent_service_refuses_new_creation() {
    let fx = Fixture::new();
    let status = success(fx.engine.dispatch(request("status", "status", json!({}))));
    success(fx.engine.dispatch(request(
        "shutdown",
        "runtime.shutdown",
        json!({
            "hostId": status["hostId"], "serviceInstanceId": status["serviceInstanceId"]
        }),
    )));
    failure(fx.create("late", fx.params()), "runtime_busy");
    assert_eq!(fx.counts(), (0, 0, 0));
}

#[test]
fn minted_identity_and_exact_receipt_survive_engine_reopen() {
    let fx = Fixture::new();
    let params = fx.params();
    let first = fx.create("create-once", params.clone());
    assert!(first.ok, "{first:?}");
    assert!(
        !first.result.as_ref().unwrap()["id"]
            .as_str()
            .unwrap()
            .is_empty()
    );
    let first_bytes = serde_json::to_vec(&first).unwrap();
    assert_eq!(
        serde_json::to_vec(&fx.create("create-once", params.clone())).unwrap(),
        first_bytes
    );
    assert_eq!(fx.counts(), (1, 1, 0));
    let Fixture { root, engine, .. } = fx;
    drop(engine);
    let reopened = Engine::open(&root.path().join("data")).unwrap();
    let replay = reopened.dispatch(request("create-once", "bot.create", params));
    assert_eq!(serde_json::to_vec(&replay).unwrap(), first_bytes);
    let conn = rusqlite::Connection::open(root.path().join("data").join(DB_FILE_NAME)).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM bots", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn changed_params_conflict_without_changing_the_created_record() {
    let fx = Fixture::new();
    let mut params = fx.params();
    let first = success(fx.create("create-once", params.clone()));
    params["body"]["instructions"] = json!("Different task");
    failure(fx.create("create-once", params), "request_conflict");
    assert_eq!(success(fx.create("create-once", fx.params())), first);
    assert_eq!(fx.counts(), (1, 1, 0));
}

#[test]
fn rejected_auth_cannot_obtain_an_existing_success_receipt() {
    let fx = Fixture::new();
    let first = success(fx.create("create-once", fx.params()));
    let mut replay = request("create-once", "bot.create", fx.params());
    replay.auth = Some("synthetic-wrong-credential".into());
    failure(
        fx.engine.dispatch_authenticated(replay, "synthetic-admin"),
        "unauthorized",
    );
    assert_eq!(success(fx.create("create-once", fx.params())), first);
    assert_eq!(fx.counts(), (1, 1, 0));
}

#[test]
fn workspace_authority_is_rechecked_before_replaying_a_success() {
    let fx = Fixture::new();
    let first = success(fx.create("create-once", fx.params()));
    fx.conn()
        .execute(
            "UPDATE workspaces SET host_id='foreign-host' WHERE id=?1",
            [fx.workspace["id"].as_str().unwrap()],
        )
        .unwrap();
    failure(
        fx.create("create-once", fx.params()),
        "foreign_workspace_host",
    );
    assert_eq!(fx.counts(), (1, 1, 0));
    fx.conn()
        .execute(
            "UPDATE workspaces SET host_id=?1 WHERE id=?2",
            rusqlite::params![
                fx.workspace["hostId"].as_str().unwrap(),
                fx.workspace["id"].as_str().unwrap()
            ],
        )
        .unwrap();
    assert_eq!(success(fx.create("create-once", fx.params())), first);
}

#[test]
fn failed_receipt_insert_rolls_back_the_bot_and_can_retry_after_repair() {
    let fx = Fixture::new();
    fx.conn()
        .execute_batch(
            "CREATE TRIGGER reject_bot_receipt BEFORE INSERT ON requests
         WHEN NEW.method='bot.create'
         BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;",
        )
        .unwrap();
    failure(fx.create("create-once", fx.params()), "unverifiable");
    assert_eq!(fx.counts(), (0, 0, 0));
    fx.conn()
        .execute_batch("DROP TRIGGER reject_bot_receipt")
        .unwrap();
    success(fx.create("create-once", fx.params()));
    assert_eq!(fx.counts(), (1, 1, 0));
}

#[test]
fn concurrent_same_request_creates_one_bot_and_identical_responses() {
    let fx = Fixture::new();
    let params = fx.params();
    let barrier = std::sync::Barrier::new(4);
    let replies = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..4)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    serde_json::to_vec(&fx.create("create-concurrent", params.clone())).unwrap()
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    let first: Response = serde_json::from_slice(&replies[0]).unwrap();
    assert!(first.ok, "{first:?}");
    assert!(replies.iter().all(|reply| reply == &replies[0]));
    assert_eq!(fx.counts(), (1, 1, 0));
}

// R16-S: a Pi bot created with a provider/model string keeps it end to end
// (create receipt and snapshot), so `bot.run` callers can resolve
// `--provider/--model` from the stored bot.
#[test]
fn create_persists_explicit_model_string_for_pi_bots() {
    let fx = Fixture::new();
    let mut params = fx.params();
    params["body"]["harnessPolicy"] = serde_json::json!({"defaultHarness":"pi", "explicitModel":"dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"});
    let created = success(fx.create("create-model", params));
    assert_eq!(
        created["harnessPolicy"],
        serde_json::json!({"defaultHarness":"pi", "explicitModel":"dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"})
    );
    let snapshot = success(fx.engine.dispatch(request(
        "snapshot-model",
        "bot.snapshot",
        serde_json::json!({
            "hostId":fx.workspace["hostId"], "workspaceId":fx.workspace["id"], "locale":"en-US"
        }),
    )));
    let bots = snapshot["bots"].as_array().expect("bots array");
    assert_eq!(bots.len(), 1);
    assert_eq!(
        bots[0]["harnessPolicy"],
        serde_json::json!({"defaultHarness":"pi", "explicitModel":"dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"})
    );
}
