//! PERF-01 push channel (`session.output`) tests: the held long-poll twin
//! of `session.read`.
//!
//! Every test drives real PTY children through `Engine::dispatch` — no
//! threads, no Sync requirements: a child that prints mid-wait proves the
//! held call blocks for bytes (not a spin-return), and a quiet child
//! proves it answers empty only at the deadline. Timing bounds are
//! deliberately generous (seconds, not milliseconds) because the suite
//! runs PTY-heavy tests in parallel on a loaded host; they only fail when
//! the behavior is categorically wrong (immediate return, full-wait
//! timeout, hang).

use std::time::{Duration, Instant};

use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

use crate::Engine;
use crate::session::base64_decode;

const PUSH_CAPABILITY: &str = "session.output-push.v1";

fn invoke(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(response.ok, "{method} failed: {:?}", response.error);
    response.result.unwrap()
}

fn dispatch_raw(engine: &Engine, id: &str, method: &str, params: Value) -> crate::Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn open_engine() -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    (dir, engine)
}

fn workspace_id(engine: &Engine) -> String {
    let dir = tempfile::tempdir().unwrap();
    let reply = invoke(
        engine,
        "w",
        "workspace.register",
        json!({ "path": dir.path() }),
    );
    // Keep the dir alive for the test: leak is intentional and bounded (one
    // tempdir per test process lifetime is reclaimed by the OS temp sweep;
    // the workspace row only needs the path to exist at register time).
    std::mem::forget(dir);
    reply["id"].as_str().unwrap().to_string()
}

fn start_shell(
    engine: &Engine,
    workspace: &str,
    command: &str,
    args: Vec<&str>,
) -> (String, String) {
    let session = invoke(
        engine,
        "start",
        "session.start",
        json!({
            "workspaceId": workspace,
            "command": command,
            "args": args,
        }),
    );
    (
        session["id"].as_str().unwrap().to_string(),
        session["incarnation"].as_str().unwrap().to_string(),
    )
}

fn output_params(id: &str, incarnation: &str, cursor: u64, wait_ms: u64) -> Value {
    json!({
        "sessionId": id,
        "incarnation": incarnation,
        "cursor": cursor,
        "waitMs": wait_ms,
    })
}

fn decoded_data(page: &Value) -> Vec<u8> {
    base64_decode(page["dataBase64"].as_str().unwrap()).expect("valid base64 from session.output")
}

#[test]
fn status_advertises_the_push_capability() {
    let (_dir, engine) = open_engine();
    let status = invoke(&engine, "status", "status", json!({}));
    let capabilities = status["capabilities"].as_array().unwrap();
    assert!(
        capabilities.iter().any(|c| c == PUSH_CAPABILITY),
        "status.capabilities must advertise {PUSH_CAPABILITY}: {capabilities:?}"
    );
}

#[test]
fn held_output_pushes_a_byte_written_mid_wait() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // The child prints ~2 s after spawn: the held poll below must block for
    // the byte and surface it, not spin-return empty and not sit out the
    // whole 20 s wait.
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/sh",
        vec!["-c", "sleep 2; printf 'PUSH_TOKEN_42\\n'"],
    );
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, 0, 20_000),
    );
    let elapsed = started.elapsed();
    let text = String::from_utf8_lossy(&decoded_data(&page)).into_owned();
    assert!(
        text.contains("PUSH_TOKEN_42"),
        "held session.output must surface the mid-wait byte, got {text:?}"
    );
    assert!(
        elapsed >= Duration::from_millis(1_000),
        "the call must have blocked for the byte, not answered instantly ({elapsed:?})"
    );
    assert!(
        elapsed < Duration::from_secs(15),
        "the call must push on the byte, not sit out the 20 s wait ({elapsed:?})"
    );
    // The answer keeps the exact session.read shape: the cursor/page
    // protocol (replay, truncation, verdict truth) rides unchanged.
    assert_eq!(page["startCursor"], 0);
    assert_eq!(page["nextCursor"], decoded_data(&page).len() as u64);
    assert_eq!(page["truncated"], false);
    assert_eq!(page["session"]["id"], id);
}

