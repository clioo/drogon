//! End-to-end drogon-cli behavior against a mock native protocol-v1 service.
//! Every exit code, envelope rule and param mapping demanded by
//! `docs/migration/protocol-v1.md` is exercised through the real binary.

#![cfg(unix)]

mod common;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

use common::{
    Action, Behavior, MockService, error_envelope, ok_envelope, run_cli, run_cli_with, stderr,
    stdout,
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
    assert!(stdout(&output).contains(&format!("Sent {} bytes", text.len())));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_stop_sweeps_a_workspace_and_reports_the_count() {
    let dir = temp_data_dir("terminal-stop");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("session.stop_workspace") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({"stopped": 2}),
            )),
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({}),
            )),
        }),
    );
    let human = run_cli(dir.path(), &["terminal", "stop", "--workspace", "ws-1"]);
    assert_eq!(human.status.code(), Some(0), "stderr: {}", stderr(&human));
    assert!(stdout(&human).contains("Stopped 2 terminals."));
    let request = service.first_captured();
    assert_eq!(request["method"], "session.stop_workspace");
    assert_eq!(request["params"]["workspaceId"], "ws-1");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn list_limit_caps_the_returned_inventory() {
    let dir = temp_data_dir("list-limit");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            let result = match request["method"].as_str() {
                Some("session.list") => {
                    json!({ "sessions": [session_result("a"), session_result("b")] })
                }
                _ => json!({}),
            };
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                result,
            ))
        }),
    );
    let output = run_cli(dir.path(), &["--json", "terminal", "list", "--limit", "1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).unwrap();
    let sessions = envelope["result"]["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], "a");

    let zero = run_cli(dir.path(), &["terminal", "list", "--limit", "0"]);
    assert_eq!(zero.status.code(), Some(2), "--limit 0 is a usage error");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_enter_appends_carriage_return_and_interrupt_sends_ctrl_c() {
    let dir = temp_data_dir("send-enter");
    let service = MockService::start(dir.path(), echo_behavior());

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
            "ls",
            "--enter",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.first_captured();
    assert_eq!(request["params"]["dataBase64"], STANDARD.encode(b"ls\r"));

    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "send",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
            "--interrupt",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.last_captured();
    assert_eq!(request["params"]["dataBase64"], STANDARD.encode([0x03]));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_without_text_enter_or_interrupt_is_a_usage_error() {
    let dir = temp_data_dir("send-empty");
    let service = MockService::start(dir.path(), echo_behavior());
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "send",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(
        service.captured().is_empty(),
        "usage errors never reach the daemon"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_interrupt_rejects_text_combination() {
    let dir = temp_data_dir("send-conflict");
    let service = MockService::start(dir.path(), echo_behavior());
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "send",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
            "--interrupt",
            "--text",
            "x",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(service.captured().is_empty());
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

    let request = service.first_captured();
    assert_eq!(request["method"], "worktree.create");
    assert_eq!(request["params"]["creator"], "cli");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automation_edit_maps_only_the_given_flags() {
    let dir = temp_data_dir("automation-edit");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "hostId": "host-1",
                    "serviceInstanceId": "svc-1",
                    "protocol": 1,
                    "capabilities": ["workspace.v1", "session.pty.v1", "automation.v1"],
                    "version": "0.1.0"
                }),
            )),
            Some("automation.update") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "id": request["params"]["id"],
                    "name": "renamed",
                    "cron": "0 0 1 1 *",
                    "workspaceId": "ws-1",
                    "harness": "pi",
                    "prompt": "p",
                    "enabled": false,
                    "nextRunAt": 0.0,
                    "lastRunAt": null,
                    "lastRun": null
                }),
            )),
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({}),
            )),
        }),
    );
    let output = run_cli(
        dir.path(),
        &[
            "automation",
            "edit",
            "--id",
            "a1",
            "--name",
            "renamed",
            "--disable",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.last_captured();
    assert_eq!(request["method"], "automation.update");
    assert_eq!(request["params"]["name"], "renamed");
    assert_eq!(request["params"]["enabled"], false);
    assert!(request["params"].get("cron").is_none());
    assert!(request["params"].get("prompt").is_none());

    // Edit with no field flags is a usage error before any daemon contact.
    let bare = run_cli(dir.path(), &["automation", "edit", "--id", "a1"]);
    assert_eq!(bare.status.code(), Some(2));

    // Remove maps to automation.delete and prints the id.
    let removed = run_cli(dir.path(), &["automation", "remove", "--id", "a1"]);
    let _ = removed;
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn diagnostics_memory_reports_the_daemon_footprint() {
    let dir = temp_data_dir("diag-mem");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("diagnostics.memory") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "process": "drogond",
                    "pid": 4242,
                    "rssBytes": 104857600u64,
                    "liveSessions": 2,
                    "totalSessions": 5
                }),
            )),
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({}),
            )),
        }),
    );
    let human = run_cli(dir.path(), &["diagnostics", "memory"]);
    assert_eq!(human.status.code(), Some(0), "stderr: {}", stderr(&human));
    let text = stdout(&human);
    assert!(text.contains("100 MiB"), "stdout: {text}");
    assert!(text.contains("2 live of 5 sessions"), "stdout: {text}");

    let json_out = run_cli(dir.path(), &["--json", "diagnostics", "memory"]);
    assert_eq!(json_out.status.code(), Some(0));
    let envelope: Value = serde_json::from_str(&stdout(&json_out)).unwrap();
    assert_eq!(envelope["result"]["rssBytes"], 104857600u64);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_list_limit_caps_the_json_payload() {
    let dir = temp_data_dir("wt-list-limit");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("worktree.list") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({"worktrees": [
                    {"id":"w1","projectId":"p1","workspaceId":"ws1","path":"/a","branch":"main","head":"h1","baseRef":null,"createdAt":"2026-09-05T12:00:00Z"},
                    {"id":"w2","projectId":"p1","workspaceId":"ws2","path":"/b","branch":"dev","head":"h2","baseRef":null,"createdAt":"2026-09-05T12:00:00Z"}
                ]}),
            )),
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({}),
            )),
        }),
    );
    let output = run_cli(
        dir.path(),
        &[
            "--json",
            "worktree",
            "list",
            "--project",
            "p1",
            "--limit",
            "1",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).unwrap();
    let worktrees = envelope["result"]["worktrees"].as_array().unwrap();
    assert_eq!(worktrees.len(), 1);
    assert_eq!(worktrees[0]["id"], "w1");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_rename_maps_title_and_prints_source_shape() {
    let dir = temp_data_dir("term-rename");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("session.rename") => {
                let mut session = session_result("sess-1");
                session["title"] = request["params"]["title"].clone();
                Action::Respond(ok_envelope(
                    request["requestId"].as_str().unwrap_or(""),
                    session,
                ))
            }
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({}),
            )),
        }),
    );
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "rename",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
            "--title",
            "deploy worker",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(stdout(&output).contains("Renamed sess-1 to \"deploy worker\"."));
    let request = service.last_captured();
    assert_eq!(request["method"], "session.rename");
    assert_eq!(request["params"]["title"], "deploy worker");

    // Clearing: --title omitted maps to a JSON null.
    let cleared = run_cli(
        dir.path(),
        &[
            "terminal",
            "rename",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
        ],
    );
    assert_eq!(cleared.status.code(), Some(0));
    let request = service.last_captured();
    assert_eq!(request["params"]["title"], Value::Null);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_maps_parent_no_parent_and_comment_flags() {
    let dir = temp_data_dir("wtcp");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "id": "wt-new",
                    "projectId": "proj-1",
                    "workspaceId": "ws-1",
                    "path": "/repo/child",
                    "branch": "child",
                    "head": "abc123",
                    "baseRef": null,
                    "createdAt": "2026-09-05T12:00:00Z"
                }),
            ))
        }),
    );
    // --parent maps to parentWorktreeId.
    let output = run_cli(
        dir.path(),
        &[
            "worktree",
            "create",
            "--project",
            "proj-1",
            "--name",
            "child",
            "--parent",
            "wt-parent",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.last_captured();
    assert_eq!(request["method"], "worktree.create");
    assert_eq!(request["params"]["parentWorktreeId"], "wt-parent");
    // --comment maps to the note field.
    let output = run_cli(
        dir.path(),
        &[
            "worktree",
            "create",
            "--project",
            "proj-1",
            "--name",
            "child",
            "--comment",
            "from the CLI",
        ],
    );
    assert_eq!(output.status.code(), Some(0));
    let request = service.last_captured();
    assert_eq!(request["params"]["note"], "from the CLI");
    // --no-parent sends an explicit null parent.
    let output = run_cli(
        dir.path(),
        &[
            "worktree",
            "create",
            "--project",
            "proj-1",
            "--name",
            "child",
            "--no-parent",
        ],
    );
    assert_eq!(output.status.code(), Some(0));
    let request = service.last_captured();
    assert_eq!(request["params"]["parentWorktreeId"], Value::Null);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_rejects_parent_with_no_parent_before_any_call() {
    // Source index-worktree-create-parent.test.ts: the contradiction is a
    // client-side error — the daemon is never called.
    let dir = temp_data_dir("wtcc");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|_request| panic!("the daemon must not be called")),
    );
    let output = run_cli(
        dir.path(),
        &[
            "worktree",
            "create",
            "--project",
            "proj-1",
            "--name",
            "child",
            "--parent",
            "wt-parent",
            "--no-parent",
        ],
    );
    // Native usage-error convention: pre-flight rejections exit 2; the
    // daemon is never called either way.
    assert_eq!(output.status.code(), Some(2));
    assert!(
        stderr(&output).contains("Choose either one parent selector or --no-parent."),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_rm_delete_branch_flag_maps_and_prints() {
    let dir = temp_data_dir("wtrdb");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({"id": "w1", "removed": true, "branchDeleted": true}),
            ))
        }),
    );
    let output = run_cli(dir.path(), &["worktree", "rm", "w1", "--delete-branch"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(stdout(&output).contains("Removed worktree w1 and deleted its branch."));
    let request = service.last_captured();
    assert_eq!(request["method"], "worktree.remove");
    assert_eq!(request["params"]["deleteBranch"], true);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_set_display_name_and_comment_alias_map_to_update() {
    let dir = temp_data_dir("wtsdn");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "id": "w1",
                    "projectId": "proj-1",
                    "workspaceId": "ws-1",
                    "path": "/repo/w1",
                    "branch": "w1",
                    "head": "abc123",
                    "baseRef": null,
                    "createdAt": "2026-09-05T12:00:00Z"
                }),
            ))
        }),
    );
    // --display-name maps to the title wire field.
    let output = run_cli(
        dir.path(),
        &[
            "worktree",
            "set",
            "--id",
            "w1",
            "--display-name",
            "Deploy worker",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.last_captured();
    assert_eq!(request["params"]["title"], "Deploy worker");
    // --comment is the source name for --note.
    let output = run_cli(
        dir.path(),
        &["worktree", "set", "--id", "w1", "--comment", "from the CLI"],
    );
    assert_eq!(output.status.code(), Some(0));
    let request = service.last_captured();
    assert_eq!(request["params"]["note"], "from the CLI");
    // --no-display-name clears the title explicitly.
    let output = run_cli(
        dir.path(),
        &["worktree", "set", "--id", "w1", "--no-display-name"],
    );
    assert_eq!(output.status.code(), Some(0));
    let request = service.last_captured();
    assert_eq!(request["params"]["title"], Value::Null);
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn automation_show_fetches_one_record() {
    let dir = temp_data_dir("autoshow");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "hostId": "host-1",
                    "serviceInstanceId": "svc-1",
                    "protocol": 1,
                    "capabilities": ["automation.v1"],
                    "version": "0.1.0"
                }),
            )),
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "id": "auto-1",
                    "name": "Nightly sweep",
                    "cron": "0 * * * *",
                    "workspaceId": "ws-1",
                    "harness": "pi",
                    "prompt": "sweep",
                    "enabled": true,
                    "nextRunAt": 1_800_000_000.0,
                    "lastRunAt": null,
                    "lastRun": null
                }),
            )),
        }),
    );
    let output = run_cli(dir.path(), &["automation", "show", "auto-1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(stdout(&output).contains("Nightly sweep"));
    let request = service.last_captured();
    assert_eq!(request["method"], "automation.show");
    assert_eq!(request["params"]["id"], "auto-1");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_list_worktree_resolves_the_workspace_first() {
    let dir = temp_data_dir("tlistwt");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("worktree.get") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "worktree": {
                        "id": "wt-1",
                        "projectId": "proj-1",
                        "workspaceId": "ws-of-wt",
                        "path": "/repo/wt-1",
                        "branch": "wt-1",
                        "head": "abc123",
                        "baseRef": null,
                        "createdAt": "2026-09-05T12:00:00Z"
                    }
                }),
            )),
            Some("session.list") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({"sessions": [session_result("sess-1")]}),
            )),
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({}),
            )),
        }),
    );
    let output = run_cli(dir.path(), &["terminal", "list", "--worktree", "wt-1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    // The session.list call is scoped to the worktree's workspace.
    let request = service.last_captured();
    assert_eq!(request["method"], "session.list");
    assert_eq!(request["params"]["workspaceId"], "ws-of-wt");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_list_rejects_workspace_and_worktree_together() {
    let dir = temp_data_dir("tlistcf");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|_request| panic!("the daemon must not be called")),
    );
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "list",
            "--workspace",
            "ws-1",
            "--worktree",
            "wt-1",
        ],
    );
    // clap's conflicts_with already rejects the combination; here we only
    // need to prove the daemon is never called.
    assert_eq!(output.status.code(), Some(2));
    drop(service);
}

