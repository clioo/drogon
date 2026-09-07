use base64::Engine as _;
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::fs;

fn call(engine: &Engine, id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

struct Fixture {
    root: tempfile::TempDir,
    engine: Engine,
    workspace: Value,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("folder")).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let workspace = call(
            &engine,
            "register",
            "workspace.register",
            json!({"path":root.path().join("folder")}),
        )
        .result
        .unwrap();
        Self {
            root,
            engine,
            workspace,
        }
    }

    fn params(&self, path: &str) -> Value {
        json!({"workspaceId":self.workspace["id"], "hostId":self.workspace["hostId"], "path":path})
    }

    fn file(&self, name: &str) -> std::path::PathBuf {
        self.root.path().join("folder").join(name)
    }
}

#[test]
fn list_and_read_are_workspace_host_correlated() {
    let fx = Fixture::new();
    fs::write(fx.file("hello.txt"), "hello é\n").unwrap();
    let listed = call(&fx.engine, "list", "files.list", fx.params(""));
    assert!(listed.ok, "{listed:?}");
    let listed = listed.result.unwrap();
    assert_eq!(listed["workspaceId"], fx.workspace["id"]);
    assert_eq!(listed["hostId"], fx.workspace["hostId"]);
    assert_eq!(listed["path"], "");
    assert_eq!(listed["entries"][0]["name"], "hello.txt");
    assert_eq!(listed["entries"][0]["kind"], "file");
    assert_eq!(listed["truncated"], false);
    let read = call(&fx.engine, "read", "files.read", fx.params("hello.txt"));
    assert!(read.ok, "{read:?}");
    let read = read.result.unwrap();
    assert_eq!(read["content"], "hello é\n");
    assert_eq!(read["size"], 9);
    assert_eq!(read["workspaceId"], fx.workspace["id"]);
    assert_eq!(read["hostId"], fx.workspace["hostId"]);
    assert_eq!(read["path"], "hello.txt");
}

#[test]
fn wrong_or_missing_host_is_rejected_before_file_access() {
    let fx = Fixture::new();
    for method in ["files.list", "files.read", "files.write"] {
        let mut params = fx.params("missing");
        params["contentBase64"] = json!("eA==");
        params["hostId"] = json!("another-host");
        let result = call(
            &fx.engine,
            &format!("wrong-{method}"),
            method,
            params.clone(),
        );
        assert_eq!(result.error.unwrap().code, "unsupported_host");
        params.as_object_mut().unwrap().remove("hostId");
        let result = call(&fx.engine, &format!("missing-{method}"), method, params);
        assert_eq!(result.error.unwrap().code, "invalid_argument");
    }
    assert!(!fx.file("missing").exists());
}

#[test]
fn foreign_workspace_row_cannot_be_resolved_to_local_files() {
    let fx = Fixture::new();
    fs::write(fx.file("secret.txt"), "private").unwrap();
    let conn =
        rusqlite::Connection::open(fx.root.path().join("data").join(drogon_core::DB_FILE_NAME))
            .unwrap();
    conn.execute(
        "UPDATE workspaces SET host_id = 'other' WHERE id = ?1",
        [fx.workspace["id"].as_str().unwrap()],
    )
    .unwrap();
    for method in ["files.read", "files.list", "files.write"] {
        let mut params = fx.params("secret.txt");
        params["contentBase64"] = json!("bmV3");
        let result = call(&fx.engine, &format!("foreign-{method}"), method, params);
        assert_eq!(result.error.unwrap().code, "unsupported_host");
    }
    assert_eq!(
        fs::read_to_string(fx.file("secret.txt")).unwrap(),
        "private"
    );
}

