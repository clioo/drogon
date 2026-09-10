use drogon_protocol::{MAX_FRAME_BYTES, RpcError};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{Engine, bots::records::HistoryEntry, bots::storage, error, workspace};

/// One budget shared by the preflight and the final materialized-size check, so callers
/// cannot distinguish "rejected early" from "rejected late" by tuning payload shape.
const SNAPSHOT_BUDGET_BYTES: i64 = (MAX_FRAME_BYTES / 2) as i64;
/// Upper bound on history rows, enforced by one `COUNT(*)` before any row is fetched:
/// per-row parse/materialization cost stays bounded independent of the byte budget.
const MAX_SNAPSHOT_HISTORY_ROWS: i64 = 5_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotScope {
    workspace_id: String,
    host_id: String,
    locale: String,
}

impl Engine {
    pub(super) fn bot_snapshot(&self, value: &Value) -> Result<Value, RpcError> {
        let scope: SnapshotScope = serde_json::from_value(value.clone())
            .map_err(|_| error::invalid_argument("Invalid Bot snapshot scope"))?;
        if scope.locale.is_empty() || scope.locale.len() > 128 {
            return Err(error::invalid_argument("Invalid Bot snapshot scope"));
        }
        let conn = self.db.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(error::from_sqlite)?;
        // An empty workspace scope is the app-global read (#348): the fork's
        // controller lists Bots app-globally via window.api.bots.list(), so the
        // zero-workspace Bots page asks for every Bot across the host's folders.
        // Non-empty scopes stay exact single-workspace reads.
        let (bots, history) = if scope.workspace_id.is_empty() {
            self.snapshot_scope_global(&tx, &scope.locale)?
        } else {
            let folder =
                workspace::owned_path(&tx, &self.host_id, &scope.workspace_id, &scope.host_id)?;
            preflight_snapshot_budget(&tx, &self.host_id, &folder)?;
            self.snapshot_scope_folder(&tx, &folder, &scope.locale)?
        };
        let mut bots_json = serde_json::to_value(&bots)
            .map_err(|_| error::internal_error("Bot snapshot serialization failed"))?;
        project_bots_trigger_automation_id(&mut bots_json);
        self.project_bots_current_session_facts(&conn, &mut bots_json);
        let result = json!({"hostId":self.host_id,"workspaceId":scope.workspace_id,"bots":bots_json,"history":history});
        if serde_json::to_vec(&result)
            .map_err(|_| error::internal_error("Bot snapshot serialization failed"))?
            .len()
            > SNAPSHOT_BUDGET_BYTES as usize
        {
            return Err(snapshot_too_large());
        }
        Ok(result)
    }

    /// One workspace's snapshot: the workspace's Bots, each with its
    /// scoped history, newest-first.
    fn snapshot_scope_folder(
        &self,
        tx: &rusqlite::Transaction,
        folder: &str,
        locale: &str,
    ) -> Result<(Vec<Value>, Vec<Value>), RpcError> {
        let bots = storage::list_bots(tx, &self.host_id, folder, locale).map_err(snapshot_error)?;
        let mut bots_json = Vec::with_capacity(bots.len());
        let mut history = Vec::new();
        // Enumerate only scoped Bots: history storage also retains deleted Bot evidence.
        for bot in &bots {
            bots_json.push(
                serde_json::to_value(bot)
                    .map_err(|_| error::internal_error("Bot snapshot serialization failed"))?,
            );
            for entry in storage::history_for_bot(tx, &self.host_id, folder, &bot.id)
                .map_err(snapshot_error)?
            {
                history.push(history_entry_json(entry));
            }
        }
        history.sort_by(|a, b| {
            b["run"]["startedAt"]
                .as_f64()
                .unwrap_or(0.0)
                .total_cmp(&a["run"]["startedAt"].as_f64().unwrap_or(0.0))
        });
        Ok((bots_json, history))
    }

    /// The app-global snapshot: every Bot across the host's folders, each
    /// with its scoped history. Bots stay stored per workspace; only this
    /// read crosses folders, and the response still echoes the (empty)
    /// requested scope so callers can verify the match.
    fn snapshot_scope_global(
        &self,
        tx: &rusqlite::Transaction,
        locale: &str,
    ) -> Result<(Vec<Value>, Vec<Value>), RpcError> {
        preflight_snapshot_budget_global(tx, &self.host_id)?;
        let entries =
            storage::list_bots_with_folders(tx, &self.host_id, locale).map_err(snapshot_error)?;
        let mut bots_json = Vec::with_capacity(entries.len());
        let mut history = Vec::new();
        for (folder, bot) in &entries {
            bots_json.push(
                serde_json::to_value(bot)
                    .map_err(|_| error::internal_error("Bot snapshot serialization failed"))?,
            );
            for entry in storage::history_for_bot(tx, &self.host_id, folder, &bot.id)
                .map_err(snapshot_error)?
            {
                history.push(history_entry_json(entry));
            }
        }
        history.sort_by(|a, b| {
            b["run"]["startedAt"]
                .as_f64()
                .unwrap_or(0.0)
                .total_cmp(&a["run"]["startedAt"].as_f64().unwrap_or(0.0))
        });
        Ok((bots_json, history))
    }

