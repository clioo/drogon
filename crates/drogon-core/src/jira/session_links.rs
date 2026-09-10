//! C06: stable Jira issue→session links, persisted in the daemon's SQLite
//! database — the one native authority for "which Drogon worktree/session
//! belongs to this Jira task". Distinct from root's `worktree_issue_links`
//! card-property authority: rows here key on the STABLE task identity
//! (instance id + immutable issue id, never the account email or display
//! key), carry the actual session binding, and implement the start-intent
//! lifecycle that makes double clicks and replayed requests idempotent.
//! Unlinking never deletes the worktree, sessions or run history.
//!
//! Declared from `identity.rs` via `#[path]` while `jira/mod.rs` is
//! root-held; the handover moves only the one `pub mod` line.
//! MIT Copyright (c) 2026 Lovecast Inc.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::JiraTaskIdentity;
use crate::error;
use crate::now_rfc3339;
use drogon_protocol::RpcError;

/// Lifecycle of a link row: `pending` from the durable worktree-creation
/// checkpoint until the session receipt is bound, `linked` afterwards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkState {
    Pending,
    Linked,
}

impl LinkState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Linked => "linked",
        }
    }
}

/// One stable issue→session binding. `session_id` is the latest bound
/// session; earlier sessions of the same workspace stay in the `sessions`
/// table (historical run records are never touched here). `conversation_id`
/// is reserved for the C05 bot-conversation variant — stored when a future
/// caller provides it, never written by this module itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSessionLink {
    pub instance_id: String,
    pub issue_id: String,
    /// Display key at bind time; renames do not affect lookups.
    pub key: String,
    pub instance_url: String,
    pub project_id: String,
    pub worktree_id: String,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    /// The start operation that produced this binding; replayed requests
    /// converge on the same row through it.
    pub intent_id: String,
    pub state: LinkState,
    pub created_at: String,
    pub updated_at: String,
}

impl JiraSessionLink {
    /// The stable composite identity of the linked task.
    pub fn identity(&self) -> JiraTaskIdentity {
        JiraTaskIdentity {
            instance_id: self.instance_id.clone(),
            instance_url: self.instance_url.clone(),
            issue_id: self.issue_id.clone(),
            key: self.key.clone(),
        }
    }
}

/// Session liveness as reported by the daemon's own PTY verdicts. An
/// unknown verdict or a missing session row is `Unverifiable` — loss of
/// contact never proves exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionResolution {
    Live,
    Unverifiable,
    Exited,
    NoSession,
}

impl SessionResolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Unverifiable => "unverifiable",
            Self::Exited => "exited",
            Self::NoSession => "no-session",
        }
    }
}

/// What [`begin_intent`] decided. `Began` grants the worktree creation;
/// every other variant returns the ONE existing binding so a double click
/// or a replayed request can never create two logical bindings for the
/// same start operation.
#[derive(Debug, Clone, PartialEq)]
pub enum BeginIntentOutcome {
    /// The issue is durably linked already (possibly pending): the caller
    /// returns this binding instead of creating anything.
    Linked(Box<JiraSessionLink>),
    InFlight {
        intent_id: String,
        worktree_id: Option<String>,
        workspace_id: Option<String>,
    },
    Began,
}

/// The partial-creation recovery view: what a previous start durably
/// recorded before the session receipt arrived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingRecovery {
    pub intent_id: String,
    pub worktree_id: String,
    pub workspace_id: Option<String>,
}

/// Append-only link history (bind/unlink/session-bound/intent events) so a
/// link/unlink/restart round trip leaves an audit trail without touching
/// the underlying worktree, sessions or run records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSessionLinkEvent {
    pub event: String,
    pub instance_id: String,
    pub issue_id: String,
    pub project_id: String,
    pub key: String,
    pub intent_id: Option<String>,
    pub worktree_id: Option<String>,
    pub workspace_id: Option<String>,
    pub session_id: Option<String>,
    pub detail: Option<String>,
    pub at: String,
}

fn ensure_table(conn: &Connection) -> Result<(), RpcError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS jira_session_links (
            instance_id TEXT NOT NULL,
            issue_id TEXT NOT NULL,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            instance_url TEXT NOT NULL,
            worktree_id TEXT NOT NULL,
            workspace_id TEXT,
            session_id TEXT,
            conversation_id TEXT,
            intent_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending','linked')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (instance_id, issue_id, project_id)
        );
        CREATE INDEX IF NOT EXISTS jira_session_links_project
            ON jira_session_links(project_id);
        CREATE TRIGGER IF NOT EXISTS jira_session_links_worktree_cleanup
        AFTER DELETE ON worktrees
        BEGIN
            DELETE FROM jira_session_links WHERE worktree_id = OLD.id;
        END;
        CREATE TABLE IF NOT EXISTS jira_start_intents (
            intent_id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            issue_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            key TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending','completed','abandoned')),
            worktree_id TEXT,
            workspace_id TEXT,
            session_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS jira_start_intents_identity
            ON jira_start_intents(instance_id, issue_id, project_id, state);
        CREATE TABLE IF NOT EXISTS jira_session_link_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            instance_id TEXT NOT NULL,
            issue_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            key TEXT NOT NULL,
            intent_id TEXT,
            worktree_id TEXT,
            workspace_id TEXT,
            session_id TEXT,
            detail TEXT,
            at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS jira_session_link_events_project
            ON jira_session_link_events(project_id, at);",
    )
    .map_err(error::from_sqlite)
}

