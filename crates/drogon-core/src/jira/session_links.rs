//! C06 PROPOSAL (unwired): stable Jira issue→session links in the daemon's
//! SQLite database. This file is NOT reachable from the daemon:
//! `jira/mod.rs` is root-held and the additive `pub mod session_links;`
//! export was requested through the coordinator. Until that handover the
//! module is compiled ONLY by `tests/jira_session_links.rs` (test-local
//! `#[path]`), so none of the tables below are created in production and
//! nothing here claims durable integration. Root owns schema/migration
//! reconciliation — this is the exact extension proposed for it, including
//! the HOST scope: bindings are per Drogon `host_id`, because sessions are
//! host-scoped and "reopen the correct session" must answer per host.
//!
//! Distinct from root's `worktree_issue_links` card-property authority:
//! rows here key on the stable task identity tier (namespaced provisional
//! endpoint label or source-backed instance identifier — never the account
//! email or display key), carry the actual session binding, and implement
//! the start-intent lifecycle that makes double clicks and replayed
//! requests idempotent. Unlinking never deletes the worktree, sessions or
//! run history.
//!
//! Deliberately self-contained (no `crate::` imports): the same file
//! compiles inside the drogon-core lib (after the one-line mod handover,
//! importing `drogon_core::jira::identity::JiraTaskIdentity`) and inside
//! the integration-test crate unchanged.
//! MIT Copyright (c) 2026 Lovecast Inc.

use drogon_core::jira::identity::JiraTaskIdentity;
use drogon_protocol::RpcError;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

// --- local helpers (self-contained; no crate:: deps) -----------------------

fn invalid(msg: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", msg)
}

fn not_found(msg: impl Into<String>) -> RpcError {
    RpcError::new("not_found", msg)
}

fn from_sqlite(err: rusqlite::Error) -> RpcError {
    RpcError::new("internal_error", format!("database error: {err}"))
}

/// Minimal UTC RFC3339 (second resolution) so this file needs no
/// date crate; identical semantics to the Engine's clock helper.
fn now_rfc3339() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant's civil-from-days (public domain).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 * 7) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 400);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = era * 400 + yoe as i64 + i64::from(mo <= 2);
    format!("{y:04}-{mo:02}-{d:02}T{hour:02}:{minute:02}:{second:02}")
}

// --- public shapes ----------------------------------------------------------

/// Which identity tier a binding is keyed by. `Provisional` = the
/// configured endpoint's stable label; `EndpointAttested` = a server-
/// observed endpoint URL (continuity evidence only, unresolved for
/// immutable-instance identity); `SourceBacked` = the Cloud tenant id,
/// the one immutable-installation identity of record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstanceTier {
    Provisional,
    EndpointAttested,
    SourceBacked,
}

impl InstanceTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Provisional => "provisional",
            Self::EndpointAttested => "endpoint-attested",
            Self::SourceBacked => "source-backed",
        }
    }

    fn from_identity(identity: &JiraTaskIdentity) -> Self {
        match identity.instance {
            drogon_core::jira::identity::JiraInstanceIdentity::Provisional { .. } => {
                Self::Provisional
            }
            drogon_core::jira::identity::JiraInstanceIdentity::EndpointAttested { .. } => {
                Self::EndpointAttested
            }
            drogon_core::jira::identity::JiraInstanceIdentity::SourceBacked { .. } => {
                Self::SourceBacked
            }
        }
    }
}

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

