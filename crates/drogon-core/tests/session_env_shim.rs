//! Per-data-dir CLI shims and session environment, end to end through real
//! PTY sessions (journey J3 completion). Unix-only (`/bin/sh`).
//!
//! The real `drogon-cli`/`drogond` pair is exercised by the PR transcript
//! (acceptance); here a fixture CLI stands in for the daemon-bound binary so
//! the wiring — shim install, `PATH` order, session variables, shim exec —
//! is pinned deterministically: a real PTY session runs `drogon-cli status
//! --json` through the installed shim and gets the daemon identity back.
#![cfg(unix)]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

/// Serializes every test in this file: several mutate the process `PATH`
/// (prepend-only, restored afterwards), and resolution reads it at
/// `Engine::open`.
static PATH_LOCK: Mutex<()> = Mutex::new(());

const READ_BUDGET: Duration = Duration::from_secs(15);

fn req(method: &str, request_id: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn base64_of(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

fn register_workspace(engine: &Engine, dir: &std::path::Path, request_id: &str) -> String {
    let ws = ok(
        engine,
        "workspace.register",
        request_id,
        json!({ "path": dir.to_string_lossy() }),
    );
    ws["id"].as_str().unwrap().to_string()
}

/// Stops the owned session on drop so a failed assertion cannot leave an
/// unowned process behind.
struct SessionGuard<'a> {
    engine: &'a Engine,
    session_id: String,
    incarnation: String,
}

impl Drop for SessionGuard<'_> {
    fn drop(&mut self) {
        let _ = self.engine.dispatch(req(
            "session.stop",
            &format!("cleanup-{}", self.session_id),
            json!({ "sessionId": self.session_id, "incarnation": self.incarnation }),
        ));
    }
}

/// Drain retained PTY output until `done` holds or the budget expires. The
/// predicate must match execution output only: PTY echo already contains the
/// typed command line, so waiting on a bare marker word returns immediately.
fn read_until(
    engine: &Engine,
    session_id: &str,
    incarnation: &str,
    done: impl Fn(&str) -> bool,
) -> String {
    let mut cursor = 0u64;
    let mut text = String::new();
    let mut reads = 0u64;
    let deadline = Instant::now() + READ_BUDGET;
    while Instant::now() < deadline {
        reads += 1;
        let read = ok(
            engine,
            "session.read",
            &format!("read-{session_id}-{reads}"),
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
        );
        cursor = read["nextCursor"].as_u64().unwrap();
        let bytes = {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(read["dataBase64"].as_str().unwrap())
                .unwrap()
        };
        text.push_str(&String::from_utf8_lossy(&bytes));
        if done(&text) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    text
}

fn write_text(engine: &Engine, session_id: &str, incarnation: &str, text: &str) {
    ok(
        engine,
        "session.write",
        &format!("write-{session_id}"),
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "dataBase64": base64_of(text),
        }),
    );
}

fn canonical(dir: &tempfile::TempDir) -> String {
    std::fs::canonicalize(dir.path())
        .unwrap()
        .to_string_lossy()
        .into_owned()
}

fn shim_bin(data: &str) -> String {
    format!("{data}/bin")
}

#[test]
fn open_installs_executable_shims_bound_to_the_data_dir() {
    let _path = PATH_LOCK.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let _engine = Engine::open(dir.path()).unwrap();
    let data = canonical(&dir);
    for name in ["drogon-cli", "drogon"] {
        let path = std::path::Path::new(&shim_bin(&data)).join(name);
        let content = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("open must install {name} in <data-dir>/bin"));
        assert!(
            content.starts_with("#!/usr/bin/env bash\n"),
            "{name} must be a shell shim"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_ne!(mode & 0o111, 0, "{name} must be executable");
        }
        // Either the shim binds this data dir, or no CLI was reachable and
        // it fails loudly (never a bare PATH exec that would loop onto
        // itself through the session PATH).
        assert!(
            content.contains(&format!("--data-dir {data}"))
                || content.contains("drogon-cli is unavailable"),
            "{name} must bind the data dir or fail loudly: {content}"
        );
    }
    let cli = std::fs::read_to_string(format!("{}/bin/drogon-cli", data)).unwrap();
    let alias = std::fs::read_to_string(format!("{}/bin/drogon", data)).unwrap();
    assert_eq!(cli, alias, "the alias must exec the same CLI");
}

