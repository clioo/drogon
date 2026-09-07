//! Compiled-daemon/socket authentication tests with isolated SQLite fixtures.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const CLIENT_TIMEOUT: Duration = Duration::from_secs(5);
const RUN: &str = "run-1";
const TASK: &str = "task-1";
const DISPATCH: &str = "dispatch-1";
const SESSION: &str = "session-1";
const INCARNATION: &str = "incarnation-1";
const WORKER_SECRET: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

struct TestServer {
    dir: tempfile::TempDir,
    token: String,
    child: Child,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_server() -> TestServer {
    start_server_with_sibling_cli(false)
}

fn start_server_with_sibling_cli(with_cli: bool) -> TestServer {
    let dir = tempfile::tempdir().unwrap();
    let binary = dir.path().join("drogond");
    std::fs::copy(env!("CARGO_BIN_EXE_drogond"), &binary).unwrap();
    if with_cli {
        std::fs::copy("/bin/echo", dir.path().join("drogon-cli")).unwrap();
    }
    let child = Command::new(binary)
        .env_clear()
        .arg("--data-dir")
        .arg(dir.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut server = TestServer {
        dir,
        token: String::new(),
        child,
    };
    let deadline = Instant::now() + CLIENT_TIMEOUT;
    loop {
        assert!(
            server.child.try_wait().unwrap().is_none(),
            "daemon exited during startup"
        );
        if let Ok(token) =
            std::fs::read_to_string(server.dir.path().join(drogond::auth::TOKEN_FILE_NAME))
            && UnixStream::connect(server.dir.path().join("runtime-v1.sock")).is_ok()
        {
            server.token = token;
            return server;
        }
        assert!(Instant::now() < deadline, "daemon startup deadline");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn compiled_daemon_configures_its_sibling_worker_cli_without_path_lookup() {
    for with_cli in [false, true] {
        let server = start_server_with_sibling_cli(with_cli);
        let host = host_id_via_admin(&server);
        let run = call(
            &server,
            req(
                "orchestration.runCreate",
                "create",
                Some(&server.token),
                json!({"contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"host CLI configuration"}),
            ),
        );
        assert!(run.ok, "{:?}", run.error);
        let run = run.result.unwrap()["run"]["runId"].clone();
        let response = call(
            &server,
            req(
                "orchestration.workerStart",
                "start",
                Some(&server.token),
                json!({"contractVersion":1,"hostId":host,"runId":run,"coordinatorId":"owner",
            "consumerGeneration":1,"taskId":"missing-task","workspaceId":"missing-folder",
            "mode":"fresh","launch":{"harnessId":"pi"}}),
            ),
        );
        assert!(!response.ok);
        assert_eq!(
            response.error.unwrap().code,
            if with_cli {
                "task_not_found"
            } else {
                "unsupported_feature"
            },
            "host CLI configuration must precede the missing task check"
        );
        assert_eq!(
            fixture_db(server.dir.path())
                .query_row("SELECT count(*) FROM sessions", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

fn connect(server: &TestServer) -> UnixStream {
    let stream = UnixStream::connect(server.dir.path().join("runtime-v1.sock")).unwrap();
    stream.set_read_timeout(Some(CLIENT_TIMEOUT)).unwrap();
    stream.set_write_timeout(Some(CLIENT_TIMEOUT)).unwrap();
    stream
}

fn send(stream: &mut UnixStream, request: &Request) {
    let mut bytes = serde_json::to_vec(request).unwrap();
    bytes.push(b'\n');
    stream.write_all(&bytes).unwrap();
}

fn recv(reader: &mut BufReader<UnixStream>) -> Response {
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

fn call(server: &TestServer, request: Request) -> Response {
    let mut stream = connect(server);
    send(&mut stream, &request);
    let mut reader = BufReader::new(stream);
    recv(&mut reader)
}

fn req(method: &str, request_id: &str, auth: Option<&str>, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "auth": auth,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn digest_hex(secret: &str) -> String {
    format!("{:x}", Sha256::digest(secret.as_bytes()))
}

fn seed_worker_credential(data_dir: &Path, host_id: &str, secret: &str) {
    fixture_db(data_dir).execute(
        "INSERT INTO orchestration_dispatch_credentials
            (digest, host_id, run_id, task_id, dispatch_id, session_id, incarnation, revoked, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, '2026-09-07T00:00:00Z');",
        params![digest_hex(secret), host_id, RUN, TASK, DISPATCH, SESSION, INCARNATION],
    ).unwrap();
}

fn revoke_worker_credential(data_dir: &Path) {
    fixture_db(data_dir)
        .execute(
            "UPDATE orchestration_dispatch_credentials SET revoked = 1 WHERE dispatch_id = ?1",
            [DISPATCH],
        )
        .unwrap();
}

fn count_ledger_rows(data_dir: &Path) -> i64 {
    fixture_db(data_dir)
        .query_row("SELECT COUNT(*) FROM requests", [], |row| row.get(0))
        .unwrap()
}

fn fixture_db(data_dir: &Path) -> Connection {
    let conn = Connection::open(data_dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.busy_timeout(CLIENT_TIMEOUT).unwrap();
    conn
}

fn host_id_via_admin(server: &TestServer) -> String {
    let response = call(
        server,
        req("status", "boot", Some(&server.token), json!({})),
    );
    response.result.unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string()
}

fn dispatch_scope(host_id: &str) -> Value {
    json!({
        "actorKind": "dispatch",
        "contractVersion": 1,
        "hostId": host_id,
        "runId": RUN,
        "taskId": TASK,
        "dispatchId": DISPATCH,
    })
}

#[test]
fn valid_persisted_worker_credential_gets_a_real_status_response_over_the_real_socket() {
    let server = start_server();
    let host_id = host_id_via_admin(&server);
    seed_worker_credential(server.dir.path(), &host_id, WORKER_SECRET);

    let response = call(&server, req("status", "r1", Some(WORKER_SECRET), json!({})));
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(response.result.unwrap()["hostId"], json!(host_id));
}

#[test]
fn raw_session_method_is_refused_with_no_effects_over_the_real_socket() {
    let server = start_server();
    let host_id = host_id_via_admin(&server);
    seed_worker_credential(server.dir.path(), &host_id, WORKER_SECRET);

    let response = call(
        &server,
        req(
            "session.start",
            "r1",
            Some(WORKER_SECRET),
            json!({"workspaceId": "w1", "command": "/bin/sh"}),
        ),
    );
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "unauthorized");

    // No ledger row for a refused-before-lookup worker request.
    assert_eq!(count_ledger_rows(server.dir.path()), 0);
    // No session was actually admitted/spawned either.
    let listed = call(
        &server,
        req("session.list", "r2", Some(&server.token), json!({})),
    );
    assert_eq!(
        listed.result.unwrap()["sessions"].as_array().unwrap().len(),
        0
    );
}

#[test]
fn other_scope_and_coordinator_escalation_are_refused_over_the_real_socket() {
    let server = start_server();
    let host_id = host_id_via_admin(&server);
    seed_worker_credential(server.dir.path(), &host_id, WORKER_SECRET);

    let mut mismatched = dispatch_scope(&host_id);
    mismatched["dispatchId"] = json!("some-other-dispatch");
    let scope_mismatch = call(
        &server,
        req(
            "orchestration.send",
            "r1",
            Some(WORKER_SECRET),
            json!({ "scope": mismatched }),
        ),
    );
    assert!(!scope_mismatch.ok);
    assert_eq!(scope_mismatch.error.unwrap().code, "unauthorized");

    let coordinator_scope = json!({
        "actorKind": "coordinator",
        "contractVersion": 1,
        "hostId": host_id,
        "runId": RUN,
        "coordinatorId": "coord-1",
        "consumerGeneration": 1,
    });
    let escalation = call(
        &server,
        req(
            "orchestration.reply",
            "r2",
            Some(WORKER_SECRET),
            json!({ "scope": coordinator_scope }),
        ),
    );
    assert!(!escalation.ok);
    assert_eq!(escalation.error.unwrap().code, "unauthorized");
    assert_eq!(count_ledger_rows(server.dir.path()), 0);
}

#[test]
fn revoked_credential_is_refused_with_no_receipts_or_effects_over_the_real_socket() {
    let server = start_server();
    let host_id = host_id_via_admin(&server);
    seed_worker_credential(server.dir.path(), &host_id, WORKER_SECRET);
    revoke_worker_credential(server.dir.path());

    let response = call(&server, req("status", "r1", Some(WORKER_SECRET), json!({})));
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "unauthorized");
    assert_eq!(count_ledger_rows(server.dir.path()), 0);
}

#[test]
fn admin_token_path_over_the_real_socket_is_unchanged() {
    let server = start_server();
    let response = call(&server, req("status", "r1", Some(&server.token), json!({})));
    assert!(response.ok, "{:?}", response.error);
}
