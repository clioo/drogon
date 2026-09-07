use drogon_protocol::{MAX_FRAME_BYTES, RpcError};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{Engine, bots::storage, error, workspace};

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
        let result = json!({"hostId":self.host_id,"workspaceId":scope.workspace_id,"bots":bots,"history":history});
        if serde_json::to_vec(&result)
            .map_err(|_| error::internal_error("Bot snapshot serialization failed"))?
            .len()
            > MAX_FRAME_BYTES / 2
        {
            return Err(RpcError::new(
                "snapshot_too_large",
                "Bot snapshot exceeds the response limit",
            ));
        }
        Ok(result)
    }
}

fn snapshot_error(error: storage::StorageError) -> RpcError {
    match error {
        storage::StorageError::LocaleOrdering(_) => error::invalid_argument("Unsupported locale"),
        _ => RpcError::new("storage_error", "Stored Bot snapshot could not be read"),
    }
}
