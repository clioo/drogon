//! `ports.kill` — additive daemon RPC (R16-BC). Stops a workspace-owned
//! local listener: SIGTERM, then SIGKILL after a bounded wait if the process
//! is still observable. The authorization rule mirrors the fork's
//! `src/main/ports/workspace-port-ownership.ts` (`killWorkspacePort`,
//! #11161 comment included in spirit): caller-supplied PIDs are never
//! trusted. A PID is signallable only when it either belongs to a live
//! session of the requested workspace (the retained PTY child handle — the
//! same handle-ownership model as `session.stop`) or owns a listener on the
//! requested port that attributes to the workspace root by process cwd or
//! command line (the fork's `attributePortToWorkspace` matching, ported).
//! Everything else refuses with the fork's copy.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::{Value, json};

use crate::error;
use crate::session::SessionHandle;
use crate::workspace;
use drogon_protocol::RpcError;

/// Grace between SIGTERM and the SIGKILL escalation, and the final wait
/// after SIGKILL. Bounded so the RPC never hangs on a process that ignores
/// termination; the answer is `ok` once both signals were delivered (or the
/// PID became unobservable) — reaping is the parent's job, not ours.
#[cfg(unix)]
const TERM_GRACE: std::time::Duration = std::time::Duration::from_millis(2_000);
#[cfg(unix)]
const KILL_GRACE: std::time::Duration = std::time::Duration::from_millis(500);
#[cfg(unix)]
const GONE_POLL: std::time::Duration = std::time::Duration::from_millis(20);

impl crate::Engine {
    /// Dispatched from `lib.rs`; see the module doc for the rule.
    pub(super) fn do_ports_kill(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_id = crate::require_str(params, "workspaceId")?;
        let pid = params
            .get("pid")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0 && *value <= u32::MAX as u64)
            .ok_or_else(|| error::invalid_argument("pid must be a positive integer"))?
            as u32;
        let port = params
            .get("port")
            .and_then(Value::as_u64)
            .filter(|value| (1..=65_535).contains(value))
            .ok_or_else(|| error::invalid_argument("port must be 1..=65535"))?;
        let root = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, workspace_id)?
        };
        Ok(kill_workspace_process(
            &self.sessions,
            &root,
            workspace_id,
            pid,
            port as u16,
        ))
    }
}

/// Domain outcome envelope, shaped like the fork's `WorkspacePortKillResult`.
fn refused(reason: &str) -> Value {
    json!({ "ok": false, "reason": reason })
}

fn kill_workspace_process(
    sessions: &Mutex<HashMap<String, Arc<SessionHandle>>>,
    workspace_root: &str,
    workspace_id: &str,
    pid: u32,
    port: u16,
) -> Value {
    if pid == std::process::id() {
        return refused("Drogon cannot stop its own process.");
    }
    if !session_owned_pid(sessions, workspace_id, pid) {
        match port_authorization(workspace_root, pid, port) {
            PortAuthorization::Owned => {}
            PortAuthorization::NotListening => return refused("The port is no longer listening."),
            PortAuthorization::Foreign => {
                return refused("Only workspace-owned local processes can be stopped here.");
            }
        }
    }
    terminate(pid)
}

/// Live-handle ownership: the pid is the retained PTY child of a session of
/// this workspace. Handles are never reconstructed from SQLite, so a pid
/// read from stale state can never authorize a kill.
fn session_owned_pid(
    sessions: &Mutex<HashMap<String, Arc<SessionHandle>>>,
    workspace_id: &str,
    pid: u32,
) -> bool {
    let sessions = sessions.lock().unwrap();
    sessions.values().any(|handle| {
        handle.workspace_id == workspace_id
            && handle
                .child_process_id()
                .is_some_and(|child_pid| child_pid == pid)
    })
}

enum PortAuthorization {
    Owned,
    NotListening,
    Foreign,
}