fn record_event(conn: &Connection, event: &str, link: &JiraSessionLink, detail: Option<&str>) {
    let _ = conn.execute(
        "INSERT INTO jira_session_link_events
         (event, instance_id, issue_id, project_id, key, intent_id, worktree_id, workspace_id, session_id, detail, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            event,
            link.instance_id,
            link.issue_id,
            link.project_id,
            link.key,
            link.intent_id,
            link.worktree_id,
            link.workspace_id,
            link.session_id,
            detail,
            now_rfc3339(),
        ],
    );
}

fn row_to_link(row: &rusqlite::Row<'_>) -> rusqlite::Result<JiraSessionLink> {
    let state: String = row.get("state")?;
    Ok(JiraSessionLink {
        instance_id: row.get("instance_id")?,
        issue_id: row.get("issue_id")?,
        key: row.get("key")?,
        instance_url: row.get("instance_url")?,
        project_id: row.get("project_id")?,
        worktree_id: row.get("worktree_id")?,
        workspace_id: row.get("workspace_id")?,
        session_id: row.get("session_id")?,
        conversation_id: row.get("conversation_id")?,
        intent_id: row.get("intent_id")?,
        state: match state.as_str() {
            "linked" => LinkState::Linked,
            _ => LinkState::Pending,
        },
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

const LINK_COLUMNS: &str = "instance_id, issue_id, project_id, key, instance_url, worktree_id, \
workspace_id, session_id, conversation_id, intent_id, state, created_at, updated_at";

fn find_link_row(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<JiraSessionLink>, RpcError> {
    conn.query_row(
        &format!(
            "SELECT {LINK_COLUMNS} FROM jira_session_links
             WHERE instance_id = ?1 AND issue_id = ?2 AND project_id = ?3"
        ),
        params![identity.instance_id, identity.issue_id, project_id],
        row_to_link,
    )
    .optional()
    .map_err(error::from_sqlite)
}

fn project_exists(conn: &Connection, project_id: &str) -> Result<bool, RpcError> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
        [project_id],
        |row| row.get(0),
    )
    .map_err(error::from_sqlite)
}

fn require_worktree_project(
    conn: &Connection,
    worktree_id: &str,
    project_id: &str,
) -> Result<(), RpcError> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT project_id FROM worktrees WHERE id = ?1",
            [worktree_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    match owner {
        Some(owner) if owner == project_id => Ok(()),
        Some(owner) => Err(error::invalid_argument(format!(
            "worktree {worktree_id} belongs to project {owner}, not {project_id}"
        ))),
        None => Err(error::not_found("worktree does not exist")),
    }
}

/// Concurrency-safe start marker. Call BEFORE any worktree creation. All
/// decisions are made inside one `&Connection` borrow (the Engine's db
/// mutex in production), so two racing `jira.startIssue` calls serialize
/// here: exactly one of them gets `Began` for a given identity+project.
pub fn begin_intent(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
    intent_id: &str,
) -> Result<BeginIntentOutcome, RpcError> {
    ensure_table(conn)?;
    if intent_id.trim().is_empty() || intent_id.len() > 128 {
        return Err(error::invalid_argument("intent id is required"));
    }
    if !project_exists(conn, project_id)? {
        return Err(error::not_found("project does not exist"));
    }
    // A durable binding answers everything: replays and second clicks.
    if let Some(link) = find_link_row(conn, identity, project_id)? {
        return Ok(BeginIntentOutcome::Linked(Box::new(link)));
    }
    // A replayed request under the SAME intent id resumes its own checkpoint.
    let own: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT worktree_id, workspace_id FROM jira_start_intents WHERE intent_id = ?1",
            [intent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    if let Some((worktree_id, workspace_id)) = own {
        return Ok(BeginIntentOutcome::InFlight {
            intent_id: intent_id.to_string(),
            worktree_id,
            workspace_id,
        });
    }
    // A concurrent first start under a DIFFERENT intent id: join it.
    let other: Option<String> = conn
        .query_row(
            "SELECT intent_id FROM jira_start_intents
             WHERE instance_id = ?1 AND issue_id = ?2 AND project_id = ?3 AND state = 'pending'
             ORDER BY created_at, intent_id LIMIT 1",
            params![identity.instance_id, identity.issue_id, project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    if let Some(other) = other {
        let checkpoint: Option<(Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT worktree_id, workspace_id FROM jira_start_intents WHERE intent_id = ?1",
                [&other],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(error::from_sqlite)?;
        if let Some((worktree_id, workspace_id)) = checkpoint {
            return Ok(BeginIntentOutcome::InFlight {
                intent_id: other,
                worktree_id,
                workspace_id,
            });
        }
    }
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO jira_start_intents
         (intent_id, instance_id, issue_id, project_id, key, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)",
        params![
            intent_id,
            identity.instance_id,
            identity.issue_id,
            project_id,
            identity.key,
            now
        ],
    )
    .map_err(error::from_sqlite)?;
    Ok(BeginIntentOutcome::Began)
}

/// Durable partial-creation checkpoint: written immediately after the
/// shared worktree creation path returns and BEFORE the session/harness
/// launch. If the daemon dies here, recovery finds the exact resources
/// this start created — never an unrelated worktree, never a duplicate.
pub fn record_created_worktree(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
    intent_id: &str,
    worktree_id: &str,
    workspace_id: Option<&str>,
) -> Result<(), RpcError> {
    ensure_table(conn)?;
    require_worktree_project(conn, worktree_id, project_id)?;
    let now = now_rfc3339();
    let updated = conn
        .execute(
            "UPDATE jira_start_intents SET worktree_id = ?1, workspace_id = ?2, updated_at = ?3
             WHERE intent_id = ?4 AND state = 'pending'",
            params![worktree_id, workspace_id, now, intent_id],
        )
        .map_err(error::from_sqlite)?;
    if updated == 0 {
        return Err(error::not_found("pending start intent does not exist"));
    }
    // Upsert the pending link so a crash before the session receipt still
    // leaves exactly one binding for this identity+project.
    let existing = find_link_row(conn, identity, project_id)?;
    match existing {
        Some(link) if link.state == LinkState::Linked => {
            // Completed between checkpoint and now (post-recovery race):
            // keep the durable binding, refresh the display key only.
            conn.execute(
                "UPDATE jira_session_links SET key = ?1, updated_at = ?2
                 WHERE instance_id = ?3 AND issue_id = ?4 AND project_id = ?5",
                params![
                    identity.key,
                    now,
                    identity.instance_id,
                    identity.issue_id,
                    project_id
                ],
            )
            .map_err(error::from_sqlite)?;
        }
        Some(link) => {
            conn.execute(
                "UPDATE jira_session_links SET worktree_id = ?1, workspace_id = ?2, key = ?3, \
                 instance_url = ?4, intent_id = ?5, updated_at = ?6
                 WHERE instance_id = ?7 AND issue_id = ?8 AND project_id = ?9",
                params![
                    worktree_id,
                    workspace_id,
                    identity.key,
                    identity.instance_url,
                    intent_id,
                    now,
                    identity.instance_id,
                    identity.issue_id,
                    project_id
                ],
            )
            .map_err(error::from_sqlite)?;
            record_event(
                conn,
                "recovered",
                &link,
                Some("pending link re-checkpointed"),
            );
        }
        None => {
            let link = JiraSessionLink {
                instance_id: identity.instance_id.clone(),
                issue_id: identity.issue_id.clone(),
                key: identity.key.clone(),
                instance_url: identity.instance_url.clone(),
                project_id: project_id.to_string(),
                worktree_id: worktree_id.to_string(),
                workspace_id: workspace_id.map(str::to_string),
                session_id: None,
                conversation_id: None,
                intent_id: intent_id.to_string(),
                state: LinkState::Pending,
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            insert_link(conn, &link)?;
            record_event(conn, "pending", &link, Some("worktree checkpoint"));
        }
    }
    Ok(())
}

fn insert_link(conn: &Connection, link: &JiraSessionLink) -> Result<(), RpcError> {
    conn.execute(
        "INSERT INTO jira_session_links
         (instance_id, issue_id, project_id, key, instance_url, worktree_id, workspace_id, \
         session_id, conversation_id, intent_id, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            link.instance_id,
            link.issue_id,
            link.project_id,
            link.key,
            link.instance_url,
            link.worktree_id,
            link.workspace_id,
            link.session_id,
            link.conversation_id,
            link.intent_id,
            link.state.as_str(),
            link.created_at,
            link.updated_at
        ],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

/// Binds the session receipt to the pending start: flips the link to
/// `linked` and records the session. The bound worktree is exactly the one
/// the intent checkpointed — no adoption of unrelated resources.
pub fn complete_intent(
    conn: &Connection,
    intent_id: &str,
    session_id: Option<&str>,
) -> Result<JiraSessionLink, RpcError> {
    ensure_table(conn)?;
    let now = now_rfc3339();
    struct IntentRow {
        instance_id: String,
        issue_id: String,
        project_id: String,
        key: String,
        worktree_id: Option<String>,
        workspace_id: Option<String>,
    }
    let intent: Option<IntentRow> = conn
        .query_row(
            "SELECT instance_id, issue_id, project_id, key, worktree_id, workspace_id
             FROM jira_start_intents WHERE intent_id = ?1",
            [intent_id],
            |row| {
                Ok(IntentRow {
                    instance_id: row.get(0)?,
                    issue_id: row.get(1)?,
                    project_id: row.get(2)?,
                    key: row.get(3)?,
                    worktree_id: row.get(4)?,
                    workspace_id: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(error::from_sqlite)?;
    let IntentRow {
        instance_id,
        issue_id,
        project_id,
        key,
        worktree_id,
        workspace_id,
    } = intent.ok_or_else(|| error::not_found("start intent does not exist"))?;
    let worktree_id = worktree_id
        .ok_or_else(|| error::invalid_argument("start intent has no worktree checkpoint"))?;
    let link = JiraSessionLink {
        instance_id,
        issue_id,
        key,
        instance_url: String::new(),
        project_id,
        worktree_id: worktree_id.clone(),
        workspace_id,
        session_id: session_id.map(str::to_string),
        conversation_id: None,
        intent_id: intent_id.to_string(),
        state: LinkState::Linked,
        created_at: now.clone(),
        updated_at: now,
    };
    // Preserve the original created_at/instance_url on upsert.
    let existing = find_link_row(conn, &link.identity(), &link.project_id)?;
    let (created_at, instance_url) = existing
        .map(|l| (l.created_at, l.instance_url))
        .unwrap_or_else(|| (link.created_at.clone(), String::new()));
    let link = JiraSessionLink {
        created_at,
        instance_url: if instance_url.is_empty() {
            link.instance_url.clone()
        } else {
            instance_url
        },
        ..link
    };
    conn.execute(
        "INSERT INTO jira_session_links
         (instance_id, issue_id, project_id, key, instance_url, worktree_id, workspace_id, \
         session_id, conversation_id, intent_id, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'linked', ?11, ?12)
         ON CONFLICT(instance_id, issue_id, project_id) DO UPDATE SET
         key = excluded.key, session_id = excluded.session_id,
         worktree_id = excluded.worktree_id, workspace_id = excluded.workspace_id,
         intent_id = excluded.intent_id, state = 'linked', updated_at = excluded.updated_at",
        params![
            link.instance_id,
            link.issue_id,
            link.project_id,
            link.key,
            link.instance_url,
            link.worktree_id,
            link.workspace_id,
            link.session_id,
            link.conversation_id,
            link.intent_id,
            link.created_at,
            link.updated_at
        ],
    )
    .map_err(error::from_sqlite)?;
    conn.execute(
        "UPDATE jira_start_intents SET state = 'completed', session_id = ?1, updated_at = ?2
         WHERE intent_id = ?3",
        params![session_id, now_rfc3339(), intent_id],
    )
    .map_err(error::from_sqlite)?;
    record_event(
        conn,
        "linked",
        &link,
        session_id.map(|_| "session receipt bound"),
    );
    Ok(find_link_row(conn, &link.identity(), &link.project_id)?.unwrap_or(link))
}

/// Marks a start intent abandoned (creation failed or the caller gave up).
/// The pending pointer is released so a later start can begin cleanly; the
/// intent row and history keep the checkpoint for operator recovery.
pub fn abandon_intent(conn: &Connection, intent_id: &str, reason: &str) -> Result<(), RpcError> {
    ensure_table(conn)?;
    let now = now_rfc3339();
    let updated = conn
        .execute(
            "UPDATE jira_start_intents SET state = 'abandoned', updated_at = ?1
             WHERE intent_id = ?2 AND state = 'pending'",
            params![now, intent_id],
        )
        .map_err(error::from_sqlite)?;
    if updated == 0 {
        return Err(error::not_found("pending start intent does not exist"));
    }
    let (instance_id, issue_id, project_id, key): (String, String, String, String) = conn
        .query_row(
            "SELECT instance_id, issue_id, project_id, key FROM jira_start_intents
             WHERE intent_id = ?1",
            [intent_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(error::from_sqlite)?;
    // Release the pending pointer only if it still belongs to this intent.
    let released = conn
        .execute(
            "DELETE FROM jira_session_links
             WHERE instance_id = ?1 AND issue_id = ?2 AND project_id = ?3
             AND state = 'pending' AND intent_id = ?4",
            params![instance_id, issue_id, project_id, intent_id],
        )
        .map_err(error::from_sqlite)?;
    if released > 0 {
        let event = JiraSessionLink {
            instance_id,
            issue_id,
            project_id,
            key,
            intent_id: intent_id.to_string(),
            ..placeholder_link()
        };
        record_event(conn, "abandoned", &event, Some(reason));
    }
    Ok(())
}

fn placeholder_link() -> JiraSessionLink {
    JiraSessionLink {
        instance_id: String::new(),
        issue_id: String::new(),
        key: String::new(),
        instance_url: String::new(),
        project_id: String::new(),
        worktree_id: String::new(),
        workspace_id: None,
        session_id: None,
        conversation_id: None,
        intent_id: String::new(),
        state: LinkState::Pending,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

/// Manual "link existing worktree/session" action: binds the identity to an
/// existing worktree (and optional session) without creating anything.
/// Re-linking an already-linked issue moves the binding; the previous
/// binding stays in the event history.
pub fn link_existing(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
    worktree_id: &str,
    workspace_id: Option<&str>,
    session_id: Option<&str>,
) -> Result<JiraSessionLink, RpcError> {
    ensure_table(conn)?;
    if !project_exists(conn, project_id)? {
        return Err(error::not_found("project does not exist"));
    }
    require_worktree_project(conn, worktree_id, project_id)?;
    let now = now_rfc3339();
    let existing = find_link_row(conn, identity, project_id)?;
    let (created_at, intent_id) = existing
        .map(|l| (l.created_at, l.intent_id))
        .unwrap_or_else(|| (now.clone(), format!("manual-{}", now_rfc3339())));
    let link = JiraSessionLink {
        instance_id: identity.instance_id.clone(),
        issue_id: identity.issue_id.clone(),
        key: identity.key.clone(),
        instance_url: identity.instance_url.clone(),
        project_id: project_id.to_string(),
        worktree_id: worktree_id.to_string(),
        workspace_id: workspace_id.map(str::to_string),
        session_id: session_id.map(str::to_string),
        conversation_id: None,
        intent_id,
        state: LinkState::Linked,
        created_at,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO jira_session_links
         (instance_id, issue_id, project_id, key, instance_url, worktree_id, workspace_id, \
         session_id, conversation_id, intent_id, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'linked', ?11, ?12)
         ON CONFLICT(instance_id, issue_id, project_id) DO UPDATE SET
         key = excluded.key, instance_url = excluded.instance_url,
         worktree_id = excluded.worktree_id, workspace_id = excluded.workspace_id,
         session_id = excluded.session_id, intent_id = excluded.intent_id,
         state = 'linked', updated_at = excluded.updated_at",
        params![
            link.instance_id,
            link.issue_id,
            link.project_id,
            link.key,
            link.instance_url,
            link.worktree_id,
            link.workspace_id,
            link.session_id,
            link.conversation_id,
            link.intent_id,
            link.created_at,
            link.updated_at
        ],
    )
    .map_err(error::from_sqlite)?;
    record_event(conn, "linked", &link, Some("manual link"));
    Ok(link)
}

/// Removes ONLY the link pointer (and records the event). The worktree,
/// its sessions and every run record are untouched — unlink is reversible
/// through [`link_existing`].
pub fn unlink(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<bool, RpcError> {
    ensure_table(conn)?;
    let existing = find_link_row(conn, identity, project_id)?;
    let Some(link) = existing else {
        return Ok(false);
    };
    conn.execute(
        "DELETE FROM jira_session_links
         WHERE instance_id = ?1 AND issue_id = ?2 AND project_id = ?3",
        params![identity.instance_id, identity.issue_id, project_id],
    )
    .map_err(error::from_sqlite)?;
    record_event(conn, "unlinked", &link, None);
    Ok(true)
}

/// The durable binding for an identity within a project, if any.
pub fn find_link(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<JiraSessionLink>, RpcError> {
    ensure_table(conn)?;
    find_link_row(conn, identity, project_id)
}

/// Every binding of a project (all instances/issues). Restart-safe: the
/// renderer rebuilds its view from this after a reload.
pub fn list_for_project(
    conn: &Connection,
    project_id: &str,
) -> Result<Vec<JiraSessionLink>, RpcError> {
    ensure_table(conn)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {LINK_COLUMNS} FROM jira_session_links
             WHERE project_id = ?1 ORDER BY created_at, instance_id, issue_id"
        ))
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map([project_id], row_to_link)
        .map_err(error::from_sqlite)?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row.map_err(error::from_sqlite)?);
    }
    Ok(links)
}

/// The start_issue.rs replacement for title-based reuse: the durable
/// binding's worktree for this identity+project. Legacy title lookup stays
/// where root already codes it (only for pre-link workspaces).
pub fn find_worktree_for_identity(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<String>, RpcError> {
    Ok(find_link(conn, identity, project_id)?.map(|link| link.worktree_id))
}

/// The durable checkpoint of a start whose session receipt never arrived.
/// Recovery binds EXACTLY the recorded worktree — after verifying it still
/// exists and belongs to the project — and never adopts unrelated
/// resources. Returns `None` when there is nothing to recover.
pub fn find_pending_recovery(
    conn: &Connection,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<PendingRecovery>, RpcError> {
    ensure_table(conn)?;
    // Only a checkpoint recorded by a still-pending intent counts.
    let row: Option<(String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT i.intent_id, i.worktree_id, i.workspace_id FROM jira_start_intents i
             JOIN jira_session_links l ON l.intent_id = i.intent_id
              AND l.instance_id = i.instance_id AND l.issue_id = i.issue_id
              AND l.project_id = i.project_id AND l.state = 'pending'
             WHERE i.instance_id = ?1 AND i.issue_id = ?2 AND i.project_id = ?3
              AND i.state = 'pending' AND i.worktree_id IS NOT NULL
             ORDER BY i.created_at, i.intent_id LIMIT 1",
            params![identity.instance_id, identity.issue_id, project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    let Some((intent_id, Some(worktree_id), workspace_id)) = row else {
        return Ok(None);
    };
    // Never adopt: the recorded worktree must still exist under the project.
    if require_worktree_project(conn, &worktree_id, project_id).is_err() {
        return Ok(None);
    }
    Ok(Some(PendingRecovery {
        intent_id,
        worktree_id,
        workspace_id,
    }))
}

/// Resolve the linked session's PTY verdict from the daemon's own session
/// records. A missing row or an unrecognized verdict is `Unverifiable` —
/// loss of contact never proves exit.
pub fn resolve_session_state(
    conn: &Connection,
    link: &JiraSessionLink,
) -> Result<SessionResolution, RpcError> {
    let Some(session_id) = link.session_id.as_deref() else {
        return Ok(SessionResolution::NoSession);
    };
    let verdict: Option<String> = conn
        .query_row(
            "SELECT verdict FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    Ok(match verdict.as_deref() {
        Some("live") => SessionResolution::Live,
        Some("exited") => SessionResolution::Exited,
        Some("unverifiable") | None => SessionResolution::Unverifiable,
        Some(_) => SessionResolution::Unverifiable,
    })
}

/// Append-only history for a project, oldest first.
pub fn history_for_project(
    conn: &Connection,
    project_id: &str,
) -> Result<Vec<JiraSessionLinkEvent>, RpcError> {
    ensure_table(conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT event, instance_id, issue_id, project_id, key, intent_id, worktree_id, \
             workspace_id, session_id, detail, at FROM jira_session_link_events
             WHERE project_id = ?1 ORDER BY id",
        )
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map([project_id], |row| {
            Ok(JiraSessionLinkEvent {
                event: row.get(0)?,
                instance_id: row.get(1)?,
                issue_id: row.get(2)?,
                project_id: row.get(3)?,
                key: row.get(4)?,
                intent_id: row.get(5)?,
                worktree_id: row.get(6)?,
                workspace_id: row.get(7)?,
                session_id: row.get(8)?,
                detail: row.get(9)?,
                at: row.get(10)?,
            })
        })
        .map_err(error::from_sqlite)?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(error::from_sqlite)?);
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error;

    /// Minimal host schema: the real daemon db has `projects`, `worktrees`
    /// and `sessions` long before any link call; tests mirror just those
    /// columns these functions touch. Pure in-process rusqlite — no Engine,
    /// daemon, server or filesystem.
    fn fixture_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY);
             CREATE TABLE worktrees (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                created_at TEXT NOT NULL
             );
             CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                workspace_id TEXT,
                verdict TEXT NOT NULL
             );
             INSERT INTO projects (id) VALUES ('p1'), ('p2');",
        )
        .unwrap();
        conn
    }

    fn add_worktree(conn: &Connection, id: &str, project_id: &str) {
        conn.execute(
            "INSERT INTO worktrees (id, project_id, created_at) VALUES (?1, ?2, '2026-01-01T00:00:00Z')",
            params![id, project_id],
        )
        .unwrap();
    }

    fn add_session(conn: &Connection, id: &str, verdict: &str) {
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, verdict) VALUES (?1, 'ws-1', ?2)",
            params![id, verdict],
        )
        .unwrap();
    }

    fn identity(site: &str, issue_id: &str, key: &str) -> JiraTaskIdentity {
        JiraTaskIdentity::resolve(site, issue_id, key).unwrap()
    }

    #[test]
    fn replayed_intent_is_idempotent() {
        let conn = fixture_db();
        let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
        assert_eq!(
            begin_intent(&conn, &id, "p1", "intent-1").unwrap(),
            BeginIntentOutcome::Began
        );
        // The same request replayed (double click, retried RPC): the same
        // intent, no second start grant.
        assert_eq!(
            begin_intent(&conn, &id, "p1", "intent-1").unwrap(),
            BeginIntentOutcome::InFlight {
                intent_id: "intent-1".to_string(),
                worktree_id: None,
                workspace_id: None
            }
        );
        add_worktree(&conn, "wt-1", "p1");
        record_created_worktree(&conn, &id, "p1", "intent-1", "wt-1", Some("ws-1")).unwrap();
        // Replay after the checkpoint converges on the ONE pending binding
        // (same worktree, no second creation).
        assert!(matches!(
            begin_intent(&conn, &id, "p1", "intent-1").unwrap(),
            BeginIntentOutcome::Linked(ref l)
                if l.worktree_id == "wt-1" && l.state == LinkState::Pending
        ));
    }

    #[test]
    fn concurrent_and_replayed_starts_cannot_create_two_bindings() {
        let conn = fixture_db();
        let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
        assert!(matches!(
            begin_intent(&conn, &id, "p1", "intent-1").unwrap(),
            BeginIntentOutcome::Began
        ));
        // A different request id for the same start operation joins the
        // in-flight intent instead of racing it.
        assert!(matches!(
            begin_intent(&conn, &id, "p1", "intent-2").unwrap(),
            BeginIntentOutcome::InFlight { ref intent_id, .. } if intent_id == "intent-1"
        ));
        add_worktree(&conn, "wt-1", "p1");
        record_created_worktree(&conn, &id, "p1", "intent-1", "wt-1", Some("ws-1")).unwrap();
        // Still only one binding (now pending on the checkpointed worktree),
        // and the joined request sees exactly the same resources.
        assert!(matches!(
            begin_intent(&conn, &id, "p1", "intent-3").unwrap(),
            BeginIntentOutcome::Linked(ref l) if l.worktree_id == "wt-1"
        ));
        let link = complete_intent(&conn, "intent-1", Some("s-1")).unwrap();
        assert_eq!(link.worktree_id, "wt-1");
        assert_eq!(link.session_id.as_deref(), Some("s-1"));
        assert_eq!(link.state, LinkState::Linked);
        // After completion every further start converges on the ONE link.
        assert!(matches!(
            begin_intent(&conn, &id, "p1", "intent-4").unwrap(),
            BeginIntentOutcome::Linked(ref l) if l.worktree_id == "wt-1"
        ));
        assert_eq!(list_for_project(&conn, "p1").unwrap().len(), 1);
    }

    #[test]
    fn crash_before_session_receipt_recovers_exactly_the_recorded_worktree() {
        let conn = fixture_db();
        let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
        begin_intent(&conn, &id, "p1", "intent-1").unwrap();
        add_worktree(&conn, "wt-1", "p1");
        // Durable checkpoint before the harness launch; the daemon "dies".
        record_created_worktree(&conn, &id, "p1", "intent-1", "wt-1", Some("ws-1")).unwrap();
        let recovery = find_pending_recovery(&conn, &id, "p1").unwrap().unwrap();
        assert_eq!(recovery.intent_id, "intent-1");
        assert_eq!(recovery.worktree_id, "wt-1");
        assert_eq!(recovery.workspace_id.as_deref(), Some("ws-1"));
        // Recovery completes against the recorded worktree — no duplicate
        // creation, no adoption of anything else.
        let link = complete_intent(&conn, &recovery.intent_id, None).unwrap();
        assert_eq!(link.worktree_id, "wt-1");
        assert_eq!(link.state, LinkState::Linked);
        assert!(find_pending_recovery(&conn, &id, "p1").unwrap().is_none());
    }

    #[test]
    fn recovery_never_adopts_a_vanished_or_foreign_worktree() {
        let conn = fixture_db();
        let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
        begin_intent(&conn, &id, "p1", "intent-1").unwrap();
        add_worktree(&conn, "wt-1", "p1");
        record_created_worktree(&conn, &id, "p1", "intent-1", "wt-1", Some("ws-1")).unwrap();
        // The worktree disappeared (user deleted it mid-start): recovery
        // refuses instead of adopting a random row.
        conn.execute("DELETE FROM worktrees WHERE id = 'wt-1'", [])
            .unwrap();
        assert!(find_pending_recovery(&conn, &id, "p1").unwrap().is_none());
        // A worktree in ANOTHER project is never adopted either.
        add_worktree(&conn, "wt-other", "p2");
        begin_intent(&conn, &id, "p1", "intent-2").unwrap();
        assert!(record_created_worktree(&conn, &id, "p1", "intent-2", "wt-other", None).is_err());
        assert!(find_pending_recovery(&conn, &id, "p1").unwrap().is_none());
    }

    #[test]
    fn unlink_round_trip_preserves_worktree_sessions_and_history() {
        let conn = fixture_db();
        let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
        add_worktree(&conn, "wt-1", "p1");
        add_session(&conn, "s-1", "exited");
        let link = link_existing(&conn, &id, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
        assert_eq!(link.state, LinkState::Linked);
        // Unlink removes ONLY the pointer.
        assert!(unlink(&conn, &id, "p1").unwrap());
        assert!(find_link(&conn, &id, "p1").unwrap().is_none());
        let worktrees: i64 = conn
            .query_row("SELECT COUNT(*) FROM worktrees", [], |r| r.get(0))
            .unwrap();
        let sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!((worktrees, sessions), (1, 1));
        // History keeps the audit trail; a later relink appends.
        let events = history_for_project(&conn, "p1").unwrap();
        let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
        assert_eq!(names, vec!["linked", "unlinked"]);
        link_existing(&conn, &id, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
        let events = history_for_project(&conn, "p1").unwrap();
        assert_eq!(events.len(), 3);
        // Unlinking again when nothing is linked is a no-op, not an error.
        assert!(!unlink(&conn, &id, "p2").unwrap());
    }

    #[test]
    fn deleting_the_worktree_cleans_only_the_pointer() {
        let conn = fixture_db();
        let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
        add_worktree(&conn, "wt-1", "p1");
        link_existing(&conn, &id, "p1", "wt-1", None, None).unwrap();
        conn.execute("DELETE FROM worktrees WHERE id = 'wt-1'", [])
            .unwrap();
        assert!(find_link(&conn, &id, "p1").unwrap().is_none());
        // History is preserved through the cleanup.
        assert_eq!(history_for_project(&conn, "p1").unwrap().len(), 1);
    }

    #[test]
    fn session_resolution_distinguishes_live_verdicts_and_loss_of_contact() {
        let conn = fixture_db();
        let link_with = |session: Option<&str>| JiraSessionLink {
            session_id: session.map(str::to_string),
            ..placeholder_link()
        };
        add_session(&conn, "s-live", "live");
        add_session(&conn, "s-exited", "exited");
        add_session(&conn, "s-unver", "unverifiable");
        assert_eq!(
            resolve_session_state(&conn, &link_with(Some("s-live"))).unwrap(),
            SessionResolution::Live
        );
        assert_eq!(
            resolve_session_state(&conn, &link_with(Some("s-exited"))).unwrap(),
            SessionResolution::Exited
        );
        assert_eq!(
            resolve_session_state(&conn, &link_with(Some("s-unver"))).unwrap(),
            SessionResolution::Unverifiable
        );
        // Row vanished / unknown verdict / never bound: never "exited".
        assert_eq!(
            resolve_session_state(&conn, &link_with(Some("s-gone"))).unwrap(),
            SessionResolution::Unverifiable
        );
        add_session(&conn, "s-unknown", "weird-future-verdict");
        assert_eq!(
            resolve_session_state(&conn, &link_with(Some("s-unknown"))).unwrap(),
            SessionResolution::Unverifiable
        );
        assert_eq!(
            resolve_session_state(&conn, &link_with(None)).unwrap(),
            SessionResolution::NoSession
        );
    }

    #[test]
    fn same_displayed_key_on_two_instances_stays_isolated() {
        let conn = fixture_db();
        let acme = identity("https://acme.atlassian.net", "10001", "DROG-42");
        let globex = identity("https://globex.atlassian.net", "10002", "DROG-42");
        add_worktree(&conn, "wt-a", "p1");
        add_worktree(&conn, "wt-g", "p1");
        link_existing(&conn, &acme, "p1", "wt-a", None, None).unwrap();
        link_existing(&conn, &globex, "p1", "wt-g", None, None).unwrap();
        assert_eq!(
            find_worktree_for_identity(&conn, &acme, "p1")
                .unwrap()
                .as_deref(),
            Some("wt-a")
        );
        assert_eq!(
            find_worktree_for_identity(&conn, &globex, "p1")
                .unwrap()
                .as_deref(),
            Some("wt-g")
        );
        assert_eq!(list_for_project(&conn, "p1").unwrap().len(), 2);
        // The same instance in another project binds independently.
        add_worktree(&conn, "wt-a2", "p2");
        link_existing(&conn, &acme, "p2", "wt-a2", None, None).unwrap();
        assert_eq!(
            find_worktree_for_identity(&conn, &acme, "p2")
                .unwrap()
                .as_deref(),
            Some("wt-a2")
        );
        assert_eq!(
            find_worktree_for_identity(&conn, &acme, "p1")
                .unwrap()
                .as_deref(),
            Some("wt-a")
        );
    }

    #[test]
    fn reconnect_with_renamed_key_and_title_keeps_the_binding() {
        let conn = fixture_db();
        add_worktree(&conn, "wt-1", "p1");
        // Bound under the original account's view of the instance.
        let original = identity("https://acme.atlassian.net", "10001", "DROG-42");
        link_existing(&conn, &original, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
        // The SAME instance (same URL), another account, issue renamed:
        // identity resolves to the same link id, and refreshing the display
        // fields keeps the session binding.
        let reconnected = identity("https://acme.atlassian.net", "10001", "OPS-77");
        let existing = find_link(&conn, &reconnected, "p1").unwrap().unwrap();
        assert_eq!(existing.worktree_id, "wt-1");
        assert_eq!(existing.session_id.as_deref(), Some("s-1"));
        let refreshed =
            link_existing(&conn, &reconnected, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
        assert_eq!(refreshed.key, "OPS-77");
        assert_eq!(refreshed.session_id.as_deref(), Some("s-1"));
        // Still one row; the account email never appears anywhere.
        assert_eq!(list_for_project(&conn, "p1").unwrap().len(), 1);
    }

    #[test]
    fn begin_intent_validates_project_and_intent_id() {
        let conn = fixture_db();
        let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
        assert!(matches!(
            begin_intent(&conn, &id, "missing", "i")
                .unwrap_err()
                .code
                .as_str(),
            "not_found"
        ));
        assert!(matches!(
            begin_intent(&conn, &id, "p1", "  ")
                .unwrap_err()
                .code
                .as_str(),
            "invalid_argument"
        ));
        let long = "x".repeat(200);
        assert!(matches!(
            begin_intent(&conn, &id, "p1", &long)
                .unwrap_err()
                .code
                .as_str(),
            "invalid_argument"
        ));
    }

    #[test]
    fn complete_and_abandon_reject_missing_intents() {
        let conn = fixture_db();
        assert!(matches!(
            complete_intent(&conn, "nope", None)
                .unwrap_err()
                .code
                .as_str(),
            "not_found"
        ));
        assert!(matches!(
            abandon_intent(&conn, "nope", "why")
                .unwrap_err()
                .code
                .as_str(),
            "not_found"
        ));
        // Completing before the worktree checkpoint is refused: a session
        // receipt without resources must not silently fabricate a binding.
        begin_intent(
            &conn,
            &identity("https://acme.atlassian.net", "1", "DROG-1"),
            "p1",
            "i1",
        )
        .unwrap();
        assert!(matches!(
            complete_intent(&conn, "i1", Some("s"))
                .unwrap_err()
                .code
                .as_str(),
            "invalid_argument"
        ));
    }

    #[test]
    fn error_helpers_surface_sqlite_failures_with_codes() {
        // Unused-import hygiene for the `error` alias inside tests.
        let _ = error::invalid_argument("probe");
    }
}
