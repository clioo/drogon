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
    AutomationAction, BotAction, BrowserAction, Cli, Command, GraphAction, HarnessAction,
    InternalAction, MentuAction, ProjectAction, SecretsAction, TerminalAction, WaitFor,
    WorkspaceAction, WorktreeAction,
};
use crate::client::{
    AgentState, AutomationHistory, AutomationList, AutomationRunNow, AutomationSummary,
    BrowserSnapshot, BrowserTab, BrowserTabsList, CallOk, Client, HarnessCatalog, MentuOpenResult,
    MentuPendingApprovalResult, MentuRecipesResult, MentuRun, MentuRunResult, MentuRunStatus,
    MentuRunsResult, MentuRuntimeInfo, MentuRuntimeResult, Project, ProjectList, ReadResult,
    Removed, Session, SessionList, StatusResult, Verdict, Workspace, WorkspaceList, Worktree,
    WorktreeList, WriteResult, check_automation, check_automation_history, check_automation_list,
    check_automation_run_now, check_browser_snapshot, check_browser_tab, check_browser_tabs,
    check_harness_catalog, check_mentu_open, check_mentu_pending_approval, check_mentu_recipes,
    check_mentu_run, check_mentu_run_result, check_mentu_runs, check_mentu_runtime, check_project,
    check_project_list, check_read, check_removed, check_session, check_status, check_workspace,
    check_workspace_list, check_worktree, check_worktree_list, check_write, partition_session_list,
};
use crate::error::{CliError, mentu_approval_required, method_not_found, timeout};
use crate::output;
use crate::paths;
use crate::skills;
use crate::transport::DEFAULT_TIMEOUT;
use drogon_protocol::graph::{
    GraphNodeStateResult, GraphResult, GraphResumeResult, GraphRunResult,
};

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
        Command::Mentu { action } => mentu(&client, &request_id, json, action).await,
        Command::Graph { action } => graph(&client, &request_id, json, action).await,
        Command::Harness { action } => harness(&client, &request_id, json, action).await,
        Command::Automation { action } => automation(&client, &request_id, json, action).await,
        Command::Bot { action } => match action {
            // User-only secret-grant verbs: no Bot-actor scope is asserted
            // anywhere on this surface, and they preflight their own
            // capability (bot.secrets.v1), so they skip the bot.self.v1
            // preflight in `bot()`.
            BotAction::GrantSecret { .. }
            | BotAction::RevokeSecret { .. }
            | BotAction::ListGrants { .. } => {
                bot_secret_grants(&client, &request_id, json, action).await
            }
            other => bot(&client, &request_id, json, other).await,
        },
        Command::Secrets { action } => secrets(&client, &request_id, json, action).await,
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
        TerminalAction::List { workspace } => {
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
            let list = SessionList { sessions };
            let stderr_note = if warnings.is_empty() {
                None
            } else {
                Some(warnings.join("\n"))
            };
            if json && stderr_note.is_some() {
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

/// Mentu (journey J9). `status` answers, honestly, whether the OPTIONAL
/// Mentu environment is really installed on this host — the pinned runtime's
/// presence and lock verdict plus (with `--workspace`) the workspace's own
/// recipe inventory — so an agent never promises a recipe on a host that
/// cannot run or even show one. `open` drives the desktop relay so a Bot can
/// hand the human the Mentu tab it just wrote a recipe into.
async fn mentu(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &MentuAction,
) -> Result<RunOutcome, CliError> {
    match action {
        MentuAction::Status { workspace } => {
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            let runtime_call = client
                .call("mentu.runtime", json!({}), request_id, DEFAULT_TIMEOUT)
                .await?;
            let runtime: MentuRuntimeResult =
                Client::decode_checked(&runtime_call, "mentu.runtime", check_mentu_runtime)?;
            // Only a workspace-scoped run can say anything about recipes; no
            // workspace means the recipe half is reported as unknown, never
            // as zero recipes.
            let (last_call, recipes) = match workspace {
                Some(workspace_id) => {
                    let call = client
                        .call(
                            "mentu.recipes",
                            json!({ "workspaceId": workspace_id }),
                            request_id,
                            DEFAULT_TIMEOUT,
                        )
                        .await?;
                    let decoded: MentuRecipesResult =
                        Client::decode_checked(&call, "mentu.recipes", check_mentu_recipes)?;
                    (call, Some(decoded))
                }
                None => (runtime_call, None),
            };
            let report =
                mentu_environment(&runtime.runtime, workspace.as_deref(), recipes.as_ref());
            if json {
                // One envelope either way: the last call's own header
                // (protocol/requestId) with the combined verdict as its
                // result, so an agent parses the same shape as every other
                // verb instead of a bespoke document.
                let mut raw = last_call.raw.clone();
                if let Some(map) = raw.as_object_mut() {
                    map.insert("result".into(), report.clone());
                }
                let stdout = serde_json::to_string_pretty(&raw).map_err(|err| {
                    CliError::local(
                        crate::error::internal_error(format!("cannot encode response: {err}")),
                        request_id.to_string(),
                    )
                })?;
                Ok(RunOutcome {
                    stdout,
                    exit_code: 0,
                    stderr_note: None,
                })
            } else {
                Ok(RunOutcome {
                    stdout: output::mentu_environment(&report),
                    exit_code: 0,
                    stderr_note: None,
                })
            }
        }
        MentuAction::Open {
            workspace,
            recipe,
            timeout_ms,
        } => {
            // Both halves are required: mentu.v1 for a tab that can show
            // anything, browser.relay.v1 for the transport that reaches the
            // desktop. Without the desktop the call fails
            // `desktop_not_connected` inside its own timeout.
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            capability_preflight(client, request_id, "browser.relay.v1", "the desktop relay")
                .await?;
            let mut params = json!({ "workspaceId": workspace, "timeoutMs": timeout_ms });
            if let Some(recipe) = recipe {
                params["recipeId"] = json!(recipe);
            }
            let call = client
                .call("mentu.open", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let opened: MentuOpenResult =
                Client::decode_checked(&call, "mentu.open", check_mentu_open)?;
            emit(call, json, || output::mentu_opened(&opened), 0, None)
        }
        MentuAction::Run {
            workspace,
            recipe,
            approval,
            follow,
            timeout_ms,
        } => {
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            let approval = match approval {
                Some(approval_id) => approval_id.clone(),
                None => resolve_pending_approval(client, request_id, workspace, recipe).await?,
            };
            // The daemon re-validates the approval (workspace/recipe match,
            // unconsumed, content hash still equals the recipe on disk) and
            // runs the exact approved bytes through the same `mentu.run`
            // path the desktop button uses. This CLI adds no engine.
            let call = client
                .call(
                    "mentu.run",
                    json!({
                        "workspaceId": workspace,
                        "recipeId": recipe,
                        "approvalId": approval,
                    }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let started: MentuRunResult =
                Client::decode_checked(&call, "mentu.run", check_mentu_run_result)?;
            if !follow {
                return emit(
                    call,
                    json,
                    || output::mentu_run_started(&started.run),
                    0,
                    None,
                );
            }
            mentu_follow(client, request_id, json, call, started.run, *timeout_ms).await
        }
        MentuAction::RunStatus { run } => {
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            let call = client
                .call(
                    "mentu.run_status",
                    json!({ "runId": run }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let decoded: MentuRunResult =
                Client::decode_checked(&call, "mentu.run_status", check_mentu_run_result)?;
            let exit_code = mentu_exit_code(decoded.run.status);
            emit(
                call,
                json,
                || output::mentu_run_status(&decoded.run),
                exit_code,
                None,
            )
        }
        MentuAction::Runs { workspace, limit } => {
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            let mut params = json!({ "workspaceId": workspace });
            if let Some(limit) = limit {
                params["limit"] = json!(limit);
            }
            let call = client
                .call("mentu.runs", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let runs: MentuRunsResult =
                Client::decode_checked(&call, "mentu.runs", check_mentu_runs)?;
            emit(call, json, || output::mentu_run_list(&runs), 0, None)
        }
        MentuAction::Cancel { run } => {
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            let call = client
                .call(
                    "mentu.cancel",
                    json!({ "runId": run }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let cancelled: crate::client::MentuCancelResult = Client::decode_checked(
                &call,
                "mentu.cancel",
                |result: &crate::client::MentuCancelResult| check_mentu_run(&result.run),
            )?;
            emit(
                call,
                json,
                || output::mentu_cancel_requested(&cancelled.run),
                0,
                None,
            )
        }
        MentuAction::Resume {
            run,
            follow,
            timeout_ms,
        } => {
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            // The runtime's own `resume`: rerun only the steps that did not
            // succeed. `mentu.retry` is that verb (kept for the panel).
            let call = client
                .call(
                    "mentu.retry",
                    json!({ "runId": run }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let started: MentuRunResult =
                Client::decode_checked(&call, "mentu.retry", check_mentu_run_result)?;
            if !follow {
                return emit(
                    call,
                    json,
                    || output::mentu_run_started(&started.run),
                    0,
                    None,
                );
            }
            mentu_follow(client, request_id, json, call, started.run, *timeout_ms).await
        }
        MentuAction::RetryStep {
            run,
            step,
            follow,
            timeout_ms,
        } => {
            capability_preflight(client, request_id, "mentu.v1", "Mentu").await?;
            let call = client
                .call(
                    "mentu.retry_step",
                    json!({ "runId": run, "step": step }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let started: MentuRunResult =
                Client::decode_checked(&call, "mentu.retry_step", check_mentu_run_result)?;
            if !follow {
                return emit(
                    call,
                    json,
                    || output::mentu_run_started(&started.run),
                    0,
                    None,
                );
            }
            mentu_follow(client, request_id, json, call, started.run, *timeout_ms).await
        }
    }
}

/// The work graph: `graph.read`/`graph.node_state`/`graph.compile` are
/// read-only, `graph.run`/`graph.resume_node`/`graph.retry_step` mutate.
/// Everything here goes through the daemon; this CLI adds no engine and
/// never compiles a recipe itself.
async fn graph(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &GraphAction,
) -> Result<RunOutcome, CliError> {
    match action {
        GraphAction::Read { workspace } => {
            capability_preflight(client, request_id, "graph.v1", "the work graph").await?;
            let call = client
                .call(
                    "graph.read",
                    json!({ "workspaceId": workspace }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let decoded: GraphResult = Client::decode(&call, "graph.read")?;
            emit(call, json, || output::graph_read(&decoded.graph), 0, None)
        }
        GraphAction::NodeState { workspace, node } => {
            capability_preflight(client, request_id, "graph.v1", "the work graph").await?;
            let call = client
                .call(
                    "graph.node_state",
                    json!({ "workspaceId": workspace, "nodeId": node }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let decoded: GraphNodeStateResult = Client::decode(&call, "graph.node_state")?;
            emit(
                call,
                json,
                || output::graph_node_state(&decoded.state),
                0,
                None,
            )
        }
        GraphAction::WriteIntent { workspace, file } => {
            capability_preflight(client, request_id, "graph.v1", "the work graph").await?;
            let intent = read_intent(request_id, file)?;
            let call = client
                .call(
                    "graph.write_intent",
                    json!({ "workspaceId": workspace, "intent": intent }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let decoded: GraphResult = Client::decode(&call, "graph.write_intent")?;
            emit(call, json, || output::graph_read(&decoded.graph), 0, None)
        }
        GraphAction::Compile {
            workspace,
            node,
            nodes,
            output: out_path,
        } => {
            capability_preflight(client, request_id, "graph.v1", "the work graph").await?;
            let call = client
                .call(
                    "graph.compile",
                    compile_params(workspace, node, nodes),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let compiled: drogon_protocol::graph::GraphCompileResult =
                Client::decode(&call, "graph.compile")?;
            if let Some(path) = out_path {
                let source = serde_json::to_string_pretty(&compiled.recipe).map_err(|err| {
                    CliError::local(
                        crate::error::internal_error(format!("cannot encode recipe: {err}")),
                        request_id.to_string(),
                    )
                })?;
                std::fs::write(path, source).map_err(|err| {
                    CliError::local(
                        crate::error::internal_error(format!(
                            "cannot write {}: {err}",
                            path.display()
                        )),
                        request_id.to_string(),
                    )
                })?;
            }
            emit(call, json, || output::graph_compiled(&compiled), 0, None)
        }
        GraphAction::Run {
            workspace,
            node,
            follow,
            timeout_ms,
        } => {
            capability_preflight(client, request_id, "graph.v1", "the work graph").await?;
            let call = client
                .call(
                    "graph.run",
                    json!({ "workspaceId": workspace, "nodeId": node }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let started: GraphRunResult = Client::decode(&call, "graph.run")?;
            if !follow {
                let run = to_client_run(started.run, request_id)?;
                return emit(
                    call,
                    json,
                    || output::graph_run_started(&started.compile, &run),
                    0,
                    None,
                );
            }
            let run = to_client_run(started.run, request_id)?;
            mentu_follow(client, request_id, json, call, run, *timeout_ms).await
        }
        GraphAction::Resume {
            workspace,
            node,
            follow,
            timeout_ms,
        } => {
            capability_preflight(client, request_id, "graph.v1", "the work graph").await?;
            let call = client
                .call(
                    "graph.resume_node",
                    json!({ "workspaceId": workspace, "nodeId": node }),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let resumed: GraphResumeResult = Client::decode(&call, "graph.resume_node")?;
            let run = to_client_run(resumed.run, request_id)?;
            if !follow {
                return emit(call, json, || output::mentu_run_started(&run), 0, None);
            }
            mentu_follow(client, request_id, json, call, run, *timeout_ms).await
        }
        GraphAction::RetryStep {
            workspace,
            node,
            step,
            follow,
            timeout_ms,
        } => {
            capability_preflight(client, request_id, "graph.v1", "the work graph").await?;
            let mut params = json!({ "workspaceId": workspace, "nodeId": node });
            if let Some(step) = step {
                params["step"] = json!(step);
            }
            let call = client
                .call("graph.retry_step", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let resumed: GraphResumeResult = Client::decode(&call, "graph.retry_step")?;
            let run = to_client_run(resumed.run, request_id)?;
            if !follow {
                return emit(call, json, || output::mentu_run_started(&run), 0, None);
            }
            mentu_follow(client, request_id, json, call, run, *timeout_ms).await
        }
    }
}

/// Rebuilds the CLI's own `MentuRun` view from a protocol `MentuRun` (the
/// graph results carry the daemon's protocol type). The wire spellings are
/// identical, so this is a strict round trip; a mismatch is a protocol bug,
/// never guessed at.
fn to_client_run(
    run: drogon_protocol::mentu::MentuRun,
    request_id: &str,
) -> Result<MentuRun, CliError> {
    let value = serde_json::to_value(run).map_err(|err| {
        CliError::local(
            crate::error::internal_error(format!("cannot encode run: {err}")),
            request_id.to_string(),
        )
    })?;
    serde_json::from_value(value).map_err(|err| {
        CliError::local(
            crate::error::internal_error(format!("cannot decode run: {err}")),
            request_id.to_string(),
        )
    })
}

fn compile_params(workspace: &str, node: &Option<String>, nodes: &Option<String>) -> Value {
    let mut params = json!({ "workspaceId": workspace });
    if let Some(node) = node {
        params["nodeId"] = json!(node);
    }
    if let Some(nodes) = nodes {
        let ids: Vec<&str> = nodes
            .split(',')
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .collect();
        params["nodeIds"] = json!(ids);
    }
    params
}

/// Reads a graph intent JSON document from a path or stdin (`-`). The bytes
/// are validated by the daemon, not here.
fn read_intent(request_id: &str, file: &str) -> Result<Value, CliError> {
    let text = if file == "-" {
        let mut buffer = String::new();
        use std::io::Read as _;
        std::io::stdin()
            .read_to_string(&mut buffer)
            .map_err(|err| {
                CliError::local(
                    crate::error::internal_error(format!("cannot read stdin: {err}")),
                    request_id.to_string(),
                )
            })?;
        buffer
    } else {
        std::fs::read_to_string(file).map_err(|err| {
            CliError::local(
                crate::error::internal_error(format!("cannot read {file}: {err}")),
                request_id.to_string(),
            )
        })?
    };
    serde_json::from_str(&text).map_err(|err| {
        CliError::local(
            crate::error::invalid_argument(format!("intent is not valid JSON: {err}")),
            request_id.to_string(),
        )
    })
}

/// Resolves the recipe's pending approval, or refuses.
///
/// `mentu run` must never approve: an edited recipe has no pending approval,
/// so this returns an explicit `mentu_approval_required` refusal that names
/// the workspace and recipe instead of minting consent the human never gave.
async fn resolve_pending_approval(
    client: &Client,
    request_id: &str,
    workspace: &str,
    recipe: &str,
) -> Result<String, CliError> {
    let call = client
        .call(
            "mentu.pending_approval",
            json!({ "workspaceId": workspace, "recipeId": recipe }),
            request_id,
            DEFAULT_TIMEOUT,
        )
        .await?;
    let pending: MentuPendingApprovalResult = Client::decode_checked(
        &call,
        "mentu.pending_approval",
        check_mentu_pending_approval,
    )?;
    match pending.approval {
        Some(approval) => Ok(approval.id),
        None => Err(CliError::local(
            mentu_approval_required(output::mentu_approval_required(workspace, recipe)),
            request_id,
        )),
    }
}

/// A run's exit code in this CLI's vocabulary: 0 only for a run that
/// actually succeeded (or is still running), 1 for every settled failure —
/// an agent can branch on the exit status without parsing prose.
fn mentu_exit_code(status: MentuRunStatus) -> u8 {
    match status {
        MentuRunStatus::Succeeded | MentuRunStatus::Running => 0,
        MentuRunStatus::Failed | MentuRunStatus::Cancelled | MentuRunStatus::Unavailable => 1,
    }
}

/// `mentu run --follow`: client-side polling over `mentu.run_status`, the
/// same shape `terminal wait` uses over `session.read`. The final state's
/// own envelope is what JSON mode prints, so the caller gets the last
/// observed run rather than the stale `running` row from the start call.
/// Budget exhaustion is an explicit `timeout` failure naming the last
/// observed status — never a claim about what happened after the deadline.
async fn mentu_follow(
    client: &Client,
    request_id: &str,
    json: bool,
    started: CallOk,
    initial: MentuRun,
    timeout_ms: u64,
) -> Result<RunOutcome, CliError> {
    use std::time::{Duration, Instant};

    const POLL_INTERVAL: Duration = Duration::from_millis(750);

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut run = initial;
    let mut last_call = started;
    let mut transitions = vec![output::mentu_status_change(&run)];
    while !run.status.is_terminal() {
        let now = Instant::now();
        if now >= deadline {
            return Err(CliError::local(
                timeout(format!(
                    "mentu run {} did not settle within {timeout_ms}ms; last observed status {}",
                    run.id,
                    run.status.as_wire()
                )),
                request_id,
            ));
        }
        let sleep = POLL_INTERVAL.min(deadline.saturating_duration_since(now));
        tokio::time::sleep(sleep).await;
        let call = client
            .call(
                "mentu.run_status",
                json!({ "runId": run.id }),
                request_id,
                DEFAULT_TIMEOUT,
            )
            .await?;
        let decoded: MentuRunResult =
            Client::decode_checked(&call, "mentu.run_status", check_mentu_run_result)?;
        let next = decoded.run;
        if next.status != run.status || next.steps.len() != run.steps.len() {
            transitions.push(output::mentu_status_change(&next));
        }
        run = next;
        last_call = call;
    }
    let exit_code = mentu_exit_code(run.status);
    let stderr_note = match run.status {
        MentuRunStatus::Succeeded | MentuRunStatus::Running => None,
        _ => Some(format!(
            "mentu run {} finished as {}; inspect `mentu run-status --run {}` for the failing step.",
            run.id,
            run.status.as_wire(),
            run.id
        )),
    };
    emit(
        last_call,
        json,
        || {
            transitions.push(output::mentu_run_status(&run));
            transitions.join("\n")
        },
        exit_code,
        stderr_note,
    )
}

/// The honest verdict vocabulary for `mentu status`. `installed` requires
/// the bytes AND the lock verdict AND a real `--version` answer;
/// `not_installed` is the absence of any runtime at the resolved path;
/// `partially_available` is a runtime that exists but is not the approved
/// one (wrong bytes, or a binary that will not answer `--version`).
fn mentu_runtime_verdict(runtime: &MentuRuntimeInfo) -> (&'static str, String) {
    if runtime.actual_sha256.is_none() {
        return (
            "not_installed",
            runtime
                .message
                .clone()
                .unwrap_or_else(|| "No Mentu runtime is installed for this data directory.".into()),
        );
    }
    if !runtime.available || !runtime.lock_matches {
        return (
            "partially_available",
            runtime.message.clone().unwrap_or_else(|| {
                "A Mentu runtime exists but does not match the approved runtime lock.".into()
            }),
        );
    }
    match runtime.version.as_deref() {
        Some(version) if !version.trim().is_empty() => (
            "installed",
            format!(
                "Mentu runtime {version} is installed and matches the approved lock (revision {}).",
                runtime.expected_revision
            ),
        ),
        // Bytes match but the binary would not report a version: do not
        // claim a full install on evidence this host never produced.
        _ => (
            "partially_available",
            "The Mentu runtime matches the approved lock but did not answer --version.".into(),
        ),
    }
}

/// Combined `mentu status` result: the runtime verdict, plus the workspace's
/// recipe inventory when one was asked for.
fn mentu_environment(
    runtime: &MentuRuntimeInfo,
    workspace: Option<&str>,
    recipes: Option<&MentuRecipesResult>,
) -> serde_json::Value {
    let (verdict, summary) = mentu_runtime_verdict(runtime);
    let inventory = recipes.map(|result| {
        let valid = result.recipes.iter().filter(|recipe| recipe.valid).count();
        let invalid: Vec<serde_json::Value> = result
            .recipes
            .iter()
            .filter(|recipe| !recipe.valid)
            .map(|recipe| {
                json!({
                    "id": recipe.id,
                    "issue": recipe.issue,
                })
            })
            .collect();
        json!({
            "total": result.recipes.len(),
            "valid": valid,
            "invalid": invalid,
        })
    });
    let summary = match (&inventory, workspace) {
        (Some(inventory), Some(workspace)) => format!(
            "{summary} Workspace {workspace} exposes {} recipe(s), {} valid.",
            inventory["total"].as_u64().unwrap_or(0),
            inventory["valid"].as_u64().unwrap_or(0),
        ),
        _ => summary,
    };
    json!({
        "verdict": verdict,
        "summary": summary,
        "runtime": serde_json::to_value(runtime).unwrap_or(serde_json::Value::Null),
        "workspace": workspace.map(|id| json!({
            "id": id,
            "recipes": inventory,
        })),
    })
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

/// Scoped Bot self-management: every call asserts actor == target (the
/// service denies cross-Bot scope, stale revisions and scope escape) and
/// preflights the `bot.self.v1` capability first, like the harness and
/// automation commands.
async fn bot(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &BotAction,
) -> Result<RunOutcome, CliError> {
    let status = capability_preflight(client, request_id, "bot.self.v1", "bot").await?;
    let scope = |bot: &str, workspace: &str| {
        json!({
            "botId": bot,
            "actorBotId": bot,
            "workspaceId": workspace,
            "hostId": status.host_id,
        })
    };
    match action {
        BotAction::Provision { bot, workspace } => {
            let call = client
                .call(
                    "bot.self_provision",
                    scope(bot, workspace),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(call, json, || format!("provisioned bot {bot}"), 0, None)
        }
        BotAction::List { bot, workspace } => {
            let call = client
                .call(
                    "bot.self_list",
                    scope(bot, workspace),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    format!(
                        "bot {bot}: {} automations, {} monitors, audit {}",
                        result
                            .get("automations")
                            .and_then(|v| v.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0),
                        result
                            .get("monitors")
                            .and_then(|v| v.as_array())
                            .map(|a| a.len())
                            .unwrap_or(0),
                        result
                            .get("auditCount")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0),
                    )
                },
                0,
                None,
            )
        }
        BotAction::CreateAutomation {
            bot,
            workspace,
            name,
            schedule,
            prompt,
            disabled,
        } => {
            let mut params = scope(bot, workspace);
            params["name"] = json!(name);
            params["schedule"] = json!(schedule);
            params["prompt"] = json!(prompt);
            if *disabled {
                params["enabled"] = json!(false);
            }
            let call = client
                .call(
                    "bot.self_create_automation",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    format!(
                        "created automation {}",
                        result
                            .get("automationId")
                            .and_then(|v| v.as_str())
                            .unwrap_or("?")
                    )
                },
                0,
                None,
            )
        }
        BotAction::UpdateAutomation {
            bot,
            workspace,
            responsibility,
            expected_bot_rev,
            name,
            prompt,
            schedule,
        } => {
            let mut params = scope(bot, workspace);
            params["responsibilityId"] = json!(responsibility);
            params["expectedBotRev"] = json!(expected_bot_rev);
            if let Some(name) = name {
                params["name"] = json!(name);
            }
            if let Some(prompt) = prompt {
                params["prompt"] = json!(prompt);
            }
            if let Some(schedule) = schedule {
                params["schedule"] = json!(schedule);
            }
            let call = client
                .call(
                    "bot.self_update_automation",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(
                call,
                json,
                || format!("updated automation {responsibility}"),
                0,
                None,
            )
        }
        BotAction::EnableAutomation {
            bot,
            workspace,
            responsibility,
            expected_bot_rev,
        }
        | BotAction::DisableAutomation {
            bot,
            workspace,
            responsibility,
            expected_bot_rev,
        } => {
            let enabled = matches!(action, BotAction::EnableAutomation { .. });
            let mut params = scope(bot, workspace);
            params["responsibilityId"] = json!(responsibility);
            params["expectedBotRev"] = json!(expected_bot_rev);
            params["enabled"] = json!(enabled);
            let call = client
                .call(
                    "bot.self_set_automation_enabled",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(
                call,
                json,
                || {
                    format!(
                        "{} automation {responsibility}",
                        if enabled { "enabled" } else { "disabled" }
                    )
                },
                0,
                None,
            )
        }
        BotAction::DeleteAutomation {
            bot,
            workspace,
            responsibility,
        } => {
            let mut params = scope(bot, workspace);
            params["responsibilityId"] = json!(responsibility);
            let call = client
                .call(
                    "bot.self_delete_automation",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(
                call,
                json,
                || format!("deleted automation {responsibility}"),
                0,
                None,
            )
        }
        BotAction::TestAutomation {
            bot,
            workspace,
            responsibility,
        } => {
            let mut params = scope(bot, workspace);
            params["responsibilityId"] = json!(responsibility);
            let call = client
                .call(
                    "bot.self_test_automation",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    format!(
                        "automation {responsibility} eligible: {}",
                        result
                            .get("eligible")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                    )
                },
                0,
                None,
            )
        }
        BotAction::CreateMonitor {
            bot,
            workspace,
            resource,
            max_bytes,
            cron,
            manual,
            disabled,
            responsibility_id,
            responsibility_name,
            instructions,
        } => {
            let mut params = scope(bot, workspace);
            params["resource"] = json!(resource);
            if let Some(max_bytes) = max_bytes {
                params["maxBytes"] = json!(max_bytes);
            }
            params["trigger"] = if *manual {
                json!({"kind": "manual"})
            } else {
                json!({"kind": "scheduled", "cron": cron.as_deref().unwrap_or("* * * * *")})
            };
            if *disabled {
                params["enabled"] = json!(false);
            }
            // The action this monitor releases when it fires: bind an
            // existing reactive responsibility, or mint one from a name.
            if let Some(id) = responsibility_id {
                params["responsibilityId"] = json!(id);
            }
            if let Some(name) = responsibility_name {
                params["responsibilityName"] = json!(name);
            }
            if let Some(text) = instructions {
                params["instructions"] = json!(text);
            }
            let call = client
                .call(
                    "bot.self_create_monitor",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    let monitor = result
                        .get("monitorId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("?");
                    match result.get("responsibilityId").and_then(|v| v.as_str()) {
                        Some(resp) => format!("created monitor {monitor}, action bound to {resp}"),
                        None => format!("created monitor {monitor} (observes only)"),
                    }
                },
                0,
                None,
            )
        }
        BotAction::BindMonitor {
            bot,
            workspace,
            monitor,
            expected_rev,
            responsibility_id,
            responsibility_name,
            instructions,
        } => {
            let mut params = scope(bot, workspace);
            params["monitorId"] = json!(monitor);
            params["expectedRev"] = json!(expected_rev);
            if let Some(id) = responsibility_id {
                params["responsibilityId"] = json!(id);
            }
            if let Some(name) = responsibility_name {
                params["responsibilityName"] = json!(name);
            }
            if let Some(text) = instructions {
                params["instructions"] = json!(text);
            }
            let call = client
                .call(
                    "bot.self_bind_monitor_action",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    let resp = result
                        .get("responsibilityId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("?");
                    format!("monitor {monitor} now releases {resp} when it fires")
                },
                0,
                None,
            )
        }
        BotAction::UpdateMonitor {
            bot,
            workspace,
            monitor,
            expected_rev,
            resource,
            max_bytes,
            cron,
            manual,
        } => {
            let mut params = scope(bot, workspace);
            params["monitorId"] = json!(monitor);
            params["expectedRev"] = json!(expected_rev);
            if let Some(resource) = resource {
                params["resource"] = json!(resource);
            }
            if let Some(max_bytes) = max_bytes {
                params["maxBytes"] = json!(max_bytes);
            }
            if *manual {
                params["trigger"] = json!({"kind": "manual"});
            } else if let Some(cron) = cron {
                params["trigger"] = json!({"kind": "scheduled", "cron": cron});
            }
            let call = client
                .call(
                    "bot.self_update_monitor",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(call, json, || format!("updated monitor {monitor}"), 0, None)
        }
        BotAction::EnableMonitor {
            bot,
            workspace,
            monitor,
            expected_rev,
        }
        | BotAction::DisableMonitor {
            bot,
            workspace,
            monitor,
            expected_rev,
        } => {
            let enabled = matches!(action, BotAction::EnableMonitor { .. });
            let mut params = scope(bot, workspace);
            params["monitorId"] = json!(monitor);
            params["expectedRev"] = json!(expected_rev);
            params["enabled"] = json!(enabled);
            let call = client
                .call(
                    "bot.self_set_monitor_enabled",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(
                call,
                json,
                || {
                    format!(
                        "{} monitor {monitor}",
                        if enabled { "enabled" } else { "disabled" }
                    )
                },
                0,
                None,
            )
        }
        BotAction::DeleteMonitor {
            bot,
            workspace,
            monitor,
        } => {
            let mut params = scope(bot, workspace);
            params["monitorId"] = json!(monitor);
            let call = client
                .call(
                    "bot.self_delete_monitor",
                    params,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(call, json, || format!("deleted monitor {monitor}"), 0, None)
        }
        BotAction::TestMonitor {
            bot,
            workspace,
            monitor,
        } => {
            let mut params = scope(bot, workspace);
            params["monitorId"] = json!(monitor);
            let call = client
                .call("bot.self_test_monitor", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    format!(
                        "monitor {monitor} eligible: {} ({})",
                        result
                            .get("eligible")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                        result.get("health").and_then(|v| v.as_str()).unwrap_or("?"),
                    )
                },
                0,
                None,
            )
        }
        // Grant verbs preflight bot.secrets.v1 in `bot_secret_grants`
        // (routed there from run()); they never carry a Bot-actor scope.
        BotAction::GrantSecret { .. } | BotAction::RevokeSecret { .. }
        | BotAction::ListGrants { .. } => Err(CliError::Usage(
            "bot grant-secret/revoke-secret/list-grants are user-only verbs without a Bot-actor scope".into(),
        )),
    }
}

/// User-only per-Bot secret grants (P0): NO Bot-actor scope is asserted
/// anywhere on this surface, so there is no Bot self-grant path, and every
/// call preflights the `bot.secrets.v1` capability. Grant and revoke are
/// audited server-side with the granting user named; revocation takes
/// effect on the Bot's NEXT monitor tick.
async fn bot_secret_grants(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &BotAction,
) -> Result<RunOutcome, CliError> {
    let status = capability_preflight(client, request_id, "bot.secrets.v1", "bot").await?;
    let scope = |bot: &str, workspace: &str| {
        json!({
            "botId": bot,
            "workspaceId": workspace,
            "hostId": status.host_id,
        })
    };
    match action {
        BotAction::GrantSecret {
            bot,
            workspace,
            secret_ref,
            kind,
            granted_by,
        } => {
            let mut params = scope(bot, workspace);
            params["secretRef"] = json!(secret_ref);
            params["kind"] = json!(kind);
            if let Some(user) = granted_by {
                params["grantedBy"] = json!(user);
            }
            let call = client
                .call("bot.grant_secret", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            emit(
                call,
                json,
                || {
                    format!(
                        "granted {kind}/{secret_ref} to bot {bot}{}",
                        granted_by
                            .as_deref()
                            .map(|user| format!(" (by {user})"))
                            .unwrap_or_default()
                    )
                },
                0,
                None,
            )
        }
        BotAction::RevokeSecret {
            bot,
            workspace,
            secret_ref,
            granted_by,
        } => {
            let mut params = scope(bot, workspace);
            params["secretRef"] = json!(secret_ref);
            if let Some(user) = granted_by {
                params["grantedBy"] = json!(user);
            }
            let call = client
                .call("bot.revoke_secret", params, request_id, DEFAULT_TIMEOUT)
                .await?;
            emit(
                call,
                json,
                || {
                    format!(
                        "revoked {secret_ref} from bot {bot} (next tick refuses){}",
                        granted_by
                            .as_deref()
                            .map(|user| format!(" (by {user})"))
                            .unwrap_or_default()
                    )
                },
                0,
                None,
            )
        }
        BotAction::ListGrants { bot, workspace } => {
            let call = client
                .call(
                    "bot.list_secret_grants",
                    scope(bot, workspace),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    let grants = result
                        .get("grants")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    format!("bot {bot}: {grants} secret grant(s)")
                },
                0,
                None,
            )
        }
        _ => Err(CliError::Usage(
            "only bot grant-secret / revoke-secret / list-grants reach this path".into(),
        )),
    }
}

/// User-only sealed integration-secret store (P0): `set` reads the value
/// from STDIN (never argv, so `ps` and shell history never see it), seals
/// it server-side into the 0600 store, and the value is never echoed back
/// or persisted outside the sealed file. Granting a name to a Bot is
/// `bot grant-secret`.
async fn secrets(
    client: &Client,
    request_id: &str,
    json: bool,
    action: &SecretsAction,
) -> Result<RunOutcome, CliError> {
    let _status = capability_preflight(client, request_id, "bot.secrets.v1", "secrets").await?;
    match action {
        SecretsAction::Set { kind, name } => {
            use std::io::Read as _;
            let mut raw = Vec::new();
            std::io::stdin()
                .read_to_end(&mut raw)
                .map_err(|e| CliError::Usage(format!("cannot read value from stdin: {e}")))?;
            // Trim exactly one trailing newline (and CRLF); any other byte
            // is part of the value.
            let mut value = raw;
            if value.last() == Some(&b'\n') {
                value.pop();
                if value.last() == Some(&b'\r') {
                    value.pop();
                }
            }
            if value.is_empty() {
                return Err(CliError::Usage(
                    "empty stdin: pipe the secret value into `secrets set`".into(),
                ));
            }
            let value = String::from_utf8(value)
                .map_err(|_| CliError::Usage("secret value must be UTF-8".into()))?;
            let call = client
                .call(
                    "secrets.set",
                    json!({"kind": kind, "name": name, "value": value}),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(
                call,
                json,
                || format!("sealed {kind}/{name} (value never echoed)"),
                0,
                None,
            )
        }
        SecretsAction::List { kind } => {
            let call = client
                .call(
                    "secrets.list",
                    json!({"kind": kind}),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result = call.result.clone();
            emit(
                call,
                json,
                || {
                    let names = result
                        .get("names")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    format!("{kind}: {names} configured secret name(s)")
                },
                0,
                None,
            )
        }
        SecretsAction::Delete { kind, name } => {
            let call = client
                .call(
                    "secrets.delete",
                    json!({"kind": kind, "name": name}),
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            emit(call, json, || format!("deleted {kind}/{name}"), 0, None)
        }
    }
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
