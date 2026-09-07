//! Human rendering. `--json` never goes through here: it prints the raw
//! validated response envelope. Output must never include the auth token.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::client::{
    HarnessCatalog, MethodResult, Project, ProjectList, ReadResult, Removed, Session, SessionList,
    StatusResult, Workspace, WorkspaceList, Worktree, WorktreeList, WriteResult,
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

pub fn project_added(project: &Project) -> String {
    format!(
        "Registered project {} [{}] \"{}\" -> {}{}",
        project.id,
        project.kind_str(),
        project.name,
        project.path,
        project
            .default_base_ref
            .as_deref()
            .map(|r| format!(" (default base {r})"))
            .unwrap_or_default()
    )
}

pub fn project_list(list: &ProjectList) -> String {
    if list.projects.is_empty() {
        return "No projects registered.".into();
    }
    list.projects
        .iter()
        .map(|project| {
            format!(
                "{} [{}] \"{}\" -> {}",
                project.id,
                project.kind_str(),
                project.name,
                project.path
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn worktree_created(worktree: &Worktree) -> String {
    format!(
        "Created worktree {} for project {} on branch {} -> {} (head {})",
        worktree.id, worktree.project_id, worktree.branch, worktree.path, worktree.head
    )
}

pub fn worktree_list(list: &WorktreeList) -> String {
    if list.worktrees.is_empty() {
        return "No worktrees.".into();
    }
    list.worktrees
        .iter()
        .map(|worktree| {
            format!(
                "{} branch={} head={} -> {}{}",
                worktree.id,
                if worktree.branch.is_empty() {
                    "-"
                } else {
                    &worktree.branch
                },
                if worktree.head.is_empty() {
                    "-"
                } else {
                    &worktree.head
                },
                worktree.path,
                worktree
                    .base_ref
                    .as_deref()
                    .map(|r| format!(" (base {r})"))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn worktree_removed(removed: &Removed) -> String {
    format!("Removed worktree {}.", removed.id)
}

pub fn session_started(session: &Session) -> String {
    format!(
        "Started session {} [{}] agent={} incarnation={} argv={:?} ({}x{})",
        session.id,
        session.verdict_str(),
        session.agent_state.as_wire(),
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
                "{} [{}] agent={} ws={} incarnation={} argv={:?} {}x{}{}",
                session.id,
                session.verdict_str(),
                session.agent_state.as_wire(),
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
        "session {} [{}] agent={} cursor {}..{} truncated={}",
        result.session.id,
        result.session.verdict_str(),
        result.session.agent_state.as_wire(),
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

/// One line per discovered harness; unknown future harness ids render
/// exactly as the service advertised them.
pub fn harness_catalog(catalog: &HarnessCatalog) -> String {
    if catalog.harnesses.is_empty() {
        return "No harnesses advertised by this service.".into();
    }
    catalog
        .harnesses
        .iter()
        .map(|entry| {
            let executable = entry.executable.as_deref().unwrap_or("-");
            format!(
                "{} [{}] {} -> {}",
                entry.harness_id, entry.availability, entry.display_name, executable
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
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
        let agent_state = if verdict == "exited" {
            "exited"
        } else {
            "unknown"
        };
        serde_json::from_value(json!({
            "id": "s1", "workspaceId": "w1", "hostId": "h1",
            "incarnation": "tok", "command": "sh", "args": ["-c", "echo hi"],
            "cols": 80, "rows": 24, "verdict": verdict,
            "exitCode": null, "createdAt": "2026-09-05T12:00:00Z",
            "agentState": agent_state, "agentStateAt": null
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
                "verdict": "live", "exitCode": null, "createdAt": "2026-09-05T12:00:00Z",
                "agentState": "unknown", "agentStateAt": null
            },
            "dataBase64": STANDARD.encode("héllo\n"),
            "startCursor": 0, "nextCursor": 7, "truncated": false
        }))
        .unwrap();
        let text = session_read(&read);
        assert!(text.starts_with("session s1 [live] agent=unknown cursor 0..7 truncated=false\n"));
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

    #[test]
    fn project_rendering_shows_kind_name_path_and_optional_base_ref() {
        let project: Project = serde_json::from_value(json!({
            "id": "p1", "hostId": "h1", "path": "/repo", "name": "repo",
            "kind": "git", "defaultBaseRef": "main"
        }))
        .unwrap();
        let added = project_added(&project);
        assert!(added.contains("p1"));
        assert!(added.contains("[git]"));
        assert!(added.contains("/repo"));
        assert!(added.contains("main"));

        let list = project_list(&ProjectList {
            projects: vec![project],
        });
        assert!(list.contains("\"repo\""));

        assert_eq!(
            project_list(&ProjectList { projects: vec![] }),
            "No projects registered."
        );
    }

    #[test]
    fn worktree_rendering_shows_dash_for_a_folder_projects_empty_branch_and_head() {
        let implicit: Worktree = serde_json::from_value(json!({
            "id": "p1", "projectId": "p1", "workspaceId": "ws1", "path": "/f",
            "branch": "", "head": "", "baseRef": null, "createdAt": "2026-09-05T12:00:00Z"
        }))
        .unwrap();
        let text = worktree_list(&WorktreeList {
            worktrees: vec![implicit],
        });
        assert!(text.contains("branch=- head=-"));

        let created: Worktree = serde_json::from_value(json!({
            "id": "w1", "projectId": "p1", "workspaceId": "ws2", "path": "/f/w1",
            "branch": "feature", "head": "abc123", "baseRef": "main",
            "createdAt": "2026-09-05T12:00:00Z"
        }))
        .unwrap();
        assert!(worktree_created(&created).contains("feature"));
        assert!(
            worktree_removed(&Removed {
                id: "w1".into(),
                removed: true
            })
            .contains("w1")
        );

        assert_eq!(
            worktree_list(&WorktreeList { worktrees: vec![] }),
            "No worktrees."
        );
    }
}

#[cfg(test)]
mod harness_output_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn catalog_renders_unknown_harness_ids_without_crashing() {
        let catalog: HarnessCatalog = serde_json::from_value(json!({
            "hostId": "host-1",
            "harnesses": [
                {"harnessId": "pi", "displayName": "Pi", "availability": "available",
                 "executable": "/opt/homebrew/bin/pi"},
                {"harnessId": "future-harness-9", "displayName": "Future",
                 "availability": "missing", "executable": null}
            ]
        }))
        .unwrap();
        let text = harness_catalog(&catalog);
        assert!(text.contains("pi [available] Pi -> /opt/homebrew/bin/pi"));
        assert!(
            text.contains("future-harness-9 [missing] Future -> -"),
            "unknown ids stay displayable: {text}"
        );
    }
}