#[test]
fn quiet_output_waits_out_the_deadline_then_answers_empty() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // `cat` with no input writes nothing: the poll must hold (not
    // spin-return) and answer an empty live page at the deadline — the
    // empty answer doubles as the reconciliation tick (it carries the
    // session verdict).
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let cursor = invoke(
        &engine,
        "read",
        "session.read",
        json!({"sessionId": id, "incarnation": incarnation, "cursor": 0}),
    )["nextCursor"]
        .as_u64()
        .unwrap();
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, cursor, 500),
    );
    let elapsed = started.elapsed();
    assert!(
        decoded_data(&page).is_empty(),
        "quiet session must answer empty"
    );
    assert_eq!(page["session"]["verdict"], "live");
    assert!(
        elapsed >= Duration::from_millis(300),
        "the call must hold the wait, not spin-return ({elapsed:?})"
    );
    assert!(
        elapsed < Duration::from_secs(10),
        "the call must answer at the deadline, not hang ({elapsed:?})"
    );
}

#[test]
fn zero_wait_degrades_to_an_immediate_read() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, 0, 0),
    );
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "zero wait must answer at once"
    );
    assert!(decoded_data(&page).is_empty());
}

#[test]
fn exit_wakes_a_held_poll_with_exit_truth() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // A short sleeper writes nothing and exits ~1 s after spawn: a poll
    // held at the live edge must wake on the observed exit — the pane
    // learns `exited` within a frame of the reap, not at the next wait
    // deadline. (The spawn path itself can leave a few dozen setup bytes
    // in the ring, so drain to the live edge first.)
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/sh", vec!["-c", "sleep 1"]);
    let drained = invoke(
        &engine,
        "drain",
        "session.output",
        output_params(&id, &incarnation, 0, 0),
    );
    let cursor = drained["nextCursor"].as_u64().unwrap();
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, cursor, 20_000),
    );
    let elapsed = started.elapsed();
    assert_eq!(page["session"]["verdict"], "exited");
    assert!(
        elapsed >= Duration::from_millis(300),
        "the poll must have been held until the exit, not answered instantly ({elapsed:?})"
    );
    assert!(
        elapsed < Duration::from_secs(15),
        "exit must wake the held poll, not the deadline ({elapsed:?})"
    );
}

#[test]
fn burst_drains_in_order_without_drops_or_duplicates() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // Pure-shell counter: ~54 KiB of deterministic output (portable — no
    // `seq` on macOS). The PTY translates \n to \r\n (ONLCR), so lines
    // arrive \r\n-terminated; see the drain below for why the comparison
    // is per line rather than byte-exact.
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/sh",
        vec![
            "-c",
            "i=1; while [ $i -le 5000 ]; do echo \"line-$i\"; i=$((i+1)); done",
        ],
    );
    // A short page is NOT the end: the child may still be writing. Drain
    // until the positively observed exit, then keep polling through a REAL
    // quiescence window: `session.output` answers instantly once the verdict
    // is `exited`, so one immediate "confirmation round" cannot catch a
    // reader-thread straggler — only consecutive empty polls separated by
    // genuine sleeps prove the tail has landed. There is deliberately no
    // page-count cap: on macOS the reader delivers small chunks and a fast,
    // healthy drain legitimately takes hundreds of instant pages.
    let mut cursor = 0u64;
    let mut assembled: Vec<u8> = Vec::new();
    let mut quiet_rounds = 0u32;
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let page = invoke(
            &engine,
            "poll",
            "session.output",
            output_params(&id, &incarnation, cursor, 5_000),
        );
        assert_eq!(page["truncated"], false, "100 KiB fits the 1 MiB ring");
        assert_eq!(page["startCursor"], cursor, "pages must chain contiguously");
        let bytes = decoded_data(&page);
        cursor = page["nextCursor"].as_u64().unwrap();
        assert_eq!(
            cursor,
            page["startCursor"].as_u64().unwrap() + bytes.len() as u64
        );
        assembled.extend_from_slice(&bytes);
        assert!(Instant::now() < deadline, "burst drain timed out");
        if page["session"]["verdict"] == "exited" && bytes.is_empty() {
            quiet_rounds += 1;
            if quiet_rounds >= 10 {
                break;
            }
            // The held poll returns at once past the exit; sleep for real so
            // a straggler still in flight lands before the next round, which
            // resets this count via the branch below.
            std::thread::sleep(Duration::from_millis(200));
        } else {
            quiet_rounds = 0;
        }
    }
    // Line-sequence invariant: every counter line exactly once, in order.
    // Compared per line rather than byte-exact: the macOS PTY itself emits
    // a stray extra `\r` mid-burst in ~1% of runs with no product code
    // involved, so `\r` runs carry no product signal. A dropped chunk, a
    // duplicate, or a reorder still fails this comparison.
    let text = String::from_utf8_lossy(&assembled);
    let mut lines: Vec<&str> = text.split('\n').collect();
    assert!(
        lines.pop() == Some(""),
        "burst output must end with a newline, got tail {lines:?}"
    );
    let lines: Vec<String> = lines
        .iter()
        .map(|line| line.trim_end_matches('\r').to_string())
        .collect();
    let expected: Vec<String> = (1..=5000).map(|i| format!("line-{i}")).collect();
    assert_eq!(
        lines, expected,
        "flood output must arrive ordered, complete and duplicate-free"
    );
}

