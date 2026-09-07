//! Command execution: builds protocol params, performs the round trip,
//! applies per-method invariant checks, renders once. This layer owns "one
//! JSON envelope stdout, no progress noise" and the request-id lifecycle: the
//! id is minted (or taken from `--request-id`) before any transport work so
//! every failure keeps it replayable.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

use crate::cli::{
    Cli, Command, HarnessAction, ProjectAction, TerminalAction, WorkspaceAction, WorktreeAction,
};
use crate::client::{
    CallOk, Client, HarnessCatalog, Project, ProjectList, ReadResult, Removed, Session,
    SessionList, StatusResult, Verdict, Workspace, WorkspaceList, Worktree, WorktreeList,
    WriteResult, check_harness_catalog, check_project, check_project_list, check_read,
    check_removed, check_session, check_session_list, check_status, check_workspace,
    check_workspace_list, check_worktree, check_worktree_list, check_write,
};
use crate::error::{CliError, method_not_found};
use crate::output;
use crate::paths;
use crate::transport::DEFAULT_TIMEOUT;

/// What one successful (RPC-level) invocation printed and how the process
/// should exit. Most commands exit 0; `terminal close` exits 1 when the
/// runtime could not confirm an exited session.
pub struct RunOutcome {
    pub stdout: String,
    pub exit_code: u8,
    /// Text-mode-only warning (e.g. close verdict not exited). JSON mode
    /// keeps stdout as the single parseable channel and stderr silent.
    pub stderr_note: Option<String>,
}

pub async fn run(cli: &Cli) -> Result<RunOutcome, CliError> {
    cli.validate()?;
    // Mint before anything else: every Local error from here on (including a
    // missing runtime) carries this id in its failure envelope.
    let request_id: String = match (&cli.request_id, &cli.retry_request) {
        (Some(id), _) => id.clone(),
        (None, Some(alias)) => alias.clone(),
        (None, None) => uuid::Uuid::new_v4().to_string(),
    };
    let data_dir = paths::resolve_data_dir(cli.data_dir.as_deref());
    let client = Client::open(&data_dir, &request_id)?;
    let json = cli.json;

    match &cli.command {
        Command::Status => {
            let call = client
                .call("status", json!({}), &request_id, DEFAULT_TIMEOUT)
                .await?;
            let status: StatusResult = Client::decode_checked(&call, "status", check_status)?;
            emit(call, json, || output::status_line(&status), 0, None)
        }
        Command::Workspace { action } => match action {
            WorkspaceAction::Add { path, name } => {
                let resolved = resolve_path_argument(path)?;
                let mut params = json!({ "path": resolved });
                if let Some(name) = name {
                    params["name"] = json!(name);
                }
                let call = client
                    .call("workspace.register", params, &request_id, DEFAULT_TIMEOUT)
                    .await?;
                let workspace: Workspace =
                    Client::decode_checked(&call, "workspace.register", check_workspace)?;
                emit(call, json, || output::workspace_added(&workspace), 0, None)
            }
            WorkspaceAction::List => {
                let call = client
                    .call("workspace.list", json!({}), &request_id, DEFAULT_TIMEOUT)
                    .await?;
                let list: WorkspaceList =
                    Client::decode_checked(&call, "workspace.list", check_workspace_list)?;
                emit(call, json, || output::workspace_list(&list), 0, None)
            }
        },
        Command::Project { action } => project(&client, &request_id, json, action).await,
        Command::Worktree { action } => worktree(&client, &request_id, json, action).await,
        Command::Terminal { action } => terminal(&client, &request_id, json, action).await,
        Command::Harness { action } => harness(&client, &request_id, json, action).await,
        Command::Orchestration { command } => {
            crate::orchestration_commands::run(&client, &request_id, json, command).await
        }
        Command::Rpc { method, params } => {
            let params: Value = match params {
                Some(text) => serde_json::from_str(text)
                    .map_err(|err| CliError::Usage(format!("--params is not valid JSON: {err}")))?,
                None => json!({}),
            };
            let call = client
                .call(method, params, &request_id, DEFAULT_TIMEOUT)
                .await?;
            // Diagnostic passthrough: the validated wire envelope is the output
            // in both modes; there is no human form and no invariant checks for
            // arbitrary methods.
            emit_raw(call)
        }
    }
}

