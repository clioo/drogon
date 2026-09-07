use drogon_protocol::{MAX_FRAME_BYTES, RpcError};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{Engine, bots::storage, error, workspace};

/// Same budget the final materialized-size check below enforces: the
/// preflight and the final check must never disagree about what "too
/// large" means, or a caller could distinguish "rejected early" from
/// "rejected late" by tuning payload shape.
const SNAPSHOT_BUDGET_BYTES: i64 = (MAX_FRAME_BYTES / 2) as i64;
/// Cheap upper bound on the number of history rows a snapshot will
/// consider, checked with a single `COUNT(*)` before any row is fetched and
/// parsed into a `HistoryEntry`. Many small rows can each be individually
/// tiny yet still make full materialization (one query plus JSON parse per
/// row, per bot) arbitrarily expensive; this bounds that cost independent of
/// the byte budget below.
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
        if scope.workspace_id.is_empty() || scope.locale.is_empty() || scope.locale.len() > 128 {
            return Err(error::invalid_argument("Invalid Bot snapshot scope"));
        }
        let conn = self.db.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(error::from_sqlite)?;
        let folder =
            workspace::owned_path(&tx, &self.host_id, &scope.workspace_id, &scope.host_id)?;
        preflight_snapshot_budget(&tx, &self.host_id, &folder)?;
        let bots = storage::list_bots(&tx, &self.host_id, &folder, &scope.locale)
            .map_err(snapshot_error)?;
        let mut history = Vec::new();
        // Enumerate only scoped Bots: history storage also retains deleted Bot evidence.
        for bot in &bots {
            for entry in storage::history_for_bot(&tx, &self.host_id, &folder, &bot.id)
                .map_err(snapshot_error)?
            {
                // `ResponsibilityTrigger::Scheduled`'s variant-level
                // `rename_all` only renames the tag, not its fields, so the
                // trigger's own (re-)serialization stays snake_case;
                // project a camelCase alias here and keep the snake_case
                // key too, for clients still reading the old name.
                let automation_id = entry.responsibility_run.automation_id.clone();
                history.push(json!({
                    "run":entry.responsibility_run,
                    "responsibilityName":entry.responsibility.map(|r|r.name),
                    "automationName":entry.automation.map(|a|a.name),
                    "automationRunNumber":entry.automation_run.and_then(|r|r.run_number),
                    "automation_id":automation_id,
                    "automationId":automation_id,
                }));
            }
        }
        history.sort_by(|a, b| {
            b["run"]["startedAt"]
                .as_f64()
                .unwrap_or(0.0)
                .total_cmp(&a["run"]["startedAt"].as_f64().unwrap_or(0.0))
        });
        let mut bots_json = serde_json::to_value(&bots)
            .map_err(|_| error::internal_error("Bot snapshot serialization failed"))?;
        project_bots_trigger_automation_id(&mut bots_json);
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
}

/// Same field-level `rename_all` gap as the history projection above, but
/// for each responsibility's own `trigger` object as it appears inside the
/// raw serialized `Bot` structs in the `bots` array: `ResponsibilityTrigger`'s
/// `rename_all` only renames the `kind` tag, so a scheduled trigger's
/// `automation_id` field stays snake_case on the wire. Project an additive
/// camelCase `automationId` alongside it, in place, leaving every other
/// field (including the retained snake_case one) untouched.
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

/// Bounded correction for review P2-2: rejects an over-count or
/// over-size scope with the same `snapshot_too_large` the final
/// materialized-size check below produces, but computed with a handful of
/// cheap `COUNT`/`SUM(LENGTH(...))` probes run directly against the store's
/// own tables -- never by calling `storage::list_bots`/`history_for_bot`
/// (which parse every row into a domain struct) first. The byte-budget
/// probe sums the `bots` and `bot_responsibility_runs` rows in scope plus
/// the `automations`/`automation_runs` rows those runs actually link to (via
/// `json_extract` on the stored run payload's `automationId`/
/// `automationRunId`, joined only on the ids present in this scope's runs --
/// never a full scan of either linked table), because a run's rendered
/// history entry embeds its linked automation/automation-run name/number:
/// an oversized linked record inflates the real response even though it
/// never appears directly in `bots`/`bot_responsibility_runs`.
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
            "SELECT COALESCE(SUM(LENGTH(payload_json)), 0) FROM bots
             WHERE host_id = ?1 AND folder = ?2",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let runs_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(payload_json)), 0) FROM bot_responsibility_runs
             WHERE bot_id IN (SELECT id FROM bots WHERE host_id = ?1 AND folder = ?2)",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let linked_automation_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(a.payload_len), 0) FROM (
                 SELECT LENGTH(a.payload_json) AS payload_len FROM automations a
                 WHERE a.id IN (
                     SELECT DISTINCT json_extract(brr.payload_json, '$.automationId')
                     FROM bot_responsibility_runs brr
                     WHERE brr.bot_id IN (SELECT id FROM bots WHERE host_id = ?1 AND folder = ?2)
                       AND json_extract(brr.payload_json, '$.automationId') IS NOT NULL
                 )
             ) a",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;
    let linked_automation_run_bytes: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(ar.payload_len), 0) FROM (
                 SELECT LENGTH(ar.payload_json) AS payload_len FROM automation_runs ar
                 WHERE ar.id IN (
                     SELECT DISTINCT json_extract(brr.payload_json, '$.automationRunId')
                     FROM bot_responsibility_runs brr
                     WHERE brr.bot_id IN (SELECT id FROM bots WHERE host_id = ?1 AND folder = ?2)
                       AND json_extract(brr.payload_json, '$.automationRunId') IS NOT NULL
                 )
             ) ar",
            params![host_id, folder],
            |r| r.get(0),
        )
        .map_err(error::from_sqlite)?;

    let total = bots_bytes
        .saturating_add(runs_bytes)
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