#[test]
fn output_matches_read_cursor_for_cursor_across_methods() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/sh",
        vec!["-c", "printf 'abc'; sleep 5"],
    );
    // Wait for the byte on the new channel, then continue on the old one:
    // the two methods share one cursor space.
    let first = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, 0, 10_000),
    );
    assert_eq!(String::from_utf8_lossy(&decoded_data(&first)), "abc");
    let cursor = first["nextCursor"].as_u64().unwrap();
    let second = invoke(
        &engine,
        "read",
        "session.read",
        json!({"sessionId": id, "incarnation": incarnation, "cursor": cursor}),
    );
    assert_eq!(second["startCursor"], cursor);
    assert_eq!(second["nextCursor"], cursor);
}

#[test]
fn future_cursor_is_invalid_argument_not_a_hang() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let started = Instant::now();
    let response = dispatch_raw(
        &engine,
        "poll",
        "session.output",
        json!({"sessionId": id, "incarnation": incarnation, "cursor": u64::MAX, "waitMs": 10_000}),
    );
    assert!(!response.ok, "future cursor must error like session.read");
    assert_eq!(response.error.unwrap().code, "invalid_argument");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "a future cursor must error at once, never hang the wait"
    );
}

#[test]
fn identity_errors_answer_at_once_with_read_codes() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let stale = dispatch_raw(
        &engine,
        "poll",
        "session.output",
        json!({"sessionId": id, "incarnation": "wrong-incarnation", "cursor": 0, "waitMs": 10_000}),
    );
    assert!(!stale.ok);
    assert_eq!(stale.error.unwrap().code, "stale_incarnation");
    let missing = dispatch_raw(
        &engine,
        "poll",
        "session.output",
        json!({"sessionId": "no-such-session", "incarnation": incarnation, "cursor": 0, "waitMs": 10_000}),
    );
    assert!(!missing.ok);
    assert_eq!(missing.error.unwrap().code, "not_found");
}

/// Reads from cursor 0 until `needle` appears in the session's output, so
/// the assertion below runs while the activity clock is provably fresh —
/// exactly the instant the pre-fix derivation reported `working`.
fn wait_for_output(engine: &Engine, id: &str, incarnation: &str, needle: &[u8]) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let page = invoke(
            engine,
            "read",
            "session.read",
            json!({"sessionId": id, "incarnation": incarnation, "cursor": 0}),
        );
        let bytes = decoded_data(&page);
        if bytes.windows(needle.len()).any(|w| w == needle) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {needle:?} in session {id}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn list_row(engine: &Engine, workspace: &str, id: &str) -> Value {
    let list = invoke(
        engine,
        "list",
        "session.list",
        json!({"workspaceId": workspace}),
    );
    list["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .expect("session still listed")
        .clone()
}

#[test]
fn plain_shell_output_is_unknown_never_working_nor_idle() {
    // Owner report 2026-09-21 (F1): an idle Pi hosted inside Terminal 1-zsh
    // read as Working. A harness-less shell's PTY bytes (echo, redraw) are
    // unproven as a turn: fresh shell output must read `unknown` — neither
    // a Working claim nor a manufactured Idle. The session still exists (no
    // false NO SESSION), stays live, and no harness is observed.
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/sh",
        vec!["-c", "echo shell-proof-marker; exec sleep 30"],
    );
    wait_for_output(&engine, &id, &incarnation, b"shell-proof-marker");
    let row = list_row(&engine, &workspace, &id);
    assert_eq!(row["verdict"], "live");
    assert!(
        row["harnessId"].is_null(),
        "plain shell launches no harness"
    );
    assert!(row["observedHarnessId"].is_null());
    assert_eq!(
        row["agentState"], "unknown",
        "fresh shell echo proves terminal liveness, not an agent turn: {row}"
    );
}