    /// Live-session projection for the Bot snapshot: for each Bot whose
    /// `currentSession` names a session id this host knows, merge the daemon's
    /// OWN session facts -- `workspaceId`, `incarnation`, `verdict` and, when
    /// still running, the live OS `processId`.
    ///
    /// Why this exists (Defect 1): the renderer used to decide "resume or
    /// dispatch a fresh session" by searching the SELECTED workspace's session
    /// list, but a Bot's session runs in the Bot's own home workspace. On the
    /// first click from anywhere else the lookup missed, so the app silently
    /// opened a SECOND session. Projecting the daemon's own liveness facts onto
    /// the Bot record makes the decision workspace-independent and
    /// authoritative -- the snapshot is the fact, never a renderer guess.
    ///
    /// `verdict` is projected from the durable session row (or the live
    /// handle when this instance still holds one); `processId` remains a
    /// live-only in-memory fact, exactly as before (a pid outlives neither the
    /// process it names nor this daemon run). A session this host has no row
    /// for leaves the record untouched, so the renderer can tell "no record"
    /// (safe to open fresh) apart from "recorded but unobserved" (never
    /// dispatch a duplicate).
    fn project_bots_current_session_facts(&self, conn: &Connection, bots_json: &mut Value) {
        let Some(bots) = bots_json.as_array_mut() else {
            return;
        };
        for bot in bots {
            let Some(session_id) = bot
                .get("currentSession")
                .and_then(|session| session.get("sessionId"))
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            let Some(facts) = self.recorded_session_facts(conn, &session_id) else {
                continue;
            };
            let Some(session_obj) = bot.get_mut("currentSession").and_then(Value::as_object_mut)
            else {
                continue;
            };
            for key in ["workspaceId", "incarnation", "verdict"] {
                if let Some(value) = facts.get(key) {
                    session_obj.insert(key.to_string(), value.clone());
                }
            }
            if let Some(pid) = facts.get("processId").and_then(Value::as_u64) {
                session_obj.insert("processId".to_string(), json!(pid));
            }
        }
    }

    /// This host's facts for one session id: the live handle while it is
    /// still RUNNING (freshest), else the durable `sessions` row. `None`
    /// means no row on this host -- the caller must not invent facts.
    ///
    /// Lock order matches `Engine::do_session_list` (db then sessions): the
    /// caller already holds the db lock, and the sessions lock is dropped
    /// before any query so the two can never deadlock.
    fn recorded_session_facts(&self, conn: &Connection, session_id: &str) -> Option<Value> {
        let handle = self.sessions.lock().unwrap().get(session_id).cloned();
        if let Some(handle) = handle
            && !handle.is_exited()
        {
            let mut facts = crate::session::snapshot(&handle);
            if let Some(pid) = handle.child_process_id() {
                facts["processId"] = json!(pid);
            }
            return Some(facts);
        }
        conn.query_row(
            "SELECT workspace_id, incarnation, verdict, harness_id FROM sessions \
             WHERE id = ?1 AND host_id = ?2",
            params![session_id, self.host_id],
            |row| {
                Ok(json!({
                    "workspaceId": row.get::<_, String>(0)?,
                    "incarnation": row.get::<_, String>(1)?,
                    "verdict": row.get::<_, String>(2)?,
                    "harnessId": row.get::<_, Option<String>>(3)?,
                }))
            },
        )
        .optional()
        .ok()
        .flatten()
    }
}

fn history_entry_json(entry: HistoryEntry) -> Value {
    json!({
        "run":entry.responsibility_run,
        "responsibilityName":entry.responsibility.map(|r|r.name),
        "automationName":entry.automation.map(|a|a.name),
        "automationRunNumber":entry.automation_run.as_ref().and_then(|r|r.run_number),
        // The fork's snapshot carries the full linked `AutomationRun` row
        // and its history row renders `status · id`; project the same
        // status verdict (snake_case, e.g. "completed") so the UI can.
        "automationRunStatus":entry.automation_run.map(|r|r.status),
    })
}

/// `ResponsibilityTrigger`'s `rename_all` covers only the `kind` tag, so a scheduled
/// trigger's `automation_id` stays snake_case on the wire; project an additive camelCase
/// `automationId` in place, leaving every other field (including the snake_case one) intact.
fn project_bots_trigger_automation_id(bots_json: &mut Value) {
    let Some(bots) = bots_json.as_array_mut() else {
        return;
    };
    for bot in bots {
        let Some(responsibilities) = bot
            .get_mut("responsibilities")
            .and_then(Value::as_array_mut)
        else {
            continue;
        };
        for responsibility in responsibilities {
            let Some(trigger) = responsibility
                .get_mut("trigger")
                .and_then(Value::as_object_mut)
            else {
                continue;
            };
            if let Some(automation_id) = trigger.get("automation_id").cloned() {
                trigger.insert("automationId".to_string(), automation_id);
            }
        }
    }
}

