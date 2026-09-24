//! `drogon-cli work …`: the Work board (tickets, columns and the prompts a
//! column types into the sessions linked to its tickets). Requires the
//! service capability `work.v1`.

use clap::Subcommand;
use serde_json::{Value, json};

use crate::client::{CallOk, Client};
use crate::commands::RunOutcome;
use crate::error::CliError;

/// Column prompts can resume or start a harness session per ticket.
const SEND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Subcommand, Debug)]
pub enum WorkAction {
    /// Show the whole board: columns in order with their tickets, linked
    /// sessions and prompt configuration
    Board {
        /// Only tickets of this project (id or name)
        #[arg(long, value_name = "PROJECT")]
        project: Option<String>,
    },
    /// Columns: create, configure (prompt, triggers, recipients), reorder,
    /// delete, preview and send
    Column {
        #[command(subcommand)]
        action: WorkColumnAction,
    },
    /// Tickets: Drogon records with their own key (DRG-41), optionally
    /// linked to a source URL, a pull request and sessions
    Ticket {
        #[command(subcommand)]
        action: WorkTicketAction,
    },
    /// Delivery history: what was typed into which session, when and why
    Sends {
        /// Only sends of this column (id or name)
        #[arg(long, value_name = "COLUMN")]
        column: Option<String>,
        /// Only sends of this ticket (id or key)
        #[arg(long, value_name = "TICKET")]
        ticket: Option<String>,
        /// Newest first, 1..=200 (default 50)
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
    },
}