#[test]
fn shell_hosted_harness_is_recognized_but_its_turn_stays_unknown() {
    // Coordinator guardrail "recognition is not turn evidence": a harness
    // executable foregrounded inside a plain shell is observed by name
    // (identity kept — never hidden to silence the badge), but its fresh
    // output may be an idle composer repainting with no hooks firing, so
    // the turn reads `unknown`, never `working`.
    // The observed process runs under the harness's own argv[0] — the same
    // mechanism that recognizes a symlinked install whose on-disk
    // executable is a version number (`claude` -> `.../versions/2.1.278`):
    // `exec -a` repoints argv[0] at a `pi` path while the image stays plain
    // `sleep`. (A `#!/bin/sh` script would resolve to `sh`, and a homebrew
    // `python3` to `python3.14` — neither is a runtime shim, and shells are
    // deliberately never argv-scanned, so neither fixture observes.)
    let bindir = tempfile::tempdir().unwrap();
    let pi = bindir.path().join("pi");
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let launch = format!("echo hosted-pi-marker; exec -a {} sleep 30", pi.display());
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/bash",
        vec!["-c", launch.as_str()],
    );
    wait_for_output(&engine, &id, &incarnation, b"hosted-pi-marker");
    // The foreground memo pins the pre-exec shell for its 1 s TTL, so the
    // observation lands on the next re-probe — poll like the renderer's 3 s
    // `session.list` cadence does, then assert immediately while the marker
    // output is still inside the 3 s activity window.
    let deadline = Instant::now() + Duration::from_secs(10);
    let row = loop {
        let row = list_row(&engine, &workspace, &id);
        if row["observedHarnessId"] == "pi" {
            break row;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for the hosted-pi observation: {row}"
        );
        std::thread::sleep(Duration::from_millis(100));
    };
    assert_eq!(row["verdict"], "live");
    assert!(
        row["harnessId"].is_null(),
        "nothing was launched via harness.start"
    );
    assert_eq!(
        row["agentState"], "unknown",
        "an idle repaint is indistinguishable from inference without hooks: {row}"
    );
}

/// Points `agentCmdOverrides` at a fixture `pi` running `body`, so the
/// hook-lifecycle tests below drive a session that legitimately carries
/// the pi hook namespace (hook events on harness-less sessions are refused
/// as forgeries). Uses the product's absolute-path command override so no
/// real harness runs and PATH stays untouched. Must run before open.
fn write_pi_fixture(dir: &tempfile::TempDir, body: &str) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let pi_fixture = bin.join("pi");
    std::fs::write(&pi_fixture, format!("#!/bin/sh\n{body}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&pi_fixture, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(
        dir.path().join("agent-settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "settings": {
                "defaultTuiAgent": null,
                "disabledTuiAgents": [],
                "agentCmdOverrides": { "pi": pi_fixture.to_string_lossy() },
                "agentDefaultArgs": {},
                "agentDefaultEnv": {},
                "agentStatusHooksEnabled": true,
                "tabAutoGenerateTitle": false,
                "promptCacheTimerEnabled": false,
                "promptCacheTtlMs": 300000,
                "codexSessionSourceHome": ""
            }
        }))
        .unwrap(),
    )
    .unwrap();
}

fn start_launched_pi(engine: &Engine, workspace: &str) -> Value {
    let session = invoke(
        engine,
        "start",
        "harness.start",
        json!({
            "workspaceId": workspace,
            "harnessId": "pi",
            "permissionMode": "inherit",
        }),
    );
    assert_eq!(session["harnessId"], "pi");
    session
}

fn hook_event(engine: &Engine, id: &str, incarnation: &str, event: &str) -> Value {
    invoke(
        engine,
        &format!("hook-{event}"),
        "session.hook_event",
        json!({
            "sessionId": id,
            "incarnation": incarnation,
            "event": event,
        }),
    )
}

