//! Work: the Drogon ticket board (`work.*`, capability `work.v1`).
//!
//! A ticket is a Drogon record with its own key (`DRG-41`), optionally
//! linked to an external source by URL and to a pull request. Tickets sit
//! in user-defined columns; each column can carry a prompt that is typed
//! into the sessions linked to its tickets:
//!
//! - when a ticket enters the column (moved, or created in it),
//! - on a cron schedule (every ticket in the column),
//! - when a ticket's pull request changes (state, review, checks, head),
//! - or on demand (`work.column_send`, the UI's "Send now").
//!
//! Delivery per linked session: a live session is typed into right away
//! (the same framed body + separate Return keypress as `terminal send`); a
//! session that is no longer live is resumed through `harness.start` with
//! `resumeSessionId`, which falls back to a fresh start when the harness has
//! no conversation to resume; a ticket with nothing to resume gets a new
//! session in its workspace. Replacement sessions are relinked to the ticket
//! at the generic resume boundary ([`relink_resumed_session`]).
//!
//! Every delivery is recorded in `work_sends`, so the board can say when a
//! column last sent and what each session got.

use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Value, json};

use crate::{Engine, error};
use drogon_protocol::RpcError;

pub(crate) const WORK_CAPABILITY: &str = "work.v1";
pub(crate) const SCHEMA_COMPONENT: &str = "work";
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// How often a watched pull request is re-read (`gh pr view`).
pub(crate) const PR_POLL_MS: i64 = 5 * 60_000;

const MAX_NAME: usize = 64;
const MAX_TITLE: usize = 200;
const MAX_TEXT: usize = 20_000;
const MAX_MESSAGE: usize = 16_000;
const MAX_URL: usize = 2048;
const MAX_SENDS_PAGE: i64 = 200;

pub(crate) const ICONS: &[&str] = &[
    "backlog",
    "todo",
    "in_progress",
    "review",
    "qa",
    "done",
    "blocked",
];

const DEFAULT_COLUMNS: &[(&str, &str)] = &[
    ("To do", "todo"),
    ("In progress", "in_progress"),
    ("Review", "review"),
    ("QA", "qa"),
    ("Done", "done"),
];

/// One delivery at a time: a scheduled send and a drag that land together
/// must not interleave two prompts into the same composer.
static DELIVERY_LOCK: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------- schema --

pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > SCHEMA_VERSION
    {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some(format!(
                "{SCHEMA_COMPONENT} schema version {found} is newer than supported {SCHEMA_VERSION}"
            )),
        ));
    }
    if existing == Some(SCHEMA_VERSION) {
        return Ok(());
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS work_columns (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT NOT NULL,
            position INTEGER NOT NULL,
            send_on_enter INTEGER NOT NULL DEFAULT 0,
            cron TEXT,
            pr_watch INTEGER NOT NULL DEFAULT 0,
            message TEXT NOT NULL DEFAULT '',
            recipients TEXT NOT NULL DEFAULT 'all',
            harness_id TEXT,
            next_run_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_tickets (
            id TEXT PRIMARY KEY,
            key TEXT NOT NULL UNIQUE,
            project_id TEXT,
            workspace_id TEXT,
            column_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            pr_url TEXT,
            pr_number INTEGER,
            source_url TEXT,
            next_step TEXT NOT NULL DEFAULT '',
            pr_fingerprint TEXT,
            pr_checked_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS work_tickets_column ON work_tickets(column_id, position);
        CREATE TABLE IF NOT EXISTS work_ticket_sessions (
            ticket_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            linked_at INTEGER NOT NULL,
            PRIMARY KEY(ticket_id, session_id)
        );
        CREATE INDEX IF NOT EXISTS work_ticket_sessions_session ON work_ticket_sessions(session_id);
        CREATE TABLE IF NOT EXISTS work_key_counters (
            prefix TEXT PRIMARY KEY,
            next INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_sends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            column_id TEXT,
            ticket_id TEXT NOT NULL,
            trigger TEXT NOT NULL,
            message TEXT NOT NULL,
            results TEXT NOT NULL,
            at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS work_sends_column ON work_sends(column_id, at);
        CREATE INDEX IF NOT EXISTS work_sends_ticket ON work_sends(ticket_id, at);",
    )?;
    let columns: i64 = tx.query_row("SELECT COUNT(*) FROM work_columns", [], |r| r.get(0))?;
    if columns == 0 {
        let now = crate::now_unix_ms() as i64;
        for (index, (name, icon)) in DEFAULT_COLUMNS.iter().enumerate() {
            tx.execute(
                "INSERT INTO work_columns (id, name, icon, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    name,
                    icon,
                    index as i64,
                    now
                ],
            )?;
        }
    }
    tx.execute(
        "INSERT INTO schema_versions (component, version) VALUES (?1, ?2)
         ON CONFLICT(component) DO UPDATE SET version = excluded.version",
        params![SCHEMA_COMPONENT, SCHEMA_VERSION],
    )?;
    Ok(())
}

// ------------------------------------------------------------- records --

#[derive(Clone, Debug)]
struct Column {
    id: String,
    name: String,
    icon: String,
    position: i64,
    send_on_enter: bool,
    cron: Option<String>,
    pr_watch: bool,
    message: String,
    recipients: String,
    harness_id: Option<String>,
    next_run_at: Option<i64>,
}

#[derive(Clone, Debug)]
struct Ticket {
    id: String,
    key: String,
    project_id: Option<String>,
    workspace_id: Option<String>,
    column_id: String,
    position: i64,
    title: String,
    description: String,
    pr_url: Option<String>,
    pr_number: Option<i64>,
    source_url: Option<String>,
    next_step: String,
    pr_fingerprint: Option<String>,
    pr_checked_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

const COLUMN_SELECT: &str = "SELECT id, name, icon, position, send_on_enter, cron, pr_watch, message, recipients, harness_id, next_run_at FROM work_columns";
const TICKET_SELECT: &str = "SELECT id, key, project_id, workspace_id, column_id, position, title, description, pr_url, pr_number, source_url, next_step, pr_fingerprint, pr_checked_at, created_at, updated_at FROM work_tickets";

fn column_from_row(r: &rusqlite::Row) -> rusqlite::Result<Column> {
    Ok(Column {
        id: r.get(0)?,
        name: r.get(1)?,
        icon: r.get(2)?,
        position: r.get(3)?,
        send_on_enter: r.get::<_, i64>(4)? != 0,
        cron: r.get(5)?,
        pr_watch: r.get::<_, i64>(6)? != 0,
        message: r.get(7)?,
        recipients: r.get(8)?,
        harness_id: r.get(9)?,
        next_run_at: r.get(10)?,
    })
}

fn ticket_from_row(r: &rusqlite::Row) -> rusqlite::Result<Ticket> {
    Ok(Ticket {
        id: r.get(0)?,
        key: r.get(1)?,
        project_id: r.get(2)?,
        workspace_id: r.get(3)?,
        column_id: r.get(4)?,
        position: r.get(5)?,
        title: r.get(6)?,
        description: r.get(7)?,
        pr_url: r.get(8)?,
        pr_number: r.get(9)?,
        source_url: r.get(10)?,
        next_step: r.get(11)?,
        pr_fingerprint: r.get(12)?,
        pr_checked_at: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

fn list_columns(conn: &Connection) -> Result<Vec<Column>, RpcError> {
    let mut stmt = conn
        .prepare(&format!("{COLUMN_SELECT} ORDER BY position, created_at"))
        .map_err(error::from_sqlite)?;
    stmt.query_map([], column_from_row)
        .map_err(error::from_sqlite)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error::from_sqlite)
}

fn get_column(conn: &Connection, id: &str) -> Result<Column, RpcError> {
    conn.query_row(
        &format!(
            "{COLUMN_SELECT} WHERE id = ?1 OR lower(name) = lower(?1) ORDER BY id = ?1 DESC LIMIT 1"
        ),
        params![id],
        column_from_row,
    )
    .optional()
    .map_err(error::from_sqlite)?
    .ok_or_else(|| error::not_found(format!("work column {id} not found")))
}

fn list_tickets(conn: &Connection, column_id: Option<&str>) -> Result<Vec<Ticket>, RpcError> {
    let (sql, args): (String, Vec<String>) = match column_id {
        Some(id) => (
            format!("{TICKET_SELECT} WHERE column_id = ?1 ORDER BY position, created_at"),
            vec![id.to_string()],
        ),
        None => (
            format!("{TICKET_SELECT} ORDER BY position, created_at"),
            vec![],
        ),
    };
    let mut stmt = conn.prepare(&sql).map_err(error::from_sqlite)?;
    stmt.query_map(rusqlite::params_from_iter(args.iter()), ticket_from_row)
        .map_err(error::from_sqlite)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error::from_sqlite)
}

/// Resolves a ticket by id or by key (`DRG-41`, case-insensitive).
fn get_ticket(conn: &Connection, id: &str) -> Result<Ticket, RpcError> {
    conn.query_row(
        &format!("{TICKET_SELECT} WHERE id = ?1 OR upper(key) = upper(?1) LIMIT 1"),
        params![id],
        ticket_from_row,
    )
    .optional()
    .map_err(error::from_sqlite)?
    .ok_or_else(|| error::not_found(format!("ticket {id} not found")))
}

fn linked_session_ids(conn: &Connection, ticket_id: &str) -> Result<Vec<String>, RpcError> {
    let mut stmt = conn
        .prepare(
            "SELECT session_id FROM work_ticket_sessions WHERE ticket_id = ?1 ORDER BY linked_at, session_id",
        )
        .map_err(error::from_sqlite)?;
    stmt.query_map(params![ticket_id], |r| r.get::<_, String>(0))
        .map_err(error::from_sqlite)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error::from_sqlite)
}

fn link_session_in(conn: &Connection, ticket_id: &str, session_id: &str) -> Result<(), RpcError> {
    conn.execute(
        "INSERT OR IGNORE INTO work_ticket_sessions (ticket_id, session_id, linked_at) VALUES (?1, ?2, ?3)",
        params![ticket_id, session_id, crate::now_unix_ms() as i64],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

/// A resumed session replaces the prior one on every ticket that linked it,
/// keeping the prior link's place in the ticket's order. Best-effort callers
/// (the resume boundary) ignore the error; nothing else depends on it.
pub(crate) fn relink_resumed_session(
    conn: &Connection,
    prior_session_id: &str,
    replacement_session_id: &str,
) -> rusqlite::Result<usize> {
    if prior_session_id == replacement_session_id {
        return Ok(0);
    }
    conn.execute(
        "INSERT OR IGNORE INTO work_ticket_sessions (ticket_id, session_id, linked_at)
         SELECT ticket_id, ?2, linked_at FROM work_ticket_sessions WHERE session_id = ?1",
        params![prior_session_id, replacement_session_id],
    )?;
    conn.execute(
        "DELETE FROM work_ticket_sessions WHERE session_id = ?1",
        params![prior_session_id],
    )
}

// ---------------------------------------------------------- validation --

fn bounded_text(
    value: &str,
    field: &str,
    max: usize,
    allow_empty: bool,
) -> Result<String, RpcError> {
    let trimmed = value.trim();
    if (!allow_empty && trimmed.is_empty()) || value.chars().count() > max || value.contains('\0') {
        return Err(error::invalid_argument(format!(
            "{field} must be {}1..{max} characters without NUL",
            if allow_empty { "0.." } else { "" }
        )));
    }
    Ok(if allow_empty {
        value.to_string()
    } else {
        trimmed.to_string()
    })
}

fn validate_url(value: &str, field: &str) -> Result<String, RpcError> {
    let trimmed = value.trim();
    let parsed = url::Url::parse(trimmed)
        .map_err(|_| error::invalid_argument(format!("{field} must be an http(s) URL")))?;
    if trimmed.len() > MAX_URL
        || !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(error::invalid_argument(format!(
            "{field} must be an http(s) URL"
        )));
    }
    Ok(trimmed.to_string())
}

/// `https://github.com/o/r/pull/648`, `#648` or `648` → (url, number).
fn parse_pr(value: &str) -> Result<(Option<String>, Option<i64>), RpcError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok((None, None));
    }
    let bare = trimmed.trim_start_matches('#');
    if let Ok(number) = bare.parse::<i64>()
        && number > 0
    {
        return Ok((None, Some(number)));
    }
    let url = validate_url(trimmed, "pr")?;
    let number = url::Url::parse(&url)
        .ok()
        .and_then(|parsed| {
            let segments: Vec<String> = parsed.path_segments()?.map(str::to_owned).collect();
            let at = segments
                .iter()
                .position(|s| s == "pull" || s == "pulls" || s == "merge_requests")?;
            segments.get(at + 1)?.parse::<i64>().ok()
        })
        .filter(|n| *n > 0);
    Ok((Some(url), number))
}

fn validate_icon(value: &str) -> Result<String, RpcError> {
    if ICONS.contains(&value) {
        Ok(value.to_string())
    } else {
        Err(error::invalid_argument(format!(
            "icon must be one of: {}",
            ICONS.join(", ")
        )))
    }
}

fn validate_recipients(value: &str) -> Result<String, RpcError> {
    match value {
        "all" | "primary" => Ok(value.to_string()),
        _ => Err(error::invalid_argument(
            "recipients must be \"all\" or \"primary\"",
        )),
    }
}

fn validate_harness(value: &str) -> Result<String, RpcError> {
    match value {
        "claude" | "codex" | "opencode" | "pi" | "antigravity" => Ok(value.to_string()),
        _ => Err(error::invalid_argument(
            "harnessId must be one of: claude, codex, opencode, pi, antigravity",
        )),
    }
}

/// `*/15 * * * *` as-is, or a shorthand interval (`15m`, `2h`, `1d`).
pub(crate) fn normalize_schedule(value: &str) -> Result<String, RpcError> {
    let trimmed = value.trim();
    let interval = |suffix: char| -> Option<i64> {
        trimmed
            .strip_suffix(suffix)?
            .parse::<i64>()
            .ok()
            .filter(|n| *n > 0)
    };
    let cron = if let Some(minutes) = interval('m') {
        if minutes >= 60 {
            return Err(error::invalid_argument(
                "minute intervals must be 1..59 (use hours, e.g. 2h, for longer)",
            ));
        }
        format!("*/{minutes} * * * *")
    } else if let Some(hours) = interval('h') {
        if hours >= 24 {
            return Err(error::invalid_argument(
                "hour intervals must be 1..23 (use 1d)",
            ));
        }
        format!("0 */{hours} * * *")
    } else if interval('d') == Some(1) {
        "0 0 * * *".to_string()
    } else {
        trimmed.to_string()
    };
    crate::automations::scheduler::validate_cron(&cron).map_err(error::invalid_argument)
}

/// Ticket key prefix from a project name: the first letter, then the next
/// consonants (`Drogon` → `DRG`), falling back to `WRK` without a project.
fn key_prefix(project_name: Option<&str>) -> String {
    let Some(name) = project_name else {
        return "WRK".to_string();
    };
    let letters: Vec<char> = name
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    let Some(first) = letters.first() else {
        return "WRK".to_string();
    };
    let mut prefix = first.to_string();
    for c in letters.iter().skip(1) {
        if prefix.len() >= 3 {
            break;
        }
        if !"AEIOU".contains(*c) {
            prefix.push(*c);
        }
    }
    for c in letters.iter().skip(1) {
        if prefix.len() >= 2 {
            break;
        }
        prefix.push(*c);
    }
    prefix
}

fn next_key(conn: &Connection, prefix: &str) -> Result<String, RpcError> {
    let next: i64 = conn
        .query_row(
            "SELECT next FROM work_key_counters WHERE prefix = ?1",
            params![prefix],
            |r| r.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?
        .unwrap_or(1);
    conn.execute(
        "INSERT INTO work_key_counters (prefix, next) VALUES (?1, ?2)
         ON CONFLICT(prefix) DO UPDATE SET next = excluded.next",
        params![prefix, next + 1],
    )
    .map_err(error::from_sqlite)?;
    Ok(format!("{prefix}-{next}"))
}

fn project_name(conn: &Connection, project_id: &str) -> Result<String, RpcError> {
    conn.query_row(
        "SELECT name FROM projects WHERE id = ?1",
        params![project_id],
        |r| r.get(0),
    )
    .optional()
    .map_err(error::from_sqlite)?
    .ok_or_else(|| error::not_found(format!("project {project_id} not found")))
}

/// A project by id, or by its name (case-insensitive) when unambiguous.
fn resolve_project(conn: &Connection, value: &str) -> Result<String, RpcError> {
    let mut stmt = conn
        .prepare("SELECT id FROM projects WHERE id = ?1 OR lower(name) = lower(?1) ORDER BY id = ?1 DESC")
        .map_err(error::from_sqlite)?;
    let ids = stmt
        .query_map(params![value], |r| r.get::<_, String>(0))
        .map_err(error::from_sqlite)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error::from_sqlite)?;
    match ids.as_slice() {
        [] => Err(error::not_found(format!("project {value} not found"))),
        [only] => Ok(only.clone()),
        [first, ..] if first == value => Ok(first.clone()),
        _ => Err(error::invalid_argument(format!(
            "more than one project is named {value}; pass its id"
        ))),
    }
}

fn require_workspace(conn: &Connection, workspace_id: &str) -> Result<(), RpcError> {
    let found: Option<String> = conn
        .query_row(
            "SELECT id FROM workspaces WHERE id = ?1",
            params![workspace_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    found
        .map(|_| ())
        .ok_or_else(|| error::not_found(format!("workspace {workspace_id} not found")))
}

/// Renumbers a column's tickets 0..n with `moving` inserted at `index`.
fn place_ticket(
    conn: &Connection,
    column_id: &str,
    moving: &str,
    index: Option<usize>,
) -> Result<(), RpcError> {
    let mut order: Vec<String> = list_tickets(conn, Some(column_id))?
        .into_iter()
        .map(|t| t.id)
        .filter(|id| id != moving)
        .collect();
    let at = index.unwrap_or(order.len()).min(order.len());
    order.insert(at, moving.to_string());
    for (position, id) in order.iter().enumerate() {
        conn.execute(
            "UPDATE work_tickets SET position = ?2 WHERE id = ?1",
            params![id, position as i64],
        )
        .map_err(error::from_sqlite)?;
    }
    Ok(())
}

// -------------------------------------------------------------- params --

fn str_field<'a>(params: &'a Value, field: &str) -> Result<Option<&'a str>, RpcError> {
    match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(error::invalid_argument(format!("{field} must be a string"))),
    }
}

