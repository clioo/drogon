//! Local Bot assignment for tasks (C11): one durable local assignment per
//! stable task identity, stored through the daemon's own SQLite database —
//! never a renderer cache and never a second store authority. An assignment
//! keys on `(host_id, project_id, provider, instance, task_id)`, where
//! `provider`/`instance`/`task_id` come from the stable task identity (C06's
//! contract; for Jira the instance is the `getSiteId` site id and the task id
//! is Jira's immutable issue id, never the display key) and `host_id`/
//! `project_id` fence it to one Drogon host and project — the same issue key
//! seen in two projects or two sites stays isolated.
//!
//! ## Deliberately local
//!
//! Every operation here is pure SQLite over the caller's connection. There is
//! no Jira HTTP client, no Bot runtime and no session handle in this module,
//! so an assignment change cannot write a remote Jira assignee and cannot
//! start, stop or interrupt a model turn — Open/Run stay separate explicit
//! actions owned by C05/C06. Deleting or unassigning a Bot never deletes
//! history: `bot.delete` does not cascade into these rows, an assignment
//! whose Bot row is gone reads back with [`BotState::Deleted`] (honest
//! disabled/reassign state, stale assignment-time name kept for display), and
//! every set/replace/clear appends to `task_bot_assignment_history` with the
//! Bot's name captured at event time so history survives deletion.
//!
//! ## Concurrency
//!
//! All mutations take an explicit expected version (the C04 identity
//! convention): a writer that read version N must pass `Some(N)` and loses
//! with [`AssignmentError::VersionConflict`] instead of silently
//! overwriting; `None` asserts the task is currently unassigned. Versions
//! start at 1 and increase by exactly one per applied mutation, so a
//! `(scope, version)` pair names one history event uniquely.
//!
//! ## Wiring status (C11 source checkpoint)
//!
//! This module is deliberately self-contained (no `crate::` paths) so the
//! integration test can compile it standalone until the held files absorb it:
//! `jira/mod.rs` gains `pub mod bot_assignment;`, `lib.rs` dispatches the
//! published `jira.taskAssignment*` methods (mutating set/clear through the
//! request ledger like `tasks.start`), and `drogon-protocol`/preload/shared
//! grow the wire shapes below. Storage follows `tasks_rpc::task_links`'
//! lazy `CREATE TABLE IF NOT EXISTS` pattern (no second migration track).
//! MIT Copyright (c) 2026 Lovecast Inc.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

/// The task provider an assignment is keyed under. A Jira issue and the
/// GitHub issue it mirrors are different tasks with independent local
/// assignments; the Tasks-page surfaces (list, detail, C09 Kanban) all read
/// and write through this one vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskProvider {
    Jira,
    Github,
}

impl TaskProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Jira => "jira",
            Self::Github => "github",
        }
    }

    pub fn parse(raw: &str) -> Result<Self, AssignmentError> {
        match raw {
            "jira" => Ok(Self::Jira),
            "github" => Ok(Self::Github),
            other => Err(AssignmentError::InvalidScope(format!(
                "unknown task provider {other:?}"
            ))),
        }
    }
}

/// Scope of one local assignment: the Drogon host and project the Tasks
/// surface belongs to, plus the stable provider/instance/task identity.
/// Every field is trimmed, non-empty and bounded — a renderer cannot smuggle
/// an apparently valid identity through whitespace or oversized strings
/// (required behavior 7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentScope {
    pub host_id: String,
    pub project_id: String,
    pub provider: TaskProvider,
    /// Jira: the stable per-(site, account) site id (`getSiteId`).
    /// GitHub: the `owner/repo` slug (GHE includes its host).
    pub instance: String,
    /// The provider's immutable task id (Jira issue id, not the display
    /// key; GitHub issue id). Never a title or other mutable label.
    pub task_id: String,
}

impl AssignmentScope {
    pub fn validate(&self) -> Result<AssignmentScope, AssignmentError> {
        let checked = |name: &str, raw: &str| -> Result<String, AssignmentError> {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(AssignmentError::InvalidScope(format!("{name} is required")));
            }
            if trimmed.len() > MAX_SCOPE_FIELD_LEN {
                return Err(AssignmentError::InvalidScope(format!(
                    "{name} exceeds {MAX_SCOPE_FIELD_LEN} characters"
                )));
            }
            Ok(trimmed.to_string())
        };
        Ok(Self {
            host_id: checked("hostId", &self.host_id)?,
            project_id: checked("projectId", &self.project_id)?,
            provider: self.provider,
            instance: checked("instance", &self.instance)?,
            task_id: checked("taskId", &self.task_id)?,
        })
    }

    /// The scope's own key column list for inline `WHERE` clauses.
    pub(crate) fn key_where() -> &'static str {
        "host_id = ?1 AND project_id = ?2 AND provider = ?3 AND instance = ?4 AND task_id = ?5"
    }

    pub(crate) fn key_params(&self) -> [&str; 5] {
        [
            self.host_id.as_str(),
            self.project_id.as_str(),
            self.provider.as_str(),
            self.instance.as_str(),
            self.task_id.as_str(),
        ]
    }
}

