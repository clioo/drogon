//! SQLite storage for Mentu approvals and runs, in the established
//! per-component `schema_versions` pattern (`bots::storage`,
//! `automations::storage`): [`apply_pending_steps_in_tx`] runs inside
//! `db::migrate_and_recover`'s single rollback-safe startup transaction.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{MentuApproval, MentuRun, MentuRunStatus};

use crate::error;

use super::run_record;

pub const MENTU_SCHEMA_COMPONENT: &str = "mentu";
pub const MENTU_SCHEMA_VERSION: i64 = 1;

fn create_v1_tables(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS mentu_approvals (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            recipe_id TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            consumed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS mentu_approvals_workspace ON mentu_approvals(workspace_id);
        CREATE TABLE IF NOT EXISTS mentu_runs (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            recipe_id TEXT NOT NULL,
            approval_id TEXT NOT NULL,
            mentu_run_id TEXT,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            error TEXT,
            retry_of TEXT,
            run_json TEXT
        );
        CREATE INDEX IF NOT EXISTS mentu_runs_workspace ON mentu_runs(workspace_id, started_at);",
    )
}

/// Applies every pending `mentu` migration step inside the caller's already
/// -open transaction; never opens or commits one of its own. Called from
/// `db::migrate_and_recover` alongside every other component.
pub fn apply_pending_steps_in_tx(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![MENTU_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > MENTU_SCHEMA_VERSION
    {
        // Downgrade guard, same contract as the other components: a data
        // dir written by a newer build must never be silently modified by
        // this one. Before this guard existed any recorded version fell
        // through as a no-op, so an older build could write v1 rows into a
        // future mentu schema it cannot understand.
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
            Some(format!(
                "mentu schema version {found} is newer than supported {MENTU_SCHEMA_VERSION}"
            )),
        ));
    }
    if existing.is_none() {
        create_v1_tables(tx)?;
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
            params![MENTU_SCHEMA_COMPONENT, MENTU_SCHEMA_VERSION],
        )?;
    }
    Ok(())
}