async fn terminal(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &TerminalAction,
) -> Result<RunOutcome, CliError> {
    match action {
        TerminalAction::Create { workspace, command } => {
            let params = json!({
                "workspaceId": workspace,
                "command": command[0],
                "args": command[1..],
            });
            let call = client
                .call("session.start", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let session: Session = Client::decode_checked(&call, "session.start", check_session)?;
            emit(call, json, || output::session_started(&session), 0, None)
        }
        TerminalAction::List { workspace } => {
            let params = match workspace {
                Some(id) => json!({ "workspaceId": id }),
                None => json!({}),
            };
            let call = client
                .call("session.list", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let list: SessionList =
                Client::decode_checked(&call, "session.list", check_session_list)?;
            emit(call, json, || output::session_list(&list), 0, None)
        }
        TerminalAction::Read {
            session,
            incarnation,
            cursor,
            limit_bytes,
        } => {
            let mut params = json!({
                "sessionId": session,
                "incarnation": incarnation,
                "cursor": cursor.unwrap_or(0),
            });
            if let Some(limit) = limit_bytes {
                params["limitBytes"] = json!(limit);
            }
            let call = client
                .call("session.read", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let read: ReadResult = Client::decode_checked(&call, "session.read", check_read)?;
            emit(call, json, || output::session_read(&read), 0, None)
        }
        TerminalAction::Send {
            session,
            incarnation,
            text,
        } => {
            let sent_bytes = text.len() as u64;
            let params = json!({
                "sessionId": session,
                "incarnation": incarnation,
                // UTF-8 encoded once, here; never shell-interpolated anywhere.
                "dataBase64": STANDARD.encode(text.as_bytes()),
            });
            let call = client
                .call("session.write", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let write: WriteResult = Client::decode_checked(&call, "session.write", |result| {
                check_write(result, sent_bytes)
            })?;
            let session_id = session.clone();
            emit(
                call,
                json,
                || output::session_wrote(&write, &session_id),
                0,
                None,
            )
        }
        TerminalAction::Resize {
            session,
            incarnation,
            cols,
            rows,
        } => {
            let params = json!({
                "sessionId": session,
                "incarnation": incarnation,
                "cols": cols,
                "rows": rows,
            });
            let call = client
                .call("session.resize", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let session_value: Session =
                Client::decode_checked(&call, "session.resize", check_session)?;
            emit(
                call,
                json,
                || output::session_resized(&session_value),
                0,
                None,
            )
        }
        TerminalAction::Close {
            session,
            incarnation,
        } => {
            let params = json!({
                "sessionId": session,
                "incarnation": incarnation,
            });
            let call = client
                .call("session.stop", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let session_value: Session =
                Client::decode_checked(&call, "session.stop", check_session)?;
            // Only an observed exit is a successful close. A live or
            // unverifiable session keeps its rendered identity/context on
            // stdout but the invocation fails so callers notice.
            match session_value.verdict {
                Verdict::Exited => emit(
                    call,
                    json,
                    || output::session_closed(&session_value),
                    0,
                    None,
                ),
                Verdict::Live | Verdict::Unverifiable => {
                    let note = format!(
                        "warning: close did not confirm exit; session {} verdict is {}",
                        session_value.id,
                        session_value.verdict_str()
                    );
                    let stderr_note = if json { None } else { Some(note) };
                    emit(
                        call,
                        json,
                        || output::session_closed(&session_value),
                        1,
                        stderr_note,
                    )
                }
            }
        }
    }
}

async fn project(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &ProjectAction,
) -> Result<RunOutcome, CliError> {
    match action {
        ProjectAction::Add { path, name } => {
            let resolved = resolve_path_argument(path)?;
            let mut params = json!({ "path": resolved });
            if let Some(name) = name {
                params["name"] = json!(name);
            }
            let call = client
                .call("project.add", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let project: Project = Client::decode_checked(&call, "project.add", check_project)?;
            emit(call, json, || output::project_added(&project), 0, None)
        }
        ProjectAction::List => {
            let call = client
                .call("project.list", json!({}), request_id, DEFAULT_TIMEOUT)
                .await?;
            let list: ProjectList =
                Client::decode_checked(&call, "project.list", check_project_list)?;
            emit(call, json, || output::project_list(&list), 0, None)
        }
    }
}

async fn worktree(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &WorktreeAction,
) -> Result<RunOutcome, CliError> {
    match action {
        WorktreeAction::Create {
            project,
            name,
            base,
        } => {
            let mut params = json!({ "projectId": project, "name": name });
            if let Some(base) = base {
                params["baseRef"] = json!(base);
            }
            let call = client
                .call("worktree.create", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let worktree: Worktree =
                Client::decode_checked(&call, "worktree.create", check_worktree)?;
            emit(call, json, || output::worktree_created(&worktree), 0, None)
        }
        WorktreeAction::List { project } => {
            let params = json!({ "projectId": project });
            let call = client
                .call("worktree.list", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let list: WorktreeList =
                Client::decode_checked(&call, "worktree.list", check_worktree_list)?;
            emit(call, json, || output::worktree_list(&list), 0, None)
        }
        WorktreeAction::Rm { id, force } => {
            let params = json!({ "id": id, "force": force });
            let call = client
                .call("worktree.remove", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let requested_id = id.clone();
            let removed: Removed = Client::decode_checked(&call, "worktree.remove", |removed| {
                check_removed(removed, &requested_id)
            })?;
            emit(call, json, || output::worktree_removed(&removed), 0, None)
        }
    }
}

/// Relative workspace paths are resolved against the CLI process's own cwd
/// before the RPC, and any path that is not valid UTF-8 is a usage error
/// instead of a lossy mangled string on the wire.
fn resolve_path_argument(path: &Path) -> Result<String, CliError> {
    let raw = path
        .to_str()
        .ok_or_else(|| CliError::Usage("workspace path must be valid UTF-8".into()))?;
    if raw.is_empty() {
        return Err(CliError::Usage("workspace add requires a PATH".into()));
    }
    let candidate = Path::new(raw);
    let absolute: PathBuf = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        let cwd = std::env::current_dir().map_err(|err| {
            CliError::Usage(format!(
                "cannot resolve relative path against the current directory: {err}"
            ))
        })?;
        cwd.join(candidate)
    };
    absolute
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| CliError::Usage("workspace path must be valid UTF-8".into()))
}

/// Harness commands negotiate the service capability first: a read-only
/// `status` preflight (its own request id) decides whether the optional
/// method may be sent at all. Every failure — transport, preflight, or
/// capability missing — is re-keyed onto the operation's request id so a
/// caller-supplied `--request-id` stays replayable. There is never a
/// shell/harness/model fallback.
async fn harness(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &HarnessAction,
) -> Result<RunOutcome, CliError> {
    let required_capability = match action {
        HarnessAction::List => "harness.catalog.v1",
        HarnessAction::Start { .. } => "harness.launch.v1",
    };
    let status = capability_preflight(client, request_id, required_capability).await?;
    match action {
        HarnessAction::List => {
            let call = client
                .call("harness.list", json!({}), request_id, DEFAULT_TIMEOUT)
                .await?;
            let catalog: HarnessCatalog =
                Client::decode_checked(&call, "harness.list", |catalog| {
                    check_harness_catalog(catalog, &status.host_id)
                })?;
            emit(call, json, || output::harness_catalog(&catalog), 0, None)
        }
        HarnessAction::Start {
            workspace,
            harness,
            model,
            provider,
            effort,
            prompt,
            permission_mode,
        } => {
            let mut params = json!({
                "workspaceId": workspace,
                "harnessId": harness,
                "permissionMode": permission_mode.as_wire(),
            });
            for (field, value) in [
                ("model", model),
                ("provider", provider),
                ("effort", effort),
                ("prompt", prompt),
            ] {
                if let Some(value) = value {
                    // Literal one-JSON-string forwarding; no shell, no
                    // @-expansion, no rewriting of any kind.
                    params[field] = json!(value);
                }
            }
            let call = client
                .call("harness.start", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let requested_workspace = workspace.clone();
            let host_id = status.host_id.clone();
            let session: Session = Client::decode_checked(&call, "harness.start", |session| {
                check_session(session)?;
                if session.workspace_id != requested_workspace {
                    return Err(format!(
                        "session workspaceId {:?} does not match the requested workspace {:?}",
                        session.workspace_id, requested_workspace
                    ));
                }
                if session.host_id != host_id {
                    return Err(format!(
                        "session hostId {:?} does not match the service host identity {:?}",
                        session.host_id, host_id
                    ));
                }
                Ok(())
            })?;
            emit(call, json, || output::session_started(&session), 0, None)
        }
    }
}

/// Read-only status negotiation. The preflight request id is distinct from
/// the operation's; any failure is re-keyed onto the operation id.
async fn capability_preflight(
    client: &Client,
    operation_request_id: &str,
    required_capability: &str,
) -> Result<StatusResult, CliError> {
    let preflight_request_id = uuid::Uuid::new_v4().to_string();
    let call = client
        .call("status", json!({}), &preflight_request_id, DEFAULT_TIMEOUT)
        .await
        .map_err(|err| err.retaining_request_id(operation_request_id))?;
    let status: StatusResult = Client::decode_checked(&call, "status", check_status)
        .map_err(|err| err.retaining_request_id(operation_request_id))?;
    if !status
        .capabilities
        .iter()
        .any(|cap| cap == required_capability)
    {
        return Err(CliError::local(
            method_not_found(format!(
                "this Drogon service does not advertise {required_capability}; \
                 update the Drogon service on the execution host to a version with harness support"
            )),
            operation_request_id,
        ));
    }
    Ok(status)
}

/// Success: human text or the raw validated envelope, exactly one stdout
/// payload either way, plus an optional exit-code override for semantics the
/// RPC layer cannot express (close verdicts).
fn emit(
    call: CallOk,
    json: bool,
    human: impl FnOnce() -> String,
    exit_code: u8,
    stderr_note: Option<String>,
) -> Result<RunOutcome, CliError> {
    if json {
        let outcome = emit_raw(call)?;
        Ok(RunOutcome {
            stdout: outcome.stdout,
            exit_code,
            stderr_note,
        })
    } else {
        Ok(RunOutcome {
            stdout: human(),
            exit_code,
            stderr_note,
        })
    }
}

fn emit_raw(call: CallOk) -> Result<RunOutcome, CliError> {
    let stdout = serde_json::to_string_pretty(&call.raw).map_err(|err| {
        CliError::local(
            crate::error::internal_error(format!("cannot encode response: {err}")),
            call.request_id,
        )
    })?;
    Ok(RunOutcome {
        stdout,
        exit_code: 0,
        stderr_note: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_paths_pass_through_verbatim() {
        assert_eq!(
            resolve_path_argument(Path::new("/tmp/dir with spaces")).unwrap(),
            "/tmp/dir with spaces"
        );
    }

    #[test]
    fn relative_paths_join_the_process_cwd() {
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(
            resolve_path_argument(Path::new("folder/sub")).unwrap(),
            cwd.join("folder/sub").to_string_lossy()
        );
    }

    #[cfg(unix)]
    #[test]
    fn invalid_utf8_paths_are_usage_errors_not_replacements() {
        use std::os::unix::ffi::OsStrExt;
        let bad = std::ffi::OsStr::from_bytes(b"/tmp/\xff\xfe");
        let err = resolve_path_argument(Path::new(bad)).unwrap_err();
        assert!(matches!(err, CliError::Usage(_)));
        assert!(
            !err.to_string().contains('\u{FFFD}'),
            "no lossy replacement"
        );
    }
}
