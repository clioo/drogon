//! `drogon-cli work …`: the Work board (tickets, columns and the prompts a
//! column types into the sessions linked to its tickets). Requires the
//! service capability `work.v1`; imported boards (Jira) need
//! `work.boards.v1`.

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
    /// Show a board: columns in order with their tickets, linked sessions
    /// and prompt configuration (default: My work)
    Board {
        /// Only tickets of this project (id or name)
        #[arg(long, value_name = "PROJECT")]
        project: Option<String>,
        /// An imported board (id or name); `local` is My work
        #[arg(long, value_name = "BOARD")]
        board: Option<String>,
        /// On a scrum board: a sprint (id or name), `active` (default) or
        /// `backlog`
        #[arg(long, value_name = "SPRINT")]
        sprint: Option<String>,
    },
    /// List the boards: My work and every imported board, with how many
    /// moves wait to be pushed
    Boards,
    /// The ticket sources a board can sync with (Jira, Linear, GitHub):
    /// which are allowed and how each is connected
    Sources,
    /// Allow or turn off a source, connect it (Linear API key, GitHub token
    /// or gh login) or forget its key
    Source {
        #[command(subcommand)]
        action: WorkSourceAction,
    },
    /// Bring a source's board in (a Jira board, a Linear team, a GitHub
    /// project or repository): list its boards, preview one, import the
    /// chosen issues, or remove an imported board
    Import {
        #[command(subcommand)]
        action: WorkImportAction,
    },
    /// Read an imported board's provider now (it also syncs every 5
    /// minutes): the provider wins for title, description, type, priority,
    /// assignee and sprint; status changes move cards
    Sync {
        /// Imported board id or name
        #[arg(long, value_name = "BOARD")]
        board: String,
    },
    /// Push unsynced moves (status and sprint) to the provider: one
    /// ticket's, or every one on a board
    Push {
        /// Every unsynced move on this imported board (id or name)
        #[arg(
            long,
            value_name = "BOARD",
            conflicts_with = "ticket",
            required_unless_present = "ticket"
        )]
        board: Option<String>,
        /// Only this ticket (id, Drogon key or provider key)
        #[arg(long, value_name = "TICKET")]
        ticket: Option<String>,
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
pub enum WorkSourceAction {
    /// Allow a source: its boards can be imported and synced
    Enable {
        /// jira | linear | github
        #[arg(long, value_name = "SOURCE")]
        provider: String,
    },
    /// Turn a source off: no import, no sync, no push (boards stay)
    Disable {
        /// jira | linear | github
        #[arg(long, value_name = "SOURCE")]
        provider: String,
    },
    /// Connect Linear (a personal API key) or GitHub (a token, or the gh
    /// login when none is given); the key is checked, then kept sealed
    Connect {
        /// linear | github
        #[arg(long, value_name = "SOURCE")]
        provider: String,
        /// Read the API key or token from stdin (keeps it out of shell
        /// history)
        #[arg(long)]
        api_key_stdin: bool,
        /// GitHub Enterprise API URL (`https://ghe.example/api/v3`)
        #[arg(long, value_name = "URL")]
        api_url: Option<String>,
    },
    /// Forget a source's stored key (the gh login itself is left alone)
    Disconnect {
        /// linear | github
        #[arg(long, value_name = "SOURCE")]
        provider: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum WorkImportAction {
    /// The provider's boards, marking the ones already imported
    Boards {
        /// Ticket provider (default: jira)
        #[arg(long, value_name = "PROVIDER")]
        provider: Option<String>,
        /// Provider site/account id (default: the first connected one)
        #[arg(long, value_name = "SITE")]
        site: Option<String>,
    },
    /// A provider board's columns, sprints and issues, before importing
    Preview {
        /// The provider's board id (`work import boards`)
        #[arg(long, value_name = "ID")]
        board: String,
        /// board (every issue, default) | backlog | sprint:<id>
        #[arg(long, value_name = "SCOPE")]
        scope: Option<String>,
        #[arg(long, value_name = "PROVIDER")]
        provider: Option<String>,
        #[arg(long, value_name = "SITE")]
        site: Option<String>,
    },
    /// Import a provider board (first time: its columns, mapped to their
    /// statuses) and the chosen issues; issues already in are refreshed
    Run {
        /// The provider's board id (`work import boards`)
        #[arg(long, value_name = "ID")]
        board: String,
        /// An issue to import (repeatable), e.g. --issue APP-128
        #[arg(long = "issue", value_name = "KEY", required_unless_present = "all")]
        issues: Vec<String>,
        /// Import every issue on the board
        #[arg(long, conflicts_with = "issues")]
        all: bool,
        /// The Drogon project whose workspace the tickets' sessions start in
        #[arg(long, value_name = "PROJECT")]
        project: Option<String>,
        #[arg(long, value_name = "PROVIDER")]
        provider: Option<String>,
        #[arg(long, value_name = "SITE")]
        site: Option<String>,
    },
    /// Remove an imported board and its tickets from Drogon (the provider
    /// is untouched; linked sessions keep running)
    Remove {
        /// Imported board id or name
        #[arg(long, value_name = "BOARD")]
        board: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum WorkColumnAction {
    /// List the columns in board order with their prompt configuration
    List {
        /// An imported board (id or name); default My work
        #[arg(long, value_name = "BOARD")]
        board: Option<String>,
    },
    /// Add a column
    Create {
        /// Column name, unique on the board (1..=64 chars)
        #[arg(long, value_name = "NAME")]
        name: String,
        /// Add it to this imported board (id or name); default My work
        #[arg(long, value_name = "BOARD")]
        board: Option<String>,
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
        /// {ticket.column} {ticket.status} {ticket.drogon_key}
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
        /// Imported boards: the provider statuses this column stands for,
        /// comma-separated ids or names (`--statuses "In Review,Blocked"`);
        /// a status belongs to one column; `none` makes it Drogon-only
        #[arg(long, value_name = "STATUSES")]
        statuses: Option<String>,
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
        /// An imported board (id or name); default My work
        #[arg(long, value_name = "BOARD")]
        board: Option<String>,
        /// On a scrum board: a sprint, `active` (default) or `backlog`
        #[arg(long, value_name = "SPRINT")]
        sprint: Option<String>,
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
        /// The sprint being viewed; a closed sprint refuses the move
        #[arg(long, value_name = "SPRINT")]
        sprint: Option<String>,
    },
    /// Imported boards: settle a status conflict (the provider changed the
    /// status while your move was unsynced)
    Resolve {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        /// theirs (keep the source's status; the card goes to its column;
        /// `jira`, `linear` and `github` also work) | ours (push your move)
        #[arg(long, value_name = "theirs|ours")]
        keep: String,
    },
    /// Scrum boards: carry a ticket over to the active sprint, send it to
    /// the backlog, or put it in an open sprint (unsynced until pushed)
    Sprint {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        /// active | backlog | a sprint id or name
        #[arg(long, value_name = "SPRINT")]
        to: String,
    },
    /// Start a new session in the ticket's workspace, linked to the ticket
    NewSession {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        /// claude | codex | opencode | pi | antigravity (default: the
        /// column's or the default agent)
        #[arg(long, value_name = "HARNESS")]
        harness: Option<String>,
        /// A first prompt for the session
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        prompt: Option<String>,
    },
    /// Name a linked session on this ticket (an empty title restores the
    /// session's own)
    RenameSession {
        /// Ticket id or key
        #[arg(long, value_name = "TICKET")]
        ticket: String,
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TITLE", allow_hyphen_values = true)]
        title: String,
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

/// One daemon call: the method, its params and the human renderer.
type WorkCall = (&'static str, Value, fn(&Value) -> String);

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
        WorkAction::Board {
            project,
            board,
            sprint,
        } => {
            for (flag, value) in [("project", project), ("board", board), ("sprint", sprint)] {
                if let Some(v) = value {
                    nonempty(flag, v)?;
                }
            }
        }
        WorkAction::Boards | WorkAction::Sources => {}
        WorkAction::Source { action } => match action {
            WorkSourceAction::Enable { provider }
            | WorkSourceAction::Disable { provider }
            | WorkSourceAction::Disconnect { provider }
            | WorkSourceAction::Connect { provider, .. } => nonempty("provider", provider)?,
        },
        WorkAction::Import { action } => match action {
            WorkImportAction::Boards { .. } => {}
            WorkImportAction::Preview { board, .. } | WorkImportAction::Remove { board } => {
                nonempty("board", board)?
            }
            WorkImportAction::Run { board, issues, .. } => {
                nonempty("board", board)?;
                for issue in issues {
                    nonempty("issue", issue)?;
                }
            }
        },
        WorkAction::Sync { board } => nonempty("board", board)?,
        WorkAction::Push { board, ticket } => {
            if let Some(b) = board {
                nonempty("board", b)?;
            }
            if let Some(t) = ticket {
                nonempty("ticket", t)?;
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
            WorkColumnAction::List { .. } => {}
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
            | WorkTicketAction::Delete { ticket }
            | WorkTicketAction::NewSession { ticket, .. } => nonempty("ticket", ticket)?,
            WorkTicketAction::Resolve { ticket, keep } => {
                nonempty("ticket", ticket)?;
                if !["theirs", "ours", "jira", "linear", "github"].contains(&keep.as_str()) {
                    return Err(usage("--keep must be theirs or ours"));
                }
            }
            WorkTicketAction::Sprint { ticket, to } => {
                nonempty("ticket", ticket)?;
                nonempty("to", to)?;
            }
            WorkTicketAction::RenameSession {
                ticket, session, ..
            } => {
                nonempty("ticket", ticket)?;
                nonempty("session", session)?;
            }
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
    if needs_sources(action) {
        crate::commands::require_capability(client, request_id, "work.sources.v1", "Work sources")
            .await?;
    }
    if needs_boards(action) {
        crate::commands::require_capability(
            client,
            request_id,
            "work.boards.v1",
            "imported Work boards",
        )
        .await?;
    }
    let (method, params, human): (&str, Value, fn(&Value) -> String) = match action {
        WorkAction::Board {
            project,
            board,
            sprint,
        } => (
            "work.board",
            board_params(project, board, sprint),
            render_board,
        ),
        WorkAction::Boards => ("work.board", json!({}), render_boards),
        WorkAction::Sources => ("work.sources", json!({}), render_sources),
        WorkAction::Source { action } => source_call(action)?,
        WorkAction::Import { action } => import_call(action),
        WorkAction::Sync { board } => ("work.board_sync", json!({ "boardId": board }), render_sync),
        WorkAction::Push { board, ticket } => match (board, ticket) {
            (_, Some(t)) => ("work.ticket_push", json!({ "ticketId": t }), render_push),
            (Some(b), None) => (
                "work.board_push",
                json!({ "boardId": b }),
                render_board_push,
            ),
            (None, None) => return Err(usage("work push needs --board or --ticket")),
        },
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
        "work.column_send"
            | "work.ticket_move"
            | "work.ticket_create"
            | "work.session_open"
            | "work.board_import"
            | "work.board_sync"
            | "work.board_push"
            | "work.ticket_push"
            | "work.ticket_resolve"
            | "work.ticket_session_start"
            | "work.column_update"
            | "work.source_connect"
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

/// Verbs that only exist with Linear/GitHub sources (`work.sources.v1`).
fn needs_sources(action: &WorkAction) -> bool {
    matches!(action, WorkAction::Sources | WorkAction::Source { .. })
}

fn source_call(action: &WorkSourceAction) -> Result<WorkCall, CliError> {
    Ok(match action {
        WorkSourceAction::Enable { provider } => (
            "work.source_update",
            json!({ "provider": provider, "enabled": true }),
            render_source,
        ),
        WorkSourceAction::Disable { provider } => (
            "work.source_update",
            json!({ "provider": provider, "enabled": false }),
            render_source,
        ),
        WorkSourceAction::Disconnect { provider } => (
            "work.source_disconnect",
            json!({ "provider": provider }),
            render_source,
        ),
        WorkSourceAction::Connect {
            provider,
            api_key_stdin,
            api_url,
        } => {
            let mut params = json!({ "provider": provider });
            if *api_key_stdin {
                let mut key = String::new();
                std::io::Read::read_to_string(&mut std::io::stdin(), &mut key)
                    .map_err(|err| usage(format!("cannot read the key from stdin: {err}")))?;
                let key = key.trim();
                if key.is_empty() {
                    return Err(usage("--api-key-stdin read an empty key"));
                }
                params["apiKey"] = json!(key);
            }
            if let Some(url) = api_url {
                params["apiUrl"] = json!(url);
            }
            ("work.source_connect", params, render_source)
        }
    })
}

fn render_source(s: &Value) -> String {
    let state = if s["enabled"] == false {
        "off".to_string()
    } else if s["connected"] == true {
        match (s["account"].as_str(), s["via"].as_str()) {
            (Some(account), Some("gh")) => format!("connected as {account} (gh login)"),
            (Some(account), _) => format!("connected as {account}"),
            (None, Some("gh")) => "connected (gh login)".to_string(),
            _ => "connected".to_string(),
        }
    } else {
        match s["connect"].as_str() {
            Some("tasks") => "not connected (connect Jira on the Tasks page)".to_string(),
            Some("api_key") => "not connected (work source connect --api-key-stdin)".to_string(),
            _ => {
                "not connected (gh auth login, or work source connect --api-key-stdin)".to_string()
            }
        }
    };
    let mut line = format!(
        "{}  {}  — {} with {}s, {} imported",
        text(&s["name"]),
        state,
        s["boardsTerm"].as_str().unwrap_or("boards"),
        text(&s["sprintTerm"]),
        s["boards"]
    );
    if let Some(error) = s["error"].as_str() {
        line.push_str(&format!("\n  {error}"));
    }
    line
}

fn render_sources(v: &Value) -> String {
    v["sources"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(render_source)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Verbs that only exist with imported boards (`work.boards.v1`).
fn needs_boards(action: &WorkAction) -> bool {
    match action {
        WorkAction::Board { board, sprint, .. } => board.is_some() || sprint.is_some(),
        WorkAction::Boards
        | WorkAction::Sources
        | WorkAction::Source { .. }
        | WorkAction::Import { .. }
        | WorkAction::Sync { .. }
        | WorkAction::Push { .. } => true,
        WorkAction::Column { action } => match action {
            WorkColumnAction::List { board } | WorkColumnAction::Create { board, .. } => {
                board.is_some()
            }
            WorkColumnAction::Update { statuses, .. } => statuses.is_some(),
            _ => false,
        },
        WorkAction::Ticket { action } => match action {
            WorkTicketAction::List { board, sprint, .. } => board.is_some() || sprint.is_some(),
            WorkTicketAction::Move { sprint, .. } => sprint.is_some(),
            WorkTicketAction::Resolve { .. }
            | WorkTicketAction::Sprint { .. }
            | WorkTicketAction::NewSession { .. }
            | WorkTicketAction::RenameSession { .. } => true,
            _ => false,
        },
        WorkAction::Sends { .. } => false,
    }
}

fn board_params(
    project: &Option<String>,
    board: &Option<String>,
    sprint: &Option<String>,
) -> Value {
    let mut params = json!({});
    for (key, value) in [
        ("projectId", project),
        ("boardId", board),
        ("sprintId", sprint),
    ] {
        if let Some(v) = value {
            params[key] = json!(v);
        }
    }
    params
}

fn provider_params(provider: &Option<String>, site: &Option<String>) -> Value {
    let mut params = json!({});
    if let Some(p) = provider {
        params["provider"] = json!(p);
    }
    if let Some(s) = site {
        params["siteId"] = json!(s);
    }
    params
}

fn import_call(action: &WorkImportAction) -> WorkCall {
    match action {
        WorkImportAction::Boards { provider, site } => (
            "work.provider_boards",
            provider_params(provider, site),
            render_provider_boards,
        ),
        WorkImportAction::Preview {
            board,
            scope,
            provider,
            site,
        } => {
            let mut params = provider_params(provider, site);
            params["externalBoardId"] = json!(board);
            if let Some(scope) = scope {
                params["scope"] = json!(scope);
            }
            ("work.import_preview", params, render_import_preview)
        }
        WorkImportAction::Run {
            board,
            issues,
            all,
            project,
            provider,
            site,
        } => {
            let mut params = provider_params(provider, site);
            params["externalBoardId"] = json!(board);
            if *all {
                params["all"] = json!(true);
            } else {
                params["issueKeys"] = json!(issues);
            }
            if let Some(p) = project {
                params["projectId"] = json!(p);
            }
            ("work.board_import", params, |v| {
                format!(
                    "Imported {} issue(s) into {} ({} already there, refreshed).\n  board id: {}",
                    v["imported"],
                    text(&v["board"]["name"]),
                    v["refreshed"],
                    text(&v["board"]["id"]),
                )
            })
        }
        WorkImportAction::Remove { board } => {
            ("work.board_delete", json!({ "boardId": board }), |v| {
                format!(
                    "Removed {} and its {} ticket(s) from Drogon; the provider is untouched.",
                    text(&v["name"]),
                    v["tickets"]
                )
            })
        }
    }
}

fn column_call(action: &WorkColumnAction) -> Result<WorkCall, CliError> {
    Ok(match action {
        WorkColumnAction::List { board } => (
            "work.board",
            board_params(&None, board, &None),
            render_columns,
        ),
        WorkColumnAction::Create {
            name,
            board,
            icon,
            index,
        } => {
            let mut params = json!({ "name": name });
            if let Some(b) = board {
                params["boardId"] = json!(b);
            }
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
            statuses,
        } => {
            let mut params = json!({ "columnId": column });
            if let Some(list) = statuses {
                let ids: Vec<&str> = if list.trim().eq_ignore_ascii_case("none") {
                    Vec::new()
                } else {
                    list.split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .collect()
                };
                params["statusIds"] = json!(ids);
            }
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

fn ticket_call(action: &WorkTicketAction) -> Result<WorkCall, CliError> {
    Ok(match action {
        WorkTicketAction::List {
            project,
            board,
            sprint,
            ..
        } => (
            "work.board",
            board_params(project, board, sprint),
            render_board,
        ),
        WorkTicketAction::Resolve { ticket, keep } => (
            "work.ticket_resolve",
            json!({ "ticketId": ticket, "keep": keep }),
            render_ticket_with_delivery,
        ),
        WorkTicketAction::Sprint { ticket, to } => (
            "work.ticket_sprint",
            json!({ "ticketId": ticket, "to": to }),
            render_ticket,
        ),
        WorkTicketAction::NewSession {
            ticket,
            harness,
            prompt,
        } => {
            let mut params = json!({ "ticketId": ticket });
            if let Some(h) = harness {
                params["harnessId"] = json!(h);
            }
            if let Some(p) = prompt {
                params["prompt"] = json!(p);
            }
            ("work.ticket_session_start", params, |v| {
                format!(
                    "Started session {} for {}.\n{}",
                    text(&v["session"]["id"]),
                    v["externalKey"].as_str().unwrap_or(text(&v["key"])),
                    render_ticket(v)
                )
            })
        }
        WorkTicketAction::RenameSession {
            ticket,
            session,
            title,
        } => (
            "work.ticket_session_rename",
            json!({ "ticketId": ticket, "sessionId": session, "title": title }),
            render_ticket,
        ),
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
            sprint,
        } => {
            let mut params = json!({ "ticketId": ticket, "columnId": column });
            if let Some(i) = index {
                params["index"] = json!(i);
            }
            if let Some(s) = sprint {
                params["sprintId"] = json!(s);
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

fn source_name(provider: &Value) -> &str {
    match provider.as_str() {
        Some("jira") => "Jira",
        Some("linear") => "Linear",
        Some("github") => "GitHub",
        _ => "the source",
    }
}

/// What an imported ticket's card says about its sync state.
fn sync_note(t: &Value) -> Option<String> {
    let provider = source_name(&t["provider"]);
    match t["sync"].as_str()? {
        "pending" if t["pendingStatus"].is_object() => Some(format!(
            "not synced to {provider} → {}",
            text(&t["pendingStatus"]["name"])
        )),
        "pending" => Some(format!(
            "not synced to {provider} → {}",
            t["sprintName"].as_str().unwrap_or("backlog")
        )),
        "conflict" => Some(format!(
            "{provider}: {} (yours: {}) — resolve",
            text(&t["externalStatus"]["name"]),
            text(&t["pendingStatus"]["name"])
        )),
        "error" => Some(format!("push refused: {}", text(&t["pushError"]))),
        "unmapped" => Some(format!(
            "status '{}' not mapped",
            text(&t["externalStatus"]["name"])
        )),
        "removed" => Some(format!("not in {provider} anymore")),
        _ => None,
    }
}

fn ticket_line(t: &Value) -> String {
    let mut line = match t["externalKey"].as_str() {
        Some(ext) => format!("{ext}  {}", text(&t["title"])),
        None => format!("{}  {}", text(&t["key"]), text(&t["title"])),
    };
    let facts: Vec<&str> = ["issueType", "priority", "assignee"]
        .iter()
        .filter_map(|f| t[*f].as_str())
        .collect();
    if !facts.is_empty() {
        line.push_str(&format!("  [{}]", facts.join(" · ")));
    } else if let Some(project) = t["projectName"].as_str() {
        line.push_str(&format!("  [{project}]"));
    }
    if let Some(from) = t["carriedFrom"].as_str() {
        line.push_str(&format!("  carried from {from}"));
    }
    if let Some(n) = t["prNumber"].as_i64() {
        line.push_str(&format!("  PR #{n}"));
    }
    let sessions = t["sessions"].as_array().map_or(0, Vec::len);
    line.push_str(&format!("  {sessions} session(s)"));
    if let Some(note) = sync_note(t) {
        line.push_str(&format!("  ({note})"));
    }
    line
}

fn board_heading(board: &Value) -> Option<String> {
    let b = &board["board"];
    if b.is_null() || b["id"] == "local" {
        return None;
    }
    let view = &board["view"];
    let mut heading = format!("{} · {}", text(&b["name"]), source_name(&b["provider"]));
    match view["kind"].as_str() {
        Some("backlog") => heading.push_str(" · Backlog (prompts paused)"),
        Some("sprint") => {
            heading.push_str(&format!(
                " · {} ({})",
                text(&view["sprint"]["name"]),
                text(&view["sprint"]["state"])
            ));
            if view["readOnly"] == true {
                heading.push_str(" · read-only, prompts paused");
            } else if view["promptsPaused"] == true {
                heading.push_str(" · prompts paused");
            }
        }
        _ => {}
    }
    if b["pendingCount"].as_i64().unwrap_or(0) > 0 {
        heading.push_str(&format!(" · {} unsynced", b["pendingCount"]));
    }
    if let Some(error) = b["lastSyncError"].as_str() {
        heading.push_str(&format!("\n  last sync failed: {error}"));
    }
    Some(heading)
}

fn render_boards(board: &Value) -> String {
    board["boards"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|b| {
            let mut line = format!("{}  ({} ticket(s))", text(&b["name"]), b["ticketCount"]);
            if b["provider"].is_string() {
                line.push_str(&format!(
                    "  {} {} board {}",
                    text(&b["provider"]),
                    text(&b["kind"]),
                    text(&b["externalId"])
                ));
                if b["pendingCount"].as_i64().unwrap_or(0) > 0 {
                    line.push_str(&format!("  {} unsynced", b["pendingCount"]));
                }
            }
            line.push_str(&format!("\n  id: {}", text(&b["id"])));
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_provider_boards(v: &Value) -> String {
    let boards = v["boards"].as_array().cloned().unwrap_or_default();
    if boards.is_empty() {
        return "The provider has no boards you can see.".to_string();
    }
    boards
        .iter()
        .map(|b| {
            let mut line = format!(
                "{}  {} ({})",
                text(&b["id"]),
                text(&b["name"]),
                text(&b["kind"])
            );
            if let Some(p) = b["projectKey"].as_str() {
                line.push_str(&format!("  project {p}"));
            }
            if b["importedBoardId"].is_string() {
                line.push_str("  imported");
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_import_preview(v: &Value) -> String {
    let mut out = vec![format!(
        "{} ({})",
        text(&v["board"]["name"]),
        text(&v["board"]["kind"])
    )];
    let columns: Vec<String> = v["columns"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|c| {
            let statuses: Vec<&str> = c["statuses"]
                .as_array()
                .map(|s| s.iter().filter_map(|x| x["name"].as_str()).collect())
                .unwrap_or_default();
            format!("{} ← {}", text(&c["name"]), statuses.join(", "))
        })
        .collect();
    out.push(format!("columns: {}", columns.join(" | ")));
    let sprints: Vec<String> = v["sprints"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|s| format!("{} ({})", text(&s["name"]), text(&s["state"])))
        .collect();
    if !sprints.is_empty() {
        out.push(format!("sprints: {}", sprints.join(", ")));
    }
    for issue in v["issues"].as_array().cloned().unwrap_or_default() {
        let sprint = issue["sprint"]["name"].as_str().unwrap_or("backlog");
        out.push(format!(
            "  {}  {}  [{} · {}]{}",
            text(&issue["key"]),
            text(&issue["title"]),
            text(&issue["status"]["name"]),
            sprint,
            if issue["importedTicketId"].is_string() {
                "  imported"
            } else {
                ""
            }
        ));
    }
    out.join("\n")
}

fn render_sync(v: &Value) -> String {
    let mut out = format!(
        "Synced {}: {} ticket(s) read, {} moved by the provider, {} conflict(s), {} gone from the provider.",
        text(&v["board"]["name"]),
        v["updated"],
        v["moved"],
        v["conflicts"],
        v["removed"]
    );
    for delivery in v["deliveries"].as_array().cloned().unwrap_or_default() {
        out.push('\n');
        out.push_str(&render_delivery(&delivery));
    }
    out
}

fn render_push(v: &Value) -> String {
    if v["nothing"] == true {
        return format!("{} has nothing to push.", text(&v["key"]));
    }
    match v["error"].as_str() {
        Some(error) => format!(
            "{}: the provider refused the push: {error}",
            text(&v["key"])
        ),
        None => format!("{}: pushed.", text(&v["key"])),
    }
}

fn render_board_push(v: &Value) -> String {
    let results = v["results"].as_array().cloned().unwrap_or_default();
    if results.is_empty() {
        return "Nothing to push.".to_string();
    }
    let mut out = vec![format!("Pushed {}, refused {}.", v["pushed"], v["failed"])];
    out.extend(results.iter().map(render_push));
    out.join("\n")
}

fn render_board(board: &Value) -> String {
    let tickets = board["tickets"].as_array().cloned().unwrap_or_default();
    let mut out: Vec<String> = board_heading(board).into_iter().collect();
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
    if t["externalKey"].is_string() {
        out.push(format!("  drogon key: {}", text(&t["key"])));
        if let Some(status) = t["externalStatus"]["name"].as_str() {
            out.push(format!("  status: {status}"));
        }
        if let Some(sprint) = t["sprintName"].as_str() {
            out.push(format!("  sprint: {sprint}"));
        }
        for s in t["sprints"].as_array().cloned().unwrap_or_default() {
            out.push(format!(
                "  · {} — {}",
                text(&s["name"]),
                text(&s["outcome"])
            ));
        }
    }
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
        match s["label"].as_str() {
            Some(label) => out.push(format!("  session \"{label}\" {}", session_summary(&s))),
            None => out.push(format!("  session {}", session_summary(&s))),
        }
    }
    for a in t["activity"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .take(5)
    {
        out.push(format!("  activity: {}", text(&a["text"])));
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