/// Anything longer than this in a scope field is not an identity, it is
/// payload smuggling; refuse rather than truncate.
pub const MAX_SCOPE_FIELD_LEN: usize = 512;

/// The caller's view of the current version, per the CAS contract:
/// `Version(n)` applies only onto exactly that version, `New` applies only
/// onto an absent assignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpectedVersion {
    New,
    Version(u64),
}

impl ExpectedVersion {
    pub fn from_wire(raw: Option<u64>) -> Result<Self, AssignmentError> {
        match raw {
            None => Ok(Self::New),
            Some(0) => Err(AssignmentError::InvalidExpectedVersion),
            Some(v) => Ok(Self::Version(v)),
        }
    }
}

/// A stored assignment row plus the resolved current-state facts a surface
/// needs: whether the Bot still exists, and its live display name when it
/// does (`bot_name` on the record is the assignment-time snapshot kept for
/// history/display once the Bot row is gone).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAssignment {
    pub record: AssignmentRecord,
    pub bot_state: BotState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentRecord {
    pub scope: AssignmentScope,
    pub bot_id: String,
    /// The Bot's storage folder at assignment time — display provenance
    /// (Tasks is project-scoped, Bot rows are folder-stamped), not a
    /// constraint: a Bot is assignable from anywhere on the same host.
    pub bot_folder: String,
    /// Snapshot of the display name captured when this version was written;
    /// read resolution overlays the live name while the Bot exists.
    pub bot_name: String,
    /// Starts at 1, +1 per applied mutation; the CAS handle.
    pub version: u64,
    pub assigned_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BotState {
    /// The Bot row exists on this host; `record.bot_name` was refreshed to
    /// the live display name for this read.
    Active,
    /// The Bot row is gone (deleted). The assignment is preserved — history
    /// and any active turn are untouched — and surfaces must show the
    /// honest disabled/reassign state instead of pretending it is live.
    Deleted,
}

/// One append-only history entry. `bot_name` is captured at event time so
/// history survives Bot deletion; `(scope, version)` is the primary key, so
/// each applied mutation lands exactly once even across request retries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentEvent {
    pub scope: AssignmentScope,
    pub version: u64,
    pub action: AssignmentAction,
    /// `None` for `cleared`.
    pub bot_id: Option<String>,
    pub bot_name: String,
    /// The caller-chosen envelope request id, for traceability.
    pub request_id: Option<String>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssignmentAction {
    /// First assignment (version 1).
    Assigned,
    /// Replacement of an existing assignment.
    Replaced,
    Cleared,
}

/// Domain errors. `VersionConflict` mirrors the C04 identity shape (what the
/// writer expected vs what is stored now) so a losing writer can re-read and
/// retry instead of having silently clobbered anyone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssignmentError {
    InvalidScope(String),
    /// `expectedVersion: 0` — versions start at 1.
    InvalidExpectedVersion,
    BotNotFound {
        bot_id: String,
    },
    /// The Bot exists but on another Drogon host; refusing is the host-scope
    /// fence of required behavior 7.
    BotHostMismatch {
        bot_id: String,
        bot_host: String,
        assignment_host: String,
    },
    VersionConflict {
        expected: Option<u64>,
        current: Option<u64>,
    },
    Storage(String),
}

impl std::fmt::Display for AssignmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidScope(detail) => write!(f, "invalid assignment scope: {detail}"),
            Self::InvalidExpectedVersion => {
                write!(f, "expectedVersion must be a positive number or null")
            }
            Self::BotNotFound { bot_id } => write!(f, "bot {bot_id} does not exist"),
            Self::BotHostMismatch {
                bot_id,
                bot_host,
                assignment_host,
            } => write!(
                f,
                "bot {bot_id} belongs to host {bot_host}, not the assignment host {assignment_host}"
            ),
            Self::VersionConflict { expected, current } => write!(
                f,
                "assignment version conflict: expected {}, found {}",
                expected.map_or_else(|| "no assignment".to_string(), |v| v.to_string()),
                current.map_or_else(|| "no assignment".to_string(), |v| v.to_string()),
            ),
            Self::Storage(detail) => write!(f, "assignment storage error: {detail}"),
        }
    }
}