fn snapshot_too_large() -> RpcError {
    RpcError::new(
        "snapshot_too_large",
        "Bot snapshot exceeds the response limit",
    )
}

/// Host-wide preflight for the app-global scope (#348): the same
/// COUNT/SUM probes as `preflight_snapshot_budget` with the folder
/// predicate dropped, so the global read rejects an over-count/over-size
/// store with the same `snapshot_too_large` before any row is parsed.
fn preflight_snapshot_budget_global(
    tx: &rusqlite::Transaction,
    host_id: &str,
) -> Result<(), RpcError> {
    let history_rows: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM bot_responsibility_runs
             WHERE bot_id IN (SELECT id FROM bots WHERE host_id = ?1)",
            params![host_id],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    if history_rows > MAX_SNAPSHOT_HISTORY_ROWS {
        return Err(snapshot_too_large());
    }

    let bots_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) FROM bots
             WHERE host_id = ?1",
            params![host_id],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let runs_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs
             WHERE bot_id IN (SELECT id FROM bots WHERE host_id = ?1)",
            params![host_id],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let repeated_responsibility_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(b.payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs brr
             JOIN bots b ON b.id = brr.bot_id
             WHERE b.host_id = ?1",
            params![host_id],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let linked_automation_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(a.payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs brr
             JOIN automations a ON a.id = json_extract(brr.payload_json, '$.automationId')
             WHERE brr.bot_id IN (SELECT id FROM bots WHERE host_id = ?1)",
            params![host_id],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let linked_automation_run_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(ar.payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs brr
             JOIN automation_runs ar ON ar.id = json_extract(brr.payload_json, '$.automationRunId')
             WHERE brr.bot_id IN (SELECT id FROM bots WHERE host_id = ?1)",
            params![host_id],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;

    let total = bots_bytes
        .saturating_add(runs_bytes)
        .saturating_add(repeated_responsibility_bytes)
        .saturating_add(linked_automation_bytes)
        .saturating_add(linked_automation_run_bytes);
    if total > SNAPSHOT_BUDGET_BYTES {
        return Err(snapshot_too_large());
    }
    Ok(())
}

/// Preflight bound for review P2-2: rejects an over-count/over-size scope with the same
/// `snapshot_too_large` as the final materialized-size check, using cheap COUNT/SUM probes
/// against the store tables -- never `list_bots`/`history_for_bot`, which parse every row.
/// Sums charge each linked payload once per *referencing* history row (plain `JOIN`, never
/// `DISTINCT`), because materialization cost scales with referencing rows, not distinct
/// linked rows. `LENGTH(CAST(... AS BLOB))` counts UTF-8 bytes; bare TEXT `LENGTH` counts
/// characters and would undercount multi-byte payloads against the real byte check.
fn preflight_snapshot_budget(
    tx: &rusqlite::Transaction,
    host_id: &str,
    folder: &str,
) -> Result<(), RpcError> {
    let history_rows: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM bot_responsibility_runs
             WHERE bot_id IN (SELECT id FROM bots WHERE host_id = ?1 AND folder = ?2)",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    if history_rows > MAX_SNAPSHOT_HISTORY_ROWS {
        return Err(snapshot_too_large());
    }

    let bots_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) FROM bots
             WHERE host_id = ?1 AND folder = ?2",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let runs_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs
             WHERE bot_id IN (SELECT id FROM bots WHERE host_id = ?1 AND folder = ?2)",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let repeated_responsibility_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(b.payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs brr
             JOIN bots b ON b.id = brr.bot_id
             WHERE b.host_id = ?1 AND b.folder = ?2",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let linked_automation_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(a.payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs brr
             JOIN automations a ON a.id = json_extract(brr.payload_json, '$.automationId')
             WHERE brr.bot_id IN (SELECT id FROM bots WHERE host_id = ?1 AND folder = ?2)",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let linked_automation_run_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(CAST(ar.payload_json AS BLOB))), 0)
             FROM bot_responsibility_runs brr
             JOIN automation_runs ar ON ar.id = json_extract(brr.payload_json, '$.automationRunId')
             WHERE brr.bot_id IN (SELECT id FROM bots WHERE host_id = ?1 AND folder = ?2)",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;

    let total = bots_bytes
        .saturating_add(runs_bytes)
        .saturating_add(repeated_responsibility_bytes)
        .saturating_add(linked_automation_bytes)
        .saturating_add(linked_automation_run_bytes);
    if total > SNAPSHOT_BUDGET_BYTES {
        return Err(snapshot_too_large());
    }
    Ok(())
}

fn snapshot_error(error: storage::StorageError) -> RpcError {
    match error {
        storage::StorageError::LocaleOrdering(_) => error::invalid_argument("Unsupported locale"),
        _ => RpcError::new("storage_error", "Stored Bot snapshot could not be read"),
    }
}
