use drogon_protocol::{MAX_FRAME_BYTES, RpcError};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{Engine, bots::storage, error, workspace};

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
                history.push(json!({
                    "run":entry.responsibility_run,
                    "responsibilityName":entry.responsibility.map(|r|r.name),
                    "automationName":entry.automation.map(|a|a.name),
                    "automationRunNumber":entry.automation_run.and_then(|r|r.run_number),
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
