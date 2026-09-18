//! End-to-end drogon-cli behavior against a mock native protocol-v1 service.
//! Every exit code, envelope rule and param mapping demanded by
//! `docs/migration/protocol-v1.md` is exercised through the real binary.

#![cfg(unix)]

mod common;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use std::path::Path;

use common::{
    Action, Behavior, MockService, error_envelope, ok_envelope, run_cli, run_cli_in, run_cli_with,
    stderr, stdout,
};

fn temp_data_dir(name: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(&format!("drogon-cli-test-{name}-"))
        .tempdir()
        .expect("tempdir")
}

fn session_result(id: &str) -> Value {
    json!({
        "id": id,
        "workspaceId": "ws-1",
        "hostId": "host-1",
        "incarnation": "inc-1",
        "command": "sh",
        "args": [],
        "cols": 80,
        "rows": 24,
        "verdict": "live",
        "exitCode": null,
        "createdAt": "2026-09-05T12:00:00Z",
        "agentState": "unknown",
        "agentStateAt": null
    })
}

fn echo_behavior() -> Behavior {
    std::sync::Arc::new(|request| {
        let request_id = request["requestId"].as_str().unwrap_or("").to_string();
        let result = match request["method"].as_str() {
            Some("workspace.register") => json!({
                "id": "ws-1",
                "path": request["params"]["path"],
                "name": request["params"]["name"].as_str().unwrap_or("ws"),
                "kind": "folder",
                "hostId": "host-1"
            }),
            Some("workspace.list") => json!({ "workspaces": [] }),
            Some("session.start") => session_result("sess-1"),
            Some("session.list") => json!({ "sessions": [] }),
            Some("session.read") => json!({
                "session": session_result("sess-1"),
                "dataBase64": "aGkK",
                "startCursor": 0,
                "nextCursor": 3,
                "truncated": false
            }),
            Some("session.write") => json!({
                "acceptedBytes": base64::engine::general_purpose::STANDARD
                    .decode(request["params"]["dataBase64"].as_str().unwrap_or(""))
                    .map(|bytes| bytes.len())
                    .unwrap_or(0)
            }),
            Some("session.resize") => {
                let mut session = session_result("sess-1");
                session["cols"] = request["params"]["cols"].clone();
                session["rows"] = request["params"]["rows"].clone();
                session
            }
            Some("session.stop") | Some("session.close") => json!({
                "id": "sess-1",
                "workspaceId": "ws-1",
                "hostId": "host-1",
                "incarnation": "inc-1",
                "command": "sh",
                "args": [],
                "cols": 80,
                "rows": 24,
                "verdict": "exited",
                "exitCode": 0,
                "createdAt": "2026-09-05T12:00:00Z",
                "agentState": "exited",
                "agentStateAt": null
            }),
            _ => json!({}),
        };
        Action::Respond(ok_envelope(&request_id, result))
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_ok_exits_zero_and_prints_identity() {
    let dir = temp_data_dir("status");
    let service = MockService::start(dir.path(), common::status_ok_behavior());

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(0));
    let text = stdout(&output);
    assert!(text.contains("host: host-1"), "stdout: {text}");
    assert!(text.contains("protocol: 1"));
    assert!(text.contains("capabilities: workspace.v1, session.pty.v1"));
    assert!(!stdout(&output).is_empty());
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_json_prints_exactly_one_envelope_with_generated_uuid() {
    let dir = temp_data_dir("status-json");
    let service = MockService::start(dir.path(), common::status_ok_behavior());

    let output = run_cli(dir.path(), &["--json", "status"]);
    assert_eq!(output.status.code(), Some(0));
    let text = stdout(&output);
    let envelope: Value = serde_json::from_str(&text).expect("exactly one JSON envelope");
    assert_eq!(envelope["protocol"], 1);
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["result"]["hostId"], "host-1");
    let request_id = envelope["requestId"].as_str().expect("requestId");
    let parsed = uuid::Uuid::parse_str(request_id).expect("generated id is a UUID");
    assert_eq!(parsed.get_version_num(), 4);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explicit_request_id_is_replayed_verbatim() {
    let dir = temp_data_dir("replay");
    let service = MockService::start(dir.path(), echo_behavior());

    for _ in 0..2 {
        let output = run_cli(
            dir.path(),
            &[
                "--request-id",
                "fixed-request-id-1",
                "--json",
                "workspace",
                "list",
            ],
        );
        assert_eq!(output.status.code(), Some(0));
    }
    let captured = service.captured();
    assert_eq!(captured.len(), 2, "one request per invocation");
    for request in captured {
        assert_eq!(request["requestId"], "fixed-request-id-1");
    }
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rpc_error_response_is_exit_1_with_stable_code() {
    let dir = temp_data_dir("rpc-error");
    let behavior: Behavior = std::sync::Arc::new(|request| {
        Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "not_found",
            "no such session",
        ))
    });
    let service = MockService::start(dir.path(), behavior);

    let human = run_cli(
        dir.path(),
        &["terminal", "read", "--session", "s", "--incarnation", "t"],
    );
    assert_eq!(human.status.code(), Some(1));
    assert!(stderr(&human).contains("error: not_found: no such session"));
    assert!(stdout(&human).is_empty(), "human errors stay off stdout");

    let json = run_cli_with(
        dir.path(),
        &[
            "--json",
            "terminal",
            "read",
            "--session",
            "s",
            "--incarnation",
            "t",
        ],
        &[],
    );
    assert_eq!(json.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&json)).expect("one JSON envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "not_found");
    assert_eq!(envelope["error"]["retryable"], false);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn protocol_mismatch_is_a_client_detected_failure() {
    let dir = temp_data_dir("protocol");
    let behavior: Behavior = std::sync::Arc::new(|request| {
        let mut envelope = ok_envelope(request["requestId"].as_str().unwrap_or(""), json!({}));
        envelope["protocol"] = json!(2);
        Action::Respond(envelope)
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    let err = stderr(&output);
    assert!(
        err.contains("mismatch") || err.contains("protocol"),
        "stderr: {err}"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn wrong_request_id_in_response_is_rejected() {
    let dir = temp_data_dir("wrong-id");
    let behavior: Behavior = std::sync::Arc::new(|_request| {
        Action::Respond(ok_envelope("not-the-id-you-sent", json!({ "echo": true })))
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("mismatch") || stderr(&output).contains("Invalid"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bad_auth_response_shape_is_rejected() {
    let dir = temp_data_dir("bad-shape");
    // ok:true carrying an error instead of a result.
    let behavior: Behavior = std::sync::Arc::new(|request| {
        Action::Respond(json!({
            "protocol": 1,
            "requestId": request["requestId"],
            "ok": true,
            "error": { "code": "unauthorized", "message": "nope", "retryable": false }
        }))
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("envelope"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn oversized_newlineless_flood_is_bounded_and_fails_cleanly() {
    let dir = temp_data_dir("flood");
    let behavior: Behavior = std::sync::Arc::new(|_| Action::Raw(vec![b'x'; 2 * 1024 * 1024]));
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    let err = stderr(&output);
    assert!(err.contains("protocol limit"), "stderr: {err}");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_disconnect_without_response_is_unverifiable() {
    let dir = temp_data_dir("disconnect");
    let service = MockService::start(dir.path(), std::sync::Arc::new(|_| Action::Close));

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    let err = stderr(&output);
    assert!(err.contains("unverifiable"), "stderr: {err}");
    assert!(
        !err.contains("exited"),
        "transport loss must never read exited"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_json_frame_is_rejected() {
    let dir = temp_data_dir("malformed");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|_| Action::Raw(b"not json\n".to_vec())),
    );

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("not valid JSON"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_result_shape_is_refused_not_guessed() {
    let dir = temp_data_dir("bad-result");
    let behavior: Behavior = std::sync::Arc::new(|request| {
        // status without hostId/protocol/capabilities/version.
        Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({ "x": 1 }),
        ))
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("malformed status result"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_runtime_is_unverifiable_and_launches_nothing() {
    let dir = temp_data_dir("missing");
    // No socket, no auth token, nothing running.
    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    let err = stderr(&output);
    assert!(err.contains("unverifiable"), "stderr: {err}");
    // The data dir must still be empty: the CLI never starts a daemon.
    let entries: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
    assert!(entries.is_empty(), "CLI must not create runtime artifacts");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn argv_boundary_after_double_dash_is_verbatim() {
    let dir = temp_data_dir("argv");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "create",
            "--workspace",
            "ws-1",
            "--",
            "cargo",
            "run",
            "--release",
            "--features",
            "big name",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.first_captured();
    assert_eq!(request["method"], "session.start");
    assert_eq!(request["params"]["workspaceId"], "ws-1");
    assert_eq!(request["params"]["command"], "cargo");
    assert_eq!(
        request["params"]["args"],
        json!(["run", "--release", "--features", "big name"])
    );
    assert!(stdout(&output).contains("Started session sess-1 [live]"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn workspace_paths_with_spaces_survive_verbatim() {
    let dir = temp_data_dir("spaces");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(
        dir.path(),
        &[
            "workspace",
            "add",
            "/tmp/dir with spaces/sub dir",
            "--name",
            "My Space",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.first_captured();
    assert_eq!(request["method"], "workspace.register");
    assert_eq!(request["params"]["path"], "/tmp/dir with spaces/sub dir");
    assert_eq!(request["params"]["name"], "My Space");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_encodes_utf8_text_to_base64_exactly_once() {
    let dir = temp_data_dir("send");
    let service = MockService::start(dir.path(), echo_behavior());

    let text = "héllo → wörld ✓";
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "send",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
            "--text",
            text,
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.first_captured();
    assert_eq!(request["method"], "session.write");
    assert_eq!(
        request["params"]["dataBase64"],
        STANDARD.encode(text.as_bytes()),
        "dataBase64 must be the single UTF-8 base64 encoding"
    );
    // The CLI now cross-checks acceptedBytes against the exact input byte
    // count, so the mock's echo must match it.
    assert!(stdout(&output).contains(&format!("Wrote {} bytes", text.len())));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_human_decodes_and_json_preserves_wire_bytes() {
    let dir = temp_data_dir("read");
    let service = MockService::start(dir.path(), echo_behavior());

    let human = run_cli(
        dir.path(),
        &[
            "terminal",
            "read",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
        ],
    );
    assert_eq!(human.status.code(), Some(0));
    let text = stdout(&human);
    assert!(text.starts_with("session sess-1 [live] agent=unknown cursor 0..3 truncated=false"));
    assert!(text.contains("hi\n"));

    let json = run_cli(
        dir.path(),
        &[
            "--json",
            "terminal",
            "read",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
        ],
    );
    assert_eq!(json.status.code(), Some(0));
    let envelope: Value = serde_json::from_str(&stdout(&json)).unwrap();
    assert_eq!(envelope["result"]["dataBase64"], "aGkK");
    assert_eq!(envelope["result"]["startCursor"], 0);
    assert_eq!(envelope["result"]["nextCursor"], 3);
    assert_eq!(envelope["result"]["truncated"], false);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resize_and_close_send_incarnation_gated_params() {
    let dir = temp_data_dir("resize-close");
    let service = MockService::start(dir.path(), echo_behavior());

    let resize = run_cli(
        dir.path(),
        &[
            "terminal",
            "resize",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
            "--cols",
            "120",
            "--rows",
            "40",
        ],
    );
    assert_eq!(resize.status.code(), Some(0), "stderr: {}", stderr(&resize));
    let request = service.first_captured();
    assert_eq!(request["method"], "session.resize");
    assert_eq!(request["params"]["sessionId"], "sess-1");
    assert_eq!(request["params"]["incarnation"], "inc-1");
    assert_eq!(request["params"]["cols"], 120);
    assert_eq!(request["params"]["rows"], 40);
    assert!(stdout(&resize).contains("Resized sess-1 to 120x40"));

    let close = run_cli(
        dir.path(),
        &[
            "terminal",
            "close",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
        ],
    );
    assert_eq!(close.status.code(), Some(0));
    let request = service
        .captured()
        .into_iter()
        .nth(1)
        .expect("second captured request is the close");
    assert_eq!(request["method"], "session.close");
    assert!(stdout(&close).contains("exited"));
    assert!(stdout(&close).contains("exit=0"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_list_filters_by_workspace_when_given() {
    let dir = temp_data_dir("list");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(dir.path(), &["terminal", "list", "--workspace", "ws-9"]);
    assert_eq!(output.status.code(), Some(0));
    let request = service.first_captured();
    assert_eq!(request["method"], "session.list");
    assert_eq!(request["params"]["workspaceId"], "ws-9");

    let unfiltered = run_cli(dir.path(), &["terminal", "list"]);
    assert_eq!(unfiltered.status.code(), Some(0));
    let request = service.captured().into_iter().nth(1).unwrap();
    assert!(
        request["params"].get("workspaceId").is_none(),
        "no filter, no workspaceId param: {}",
        request["params"]
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn diagnostic_rpc_passes_method_and_params_through() {
    let dir = temp_data_dir("rpc");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(
        dir.path(),
        &[
            "--json",
            "rpc",
            "session.read",
            "--params",
            r#"{"sessionId":"s","incarnation":"i","cursor":8192}"#,
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.first_captured();
    assert_eq!(request["method"], "session.read");
    assert_eq!(request["params"]["cursor"], 8192);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn usage_errors_exit_2_and_leave_stdout_clean() {
    let dir = temp_data_dir("usage");
    let service = MockService::start(dir.path(), echo_behavior());

    let cases: &[&[&str]] = &[
        &[
            "terminal",
            "resize",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--cols",
            "0",
            "--rows",
            "24",
        ],
        &[
            "terminal",
            "resize",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--cols",
            "120",
            "--rows",
            "4000",
        ],
        &["terminal", "create", "--workspace", "w"],
        &["status", "--bogus"],
        &["rpc", "session.read", "--params", "{broken"],
        &["terminal", "read", "--session", "", "--incarnation", "t"],
    ];
    for case in cases {
        let output = run_cli(dir.path(), case);
        assert_eq!(output.status.code(), Some(2), "case: {case:?}");
        assert!(
            stdout(&output).is_empty(),
            "usage errors never print to stdout"
        );
        assert!(!stderr(&output).is_empty());
    }
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn help_and_version_exit_zero() {
    let dir = temp_data_dir("help");
    for args in [&["--help"][..], &["--version"][..]] {
        let output = run_cli(dir.path(), args);
        assert_eq!(output.status.code(), Some(0), "args: {args:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lost_response_times_out_as_unverifiable_within_bounded_window() {
    let dir = temp_data_dir("timeout");
    // Server accepts and never answers; the CLI's default 30s bound is too
    // long for CI, so exercise the same transport path with a short budget.
    let listener = tokio::net::UnixListener::bind(dir.path().join("runtime-v1.sock")).unwrap();
    std::fs::write(
        dir.path().join("auth.token"),
        format!("{}\n", common::TOKEN),
    )
    .unwrap();
    tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.expect("accept");
        // Hold the connection open without ever writing.
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    });

    let client = drogon_cli::client::Client::open(dir.path(), "rid-timeout").expect("client");
    let started = std::time::Instant::now();
    let result = drogon_cli::transport::roundtrip(
        client.endpoint(),
        &drogon_cli::paths::read_auth_token(dir.path()).unwrap(),
        "status",
        json!({}),
        "rid-timeout",
        std::time::Duration::from_millis(150),
    )
    .await;
    let elapsed = started.elapsed();
    let err = result.expect_err("a stalling server must time out");
    assert_eq!(err.rpc_error().code, "unverifiable");
    assert!(elapsed >= std::time::Duration::from_millis(140));
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "timeout must be bounded"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_token_value_never_reaches_output() {
    let dir = temp_data_dir("token-leak");
    let service = MockService::start(dir.path(), common::status_ok_behavior());
    // Sanity: the mock wrote the distinctive token; then make the CLI fail
    // locally (unknown method via rpc) and ensure the token is nowhere.
    let output = run_cli(dir.path(), &["rpc", "no.such.method"]);
    let combined = format!("{}{}", stdout(&output), stderr(&output));
    assert!(
        !combined.contains(common::TOKEN),
        "auth token leaked: {combined}"
    );
    assert!(
        !combined.contains("test-token"),
        "auth token leaked: {combined}"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_auth_token_file_is_unverifiable() {
    let dir = temp_data_dir("no-token");
    let service = MockService::start_without_token(dir.path(), common::status_ok_behavior());

    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("unverifiable"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn server_error_codes_pass_through_verbatim() {
    let dir = temp_data_dir("stale");
    let behavior: Behavior = std::sync::Arc::new(|request| match request["method"].as_str() {
        // `terminal close` goes through `session.close` (R16-AL2, #228):
        // stop when live, forget the record either way.
        Some("session.close") => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "stale_incarnation",
            "Session identity changed; refresh before acting.",
        )),
        _ => Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({}),
        )),
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "close",
            "--session",
            "s",
            "--incarnation",
            "old",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr(&output).contains("stale_incarnation"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transport_failure_preserves_caller_request_id_in_envelope() {
    let dir = temp_data_dir("rid-preserved");
    // Peer accepts then closes without responding: an ambiguous mutation.
    let service = MockService::start(dir.path(), std::sync::Arc::new(|_| Action::Close));

    let output = run_cli(
        dir.path(),
        &[
            "--json",
            "--request-id",
            "caller-fixed-rid",
            "terminal",
            "close",
            "--session",
            "s1",
            "--incarnation",
            "tok",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("one JSON envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(
        envelope["requestId"], "caller-fixed-rid",
        "the replay id must survive the transport failure"
    );
    assert_eq!(envelope["error"]["code"], "unverifiable");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_runtime_failure_carries_request_id() {
    let dir = temp_data_dir("rid-missing");
    let output = run_cli(
        dir.path(),
        &["--json", "--request-id", "caller-fixed-rid", "status"],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("one JSON envelope");
    assert_eq!(envelope["requestId"], "caller-fixed-rid");
    assert_eq!(envelope["error"]["code"], "unverifiable");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn timeout_failure_carries_request_id() {
    let dir = temp_data_dir("rid-timeout");
    let listener = tokio::net::UnixListener::bind(dir.path().join("runtime-v1.sock")).unwrap();
    std::fs::write(
        dir.path().join("auth.token"),
        format!("{}\n", common::TOKEN),
    )
    .unwrap();
    tokio::spawn(async move {
        let (_stream, _) = listener.accept().await.expect("accept");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    });

    let client = drogon_cli::client::Client::open(dir.path(), "rid-timeout").expect("client");
    let err = drogon_cli::transport::roundtrip(
        client.endpoint(),
        &drogon_cli::paths::read_auth_token(dir.path()).unwrap(),
        "session.stop",
        json!({}),
        "rid-timeout",
        std::time::Duration::from_millis(120),
    )
    .await
    .expect_err("stalling server must time out");
    match err {
        drogon_cli::error::CliError::Local { request_id, error } => {
            assert_eq!(request_id, "rid-timeout");
            assert_eq!(error.code, "unverifiable");
        }
        other => panic!("expected Local transport error, got {other:?}"),
    }
}

// --- Per-method invariant validation against structurally-valid but
// semantically impossible results ---

fn invariant_behavior(result_for: impl Fn(&Value) -> Value + Send + Sync + 'static) -> Behavior {
    std::sync::Arc::new(move |request| {
        Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            result_for(&request),
        ))
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_result_with_wrong_protocol_is_refused() {
    let dir = temp_data_dir("inv-protocol");
    let behavior = invariant_behavior(|_| {
        json!({
            "hostId": "h", "serviceInstanceId": "s", "protocol": 2,
            "capabilities": [], "version": "0.1.0"
        })
    });
    let service = MockService::start(dir.path(), behavior);
    let output = run_cli(dir.path(), &["status"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("protocol invariants"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_with_empty_id_is_refused() {
    let dir = temp_data_dir("inv-empty-id");
    let behavior = invariant_behavior(|_| {
        json!({
            "session": {
                "id": "", "workspaceId": "w", "hostId": "h", "incarnation": "i",
                "command": "sh", "args": [], "cols": 80, "rows": 24,
                "verdict": "live", "exitCode": null, "createdAt": "2026-09-05T12:00:00Z",
                "agentState": "unknown", "agentStateAt": null
            },
            "dataBase64": "",
            "startCursor": 0, "nextCursor": 0, "truncated": false
        })
    });
    let service = MockService::start(dir.path(), behavior);
    let output = run_cli(
        dir.path(),
        &["terminal", "read", "--session", "s", "--incarnation", "i"],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("id must not be empty"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resize_result_with_out_of_range_geometry_is_refused() {
    let dir = temp_data_dir("inv-geometry");
    let behavior = invariant_behavior(|request| {
        json!({
            "id": "s1", "workspaceId": "w", "hostId": "h", "incarnation": "i",
            "command": "sh", "args": [],
            "cols": request["params"]["cols"], "rows": 0,
            "verdict": "live", "exitCode": null, "createdAt": "2026-09-05T12:00:00Z",
            "agentState": "unknown", "agentStateAt": null
        })
    });
    let service = MockService::start(dir.path(), behavior);
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "resize",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--cols",
            "120",
            "--rows",
            "40",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("rows must be 1..=1000"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_with_invalid_base64_is_refused() {
    let dir = temp_data_dir("inv-base64");
    let behavior = invariant_behavior(|_| {
        json!({
            "session": {
                "id": "s1", "workspaceId": "w", "hostId": "h", "incarnation": "i",
                "command": "sh", "args": [], "cols": 80, "rows": 24,
                "verdict": "live", "exitCode": null, "createdAt": "2026-09-05T12:00:00Z",
                "agentState": "unknown", "agentStateAt": null
            },
            "dataBase64": "!!!not-base64!!!",
            "startCursor": 0, "nextCursor": 3, "truncated": false
        })
    });
    let service = MockService::start(dir.path(), behavior);
    let output = run_cli(
        dir.path(),
        &["terminal", "read", "--session", "s", "--incarnation", "i"],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("not valid base64"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_with_backwards_cursor_range_is_refused() {
    let dir = temp_data_dir("inv-cursor-back");
    let behavior = invariant_behavior(|request| {
        json!({
            "session": session_result("s1"),
            "dataBase64": "aGkK",
            "startCursor": 10, "nextCursor": 5,
            "truncated": false,
            "echo": request["params"]["cursor"]
        })
    });
    let service = MockService::start(dir.path(), behavior);
    let output = run_cli(
        dir.path(),
        &["terminal", "read", "--session", "s", "--incarnation", "i"],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("must not be below startCursor"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_with_cursor_span_mismatch_is_refused() {
    let dir = temp_data_dir("inv-cursor-span");
    // Claims a 3-byte range but the base64 decodes to 2 bytes.
    let behavior = invariant_behavior(|_| {
        json!({
            "session": session_result("s1"),
            "dataBase64": "aGk=",
            "startCursor": 100, "nextCursor": 103,
            "truncated": false
        })
    });
    let service = MockService::start(dir.path(), behavior);
    let output = run_cli(
        dir.path(),
        &["terminal", "read", "--session", "s", "--incarnation", "i"],
    );
    assert_eq!(output.status.code(), Some(1));
    let err = stderr(&output);
    assert!(
        err.contains("cursor range covers 3 bytes but dataBase64 decodes to 2"),
        "stderr: {err}"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_with_mismatched_accepted_bytes_is_refused() {
    let dir = temp_data_dir("inv-accepted");
    let behavior = invariant_behavior(|_| json!({ "acceptedBytes": 999 }));
    let service = MockService::start(dir.path(), behavior);
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "send",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--text",
            "hello",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("acceptedBytes (999) does not match the 5 bytes sent"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

// --- Relative workspace path resolution and UTF-8 strictness ---

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relative_workspace_path_resolves_against_cli_cwd_not_daemon_cwd() {
    let fixture = temp_data_dir("cwd");
    let workspace_dir = fixture.path().join("folder");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let service = MockService::start(&fixture.path().join("data"), echo_behavior());

    // The CLI process runs with a cwd different from where the data dir
    // (daemon fixture) lives; "folder" must resolve against the CLI cwd.
    let mut command = std::process::Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
    command
        .args(["--json", "workspace", "add", "folder"])
        .env("DROGON_DATA_DIR", fixture.path().join("data"))
        .current_dir(fixture.path());
    let output = command.output().expect("spawn drogon-cli");
    assert_eq!(
        output.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let request = service.first_captured();
    let expected = fixture
        .path()
        .canonicalize()
        .expect("canonicalize fixture")
        .join("folder");
    assert_eq!(
        request["params"]["path"],
        expected.to_string_lossy().to_string(),
        "relative path must become the absolute CLI-cwd path"
    );
    drop(service);
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_utf8_workspace_path_is_a_usage_error() {
    use std::os::unix::ffi::OsStrExt;
    let dir = temp_data_dir("utf8");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = std::process::Command::new(env!("CARGO_BIN_EXE_drogon-cli"))
        .args(["workspace", "add"])
        .arg(std::ffi::OsStr::from_bytes(b"/tmp/\xff\xfe-bad"))
        .env("DROGON_DATA_DIR", dir.path())
        .output()
        .expect("spawn drogon-cli");
    assert_eq!(
        output.status.code(),
        Some(2),
        "invalid UTF-8 is a usage error"
    );
    let err = String::from_utf8_lossy(&output.stderr).into_owned();
    assert!(err.contains("valid UTF-8"), "stderr: {err}");
    assert!(
        !err.contains('\u{FFFD}'),
        "the CLI must not silently replace invalid bytes: {err}"
    );
    assert!(service.captured().is_empty(), "nothing reaches the wire");
    drop(service);
}

// --- terminal read pagination flags ---

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_forwards_cursor_and_limit_and_paginates_past_first_chunk() {
    let dir = temp_data_dir("paginate");
    // A 64 KiB first page lives at cursor 0; the next page starts at 65536.
    let behavior = invariant_behavior(|request| {
        let cursor = request["params"]["cursor"].as_u64().unwrap_or(0);
        let payload = if cursor == 0 { "PAGE-ONE" } else { "PAGE-TWO" };
        let data = base64::engine::general_purpose::STANDARD.encode(payload.as_bytes());
        json!({
            "session": session_result("s1"),
            "dataBase64": data,
            "startCursor": cursor,
            "nextCursor": cursor + payload.len() as u64,
            "truncated": false
        })
    });
    let service = MockService::start(dir.path(), behavior);

    // First page (defaults: cursor 0, no limitBytes on the wire).
    let first = run_cli(
        dir.path(),
        &["terminal", "read", "--session", "s1", "--incarnation", "i"],
    );
    assert_eq!(first.status.code(), Some(0), "stderr: {}", stderr(&first));
    assert_eq!(service.first_captured()["params"]["cursor"], 0);
    assert!(
        service.first_captured()["params"]
            .get("limitBytes")
            .is_none(),
        "service default limitBytes must stay unset unless asked"
    );
    assert!(stdout(&first).contains("PAGE-ONE"));

    // Pagination beyond the first chunk.
    let second = run_cli(
        dir.path(),
        &[
            "terminal",
            "read",
            "--session",
            "s1",
            "--incarnation",
            "i",
            "--cursor",
            "65536",
            "--limit-bytes",
            "32768",
        ],
    );
    assert_eq!(second.status.code(), Some(0), "stderr: {}", stderr(&second));
    let request = service.captured().into_iter().nth(1).unwrap();
    assert_eq!(request["params"]["cursor"], 65536);
    assert_eq!(request["params"]["limitBytes"], 32768);
    assert!(stdout(&second).contains("cursor 65536..65544"));
    assert!(stdout(&second).contains("PAGE-TWO"));

    // --json preserves the wire cursors.
    let json = run_cli(
        dir.path(),
        &[
            "--json",
            "terminal",
            "read",
            "--session",
            "s1",
            "--incarnation",
            "i",
            "--cursor",
            "65536",
        ],
    );
    assert_eq!(json.status.code(), Some(0));
    let envelope: Value = serde_json::from_str(&stdout(&json)).unwrap();
    assert_eq!(envelope["result"]["startCursor"], 65536);
    assert_eq!(
        envelope["result"]["dataBase64"],
        base64::engine::general_purpose::STANDARD.encode("PAGE-TWO")
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn read_limit_bytes_out_of_protocol_range_is_a_usage_error() {
    let dir = temp_data_dir("limit-range");
    let service = MockService::start(dir.path(), echo_behavior());
    for bad in ["0", "65537", "100000"] {
        let output = run_cli(
            dir.path(),
            &[
                "terminal",
                "read",
                "--session",
                "s",
                "--incarnation",
                "i",
                "--limit-bytes",
                bad,
            ],
        );
        assert_eq!(output.status.code(), Some(2), "limit {bad}");
        assert!(stdout(&output).is_empty());
        assert!(stderr(&output).contains("--limit-bytes must be in 1..=65536"));
    }
    // Boundary value 65536 is legal and reaches the wire.
    let ok = run_cli(
        dir.path(),
        &[
            "terminal",
            "read",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--limit-bytes",
            "65536",
        ],
    );
    assert_eq!(ok.status.code(), Some(0), "stderr: {}", stderr(&ok));
    assert_eq!(service.first_captured()["params"]["limitBytes"], 65536);
    drop(service);
}

// --- terminal close verdict semantics ---
// R16-AL2 (#228): `terminal close` calls `session.close` — the daemon
// stops a live PTY and forgets the durable record, so the command succeeds
// for every honest verdict (a forgotten post-restart stub answers
// `unverifiable`, never a fabricated `exited`). The verdict stays on
// stdout as context, but exit 1 is reserved for RPC failures now: with the
// record gone there is nothing left to retry.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn close_with_any_verdict_exits_zero_but_keeps_identity_on_stdout() {
    for verdict in ["live", "unverifiable"] {
        let dir = temp_data_dir("close-verdict");
        let verdict_label = verdict.to_string();
        let behavior = invariant_behavior({
            let verdict = verdict_label.clone();
            move |_| {
                json!({
                    "id": "s1", "workspaceId": "w", "hostId": "h", "incarnation": "tok",
                    "command": "sh", "args": [], "cols": 80, "rows": 24,
                    "verdict": verdict, "exitCode": null, "createdAt": "2026-09-05T12:00:00Z",
                    "agentState": "unknown", "agentStateAt": null
                })
            }
        });
        let service = MockService::start(dir.path(), behavior);

        let human = run_cli(
            dir.path(),
            &[
                "terminal",
                "close",
                "--session",
                "s1",
                "--incarnation",
                "tok",
            ],
        );
        assert_eq!(
            human.status.code(),
            Some(0),
            "verdict {verdict}: the close was accepted, so the command succeeds"
        );
        let text = stdout(&human);
        assert!(text.contains("s1"), "identity stays on stdout: {text}");
        assert!(
            text.contains(verdict_label.as_str()),
            "verdict stays on stdout: {text}"
        );
        assert!(
            !stderr(&human).contains("did not confirm exit"),
            "with the record forgotten there is nothing left to retry: {}",
            stderr(&human)
        );

        let json = run_cli(
            dir.path(),
            &[
                "--json",
                "terminal",
                "close",
                "--session",
                "s1",
                "--incarnation",
                "tok",
            ],
        );
        assert_eq!(
            json.status.code(),
            Some(0),
            "verdict {verdict} in json mode"
        );
        let envelope: Value = serde_json::from_str(&stdout(&json)).expect("one JSON envelope");
        assert_eq!(
            envelope["ok"], true,
            "the RPC succeeded; the close was accepted"
        );
        assert_eq!(
            envelope["result"]["verdict"], verdict_label,
            "context retained for the caller"
        );
        drop(service);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn close_with_exited_verdict_exits_zero() {
    let dir = temp_data_dir("close-exited");
    let behavior = invariant_behavior(|_| {
        json!({
            "id": "s1", "workspaceId": "w", "hostId": "h", "incarnation": "tok",
            "command": "sh", "args": [], "cols": 80, "rows": 24,
            "verdict": "exited", "exitCode": 7, "createdAt": "2026-09-05T12:00:00Z",
            "agentState": "exited", "agentStateAt": null
        })
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "close",
            "--session",
            "s1",
            "--incarnation",
            "tok",
        ],
    );
    assert_eq!(output.status.code(), Some(0));
    assert!(stdout(&output).contains("exited"));
    assert!(stdout(&output).contains("exit=7"));
    assert!(stderr(&output).is_empty());
    drop(service);
}

// --- Native harness commands (harness.catalog.v1 / harness.launch.v1) ---

const HARNESS_CAPABILITIES: &[&str] = &[
    "workspace.v1",
    "session.pty.v1",
    "harness.catalog.v1",
    "harness.launch.v1",
];

/// Status with configurable capabilities plus a harness catalog that includes
/// an unknown future harness id and additive fields, and a harness.start that
/// echoes the requested workspace and model.
fn harness_service_behavior(capabilities: &[&str]) -> Behavior {
    let capabilities: Vec<Value> = capabilities.iter().map(|c| json!(c)).collect();
    std::sync::Arc::new(move |request| {
        let request_id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &request_id,
                json!({
                    "hostId": "host-1",
                    "serviceInstanceId": "svc-1",
                    "protocol": 1,
                    "capabilities": capabilities,
                    "version": "0.1.0"
                }),
            )),
            Some("harness.list") => Action::Respond(ok_envelope(
                &request_id,
                json!({
                    "hostId": "host-1",
                    "harnesses": [
                        {"harnessId": "pi", "displayName": "Pi", "availability": "available",
                         "executable": "/opt/homebrew/bin/pi"},
                        {"harnessId": "opencode", "displayName": "OpenCode",
                         "availability": "missing", "executable": null},
                        {"harnessId": "future-harness-9", "displayName": "Future",
                         "availability": "available", "executable": "/usr/bin/future",
                         "futureField": {"nested": true}}
                    ],
                    "futureCatalogField": 7
                }),
            )),
            Some("harness.start") => {
                let mut session = session_result("harness-sess-1");
                session["workspaceId"] = request["params"]["workspaceId"].clone();
                session["command"] = json!("/opt/homebrew/bin/pi");
                session["args"] = json!(["--model", "mock-model"]);
                Action::Respond(ok_envelope(&request_id, session))
            }
            other => Action::Respond(error_envelope(
                &request_id,
                "method_not_found",
                &format!("mock does not implement {other:?}"),
            )),
        }
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_list_renders_catalog_including_unknown_ids() {
    let dir = temp_data_dir("harness-list");
    let service = MockService::start(dir.path(), harness_service_behavior(HARNESS_CAPABILITIES));

    let human = run_cli(dir.path(), &["harness", "list"]);
    assert_eq!(human.status.code(), Some(0), "stderr: {}", stderr(&human));
    let text = stdout(&human);
    assert!(
        text.contains("pi [available] Pi -> /opt/homebrew/bin/pi"),
        "{text}"
    );
    assert!(text.contains("opencode [missing] OpenCode -> -"), "{text}");
    assert!(
        text.contains("future-harness-9 [available] Future -> /usr/bin/future"),
        "unknown harness ids stay displayable: {text}"
    );

    let json = run_cli(dir.path(), &["--json", "harness", "list"]);
    assert_eq!(json.status.code(), Some(0));
    let envelope: Value = serde_json::from_str(&stdout(&json)).unwrap();
    assert_eq!(envelope["result"]["harnesses"].as_array().unwrap().len(), 3);
    assert_eq!(
        envelope["result"]["harnesses"][2]["futureField"],
        json!({"nested": true}),
        "additive fields are preserved verbatim"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_list_without_capability_refuses_without_sending_list() {
    let dir = temp_data_dir("harness-nocap");
    let service = MockService::start(
        dir.path(),
        harness_service_behavior(&["workspace.v1", "session.pty.v1"]),
    );

    let output = run_cli(
        dir.path(),
        &["--json", "--request-id", "op-rid-1", "harness", "list"],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("one JSON envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(
        envelope["requestId"], "op-rid-1",
        "preflight failure retains the operation replay id"
    );
    assert_eq!(envelope["error"]["code"], "method_not_found");
    assert!(
        envelope["error"]["message"]
            .as_str()
            .unwrap()
            .contains("harness.catalog.v1"),
        "actionable: names the missing capability"
    );
    // No fallback: only the read-only status preflight reached the service.
    let methods: Vec<_> = service
        .captured()
        .iter()
        .map(|request| request["method"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        methods,
        vec!["status".to_string()],
        "no harness.list without the capability"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_start_without_launch_capability_never_falls_back() {
    let dir = temp_data_dir("dg-hnl");
    // Catalog capability present, launch capability absent.
    let service = MockService::start(
        dir.path(),
        harness_service_behavior(&["workspace.v1", "session.pty.v1", "harness.catalog.v1"]),
    );

    let output = run_cli(
        dir.path(),
        &[
            "--json",
            "--request-id",
            "op-rid-2",
            "harness",
            "start",
            "--workspace",
            "w1",
            "--harness",
            "pi",
            "--model",
            "m1",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(envelope["requestId"], "op-rid-2");
    assert!(
        envelope["error"]["message"]
            .as_str()
            .unwrap()
            .contains("harness.launch.v1")
    );
    // The mandatory requirement: never a fallback to session.start/shell.
    let methods: Vec<_> = service
        .captured()
        .iter()
        .map(|request| request["method"].as_str().unwrap().to_string())
        .collect();
    assert!(!methods.contains(&"session.start".to_string()));
    assert!(!methods.contains(&"harness.start".to_string()));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_start_forwards_literal_prompt_model_provider_and_mode() {
    let dir = temp_data_dir("harness-start");
    let service = MockService::start(dir.path(), harness_service_behavior(HARNESS_CAPABILITIES));

    // Prompt contains flag-like text, @-file syntax, quotes and a newline:
    // everything must arrive verbatim as one JSON string value.
    let prompt = "@payload.txt --model=evil \"quoted\"\nsecond line";
    let output = run_cli(
        dir.path(),
        &[
            "--json",
            "harness",
            "start",
            "--workspace",
            "ws-1",
            "--harness",
            "pi",
            "--model",
            "mock-model",
            "--provider",
            "mock-provider",
            "--effort",
            "high",
            "--prompt",
            prompt,
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let requests = service.captured();
    let start = requests
        .iter()
        .find(|request| request["method"] == "harness.start")
        .expect("harness.start reached the service");
    assert_eq!(start["params"]["workspaceId"], "ws-1");
    assert_eq!(start["params"]["harnessId"], "pi");
    assert_eq!(start["params"]["model"], "mock-model");
    assert_eq!(start["params"]["provider"], "mock-provider");
    assert_eq!(start["params"]["effort"], "high");
    assert_eq!(
        start["params"]["prompt"], prompt,
        "prompt must be byte-identical"
    );
    assert_eq!(
        start["params"]["permissionMode"], "inherit",
        "default is inherit"
    );
    assert_eq!(
        start["requestId"].as_str().unwrap().len(),
        36,
        "minted uuid request id"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_start_uses_caller_request_id_unchanged_for_the_mutation() {
    let dir = temp_data_dir("harness-rid");
    let service = MockService::start(dir.path(), harness_service_behavior(HARNESS_CAPABILITIES));

    let output = run_cli(
        dir.path(),
        &[
            "--json",
            "--request-id",
            "mutation-rid-77",
            "harness",
            "start",
            "--workspace",
            "ws-1",
            "--harness",
            "claude",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let requests = service.captured();
    let start = requests
        .iter()
        .find(|request| request["method"] == "harness.start")
        .expect("harness.start reached the service");
    assert_eq!(
        start["requestId"], "mutation-rid-77",
        "the final mutating request keeps the caller's id byte-for-byte"
    );
    // The preflight status used a distinct read-only id.
    let status = requests
        .iter()
        .find(|request| request["method"] == "status")
        .expect("status preflight reached the service");
    assert_ne!(status["requestId"], "mutation-rid-77");
    // And the success envelope echoes the operation id.
    let envelope: Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(envelope["requestId"], "mutation-rid-77");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_start_server_error_passes_through_with_operation_id() {
    let dir = temp_data_dir("harness-err");
    let behavior: Behavior = std::sync::Arc::new(|request| match request["method"].as_str() {
        Some("status") => Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({
                "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                "capabilities": HARNESS_CAPABILITIES.iter().map(|c| json!(c))
                    .collect::<Vec<_>>(),
                "version": "0.1.0"
            }),
        )),
        Some("harness.start") => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "not_found",
            "Harness is not installed on this execution host",
        )),
        _ => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "method_not_found",
            "unexpected",
        )),
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(
        dir.path(),
        &[
            "--json",
            "--request-id",
            "op-rid-3",
            "harness",
            "start",
            "--workspace",
            "w1",
            "--harness",
            "pi",
        ],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "not_found");
    assert_eq!(envelope["requestId"], "op-rid-3");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_start_result_must_match_requested_workspace_and_status_host() {
    let dir = temp_data_dir("dg-hmm");
    let behavior: Behavior = std::sync::Arc::new(|request| match request["method"].as_str() {
        Some("status") => Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({
                "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                "capabilities": HARNESS_CAPABILITIES.iter().map(|c| json!(c))
                    .collect::<Vec<_>>(),
                "version": "0.1.0"
            }),
        )),
        Some("harness.start") => {
            // Session claims a different workspace than requested.
            let mut session = session_result("s1");
            session["workspaceId"] = json!("someone-elses-workspace");
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                session,
            ))
        }
        _ => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "method_not_found",
            "unexpected",
        )),
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(
        dir.path(),
        &["harness", "start", "--workspace", "w1", "--harness", "pi"],
    );
    assert_eq!(output.status.code(), Some(1));
    let err = stderr(&output);
    assert!(
        err.contains("does not match the requested workspace"),
        "stderr: {err}"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn harness_start_malformed_catalog_is_refused_but_start_still_works() {
    // A malformed catalog entry must not be silently reshaped into success.
    let dir = temp_data_dir("dg-hbc");
    let behavior: Behavior = std::sync::Arc::new(|request| match request["method"].as_str() {
        Some("status") => Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({
                "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                "capabilities": HARNESS_CAPABILITIES.iter().map(|c| json!(c))
                    .collect::<Vec<_>>(),
                "version": "0.1.0"
            }),
        )),
        Some("harness.list") => Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({
                "hostId": "host-1",
                "harnesses": [
                    {"harnessId": "pi", "displayName": "", "availability": "available",
                     "executable": "/opt/homebrew/bin/pi"}
                ]
            }),
        )),
        _ => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "method_not_found",
            "unexpected",
        )),
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(dir.path(), &["harness", "list"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("displayName"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

// --- Worktree creation provenance (Workspace Options "Hide: CLI-created") ---

fn worktree_created_result(creator: &Value) -> Value {
    json!({
        "id": "w1",
        "projectId": "p1",
        "workspaceId": "ws-1",
        "path": "/data/workspaces/repo/feature",
        "branch": "feature",
        "head": "abc123",
        "baseRef": null,
        "createdAt": "2026-09-09T00:00:00Z",
        "isPinned": false,
        "isArchived": false,
        "sortOrder": 1,
        "creator": creator,
    })
}

/// `drogon-cli worktree create` is the one real, durable producer of
/// `creator: "cli"`, tagged at the actual worktree.create producer
/// boundary. The mock daemon echoes
/// back exactly what it was asked to store, so this proves the CLI sends
/// the tag on every call, not merely that the CLI *could*.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_always_tags_the_cli_creation_provenance() {
    let dir = temp_data_dir("wt-creator");
    let behavior: Behavior = std::sync::Arc::new(|request| match request["method"].as_str() {
        Some("worktree.list") => Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({ "worktrees": [] }),
        )),
        Some("worktree.create") => {
            assert_eq!(
                request["params"]["creator"], "cli",
                "drogon-cli must always tag its own worktree.create calls, params: {:?}",
                request["params"]
            );
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                worktree_created_result(&request["params"]["creator"]),
            ))
        }
        _ => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "method_not_found",
            "unexpected",
        )),
    });
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(
        dir.path(),
        &["worktree", "create", "--project", "p1", "--name", "feature"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));

    let request = captured_method(&service, "worktree.create");
    assert_eq!(request["params"]["creator"], "cli");
    drop(service);
}

// --- Worktree lineage: a worktree created from inside a session nests under it ---

fn captured_method(service: &MockService, method: &str) -> Value {
    service
        .captured()
        .into_iter()
        .find(|request| request["method"] == method)
        .unwrap_or_else(|| panic!("mock never saw {method}"))
}

fn captured_methods(service: &MockService) -> Vec<String> {
    service
        .captured()
        .iter()
        .map(|request| request["method"].as_str().unwrap_or("").to_string())
        .collect()
}

fn listed_worktree(id: &str, workspace_id: &str, path: &Path) -> Value {
    json!({
        "id": id,
        "projectId": "p1",
        "workspaceId": workspace_id,
        "path": path.to_str().unwrap(),
        "branch": id,
        "head": "abc123",
        "baseRef": null,
        "createdAt": "2026-09-09T00:00:00Z",
    })
}

/// A mock daemon owning two project-p1 worktrees on disk under `root`
/// (`coord`, the coordinator's, and `other`), answering `worktree.list`
/// with them and echoing whatever `parentWorktreeId` a create asked for.
fn lineage_service(dir: &Path, root: &Path) -> MockService {
    let coord = root.join("coord");
    let other = root.join("other");
    std::fs::create_dir_all(coord.join("src")).expect("coord worktree dir");
    std::fs::create_dir_all(&other).expect("other worktree dir");
    let coord = coord.canonicalize().unwrap();
    let other = other.canonicalize().unwrap();
    let behavior: Behavior = std::sync::Arc::new(move |request| match request["method"].as_str() {
        Some("worktree.list") => {
            assert_eq!(request["params"]["projectId"], "p1");
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({ "worktrees": [
                    listed_worktree("w-coord", "ws-coord", &coord),
                    listed_worktree("w-other", "ws-other", &other),
                ] }),
            ))
        }
        Some("worktree.create") => {
            let mut created = worktree_created_result(&request["params"]["creator"]);
            if let Some(parent) = request["params"].get("parentWorktreeId") {
                created["parentWorktreeId"] = parent.clone();
            }
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                created,
            ))
        }
        _ => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "method_not_found",
            "unexpected",
        )),
    });
    MockService::start(dir, behavior)
}

const CREATE: [&str; 6] = ["worktree", "create", "--project", "p1", "--name", "fix-a"];

/// The user-visible bug: a coordinator session ran `worktree create` for
/// each subagent and the sidebar showed the results as top-level
/// strangers. Inside a session the daemon exports `DROGON_WORKSPACE_ID`;
/// the CLI must turn that into the parent edge the sidebar nests by.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_inside_a_session_nests_under_the_calling_worktree() {
    let dir = temp_data_dir("wt-lin-env");
    let elsewhere = tempfile::tempdir().expect("cwd outside every worktree");
    let service = lineage_service(dir.path(), dir.path());

    let output = run_cli_in(
        dir.path(),
        elsewhere.path(),
        &CREATE,
        &[("DROGON_WORKSPACE_ID", "ws-coord")],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let create = captured_method(&service, "worktree.create");
    assert_eq!(create["params"]["parentWorktreeId"], "w-coord");
    assert_eq!(create["params"]["creator"], "cli");
    assert!(
        stdout(&output).contains("nested under w-coord"),
        "human output names the parent: {}",
        stdout(&output)
    );
    assert!(
        stderr(&output).is_empty(),
        "a resolved parent is not a warning: {}",
        stderr(&output)
    );
    drop(service);
}

/// `--no-parent` is the explicit opt-out: no lookup, no parent, no note,
/// even from inside a session.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_no_parent_skips_the_lineage_lookup_entirely() {
    let dir = temp_data_dir("wt-lin-np");
    let service = lineage_service(dir.path(), dir.path());

    let mut args = CREATE.to_vec();
    args.push("--no-parent");
    let output = run_cli_with(dir.path(), &args, &[("DROGON_WORKSPACE_ID", "ws-coord")]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert_eq!(captured_methods(&service), vec!["worktree.create"]);
    assert!(
        captured_method(&service, "worktree.create")["params"]
            .get("parentWorktreeId")
            .is_none()
    );
    assert!(stderr(&output).is_empty(), "stderr: {}", stderr(&output));
    drop(service);
}

/// `--parent` takes the id an agent already holds (the workspace id from
/// `DROGON_WORKSPACE_ID`) as readily as the worktree id from `worktree list`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_explicit_parent_accepts_worktree_and_workspace_ids() {
    let dir = temp_data_dir("wt-lin-x");
    let service = lineage_service(dir.path(), dir.path());

    for selector in ["ws-other", "w-other"] {
        let mut args = CREATE.to_vec();
        args.extend(["--parent", selector]);
        // The explicit choice wins over the session context.
        let output = run_cli_with(dir.path(), &args, &[("DROGON_WORKSPACE_ID", "ws-coord")]);
        assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
        let create = service
            .captured()
            .into_iter()
            .rev()
            .find(|request| request["method"] == "worktree.create")
            .expect("create request");
        assert_eq!(
            create["params"]["parentWorktreeId"], "w-other",
            "selector {selector}"
        );
    }
    drop(service);
}

/// An explicit parent that is not in the project is refused before the
/// daemon is ever asked to check anything out: nothing to clean up, and
/// the JSON envelope says why.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_explicit_parent_outside_the_project_refuses_before_creating() {
    let dir = temp_data_dir("wt-lin-bad");
    let service = lineage_service(dir.path(), dir.path());

    let mut args = vec!["--json"];
    args.extend(CREATE);
    args.extend(["--parent", "ws-stranger"]);
    let output = run_cli(dir.path(), &args);
    assert_eq!(output.status.code(), Some(1), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("failure envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "invalid_argument");
    assert!(
        envelope["error"]["message"]
            .as_str()
            .unwrap()
            .contains("ws-stranger"),
        "{envelope}"
    );
    assert_eq!(captured_methods(&service), vec!["worktree.list"]);
    drop(service);
}

/// A session whose workspace belongs to another project (or is not a
/// worktree at all) still gets its worktree, top-level, and is told so:
/// inference degrades, it never fails the create.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_from_a_foreign_session_creates_top_level_and_says_so() {
    let dir = temp_data_dir("wt-lin-far");
    let elsewhere = tempfile::tempdir().expect("cwd outside every worktree");
    let service = lineage_service(dir.path(), dir.path());

    let output = run_cli_in(
        dir.path(),
        elsewhere.path(),
        &CREATE,
        &[("DROGON_WORKSPACE_ID", "ws-stranger")],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(
        captured_method(&service, "worktree.create")["params"]
            .get("parentWorktreeId")
            .is_none()
    );
    let note = stderr(&output);
    assert!(
        note.contains("without a parent") && note.contains("ws-stranger"),
        "stderr: {note}"
    );
    drop(service);
}

/// Outside any session, standing inside a project worktree is the same
/// signal Orca's `worktree create` uses: the new worktree nests under it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_from_a_worktree_directory_nests_under_it() {
    let dir = temp_data_dir("wt-lin-cwd");
    let service = lineage_service(dir.path(), dir.path());

    let output = run_cli_in(
        dir.path(),
        &dir.path().join("coord").join("src"),
        &CREATE,
        &[("DROGON_WORKSPACE_ID", "")],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert_eq!(
        captured_method(&service, "worktree.create")["params"]["parentWorktreeId"],
        "w-coord"
    );
    assert!(stderr(&output).is_empty(), "stderr: {}", stderr(&output));
    drop(service);
}

/// No session and a cwd outside every worktree: a top-level worktree with
/// nothing to warn about, exactly the pre-existing behavior.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_outside_any_context_sends_no_parent_and_no_note() {
    let dir = temp_data_dir("wt-lin-none");
    let elsewhere = tempfile::tempdir().expect("cwd outside every worktree");
    let service = lineage_service(dir.path(), dir.path());

    let output = run_cli_in(
        dir.path(),
        elsewhere.path(),
        &CREATE,
        &[("DROGON_WORKSPACE_ID", "")],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(
        captured_method(&service, "worktree.create")["params"]
            .get("parentWorktreeId")
            .is_none()
    );
    assert!(stderr(&output).is_empty(), "stderr: {}", stderr(&output));
    drop(service);
}

// --- `terminal send` delivers Enter as a real Return keystroke (issue #599) ---

/// Decoded `dataBase64` of every captured `session.write`, in order.
fn captured_writes(service: &MockService) -> Vec<String> {
    service
        .captured()
        .iter()
        .filter(|request| request["method"] == "session.write")
        .map(|request| {
            String::from_utf8(
                STANDARD
                    .decode(request["params"]["dataBase64"].as_str().unwrap_or(""))
                    .expect("dataBase64 decodes"),
            )
            .expect("UTF-8 payload")
        })
        .collect()
}

fn send_args<'a>(text: &'a str, extra: &[&'a str]) -> Vec<&'a str> {
    let mut args = vec![
        "terminal",
        "send",
        "--session",
        "sess-1",
        "--incarnation",
        "inc-1",
        "--text",
        text,
    ];
    args.extend_from_slice(extra);
    args
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_with_trailing_newline_writes_the_body_then_a_lone_return() {
    let dir = temp_data_dir("s-en");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(dir.path(), &send_args("Correction: also do X.\n", &[]));
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    // Two writes: the message, then Enter on its own so a TUI reads it as a
    // keystroke instead of as the tail of a pasted blob.
    assert_eq!(
        captured_writes(&service),
        vec!["Correction: also do X.".to_string(), "\r".to_string()],
    );
    assert!(
        stdout(&output).contains("Wrote 23 bytes to sess-1, ending with Enter."),
        "stdout: {}",
        stdout(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_never_puts_a_line_feed_on_the_wire() {
    let dir = temp_data_dir("s-nlf");
    let service = MockService::start(dir.path(), echo_behavior());

    // Every spelling of "and press Enter" reaches the PTY as CR, never LF:
    // a raw-mode TUI submits on CR alone.
    let output = run_cli(dir.path(), &send_args("one\ntwo\r\nthree\n", &[]));
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let writes = captured_writes(&service);
    assert_eq!(
        writes,
        vec!["one\rtwo\rthree".to_string(), "\r".to_string()]
    );
    assert!(
        !writes.iter().any(|write| write.contains('\n')),
        "no write may carry a line feed: {writes:?}"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_of_only_a_newline_is_one_return_under_the_callers_request_id() {
    let dir = temp_data_dir("s-be");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(
        dir.path(),
        &send_args("\n", &["--request-id", "req-bare", "--json"]),
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert_eq!(captured_writes(&service), vec!["\r".to_string()]);
    let ids: Vec<String> = service
        .captured()
        .iter()
        .map(|request| request["requestId"].as_str().unwrap_or("").to_string())
        .collect();
    assert_eq!(ids, vec!["req-bare".to_string()]);
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("one envelope");
    assert_eq!(envelope["requestId"], "req-bare");
    assert_eq!(envelope["result"]["acceptedBytes"], 1);
    assert_eq!(envelope["result"]["submittedEnter"], true);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_json_sums_accepted_bytes_and_reports_the_submitted_enter() {
    let dir = temp_data_dir("s-js");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(
        dir.path(),
        &send_args("hi\n", &["--request-id", "req-7", "--json"]),
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("exactly one envelope");
    assert_eq!(envelope["ok"], true);
    // One envelope under the caller's own id, whatever the Return write used.
    assert_eq!(envelope["requestId"], "req-7");
    assert_eq!(envelope["result"]["acceptedBytes"], 3);
    assert_eq!(envelope["result"]["submittedEnter"], true);
    // The Return is ledgered under a deterministic derived id, so a replay
    // dedupes it instead of typing a second Enter.
    let ids: Vec<String> = service
        .captured()
        .iter()
        .map(|request| request["requestId"].as_str().unwrap_or("").to_string())
        .collect();
    assert_eq!(ids, vec!["req-7".to_string(), "req-7.enter".to_string()]);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_without_a_trailing_newline_stays_one_verbatim_write() {
    let dir = temp_data_dir("s-ne");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(dir.path(), &send_args("echo hi", &["--json"]));
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert_eq!(captured_writes(&service), vec!["echo hi".to_string()]);
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("one envelope");
    assert_eq!(envelope["result"]["acceptedBytes"], 7);
    assert_eq!(envelope["result"]["submittedEnter"], false);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_literal_writes_the_bytes_untouched_in_one_call() {
    let dir = temp_data_dir("s-lit");
    let service = MockService::start(dir.path(), echo_behavior());

    let output = run_cli(dir.path(), &send_args("one\ntwo\n", &["--literal"]));
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert_eq!(captured_writes(&service), vec!["one\ntwo\n".to_string()]);
    assert!(
        stdout(&output).contains("Wrote 8 bytes to sess-1."),
        "stdout: {}",
        stdout(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_body_write_never_submits_a_stale_composer() {
    let dir = temp_data_dir("s-rb");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request: Value| {
            let id = request["requestId"].as_str().unwrap_or("").to_string();
            Action::Respond(error_envelope(&id, "not_found", "no such session"))
        }),
    );

    let output = run_cli(dir.path(), &send_args("hi\n", &["--request-id", "req-9"]));
    assert_eq!(output.status.code(), Some(1));
    // Exactly one write attempt: a Return after a failed body would submit
    // whatever the session's input box already held.
    assert_eq!(captured_writes(&service).len(), 1);
    assert!(
        stderr(&output).contains("no such session"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_body_write_the_service_shortchanged_never_submits() {
    let dir = temp_data_dir("s-sb");
    let behavior = invariant_behavior(|_| json!({ "acceptedBytes": 1 }));
    let service = MockService::start(dir.path(), behavior);

    let output = run_cli(dir.path(), &send_args("hello\n", &[]));
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(captured_writes(&service).len(), 1);
    assert!(
        stderr(&output).contains("acceptedBytes (1) does not match the 5 bytes sent"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_return_write_reports_the_callers_own_request_id() {
    let dir = temp_data_dir("s-re");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request: Value| {
            let id = request["requestId"].as_str().unwrap_or("").to_string();
            if id.ends_with(".enter") {
                return Action::Respond(error_envelope(&id, "unverifiable", "session exited"));
            }
            Action::Respond(ok_envelope(
                &id,
                json!({
                    "acceptedBytes": STANDARD
                        .decode(request["params"]["dataBase64"].as_str().unwrap_or(""))
                        .map(|bytes| bytes.len())
                        .unwrap_or(0)
                }),
            ))
        }),
    );

    let output = run_cli(
        dir.path(),
        &send_args("hi\n", &["--request-id", "req-11", "--json"]),
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("failure envelope");
    assert_eq!(envelope["ok"], false);
    // The derived id is a ledger detail; the caller retries with their own.
    assert_eq!(envelope["requestId"], "req-11");
    assert_eq!(envelope["error"]["code"], "unverifiable");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_replayed_with_retry_request_reuses_both_ledger_ids() {
    let dir = temp_data_dir("s-rt");
    let service = MockService::start(dir.path(), echo_behavior());

    for _ in 0..2 {
        let output = run_cli(
            dir.path(),
            &send_args("hi\n", &["--retry-request", "replay-1"]),
        );
        assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    }
    let ids: Vec<String> = service
        .captured()
        .iter()
        .map(|request| request["requestId"].as_str().unwrap_or("").to_string())
        .collect();
    assert_eq!(
        ids,
        vec![
            "replay-1".to_string(),
            "replay-1.enter".to_string(),
            "replay-1".to_string(),
            "replay-1.enter".to_string(),
        ],
        "a replay must land on the same two ledger rows"
    );
    drop(service);
}