#[test]
fn write_replay_does_not_overwrite_a_later_external_edit() {
    let fx = Fixture::new();
    let mut params = fx.params("edited.txt");
    params["contentBase64"] = json!(base64::engine::general_purpose::STANDARD.encode("first"));
    let first = call(&fx.engine, "save-once", "files.write", params.clone());
    assert!(first.ok, "{first:?}");
    assert_eq!(fs::read_to_string(fx.file("edited.txt")).unwrap(), "first");
    fs::write(fx.file("edited.txt"), "external").unwrap();
    let replay = call(&fx.engine, "save-once", "files.write", params.clone());
    assert_eq!(replay.result, first.result);
    assert_eq!(
        fs::read_to_string(fx.file("edited.txt")).unwrap(),
        "external"
    );
    params["contentBase64"] = json!("bmV3");
    let conflict = call(&fx.engine, "save-once", "files.write", params);
    assert_eq!(conflict.error.unwrap().code, "request_conflict");
    assert_eq!(
        fs::read_to_string(fx.file("edited.txt")).unwrap(),
        "external"
    );
}

#[test]
fn file_bounds_and_invalid_payloads_fail_without_mutating_files() {
    let fx = Fixture::new();
    fs::write(fx.file("large.txt"), vec![b'a'; 65_537]).unwrap();
    let read = call(&fx.engine, "large", "files.read", fx.params("large.txt"));
    assert_eq!(read.error.unwrap().code, "invalid_argument");
    for (id, bytes) in [
        ("bad-base64", "%%%".to_string()),
        ("invalid-utf8", "/w==".to_string()),
        (
            "large-write",
            base64::engine::general_purpose::STANDARD.encode(vec![0; 65_537]),
        ),
    ] {
        let mut params = fx.params("new.txt");
        params["contentBase64"] = json!(bytes);
        let response = call(&fx.engine, id, "files.write", params);
        assert_eq!(response.error.unwrap().code, "invalid_argument");
        assert!(!fx.file("new.txt").exists());
    }
}

#[test]
fn response_frame_remains_bounded_for_maximally_escaped_content() {
    let fx = Fixture::new();
    fs::write(fx.file("escaped.txt"), vec![0; 65_536]).unwrap();
    let response = call(
        &fx.engine,
        "escaped",
        "files.read",
        fx.params("escaped.txt"),
    );
    assert!(response.ok, "{response:?}");
    assert!(serde_json::to_vec(&response).unwrap().len() < drogon_protocol::MAX_FRAME_BYTES);
    assert_eq!(response.result.unwrap()["size"], 65_536);
}

#[cfg(unix)]
#[test]
fn listing_byte_budget_truncates_escaped_names_before_frame_overflow() {
    let fx = Fixture::new();
    for index in 0..600 {
        fs::write(fx.file(&format!("{index:04}{}", "\u{1}".repeat(220))), "").unwrap();
    }
    let response = call(&fx.engine, "escaped-list", "files.list", fx.params(""));
    assert!(response.ok, "{response:?}");
    assert!(serde_json::to_vec(&response).unwrap().len() < drogon_protocol::MAX_FRAME_BYTES);
    let result = response.result.unwrap();
    assert_eq!(result["truncated"], true);
    assert!(!result["entries"].as_array().unwrap().is_empty());
    assert!(result["entries"].as_array().unwrap().len() < 600);
}

#[test]
fn listing_limit_is_explicit_and_traversal_is_refused() {
    let fx = Fixture::new();
    fs::write(fx.file("a"), "a").unwrap();
    fs::write(fx.file("b"), "b").unwrap();
    let mut params = fx.params("");
    params["limitEntries"] = json!(1);
    let response = call(&fx.engine, "bounded", "files.list", params);
    assert!(response.ok, "{response:?}");
    let result = response.result.unwrap();
    assert_eq!(result["entries"].as_array().unwrap().len(), 1);
    assert_eq!(result["truncated"], true);
    let response = call(
        &fx.engine,
        "traversal",
        "files.read",
        fx.params("../outside"),
    );
    assert_eq!(response.error.unwrap().code, "invalid_argument");
}
