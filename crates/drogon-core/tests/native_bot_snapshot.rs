use drogon_core::{DB_FILE_NAME, Engine, bots};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

struct Fixture {
    dir: tempfile::TempDir,
    engine: Engine,
    workspace: Value,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(&dir.path().join("data")).unwrap();
        let workspace = call(&engine, "workspace.register", json!({"path":dir.path()}))
            .result
            .unwrap();
        Self {
            dir,
            engine,
            workspace,
        }
    }

    fn conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.dir.path().join("data").join(DB_FILE_NAME)).unwrap()
    }

    fn scope(&self) -> Value {
        json!({"hostId":self.workspace["hostId"], "workspaceId":self.workspace["id"], "locale":"en-US"})
    }

    fn seed(&self, id: &str, host: &str, folder: &str) {
        let bot = bots::records::normalize_bot(
            &json!({"id":id,"displayIdentity":{"displayName":id}}),
            |_| true,
            1.0,
        )
        .unwrap();
        bots::storage::create_bot(&self.conn(), host, folder, &bot).unwrap();
    }
}

#[test]
fn snapshot_uses_registered_folder_and_returns_only_its_host_scope() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("ours", host, folder);
    fx.seed("other-folder", host, "another-folder");
    fx.seed("other-host", "remote-host", folder);
    let result = call(&fx.engine, "bot.snapshot", fx.scope());
    assert!(result.ok, "{result:?}");
    let data = result.result.unwrap();
    assert_eq!(data["workspaceId"], fx.workspace["id"]);
    assert_eq!(data["hostId"], fx.workspace["hostId"]);
    assert_eq!(data["bots"].as_array().unwrap().len(), 1);
    assert_eq!(data["bots"][0]["id"], "ours");
    assert_eq!(data["history"], json!([]));
}

#[test]
fn missing_and_foreign_host_are_not_an_empty_success() {
    let fx = Fixture::new();
    let mut scope = fx.scope();
    scope["hostId"] = json!("other-host");
    assert_eq!(
        call(&fx.engine, "bot.snapshot", scope.clone())
            .error
            .unwrap()
            .code,
        "unsupported_host"
    );
    scope.as_object_mut().unwrap().remove("hostId");
    assert_eq!(
        call(&fx.engine, "bot.snapshot", scope).error.unwrap().code,
        "invalid_argument"
    );
}

#[test]
fn foreign_workspace_row_is_rejected_even_with_local_host_parameter() {
    let fx = Fixture::new();
    fx.conn()
        .execute(
            "UPDATE workspaces SET host_id='remote' WHERE id=?1",
            [fx.workspace["id"].as_str().unwrap()],
        )
        .unwrap();
    assert_eq!(
        call(&fx.engine, "bot.snapshot", fx.scope())
            .error
            .unwrap()
            .code,
        "unsupported_host"
    );
}

#[test]
fn malformed_bot_remains_on_disk_and_is_not_hidden_as_empty() {
    let fx = Fixture::new();
    fx.seed(
        "broken",
        fx.workspace["hostId"].as_str().unwrap(),
        fx.workspace["path"].as_str().unwrap(),
    );
    fx.conn()
        .execute("UPDATE bots SET payload_json='{' WHERE id='broken'", [])
        .unwrap();
    assert_eq!(
        call(&fx.engine, "bot.snapshot", fx.scope())
            .error
            .unwrap()
            .code,
        "storage_error"
    );
    let raw: String = fx
        .conn()
        .query_row("SELECT payload_json FROM bots WHERE id='broken'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(raw, "{");
}

#[test]
fn client_folder_override_is_rejected() {
    let fx = Fixture::new();
    let mut scope = fx.scope();
    scope["folder"] = json!("another-folder");
    assert_eq!(
        call(&fx.engine, "bot.snapshot", scope).error.unwrap().code,
        "invalid_argument"
    );
}