/// One stable issue→session binding for ONE Drogon host. `session_id` is
/// the latest bound session; earlier sessions of the same workspace stay in
/// the `sessions` table (historical run records are never touched here).
/// `conversation_id` is reserved for the C05 bot-conversation variant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSessionLink {
    pub host_id: String,
    /// Namespaced instance key (`provisional:…`, `cloudid:…`, `server:…`).
    pub instance_key: String,
    pub instance_tier: InstanceTier,
    /// Provenance of a source-backed identifier (`InstanceIdentitySource`),
    /// `None` for the provisional tier.
    pub instance_source: Option<String>,
    pub instance_url: String,
    pub issue_id: String,
    /// Display key at bind time; renames do not affect lookups.
    pub key: String,
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
    /// The stable composite link id (tier-namespaced), for logs and the
    /// renderer's resume-hint cache.
    pub fn link_id(&self) -> String {
        format!("{}:{}", self.instance_key, self.issue_id)
    }
}

/// Session liveness as reported by the daemon's own PTY verdicts. An
/// unknown verdict or a missing session row is `Unverifiable` — loss of
/// contact never proves exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
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
    /// A different in-flight start operation for the same identity+host+
    /// project is pending: join it instead of racing it.
    InFlight {
        intent_id: String,
        worktree_id: Option<String>,
        workspace_id: Option<String>,
    },
    /// This intent owns the start now; proceed to create the worktree and
    /// checkpoint it with [`record_created_worktree`].
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
    pub host_id: String,
    pub instance_key: String,
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

// --- proposed schema (root-owned adoption) ----------------------------------
//
// Exact extension for reconciliation with root's schema ownership. All
// three tables are created lazily by the same runtime discipline as
// worktree_issue.rs (no startup migration), but adoption is root's call:
//
// jira_session_links — PK includes HOST scope:
//   PRIMARY KEY (host_id, instance_key, issue_id, project_id)
//   instance_state CHECK IN ('provisional','source-backed')
//   FK project_id -> projects(id) ON DELETE CASCADE
//   trigger jira_session_links_worktree_cleanup (AFTER DELETE ON worktrees)
// jira_start_intents — PK intent_id, index (host_id, instance_key,
//   issue_id, project_id, state)
// jira_session_link_events — append-only, index (project_id, at)

fn ensure_table(conn: &Connection) -> Result<(), RpcError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS jira_session_links (
            host_id TEXT NOT NULL,
            instance_key TEXT NOT NULL,
        instance_tier TEXT NOT NULL CHECK(instance_tier IN ('provisional','endpoint-attested','source-backed')),
            instance_source TEXT,
            instance_url TEXT NOT NULL,
            issue_id TEXT NOT NULL,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            worktree_id TEXT NOT NULL,
            workspace_id TEXT,
            session_id TEXT,
            conversation_id TEXT,
            intent_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('pending','linked')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (host_id, instance_key, issue_id, project_id)
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
            host_id TEXT NOT NULL,
            instance_key TEXT NOT NULL,
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
            ON jira_start_intents(host_id, instance_key, issue_id, project_id, state);
        CREATE TABLE IF NOT EXISTS jira_session_link_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event TEXT NOT NULL,
            host_id TEXT NOT NULL,
            instance_key TEXT NOT NULL,
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
    .map_err(from_sqlite)
}