/// Port ownership: the pid still listens on the requested port and the
/// listener attributes to the workspace root by process cwd (highest
/// confidence) or command line, exactly the fork's matching. A scan
/// failure fails closed (`Foreign`): no ownership proof, no signal.
fn port_authorization(workspace_root: &str, pid: u32, port: u16) -> PortAuthorization {
    let Some(pids) = listener_pids_for_port(port) else {
        return PortAuthorization::Foreign;
    };
    if !pids.contains(&pid) {
        return PortAuthorization::NotListening;
    }
    let Ok((cwd, command_line)) = process_cwd_and_command_line(pid) else {
        return PortAuthorization::Foreign;
    };
    let root = normalize_comparable_path(workspace_root);
    if let Some(cwd) = cwd {
        let cwd = normalize_comparable_path(&cwd);
        if cwd == root || cwd.starts_with(&format!("{root}/")) {
            return PortAuthorization::Owned;
        }
    }
    if let Some(command_line) = command_line
        && includes_path_boundary(&normalize_comparable_text(&command_line), &root)
    {
        return PortAuthorization::Owned;
    }

    PortAuthorization::Foreign
}

// --- Platform probes ------------------------------------------------------

/// PIDs listening on `port` (TCP). `None` = the platform scan failed; the
/// caller fails closed.
#[cfg(target_os = "macos")]
fn listener_pids_for_port(port: u16) -> Option<Vec<u32>> {
    let output = std::process::Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-F", "pcn"])
        .output()
        .ok()?;
    // lsof exits 1 when nothing matches: that is a valid "no listeners"
    // answer, not a scan failure — only an unreadable stdout fails closed.
    if output.stdout.is_empty() {
        return Some(Vec::new());
    }
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Some(parse_lsof_pid_records(&stdout))
}

#[cfg(target_os = "linux")]
fn listener_pids_for_port(port: u16) -> Option<Vec<u32>> {
    let mut inodes = std::collections::HashSet::new();
    for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let content = std::fs::read_to_string(table).ok()?;
        for line in content.lines().skip(1) {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 10 || fields[3] != "0A" {
                continue;
            }
            let local = fields[1];
            let Some((_, port_hex)) = local.rsplit_once(':') else {
                continue;
            };
            if u32::from_str_radix(port_hex, 16).ok() == Some(port as u32) {
                inodes.insert(fields[9].to_string());
            }
        }
    }
    if inodes.is_empty() {
        return Some(Vec::new());
    }
    let mut pids = Vec::new();
    let proc_entries = std::fs::read_dir("/proc").ok()?;
    for entry in proc_entries.flatten() {
        let name = entry.file_name();
        let pid_text = name.to_string_lossy();
        if pid_text.parse::<u32>().is_err() {
            continue;
        }
        let fds = match std::fs::read_dir(entry.path().join("fd")) {
            Ok(fds) => fds,
            Err(_) => continue,
        };
        let mut matched = false;
        for fd in fds.flatten() {
            let Ok(link) = std::fs::read_link(fd.path()) else {
                continue;
            };
            let link = link.to_string_lossy();
            if let Some(inode) = link
                .strip_prefix("socket:[")
                .and_then(|rest| rest.strip_suffix(']'))
                && inodes.contains(inode)
            {
                matched = true;
                break;
            }
        }
        if matched {
            pids.push(pid_text.parse::<u32>().unwrap_or(0));
        }
    }
    Some(pids.into_iter().filter(|pid| *pid > 0).collect())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn listener_pids_for_port(_port: u16) -> Option<Vec<u32>> {
    None
}

/// `lsof -F pcn` records: `p<pid>` lines start a record, `n` lines carry
/// the address (already filtered to LISTEN by the invocation).
#[cfg(target_os = "macos")]
fn parse_lsof_pid_records(output: &str) -> Vec<u32> {
    output
        .lines()
        .filter_map(|line| line.strip_prefix('p'))
        .filter_map(|value| value.parse::<u32>().ok())
        .collect()
}