impl std::error::Error for AssignmentError {}

impl From<rusqlite::Error> for AssignmentError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Storage(value.to_string())
    }
}

pub type AssignmentResult<T> = Result<T, AssignmentError>;

// --- schema -----------------------------------------------------------------
//
// Lazy `CREATE TABLE IF NOT EXISTS` exactly like `tasks_rpc`'s `task_links`:
// idempotent and race-safe under SQLite, no second migration track.

pub(crate) fn ensure_tables(conn: &Connection) -> AssignmentResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS task_bot_assignments (
            host_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            instance TEXT NOT NULL,
            task_id TEXT NOT NULL,
            bot_id TEXT NOT NULL,
            bot_folder TEXT NOT NULL,
            bot_name TEXT NOT NULL,
            version INTEGER NOT NULL,
            assigned_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (host_id, project_id, provider, instance, task_id)
        );
        CREATE INDEX IF NOT EXISTS task_bot_assignments_bot
            ON task_bot_assignments(bot_id);
        CREATE TABLE IF NOT EXISTS task_bot_assignment_history (
            host_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            instance TEXT NOT NULL,
            task_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            action TEXT NOT NULL,
            bot_id TEXT,
            bot_name TEXT NOT NULL,
            request_id TEXT,
            occurred_at TEXT NOT NULL,
            PRIMARY KEY (host_id, project_id, provider, instance, task_id, version)
        );",
    )?;
    Ok(())
}

// --- reads ------------------------------------------------------------------

