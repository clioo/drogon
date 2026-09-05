//! Human rendering. `--json` never goes through here: it prints the raw
//! validated response envelope. Output must never include the auth token.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::client::{
    MethodResult, ReadResult, Session, SessionList, StatusResult, Workspace, WorkspaceList,
    WriteResult,
};

pub fn status_line(result: &StatusResult) -> String {
    [
        format!("host: {}", result.host_id),
        format!("service: {}", result.service_instance_id),
        format!("protocol: {}", result.protocol),
        format!("version: {}", result.version),
        format!("capabilities: {}", result.capabilities.join(", ")),
    ]
    .join("\n")
}

pub fn workspace_added(workspace: &Workspace) -> String {
    format!(
        "Registered workspace {} [{}] \"{}\" -> {} (host {})",
        workspace.id,
        workspace.kind_str(),
        workspace.name,
        workspace.path,
        workspace.host_id
    )
}

pub fn workspace_list(list: &WorkspaceList) -> String {
    if list.workspaces.is_empty() {
        return "No workspaces registered.".into();
    }
    list.workspaces
        .iter()
        .map(|workspace| {
            format!(
                "{} [{}] \"{}\" -> {} (host {})",
                workspace.id,
                workspace.kind_str(),
                workspace.name,
                workspace.path,
                workspace.host_id
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn session_started(session: &Session) -> String {
    format!(
        "Started session {} [{}] incarnation={} argv={:?} ({}x{})",
        session.id,
        session.verdict_str(),
        session.incarnation,
        session.argv(),
        session.cols,
        session.rows
    )
}

pub fn session_list(list: &SessionList) -> String {
    if list.sessions.is_empty() {
        return "No sessions.".into();
    }
    list.sessions
        .iter()
        .map(|session| {
            let exit = session
                .exit_code
                .map(|code| format!(" exit={code}"))
                .unwrap_or_default();
            format!(
                "{} [{}] ws={} incarnation={} argv={:?} {}x{}{}",
                session.id,
                session.verdict_str(),
                session.workspace_id,
                session.incarnation,
                session.argv(),
                session.cols,
                session.rows,
                exit
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Human read output decodes the wire bytes for display; JSON mode preserves
/// the wire `dataBase64`/cursor fields untouched.
pub fn session_read(result: &ReadResult) -> String {
    let header = format!(
        "session {} [{}] cursor {}..{} truncated={}",
        result.session.id,
        result.session.verdict_str(),
        result.start_cursor,
        result.next_cursor,
        result.truncated
    );
    match STANDARD.decode(result.data_base64.as_bytes()) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes);
            if text.is_empty() {
                header
            } else {
                format!("{header}\n{text}")
            }
        }
        Err(_) => format!("{header}\n<body is not valid base64; use --json for wire bytes>"),
    }
}

pub fn session_wrote(result: &WriteResult, session_hint: &str) -> String {
    format!("Wrote {} bytes to {}.", result.accepted_bytes, session_hint)
}

pub fn session_resized(session: &Session) -> String {
    format!(
        "Resized {} to {}x{} [{}].",
        session.id,
        session.cols,
        session.rows,
        session.verdict_str()
    )
}

pub fn session_closed(session: &Session) -> String {
    let exit = session
        .exit_code
        .map(|code| format!(" exit={code}"))
        .unwrap_or_default();
    format!("Closed {} [{}].{}", session.id, session.verdict_str(), exit)
}

/// Rendered text for a decoded result, given the invocation context. The
/// context disambiguates the commands that share result shapes.
pub fn render(result: &MethodResult, context: &RenderContext) -> String {
    match (result, context) {
        (MethodResult::Status(status), _) => status_line(status),
        (MethodResult::Workspace(workspace), RenderContext::WorkspaceAdded) => {
            workspace_added(workspace)
        }
        (MethodResult::WorkspaceList(list), _) => workspace_list(list),
        (MethodResult::Session(session), RenderContext::SessionStarted) => session_started(session),
        (MethodResult::Session(session), RenderContext::SessionResized) => session_resized(session),
        (MethodResult::Session(session), RenderContext::SessionClosed) => session_closed(session),
        (MethodResult::SessionList(list), _) => session_list(list),
        (MethodResult::Read(read), _) => session_read(read),
        (MethodResult::Write(write), RenderContext::SentTo(session)) => {
            session_wrote(write, session)
        }
        _ => unreachable!("command layer pairs results with matching contexts"),
    }
}

#[derive(Debug, Clone)]
pub enum RenderContext {
    WorkspaceAdded,
    SessionStarted,
    SessionResized,
    SessionClosed,
    SentTo(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_session(verdict: &str) -> Session {
        serde_json::from_value(json!({
            "id": "s1", "workspaceId": "w1", "hostId": "h1",
            "incarnation": "tok", "command": "sh", "args": ["-c", "echo hi"],
            "cols": 80, "rows": 24, "verdict": verdict,
            "exitCode": null, "createdAt": "2026-09-05T12:00:00Z"
        }))
        .unwrap()
    }

    #[test]
    fn status_renders_identity_and_capabilities() {
        let status_result: StatusResult = serde_json::from_value(json!({
            "hostId": "h1", "serviceInstanceId": "svc1", "protocol": 1,
            "capabilities": ["workspace.v1", "session.pty.v1"], "version": "0.1.0"
        }))
        .unwrap();
        let text = status_line(&status_result);
        assert!(text.contains("host: h1"));
        assert!(text.contains("protocol: 1"));
        assert!(text.contains("capabilities: workspace.v1, session.pty.v1"));
    }

    #[test]
    fn read_human_output_decodes_base64_once() {
        let read: ReadResult = serde_json::from_value(json!({
            "session": {
                "id": "s1", "workspaceId": "w1", "hostId": "h1", "incarnation": "tok",
                "command": "sh", "args": [], "cols": 80, "rows": 24,
                "verdict": "live", "exitCode": null, "createdAt": "2026-09-05T12:00:00Z"
            },
            "dataBase64": STANDARD.encode("héllo\n"),
            "startCursor": 0, "nextCursor": 7, "truncated": false
        }))
        .unwrap();
        let text = session_read(&read);
        assert!(text.starts_with("session s1 [live] cursor 0..7 truncated=false\n"));
        assert!(text.contains("héllo"));
    }

    #[test]
    fn list_renders_verdicts_honestly() {
        let list = SessionList {
            sessions: vec![sample_session("unverifiable")],
        };
        assert!(session_list(&list).contains("[unverifiable]"));
    }

    #[test]
    fn close_renders_exit_code_when_known() {
        let mut session = sample_session("exited");
        session.exit_code = Some(3);
        assert!(session_closed(&session).contains("exit=3"));
    }
}