fn record_event(conn: &Connection, event: &str, link: &JiraSessionLink, detail: Option<&str>) {
    let _ = conn.execute(
        "INSERT INTO jira_session_link_events
         (event, host_id, instance_key, issue_id, project_id, key, intent_id, worktree_id, workspace_id, session_id, detail, at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            event,
            link.host_id,
            link.instance_key,
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

const LINK_COLUMNS: &str = "host_id, instance_key, instance_tier, instance_source, instance_url, \
issue_id, project_id, key, worktree_id, workspace_id, session_id, conversation_id, intent_id, \
state, created_at, updated_at";

fn row_to_link(row: &rusqlite::Row<'_>) -> rusqlite::Result<JiraSessionLink> {
    let tier: String = row.get("instance_tier")?;
    let state: String = row.get("state")?;
    Ok(JiraSessionLink {
        host_id: row.get("host_id")?,
        instance_key: row.get("instance_key")?,
        instance_tier: match tier.as_str() {
            "source-backed" => InstanceTier::SourceBacked,
            "endpoint-attested" => InstanceTier::EndpointAttested,
            _ => InstanceTier::Provisional,
        },
        instance_source: row.get("instance_source")?,
        instance_url: row.get("instance_url")?,
        issue_id: row.get("issue_id")?,
        project_id: row.get("project_id")?,
        key: row.get("key")?,
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

fn link_row_from_identity(
    identity: &JiraTaskIdentity,
) -> (String, InstanceTier, Option<String>, String) {
    use drogon_core::jira::identity::JiraInstanceIdentity;
    let tier = InstanceTier::from_identity(identity);
    let source = match &identity.instance {
        JiraInstanceIdentity::SourceBacked { source, .. } => Some(source.as_str().to_string()),
        JiraInstanceIdentity::Provisional { .. }
        | JiraInstanceIdentity::EndpointAttested { .. } => None,
    };
    (
        identity.instance.key(),
        tier,
        source,
        identity.instance.endpoint_url().to_string(),
    )
}

fn find_link_row(
    conn: &Connection,
    host_id: &str,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<JiraSessionLink>, RpcError> {
    let instance_key = identity.instance.key();
    conn.query_row(
        &format!(
            "SELECT {LINK_COLUMNS} FROM jira_session_links
             WHERE host_id = ?1 AND instance_key = ?2 AND issue_id = ?3 AND project_id = ?4"
        ),
        params![host_id, instance_key, identity.issue_id, project_id],
        row_to_link,
    )
    .optional()
    .map_err(from_sqlite)
}

fn project_exists(conn: &Connection, project_id: &str) -> Result<bool, RpcError> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
        [project_id],
        |row| row.get(0),
    )
    .map_err(from_sqlite)
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
        .map_err(from_sqlite)?;
    match owner {
        Some(owner) if owner == project_id => Ok(()),
        Some(owner) => Err(invalid(format!(
            "worktree {worktree_id} belongs to project {owner}, not {project_id}"
        ))),
        None => Err(not_found("worktree does not exist")),
    }
}

/// Concurrency-safe start marker. Call BEFORE any worktree creation. All
/// decisions are made inside one `&Connection` borrow (the Engine's db
/// mutex in production), so two racing `jira.startIssue` calls serialize
/// here: exactly one of them gets `Began` for a given host+identity+project.
pub fn begin_intent(
    conn: &Connection,
    host_id: &str,
    identity: &JiraTaskIdentity,
    project_id: &str,
    intent_id: &str,
) -> Result<BeginIntentOutcome, RpcError> {
    ensure_table(conn)?;
    if host_id.trim().is_empty() {
        return Err(invalid("host id is required"));
    }
    if intent_id.trim().is_empty() || intent_id.len() > 128 {
        return Err(invalid("intent id is required"));
    }
    if !project_exists(conn, project_id)? {
        return Err(not_found("project does not exist"));
    }
    // A durable binding answers everything: replays and second clicks.
    if let Some(link) = find_link_row(conn, host_id, identity, project_id)? {
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
        .map_err(from_sqlite)?;
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
             WHERE host_id = ?1 AND instance_key = ?2 AND issue_id = ?3 AND project_id = ?4
              AND state = 'pending'
             ORDER BY created_at, intent_id LIMIT 1",
            params![
                host_id,
                identity.instance.key(),
                identity.issue_id,
                project_id
            ],
            |row| row.get(0),
        )
        .optional()
        .map_err(from_sqlite)?;
    if let Some(other) = other {
        let checkpoint: Option<(Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT worktree_id, workspace_id FROM jira_start_intents WHERE intent_id = ?1",
                [&other],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(from_sqlite)?;
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
         (intent_id, host_id, instance_key, issue_id, project_id, key, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7)",
        params![
            intent_id,
            host_id,
            identity.instance.key(),
            identity.issue_id,
            project_id,
            identity.key,
            now
        ],
    )
    .map_err(from_sqlite)?;
    Ok(BeginIntentOutcome::Began)
}

/// Durable partial-creation checkpoint: written immediately after the
/// shared worktree creation path returns and BEFORE the session/harness
/// launch. If the daemon dies here, recovery finds the exact resources
/// this start created — never an unrelated worktree, never a duplicate.
pub fn record_created_worktree(
    conn: &Connection,
    host_id: &str,
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
        .map_err(from_sqlite)?;
    if updated == 0 {
        return Err(not_found("pending start intent does not exist"));
    }
    // Upsert the pending link so a crash before the session receipt still
    // leaves exactly one binding for this identity+project.
    let existing = find_link_row(conn, host_id, identity, project_id)?;
    let (instance_key, instance_tier, instance_source, instance_url) =
        link_row_from_identity(identity);
    match existing {
        Some(link) if link.state == LinkState::Linked => {
            // Completed between checkpoint and now (post-recovery race):
            // keep the durable binding, refresh the display key only.
            conn.execute(
                "UPDATE jira_session_links SET key = ?1, updated_at = ?2
                 WHERE host_id = ?3 AND instance_key = ?4 AND issue_id = ?5 AND project_id = ?6",
                params![
                    identity.key,
                    now,
                    host_id,
                    instance_key,
                    identity.issue_id,
                    project_id
                ],
            )
            .map_err(from_sqlite)?;
        }
        Some(link) => {
            conn.execute(
                "UPDATE jira_session_links SET worktree_id = ?1, workspace_id = ?2, key = ?3, \
                 instance_url = ?4, intent_id = ?5, updated_at = ?6
                 WHERE host_id = ?7 AND instance_key = ?8 AND issue_id = ?9 AND project_id = ?10",
                params![
                    worktree_id,
                    workspace_id,
                    identity.key,
                    instance_url,
                    intent_id,
                    now,
                    link.host_id,
                    link.instance_key,
                    link.issue_id,
                    link.project_id
                ],
            )
            .map_err(from_sqlite)?;
            record_event(
                conn,
                "recovered",
                &link,
                Some("pending link re-checkpointed"),
            );
        }
        None => {
            let link = JiraSessionLink {
                host_id: host_id.to_string(),
                instance_key,
                instance_tier,
                instance_source,
                instance_url,
                issue_id: identity.issue_id.clone(),
                key: identity.key.clone(),
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
         (host_id, instance_key, instance_tier, instance_source, instance_url, issue_id, \
         project_id, key, worktree_id, workspace_id, session_id, conversation_id, intent_id, \
         state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            link.host_id,
            link.instance_key,
            link.instance_tier.as_str(),
            link.instance_source,
            link.instance_url,
            link.issue_id,
            link.project_id,
            link.key,
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
    .map_err(from_sqlite)?;
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
    struct IntentRow {
        host_id: String,
        instance_key: String,
        issue_id: String,
        project_id: String,
        key: String,
        worktree_id: Option<String>,
        workspace_id: Option<String>,
    }
    let intent: Option<IntentRow> = conn
        .query_row(
            "SELECT host_id, instance_key, issue_id, project_id, key, worktree_id, workspace_id
             FROM jira_start_intents WHERE intent_id = ?1",
            [intent_id],
            |row| {
                Ok(IntentRow {
                    host_id: row.get(0)?,
                    instance_key: row.get(1)?,
                    issue_id: row.get(2)?,
                    project_id: row.get(3)?,
                    key: row.get(4)?,
                    worktree_id: row.get(5)?,
                    workspace_id: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(from_sqlite)?;
    let IntentRow {
        host_id,
        instance_key,
        issue_id,
        project_id,
        key,
        worktree_id,
        workspace_id,
    } = intent.ok_or_else(|| not_found("start intent does not exist"))?;
    let worktree_id =
        worktree_id.ok_or_else(|| invalid("start intent has no worktree checkpoint"))?;
    let now = now_rfc3339();
    // Preserve the original created_at and instance columns on upsert.
    let existing: Option<(String, String, Option<String>, String)> = conn
        .query_row(
            "SELECT created_at, instance_url, instance_source, instance_tier
             FROM jira_session_links
             WHERE host_id = ?1 AND instance_key = ?2 AND issue_id = ?3 AND project_id = ?4",
            params![host_id, instance_key, issue_id, project_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(from_sqlite)?;
    let (created_at, instance_url, instance_source, instance_tier) =
        existing.unwrap_or_else(|| (now.clone(), String::new(), None, "provisional".to_string()));
    let link = JiraSessionLink {
        host_id,
        instance_key,
        instance_tier: if instance_tier == "source-backed" {
            InstanceTier::SourceBacked
        } else if instance_tier == "endpoint-attested" {
            InstanceTier::EndpointAttested
        } else {
            InstanceTier::Provisional
        },
        instance_source,
        instance_url,
        issue_id,
        key,
        project_id,
        worktree_id: worktree_id.clone(),
        workspace_id,
        session_id: session_id.map(str::to_string),
        conversation_id: None,
        intent_id: intent_id.to_string(),
        state: LinkState::Linked,
        created_at,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO jira_session_links
         (host_id, instance_key, instance_tier, instance_source, instance_url, issue_id, \
         project_id, key, worktree_id, workspace_id, session_id, conversation_id, intent_id, \
         state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'linked', ?14, ?15)
         ON CONFLICT(host_id, instance_key, issue_id, project_id) DO UPDATE SET
         key = excluded.key, session_id = excluded.session_id,
         worktree_id = excluded.worktree_id, workspace_id = excluded.workspace_id,
         intent_id = excluded.intent_id, state = 'linked', updated_at = excluded.updated_at",
        params![
            link.host_id,
            link.instance_key,
            link.instance_tier.as_str(),
            link.instance_source,
            link.instance_url,
            link.issue_id,
            link.project_id,
            link.key,
            link.worktree_id,
            link.workspace_id,
            link.session_id,
            link.conversation_id,
            link.intent_id,
            link.created_at,
            link.updated_at
        ],
    )
    .map_err(from_sqlite)?;
    conn.execute(
        "UPDATE jira_start_intents SET state = 'completed', session_id = ?1, updated_at = ?2
         WHERE intent_id = ?3",
        params![session_id, now_rfc3339(), intent_id],
    )
    .map_err(from_sqlite)?;
    record_event(
        conn,
        "linked",
        &link,
        session_id.map(|_| "session receipt bound"),
    );
    Ok(link)
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
        .map_err(from_sqlite)?;
    if updated == 0 {
        return Err(not_found("pending start intent does not exist"));
    }
    let (host_id, instance_key, issue_id, project_id, key): (
        String,
        String,
        String,
        String,
        String,
    ) = conn
        .query_row(
            "SELECT host_id, instance_key, issue_id, project_id, key FROM jira_start_intents
             WHERE intent_id = ?1",
            [intent_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(from_sqlite)?;
    // Release the pending pointer only if it still belongs to this intent.
    let released = conn
        .execute(
            "DELETE FROM jira_session_links
             WHERE host_id = ?1 AND instance_key = ?2 AND issue_id = ?3 AND project_id = ?4
             AND state = 'pending' AND intent_id = ?5",
            params![host_id, instance_key, issue_id, project_id, intent_id],
        )
        .map_err(from_sqlite)?;
    if released > 0 {
        let event = JiraSessionLink {
            host_id,
            instance_key,
            instance_tier: InstanceTier::Provisional,
            instance_source: None,
            instance_url: String::new(),
            issue_id,
            project_id,
            key,
            worktree_id: String::new(),
            workspace_id: None,
            session_id: None,
            conversation_id: None,
            intent_id: intent_id.to_string(),
            state: LinkState::Pending,
            created_at: String::new(),
            updated_at: String::new(),
        };
        record_event(conn, "abandoned", &event, Some(reason));
    }
    Ok(())
}

/// Manual "link existing worktree/session" action: binds the identity to an
/// existing worktree (and optional session) without creating anything.
/// Re-linking an already-linked issue moves the binding; the previous
/// binding stays in the event history.
#[allow(clippy::too_many_arguments)]
pub fn link_existing(
    conn: &Connection,
    host_id: &str,
    identity: &JiraTaskIdentity,
    project_id: &str,
    worktree_id: &str,
    workspace_id: Option<&str>,
    session_id: Option<&str>,
) -> Result<JiraSessionLink, RpcError> {
    ensure_table(conn)?;
    if host_id.trim().is_empty() {
        return Err(invalid("host id is required"));
    }
    if !project_exists(conn, project_id)? {
        return Err(not_found("project does not exist"));
    }
    require_worktree_project(conn, worktree_id, project_id)?;
    let now = now_rfc3339();
    let existing = find_link_row(conn, host_id, identity, project_id)?;
    let (created_at, intent_id) = existing
        .map(|l| (l.created_at, l.intent_id))
        .unwrap_or_else(|| (now.clone(), format!("manual-{}", now_rfc3339())));
    let (instance_key, instance_tier, instance_source, instance_url) =
        link_row_from_identity(identity);
    let link = JiraSessionLink {
        host_id: host_id.to_string(),
        instance_key,
        instance_tier,
        instance_source,
        instance_url,
        issue_id: identity.issue_id.clone(),
        key: identity.key.clone(),
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
         (host_id, instance_key, instance_tier, instance_source, instance_url, issue_id, \
         project_id, key, worktree_id, workspace_id, session_id, conversation_id, intent_id, \
         state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'linked', ?14, ?15)
         ON CONFLICT(host_id, instance_key, issue_id, project_id) DO UPDATE SET
         key = excluded.key, instance_url = excluded.instance_url,
         worktree_id = excluded.worktree_id, workspace_id = excluded.workspace_id,
         session_id = excluded.session_id, intent_id = excluded.intent_id,
         state = 'linked', updated_at = excluded.updated_at",
        params![
            link.host_id,
            link.instance_key,
            link.instance_tier.as_str(),
            link.instance_source,
            link.instance_url,
            link.issue_id,
            link.project_id,
            link.key,
            link.worktree_id,
            link.workspace_id,
            link.session_id,
            link.conversation_id,
            link.intent_id,
            link.created_at,
            link.updated_at
        ],
    )
    .map_err(from_sqlite)?;
    record_event(conn, "linked", &link, Some("manual link"));
    Ok(link)
}

/// Removes ONLY the link pointer (and records the event). The worktree,
/// its sessions and every run record are untouched — unlink is reversible
/// through [`link_existing`].
pub fn unlink(
    conn: &Connection,
    host_id: &str,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<bool, RpcError> {
    ensure_table(conn)?;
    let existing = find_link_row(conn, host_id, identity, project_id)?;
    let Some(link) = existing else {
        return Ok(false);
    };
    conn.execute(
        "DELETE FROM jira_session_links
         WHERE host_id = ?1 AND instance_key = ?2 AND issue_id = ?3 AND project_id = ?4",
        params![
            host_id,
            identity.instance.key(),
            identity.issue_id,
            project_id
        ],
    )
    .map_err(from_sqlite)?;
    record_event(conn, "unlinked", &link, None);
    Ok(true)
}

/// The durable binding for an identity within a host+project, if any.
pub fn find_link(
    conn: &Connection,
    host_id: &str,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<JiraSessionLink>, RpcError> {
    ensure_table(conn)?;
    find_link_row(conn, host_id, identity, project_id)
}

/// Every binding of a project on this host. Restart-safe: the renderer
/// rebuilds its view from this after a reload.
pub fn list_for_project(
    conn: &Connection,
    host_id: &str,
    project_id: &str,
) -> Result<Vec<JiraSessionLink>, RpcError> {
    ensure_table(conn)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {LINK_COLUMNS} FROM jira_session_links
             WHERE host_id = ?1 AND project_id = ?2 ORDER BY created_at, instance_key, issue_id"
        ))
        .map_err(from_sqlite)?;
    let rows = stmt
        .query_map(params![host_id, project_id], row_to_link)
        .map_err(from_sqlite)?;
    let mut links = Vec::new();
    for row in rows {
        links.push(row.map_err(from_sqlite)?);
    }
    Ok(links)
}

/// The start_issue.rs replacement for title-based reuse: the durable
/// binding's worktree for this identity+host+project. Legacy title lookup
/// stays where root already codes it (only for pre-link workspaces).
pub fn find_worktree_for_identity(
    conn: &Connection,
    host_id: &str,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<String>, RpcError> {
    Ok(find_link(conn, host_id, identity, project_id)?.map(|link| link.worktree_id))
}

/// The durable checkpoint of a start whose session receipt never arrived.
/// Recovery binds EXACTLY the recorded worktree — after verifying it still
/// exists and belongs to the project — and never adopts unrelated
/// resources. Returns `None` when there is nothing to recover.
pub fn find_pending_recovery(
    conn: &Connection,
    host_id: &str,
    identity: &JiraTaskIdentity,
    project_id: &str,
) -> Result<Option<PendingRecovery>, RpcError> {
    ensure_table(conn)?;
    // Only a checkpoint recorded by a still-pending intent counts.
    let row: Option<(String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT i.intent_id, i.worktree_id, i.workspace_id FROM jira_start_intents i
             JOIN jira_session_links l ON l.intent_id = i.intent_id
              AND l.host_id = i.host_id AND l.instance_key = i.instance_key
              AND l.issue_id = i.issue_id AND l.project_id = i.project_id
              AND l.state = 'pending'
             WHERE i.host_id = ?1 AND i.instance_key = ?2 AND i.issue_id = ?3
              AND i.project_id = ?4 AND i.state = 'pending' AND i.worktree_id IS NOT NULL
             ORDER BY i.created_at, i.intent_id LIMIT 1",
            params![
                host_id,
                identity.instance.key(),
                identity.issue_id,
                project_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(from_sqlite)?;
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
        .map_err(from_sqlite)?;
    Ok(match verdict.as_deref() {
        Some("live") => SessionResolution::Live,
        Some("exited") => SessionResolution::Exited,
        _ => SessionResolution::Unverifiable,
    })
}

/// Append-only history for a project on this host, oldest first.
pub fn history_for_project(
    conn: &Connection,
    host_id: &str,
    project_id: &str,
) -> Result<Vec<JiraSessionLinkEvent>, RpcError> {
    ensure_table(conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT event, host_id, instance_key, issue_id, project_id, key, intent_id, \
             worktree_id, workspace_id, session_id, detail, at FROM jira_session_link_events
             WHERE host_id = ?1 AND project_id = ?2 ORDER BY id",
        )
        .map_err(from_sqlite)?;
    let rows = stmt
        .query_map(params![host_id, project_id], |row| {
            Ok(JiraSessionLinkEvent {
                event: row.get(0)?,
                host_id: row.get(1)?,
                instance_key: row.get(2)?,
                issue_id: row.get(3)?,
                project_id: row.get(4)?,
                key: row.get(5)?,
                intent_id: row.get(6)?,
                worktree_id: row.get(7)?,
                workspace_id: row.get(8)?,
                session_id: row.get(9)?,
                detail: row.get(10)?,
                at: row.get(11)?,
            })
        })
        .map_err(from_sqlite)?;
    let mut events = Vec::new();
    for row in rows {
        events.push(row.map_err(from_sqlite)?);
    }
    Ok(events)
}