/// The current assignment for one task scope, or `None` when unassigned.
/// The Bot's existence is resolved per read: a deleted Bot does not hide the
/// row, it flips `bot_state` to [`BotState::Deleted`].
pub fn read_assignment(
    conn: &Connection,
    scope: &AssignmentScope,
) -> AssignmentResult<Option<ResolvedAssignment>> {
    let scope = scope.validate()?;
    ensure_tables(conn)?;
    let row = conn
        .query_row(
            &format!(
                "SELECT bot_id, bot_folder, bot_name, version, assigned_at, updated_at
                 FROM task_bot_assignments WHERE {}",
                AssignmentScope::key_where()
            ),
            scope.key_params(),
            |row| {
                Ok(AssignmentRecord {
                    scope: scope.clone(),
                    bot_id: row.get(0)?,
                    bot_folder: row.get(1)?,
                    bot_name: row.get(2)?,
                    version: row.get::<_, i64>(3)? as u64,
                    assigned_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
        .optional()?;
    let Some(mut record) = row else {
        return Ok(None);
    };
    let bot_state = resolve_bot_state(conn, &scope.host_id, &record.bot_id)?;
    if bot_state == BotState::Active {
        // Overlay the live display name so a Bot rename flows through every
        // surface without a re-assignment; the row snapshot stays the
        // fallback once the Bot is deleted.
        record.bot_name = live_bot_name(conn, &record.bot_id, &record.bot_name)?;
    }
    Ok(Some(ResolvedAssignment { bot_state, record }))
}

/// Append-only history for one task scope, oldest first. Clear events keep
/// their bot rows (`bot_id: None` is the marker), so "what happened to this
/// task" survives clearing, replacement and Bot deletion alike.
pub fn assignment_history(
    conn: &Connection,
    scope: &AssignmentScope,
) -> AssignmentResult<Vec<AssignmentEvent>> {
    let scope = scope.validate()?;
    ensure_tables(conn)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT version, action, bot_id, bot_name, request_id, occurred_at
         FROM task_bot_assignment_history WHERE {} ORDER BY version ASC",
        AssignmentScope::key_where()
    ))?;
    let rows = stmt.query_map(scope.key_params(), |row| {
        Ok((
            row.get::<_, i64>(0)? as u64,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;
    let mut events = Vec::new();
    for row in rows {
        let (version, action, bot_id, bot_name, request_id, occurred_at) = row?;
        events.push(AssignmentEvent {
            scope: scope.clone(),
            version,
            action: match action.as_str() {
                "assigned" => AssignmentAction::Assigned,
                "replaced" => AssignmentAction::Replaced,
                "cleared" => AssignmentAction::Cleared,
                other => {
                    return Err(AssignmentError::Storage(format!(
                        "unknown history action {other:?}"
                    )));
                }
            },
            bot_id,
            bot_name,
            request_id,
            occurred_at,
        });
    }
    Ok(events)
}

// --- mutations --------------------------------------------------------------

/// Assign (or replace) the Bot on one task. Resolves and scope-checks the
/// Bot first — a missing Bot or a Bot from another host is refused before
/// any row is touched — then applies the CAS write and appends the history
/// event. Purely local: no Jira write, no inference, no session interaction.
///
/// The Bot's live display name and storage folder are captured into the row
/// at write time; the name snapshot is what history keeps after deletion.
#[allow(clippy::too_many_arguments)]
pub fn assign_bot(
    conn: &mut Connection,
    scope: &AssignmentScope,
    bot_id: &str,
    expected: ExpectedVersion,
    request_id: Option<&str>,
) -> AssignmentResult<ResolvedAssignment> {
    let scope = scope.validate()?;
    ensure_tables(conn)?;
    let bot_id = bot_id.trim();
    if bot_id.is_empty() {
        return Err(AssignmentError::InvalidScope("botId is required".into()));
    }
    let (bot_folder, bot_name) = resolve_active_bot(conn, &scope.host_id, bot_id)?;

    let tx = conn.transaction()?;
    let now = now_rfc3339();
    let current: Option<u64> = tx
        .query_row(
            &format!(
                "SELECT version FROM task_bot_assignments WHERE {}",
                AssignmentScope::key_where()
            ),
            scope.key_params(),
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .map(|v: i64| v as u64);
    match (expected, current) {
        (ExpectedVersion::Version(e), Some(c)) if e != c => {
            return Err(AssignmentError::VersionConflict {
                expected: Some(e),
                current: Some(c),
            });
        }
        (ExpectedVersion::New, Some(c)) => {
            return Err(AssignmentError::VersionConflict {
                expected: None,
                current: Some(c),
            });
        }
        _ => {}
    }
    let (version, action, assigned_at) = match current {
        None => (1, AssignmentAction::Assigned, now.clone()),
        Some(v) => (v + 1, AssignmentAction::Replaced, {
            tx.query_row(
                &format!(
                    "SELECT assigned_at FROM task_bot_assignments WHERE {}",
                    AssignmentScope::key_where()
                ),
                scope.key_params(),
                |row| row.get(0),
            )?
        }),
    };
    tx.execute(
        "INSERT INTO task_bot_assignments
                (host_id, project_id, provider, instance, task_id,
                 bot_id, bot_folder, bot_name, version, assigned_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT (host_id, project_id, provider, instance, task_id) DO UPDATE SET
                bot_id = excluded.bot_id,
                bot_folder = excluded.bot_folder,
                bot_name = excluded.bot_name,
                version = excluded.version,
                assigned_at = excluded.assigned_at,
                updated_at = excluded.updated_at",
        params![
            scope.host_id,
            scope.project_id,
            scope.provider.as_str(),
            scope.instance,
            scope.task_id,
            bot_id,
            bot_folder,
            bot_name,
            version as i64,
            assigned_at,
            now,
        ],
    )?;
    append_history(
        &tx,
        &scope,
        version,
        action,
        Some(bot_id),
        &bot_name,
        request_id,
        &now,
    )?;
    tx.commit()?;
    Ok(ResolvedAssignment {
        record: AssignmentRecord {
            scope,
            bot_id: bot_id.to_string(),
            bot_folder,
            bot_name,
            version,
            assigned_at,
            updated_at: now,
        },
        bot_state: BotState::Active,
    })
}

/// Clear the assignment on one task (CAS). The current row is removed — the
/// task reads as unassigned everywhere — while the history event preserves
/// what was assigned, by whom and when. Nothing else is touched: no Jira
/// write, no Bot runtime call, no history deletion.
pub fn clear_assignment(
    conn: &mut Connection,
    scope: &AssignmentScope,
    expected: ExpectedVersion,
    request_id: Option<&str>,
) -> AssignmentResult<()> {
    let scope = scope.validate()?;
    ensure_tables(conn)?;
    let tx = conn.transaction()?;
    let current: Option<(u64, String, String)> = tx
        .query_row(
            &format!(
                "SELECT version, bot_id, bot_name FROM task_bot_assignments WHERE {}",
                AssignmentScope::key_where()
            ),
            scope.key_params(),
            |row| Ok((row.get::<_, i64>(0)? as u64, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let (version, bot_name) = match (expected, current) {
        (ExpectedVersion::Version(e), Some((c, _, bot_name))) => {
            if e != c {
                return Err(AssignmentError::VersionConflict {
                    expected: Some(e),
                    current: Some(c),
                });
            }
            (c, bot_name)
        }
        (ExpectedVersion::Version(e), None) => {
            return Err(AssignmentError::VersionConflict {
                expected: Some(e),
                current: None,
            });
        }
        (ExpectedVersion::New, Some((c, _, _))) => {
            return Err(AssignmentError::VersionConflict {
                expected: None,
                current: Some(c),
            });
        }
        (ExpectedVersion::New, None) => {
            // Clearing an already-unassigned task: the requested end state
            // holds, so this is a no-op, not a conflict.
            return Ok(());
        }
    };
    tx.execute(
        &format!(
            "DELETE FROM task_bot_assignments WHERE {}",
            AssignmentScope::key_where()
        ),
        scope.key_params(),
    )?;
    append_history(
        &tx,
        &scope,
        version + 1,
        AssignmentAction::Cleared,
        None,
        &bot_name,
        request_id,
        &now_rfc3339(),
    )?;
    tx.commit()?;
    Ok(())
}

// --- bot resolution ---------------------------------------------------------

/// Resolve an active Bot for the mutation path: the row must exist and live
/// on the assignment's host; returns its storage folder and live display
/// name. Tasks is a project-level surface, so the Bot's folder is recorded
/// as provenance rather than enforced (documented in the module header).
fn resolve_active_bot(
    conn: &Connection,
    host_id: &str,
    bot_id: &str,
) -> AssignmentResult<(String, String)> {
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT host_id, folder, payload_json FROM bots WHERE id = ?1",
            params![bot_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, String>(2)?)),
        )
        .optional()?;
    let Some((bot_host, folder, payload)) = row else {
        return Err(AssignmentError::BotNotFound {
            bot_id: bot_id.to_string(),
        });
    };
    if bot_host != host_id {
        return Err(AssignmentError::BotHostMismatch {
            bot_id: bot_id.to_string(),
            bot_host,
            assignment_host: host_id.to_string(),
        });
    }
    Ok((folder, bot_display_name(&payload, bot_id)))
}

/// Per-read liveness of the assigned Bot (the mutation path uses
/// [`resolve_active_bot`], which also refuses cross-host).
fn resolve_bot_state(conn: &Connection, host_id: &str, bot_id: &str) -> AssignmentResult<BotState> {
    let bot_host: Option<String> = conn
        .query_row(
            "SELECT host_id FROM bots WHERE id = ?1",
            params![bot_id],
            |row| row.get(0),
        )
        .optional()?;
    match bot_host {
        None => Ok(BotState::Deleted),
        Some(host) if host == host_id => Ok(BotState::Active),
        // A row exists but under another host: for reads this is the same
        // honest "not available here" state as deletion (and cannot happen
        // through this module's own writes, which fence the host).
        Some(_) => Ok(BotState::Deleted),
    }
}

/// The live display name for an existing Bot, resolved fresh for reads so a
/// rename flows through without a re-assignment.
pub fn live_bot_name(conn: &Connection, bot_id: &str, fallback: &str) -> AssignmentResult<String> {
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload_json FROM bots WHERE id = ?1",
            params![bot_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(match payload {
        Some(json) => bot_display_name(&json, bot_id),
        None => fallback.to_string(),
    })
}

/// `Bot.display_identity.displayName` out of the stored payload, falling
/// back to the id — display only, never identity (required behavior 1).
fn bot_display_name(payload: &str, bot_id: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|value| {
            value
                .get("displayIdentity")?
                .get("displayName")?
                .as_str()
                .map(str::to_string)
        })
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| bot_id.to_string())
}

#[allow(clippy::too_many_arguments)]
fn append_history(
    tx: &rusqlite::Transaction<'_>,
    scope: &AssignmentScope,
    version: u64,
    action: AssignmentAction,
    bot_id: Option<&str>,
    bot_name: &str,
    request_id: Option<&str>,
    occurred_at: &str,
) -> AssignmentResult<()> {
    tx.execute(
        "INSERT OR IGNORE INTO task_bot_assignment_history
            (host_id, project_id, provider, instance, task_id, version, action,
             bot_id, bot_name, request_id, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            scope.host_id,
            scope.project_id,
            scope.provider.as_str(),
            scope.instance,
            scope.task_id,
            version as i64,
            match action {
                AssignmentAction::Assigned => "assigned",
                AssignmentAction::Replaced => "replaced",
                AssignmentAction::Cleared => "cleared",
            },
            bot_id,
            bot_name,
            request_id,
            occurred_at,
        ],
    )?;
    Ok(())
}

// --- time -------------------------------------------------------------------
//
// Same minimal second-resolution RFC3339 as `lib.rs` (no date crate for one
// column); kept local so this module stays standalone until wiring.

pub(crate) fn now_rfc3339() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Howard Hinnant's civil-from-days (public domain), as in `lib.rs`.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