#[test]
fn launched_harness_idle_paint_is_unknown_until_a_start_hook() {
    // F1 loophole removal: a launched composer repaints idle and echoes
    // typing too, so fresh launch bytes without a hook turn prove terminal
    // liveness, never an agent turn. The launch stays recognized (harness
    // id, live verdict) — only the turn reads unknown.
    let dir = tempfile::tempdir().unwrap();
    write_pi_fixture(&dir, "echo launched-pi-marker\nsleep 30");
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = workspace_id(&engine);
    let session = start_launched_pi(&engine, &workspace);
    let id = session["id"].as_str().unwrap();
    let incarnation = session["incarnation"].as_str().unwrap();
    wait_for_output(&engine, id, incarnation, b"launched-pi-marker");
    let row = list_row(&engine, &workspace, id);
    assert_eq!(row["verdict"], "live");
    assert_eq!(row["harnessId"], "pi");
    assert_eq!(
        row["agentState"], "unknown",
        "idle paint without a start hook is unproven as a turn: {row}"
    );
}

#[test]
fn launched_start_hook_is_working_even_silent() {
    // The hook turn is authoritative: AgentStart reads `working` with zero
    // PTY output, through silence that would otherwise flip the row idle.
    let dir = tempfile::tempdir().unwrap();
    write_pi_fixture(&dir, "exec sleep 30");
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = workspace_id(&engine);
    let session = start_launched_pi(&engine, &workspace);
    let id = session["id"].as_str().unwrap();
    let incarnation = session["incarnation"].as_str().unwrap();
    let started = hook_event(&engine, id, incarnation, "AgentStart");
    assert_eq!(started["agentState"], "working");
    let row = list_row(&engine, &workspace, id);
    assert_eq!(
        row["agentState"], "working",
        "a hook-reported turn stays working without output: {row}"
    );
}

#[test]
fn launched_end_hook_then_echo_remains_idle() {
    // The turn-end hook closes the turn on the harness's own authority;
    // later PTY output (the user's echo at the idle prompt) must not spin
    // the row back to `working`.
    let dir = tempfile::tempdir().unwrap();
    write_pi_fixture(
        &dir,
        "echo first-marker\nsleep 5\necho second-marker\nsleep 30",
    );
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = workspace_id(&engine);
    let session = start_launched_pi(&engine, &workspace);
    let id = session["id"].as_str().unwrap();
    let incarnation = session["incarnation"].as_str().unwrap();
    wait_for_output(&engine, id, incarnation, b"first-marker");
    assert_eq!(
        hook_event(&engine, id, incarnation, "AgentStart")["agentState"],
        "working"
    );
    assert_eq!(
        hook_event(&engine, id, incarnation, "AgentEnd")["agentState"],
        "idle"
    );
    // Fresh output after the turn ended: still idle, never working.
    wait_for_output(&engine, id, incarnation, b"second-marker");
    let row = list_row(&engine, &workspace, id);
    assert_eq!(
        row["agentState"], "idle",
        "post-turn echo is not turn evidence: {row}"
    );
}

#[test]
fn launched_approval_stays_needs_input_until_cleared() {
    // A genuine approval wait parks the session until the harness resolves
    // it — output and silence must not clear it first.
    let dir = tempfile::tempdir().unwrap();
    write_pi_fixture(&dir, "echo launched-pi-marker\nexec sleep 30");
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = workspace_id(&engine);
    let session = start_launched_pi(&engine, &workspace);
    let id = session["id"].as_str().unwrap();
    let incarnation = session["incarnation"].as_str().unwrap();
    wait_for_output(&engine, id, incarnation, b"launched-pi-marker");
    assert_eq!(
        hook_event(&engine, id, incarnation, "ToolApprovalRequested")["agentState"],
        "needs_input"
    );
    assert_eq!(
        list_row(&engine, &workspace, id)["agentState"],
        "needs_input",
        "the wait survives until the harness clears it"
    );
    assert_eq!(
        hook_event(&engine, id, incarnation, "ToolApprovalResolved")["agentState"],
        "working",
        "the harness's own resolution hands the turn back: {id}"
    );
}

#[test]
fn limit_bounds_are_shared_with_read() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    for bad in [0u64, 65_537] {
        let response = dispatch_raw(
            &engine,
            "poll",
            "session.output",
            json!({"sessionId": id, "incarnation": incarnation, "cursor": 0, "waitMs": 0, "limitBytes": bad}),
        );
        assert!(!response.ok, "limitBytes {bad} must be refused");
        assert_eq!(response.error.unwrap().code, "invalid_argument");
    }
}