#[test]
fn reopen_replaces_stale_shims_idempotently() {
    let _path = PATH_LOCK.lock().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let first = Engine::open(dir.path()).unwrap();
    drop(first);
    let data = canonical(&dir);
    let expected = std::fs::read_to_string(format!("{}/bin/drogon-cli", data)).unwrap();
    for name in ["drogon-cli", "drogon"] {
        std::fs::write(format!("{}/bin/{name}", data), "# stale shim\n").unwrap();
    }
    let _second = Engine::open(dir.path()).unwrap();
    for name in ["drogon-cli", "drogon"] {
        let content = std::fs::read_to_string(format!("{}/bin/{name}", data)).unwrap();
        assert_eq!(
            content, expected,
            "reopen must replace a stale {name} with the daemon's CLI binding"
        );
    }
    let _third = Engine::open(dir.path()).unwrap();
    let stable = std::fs::read_to_string(format!("{}/bin/drogon-cli", data)).unwrap();
    assert_eq!(
        stable, expected,
        "reinstall over fresh shims changes nothing"
    );
}

/// Fixture standing in for the daemon-bound CLI: answers `status --json`
/// with a fixed daemon identity, echoes anything else.
fn write_fixture_cli(dir: &std::path::Path) {
    let script = "#!/bin/sh\n\
        if [ \"$1\" = \"status\" ] && [ \"$2\" = \"--json\" ]; then\n  \
        printf '{\"hostId\":\"fixture-host\",\"serviceInstanceId\":\"fixture-instance\"}\\n'\n  \
        exit 0\nfi\n\
        printf 'fixture-cli got: %s\\n' \"$*\"\n";
    let path = dir.join("drogon-cli");
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

struct SavedPath(Option<std::ffi::OsString>);

impl SavedPath {
    fn prepend(dir: &std::path::Path) -> Self {
        let previous = std::env::var_os("PATH");
        let mut entries = vec![dir.to_path_buf()];
        if let Some(ref current) = previous {
            entries.extend(std::env::split_paths(current));
        }
        let joined = std::env::join_paths(entries).unwrap();
        unsafe { std::env::set_var("PATH", &joined) };
        SavedPath(previous)
    }
}

impl Drop for SavedPath {
    fn drop(&mut self) {
        unsafe {
            match self.0.take() {
                Some(previous) => std::env::set_var("PATH", previous),
                None => std::env::remove_var("PATH"),
            }
        }
    }
}

#[test]
fn real_session_runs_shimmed_cli_with_session_env() {
    let _path = PATH_LOCK.lock().unwrap();
    let fixture_dir = tempfile::tempdir().unwrap();
    write_fixture_cli(fixture_dir.path());
    let _restore = SavedPath::prepend(fixture_dir.path());

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let data = canonical(&dir);
    let bin = shim_bin(&data);
    let shim_content = std::fs::read_to_string(format!("{bin}/drogon-cli")).unwrap();
    assert!(
        shim_content.contains(&format!("--data-dir {data}")),
        "with a CLI on PATH the shim must bind this data dir: {shim_content}"
    );

    let work = tempfile::tempdir().unwrap();
    let workspace_id = register_workspace(&engine, work.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": [],
            "cols": 200, "rows": 50,
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    let _guard = SessionGuard {
        engine: &engine,
        session_id: session_id.clone(),
        incarnation: incarnation.clone(),
    };

    write_text(
        &engine,
        &session_id,
        &incarnation,
        "echo \"WHICH $(command -v drogon-cli)\"; \
         echo \"ALIAS $(command -v drogon)\"; \
         echo \"ENV $DROGON_DATA_DIR|$DROGON_WORKSPACE_ID|$DROGON_SESSION_ID|$DROGON_TERMINAL|$TERM_PROGRAM\"; \
         drogon-cli status --json; drogon status --json; echo PROBE-DONE\n",
    );
    let expected_env = format!("ENV {data}|{workspace_id}|{session_id}|1|Drogon");
    let text = read_until(&engine, &session_id, &incarnation, |text| {
        text.contains(&expected_env) && text.matches("fixture-instance").count() >= 2
    });
    assert!(text.contains(&expected_env), "probe must finish: {text:?}");
    assert!(
        text.contains(&format!("WHICH {bin}/drogon-cli")),
        "`drogon-cli` must resolve to the shim: {text:?}"
    );
    assert!(
        text.contains(&format!("ALIAS {bin}/drogon")),
        "`drogon` must resolve to the alias shim: {text:?}"
    );
    assert!(
        text.contains(&format!("ENV {data}|{workspace_id}|{session_id}|1|Drogon")),
        "session env must carry the daemon identity: {text:?}"
    );
    assert!(
        text.matches("fixture-instance").count() >= 2,
        "both names must exec the daemon-bound CLI and report its identity: {text:?}"
    );
}