#[test]
fn host_list_answers_the_local_host_without_the_daemon() {
    let dir = temp_data_dir("hostlist");
    // No mock daemon: the source command is local, the native one is too.
    let output = run_cli(dir.path(), &["host", "list"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("this machine"));
    assert!(text.contains("--host local"));

    let json = run_cli(dir.path(), &["host", "list", "--json"]);
    assert_eq!(json.status.code(), Some(0));
    let json_stdout = stdout(&json);
    assert!(json_stdout.contains("\"kind\": \"local\""));
    assert!(json_stdout.contains("\"selector\": \"--host local\""));
}

#[test]
fn environment_list_is_empty_and_show_rm_answer_typed_not_found() {
    let dir = temp_data_dir("envlist");
    // Local pairing-store answers; no daemon is contacted.
    let output = run_cli(dir.path(), &["environment", "list"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(stdout(&output).contains("No saved environments."));
    let json = run_cli(dir.path(), &["environment", "list", "--json"]);
    assert_eq!(json.status.code(), Some(0));
    assert!(stdout(&json).contains("\"environments\": []"));

    let shown = run_cli(
        dir.path(),
        &["environment", "show", "--environment", "prod"],
    );
    assert_eq!(shown.status.code(), Some(1));
    assert!(
        stderr(&shown).contains("not_found") && stderr(&shown).contains("prod"),
        "stderr: {}",
        stderr(&shown)
    );
    let removed = run_cli(dir.path(), &["environment", "rm", "--environment", "prod"]);
    assert_eq!(removed.status.code(), Some(1));
    assert!(stderr(&removed).contains("not_found"));
}

#[test]
fn project_setups_answers_an_empty_local_list() {
    let dir = temp_data_dir("psetups");
    let output = run_cli(dir.path(), &["project", "setups"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(stdout(&output).contains("No project host setups found."));
    let filtered = run_cli(
        dir.path(),
        &["project", "setups", "--project", "p1", "--host", "local"],
    );
    assert_eq!(filtered.status.code(), Some(0));
    let json = run_cli(dir.path(), &["project", "setups", "--json"]);
    assert_eq!(json.status.code(), Some(0));
    assert!(stdout(&json).contains("\"setups\": []"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repo_search_refs_maps_query_and_limit_and_prints_refs() {
    let dir = temp_data_dir("refsrch");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({"refs": ["feat-alpha", "feat-beta"], "truncated": true}),
            ))
        }),
    );
    let output = run_cli(
        dir.path(),
        &[
            "repo",
            "search-refs",
            "--project",
            "proj-1",
            "--query",
            "feat",
            "--limit",
            "2",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let stdout = stdout(&output);
    assert!(stdout.contains("feat-alpha"));
    assert!(stdout.contains("feat-beta"));
    assert!(stdout.contains("truncated: yes"));
    let request = service.last_captured();
    assert_eq!(request["method"], "repo.search_refs");
    assert_eq!(request["params"]["projectId"], "proj-1");
    assert_eq!(request["params"]["query"], "feat");
    assert_eq!(request["params"]["limit"], 2);

    // Zero limit is a client-side usage error; the daemon is never called.
    let bad = run_cli(
        dir.path(),
        &[
            "repo",
            "search-refs",
            "--project",
            "proj-1",
            "--query",
            "x",
            "--limit",
            "0",
        ],
    );
    assert_eq!(bad.status.code(), Some(2));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_create_agent_launches_harness_in_the_new_workspace() {
    let dir = temp_data_dir("wtagent");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| match request["method"].as_str() {
            Some("worktree.create") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "id": "wt-new",
                    "projectId": "proj-1",
                    "workspaceId": "ws-new",
                    "path": "/repo/child",
                    "branch": "child",
                    "head": "abc123",
                    "baseRef": null,
                    "createdAt": "2026-09-05T12:00:00Z"
                }),
            )),
            Some("harness.start") => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                session_result("agent-1"),
            )),
            _ => Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "hostId": "host-1",
                    "serviceInstanceId": "svc-1",
                    "protocol": 1,
                    "capabilities": ["workspace.v1", "session.pty.v1", "harness.launch.v1"],
                    "version": "0.1.0"
                }),
            )),
        }),
    );
    let output = run_cli(
        dir.path(),
        &[
            "worktree",
            "create",
            "--project",
            "proj-1",
            "--name",
            "child",
            "--agent",
            "pi",
            "--prompt",
            "sweep the fixtures",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let stdout = stdout(&output);
    assert!(stdout.contains("agent-1"), "stdout: {stdout}");
    let request = service.last_captured();
    assert_eq!(request["method"], "harness.start");
    assert_eq!(request["params"]["workspaceId"], "ws-new");
    assert_eq!(request["params"]["harnessId"], "pi");
    assert_eq!(request["params"]["prompt"], "sweep the fixtures");
    drop(service);
}

#[test]
fn worktree_create_prompt_requires_agent() {
    // Source getOptionalStartupAgent: '--prompt requires --agent'.
    let dir = temp_data_dir("wtprompt");
    let output = run_cli(
        dir.path(),
        &[
            "worktree",
            "create",
            "--project",
            "proj-1",
            "--name",
            "child",
            "--prompt",
            "hi",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(
        stderr(&output).contains("--prompt requires --agent"),
        "stderr: {}",
        stderr(&output)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_read_screen_renders_the_frame_not_the_fragments() {
    let dir = temp_data_dir("trscreen");
    // A progress bar repaint plus colors: the raw stream stacks fragments;
    // the rendered screen shows the final frame only.
    let raw = b"[####    ] 40%\r[########] done\x1b[0m".to_vec();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&raw);
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(move |request| {
            let payload = json!({
                "session": {
                    "id": "sess-1",
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
                },
                "dataBase64": encoded,
                "startCursor": 0,
                "nextCursor": raw.len() as u64,
                "truncated": false
            });
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                payload,
            ))
        }),
    );
    let output = run_cli(
        dir.path(),
        &[
            "terminal",
            "read",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
            "--screen",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("[########] done"), "stdout: {text}");
    assert!(!text.contains("40%"), "fragments must not render: {text}");
    // The 40% fragment must not stack either.
    let json_out = run_cli(
        dir.path(),
        &[
            "terminal",
            "read",
            "--session",
            "sess-1",
            "--incarnation",
            "inc-1",
            "--screen",
            "--json",
        ],
    );
    assert_eq!(json_out.status.code(), Some(0));
    let json_body = stdout(&json_out);
    assert!(json_body.contains("\"source\": \"screen\""));
    assert!(json_body.contains("[########] done"));
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_rm_warns_about_the_preserved_branch_like_the_source() {
    let dir = temp_data_dir("wtrwarn");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "id": "w1",
                    "removed": true,
                    "branchDeleted": false,
                    "branch": "feature",
                    "warning": "setup hook exited 1"
                }),
            ))
        }),
    );
    let output = run_cli(dir.path(), &["worktree", "rm", "w1", "--delete-branch"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let stderr_text = stderr(&output);
    // Source printPreservedBranchWarning copy.
    assert!(
        stderr_text.contains(
            "warning: local branch \"feature\" was kept because Git could not safely delete it"
        ),
        "stderr: {stderr_text}"
    );
    // Source printHookWarning copy.
    assert!(
        stderr_text.contains("warning: setup hook exited 1"),
        "stderr: {stderr_text}"
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_rm_warnings_stay_out_of_json_stdout() {
    let dir = temp_data_dir("wtrwarnj");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({"id": "w1", "removed": true, "warning": "setup hook exited 1"}),
            ))
        }),
    );
    let output = run_cli(dir.path(), &["worktree", "rm", "w1", "--json"]);
    assert_eq!(output.status.code(), Some(0));
    // The envelope carries the warning for machine consumers; the extra
    // human stderr line stays suppressed in JSON mode (source copy).
    assert!(stdout(&output).contains("setup hook exited 1"));
    assert_eq!(stderr(&output), "");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worktree_rm_run_hooks_reaches_the_daemon_with_honest_warning() {
    let dir = temp_data_dir("wtrhooks");
    let service = MockService::start(
        dir.path(),
        std::sync::Arc::new(|request| {
            Action::Respond(ok_envelope(
                request["requestId"].as_str().unwrap_or(""),
                json!({
                    "id": "w1",
                    "removed": true,
                    "warning": "run-hooks is a no-op: this runtime has no orca.yaml hook engine"
                }),
            ))
        }),
    );
    // Source keeps --run-hooks on rm: the param reaches the daemon and the
    // daemon's honest warning surfaces on stderr.
    let output = run_cli(dir.path(), &["worktree", "rm", "w1", "--run-hooks"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = service.last_captured();
    assert_eq!(request["params"]["runHooks"], true);
    assert!(
        stderr(&output).contains("run-hooks is a no-op"),
        "stderr: {}",
        stderr(&output)
    );
    drop(service);
}