fn required(params: &Value, field: &str) -> Result<String, RpcError> {
    str_field(params, field)?
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| error::invalid_argument(format!("{field} is required")))
}

fn bool_field(params: &Value, field: &str) -> Result<Option<bool>, RpcError> {
    match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(error::invalid_argument(format!(
            "{field} must be a boolean"
        ))),
    }
}

fn index_field(params: &Value, field: &str) -> Result<Option<usize>, RpcError> {
    match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v.as_u64().map(|n| Some(n as usize)).ok_or_else(|| {
            error::invalid_argument(format!("{field} must be a non-negative integer"))
        }),
    }
}

/// `field` present as `null` or `""` clears it; absent leaves it alone.
fn clearable(params: &Value, field: &str) -> Result<Option<Option<String>>, RpcError> {
    match params.get(field) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(Value::String(s)) if s.trim().is_empty() => Ok(Some(None)),
        Some(Value::String(s)) => Ok(Some(Some(s.clone()))),
        Some(_) => Err(error::invalid_argument(format!(
            "{field} must be a string or null"
        ))),
    }
}

fn reject_unknown(params: &Value, allowed: &[&str]) -> Result<(), RpcError> {
    if let Some(object) = params.as_object() {
        if let Some(unknown) = object.keys().find(|k| !allowed.contains(&k.as_str())) {
            return Err(error::invalid_argument(format!("unknown field {unknown}")));
        }
        Ok(())
    } else if params.is_null() {
        Ok(())
    } else {
        Err(error::invalid_argument("expected an object of params"))
    }
}

// ------------------------------------------------------------ messages --

/// `{ticket.id}` style placeholders. Unknown placeholders are left as typed.
fn render_message(
    template: &str,
    ticket: &Ticket,
    column: Option<&Column>,
    project: Option<&str>,
) -> String {
    let pr = match (&ticket.pr_url, ticket.pr_number) {
        (Some(url), _) => url.clone(),
        (None, Some(n)) => format!("PR #{n}"),
        (None, None) => "(no pull request)".to_string(),
    };
    let pairs = [
        ("{ticket.id}", ticket.key.clone()),
        ("{ticket.key}", ticket.key.clone()),
        ("{ticket.title}", ticket.title.clone()),
        ("{ticket.description}", ticket.description.clone()),
        ("{ticket.pr}", pr),
        (
            "{ticket.pr_number}",
            ticket.pr_number.map(|n| n.to_string()).unwrap_or_default(),
        ),
        (
            "{ticket.url}",
            ticket.source_url.clone().unwrap_or_default(),
        ),
        (
            "{ticket.source}",
            ticket.source_url.clone().unwrap_or_default(),
        ),
        ("{ticket.next}", ticket.next_step.clone()),
        ("{ticket.project}", project.unwrap_or("").to_string()),
        (
            "{ticket.column}",
            column.map(|c| c.name.clone()).unwrap_or_default(),
        ),
        (
            "{column.name}",
            column.map(|c| c.name.clone()).unwrap_or_default(),
        ),
    ];
    let mut out = template.replace("\r\n", "\n").replace('\r', "\n");
    for (placeholder, value) in pairs {
        out = out.replace(placeholder, &value);
    }
    out.trim_end().to_string()
}

// ---------------------------------------------------------------- JSON --