pub fn insert_approval(conn: &Connection, approval: &MentuApproval) -> Result<(), RpcError> {
    conn.execute(
        "INSERT INTO mentu_approvals (id, workspace_id, recipe_id, content_hash, approved_at, consumed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        params![
            approval.id,
            approval.workspace_id,
            approval.recipe_id,
            approval.content_hash,
            approval.approved_at,
        ],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

struct ApprovalRow {
    workspace_id: String,
    recipe_id: String,
    content_hash: String,
    consumed: bool,
}

fn get_approval_row(conn: &Connection, id: &str) -> Result<Option<ApprovalRow>, RpcError> {
    conn.query_row(
        "SELECT workspace_id, recipe_id, content_hash, consumed_at FROM mentu_approvals WHERE id = ?1",
        params![id],
        |r| {
            Ok(ApprovalRow {
                workspace_id: r.get(0)?,
                recipe_id: r.get(1)?,
                content_hash: r.get(2)?,
                consumed: r.get::<_, Option<String>>(3)?.is_some(),
            })
        },
    )
    .optional()
    .map_err(error::from_sqlite)
}

/// Validates that `approval_id` names a not-yet-consumed approval for the
/// exact `(workspace_id, recipe_id)` pair, then atomically marks it
/// consumed (`UPDATE ... WHERE consumed_at IS NULL`, so a concurrent second
/// `mentu.run` racing the same approval can never both succeed). Returns the
/// approval's stored content hash for the caller to recheck against the
/// recipe's current bytes.
pub fn consume_approval(
    conn: &Connection,
    approval_id: &str,
    workspace_id: &str,
    recipe_id: &str,
) -> Result<String, RpcError> {
    let row = get_approval_row(conn, approval_id)?
        .ok_or_else(|| error::not_found("Mentu approval not found."))?;
    if row.workspace_id != workspace_id || row.recipe_id != recipe_id {
        return Err(error::invalid_argument(
            "Mentu approval does not match this workspace/recipe.",
        ));
    }
    if row.consumed {
        return Err(RpcError::new(
            "mentu_approval_consumed",
            "This approval was already used to start a run.",
        ));
    }
    let affected = conn
        .execute(
            "UPDATE mentu_approvals SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL",
            params![crate::now_rfc3339(), approval_id],
        )
        .map_err(error::from_sqlite)?;
    if affected == 0 {
        return Err(RpcError::new(
            "mentu_approval_consumed",
            "This approval was already used to start a run.",
        ));
    }
    Ok(row.content_hash)
}

/// Marks every not-yet-consumed approval for `(workspace_id, recipe_id)`
/// whose content hash differs from `new_hash` as consumed, so a review
/// bound to the pre-save bytes can never start a run after
/// `mentu.recipe_save` rewrites the recipe. Returns the number of
/// approvals invalidated. The caller (the save RPC) invokes this right
/// after the atomic write lands, keeping approvals honest: running the
/// edited recipe requires a fresh review.
pub fn invalidate_stale_approvals(
    conn: &Connection,
    workspace_id: &str,
    recipe_id: &str,
    new_hash: &str,
) -> Result<u64, RpcError> {
    let affected = conn
        .execute(
            "UPDATE mentu_approvals SET consumed_at = ?1
              WHERE workspace_id = ?2 AND recipe_id = ?3 AND content_hash != ?4 AND consumed_at IS NULL",
            params![crate::now_rfc3339(), workspace_id, recipe_id, new_hash],
        )
        .map_err(error::from_sqlite)?;
    Ok(affected as u64)
}

/// The newest unconsumed approval bound to exactly `content_hash`, if one
/// exists. Read-only: resolving "this recipe is already approved" must
/// never create an approval, so a caller can only ever use consent a human
/// already gave (or the UI recorded) for these exact bytes.
///
/// `rowid` breaks ties so two approvals recorded in the same RFC 3339
/// second still resolve deterministically to the later insert.
pub fn pending_approval(
    conn: &Connection,
    workspace_id: &str,
    recipe_id: &str,
    content_hash: &str,
) -> Result<Option<MentuApproval>, RpcError> {
    conn.query_row(
        "SELECT id, workspace_id, recipe_id, content_hash, approved_at
           FROM mentu_approvals
          WHERE workspace_id = ?1 AND recipe_id = ?2 AND content_hash = ?3 AND consumed_at IS NULL
          ORDER BY approved_at DESC, rowid DESC
          LIMIT 1",
        params![workspace_id, recipe_id, content_hash],
        |r| {
            Ok(MentuApproval {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                recipe_id: r.get(2)?,
                content_hash: r.get(3)?,
                approved_at: r.get(4)?,
            })
        },
    )
    .optional()
    .map_err(error::from_sqlite)
}

/// Live progress for a running row: records the `mentu-recipes` run id and
/// the run record exactly as the runtime currently has it on disk, WITHOUT
/// touching status/ended_at. The background watcher owns those once the
/// process exits, and the `status = 'running'` guard keeps this from ever
/// overwriting a finished row with a stale partial record.
pub fn record_run_progress(
    conn: &Connection,
    id: &str,
    mentu_run_id: &str,
    run_json: &Value,
) -> Result<(), RpcError> {
    conn.execute(
        "UPDATE mentu_runs
            SET mentu_run_id = COALESCE(mentu_run_id, ?1), run_json = ?2
          WHERE id = ?3 AND status = 'running'",
        params![mentu_run_id, run_json.to_string(), id],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

pub struct NewRun<'a> {
    pub id: &'a str,
    pub workspace_id: &'a str,
    pub recipe_id: &'a str,
    pub approval_id: &'a str,
    pub started_at: &'a str,
    pub retry_of: Option<&'a str>,
}

pub fn insert_run(conn: &Connection, run: &NewRun) -> Result<(), RpcError> {
    conn.execute(
        "INSERT INTO mentu_runs (id, workspace_id, recipe_id, approval_id, mentu_run_id, status, started_at, ended_at, error, retry_of, run_json)
         VALUES (?1, ?2, ?3, ?4, NULL, 'running', ?5, NULL, NULL, ?6, NULL)",
        params![
            run.id,
            run.workspace_id,
            run.recipe_id,
            run.approval_id,
            run.started_at,
            run.retry_of,
        ],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

fn status_wire(status: MentuRunStatus) -> &'static str {
    match status {
        MentuRunStatus::Running => "running",
        MentuRunStatus::Succeeded => "succeeded",
        MentuRunStatus::Failed => "failed",
        MentuRunStatus::Cancelled => "cancelled",
        MentuRunStatus::Unavailable => "unavailable",
    }
}

fn status_from_wire(value: &str) -> MentuRunStatus {
    match value {
        "succeeded" => MentuRunStatus::Succeeded,
        "failed" => MentuRunStatus::Failed,
        "cancelled" => MentuRunStatus::Cancelled,
        "unavailable" => MentuRunStatus::Unavailable,
        _ => MentuRunStatus::Running,
    }
}

/// Records the `mentu-recipes`-minted run id once discovered, without
/// disturbing status/ended_at (the background watcher owns those
/// separately, once the process actually exits).
pub fn set_mentu_run_id(conn: &Connection, id: &str, mentu_run_id: &str) -> Result<(), RpcError> {
    conn.execute(
        "UPDATE mentu_runs SET mentu_run_id = ?1 WHERE id = ?2",
        params![mentu_run_id, id],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn finish_run(
    conn: &Connection,
    id: &str,
    status: MentuRunStatus,
    ended_at: &str,
    error_message: Option<&str>,
    mentu_run_id: Option<&str>,
    run_json: Option<&Value>,
) -> Result<(), RpcError> {
    let run_json_text = run_json.map(|v| v.to_string());
    conn.execute(
        "UPDATE mentu_runs SET status = ?1, ended_at = ?2, error = ?3,
             mentu_run_id = COALESCE(?4, mentu_run_id), run_json = COALESCE(?5, run_json)
         WHERE id = ?6",
        params![
            status_wire(status),
            ended_at,
            error_message,
            mentu_run_id,
            run_json_text,
            id,
        ],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

struct RunRow {
    id: String,
    workspace_id: String,
    recipe_id: String,
    approval_id: String,
    mentu_run_id: Option<String>,
    status: String,
    started_at: String,
    ended_at: Option<String>,
    error: Option<String>,
    retry_of: Option<String>,
    run_json: Option<String>,
}

fn row_to_run(row: RunRow) -> MentuRun {
    let parsed_json: Option<Value> = row
        .run_json
        .as_deref()
        .and_then(|text| serde_json::from_str(text).ok());
    let steps = match (&parsed_json, &row.mentu_run_id) {
        (Some(json), Some(mentu_run_id)) => run_record::parse_steps(json, mentu_run_id),
        _ => Vec::new(),
    };
    MentuRun {
        id: row.id,
        workspace_id: row.workspace_id,
        recipe_id: row.recipe_id,
        approval_id: row.approval_id,
        mentu_run_id: row.mentu_run_id,
        status: status_from_wire(&row.status),
        started_at: row.started_at,
        ended_at: row.ended_at,
        steps,
        error: row.error,
        retry_of: row.retry_of,
    }
}

const RUN_COLUMNS: &str = "id, workspace_id, recipe_id, approval_id, mentu_run_id, status, started_at, ended_at, error, retry_of, run_json";

fn map_run_row(r: &rusqlite::Row) -> rusqlite::Result<RunRow> {
    Ok(RunRow {
        id: r.get(0)?,
        workspace_id: r.get(1)?,
        recipe_id: r.get(2)?,
        approval_id: r.get(3)?,
        mentu_run_id: r.get(4)?,
        status: r.get(5)?,
        started_at: r.get(6)?,
        ended_at: r.get(7)?,
        error: r.get(8)?,
        retry_of: r.get(9)?,
        run_json: r.get(10)?,
    })
}

pub fn get_run(conn: &Connection, id: &str) -> Result<Option<MentuRun>, RpcError> {
    conn.query_row(
        &format!("SELECT {RUN_COLUMNS} FROM mentu_runs WHERE id = ?1"),
        params![id],
        map_run_row,
    )
    .optional()
    .map_err(error::from_sqlite)
    .map(|row| row.map(row_to_run))
}

pub fn list_runs(
    conn: &Connection,
    workspace_id: &str,
    limit: u32,
) -> Result<Vec<MentuRun>, RpcError> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {RUN_COLUMNS} FROM mentu_runs WHERE workspace_id = ?1 ORDER BY started_at DESC LIMIT ?2"
        ))
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map(params![workspace_id, limit], map_run_row)
        .map_err(error::from_sqlite)?;
    let mut runs = Vec::new();
    for row in rows {
        runs.push(row_to_run(row.map_err(error::from_sqlite)?));
    }
    Ok(runs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        apply_pending_steps_in_tx(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    #[test]
    fn approval_can_only_be_consumed_once() {
        let conn = conn();
        insert_approval(
            &conn,
            &MentuApproval {
                id: "appr-1".into(),
                workspace_id: "ws1".into(),
                recipe_id: "hello".into(),
                content_hash: "a".repeat(64),
                approved_at: "2026-09-07T00:00:00Z".into(),
            },
        )
        .unwrap();
        let hash = consume_approval(&conn, "appr-1", "ws1", "hello").unwrap();
        assert_eq!(hash, "a".repeat(64));
        let err = consume_approval(&conn, "appr-1", "ws1", "hello").unwrap_err();
        assert_eq!(err.code, "mentu_approval_consumed");
    }

    #[test]
    fn consume_rejects_a_mismatched_workspace_or_recipe() {
        let conn = conn();
        insert_approval(
            &conn,
            &MentuApproval {
                id: "appr-1".into(),
                workspace_id: "ws1".into(),
                recipe_id: "hello".into(),
                content_hash: "a".repeat(64),
                approved_at: "2026-09-07T00:00:00Z".into(),
            },
        )
        .unwrap();
        assert!(consume_approval(&conn, "appr-1", "ws2", "hello").is_err());
        assert!(consume_approval(&conn, "missing", "ws1", "hello").is_err());
    }

    #[test]
    fn invalidate_stale_approvals_consumes_only_the_old_hash() {
        let conn = conn();
        let approval = |id: &str, hash: &str, recipe: &str| MentuApproval {
            id: id.into(),
            workspace_id: "ws1".into(),
            recipe_id: recipe.into(),
            content_hash: hash.into(),
            approved_at: "2026-09-07T00:00:00Z".into(),
        };
        insert_approval(&conn, &approval("old", &"a".repeat(64), "hello")).unwrap();
        insert_approval(&conn, &approval("current", &"b".repeat(64), "hello")).unwrap();
        insert_approval(&conn, &approval("other-recipe", &"a".repeat(64), "world")).unwrap();
        let invalidated =
            invalidate_stale_approvals(&conn, "ws1", "hello", &"b".repeat(64)).unwrap();
        assert_eq!(invalidated, 1);
        // The stale approval can no longer start a run.
        let err = consume_approval(&conn, "old", "ws1", "hello").unwrap_err();
        assert_eq!(err.code, "mentu_approval_consumed");
        // The current-hash and other-recipe approvals survive.
        assert_eq!(
            consume_approval(&conn, "current", "ws1", "hello").unwrap(),
            "b".repeat(64)
        );
        assert_eq!(
            consume_approval(&conn, "other-recipe", "ws1", "world").unwrap(),
            "a".repeat(64)
        );
    }

    #[test]
    fn run_round_trips_status_and_parses_steps_from_stored_run_json() {
        let conn = conn();
        insert_run(
            &conn,
            &NewRun {
                id: "run-1",
                workspace_id: "ws1",
                recipe_id: "hello",
                approval_id: "appr-1",
                started_at: "2026-09-07T00:00:00Z",
                retry_of: None,
            },
        )
        .unwrap();
        let running = get_run(&conn, "run-1").unwrap().unwrap();
        assert_eq!(running.status, MentuRunStatus::Running);
        assert!(running.steps.is_empty());

        set_mentu_run_id(&conn, "run-1", "run_20260907202509_15F1772D").unwrap();
        let run_json = serde_json::json!({
            "outcome": "ok",
            "steps": [{"label": "say-hello", "backend": "shell", "exit_code": 0, "output_file": "say-hello.stdout", "error_file": "say-hello.stderr"}]
        });
        finish_run(
            &conn,
            "run-1",
            MentuRunStatus::Succeeded,
            "2026-09-07T00:00:05Z",
            None,
            None,
            Some(&run_json),
        )
        .unwrap();
        let finished = get_run(&conn, "run-1").unwrap().unwrap();
        assert_eq!(finished.status, MentuRunStatus::Succeeded);
        assert_eq!(
            finished.mentu_run_id.as_deref(),
            Some("run_20260907202509_15F1772D")
        );
        assert_eq!(finished.steps.len(), 1);
        assert_eq!(
            finished.steps[0].output_path.as_deref(),
            Some(".mentu/runs/run_20260907202509_15F1772D/say-hello.stdout")
        );
    }

    #[test]
    fn list_runs_orders_newest_first_and_respects_the_limit() {
        let conn = conn();
        for (i, started) in [
            "2026-09-07T00:00:00Z",
            "2026-09-07T00:00:01Z",
            "2026-09-07T00:00:02Z",
        ]
        .iter()
        .enumerate()
        {
            insert_run(
                &conn,
                &NewRun {
                    id: &format!("run-{i}"),
                    workspace_id: "ws1",
                    recipe_id: "hello",
                    approval_id: "appr-1",
                    started_at: started,
                    retry_of: None,
                },
            )
            .unwrap();
        }
        let runs = list_runs(&conn, "ws1", 2).unwrap();
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0].id, "run-2");
        assert_eq!(runs[1].id, "run-1");
    }

    #[test]
    fn pending_approval_only_matches_the_current_hash_and_unconsumed_rows() {
        let conn = conn();
        let hash = "a".repeat(64);
        assert!(
            pending_approval(&conn, "ws1", "hello", &hash)
                .unwrap()
                .is_none()
        );
        insert_approval(
            &conn,
            &MentuApproval {
                id: "old".into(),
                workspace_id: "ws1".into(),
                recipe_id: "hello".into(),
                content_hash: "b".repeat(64),
                approved_at: "2026-09-07T00:00:00Z".into(),
            },
        )
        .unwrap();
        // A stale hash never resolves: an edited recipe has no pending
        // approval until a human approves the new bytes.
        assert!(
            pending_approval(&conn, "ws1", "hello", &hash)
                .unwrap()
                .is_none()
        );
        insert_approval(
            &conn,
            &MentuApproval {
                id: "fresh".into(),
                workspace_id: "ws1".into(),
                recipe_id: "hello".into(),
                content_hash: hash.clone(),
                approved_at: "2026-09-07T00:00:01Z".into(),
            },
        )
        .unwrap();
        let found = pending_approval(&conn, "ws1", "hello", &hash)
            .unwrap()
            .expect("the matching unconsumed approval");
        assert_eq!(found.id, "fresh");
        // Consuming it (as `mentu.run` does) retires it: a second run must
        // require a fresh approval, never reuse this one.
        consume_approval(&conn, "fresh", "ws1", "hello").unwrap();
        assert!(
            pending_approval(&conn, "ws1", "hello", &hash)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn record_run_progress_survives_the_earlier_partial_record_and_never_rewrites_finished_rows() {
        let conn = conn();
        insert_run(
            &conn,
            &NewRun {
                id: "run-1",
                workspace_id: "ws1",
                recipe_id: "hello",
                approval_id: "appr-1",
                started_at: "2026-09-07T00:00:00Z",
                retry_of: None,
            },
        )
        .unwrap();
        let mentu_run_id = "run_20260907202509_15F1772D";
        // mentu-recipes writes run.json as it goes: the first record has no
        // steps and outcome "running". Storing it must NOT flip the row off
        // `running` (overall_status would read "running" as a failure).
        let partial = serde_json::json!({"outcome": "running", "steps": []});
        record_run_progress(&conn, "run-1", mentu_run_id, &partial).unwrap();
        let live = get_run(&conn, "run-1").unwrap().unwrap();
        assert_eq!(live.status, MentuRunStatus::Running);
        assert_eq!(live.mentu_run_id.as_deref(), Some(mentu_run_id));
        assert!(live.steps.is_empty());
        // The next partial record exposes the first completed step while
        // the run is still in flight.
        let one_step = serde_json::json!({
            "outcome": "running",
            "steps": [{"label": "build", "backend": "shell", "outcome": "ok", "exit_code": 0,
                        "output_file": "build.stdout", "error_file": "build.stderr"}]
        });
        record_run_progress(&conn, "run-1", mentu_run_id, &one_step).unwrap();
        let live = get_run(&conn, "run-1").unwrap().unwrap();
        assert_eq!(live.status, MentuRunStatus::Running);
        assert_eq!(live.steps.len(), 1);
        assert_eq!(live.steps[0].status, MentuRunStatus::Succeeded);
        // Once the watcher finalizes the row, a late poller cannot reopen it.
        finish_run(
            &conn,
            "run-1",
            MentuRunStatus::Failed,
            "2026-09-07T00:00:05Z",
            Some("step failed"),
            None,
            Some(&serde_json::json!({"outcome": "failed", "steps": []})),
        )
        .unwrap();
        record_run_progress(
            &conn,
            "run-1",
            mentu_run_id,
            &serde_json::json!({"outcome": "running", "steps": []}),
        )
        .unwrap();
        let finished = get_run(&conn, "run-1").unwrap().unwrap();
        assert_eq!(finished.status, MentuRunStatus::Failed);
        assert_eq!(finished.ended_at.as_deref(), Some("2026-09-07T00:00:05Z"));
    }
}