#[derive(Subcommand, Debug)]
pub enum WorkColumnAction {
    /// List the columns in board order with their prompt configuration
    List,
    /// Add a column
    Create {
        /// Column name, unique on the board (1..=64 chars)
        #[arg(long, value_name = "NAME")]
        name: String,
        /// backlog | todo | in_progress | review | qa | done | blocked
        #[arg(long, value_name = "ICON")]
        icon: Option<String>,
        /// 0-based position on the board (default: last)
        #[arg(long, value_name = "N")]
        index: Option<u32>,
    },
    /// Configure a column: its name, icon and position, and the prompt it
    /// types into the sessions linked to its tickets
    Update {
        /// Column id or name
        #[arg(long, value_name = "COLUMN")]
        column: String,
        #[arg(long, value_name = "NAME")]
        name: Option<String>,
        /// backlog | todo | in_progress | review | qa | done | blocked
        #[arg(long, value_name = "ICON")]
        icon: Option<String>,
        /// Move the column to this 0-based position
        #[arg(long, value_name = "N")]
        index: Option<u32>,
        /// Send the prompt when a ticket enters this column
        #[arg(long, value_name = "true|false")]
        on_enter: Option<bool>,
        /// Also send on a schedule: `15m`, `2h`, `1d` or a UTC cron
        /// expression (`*/15 * * * *`)
        #[arg(long, value_name = "EVERY|CRON", conflicts_with = "no_schedule")]
        schedule: Option<String>,
        /// Remove the schedule
        #[arg(long)]
        no_schedule: bool,
        /// Also send when a ticket's pull request changes (state, review,
        /// checks, updates), polled every 5 minutes through `gh`
        #[arg(long, value_name = "true|false")]
        pr_watch: Option<bool>,
        /// The prompt; placeholders: {ticket.id} {ticket.title} {ticket.pr}
        /// {ticket.url} {ticket.description} {ticket.next} {ticket.project}
        /// {ticket.column}
        #[arg(
            long,
            value_name = "TEXT",
            conflicts_with = "message_file",
            allow_hyphen_values = true
        )]
        message: Option<String>,
        /// Read the prompt from a file
        #[arg(long, value_name = "PATH")]
        message_file: Option<String>,
        /// all (every linked session) | primary (the first linked session)
        #[arg(long, value_name = "all|primary")]
        recipients: Option<String>,
        /// Harness for sessions this column has to start: claude | codex |
        /// opencode | pi | antigravity (default: the default agent)
        #[arg(long, value_name = "HARNESS", conflicts_with = "default_harness")]
        harness: Option<String>,
        /// Start new sessions with the default agent again
        #[arg(long)]
        default_harness: bool,
    },
    /// Delete a column; its tickets must move somewhere else
    Delete {
        /// Column id or name
        #[arg(long, value_name = "COLUMN")]
        column: String,
        /// Column that receives the deleted column's tickets
        #[arg(long, value_name = "COLUMN")]
        move_to: Option<String>,
    },
    /// Show what a send would type and to which sessions, changing nothing
    Preview {
        /// Column id or name
        #[arg(long, value_name = "COLUMN")]
        column: String,
        /// Only this ticket (id or key)
        #[arg(long, value_name = "TICKET")]
        ticket: Option<String>,
    },
    /// Send the column's prompt now to every ticket in it (or one ticket)
    Send {
        /// Column id or name
        #[arg(long, value_name = "COLUMN")]
        column: String,
        /// Only this ticket (id or key)
        #[arg(long, value_name = "TICKET")]
        ticket: Option<String>,
        /// Send this text instead of the configured prompt
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        message: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub enum WorkTicketAction {
    /// List tickets (optionally one column or one project)
    List {
        /// Column id or name
        #[arg(long, value_name = "COLUMN")]
        column: Option<String>,
        /// Project id or name
        #[arg(long, value_name = "PROJECT")]
        project: Option<String>,
    },
    /// Create a ticket; entering a column with an on-enter prompt sends it
    Create {
        #[arg(long, value_name = "TITLE")]
        title: String,
        /// Project id or name (keys follow it: Drogon → DRG-n)
        #[arg(long, value_name = "PROJECT")]
        project: Option<String>,
        /// Workspace new sessions start in (default: the project's)
        #[arg(long, value_name = "ID")]
        workspace: Option<String>,
        /// Column id or name (default: the first column)
        #[arg(long, value_name = "COLUMN")]
        column: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        description: Option<String>,
        /// Pull request: URL, `#648` or `648`
        #[arg(long, value_name = "URL|#N")]
        pr: Option<String>,
        /// Link to the ticket in another system (GitHub, Jira, Linear, …)
        #[arg(long, value_name = "URL")]
        source: Option<String>,
        /// The next step, shown on the card
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        next: Option<String>,
        /// Link a session (repeatable)
        #[arg(long = "session", value_name = "ID")]
        sessions: Vec<String>,
    },
    /// Show a ticket with its sessions and recent sends
    Show {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
    },
    /// Edit a ticket
    Update {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        #[arg(long, value_name = "TITLE")]
        title: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        description: Option<String>,
        /// Project id or name; `none` clears it
        #[arg(long, value_name = "PROJECT")]
        project: Option<String>,
        /// Workspace id; `none` clears it
        #[arg(long, value_name = "ID")]
        workspace: Option<String>,
        /// Pull request URL or number; `none` clears it
        #[arg(long, value_name = "URL|#N")]
        pr: Option<String>,
        /// Source URL; `none` clears it
        #[arg(long, value_name = "URL")]
        source: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        next: Option<String>,
    },
    /// Move a ticket to a column (entering a column sends its on-enter prompt)
    Move {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        /// Column id or name
        #[arg(long, value_name = "COLUMN")]
        column: String,
        /// 0-based position in the column (default: last)
        #[arg(long, value_name = "N")]
        index: Option<u32>,
    },
    /// Delete a ticket (its sessions keep running)
    Delete {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
    },
    /// Attach a session to a ticket so column prompts reach it
    Link {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        /// Session id (`drogon-cli terminal list`)
        #[arg(long, value_name = "ID")]
        session: String,
    },
    /// Detach a session from a ticket
    Unlink {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        #[arg(long, value_name = "ID")]
        session: String,
    },
    /// Open a ticket's session: a live one as is, one that is no longer live
    /// is resumed (or started fresh when there is nothing to resume) and
    /// takes the old one's place on the ticket
    Open {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        #[arg(long, value_name = "ID")]
        session: String,
    },
}

fn usage(message: impl Into<String>) -> CliError {
    CliError::Usage(message.into())
}

fn nonempty(flag: &str, value: &str) -> Result<(), CliError> {
    if value.trim().is_empty() {
        Err(usage(format!("--{flag} must not be empty")))
    } else {
        Ok(())
    }
}

/// Local checks run before any transport work.
pub fn validate(action: &WorkAction) -> Result<(), CliError> {
    match action {
        WorkAction::Board { project } => {
            if let Some(p) = project {
                nonempty("project", p)?;
            }
        }
        WorkAction::Sends { limit, .. } => {
            if let Some(limit) = limit
                && (*limit == 0 || *limit > 200)
            {
                return Err(usage("--limit must be between 1 and 200"));
            }
        }
        WorkAction::Column { action } => match action {
            WorkColumnAction::List => {}
            WorkColumnAction::Create { name, .. } => nonempty("name", name)?,
            WorkColumnAction::Update {
                column,
                name,
                schedule,
                recipients,
                ..
            } => {
                nonempty("column", column)?;
                if let Some(name) = name {
                    nonempty("name", name)?;
                }
                if let Some(schedule) = schedule {
                    nonempty("schedule", schedule)?;
                }
                if let Some(r) = recipients
                    && r != "all"
                    && r != "primary"
                {
                    return Err(usage("--recipients must be all or primary"));
                }
            }
            WorkColumnAction::Delete { column, .. }
            | WorkColumnAction::Preview { column, .. }
            | WorkColumnAction::Send { column, .. } => nonempty("column", column)?,
        },
        WorkAction::Ticket { action } => match action {
            WorkTicketAction::List { .. } => {}
            WorkTicketAction::Create { title, .. } => nonempty("title", title)?,
            WorkTicketAction::Move { ticket, column, .. } => {
                nonempty("ticket", ticket)?;
                nonempty("column", column)?;
            }
            WorkTicketAction::Show { ticket }
            | WorkTicketAction::Update { ticket, .. }
            | WorkTicketAction::Delete { ticket } => nonempty("ticket", ticket)?,
            WorkTicketAction::Link { ticket, session }
            | WorkTicketAction::Unlink { ticket, session }
            | WorkTicketAction::Open { ticket, session } => {
                nonempty("ticket", ticket)?;
                nonempty("session", session)?;
            }
        },
    }
    Ok(())
}

/// `none` clears an optional field (sent as `null`).
fn clearable(value: &str) -> Value {
    if value.eq_ignore_ascii_case("none") {
        Value::Null
    } else {
        json!(value)
    }
}

pub async fn run(
    client: &Client,
    request_id: &str,
    json_mode: bool,
    action: &WorkAction,
) -> Result<RunOutcome, CliError> {
    crate::commands::require_capability(client, request_id, "work.v1", "the Work board").await?;
    let (method, params, human): (&str, Value, fn(&Value) -> String) = match action {
        WorkAction::Board { project } => {
            let mut params = json!({});
            if let Some(p) = project {
                params["projectId"] = json!(p);
            }
            ("work.board", params, render_board)
        }
        WorkAction::Sends {
            column,
            ticket,
            limit,
        } => {
            let mut params = json!({});
            if let Some(c) = column {
                params["columnId"] = json!(c);
            }
            if let Some(t) = ticket {
                params["ticketId"] = json!(t);
            }
            if let Some(l) = limit {
                params["limit"] = json!(l);
            }
            ("work.sends", params, render_sends)
        }
        WorkAction::Column { action } => column_call(action)?,
        WorkAction::Ticket { action } => ticket_call(action)?,
    };
    let timeout = if matches!(
        method,
        "work.column_send" | "work.ticket_move" | "work.ticket_create" | "work.session_open"
    ) {
        SEND_TIMEOUT
    } else {
        READ_TIMEOUT
    };
    let call: CallOk = client.call(method, params, request_id, timeout).await?;
    let result = call.result.clone();
    if let WorkAction::Ticket {
        action: WorkTicketAction::List { column, .. },
    } = action
    {
        // `ticket list` is the board filtered locally to one column.
        let text = render_ticket_list(&result, column.as_deref());
        return crate::commands::emit_call(call, json_mode, move || text);
    }
    crate::commands::emit_call(call, json_mode, move || human(&result))
}

fn column_call(
    action: &WorkColumnAction,
) -> Result<(&'static str, Value, fn(&Value) -> String), CliError> {
    Ok(match action {
        WorkColumnAction::List => ("work.board", json!({}), render_columns),
        WorkColumnAction::Create { name, icon, index } => {
            let mut params = json!({ "name": name });
            if let Some(icon) = icon {
                params["icon"] = json!(icon);
            }
            if let Some(index) = index {
                params["index"] = json!(index);
            }
            ("work.column_create", params, render_column)
        }
        WorkColumnAction::Update {
            column,
            name,
            icon,
            index,
            on_enter,
            schedule,
            no_schedule,
            pr_watch,
            message,
            message_file,
            recipients,
            harness,
            default_harness,
        } => {
            let mut params = json!({ "columnId": column });
            if let Some(v) = name {
                params["name"] = json!(v);
            }
            if let Some(v) = icon {
                params["icon"] = json!(v);
            }
            if let Some(v) = index {
                params["index"] = json!(v);
            }
            if let Some(v) = on_enter {
                params["sendOnEnter"] = json!(v);
            }
            if let Some(v) = schedule {
                params["cron"] = json!(v);
            }
            if *no_schedule {
                params["cron"] = Value::Null;
            }
            if let Some(v) = pr_watch {
                params["prWatch"] = json!(v);
            }
            if let Some(v) = message {
                params["message"] = json!(v);
            }
            if let Some(path) = message_file {
                let text = std::fs::read_to_string(path)
                    .map_err(|err| usage(format!("cannot read --message-file {path}: {err}")))?;
                params["message"] = json!(text);
            }
            if let Some(v) = recipients {
                params["recipients"] = json!(v);
            }
            if let Some(v) = harness {
                params["harnessId"] = json!(v);
            }
            if *default_harness {
                params["harnessId"] = Value::Null;
            }
            if params.as_object().is_some_and(|o| o.len() == 1) {
                return Err(usage(
                    "work column update needs at least one setting to change",
                ));
            }
            ("work.column_update", params, render_column)
        }
        WorkColumnAction::Delete { column, move_to } => {
            let mut params = json!({ "columnId": column });
            if let Some(target) = move_to {
                params["moveTicketsTo"] = json!(target);
            }
            ("work.column_delete", params, |v| {
                format!(
                    "Deleted column {} (moved {} ticket(s)).",
                    v["deleted"].as_str().unwrap_or("?"),
                    v["movedTickets"]
                )
            })
        }
        WorkColumnAction::Preview { column, ticket } => {
            let mut params = json!({ "columnId": column });
            if let Some(t) = ticket {
                params["ticketId"] = json!(t);
            }
            ("work.column_preview", params, render_preview)
        }
        WorkColumnAction::Send {
            column,
            ticket,
            message,
        } => {
            let mut params = json!({ "columnId": column });
            if let Some(t) = ticket {
                params["ticketId"] = json!(t);
            }
            if let Some(m) = message {
                params["message"] = json!(m);
            }
            ("work.column_send", params, |v| {
                let sends = v["sends"].as_array().cloned().unwrap_or_default();
                if sends.is_empty() {
                    return "The column has no tickets; nothing was sent.".to_string();
                }
                sends
                    .iter()
                    .map(render_delivery)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
        }
    })
}

fn ticket_call(
    action: &WorkTicketAction,
) -> Result<(&'static str, Value, fn(&Value) -> String), CliError> {
    Ok(match action {
        WorkTicketAction::List { project, .. } => {
            let mut params = json!({});
            if let Some(p) = project {
                params["projectId"] = json!(p);
            }
            ("work.board", params, render_board)
        }
        WorkTicketAction::Create {
            title,
            project,
            workspace,
            column,
            description,
            pr,
            source,
            next,
            sessions,
        } => {
            let mut params = json!({ "title": title });
            for (key, value) in [
                ("projectId", project),
                ("workspaceId", workspace),
                ("columnId", column),
                ("description", description),
                ("prUrl", pr),
                ("sourceUrl", source),
                ("nextStep", next),
            ] {
                if let Some(v) = value {
                    params[key] = json!(v);
                }
            }
            if !sessions.is_empty() {
                params["sessionIds"] = json!(sessions);
            }
            ("work.ticket_create", params, render_ticket_with_delivery)
        }
        WorkTicketAction::Show { ticket } => (
            "work.ticket_show",
            json!({ "ticketId": ticket }),
            render_ticket,
        ),
        WorkTicketAction::Update {
            ticket,
            title,
            description,
            project,
            workspace,
            pr,
            source,
            next,
        } => {
            let mut params = json!({ "ticketId": ticket });
            if let Some(v) = title {
                params["title"] = json!(v);
            }
            if let Some(v) = description {
                params["description"] = json!(v);
            }
            if let Some(v) = next {
                params["nextStep"] = json!(v);
            }
            for (key, value) in [
                ("projectId", project),
                ("workspaceId", workspace),
                ("prUrl", pr),
                ("sourceUrl", source),
            ] {
                if let Some(v) = value {
                    params[key] = clearable(v);
                }
            }
            if params.as_object().is_some_and(|o| o.len() == 1) {
                return Err(usage(
                    "work ticket update needs at least one field to change",
                ));
            }
            ("work.ticket_update", params, render_ticket)
        }
        WorkTicketAction::Move {
            ticket,
            column,
            index,
        } => {
            let mut params = json!({ "ticketId": ticket, "columnId": column });
            if let Some(i) = index {
                params["index"] = json!(i);
            }
            ("work.ticket_move", params, render_ticket_with_delivery)
        }
        WorkTicketAction::Delete { ticket } => {
            ("work.ticket_delete", json!({ "ticketId": ticket }), |v| {
                format!("Deleted ticket {}.", v["key"].as_str().unwrap_or("?"))
            })
        }
        WorkTicketAction::Link { ticket, session } => (
            "work.ticket_link_session",
            json!({ "ticketId": ticket, "sessionId": session }),
            render_ticket,
        ),
        WorkTicketAction::Unlink { ticket, session } => (
            "work.ticket_unlink_session",
            json!({ "ticketId": ticket, "sessionId": session }),
            render_ticket,
        ),
        WorkTicketAction::Open { ticket, session } => (
            "work.session_open",
            json!({ "ticketId": ticket, "sessionId": session }),
            |v| {
                let s = &v["session"];
                format!(
                    "{} session {} (incarnation {}, {}).",
                    match v["action"].as_str() {
                        Some("resumed") => "Resumed as",
                        Some("started") => "Started fresh as",
                        _ => "Open:",
                    },
                    s["id"].as_str().unwrap_or("?"),
                    s["incarnation"].as_str().unwrap_or("?"),
                    s["verdict"].as_str().unwrap_or("?"),
                )
            },
        ),
    })
}

// ------------------------------------------------------------ rendering --

fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

fn column_triggers(c: &Value) -> String {
    let mut triggers = Vec::new();
    if c["sendOnEnter"] == true {
        triggers.push("on enter".to_string());
    }
    if let Some(cron) = c["cron"].as_str() {
        triggers.push(format!("schedule {cron}"));
    }
    if c["prWatch"] == true {
        triggers.push("PR changes".to_string());
    }
    if triggers.is_empty() {
        "manual only".to_string()
    } else {
        triggers.join(", ")
    }
}

fn render_column(c: &Value) -> String {
    let mut out = format!(
        "{} [{}] — {} ticket(s); sends: {}; recipients: {}",
        text(&c["name"]),
        text(&c["icon"]),
        c["ticketCount"],
        column_triggers(c),
        text(&c["recipients"]),
    );
    if let Some(h) = c["harnessId"].as_str() {
        out.push_str(&format!("; new sessions: {h}"));
    }
    out.push_str(&format!("\n  id: {}", text(&c["id"])));
    let message = text(&c["message"]);
    if message.is_empty() {
        out.push_str("\n  prompt: (none)");
    } else {
        out.push_str("\n  prompt:");
        for line in message.lines() {
            out.push_str(&format!("\n    {line}"));
        }
    }
    out
}

fn render_columns(board: &Value) -> String {
    board["columns"]
        .as_array()
        .map(|cs| cs.iter().map(render_column).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

fn session_summary(s: &Value) -> String {
    if s["missing"] == true {
        return format!("{} (gone)", text(&s["id"]));
    }
    format!(
        "{} {} {}",
        text(&s["id"]),
        s["harnessId"].as_str().unwrap_or("terminal"),
        text(&s["verdict"]),
    )
}

fn ticket_line(t: &Value) -> String {
    let mut line = format!("{}  {}", text(&t["key"]), text(&t["title"]));
    if let Some(project) = t["projectName"].as_str() {
        line.push_str(&format!("  [{project}]"));
    }
    if let Some(n) = t["prNumber"].as_i64() {
        line.push_str(&format!("  PR #{n}"));
    }
    let sessions = t["sessions"].as_array().map_or(0, Vec::len);
    line.push_str(&format!("  {sessions} session(s)"));
    line
}

fn render_board(board: &Value) -> String {
    let tickets = board["tickets"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::new();
    for column in board["columns"].as_array().cloned().unwrap_or_default() {
        let mine: Vec<&Value> = tickets
            .iter()
            .filter(|t| t["columnId"] == column["id"])
            .collect();
        out.push(format!(
            "{} ({}) — {}",
            text(&column["name"]),
            mine.len(),
            column_triggers(&column)
        ));
        for ticket in mine {
            out.push(format!("  {}", ticket_line(ticket)));
        }
    }
    out.join("\n")
}

fn render_ticket_list(board: &Value, column: Option<&str>) -> String {
    let columns = board["columns"].as_array().cloned().unwrap_or_default();
    let wanted: Option<&Value> = column.map(|c| {
        columns
            .iter()
            .find(|col| col["id"] == c || text(&col["name"]).eq_ignore_ascii_case(c))
            .unwrap_or(&Value::Null)
    });
    let lines: Vec<String> = board["tickets"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|t| wanted.is_none_or(|col| t["columnId"] == col["id"]))
        .map(|t| {
            let name = columns
                .iter()
                .find(|c| c["id"] == t["columnId"])
                .map(|c| text(&c["name"]).to_string())
                .unwrap_or_default();
            format!("{}  ({name})", ticket_line(t))
        })
        .collect();
    if lines.is_empty() {
        "No tickets.".to_string()
    } else {
        lines.join("\n")
    }
}

fn render_ticket(t: &Value) -> String {
    let mut out = vec![ticket_line(t), format!("  id: {}", text(&t["id"]))];
    if let Some(url) = t["prUrl"].as_str() {
        out.push(format!("  pr: {url}"));
    }
    if let Some(url) = t["sourceUrl"].as_str() {
        out.push(format!("  source: {url}"));
    }
    if let Some(ws) = t["workspaceId"].as_str() {
        out.push(format!("  workspace: {ws}"));
    }
    if !text(&t["nextStep"]).is_empty() {
        out.push(format!("  next: {}", text(&t["nextStep"])));
    }
    if !text(&t["description"]).is_empty() {
        out.push(format!("  {}", text(&t["description"])));
    }
    for s in t["sessions"].as_array().cloned().unwrap_or_default() {
        out.push(format!("  session {}", session_summary(&s)));
    }
    for send in t["sends"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .take(5)
    {
        out.push(format!(
            "  sent ({}): {}",
            text(&send["trigger"]),
            summarize_results(&send["results"])
        ));
    }
    out.join("\n")
}

fn render_ticket_with_delivery(t: &Value) -> String {
    let mut out = render_ticket(t);
    if !t["delivery"].is_null() {
        out.push('\n');
        out.push_str(&render_delivery(&t["delivery"]));
    }
    out
}

fn summarize_results(results: &Value) -> String {
    results
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|r| {
            let target = r["newSessionId"]
                .as_str()
                .or(r["sessionId"].as_str())
                .unwrap_or("-");
            match r["error"].as_str() {
                Some(e) => format!("{} {target} ({e})", text(&r["action"])),
                None => format!("{} {target}", text(&r["action"])),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn render_delivery(d: &Value) -> String {
    format!(
        "{} ← \"{}\": {}",
        text(&d["ticketKey"]),
        text(&d["message"]).lines().next().unwrap_or(""),
        summarize_results(&d["results"])
    )
}

fn render_preview(v: &Value) -> String {
    let previews = v["previews"].as_array().cloned().unwrap_or_default();
    if previews.is_empty() {
        return "The column has no tickets; a send would do nothing.".to_string();
    }
    previews
        .iter()
        .map(|p| {
            let recipients: Vec<String> = p["recipients"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|r| {
                    format!(
                        "{} {}",
                        text(&r["action"]),
                        r["sessionId"]
                            .as_str()
                            .or(r["harnessId"].as_str())
                            .unwrap_or("-")
                    )
                })
                .collect();
            format!(
                "{} → {}\n{}",
                text(&p["ticketKey"]),
                recipients.join(", "),
                text(&p["message"])
                    .lines()
                    .map(|l| format!("  | {l}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_sends(v: &Value) -> String {
    let sends = v["sends"].as_array().cloned().unwrap_or_default();
    if sends.is_empty() {
        return "No sends yet.".to_string();
    }
    sends
        .iter()
        .map(render_delivery)
        .collect::<Vec<_>>()
        .join("\n")
}