fn column_json(conn: &Connection, column: &Column) -> Result<Value, RpcError> {
    let ticket_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM work_tickets WHERE column_id = ?1",
            params![column.id],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let last: Option<(i64, String)> = conn
        .query_row(
            "SELECT at, results FROM work_sends WHERE column_id = ?1 ORDER BY at DESC, id DESC LIMIT 1",
            params![column.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    let (last_sent_at, last_sent_count) = match last {
        Some((latest_at, _)) => {
            // Sessions reached by the most recent send (all tickets that
            // went out in the same second belong to one fan-out).
            let mut stmt = conn
                .prepare("SELECT results FROM work_sends WHERE column_id = ?1 AND at >= ?2")
                .map_err(error::from_sqlite)?;
            let rows = stmt
                .query_map(params![column.id, latest_at - 1000], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(error::from_sqlite)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error::from_sqlite)?;
            let delivered = rows
                .iter()
                .filter_map(|raw| serde_json::from_str::<Vec<Value>>(raw).ok())
                .flatten()
                .filter(|r| r["action"] != "failed" && r["action"] != "skipped")
                .count();
            (Some(latest_at), delivered as i64)
        }
        None => (None, 0),
    };
    Ok(json!({
        "id": column.id,
        "name": column.name,
        "icon": column.icon,
        "position": column.position,
        "sendOnEnter": column.send_on_enter,
        "cron": column.cron,
        "prWatch": column.pr_watch,
        "message": column.message,
        "recipients": column.recipients,
        "harnessId": column.harness_id,
        "nextRunAt": column.next_run_at,
        "ticketCount": ticket_count,
        "lastSentAt": last_sent_at,
        "lastSentCount": last_sent_count,
    }))
}

impl Engine {
    /// The linked sessions of a ticket as `session.list` rows (live handles
    /// overlaid), plus a `{id, missing: true}` row for a link whose session
    /// record is gone.
    fn work_session_rows(&self, ids: &[String]) -> Result<Vec<Value>, RpcError> {
        let rows: Vec<(String, Option<Value>)> = {
            let conn = self.db.lock().unwrap();
            let mut stmt = conn
                .prepare(&format!("{} WHERE id = ?1", crate::SESSION_LIST_SELECT))
                .map_err(error::from_sqlite)?;
            let mut out = Vec::with_capacity(ids.len());
            for id in ids {
                let row = stmt
                    .query_row(params![id], crate::row_to_session_json)
                    .optional()
                    .map_err(error::from_sqlite)?
                    .map(|(_, value)| value);
                out.push((id.clone(), row));
            }
            out
        };
        let sessions = self.sessions.lock().unwrap();
        Ok(rows
            .into_iter()
            .map(|(id, row)| match (sessions.get(&id), row) {
                (Some(handle), _) => crate::session::snapshot(handle),
                (None, Some(value)) => value,
                (None, None) => json!({ "id": id, "missing": true }),
            })
            .collect())
    }

    fn ticket_json(&self, ticket: &Ticket) -> Result<Value, RpcError> {
        let (ids, project) = {
            let conn = self.db.lock().unwrap();
            let ids = linked_session_ids(&conn, &ticket.id)?;
            let project = match &ticket.project_id {
                Some(id) => project_name(&conn, id).ok(),
                None => None,
            };
            (ids, project)
        };
        let sessions = self.work_session_rows(&ids)?;
        Ok(json!({
            "id": ticket.id,
            "key": ticket.key,
            "title": ticket.title,
            "description": ticket.description,
            "projectId": ticket.project_id,
            "projectName": project,
            "workspaceId": ticket.workspace_id,
            "columnId": ticket.column_id,
            "position": ticket.position,
            "prUrl": ticket.pr_url,
            "prNumber": ticket.pr_number,
            "sourceUrl": ticket.source_url,
            "nextStep": ticket.next_step,
            "createdAt": ticket.created_at,
            "updatedAt": ticket.updated_at,
            "sessions": sessions,
        }))
    }

    // --------------------------------------------------------- reads --

    pub(crate) fn work_board(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["projectId"])?;
        let (columns, tickets, projects) = {
            let conn = self.db.lock().unwrap();
            let project_filter = str_field(params, "projectId")?
                .map(|p| resolve_project(&conn, p))
                .transpose()?;
            let columns = list_columns(&conn)?
                .iter()
                .map(|c| column_json(&conn, c))
                .collect::<Result<Vec<_>, _>>()?;
            let tickets: Vec<Ticket> = list_tickets(&conn, None)?
                .into_iter()
                .filter(|t| {
                    project_filter
                        .as_deref()
                        .is_none_or(|p| t.project_id.as_deref() == Some(p))
                })
                .collect();
            let mut stmt = conn
                .prepare("SELECT id, name FROM projects ORDER BY name COLLATE NOCASE")
                .map_err(error::from_sqlite)?;
            let projects = stmt
                .query_map([], |r| {
                    Ok(json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)? }))
                })
                .map_err(error::from_sqlite)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error::from_sqlite)?;
            (columns, tickets, projects)
        };
        let tickets = tickets
            .iter()
            .map(|t| self.ticket_json(t))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(json!({ "columns": columns, "tickets": tickets, "projects": projects }))
    }

    pub(crate) fn work_ticket_show(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["ticketId"])?;
        let id = required(params, "ticketId")?;
        let ticket = {
            let conn = self.db.lock().unwrap();
            get_ticket(&conn, &id)?
        };
        let mut value = self.ticket_json(&ticket)?;
        let sends = self.work_sends(&json!({ "ticketId": ticket.id, "limit": 20 }))?;
        value["sends"] = sends["sends"].clone();
        Ok(value)
    }

    pub(crate) fn work_sends(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["ticketId", "columnId", "limit"])?;
        let limit = params
            .get("limit")
            .and_then(Value::as_i64)
            .unwrap_or(50)
            .clamp(1, MAX_SENDS_PAGE);
        let conn = self.db.lock().unwrap();
        let (filter, arg) = if let Some(t) = str_field(params, "ticketId")? {
            ("ticket_id = ?1", get_ticket(&conn, t)?.id)
        } else if let Some(c) = str_field(params, "columnId")? {
            ("column_id = ?1", get_column(&conn, c)?.id)
        } else {
            ("?1 = ?1", String::new())
        };
        let mut stmt = conn
            .prepare(&format!(
                "SELECT s.id, s.column_id, s.ticket_id, t.key, s.trigger, s.message, s.results, s.at
                 FROM work_sends s LEFT JOIN work_tickets t ON t.id = s.ticket_id
                 WHERE s.{filter} ORDER BY s.at DESC, s.id DESC LIMIT {limit}"
            ))
            .map_err(error::from_sqlite)?;
        let sends = stmt
            .query_map(params![arg], |r| {
                let results: String = r.get(6)?;
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "columnId": r.get::<_, Option<String>>(1)?,
                    "ticketId": r.get::<_, String>(2)?,
                    "ticketKey": r.get::<_, Option<String>>(3)?,
                    "trigger": r.get::<_, String>(4)?,
                    "message": r.get::<_, String>(5)?,
                    "results": serde_json::from_str::<Value>(&results).unwrap_or(json!([])),
                    "at": r.get::<_, i64>(7)?,
                }))
            })
            .map_err(error::from_sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error::from_sqlite)?;
        Ok(json!({ "sends": sends }))
    }

    // ------------------------------------------------------- columns --

    pub(crate) fn do_work_column_create(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["name", "icon", "index"])?;
        let name = bounded_text(&required(params, "name")?, "name", MAX_NAME, false)?;
        let icon = validate_icon(str_field(params, "icon")?.unwrap_or("todo"))?;
        let index = index_field(params, "index")?;
        let conn = self.db.lock().unwrap();
        let existing = list_columns(&conn)?;
        if existing.iter().any(|c| c.name.eq_ignore_ascii_case(&name)) {
            return Err(error::invalid_argument(format!(
                "a column named {name} already exists"
            )));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = crate::now_unix_ms() as i64;
        conn.execute(
            "INSERT INTO work_columns (id, name, icon, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, name, icon, existing.len() as i64, now],
        )
        .map_err(error::from_sqlite)?;
        reorder_columns(&conn, &id, index)?;
        column_json(&conn, &get_column(&conn, &id)?)
    }

    pub(crate) fn do_work_column_update(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(
            params,
            &[
                "columnId",
                "name",
                "icon",
                "index",
                "sendOnEnter",
                "cron",
                "prWatch",
                "message",
                "recipients",
                "harnessId",
            ],
        )?;
        let conn = self.db.lock().unwrap();
        let mut column = get_column(&conn, &required(params, "columnId")?)?;
        if let Some(name) = str_field(params, "name")? {
            let name = bounded_text(name, "name", MAX_NAME, false)?;
            if list_columns(&conn)?
                .iter()
                .any(|c| c.id != column.id && c.name.eq_ignore_ascii_case(&name))
            {
                return Err(error::invalid_argument(format!(
                    "a column named {name} already exists"
                )));
            }
            column.name = name;
        }
        if let Some(icon) = str_field(params, "icon")? {
            column.icon = validate_icon(icon)?;
        }
        if let Some(on) = bool_field(params, "sendOnEnter")? {
            column.send_on_enter = on;
        }
        if let Some(on) = bool_field(params, "prWatch")? {
            column.pr_watch = on;
        }
        if let Some(message) = str_field(params, "message")? {
            column.message = bounded_text(message, "message", MAX_MESSAGE, true)?;
        }
        if let Some(recipients) = str_field(params, "recipients")? {
            column.recipients = validate_recipients(recipients)?;
        }
        if let Some(harness) = clearable(params, "harnessId")? {
            column.harness_id = harness.as_deref().map(validate_harness).transpose()?;
        }
        if let Some(cron) = clearable(params, "cron")? {
            match cron {
                Some(raw) => {
                    let normalized = normalize_schedule(&raw)?;
                    column.next_run_at = crate::automations::scheduler::next_fire_ms(
                        &normalized,
                        crate::now_unix_ms() as f64,
                    );
                    column.cron = Some(normalized);
                }
                None => {
                    column.cron = None;
                    column.next_run_at = None;
                }
            }
        }
        conn.execute(
            "UPDATE work_columns SET name = ?2, icon = ?3, send_on_enter = ?4, cron = ?5, pr_watch = ?6,
             message = ?7, recipients = ?8, harness_id = ?9, next_run_at = ?10, updated_at = ?11 WHERE id = ?1",
            params![
                column.id,
                column.name,
                column.icon,
                column.send_on_enter as i64,
                column.cron,
                column.pr_watch as i64,
                column.message,
                column.recipients,
                column.harness_id,
                column.next_run_at,
                crate::now_unix_ms() as i64,
            ],
        )
        .map_err(error::from_sqlite)?;
        if let Some(index) = index_field(params, "index")? {
            reorder_columns(&conn, &column.id, Some(index))?;
        }
        column_json(&conn, &get_column(&conn, &column.id)?)
    }

    pub(crate) fn do_work_column_delete(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["columnId", "moveTicketsTo"])?;
        let conn = self.db.lock().unwrap();
        let column = get_column(&conn, &required(params, "columnId")?)?;
        let tickets = list_tickets(&conn, Some(&column.id))?;
        let target = match str_field(params, "moveTicketsTo")? {
            Some(t) => Some(get_column(&conn, t)?),
            None => None,
        };
        if let Some(target) = &target
            && target.id == column.id
        {
            return Err(error::invalid_argument(
                "moveTicketsTo must be another column",
            ));
        }
        if !tickets.is_empty() && target.is_none() {
            return Err(error::invalid_argument(format!(
                "column {} still holds {} ticket(s); pass moveTicketsTo",
                column.name,
                tickets.len()
            )));
        }
        if list_columns(&conn)?.len() <= 1 {
            return Err(error::invalid_argument(
                "the board needs at least one column",
            ));
        }
        if let Some(target) = &target {
            for ticket in &tickets {
                conn.execute(
                    "UPDATE work_tickets SET column_id = ?2, updated_at = ?3 WHERE id = ?1",
                    params![ticket.id, target.id, crate::now_unix_ms() as i64],
                )
                .map_err(error::from_sqlite)?;
                place_ticket(&conn, &target.id, &ticket.id, None)?;
            }
        }
        conn.execute("DELETE FROM work_columns WHERE id = ?1", params![column.id])
            .map_err(error::from_sqlite)?;
        let remaining = list_columns(&conn)?;
        for (position, c) in remaining.iter().enumerate() {
            conn.execute(
                "UPDATE work_columns SET position = ?2 WHERE id = ?1",
                params![c.id, position as i64],
            )
            .map_err(error::from_sqlite)?;
        }
        Ok(json!({ "deleted": column.id, "movedTickets": tickets.len() }))
    }

    // ------------------------------------------------------- tickets --

    pub(crate) fn do_work_ticket_create(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(
            params,
            &[
                "title",
                "description",
                "projectId",
                "workspaceId",
                "columnId",
                "prUrl",
                "sourceUrl",
                "nextStep",
                "sessionIds",
            ],
        )?;
        let title = bounded_text(&required(params, "title")?, "title", MAX_TITLE, false)?;
        let description = bounded_text(
            str_field(params, "description")?.unwrap_or(""),
            "description",
            MAX_TEXT,
            true,
        )?;
        let next_step = bounded_text(
            str_field(params, "nextStep")?.unwrap_or(""),
            "nextStep",
            MAX_TITLE,
            true,
        )?;
        let (pr_url, pr_number) = parse_pr(str_field(params, "prUrl")?.unwrap_or(""))?;
        let source_url = str_field(params, "sourceUrl")?
            .filter(|s| !s.trim().is_empty())
            .map(|s| validate_url(s, "sourceUrl"))
            .transpose()?;
        let session_ids: Vec<String> = match params.get("sessionIds") {
            None | Some(Value::Null) => vec![],
            Some(Value::Array(items)) => items
                .iter()
                .map(|v| {
                    v.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| error::invalid_argument("sessionIds must be strings"))
                })
                .collect::<Result<_, _>>()?,
            Some(_) => return Err(error::invalid_argument("sessionIds must be an array")),
        };
        let ticket_id = {
            let conn = self.db.lock().unwrap();
            let project_id = str_field(params, "projectId")?
                .map(|p| resolve_project(&conn, p))
                .transpose()?;
            let project = match &project_id {
                Some(id) => Some(project_name(&conn, id)?),
                None => None,
            };
            let workspace_id = str_field(params, "workspaceId")?.map(str::to_owned);
            if let Some(ws) = &workspace_id {
                require_workspace(&conn, ws)?;
            }
            let column = match str_field(params, "columnId")? {
                Some(c) => get_column(&conn, c)?,
                None => list_columns(&conn)?
                    .into_iter()
                    .next()
                    .ok_or_else(|| error::invalid_argument("the board has no columns"))?,
            };
            for session in &session_ids {
                self.require_session_row(&conn, session)?;
            }
            let key = next_key(&conn, &key_prefix(project.as_deref()))?;
            let id = uuid::Uuid::new_v4().to_string();
            let now = crate::now_unix_ms() as i64;
            conn.execute(
                "INSERT INTO work_tickets (id, key, project_id, workspace_id, column_id, position, title, description,
                  pr_url, pr_number, source_url, next_step, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![
                    id, key, project_id, workspace_id, column.id, i64::MAX, title, description, pr_url, pr_number,
                    source_url, next_step, now
                ],
            )
            .map_err(error::from_sqlite)?;
            place_ticket(&conn, &column.id, &id, None)?;
            for session in &session_ids {
                link_session_in(&conn, &id, session)?;
            }
            id
        };
        let delivery = self.deliver_on_enter(&ticket_id)?;
        let ticket = {
            let conn = self.db.lock().unwrap();
            get_ticket(&conn, &ticket_id)?
        };
        let mut value = self.ticket_json(&ticket)?;
        value["delivery"] = delivery;
        Ok(value)
    }

    pub(crate) fn do_work_ticket_update(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(
            params,
            &[
                "ticketId",
                "title",
                "description",
                "projectId",
                "workspaceId",
                "prUrl",
                "sourceUrl",
                "nextStep",
            ],
        )?;
        let conn = self.db.lock().unwrap();
        let mut ticket = get_ticket(&conn, &required(params, "ticketId")?)?;
        if let Some(title) = str_field(params, "title")? {
            ticket.title = bounded_text(title, "title", MAX_TITLE, false)?;
        }
        if let Some(description) = str_field(params, "description")? {
            ticket.description = bounded_text(description, "description", MAX_TEXT, true)?;
        }
        if let Some(next) = str_field(params, "nextStep")? {
            ticket.next_step = bounded_text(next, "nextStep", MAX_TITLE, true)?;
        }
        if let Some(project) = clearable(params, "projectId")? {
            ticket.project_id = project.map(|p| resolve_project(&conn, &p)).transpose()?;
        }
        if let Some(workspace) = clearable(params, "workspaceId")? {
            if let Some(id) = &workspace {
                require_workspace(&conn, id)?;
            }
            ticket.workspace_id = workspace;
        }
        if let Some(pr) = clearable(params, "prUrl")? {
            let (url, number) = parse_pr(pr.as_deref().unwrap_or(""))?;
            if number != ticket.pr_number {
                ticket.pr_fingerprint = None;
                ticket.pr_checked_at = None;
            }
            ticket.pr_url = url;
            ticket.pr_number = number;
        }
        if let Some(source) = clearable(params, "sourceUrl")? {
            ticket.source_url = source
                .as_deref()
                .map(|s| validate_url(s, "sourceUrl"))
                .transpose()?;
        }
        conn.execute(
            "UPDATE work_tickets SET title = ?2, description = ?3, next_step = ?4, project_id = ?5, workspace_id = ?6,
             pr_url = ?7, pr_number = ?8, source_url = ?9, pr_fingerprint = ?10, pr_checked_at = ?11, updated_at = ?12
             WHERE id = ?1",
            params![
                ticket.id,
                ticket.title,
                ticket.description,
                ticket.next_step,
                ticket.project_id,
                ticket.workspace_id,
                ticket.pr_url,
                ticket.pr_number,
                ticket.source_url,
                ticket.pr_fingerprint,
                ticket.pr_checked_at,
                crate::now_unix_ms() as i64,
            ],
        )
        .map_err(error::from_sqlite)?;
        let ticket = get_ticket(&conn, &ticket.id)?;
        drop(conn);
        self.ticket_json(&ticket)
    }

    pub(crate) fn do_work_ticket_move(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["ticketId", "columnId", "index"])?;
        let (ticket_id, entered) = {
            let conn = self.db.lock().unwrap();
            let ticket = get_ticket(&conn, &required(params, "ticketId")?)?;
            let column = get_column(&conn, &required(params, "columnId")?)?;
            let entered = ticket.column_id != column.id;
            if entered {
                conn.execute(
                    "UPDATE work_tickets SET column_id = ?2, updated_at = ?3 WHERE id = ?1",
                    params![ticket.id, column.id, crate::now_unix_ms() as i64],
                )
                .map_err(error::from_sqlite)?;
            }
            place_ticket(&conn, &column.id, &ticket.id, index_field(params, "index")?)?;
            if entered {
                // Close the gap in the column the ticket left.
                let left: Vec<String> = list_tickets(&conn, Some(&ticket.column_id))?
                    .into_iter()
                    .map(|t| t.id)
                    .collect();
                for (position, id) in left.iter().enumerate() {
                    conn.execute(
                        "UPDATE work_tickets SET position = ?2 WHERE id = ?1",
                        params![id, position as i64],
                    )
                    .map_err(error::from_sqlite)?;
                }
            }
            (ticket.id, entered)
        };
        let delivery = if entered {
            self.deliver_on_enter(&ticket_id)?
        } else {
            Value::Null
        };
        let ticket = {
            let conn = self.db.lock().unwrap();
            get_ticket(&conn, &ticket_id)?
        };
        let mut value = self.ticket_json(&ticket)?;
        value["delivery"] = delivery;
        Ok(value)
    }

    pub(crate) fn do_work_ticket_delete(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["ticketId"])?;
        let conn = self.db.lock().unwrap();
        let ticket = get_ticket(&conn, &required(params, "ticketId")?)?;
        conn.execute(
            "DELETE FROM work_ticket_sessions WHERE ticket_id = ?1",
            params![ticket.id],
        )
        .map_err(error::from_sqlite)?;
        conn.execute("DELETE FROM work_tickets WHERE id = ?1", params![ticket.id])
            .map_err(error::from_sqlite)?;
        let remaining: Vec<String> = list_tickets(&conn, Some(&ticket.column_id))?
            .into_iter()
            .map(|t| t.id)
            .collect();
        for (position, id) in remaining.iter().enumerate() {
            conn.execute(
                "UPDATE work_tickets SET position = ?2 WHERE id = ?1",
                params![id, position as i64],
            )
            .map_err(error::from_sqlite)?;
        }
        Ok(json!({ "deleted": ticket.id, "key": ticket.key }))
    }

    fn require_session_row(&self, conn: &Connection, session_id: &str) -> Result<(), RpcError> {
        let found: Option<String> = conn
            .query_row(
                "SELECT id FROM sessions WHERE id = ?1",
                params![session_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error::from_sqlite)?;
        found
            .map(|_| ())
            .ok_or_else(|| error::not_found(format!("session {session_id} not found")))
    }

    pub(crate) fn do_work_ticket_link_session(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["ticketId", "sessionId"])?;
        let ticket = {
            let conn = self.db.lock().unwrap();
            let ticket = get_ticket(&conn, &required(params, "ticketId")?)?;
            let session = required(params, "sessionId")?;
            self.require_session_row(&conn, &session)?;
            link_session_in(&conn, &ticket.id, &session)?;
            // A ticket without a workspace adopts the first linked session's.
            if ticket.workspace_id.is_none() {
                let workspace: Option<String> = conn
                    .query_row(
                        "SELECT workspace_id FROM sessions WHERE id = ?1",
                        params![session],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(error::from_sqlite)?;
                conn.execute(
                    "UPDATE work_tickets SET workspace_id = ?2 WHERE id = ?1",
                    params![ticket.id, workspace],
                )
                .map_err(error::from_sqlite)?;
            }
            conn.execute(
                "UPDATE work_tickets SET updated_at = ?2 WHERE id = ?1",
                params![ticket.id, crate::now_unix_ms() as i64],
            )
            .map_err(error::from_sqlite)?;
            get_ticket(&conn, &ticket.id)?
        };
        self.ticket_json(&ticket)
    }

    pub(crate) fn do_work_ticket_unlink_session(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["ticketId", "sessionId"])?;
        let ticket = {
            let conn = self.db.lock().unwrap();
            let ticket = get_ticket(&conn, &required(params, "ticketId")?)?;
            let removed = conn
                .execute(
                    "DELETE FROM work_ticket_sessions WHERE ticket_id = ?1 AND session_id = ?2",
                    params![ticket.id, required(params, "sessionId")?],
                )
                .map_err(error::from_sqlite)?;
            if removed == 0 {
                return Err(error::not_found(
                    "that session is not linked to this ticket",
                ));
            }
            ticket
        };
        self.ticket_json(&ticket)
    }

    /// Opens a ticket's session for the user: a live one is returned as is;
    /// one that is no longer live is resumed (fresh start when the harness
    /// has nothing to resume) and the replacement is linked in its place.
    pub(crate) fn do_work_session_open(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["ticketId", "sessionId"])?;
        let session_id = required(params, "sessionId")?;
        {
            let conn = self.db.lock().unwrap();
            let ticket = get_ticket(&conn, &required(params, "ticketId")?)?;
            if !linked_session_ids(&conn, &ticket.id)?.contains(&session_id) {
                return Err(error::not_found(
                    "that session is not linked to this ticket",
                ));
            }
        }
        if let Some(live) = self.live_session_snapshot(&session_id) {
            return Ok(json!({ "action": "open", "session": live }));
        }
        let row = self
            .work_session_rows(std::slice::from_ref(&session_id))?
            .into_iter()
            .next()
            .unwrap_or(Value::Null);
        if row["missing"] == true {
            let conn = self.db.lock().unwrap();
            let _ = conn.execute(
                "DELETE FROM work_ticket_sessions WHERE session_id = ?1",
                params![session_id],
            );
            return Err(error::not_found(
                "that session was closed and its record is gone; it has been unlinked from the ticket",
            ));
        }
        let Some(harness) = row["harnessId"].as_str().map(str::to_owned) else {
            // A plain terminal has nothing to resume: the desktop shows its
            // recorded (exited) state with the terminal's own restart.
            return Ok(json!({ "action": "open", "session": row }));
        };
        let launched = self.do_harness_start(&json!({
            "workspaceId": row["workspaceId"],
            "harnessId": harness,
            "resume": true,
            "resumeSessionId": session_id,
        }))?;
        Ok(json!({
            "action": if launched["agentResume"] == "fresh" { "started" } else { "resumed" },
            "session": launched,
        }))
    }

    fn live_session_snapshot(&self, session_id: &str) -> Option<Value> {
        let sessions = self.sessions.lock().unwrap();
        let handle = sessions.get(session_id)?;
        let snapshot = crate::session::snapshot(handle);
        (snapshot["verdict"] == "live").then_some(snapshot)
    }

    // ------------------------------------------------------ delivery --

    pub(crate) fn work_column_preview(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["columnId", "ticketId", "message"])?;
        let (column, tickets) = self.send_targets(params)?;
        let template = str_field(params, "message")?
            .map(str::to_owned)
            .unwrap_or_else(|| column.message.clone());
        let mut previews = Vec::new();
        for ticket in &tickets {
            let (project, ids) = {
                let conn = self.db.lock().unwrap();
                let project = ticket
                    .project_id
                    .as_deref()
                    .and_then(|p| project_name(&conn, p).ok());
                (project, linked_session_ids(&conn, &ticket.id)?)
            };
            let ids = select_recipients(&column.recipients, ids);
            let rows = self.work_session_rows(&ids)?;
            let recipients: Vec<Value> = rows
                .iter()
                .map(|row| {
                    let action = if row["verdict"] == "live" {
                        "send"
                    } else if row["harnessId"].is_string() {
                        "resume"
                    } else {
                        "start"
                    };
                    json!({ "sessionId": row["id"], "action": action, "harnessId": row["harnessId"] })
                })
                .collect();
            previews.push(json!({
                "ticketId": ticket.id,
                "ticketKey": ticket.key,
                "message": render_message(&template, ticket, Some(&column), project.as_deref()),
                "recipients": if recipients.is_empty() {
                    json!([{ "sessionId": null, "action": "start", "harnessId": self.default_harness(&column) }])
                } else {
                    json!(recipients)
                },
            }));
        }
        Ok(json!({ "columnId": column.id, "previews": previews }))
    }

    pub(crate) fn do_work_column_send(&self, params: &Value) -> Result<Value, RpcError> {
        reject_unknown(params, &["columnId", "ticketId", "message"])?;
        let (column, tickets) = self.send_targets(params)?;
        let template = str_field(params, "message")?.map(str::to_owned);
        if template
            .as_deref()
            .unwrap_or(&column.message)
            .trim()
            .is_empty()
        {
            return Err(error::invalid_argument(format!(
                "column {} has no message to send",
                column.name
            )));
        }
        let mut sends = Vec::new();
        for ticket in &tickets {
            sends.push(self.deliver(&column, &ticket.id, "manual", template.as_deref())?);
        }
        Ok(json!({ "columnId": column.id, "sends": sends }))
    }

    fn send_targets(&self, params: &Value) -> Result<(Column, Vec<Ticket>), RpcError> {
        let conn = self.db.lock().unwrap();
        let ticket = str_field(params, "ticketId")?
            .map(|t| get_ticket(&conn, t))
            .transpose()?;
        let column = match (str_field(params, "columnId")?, &ticket) {
            (Some(c), _) => get_column(&conn, c)?,
            (None, Some(t)) => get_column(&conn, &t.column_id)?,
            (None, None) => {
                return Err(error::invalid_argument("columnId or ticketId is required"));
            }
        };
        let tickets = match ticket {
            Some(t) => vec![t],
            None => list_tickets(&conn, Some(&column.id))?,
        };
        Ok((column, tickets))
    }

    fn default_harness(&self, column: &Column) -> String {
        if let Some(h) = &column.harness_id {
            return h.clone();
        }
        self.read_agent_settings()
            .ok()
            .flatten()
            .and_then(|s| s.default_tui_agent)
            .filter(|id| id != "blank")
            .unwrap_or_else(|| "claude".to_string())
    }

    /// The workspace a new session for this ticket starts in: the ticket's
    /// own, else its project's main checkout, else any of its worktrees.
    fn ticket_workspace(&self, ticket: &Ticket) -> Result<Option<String>, RpcError> {
        if let Some(ws) = &ticket.workspace_id {
            return Ok(Some(ws.clone()));
        }
        let Some(project) = &ticket.project_id else {
            return Ok(None);
        };
        let conn = self.db.lock().unwrap();
        let worktree = conn
            .query_row(
                "SELECT w.workspace_id FROM worktrees w JOIN projects p ON p.id = w.project_id
                 WHERE w.project_id = ?1 ORDER BY (w.path = p.path) DESC, w.created_at LIMIT 1",
                params![project],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(error::from_sqlite)?;
        if worktree.is_some() {
            return Ok(worktree);
        }
        // A folder project's implicit worktree is the workspace registered
        // at the project's own path.
        conn.query_row(
            "SELECT ws.id FROM workspaces ws JOIN projects p ON p.path = ws.path
             WHERE p.id = ?1 ORDER BY ws.id LIMIT 1",
            params![project],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(error::from_sqlite)
    }

    fn deliver_on_enter(&self, ticket_id: &str) -> Result<Value, RpcError> {
        let column = {
            let conn = self.db.lock().unwrap();
            let ticket = get_ticket(&conn, ticket_id)?;
            get_column(&conn, &ticket.column_id)?
        };
        if !column.send_on_enter || column.message.trim().is_empty() {
            return Ok(Value::Null);
        }
        self.deliver(&column, ticket_id, "enter", None)
    }

    /// Types the column's message into every recipient session of one
    /// ticket, resuming or starting sessions as needed, and records it.
    fn deliver(
        &self,
        column: &Column,
        ticket_id: &str,
        trigger: &str,
        template: Option<&str>,
    ) -> Result<Value, RpcError> {
        let _serial = DELIVERY_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let (ticket, project, ids) = {
            let conn = self.db.lock().unwrap();
            let ticket = get_ticket(&conn, ticket_id)?;
            let project = ticket
                .project_id
                .as_deref()
                .and_then(|p| project_name(&conn, p).ok());
            let ids = linked_session_ids(&conn, &ticket.id)?;
            (ticket, project, ids)
        };
        let message = render_message(
            template.unwrap_or(&column.message),
            &ticket,
            Some(column),
            project.as_deref(),
        );
        let mut results = Vec::new();
        if message.trim().is_empty() {
            results
                .push(json!({ "sessionId": null, "action": "skipped", "error": "empty message" }));
        } else {
            let recipients = select_recipients(&column.recipients, ids);
            for session_id in &recipients {
                results.push(self.deliver_to_session(&ticket, session_id, &message));
            }
            let delivered = results
                .iter()
                .any(|r| matches!(r["action"].as_str(), Some("sent" | "resumed" | "started")));
            if !delivered {
                results.push(self.start_ticket_session(column, &ticket, &message));
            }
        }
        let at = crate::now_unix_ms() as i64;
        {
            let conn = self.db.lock().unwrap();
            conn.execute(
                "INSERT INTO work_sends (column_id, ticket_id, trigger, message, results, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![column.id, ticket.id, trigger, message, Value::Array(results.clone()).to_string(), at],
            )
            .map_err(error::from_sqlite)?;
        }
        Ok(json!({
            "ticketId": ticket.id,
            "ticketKey": ticket.key,
            "columnId": column.id,
            "trigger": trigger,
            "message": message,
            "results": results,
            "at": at,
        }))
    }

    fn deliver_to_session(&self, ticket: &Ticket, session_id: &str, message: &str) -> Value {
        let handle = self.sessions.lock().unwrap().get(session_id).cloned();
        if let Some(handle) = handle {
            let mut bytes = message.as_bytes().to_vec();
            bytes.push(b'\r');
            match crate::session::write_parts(&handle, &bytes, true) {
                Ok(outcome) => {
                    return json!({
                        "sessionId": session_id,
                        "action": "sent",
                        "enterDelivery": outcome.enter_delivery,
                    });
                }
                // An exited session falls through to resume below.
                Err(err) if err.code == "unverifiable" => {}
                Err(err) => {
                    return json!({ "sessionId": session_id, "action": "failed", "error": err.message });
                }
            }
        }
        let row = match self.work_session_rows(&[session_id.to_string()]) {
            Ok(rows) => rows.into_iter().next().unwrap_or(Value::Null),
            Err(err) => {
                return json!({ "sessionId": session_id, "action": "failed", "error": err.message });
            }
        };
        if row["missing"] == true {
            let conn = self.db.lock().unwrap();
            let _ = conn.execute(
                "DELETE FROM work_ticket_sessions WHERE ticket_id = ?1 AND session_id = ?2",
                params![ticket.id, session_id],
            );
            return json!({ "sessionId": session_id, "action": "skipped", "error": "session record is gone; unlinked" });
        }
        let Some(harness) = row["harnessId"].as_str() else {
            return json!({
                "sessionId": session_id,
                "action": "skipped",
                "error": "a plain terminal that is no longer live cannot be resumed",
            });
        };
        match self.do_harness_start(&json!({
            "workspaceId": row["workspaceId"],
            "harnessId": harness,
            "resume": true,
            "resumeSessionId": session_id,
            "prompt": message,
        })) {
            Ok(launched) => json!({
                "sessionId": session_id,
                "action": if launched["agentResume"] == "fresh" { "started" } else { "resumed" },
                "newSessionId": launched["id"],
                "agentResume": launched["agentResume"],
            }),
            Err(err) => {
                json!({ "sessionId": session_id, "action": "failed", "error": err.message })
            }
        }
    }

    fn start_ticket_session(&self, column: &Column, ticket: &Ticket, message: &str) -> Value {
        let workspace = match self.ticket_workspace(ticket) {
            Ok(Some(ws)) => ws,
            Ok(None) => {
                return json!({
                    "sessionId": null,
                    "action": "skipped",
                    "error": "the ticket has no workspace or project to start a session in",
                });
            }
            Err(err) => {
                return json!({ "sessionId": null, "action": "failed", "error": err.message });
            }
        };
        let harness = self.default_harness(column);
        match self.do_harness_start(&json!({
            "workspaceId": workspace,
            "harnessId": harness,
            "prompt": message,
        })) {
            Ok(launched) => {
                let new_id = launched["id"].as_str().unwrap_or_default().to_string();
                let conn = self.db.lock().unwrap();
                let linked = link_session_in(&conn, &ticket.id, &new_id);
                if ticket.workspace_id.is_none() {
                    let _ = conn.execute(
                        "UPDATE work_tickets SET workspace_id = ?2 WHERE id = ?1",
                        params![ticket.id, workspace],
                    );
                }
                json!({
                    "sessionId": null,
                    "action": if linked.is_ok() { "started" } else { "failed" },
                    "newSessionId": new_id,
                    "harnessId": harness,
                })
            }
            Err(err) => {
                json!({ "sessionId": null, "action": "failed", "error": err.message, "harnessId": harness })
            }
        }
    }

    // ---------------------------------------------------------- tick --

    /// Scheduled column sends and pull-request watches. Best-effort: runs on
    /// the automation scheduler's tick and never fails it.
    pub(crate) fn tick_work(&self, now_ms: f64) {
        if self.is_quiescent() {
            return;
        }
        let now = now_ms as i64;
        let columns = {
            let conn = self.db.lock().unwrap();
            match list_columns(&conn) {
                Ok(c) => c,
                Err(err) => {
                    eprintln!("[work] tick: cannot list columns: {}", err.message);
                    return;
                }
            }
        };
        for column in &columns {
            if let (Some(cron), Some(due)) = (&column.cron, column.next_run_at)
                && due <= now
            {
                let next = crate::automations::scheduler::next_fire_ms(cron, now_ms);
                let tickets = {
                    let conn = self.db.lock().unwrap();
                    let _ = conn.execute(
                        "UPDATE work_columns SET next_run_at = ?2 WHERE id = ?1",
                        params![column.id, next],
                    );
                    list_tickets(&conn, Some(&column.id)).unwrap_or_default()
                };
                if !column.message.trim().is_empty() {
                    for ticket in tickets {
                        if let Err(err) = self.deliver(column, &ticket.id, "schedule", None) {
                            eprintln!(
                                "[work] scheduled send for {} failed: {}",
                                ticket.key, err.message
                            );
                        }
                    }
                }
            }
            if column.pr_watch && !column.message.trim().is_empty() {
                self.watch_column_prs(column, now);
            }
        }
    }

    fn watch_column_prs(&self, column: &Column, now: i64) {
        let tickets = {
            let conn = self.db.lock().unwrap();
            list_tickets(&conn, Some(&column.id)).unwrap_or_default()
        };
        for ticket in tickets {
            let (Some(project), Some(number)) = (&ticket.project_id, ticket.pr_number) else {
                continue;
            };
            if ticket.pr_checked_at.is_some_and(|at| now - at < PR_POLL_MS) {
                continue;
            }
            let fingerprint = match self.do_tasks_show(&json!({
                "projectId": project,
                "number": number,
                "mode": "pulls",
            })) {
                Ok(value) => pr_fingerprint(&value["pull"]),
                Err(err) => {
                    let conn = self.db.lock().unwrap();
                    let _ = conn.execute(
                        "UPDATE work_tickets SET pr_checked_at = ?2 WHERE id = ?1",
                        params![ticket.id, now],
                    );
                    eprintln!("[work] PR watch for {} failed: {}", ticket.key, err.message);
                    continue;
                }
            };
            {
                let conn = self.db.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE work_tickets SET pr_fingerprint = ?2, pr_checked_at = ?3 WHERE id = ?1",
                    params![ticket.id, fingerprint, now],
                );
            }
            if let Some(previous) = &ticket.pr_fingerprint
                && *previous != fingerprint
                && let Err(err) = self.deliver(column, &ticket.id, "pr_change", None)
            {
                eprintln!(
                    "[work] PR-change send for {} failed: {}",
                    ticket.key, err.message
                );
            }
        }
    }
}