/// (cwd, command line) for a pid; `Err` when neither could be read.
#[cfg(target_os = "macos")]
fn process_cwd_and_command_line(pid: u32) -> Result<(Option<String>, Option<String>), ()> {
    let cwd_output = std::process::Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .map_err(|_| ())?;
    let mut cwd = None;
    if cwd_output.status.success() {
        let stdout = String::from_utf8_lossy(&cwd_output.stdout);
        cwd = stdout
            .lines()
            .find_map(|line| line.strip_prefix('n'))
            .map(str::to_string)
            .filter(|value| !value.is_empty());
    }
    let ps_output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .map_err(|_| ())?;
    let command_line = ps_output.status.success().then(|| {
        String::from_utf8_lossy(&ps_output.stdout)
            .trim()
            .to_string()
    });
    if cwd.is_none() && command_line.as_deref().is_none_or(|line| line.is_empty()) {
        return Err(());
    }
    Ok((cwd, command_line.filter(|line| !line.is_empty())))
}

#[cfg(target_os = "linux")]
fn process_cwd_and_command_line(pid: u32) -> Result<(Option<String>, Option<String>), ()> {
    let base = format!("/proc/{pid}");
    let cwd = std::fs::read_link(format!("{base}/cwd"))
        .ok()
        .map(|path| path.to_string_lossy().into_owned());
    let command_line = std::fs::read(format!("{base}/cmdline"))
        .ok()
        .map(|bytes| {
            bytes
                .split(|byte| *byte == 0)
                .filter(|part| !part.is_empty())
                .map(|part| String::from_utf8_lossy(part).into_owned())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|line| !line.is_empty());
    if cwd.is_none() && command_line.is_none() {
        return Err(());
    }
    Ok((cwd, command_line))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn process_cwd_and_command_line(_pid: u32) -> Result<(Option<String>, Option<String>), ()> {
    Err(())
}

// --- Signal + bounded escalation (unix) ------------------------------------

#[cfg(unix)]
fn terminate(pid: u32) -> Value {
    let pid = pid as i32;
    let errno_of = |error: std::io::Error| error.raw_os_error().unwrap_or(libc::EIO);

    // ESRCH here is success, exactly the fork's reasoning: the process
    // exited between the authorizing check and this signal, so the port is
    // free — which is what Stop was asked for.
    let term = unsafe { libc::kill(pid, libc::SIGTERM) };
    if term == -1 {
        let errno = errno_of(std::io::Error::last_os_error());
        if errno == libc::ESRCH {
            return json!({ "ok": true });
        }
        return refused("Failed to stop the process.");
    }
    if wait_until_gone(pid, TERM_GRACE) {
        return json!({ "ok": true });
    }
    let _ = unsafe { libc::kill(pid, libc::SIGKILL) };
    let _ = wait_until_gone(pid, KILL_GRACE);
    // The escalation is delivered (or the pid became unobservable); the
    // answer is not held hostage by a parent that never reaps.
    json!({ "ok": true })
}

#[cfg(unix)]
fn wait_until_gone(pid: i32, grace: std::time::Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        let observable = unsafe { libc::kill(pid, 0) } == 0;
        if !observable {
            // Distinguish "gone" (ESRCH) from "exists but we cannot signal
            // it" (EPERM): only ESRCH means the stop took effect.
            let errno = std::io::Error::last_os_error().raw_os_error();
            if errno == Some(libc::ESRCH) {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(GONE_POLL);
    }
}

#[cfg(not(unix))]
fn terminate(_pid: u32) -> Value {
    refused("Stopping workspace processes is not supported on this platform.")
}

// --- Path matching (verbatim logic from the fork's attribution) -------------

fn normalize_comparable_path(input: &str) -> String {
    let resolved = if input.starts_with('/') {
        resolve_dot_segments(input)
    } else {
        input.to_string()
    };
    normalize_comparable_text(&resolved)
}

fn normalize_comparable_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_slash = false;
    for ch in input.chars() {
        if ch == '\\' || ch == '/' {
            if !last_was_slash {
                out.push('/');
            }
            last_was_slash = true;
        } else {
            #[cfg(windows)]
            let ch = ch.to_ascii_lowercase();
            out.push(ch);
            last_was_slash = false;
        }
    }
    out
}

/// Lexical `.`/`..` resolution for an absolute path (no filesystem access;
/// the callers canonicalize when they need symlink truth).
fn resolve_dot_segments(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    format!("/{}", parts.join("/"))
}

/// The fork's `includesPathBoundary`: the normalized path appears in the
/// command line with a boundary-safe character on both sides.
fn includes_path_boundary(command_line: &str, normalized_path: &str) -> bool {
    let mut index = 0;
    while let Some(found) = command_line[index..].find(normalized_path) {
        let start = index + found;
        let before = if start == 0 {
            None
        } else {
            command_line[..start].chars().next_back()
        };
        let after = command_line[start + normalized_path.len()..].chars().next();
        let starts_on_boundary = before.is_none_or(|ch| {
            ch.is_whitespace() || ch == '"' || ch == '\'' || ch == '=' || ch == '\\'
        });
        let ends_on_boundary = after.is_none_or(|ch| {
            ch.is_whitespace() || ch == '"' || ch == '\'' || ch == '/' || ch == ':'
        });
        if starts_on_boundary && ends_on_boundary {
            return true;
        }
        index = start + normalized_path.len();
    }
    false
}

// --- Tests ------------------------------------------------------------------

#[cfg(test)]
mod attribution_tests {
    use super::*;

    #[test]
    fn normalize_collapses_separators_and_resolves_dot_segments() {
        assert_eq!(normalize_comparable_path("/a//b/./c/../d"), "/a/b/d");
        assert_eq!(normalize_comparable_path("/a/b/"), "/a/b");
        assert_eq!(normalize_comparable_text("a\\b\\\\c"), "a/b/c");
    }

    #[test]
    fn boundary_match_requires_safe_neighbors() {
        assert!(includes_path_boundary(
            "python3 -m http.server --directory /ws/a",
            "/ws/a"
        ));
        assert!(includes_path_boundary("run /ws/a/", "/ws/a"));
        // A suffix of the path is not the path.
        assert!(!includes_path_boundary("node /ws/ab/server.js", "/ws/a"));
        // Quoted and equals-prefixed occurrences still match.
        assert!(includes_path_boundary("cmd \"--root=/ws/a\"", "/ws/a"));
    }
}

#[cfg(all(test, unix))]
mod ports_kill_tests {
    use super::*;
    use serde_json::json;

    fn open_engine() -> (tempfile::TempDir, crate::Engine) {
        let dir = tempfile::tempdir().unwrap();
        let engine = crate::Engine::open(dir.path()).unwrap();
        (dir, engine)
    }

    fn invoke(engine: &crate::Engine, id: &str, method: &str, params: Value) -> Value {
        let response = engine.dispatch(crate::Request {
            protocol: crate::PROTOCOL_VERSION,
            request_id: id.into(),
            auth: None,
            method: method.into(),
            params,
        });
        assert!(response.ok, "{:?}", response.error);
        response.result.unwrap()
    }

    fn register_workspace(engine: &crate::Engine, path: &std::path::Path) -> String {
        let workspace = invoke(engine, "w", "workspace.register", json!({ "path": path }));
        workspace["id"].as_str().unwrap().to_string()
    }

    fn kill(engine: &crate::Engine, workspace_id: &str, pid: u32, port: u16) -> Value {
        invoke(
            engine,
            "k",
            "ports.kill",
            json!({ "workspaceId": workspace_id, "pid": pid, "port": port }),
        )
    }

    /// A session's own child (a live PTY of the workspace) is signallable
    /// even though it listens on nothing.
    #[test]
    fn kills_a_session_owned_pid_without_any_port() {
        let (dir, engine) = open_engine();
        let workspace_id = register_workspace(&engine, dir.path());
        let session = invoke(
            &engine,
            "s",
            "session.start",
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/sh",
                "args": ["-c", "exec sleep 60"],
            }),
        );
        let session_id = session["id"].as_str().unwrap().to_string();
        let handle = engine.sessions.lock().unwrap()[&session_id].clone();
        let pid = handle.child_process_id().expect("unix child has a pid");
        drop(handle);

        let result = kill(&engine, &workspace_id, pid, 9);
        assert_eq!(result["ok"], true);

        // The session observes the exit (bounded like session.stop's verify).
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if handle_is_exited(&engine, &session_id) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "session exit not observed"
            );
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }

    #[test]
    fn refuses_the_daemons_own_pid() {
        let (dir, engine) = open_engine();
        let workspace_id = register_workspace(&engine, dir.path());
        let result = kill(&engine, &workspace_id, std::process::id(), 9);
        assert_eq!(result["ok"], false);
        assert_eq!(
            result["reason"].as_str().unwrap(),
            "Drogon cannot stop its own process."
        );
    }

    #[test]
    fn refuses_an_arbitrary_pid_that_listens_on_nothing() {
        let (dir, engine) = open_engine();
        let workspace_id = register_workspace(&engine, dir.path());
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "exec sleep 60"])
            .spawn()
            .unwrap();
        let pid = child.id();
        let result = kill(&engine, &workspace_id, pid, 49_999);
        assert_eq!(result["ok"], false);
        assert_eq!(
            result["reason"].as_str().unwrap(),
            "The port is no longer listening."
        );
        // Refusal never signals: the child is still there.
        assert!(child.try_wait().unwrap().is_none());
        let _ = child.kill();
        let _ = child.wait();
    }

    fn handle_is_exited(engine: &crate::Engine, session_id: &str) -> bool {
        let list = invoke(engine, "l", "session.list", json!({}));
        list["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|session| session["id"] == session_id && session["verdict"] == "exited")
    }

    /// Ports derived from the test process pid plus a per-test salt stay
    /// out of the well-known range while remaining deterministic per run
    /// (parallel tests in this binary must not collide on one port).
    fn scratch_port(salt: u32) -> u16 {
        40_000 + ((std::process::id() + salt) % 10_000) as u16
    }

    fn spawn_python_http_server(cwd: &std::path::Path, port: u16) -> Option<std::process::Child> {
        let mut child = std::process::Command::new("python3")
            .args([
                "-m",
                "http.server",
                &port.to_string(),
                "--bind",
                "127.0.0.1",
            ])
            .current_dir(cwd)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        // Wait until the listener is observable (or give up: the caller
        // asserts on the kill outcome, so a dead server reads as a
        // refusal, never a false pass).
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                return Some(child);
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            if matches!(child.try_wait(), Ok(Some(_))) {
                return None;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    /// A listener whose process cwd is inside the workspace root attributes
    /// by cwd and can be stopped.
    #[test]
    fn kills_a_workspace_cwd_listener() {
        // Canonical path: lsof reports the resolved cwd (/private/var/...),
        // so both the server spawn and the workspace registration must use
        // the same canonical form for the attribution match.
        let server_cwd = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let Some(mut server) = spawn_python_http_server(&server_cwd, scratch_port(7)) else {
            eprintln!("python3 http.server fixture unavailable; skipping");
            return;
        };
        let (_dir, engine) = open_engine();
        let workspace_id = register_workspace(&engine, &server_cwd);
        let pid = server.id();
        let port = scratch_port(7);

        let result = kill(&engine, &workspace_id, pid, port);
        assert_eq!(result["ok"], true, "kill refused: {result}");

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if matches!(server.try_wait(), Ok(Some(_))) {
                return;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "listener survived SIGTERM"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    /// The same listener refuses when the requested workspace is NOT the
    /// owner: cwd attribution fails and the command line carries no trace
    /// of the foreign root.
    #[test]
    fn refuses_a_listener_owned_by_another_workspace() {
        let server_cwd = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let Some(mut server) = spawn_python_http_server(&server_cwd, scratch_port(13)) else {
            eprintln!("python3 http.server fixture unavailable; skipping");
            return;
        };
        let (dir, engine) = open_engine();
        // Workspace root is an unrelated tempdir: the server's cwd and
        // command line contain no trace of it.
        let workspace_id = register_workspace(&engine, dir.path());
        let pid = server.id();
        let port = scratch_port(13);

        let result = kill(&engine, &workspace_id, pid, port);
        assert_eq!(result["ok"], false);
        assert_eq!(
            result["reason"].as_str().unwrap(),
            "Only workspace-owned local processes can be stopped here."
        );
        assert!(server.try_wait().unwrap().is_none());
        let _ = server.kill();
        let _ = server.wait();
    }
}
