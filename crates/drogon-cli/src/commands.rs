//! Command execution: builds protocol params, performs the round trip,
//! applies per-method invariant checks, renders once. This layer owns one JSON
//! output without progress noise (ask uses the source's bare object) and the request-id lifecycle: the
//! id is minted (or taken from `--request-id`) before any transport work so
//! every failure keeps it replayable.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

use crate::cli::{
    AutomationAction, BrowserAction, Cli, Command, HarnessAction, InternalAction, ProjectAction,
    TerminalAction, WaitFor, WorkspaceAction, WorktreeAction,
};
use crate::client::{
    AgentState, AutomationHistory, AutomationList, AutomationRunNow, AutomationSummary,
    BrowserSnapshot, BrowserTab, BrowserTabsList, CallOk, Client, HarnessCatalog, Project,
    ProjectList, ReadResult, Removed, Session, SessionList, StatusResult, Verdict, Workspace,
    WorkspaceList, Worktree, WorktreeEnvelope, WorktreeList, WriteResult, check_automation,
    check_automation_history, check_automation_list, check_automation_run_now,
    check_browser_snapshot, check_browser_tab, check_browser_tabs, check_harness_catalog,
    check_project, check_project_list, check_read, check_removed, check_session, check_status,
    check_workspace, check_workspace_list, check_worktree, check_worktree_list, check_write,
    partition_session_list,
};
use crate::error::{CliError, method_not_found, timeout};
use crate::output;
use crate::paths;
use crate::skills;
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
    let json = cli.json;
    // Skill guides and the agent command schema are bundled with the
    // binary: they never touch the runtime, so they work with no daemon
    // and no data directory at all.
    if let Command::Skills { action } = &cli.command {
        return skills::run(&request_id, json, action);
    }
    if let Command::AgentContext = &cli.command {
        return crate::agent_context::run(&request_id, json);
    }
    // The retired coordinator verbs never contact the runtime: they report
    // the migration guidance locally even when no daemon is listening. This
    // must run before Client::open, which fails hard on a missing runtime.
    if let Command::Orchestration { command } = &cli.command
        && matches!(
            &**command,
            crate::orchestration_cli::OrchestrationCommand::CoordinatorStart { .. }
                | crate::orchestration_cli::OrchestrationCommand::CoordinatorStop
        )
    {
        return crate::orchestration_commands::retired_coordinator_result(&request_id, json);
    }
    let client = Client::open(&data_dir, &request_id)?;

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
        Command::Browser { action } => browser(&client, &request_id, json, action).await,
        Command::Harness { action } => harness(&client, &request_id, json, action).await,
        Command::Automation { action } => automation(&client, &request_id, json, action).await,
        Command::Orchestration { command } => {
            crate::orchestration_commands::run(&client, &request_id, json, command).await
        }
        // Served locally above without a runtime; these arms are unreachable
        // (output.rs `render` uses the same convention for impossible pairs).
        Command::Skills { .. } => {
            unreachable!("skills commands are served locally before the client opens")
        }
        Command::AgentContext => {
            unreachable!("agent-context is served locally before the client opens")
        }
        Command::Internal { action } => internal(&client, &request_id, json, action).await,
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
            let mut params = json!({
                "workspaceId": workspace,
                "command": command[0],
                "args": command[1..],
            });
            // Issue #359: a terminal created by a harness/agent inside a
            // session carries the PTY's exported DROGON_SESSION_ID, exactly
            // like the fork's env-inherited pane identity — the daemon
            // records it as the parent session so the sidebar nests the
            // new row under its spawner. Outside a session the variable is
            // absent and the terminal is parentless.
            if let Ok(parent) = std::env::var("DROGON_SESSION_ID")
                && !parent.is_empty()
            {
                params["parentSessionId"] = json!(parent);
            }
            let call = client
                .call("session.start", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let session: Session = Client::decode_checked(&call, "session.start", check_session)?;
            emit(call, json, || output::session_started(&session), 0, None)
        }
        TerminalAction::List { workspace, limit } => {
            let params = match workspace {
                Some(id) => json!({ "workspaceId": id }),
                None => json!({}),
            };
            let call = client
                .call("session.list", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            // One bad record must never fail the whole list (#222): keep
            // the records that satisfy the session invariants, warn once
            // per rejected record on stderr, and still exit 0. In JSON
            // mode stdout carries the validated records only, never the
            // rejected ones.
            let list: SessionList = Client::decode(&call, "session.list")?;
            let (sessions, warnings) = partition_session_list(list);
            // Source `--limit` caps the returned inventory after filtering.
            let sessions = match limit {
                Some(cap) => sessions
                    .into_iter()
                    .take((*cap).min(usize::MAX as u64) as usize)
                    .collect(),
                None => sessions,
            };
            let list = SessionList { sessions };
            let stderr_note = if warnings.is_empty() {
                None
            } else {
                Some(warnings.join("\n"))
            };
            // --limit changes the payload, so JSON output must be rebuilt
            // from the capped list even when there were no warnings.
            if json && (stderr_note.is_some() || limit.is_some()) {
                let mut filtered = call.raw.clone();
                filtered["result"]["sessions"] =
                    serde_json::to_value(&list.sessions).map_err(|err| {
                        CliError::local(
                            crate::error::internal_error(format!("cannot encode response: {err}")),
                            &call.request_id,
                        )
                    })?;
                let call = CallOk {
                    request_id: call.request_id,
                    raw: filtered,
                    result: call.result,
                };
                emit(call, json, || output::session_list(&list), 0, stderr_note)
            } else {
                emit(call, json, || output::session_list(&list), 0, stderr_note)
            }
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
            enter,
            interrupt,
        } => {
            // Source `terminal send` composes the exact byte stream: typed
            // text, then a carriage return when --enter, or just the
            // interrupt byte (Ctrl-C, 0x03) when --interrupt. No shell
            // interpolation anywhere; UTF-8 encoded once.
            let mut bytes = text.clone().unwrap_or_default().into_bytes();
            if *enter {
                bytes.push(b'\r');
            }
            if *interrupt {
                bytes.push(0x03);
            }
            let sent_bytes = bytes.len() as u64;
            let params = json!({
                "sessionId": session,
                "incarnation": incarnation,
                "dataBase64": STANDARD.encode(&bytes),
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
        TerminalAction::Wait {
            session,
            incarnation,
            r#for,
            timeout_ms,
        } => {
            terminal_wait(
                client,
                request_id,
                json,
                session,
                incarnation,
                *r#for,
                *timeout_ms,
            )
            .await
        }
        TerminalAction::Close {
            session,
            incarnation,
        } => {
            let params = json!({
                "sessionId": session,
                "incarnation": incarnation,
            });
            // `session.close` (R16-AL2, #228) stops a live PTY and then
            // forgets the durable record, so a close clears every kind of
            // row — including a post-restart `unverifiable` stub, which
            // `session.stop` could only report about. The returned verdict
            // stays honest (`unverifiable` when exit was never observed),
            // but the close itself was accepted: the record is gone, so
            // the command succeeds and prints the verdict for the record.
            let call = client
                .call("session.close", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let session_value: Session =
                Client::decode_checked(&call, "session.close", check_session)?;
            emit(
                call,
                json,
                || output::session_closed(&session_value),
                0,
                None,
            )
        }
    }
}

/// Client-side wait over the existing `session.read`: no new RPC was added
/// for this. Each poll reads from cursor 0; success returns the satisfying
/// read's envelope (JSON mode) or a one-line summary (human mode) with exit
/// 0. Budget exhaustion is exit 1 with a `timeout` reason naming the last
/// observed state, never a guess about what happened after the deadline.
async fn terminal_wait(
    client: &Client,
    request_id: &str,
    json: bool,
    session: &str,
    incarnation: &str,
    wait_for: WaitFor,
    timeout_ms: u64,
) -> Result<RunOutcome, CliError> {
    use std::time::{Duration, Instant};

    let budget = Duration::from_millis(timeout_ms);
    let start = Instant::now();
    let deadline = start + budget;
    let mut polls: u32 = 0;
    let mut attempts: u32 = 0;
    let mut last_state = String::from("no successful poll yet");
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let remaining = deadline - now;
        let params = json!({
            "sessionId": session,
            "incarnation": incarnation,
            "cursor": 0,
        });
        // One poll never outlives the remaining budget: a hung RPC costs at
        // most the rest of the wait, and the loop still reports `timeout`.
        let call_timeout = remaining.min(DEFAULT_TIMEOUT);
        match client
            .call("session.read", params, request_id, call_timeout)
            .await
        {
            Ok(call) => {
                let read: ReadResult = Client::decode_checked(&call, "session.read", check_read)?;
                polls += 1;
                if wait_satisfied(&read, wait_for) {
                    let elapsed_ms = start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
                    let condition = wait_for.as_wire();
                    return emit(
                        call,
                        json,
                        || output::session_waited(&read, condition, polls, elapsed_ms),
                        0,
                        None,
                    );
                }
                last_state = format!(
                    "verdict is {} agent={}",
                    read.session.verdict_str(),
                    read.session.agent_state.as_wire()
                );
            }
            // Authoritative refusals (unknown session, stale incarnation):
            // repolling cannot change the answer, so fail fast.
            Err(err @ CliError::Server { .. }) => return Err(err),
            // Transport loss never proves exit (or idleness, or output):
            // keep polling inside the budget and report `timeout` if nothing
            // recovers. Malformed service results land here too; a service
            // that stays malformed times out rather than guessing.
            Err(err) => {
                last_state = format!("last poll failed: {}", err.rpc_error().message);
            }
        }
        attempts += 1;
        // Bounded backoff: 50ms doubling to a 500ms cap, clipped to the
        // remaining budget so the loop cannot sleep past its deadline.
        let backoff_ms = 50u64.saturating_mul(1u64 << attempts.min(4)).min(500);
        let sleep = Duration::from_millis(backoff_ms)
            .min(deadline.saturating_duration_since(Instant::now()));
        if !sleep.is_zero() {
            tokio::time::sleep(sleep).await;
        }
    }
    Err(CliError::local(
        timeout(format!(
            "terminal wait timed out after {timeout_ms}ms waiting for {} on session {session}; {last_state}",
            wait_for.as_wire(),
        )),
        request_id,
    ))
}

fn wait_satisfied(read: &ReadResult, wait_for: WaitFor) -> bool {
    match wait_for {
        WaitFor::Exited => read.session.verdict == Verdict::Exited,
        // An exited session will never work again, so it satisfies an
        // idleness wait; the success line still reports the verdict.
        WaitFor::Idle => matches!(
            read.session.agent_state,
            AgentState::Idle | AgentState::Exited
        ),
        WaitFor::Output => read.next_cursor > read.start_cursor,
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
        ProjectAction::Remove { id } => {
            let params = json!({ "id": id });
            let call = client
                .call("project.remove", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let requested_id = id.clone();
            let removed: Removed = Client::decode_checked(&call, "project.remove", |removed| {
                check_removed(removed, &requested_id)
            })?;
            emit(call, json, || output::project_removed(&removed), 0, None)
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
        WorktreeAction::Show { id } => {
            let call = client
                .call(
                    "worktree.get",
                    json!({ "id": id }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let envelope: WorktreeEnvelope =
                Client::decode_checked(&call, "worktree.get", |env: &WorktreeEnvelope| {
                    check_worktree(&env.worktree)
                })?;
            emit(
                call,
                json,
                || output::worktree_created(&envelope.worktree),
                0,
                None,
            )
        }
        WorktreeAction::Current => {
            let cwd = std::env::current_dir().map_err(|err| {
                CliError::local(
                    crate::error::internal_error(format!(
                        "cannot read the current directory: {err}"
                    )),
                    request_id,
                )
            })?;
            let path = cwd.to_str().ok_or_else(|| {
                CliError::local(
                    crate::error::invalid_argument("current directory is not valid UTF-8"),
                    request_id,
                )
            })?;
            let call = client
                .call(
                    "worktree.current",
                    json!({ "path": path }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let envelope: WorktreeEnvelope =
                Client::decode_checked(&call, "worktree.current", |env: &WorktreeEnvelope| {
                    check_worktree(&env.worktree)
                })?;
            emit(
                call,
                json,
                || output::worktree_created(&envelope.worktree),
                0,
                None,
            )
        }
        WorktreeAction::Create {
            project,
            name,
            base,
        } => {
            // Real, durable creation provenance (Workspace Options "Hide:
            // CLI-created"): every worktree this command creates really was
            // created via `drogon-cli worktree create`, so it is always
            // tagged -- never left to default/guess like the desktop app's
            // own create path, which sends no `creator` at all.
            let mut params = json!({ "projectId": project, "name": name, "creator": "cli" });
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
    let status = capability_preflight(client, request_id, required_capability, "harness").await?;
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
            // Issue #359: same env-inherited parent record as
            // `terminal create` — a harness launched from inside a session
            // nests under that session in the sidebar.
            if let Ok(parent) = std::env::var("DROGON_SESSION_ID")
                && !parent.is_empty()
            {
                params["parentSessionId"] = json!(parent);
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

/// Automation commands negotiate the service capability first, like the
/// harness commands: no automation method is sent to a service that does
/// not advertise automation.v1.
async fn automation(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &AutomationAction,
) -> Result<RunOutcome, CliError> {
    capability_preflight(client, request_id, "automation.v1", "automation").await?;
    match action {
        AutomationAction::Create {
            name,
            cron,
            workspace,
            harness,
            prompt,
            disabled,
            grace_minutes,
        } => {
            let mut params = json!({
                "name": name,
                "cron": cron,
                "workspaceId": workspace,
                "harness": harness,
                "prompt": prompt,
                "enabled": !disabled,
            });
            if let Some(grace) = grace_minutes {
                params["graceMinutes"] = json!(grace);
            }
            let call = client
                .call("automation.create", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let summary: AutomationSummary =
                Client::decode_checked(&call, "automation.create", check_automation)?;
            emit(call, json, || output::automation_created(&summary), 0, None)
        }
        AutomationAction::List => {
            let call = client
                .call("automation.list", json!({}), request_id, DEFAULT_TIMEOUT)
                .await?;
            let list: AutomationList =
                Client::decode_checked(&call, "automation.list", check_automation_list)?;
            emit(call, json, || output::automation_list(&list), 0, None)
        }
        AutomationAction::Run { id } => {
            let call = client
                .call(
                    "automation.run_now",
                    json!({ "id": id }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let run: AutomationRunNow =
                Client::decode_checked(&call, "automation.run_now", check_automation_run_now)?;
            emit(call, json, || output::automation_run_now(&run), 0, None)
        }
        AutomationAction::History { id, limit } => {
            let mut params = json!({ "automationId": id });
            if let Some(limit) = limit {
                params["limit"] = json!(limit);
            }
            let call = client
                .call("automation.history", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let history: AutomationHistory =
                Client::decode_checked(&call, "automation.history", check_automation_history)?;
            let automation_id = id.clone();
            emit(
                call,
                json,
                || output::automation_history(&history, &automation_id),
                0,
                None,
            )
        }
    }
}

/// Hidden service-internal callbacks (no capability preflight: the daemon
/// either knows `session.hook_event` or returns `method_not_found`, which is
/// itself the correct signal).
async fn internal(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &InternalAction,
) -> Result<RunOutcome, CliError> {
    match action {
        InternalAction::HookEvent {
            session,
            incarnation,
            event,
        } => {
            // Capture only the bounded prompt preview from hook JSON stdin;
            // session identity remains in the managed command arguments.
            let prompt_preview = read_hook_prompt_preview();
            let params = json!({
                "promptPreview": prompt_preview,
                "sessionId": session,
                "incarnation": incarnation,
                "event": event,
            });
            let call = client
                .call("session.hook_event", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let updated: Session =
                Client::decode_checked(&call, "session.hook_event", check_session)?;
            emit(call, json, || output::session_hook_event(&updated), 0, None)
        }
    }
}

/// Read bounded hook JSON without hanging the agent on an open stdin pipe.
/// Only the first prompt preview is forwarded; the CLI exits the drain thread.
fn read_hook_prompt_preview() -> Option<String> {
    use std::io::{IsTerminal as _, Read as _};
    if std::io::stdin().is_terminal() {
        return None;
    }
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::stdin().lock().take(65_537).read_to_end(&mut bytes);
        let preview = hook_prompt_preview(&bytes);
        let _ = send.send(preview);
    });
    receive
        .recv_timeout(std::time::Duration::from_millis(100))
        .ok()
        .flatten()
}

fn hook_prompt_preview(bytes: &[u8]) -> Option<String> {
    if bytes.len() > 65_536 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    value
        .get("prompt")
        .or_else(|| value.get("user_prompt"))
        .and_then(|value| value.as_str())
        .map(|prompt| prompt.chars().take(512).collect())
}

/// Read-only status negotiation. The preflight request id is distinct from
/// the operation's; any failure is re-keyed onto the operation id.
async fn capability_preflight(
    client: &Client,
    operation_request_id: &str,
    required_capability: &str,
    feature: &str,
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
                 update the Drogon service on the execution host to a version with {feature} support"
            )),
            operation_request_id,
        ));
    }
    Ok(status)
}

/// Browser pane control through the daemon's desktop command relay. One
/// invocation enqueues exactly one relay command; the daemon holds the call
/// (bounded by `--timeout-ms`) until the connected desktop executes it. With
/// no desktop connected the service answers `desktop_not_connected` and the
/// CLI surfaces it unchanged (exit 1).
async fn browser(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &BrowserAction,
) -> Result<RunOutcome, CliError> {
    capability_preflight(client, request_id, "browser.relay.v1", "browser").await?;
    let (method, params) = match action {
        BrowserAction::Open {
            workspace,
            url,
            timeout_ms,
        } => (
            "browser.open",
            json!({"workspaceId": workspace, "url": url, "timeoutMs": timeout_ms}),
        ),
        BrowserAction::Navigate {
            tab,
            url,
            timeout_ms,
        } => (
            "browser.navigate",
            json!({"tabId": tab, "url": url, "timeoutMs": timeout_ms}),
        ),
        BrowserAction::Snapshot { tab, timeout_ms } => (
            "browser.snapshot",
            json!({"tabId": tab, "timeoutMs": timeout_ms}),
        ),
        BrowserAction::Click {
            tab,
            selector,
            timeout_ms,
        } => (
            "browser.click",
            json!({"tabId": tab, "selector": selector, "timeoutMs": timeout_ms}),
        ),
        BrowserAction::Fill {
            tab,
            selector,
            text,
            timeout_ms,
        } => (
            "browser.fill",
            json!({"tabId": tab, "selector": selector, "text": text, "timeoutMs": timeout_ms}),
        ),
        BrowserAction::Tabs {
            workspace,
            timeout_ms,
        } => (
            "browser.tabs",
            json!({"workspaceId": workspace, "timeoutMs": timeout_ms}),
        ),
    };
    // The relay hold is server-side and bounded by timeoutMs; the transport
    // budget stays the fixed default, which always covers the CLI's own
    // 1..=25000ms validation range.
    let call = client
        .call(method, params, request_id, DEFAULT_TIMEOUT)
        .await?;
    match action {
        BrowserAction::Open { .. } | BrowserAction::Navigate { .. } => {
            let tab: BrowserTab = Client::decode_checked(&call, method, check_browser_tab)?;
            emit(call, json, || output::browser_tab(method, &tab), 0, None)
        }
        BrowserAction::Click { .. } | BrowserAction::Fill { .. } => {
            let tab: BrowserTab = Client::decode_checked(&call, method, check_browser_tab)?;
            emit(call, json, || output::browser_acted(method, &tab), 0, None)
        }
        BrowserAction::Snapshot { .. } => {
            let snapshot: BrowserSnapshot =
                Client::decode_checked(&call, method, check_browser_snapshot)?;
            emit(call, json, || output::browser_snapshot(&snapshot), 0, None)
        }
        BrowserAction::Tabs { .. } => {
            let list: BrowserTabsList = Client::decode_checked(&call, method, check_browser_tabs)?;
            emit(call, json, || output::browser_tabs(&list), 0, None)
        }
    }
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
    fn hook_previews_are_bounded_and_ignore_non_prompt_payloads() {
        assert_eq!(
            hook_prompt_preview(br#"{"prompt":"hello","transcript_path":"ignored"}"#).as_deref(),
            Some("hello")
        );
        assert_eq!(
            hook_prompt_preview(br#"{"user_prompt":"fallback"}"#).as_deref(),
            Some("fallback")
        );
        assert_eq!(hook_prompt_preview(b"not json"), None);
        assert_eq!(hook_prompt_preview(&vec![b' '; 65_537]), None);
        let long = serde_json::to_vec(&json!({"prompt": "🦀".repeat(600)})).unwrap();
        assert_eq!(hook_prompt_preview(&long).unwrap().chars().count(), 512);
    }

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
