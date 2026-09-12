//! Human rendering. `--json` never goes through here: it prints the raw
//! validated response envelope. Output must never include the auth token.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::client::{
    AutomationHistory, AutomationList, AutomationRunNow, AutomationSummary, BrowserSnapshot,
    BrowserTab, BrowserTabsList, HarnessCatalog, MeetingAnalysis, MeetingCommitment,
    MeetingCommitmentPage, MeetingList, MeetingRead, MeetingSuggestion, MeetingTranscript,
    MentuApproval, MentuOpenResult, MentuRun, MentuRunsResult, MentuStepRun, MethodResult, Project,
    ProjectList, ReadResult, Removed, Session, SessionList, StatusResult, Workspace, WorkspaceList,
    Worktree, WorktreeList, WriteResult,
};
use drogon_protocol::graph::{
    Graph, GraphCompileResult, GraphFailoverAttemptRecord, GraphNodeState, GraphRuntimeRef,
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
        "Created worktree {} for project {} workspace={} on branch {} -> {} (head {})",
        worktree.id,
        worktree.project_id,
        worktree.workspace_id,
        worktree.branch,
        worktree.path,
        worktree.head
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

pub fn project_removed(removed: &Removed) -> String {
    format!("Removed project {}.", removed.id)
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

pub fn session_hook_event(session: &Session) -> String {
    format!(
        "Session {} agent={}",
        session.id,
        session.agent_state.as_wire()
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

/// Human `terminal wait` success: the satisfied condition plus where the
/// session stands, so callers can tell an idle satisfaction from an exit.
pub fn session_waited(result: &ReadResult, wait_for: &str, polls: u32, elapsed_ms: u64) -> String {
    format!(
        "Wait satisfied for {} [{}] agent={} for={} after {}ms ({} polls) cursor {}..{}.",
        result.session.id,
        result.session.verdict_str(),
        result.session.agent_state.as_wire(),
        wait_for,
        elapsed_ms,
        polls,
        result.start_cursor,
        result.next_cursor
    )
}

pub fn session_closed(session: &Session) -> String {
    let exit = session
        .exit_code
        .map(|code| format!(" exit={code}"))
        .unwrap_or_default();
    format!("Closed {} [{}].{}", session.id, session.verdict_str(), exit)
}

/// Millisecond-epoch engine times as UTC wall time. Non-finite or negative
/// inputs render as `-` rather than a fabricated date.
pub fn format_unix_ms(ms: f64) -> String {
    if !ms.is_finite() || ms < 0.0 {
        return "-".to_string();
    }
    let secs = (ms / 1000.0).floor() as u64;
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (y, mo, d) = civil_from_days(days);
    format!(
        "{y:04}-{mo:02}-{d:02} {:02}:{:02}:{:02} UTC",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y } as u64, m, d)
}

fn automation_line(summary: &AutomationSummary) -> String {
    let last = summary
        .last_run
        .as_ref()
        .map(|run| run.status.clone())
        .unwrap_or_else(|| "never".to_string());
    format!(
        "{} \"{}\" [{}] cron \"{}\" workspace {} next {} last {} ({})",
        summary.id,
        summary.name,
        summary.harness,
        summary.cron,
        summary.workspace_id.as_deref().unwrap_or("-"),
        format_unix_ms(summary.next_run_at),
        last,
        if summary.enabled {
            "enabled"
        } else {
            "disabled"
        },
    )
}

pub fn automation_created(summary: &AutomationSummary) -> String {
    format!("Created automation {}", automation_line(summary))
}

pub fn automation_list(list: &AutomationList) -> String {
    if list.automations.is_empty() {
        return "No automations.".into();
    }
    list.automations
        .iter()
        .map(automation_line)
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn automation_run_now(result: &AutomationRunNow) -> String {
    match result.outcome.as_str() {
        "refused" => format!(
            "Automation {} refused: {} (recorded as {})",
            result.automation_id,
            result.refusal.as_deref().unwrap_or("refused"),
            result.run_id.as_deref().unwrap_or("-"),
        ),
        _ => format!(
            "Ran automation {} run {} status {}",
            result.automation_id,
            result.run_id.as_deref().unwrap_or("-"),
            result.status.as_deref().unwrap_or("-"),
        ),
    }
}

pub fn automation_history(history: &AutomationHistory, automation_id: &str) -> String {
    if history.runs.is_empty() {
        return format!("No runs recorded for automation {automation_id}.");
    }
    history
        .runs
        .iter()
        .map(|run| {
            let detail = run
                .error
                .clone()
                .or_else(|| run.exit_code.map(|code| format!("exit={code}")))
                .unwrap_or_default();
            format!(
                "{} [{}] {} scheduled {} created {}{}",
                run.id,
                run.trigger,
                run.status,
                format_unix_ms(run.scheduled_for),
                format_unix_ms(run.created_at),
                if detail.is_empty() {
                    String::new()
                } else {
                    format!(" {detail}")
                },
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn browser_tab_line(tab: &BrowserTab) -> String {
    let state = if tab.loading { "loading" } else { "ready" };
    let error = tab
        .error
        .as_deref()
        .map(|message| format!(" error={message:?}"))
        .unwrap_or_default();
    format!(
        "{} ws={} {} {:?} [{}]{}",
        tab.tab_id, tab.workspace_id, tab.url, tab.title, state, error
    )
}

/// Human `browser open` / `browser navigate`: the verb names the relayed
/// action so `open` and `navigate` stay distinguishable in transcripts.
pub fn browser_tab(method: &str, tab: &BrowserTab) -> String {
    let verb = if method == "browser.open" {
        "Opened"
    } else {
        "Navigated"
    };
    format!("{} {}.", verb, browser_tab_line(tab))
}

/// Human `browser click` / `browser fill`: the tab state after the guest
/// interaction, so the caller sees where the pane stands.
pub fn browser_acted(method: &str, tab: &BrowserTab) -> String {
    let verb = if method == "browser.click" {
        "Clicked"
    } else {
        "Filled"
    };
    format!("{} {}.", verb, browser_tab_line(tab))
}

/// Human `browser snapshot`: identity header plus the bounded DOM text.
/// `--json` preserves the wire fields untouched.
pub fn browser_snapshot(snapshot: &BrowserSnapshot) -> String {
    let header = format!(
        "tab {} {} {:?} truncated={}",
        snapshot.tab_id, snapshot.url, snapshot.title, snapshot.truncated
    );
    if snapshot.text.is_empty() {
        header
    } else {
        format!("{header}\n{}", snapshot.text)
    }
}

pub fn browser_tabs(list: &BrowserTabsList) -> String {
    if list.tabs.is_empty() {
        return "No browser tabs open.".into();
    }
    list.tabs
        .iter()
        .map(browser_tab_line)
        .collect::<Vec<_>>()
        .join("\n")
}

/// `mentu status` in human form. The verdict is the first word on purpose:
/// an agent (or a human skimming) must not have to infer "is Mentu really
/// installed here" from the rest of the report.
pub fn mentu_environment(report: &serde_json::Value) -> String {
    let verdict = report["verdict"].as_str().unwrap_or("unknown");
    let mut lines = vec![format!("Mentu environment: {verdict}",)];
    if let Some(summary) = report["summary"].as_str() {
        lines.push(summary.to_string());
    }
    if let Some(runtime) = report["runtime"].as_object() {
        let path = runtime["path"].as_str().unwrap_or("-");
        let version = runtime["version"].as_str().unwrap_or("-");
        let actual = runtime["actualSha256"].as_str().unwrap_or("-");
        lines.push(format!("runtime: {path}"));
        lines.push(format!("version: {version}"));
        lines.push(format!(
            "lock: expected {} got {}",
            runtime["expectedSha256"].as_str().unwrap_or("-"),
            actual
        ));
    }
    if let Some(workspace) = report["workspace"].as_object() {
        lines.push(format!(
            "workspace: {}",
            workspace["id"].as_str().unwrap_or("-")
        ));
        let recipes = workspace["recipes"].as_object();
        lines.push(match recipes {
            Some(recipes) => format!(
                "recipes: {} total, {} valid",
                recipes["total"].as_u64().unwrap_or(0),
                recipes["valid"].as_u64().unwrap_or(0)
            ),
            None => "recipes: unknown".into(),
        });
        if let Some(invalid) = recipes.and_then(|recipes| recipes["invalid"].as_array()) {
            for entry in invalid {
                lines.push(format!(
                    "  invalid {}: {}",
                    entry["id"].as_str().unwrap_or("-"),
                    entry["issue"].as_str().unwrap_or("no issue reported")
                ));
            }
        }
    }
    lines.join("\n")
}

/// `mentu open`: the desktop confirmed the tab, so say exactly that much.
pub fn mentu_opened(result: &MentuOpenResult) -> String {
    match &result.recipe_id {
        Some(recipe) => format!(
            "Opened the Work Graph tab for workspace {} focused on recipe {recipe}.",
            result.workspace_id
        ),
        None => format!(
            "Opened the Work Graph tab for workspace {}.",
            result.workspace_id
        ),
    }
}

/// `mentu run`: the run started. The daemon's own run id leads, because
/// that is the handle the caller needs to follow or cancel it.
pub fn mentu_run_started(run: &MentuRun) -> String {
    format!(
        "Started Work Graph run {} (recipe {}, status {}).",
        run.id,
        run.recipe_id,
        run.status.as_wire()
    )
}

/// `mentu run-status`: the run's status plus one line per recorded step, so
/// a human sees which step is still running without asking for JSON.
pub fn mentu_run_status(run: &MentuRun) -> String {
    let mut lines = vec![mentu_run_line(run)];
    for step in &run.steps {
        lines.push(mentu_step_line(step));
    }
    if let Some(error) = &run.error {
        lines.push(format!("error: {error}"));
    }
    lines.join("\n")
}

/// `mentu run --follow`: one line per observed status change, newest last.
/// The caller prints these as they happen; the final line is the terminal
/// verdict, so the last thing a reader sees is the outcome.
pub fn mentu_status_change(run: &MentuRun) -> String {
    format!("run {} {}", run.id, mentu_progress(run))
}

/// A compact progress phrase: status plus "(3/5 steps done)" once the
/// record carries steps, so a follow loop reports real movement rather
/// than the same word twice.
pub fn mentu_progress(run: &MentuRun) -> String {
    let status = run.status.as_wire();
    if run.steps.is_empty() {
        return status.to_string();
    }
    let done = run
        .steps
        .iter()
        .filter(|step| step.status.is_terminal())
        .count();
    format!("{status} ({done}/{} steps recorded)", run.steps.len())
}

fn mentu_run_line(run: &MentuRun) -> String {
    let mut line = format!(
        "Work Graph run {}: recipe {} status {}",
        run.id,
        run.recipe_id,
        run.status.as_wire()
    );
    if let Some(mentu_run_id) = &run.mentu_run_id {
        line.push_str(&format!(" ({mentu_run_id})"));
    }
    line.push_str(&format!(" started {}", run.started_at));
    if let Some(ended_at) = &run.ended_at {
        line.push_str(&format!(", ended {ended_at}"));
    }
    line
}

fn mentu_step_line(step: &MentuStepRun) -> String {
    let mut line = format!(
        "  {} [{}] {}",
        step.label,
        step.backend,
        step.status.as_wire()
    );
    if let Some(exit_code) = step.exit_code {
        line.push_str(&format!(" exit {exit_code}"));
    }
    if let Some(duration) = step.duration_seconds {
        line.push_str(&format!(" {duration}s"));
    }
    if let Some(output) = &step.output_path {
        line.push_str(&format!(" stdout {output}"));
    }
    if let Some(error) = &step.error {
        line.push_str(&format!(" error: {error}"));
    }
    line
}

/// `mentu runs`: one line per run, newest first.
pub fn mentu_run_list(result: &MentuRunsResult) -> String {
    if result.runs.is_empty() {
        return "No Work Graph runs recorded for this workspace.".into();
    }
    result
        .runs
        .iter()
        .map(mentu_run_line)
        .collect::<Vec<_>>()
        .join("\n")
}

/// `mentu run` when the recipe has no pending approval. The refusal is the
/// point: say exactly what is missing and who can supply it, never imply
/// the run happened.
pub fn mentu_approval_required(workspace: &str, recipe: &str) -> String {
    format!(
        "Recipe {recipe} in workspace {workspace} has no approval for its current content. \
         Review and approve it from the Drogon Work Graph tab (Run Recipe), then run it again. \
         This verb never approves a recipe on its own."
    )
}

/// `mentu run` when an approval was resolved: name it, so a caller can
/// follow the run it is about to create back to this exact consent.
pub fn mentu_approval_used(approval: &MentuApproval) -> String {
    format!(
        "Using approval {} (sha256:{})",
        approval.id,
        &approval.content_hash[..12.min(approval.content_hash.len())]
    )
}

/// `mentu cancel`: the daemon accepted the request and reports the row it
/// currently holds. The row may still read `running`: cancellation is
/// asynchronous, so the line must not claim the run already stopped.
pub fn mentu_cancel_requested(run: &MentuRun) -> String {
    format!(
        "Cancellation requested for Work Graph run {} (status {}). Poll `mentu run-status --run {}` until it settles.",
        run.id,
        run.status.as_wire(),
        run.id
    )
}

/// `graph read`/`graph write-intent`: the whole graph. The human-owned
/// intent and the daemon-owned state print side by side, with each state
/// node's observed status and the run it belongs to, so a reader can see
/// immediately when the two halves disagree.
pub fn graph_read(graph: &Graph) -> String {
    let mut lines = vec![format!("Work graph v{}", graph.version)];
    if graph.intent.nodes.is_empty() {
        lines.push("No intent nodes; the graph is empty.".into());
    } else {
        lines.push(format!("Intent ({} node(s)):", graph.intent.nodes.len()));
        for node in &graph.intent.nodes {
            let deps = if node.depends_on.is_empty() {
                String::new()
            } else {
                format!(" after {}", node.depends_on.join(", "))
            };
            lines.push(format!(
                "  {}{} [{} {}] {}{}",
                node.id,
                if node.enabled { "" } else { " (disabled)" },
                node.harness,
                if node.model.is_empty() {
                    "no model"
                } else {
                    &node.model
                },
                node.title,
                deps
            ));
        }
    }
    lines.push(format!(
        "State (updated {}):",
        if graph.state.updated_at.is_empty() {
            "never"
        } else {
            &graph.state.updated_at
        }
    ));
    if graph.state.nodes.is_empty() {
        lines.push("  no observed nodes yet".into());
    }
    for node in &graph.state.nodes {
        lines.push(format!("  {} {}", node.id, graph_node_state_line(node)));
    }
    lines.join("\n")
}

fn graph_node_state_line(node: &GraphNodeState) -> String {
    let mut line = node.status.as_wire().to_string();
    if let Some(run) = &node.run_id {
        line.push_str(&format!(" (run {run}"));
        if let Some(mentu) = &node.mentu_run_id {
            line.push_str(&format!(", {mentu}"));
        }
        line.push(')');
    }
    if let Some(error) = &node.last_error {
        line.push_str(&format!(" - {error}"));
    }
    line
}

/// `graph node-state`: one node's observed projection.
pub fn graph_node_state(node: &GraphNodeState) -> String {
    format!("{} {}", node.id, graph_node_state_line(node))
}

/// `graph compile`: the emitted recipe id and hash, the compiled nodes in
/// execution order, and every runtime finding attributed to its node. A
/// warning or info finding is shown but does not block execution; an error
/// does, and the daemon refuses before running.
pub fn graph_compiled(compiled: &GraphCompileResult) -> String {
    let mut lines = vec![format!(
        "Compiled recipe {} (sha256:{}) for nodes: {}",
        compiled.recipe_id,
        &compiled.content_hash[..12.min(compiled.content_hash.len())],
        compiled.node_ids.join(" -> ")
    )];
    if compiled.findings.is_empty() {
        lines.push("The pinned runtime's check/doctor --strict reported no findings.".into());
    } else {
        for finding in &compiled.findings {
            let severity = match finding.severity {
                drogon_protocol::graph::GraphFindingSeverity::Error => "error",
                drogon_protocol::graph::GraphFindingSeverity::Warning => "warning",
                drogon_protocol::graph::GraphFindingSeverity::Info => "info",
            };
            let node = finding
                .node_id
                .as_ref()
                .map(|node| format!(" [{node}]"))
                .unwrap_or_default();
            lines.push(format!(
                "{severity} {} {}:{node} {}",
                finding.code,
                if finding.is_error() {
                    "(blocks execution)"
                } else {
                    "(advisory)"
                },
                finding.message
            ));
        }
    }
    lines.join("\n")
}

/// `graph run`: the started run plus what was compiled for it.
pub fn graph_run_started(compiled: &GraphCompileResult, run: &MentuRun) -> String {
    format!("{}\n{}", graph_compiled(compiled), mentu_run_started(run))
}

/// `graph run-node-failover`: which runtime the Subagent policy actually
/// picked (never the node's own stored harness/model, which is only a
/// shape-validation default), whether it was the configured fallback, and
/// the full attempt history for this episode so a caller sees every runtime
/// that was tried, not just the one that won.
pub fn graph_run_node_failover(
    run: &MentuRun,
    runtime: &GraphRuntimeRef,
    is_fallback: bool,
    attempt_number: u32,
    attempts: &[GraphFailoverAttemptRecord],
) -> String {
    let mut lines = vec![format!(
        "Ran on {}{}{} (attempt {attempt_number}).",
        runtime.harness,
        if runtime.model.is_empty() {
            String::new()
        } else {
            format!("/{}", runtime.model)
        },
        if is_fallback {
            ", the fallback runtime"
        } else {
            ""
        },
    )];
    for attempt in attempts {
        let target = if attempt.model.is_empty() {
            attempt.harness.clone()
        } else {
            format!("{}/{}", attempt.harness, attempt.model)
        };
        let mut line = format!("  attempt: {target} [{}]", attempt.outcome);
        if let Some(reason) = &attempt.reason {
            line.push_str(&format!(" - {reason}"));
        }
        lines.push(line);
    }
    lines.push(mentu_run_started(run));
    lines.join("\n")
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

/// `meeting list`: when there is nothing to show, the first line has to be
/// the truth about the notes folder — never a bare "no meetings". When there
/// is something to show, the folder provenance is still printed first so a
/// reader always knows which directory those meetings came from.
pub fn meeting_list(list: &MeetingList) -> String {
    let availability = &list.availability;
    let filter_line = meeting_filter_line(list);
    let mut lines = vec![meeting_folder_line(list)];
    if list.meetings.is_empty() {
        lines.push(match availability.reason.as_str() {
            "unsupported-platform" => format!(
                "Write That Down is macOS-only; this host reports platform {}.",
                availability.platform
            ),
            "not-installed" => format!(
                "Write That Down is not installed. Install it at /Applications/WriteThatDown.app to record new meetings; Drogon will still list compatible notes in {}.",
                availability.transcript_root
            ),
            "invalid-configuration" => format!(
                "Write That Down's configuration could not be read safely ({}). Existing notes are untouched.",
                availability.config_path
            ),
            "transcript-root-missing" => format!(
                "The notes folder does not exist: {}. This is not the same as having no meetings.",
                availability.transcript_root
            ),
            "transcript-root-unreadable" => format!(
                "The notes folder exists but cannot be read: {}.",
                availability.transcript_root
            ),
            "empty" => format!(
                "The notes folder is empty: {}.",
                availability.transcript_root
            ),
            _ if list.searched => format!(
                "No transcript in {} matches this search. {} file{} were read; the folder itself is fine.",
                availability.transcript_root,
                list.scanned,
                if list.scanned == 1 { "" } else { "s" }
            ),
            _ if filter_line.is_some() => format!(
                "No transcript in {} matches these filters. The folder itself is fine.",
                availability.transcript_root
            ),
            _ => "No transcripts to show.".to_string(),
        });
        if availability.reason == "not-installed"
            && availability.transcript_root_state != "readable"
        {
            lines.push(format!(
                "The notes folder is {}: {}.",
                availability.transcript_root_state, availability.transcript_root
            ));
        }
        return lines.join("\n");
    }
    if let Some(filter_line) = &filter_line {
        lines.push(filter_line.clone());
    }
    lines.push(format!(
        "{} meeting{} (showing {}..{}):",
        list.total,
        if list.total == 1 { "" } else { "s" },
        list.offset,
        list.offset as usize + list.meetings.len()
    ));
    lines.extend(list.meetings.iter().map(meeting_line));
    if list.has_more {
        lines.push(format!(
            "More meetings available: rerun with --offset {}.",
            list.offset as usize + list.meetings.len()
        ));
    }
    if list.scan_truncated {
        lines.push(
            "The notes directory was only partially indexed (the scan budget stopped the walk), so this count is a lower bound."
                .to_string(),
        );
    }
    if list.scanned > 0 {
        lines.push(format!(
            "Read {} transcript file{} for this search (one at a time, never the whole corpus at once).",
            list.scanned,
            if list.scanned == 1 { "" } else { "s" }
        ));
    }
    if let Some(analysis) = availability_analysis_line(list) {
        lines.push(analysis);
    }
    let failed = list
        .meetings
        .iter()
        .filter(|meeting| meeting.status == "failed")
        .count();
    if failed > 0 {
        lines.push(format!(
            "{failed} file{} failed to parse; each line above names its file and reason.",
            if failed == 1 { "" } else { "s" }
        ));
    }
    lines.join("\n")
}

fn meeting_folder_line(list: &MeetingList) -> String {
    let availability = &list.availability;
    format!(
        "Notes folder ({}): {} [{}]",
        availability.transcript_root_source,
        availability.transcript_root,
        availability.transcript_root_state
    )
}

fn meeting_line(meeting: &MeetingTranscript) -> String {
    let started = meeting.started_at.as_deref().unwrap_or("unknown time");
    let duration = match (meeting.status.as_str(), meeting.duration_minutes) {
        ("recording", _) => "in progress".to_string(),
        (_, Some(minutes)) => format!("{minutes} min"),
        _ => "unknown duration".to_string(),
    };
    let failure = meeting
        .failure_reason
        .as_deref()
        .map(|reason| format!(" ({reason})"))
        .unwrap_or_default();
    let mut line = format!(
        "{} [{}] {} · {}{}\n    {}\n    {}",
        started,
        meeting.status,
        meeting.title,
        duration,
        failure,
        meeting.relative_path,
        meeting.id
    );
    // The transcript line a search matched, so the reader can check the hit
    // before opening the note.
    if meeting.searched {
        line.push_str(&format!(
            "\n    {} match{} in this note:",
            meeting.match_count,
            if meeting.match_count == 1 { "" } else { "es" }
        ));
        for hit in &meeting.matches {
            line.push_str(&format!("\n      {}: {}", hit.line, hit.text));
        }
    }
    line
}

/// The filter set that was actually applied, so a Bot reading the output
/// never has to guess which of its inputs the daemon honoured.
fn meeting_filter_line(list: &MeetingList) -> Option<String> {
    let filters = &list.filters;
    let mut parts = Vec::new();
    if let Some(query) = &filters.query {
        parts.push(format!("query {query:?}"));
    }
    if let Some(from) = &filters.from {
        parts.push(format!("from {from}"));
    }
    if let Some(to) = &filters.to {
        parts.push(format!("to {to}"));
    }
    if let Some(minutes) = filters.min_minutes {
        parts.push(format!("at least {minutes} min"));
    }
    if let Some(minutes) = filters.max_minutes {
        parts.push(format!("at most {minutes} min"));
    }
    if parts.is_empty() {
        return None;
    }
    Some(format!("Filters: {}.", parts.join(", ")))
}

/// Extraction availability, stated in the list output too: a Bot that cannot
/// analyse should learn why from the same call that lists the meetings.
fn availability_analysis_line(list: &MeetingList) -> Option<String> {
    let analysis = &list.availability.analysis;
    if analysis.available {
        return None;
    }
    Some(format!(
        "Extraction is off on this host: {}. The transcripts below are unaffected; install {} to enable `meeting analyze`.",
        analysis.reason, analysis.harness
    ))
}

/// `meeting analyze`: the summary, the verified findings with the line each
/// came from, and — separately and explicitly — anything that was DISCARDED
/// because its quote was not found in the note.
pub fn meeting_analysis(analysis: &MeetingAnalysis) -> String {
    let mut lines = vec![
        format!("# {}", analysis.meeting.title),
        format!(
            "{} · {} ({}, {})",
            analysis
                .meeting
                .started_at
                .as_deref()
                .unwrap_or("unknown time"),
            analysis.meeting.relative_path,
            analysis.model,
            analysis.provider
        ),
        format!(
            "Local model {} via {} answered in {} ms. Nothing was created; accept what you agree with using `meeting actions add`.",
            analysis.model, analysis.harness, analysis.duration_ms
        ),
    ];
    if analysis.transcript_truncated {
        lines.push(format!(
            "Only the first {} characters of the note were analysed (the prompt budget).",
            analysis.transcript_chars
        ));
    }
    lines.push(String::new());
    lines.push(if analysis.summary.is_empty() {
        "Summary: (the model returned none)".to_string()
    } else {
        format!("Summary: {}", analysis.summary)
    });
    for (title, items) in [
        ("Decisions", &analysis.decisions),
        ("Actions", &analysis.actions),
        ("Open questions", &analysis.open_questions),
    ] {
        lines.push(String::new());
        if items.is_empty() {
            lines.push(format!("{title}: none stated."));
            continue;
        }
        lines.push(format!("{title}:"));
        lines.extend(items.iter().map(suggestion_line));
    }
    if analysis.discarded_count > 0 {
        lines.push(String::new());
        lines.push(format!(
            "Discarded {} suggestion{} whose quote could not be found verbatim in the note (never shown as a finding):",
            analysis.discarded_count,
            if analysis.discarded_count == 1 { "" } else { "s" }
        ));
        lines.extend(analysis.discarded.iter().map(|item| {
            format!(
                "  - {} ({})",
                if item.text.is_empty() {
                    "(no text)"
                } else {
                    item.text.as_str()
                },
                item.reason
            )
        }));
    }
    lines.push(String::new());
    lines.push(
        "Every line above citing a transcript line was found verbatim in the note; a suggestion without one was dropped."
            .to_string(),
    );
    lines.join("\n")
}

fn suggestion_line(suggestion: &MeetingSuggestion) -> String {
    let mut suffix = Vec::new();
    if let Some(owner) = &suggestion.owner {
        suffix.push(format!("owner {owner}"));
    }
    if let Some(due) = &suggestion.due {
        suffix.push(format!("due {due}"));
    }
    suffix.push(format!("confidence {}", suggestion.confidence));
    format!(
        "  - {} ({})\n      line {}: {}",
        suggestion.text,
        suffix.join(", "),
        suggestion.line,
        suggestion.quote
    )
}

/// The ledger, one page at a time. The open count is printed even when the
/// page shows something else, because "what is still open" is the question
/// the ledger exists to answer.
pub fn meeting_commitments(page: &MeetingCommitmentPage) -> String {
    let mut lines = vec![format!(
        "{} commitment{} ({} open) — showing {}..{}",
        page.total,
        if page.total == 1 { "" } else { "s" },
        page.open,
        page.offset,
        page.offset as usize + page.commitments.len()
    )];
    if page.commitments.is_empty() {
        lines.push(
            "Nothing here yet. `meeting analyze --id <ID>` suggests work; `meeting actions add` records what you accept."
                .to_string(),
        );
        return lines.join("\n");
    }
    lines.extend(page.commitments.iter().map(commitment_line));
    if page.has_more {
        lines.push(format!(
            "More commitments available: rerun with --offset {}.",
            page.offset as usize + page.commitments.len()
        ));
    }
    lines.join("\n")
}

pub fn meeting_commitment(commitment: &MeetingCommitment) -> String {
    format!(
        "{} [{}] {}\n    {} · {}\n    line {}: {}\n    id {}",
        commitment.status,
        commitment.source,
        commitment.text,
        commitment.meeting_date,
        commitment.meeting_title,
        commitment.line,
        commitment.quote,
        commitment.id
    )
}

fn commitment_line(commitment: &MeetingCommitment) -> String {
    let owner = commitment
        .owner
        .as_deref()
        .map(|owner| format!(" · owner {owner}"))
        .unwrap_or_default();
    format!(
        "{} [{} {}] {}{}\n    {} · {} · line {}\n    {}\n    id {}",
        commitment.status,
        commitment.source,
        commitment.confidence,
        commitment.text,
        owner,
        commitment.meeting_date,
        commitment.meeting_title,
        commitment.line,
        commitment.quote,
        commitment.id
    )
}

/// `meeting read`: path, metadata, then the note itself, exactly as the file
/// has it. The bytes Drogon printed are the bytes on disk; nothing is
/// rewritten, summarised or trimmed except the explicit `--max-bytes` cap,
/// which is always announced.
pub fn meeting_read(read: &MeetingRead) -> String {
    let meeting = &read.meeting;
    let duration = match (meeting.status.as_str(), meeting.duration_minutes) {
        ("recording", _) => "in progress".to_string(),
        (_, Some(minutes)) => format!("{minutes} min"),
        _ => "unknown duration".to_string(),
    };
    let mut lines = vec![
        format!("# {}", meeting.title),
        meeting
            .started_at
            .as_deref()
            .unwrap_or("unknown time")
            .to_string(),
        format!("{} ({duration}, {})", meeting.relative_path, meeting.status),
    ];
    if let Some(reason) = &meeting.failure_reason {
        lines.push(format!("Failed to parse: {reason}."));
    }
    if read.truncated {
        lines.push(format!(
            "Showing the first {} of {} bytes (--max-bytes).",
            read.content.len(),
            read.size
        ));
    }
    lines.push(String::new());
    lines.push(read.content.trim_end().to_string());
    lines.join("\n")
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
    fn wait_success_line_names_condition_and_state() {
        let read: ReadResult = serde_json::from_value(json!({
            "session": {
                "id": "s1", "workspaceId": "w1", "hostId": "h1", "incarnation": "tok",
                "command": "sh", "args": [], "cols": 80, "rows": 24,
                "verdict": "exited", "exitCode": 0, "createdAt": "2026-09-05T12:00:00Z",
                "agentState": "exited", "agentStateAt": null
            },
            "dataBase64": STANDARD.encode("hi\n"),
            "startCursor": 0, "nextCursor": 3, "truncated": false
        }))
        .unwrap();
        let text = session_waited(&read, "exited", 2, 120);
        assert!(text.contains("Wait satisfied for s1 [exited]"));
        assert!(text.contains("for=exited"));
        assert!(text.contains("cursor 0..3"));
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
        let created_text = worktree_created(&created);
        assert!(created_text.contains("feature"));
        assert!(created_text.contains("workspace=ws2"));
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
