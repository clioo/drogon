//! A live service handoff between two real `drogond` processes: the
//! predecessor stops serving without stopping its sessions, a successor
//! started with `--adopt-handoff` takes them over, and the shells running
//! in them never notice. Also: a handoff nobody takes resumes in place, and
//! `--adopt-handoff` with nothing offered exits instead of starting.
//!
//! Every process here is test-owned: `Daemon` kills and reaps its drogond
//! on drop, and session shells die with the last PTY master (SIGHUP).

#![cfg(any(target_os = "macos", target_os = "linux"))]

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const DEADLINE: Duration = Duration::from_secs(30);

struct Daemon {
    child: Child,
}

impl Daemon {
    fn start(data_dir: &Path, extra: &[&str], env: &[(&str, &str)]) -> Self {
        let mut command = Command::new(env!("CARGO_BIN_EXE_drogond"));
        command
            .arg("--data-dir")
            .arg(data_dir)
            .args(extra)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for (key, value) in env {
            command.env(key, value);
        }
        Daemon {
            child: command.spawn().expect("drogond spawns"),
        }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Waits for the process to exit on its own and returns its status.
    fn exited_within(&mut self, bound: Duration) -> Option<std::process::ExitStatus> {
        let deadline = Instant::now() + bound;
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                return Some(status);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}

fn socket(data_dir: &Path) -> PathBuf {
    data_dir.join(drogond::endpoint::SOCKET_FILE_NAME)
}

/// One request on a fresh connection, authenticated with the token on disk
/// right now (each service instance writes its own).
fn try_call(data_dir: &Path, method: &str, params: Value) -> Result<Value, String> {
    let token = std::fs::read_to_string(data_dir.join(drogond::auth::TOKEN_FILE_NAME))
        .map_err(|e| e.to_string())?;
    let mut stream = UnixStream::connect(socket(data_dir)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .unwrap();
    let request = json!({
        "protocol": drogon_protocol::PROTOCOL_VERSION,
        "requestId": uuid(),
        "auth": token.trim(),
        "method": method,
        "params": params,
    });
    let mut bytes = serde_json::to_vec(&request).unwrap();
    bytes.push(b'\n');
    stream.write_all(&bytes).map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let response: Value = serde_json::from_str(&line).map_err(|e| format!("{e}: {line:?}"))?;
    if response["ok"] == true {
        Ok(response["result"].clone())
    } else {
        Err(response["error"].to_string())
    }
}

fn call(data_dir: &Path, method: &str, params: Value) -> Value {
    try_call(data_dir, method, params).unwrap_or_else(|e| panic!("{method}: {e}"))
}

fn uuid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "handoff-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    )
}

fn wait_for<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + DEADLINE;
    loop {
        if let Some(value) = probe() {
            return value;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn status_of(data_dir: &Path, pid: u32) -> Value {
    wait_for(&format!("drogond {pid} to answer"), || {
        try_call(data_dir, "status", json!({}))
            .ok()
            .filter(|status| status["processId"] == pid)
    })
}

fn decode(text: &str) -> String {
    use base64::Engine as _;
    String::from_utf8_lossy(
        &base64::engine::general_purpose::STANDARD
            .decode(text)
            .unwrap(),
    )
    .into_owned()
}

fn encode(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn output(data_dir: &Path, id: &str, incarnation: &str) -> String {
    let read = call(
        data_dir,
        "session.read",
        json!({ "sessionId": id, "incarnation": incarnation, "cursor": 0 }),
    );
    decode(read["dataBase64"].as_str().unwrap())
}

fn session_row(data_dir: &Path, id: &str) -> Value {
    call(data_dir, "session.list", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == id)
        .cloned()
        .expect("session row")
}

/// A shell that echoes every line back, in a registered workspace.
fn start_echo_shell(data_dir: &Path, workspace: &Path) -> (String, String) {
    let workspace_id = call(data_dir, "workspace.register", json!({ "path": workspace }))["id"]
        .as_str()
        .unwrap()
        .to_string();
    let session = call(
        data_dir,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "echo \"shell $$ ready\"; while read line; do echo \"got:$line from $$\"; done"],
        }),
    );
    let id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    wait_for("the shell to start", || {
        output(data_dir, &id, &incarnation)
            .contains("ready")
            .then_some(())
    });
    (id, incarnation)
}

fn shell_pid(text: &str) -> String {
    let start = text.find("shell ").expect("shell banner") + "shell ".len();
    text[start..].split_whitespace().next().unwrap().to_string()
}

fn write_line(data_dir: &Path, id: &str, incarnation: &str, line: &str) {
    call(
        data_dir,
        "session.write",
        json!({
            "sessionId": id,
            "incarnation": incarnation,
            "dataBase64": encode(format!("{line}\n").as_bytes()),
        }),
    );
}

fn fences(status: &Value) -> Value {
    json!({ "hostId": status["hostId"], "serviceInstanceId": status["serviceInstanceId"] })
}

fn short_tempdir() -> tempfile::TempDir {
    // Unix socket paths are capped near 104 bytes; keep the data dir short.
    tempfile::Builder::new()
        .prefix("dh")
        .tempdir_in("/tmp")
        .unwrap()
}

#[test]
fn a_successor_takes_over_a_running_shell_and_the_predecessor_exits() {
    let dir = short_tempdir();
    let data_dir = dir.path().join("data");
    let workspace = dir.path().join("ws");
    std::fs::create_dir_all(&workspace).unwrap();

    let mut predecessor = Daemon::start(&data_dir, &[], &[]);
    let before = status_of(&data_dir, predecessor.pid());
    assert!(
        before["capabilities"]
            .as_array()
            .unwrap()
            .contains(&json!("runtime.session-handoff.v1"))
    );
    let (id, incarnation) = start_echo_shell(&data_dir, &workspace);
    write_line(&data_dir, &id, &incarnation, "one");
    wait_for("the first echo", || {
        output(&data_dir, &id, &incarnation)
            .contains("got:one")
            .then_some(())
    });
    let shell = shell_pid(&output(&data_dir, &id, &incarnation));

    let accepted = call(&data_dir, "runtime.handoff", fences(&before));
    assert_eq!(accepted["accepted"], true);
    assert_eq!(accepted["sessions"], 1);

    let successor = Daemon::start(&data_dir, &["--adopt-handoff"], &[]);
    let status = predecessor
        .exited_within(DEADLINE)
        .expect("the predecessor exits once the successor serves");
    assert!(status.success(), "predecessor exit: {status:?}");

    // It exited because the successor confirmed it serves, not because it
    // gave up waiting and left the sessions behind.
    let log = std::fs::read_to_string(drogon_core::diagnostics::log_path(&data_dir)).unwrap();
    assert!(
        log.contains("handoff: successor is serving; exiting"),
        "the predecessor must exit on the successor's confirmation:\n{log}"
    );
    assert!(log.contains("handoff: took over from"), "{log}");

    let after = status_of(&data_dir, successor.pid());
    assert_ne!(after["serviceInstanceId"], before["serviceInstanceId"]);
    assert_eq!(after["hostId"], before["hostId"]);

    // Same session, same incarnation, still live, with its whole history.
    let row = session_row(&data_dir, &id);
    assert_eq!(row["verdict"], "live", "{row}");
    assert_eq!(row["incarnation"], incarnation.as_str());
    let history = output(&data_dir, &id, &incarnation);
    assert!(
        history.contains("ready") && history.contains("got:one"),
        "{history:?}"
    );

    // The same shell process answers input sent through the successor.
    write_line(&data_dir, &id, &incarnation, "two");
    wait_for("the adopted shell's echo", || {
        output(&data_dir, &id, &incarnation)
            .contains(&format!("got:two from {shell}"))
            .then_some(())
    });

    // The successor owns the session: it can stop it and observes the exit.
    let stopped = call(
        &data_dir,
        "session.stop",
        json!({ "sessionId": id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited", "{stopped}");
    assert!(
        !data_dir
            .join(drogond::handoff::HANDOFF_SOCKET_NAME)
            .exists(),
        "the handoff socket is removed once the transfer is done"
    );
}

#[test]
fn a_handoff_nobody_takes_resumes_the_same_service_and_its_sessions() {
    let dir = short_tempdir();
    let data_dir = dir.path().join("data");
    let workspace = dir.path().join("ws");
    std::fs::create_dir_all(&workspace).unwrap();

    let service = Daemon::start(&data_dir, &[], &[("DROGON_HANDOFF_WAIT_MS", "400")]);
    let before = status_of(&data_dir, service.pid());
    let (id, incarnation) = start_echo_shell(&data_dir, &workspace);

    call(&data_dir, "runtime.handoff", fences(&before));
    // Nobody connects; the same instance comes back.
    let after = wait_for("the service to resume", || {
        try_call(&data_dir, "status", json!({}))
            .ok()
            .filter(|status| status["serviceInstanceId"] == before["serviceInstanceId"])
    });
    assert_eq!(after["processId"], service.pid());
    assert_eq!(session_row(&data_dir, &id)["verdict"], "live");
    write_line(&data_dir, &id, &incarnation, "resumed");
    wait_for("the resumed shell", || {
        output(&data_dir, &id, &incarnation)
            .contains("got:resumed")
            .then_some(())
    });
    call(
        &data_dir,
        "session.stop",
        json!({ "sessionId": id, "incarnation": incarnation }),
    );
}

#[test]
fn adopt_handoff_with_nothing_offered_exits_without_serving() {
    let dir = short_tempdir();
    let data_dir = dir.path().join("data");
    let mut successor = Daemon::start(
        &data_dir,
        &["--adopt-handoff"],
        &[("DROGON_HANDOFF_WAIT_MS", "200")],
    );
    let status = successor
        .exited_within(DEADLINE)
        .expect("a successor with nothing to adopt exits");
    assert!(
        !status.success(),
        "it must report the missing offer: {status:?}"
    );
    assert!(!socket(&data_dir).exists(), "it never bound the endpoint");

    // A service that later starts normally owns the directory as usual.
    let service = Daemon::start(&data_dir, &[], &[]);
    let status = status_of(&data_dir, service.pid());
    assert_eq!(
        call(&data_dir, "runtime.shutdown", fences(&status))["accepted"],
        true
    );
}