fn reorder_columns(conn: &Connection, moving: &str, index: Option<usize>) -> Result<(), RpcError> {
    let mut order: Vec<String> = list_columns(conn)?
        .into_iter()
        .map(|c| c.id)
        .filter(|id| id != moving)
        .collect();
    let at = index.unwrap_or(order.len()).min(order.len());
    order.insert(at, moving.to_string());
    for (position, id) in order.iter().enumerate() {
        conn.execute(
            "UPDATE work_columns SET position = ?2 WHERE id = ?1",
            params![id, position as i64],
        )
        .map_err(error::from_sqlite)?;
    }
    Ok(())
}

fn select_recipients(recipients: &str, ids: Vec<String>) -> Vec<String> {
    if recipients == "primary" {
        ids.into_iter().take(1).collect()
    } else {
        ids
    }
}

/// What a PR change means for the board: its lifecycle, review decision,
/// mergeability, checks and last update.
fn pr_fingerprint(pull: &Value) -> String {
    json!([
        pull["state"],
        pull["isDraft"],
        pull["mergeable"],
        pull["reviewDecision"],
        pull["checks"]["state"],
        pull["updatedAt"],
    ])
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_prefixes_follow_the_project_name() {
        assert_eq!(key_prefix(Some("Drogon")), "DRG");
        assert_eq!(key_prefix(Some("waman")), "WMN");
        assert_eq!(key_prefix(Some("aeiou")), "AE");
        assert_eq!(key_prefix(Some("x")), "X");
        assert_eq!(key_prefix(None), "WRK");
        assert_eq!(key_prefix(Some("123")), "WRK");
    }

    #[test]
    fn pr_links_parse_numbers_and_urls() {
        assert_eq!(parse_pr("#648").unwrap(), (None, Some(648)));
        assert_eq!(parse_pr("12").unwrap(), (None, Some(12)));
        assert_eq!(
            parse_pr("https://github.com/clioo/drogon/pull/663").unwrap(),
            (
                Some("https://github.com/clioo/drogon/pull/663".to_string()),
                Some(663)
            )
        );
        assert_eq!(parse_pr("").unwrap(), (None, None));
        assert!(parse_pr("ftp://x/pull/1").is_err());
    }

    #[test]
    fn schedules_accept_shorthand_and_cron() {
        assert_eq!(normalize_schedule("15m").unwrap(), "*/15 * * * *");
        assert_eq!(normalize_schedule("2h").unwrap(), "0 */2 * * *");
        assert_eq!(normalize_schedule("1d").unwrap(), "0 0 * * *");
        assert_eq!(normalize_schedule("*/5 * * * *").unwrap(), "*/5 * * * *");
        assert!(normalize_schedule("90m").is_err());
        assert!(normalize_schedule("nonsense").is_err());
    }

    #[test]
    fn messages_render_ticket_placeholders() {
        let ticket = Ticket {
            id: "t".into(),
            key: "DRG-42".into(),
            project_id: None,
            workspace_id: None,
            column_id: "c".into(),
            position: 0,
            title: "Improve Jira resume".into(),
            description: String::new(),
            pr_url: None,
            pr_number: Some(648),
            source_url: Some("https://jira.example/DRG-42".into()),
            next_step: String::new(),
            pr_fingerprint: None,
            pr_checked_at: None,
            created_at: 0,
            updated_at: 0,
        };
        let out = render_message(
            "Review {ticket.pr} for {ticket.id}.\r\nSource: {ticket.url} {unknown}\n\n",
            &ticket,
            None,
            Some("Drogon"),
        );
        assert_eq!(
            out,
            "Review PR #648 for DRG-42.\nSource: https://jira.example/DRG-42 {unknown}"
        );
    }
}
