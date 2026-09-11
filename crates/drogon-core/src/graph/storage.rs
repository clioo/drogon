//! SQLite storage for the graph's launch ledger: which daemon run a node
//! was last launched into, and under which recipe step label. Only the
//! daemon writes here; the human-owned `intent` half never touches it.
//!
//! Same per-component `schema_versions` pattern as `mentu::storage`:
//! [`apply_pending_steps_in_tx`] runs inside `db::migrate_and_recover`'s
//! single rollback-safe startup transaction.

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use drogon_protocol::RpcError;

use crate::error;

pub const GRAPH_SCHEMA_COMPONENT: &str = "graph";
pub const GRAPH_SCHEMA_VERSION: i64 = 1;

/// One recorded launch of a node: the daemon run it went into and the step
/// label that run carries for it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NodeRunMapping {
    pub node_id: String,
    pub run_id: String,
    pub step_label: String,
}

fn create_v1_tables(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS graph_node_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            step_label TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS graph_node_runs_lookup
            ON graph_node_runs(workspace_id, node_id, id);",
    )
}

/// Applies every pending `graph` migration step inside the caller's already
/// -open transaction; never opens or commits one of its own.
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
            params![GRAPH_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > GRAPH_SCHEMA_VERSION
    {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
            Some(format!(
                "graph schema version {found} is newer than supported {GRAPH_SCHEMA_VERSION}"
            )),
        ));
    }
    if existing.is_none() {
        create_v1_tables(tx)?;
    }
    tx.execute(
        "INSERT INTO schema_versions (component, version) VALUES (?1, ?2)
         ON CONFLICT(component) DO UPDATE SET version = excluded.version",
        params![GRAPH_SCHEMA_COMPONENT, GRAPH_SCHEMA_VERSION],
    )?;
    Ok(())
}

/// Records one node's launch into a daemon run. Append-only: the newest row
/// (highest `id`) is the node's current run, so a resume/retry that reuses
/// the same `mentu-recipes` run still creates a fresh daemon run row and a
/// fresh mapping.
pub fn record_node_run(
    conn: &Connection,
    workspace_id: &str,
    run_id: &str,
    created_at: &str,
    nodes: &[String],
) -> Result<(), RpcError> {
    let mut stmt = conn
        .prepare(
            "INSERT INTO graph_node_runs (workspace_id, node_id, run_id, step_label, created_at)
             VALUES (?1, ?2, ?3, ?2, ?4)",
        )
        .map_err(error::from_sqlite)?;
    for node_id in nodes {
        stmt.execute(params![workspace_id, node_id, run_id, created_at])
            .map_err(error::from_sqlite)?;
    }
    Ok(())
}

/// Every node that run covered, as recorded at launch time. Used so a
/// resume/retry-step maps the whole compiled set onto its new daemon run row.
pub fn nodes_for_run(
    conn: &Connection,
    workspace_id: &str,
    run_id: &str,
) -> Result<Vec<String>, RpcError> {
    let mut stmt = conn
        .prepare(
            "SELECT node_id FROM graph_node_runs
              WHERE workspace_id = ?1 AND run_id = ?2 ORDER BY id ASC",
        )
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map(params![workspace_id, run_id], |r| r.get::<_, String>(0))
        .map_err(error::from_sqlite)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(error::from_sqlite)?);
    }
    out.dedup();
    Ok(out)
}

/// The latest mapping for one node, if any.
pub fn latest_node_run(
    conn: &Connection,
    workspace_id: &str,
    node_id: &str,
) -> Result<Option<NodeRunMapping>, RpcError> {
    conn.query_row(
        "SELECT node_id, run_id, step_label FROM graph_node_runs
          WHERE workspace_id = ?1 AND node_id = ?2
          ORDER BY id DESC LIMIT 1",
        params![workspace_id, node_id],
        |r| {
            Ok(NodeRunMapping {
                node_id: r.get(0)?,
                run_id: r.get(1)?,
                step_label: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(error::from_sqlite)
}

/// Every node this workspace has ever launched, newest mapping per node. Used
/// to keep an orphaned running node in `state` after its intent node was
/// deleted (deleting an intent node never kills a running worker).
pub fn latest_node_runs(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Vec<NodeRunMapping>, RpcError> {
    let mut stmt = conn
        .prepare(
            "SELECT m.node_id, m.run_id, m.step_label
               FROM graph_node_runs m
              WHERE m.workspace_id = ?1
                AND m.id = (SELECT MAX(g.id) FROM graph_node_runs g
                             WHERE g.workspace_id = m.workspace_id
                               AND g.node_id = m.node_id)",
        )
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map(params![workspace_id], |r| {
            Ok(NodeRunMapping {
                node_id: r.get(0)?,
                run_id: r.get(1)?,
                step_label: r.get(2)?,
            })
        })
        .map_err(error::from_sqlite)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(error::from_sqlite)?);
    }
    Ok(out)
}

/// The node a daemon run belongs to, when the run was launched from a graph.
/// Used to attach a `state` node to the run a retry/step retry produced.
pub fn node_for_run(
    conn: &Connection,
    workspace_id: &str,
    run_id: &str,
) -> Result<Option<String>, RpcError> {
    conn.query_row(
        "SELECT node_id FROM graph_node_runs
          WHERE workspace_id = ?1 AND run_id = ?2
          ORDER BY id DESC LIMIT 1",
        params![workspace_id, run_id],
        |r| r.get(0),
    )
    .optional()
    .map_err(error::from_sqlite)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        apply_pending_steps_in_tx(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    #[test]
    fn a_node_keeps_its_newest_launch_and_history_is_append_only() {
        let conn = conn();
        record_node_run(&conn, "ws1", "run-a", "t0", &["n1".into(), "n2".into()]).unwrap();
        record_node_run(&conn, "ws1", "run-b", "t1", &["n1".into()]).unwrap();
        let latest = latest_node_run(&conn, "ws1", "n1").unwrap().unwrap();
        assert_eq!(latest.run_id, "run-b");
        assert_eq!(latest.step_label, "n1");
        let n2 = latest_node_run(&conn, "ws1", "n2").unwrap().unwrap();
        assert_eq!(n2.run_id, "run-a");
        assert_eq!(node_for_run(&conn, "ws1", "run-b").unwrap().unwrap(), "n1");
        assert!(latest_node_run(&conn, "ws1", "missing").unwrap().is_none());
    }

    #[test]
    fn latest_node_runs_returns_one_newest_mapping_per_node() {
        let conn = conn();
        record_node_run(&conn, "ws1", "run-a", "t0", &["n1".into(), "n2".into()]).unwrap();
        record_node_run(&conn, "ws1", "run-b", "t1", &["n1".into()]).unwrap();
        let mut latest = latest_node_runs(&conn, "ws1").unwrap();
        latest.sort_by(|a, b| a.node_id.cmp(&b.node_id));
        assert_eq!(latest.len(), 2);
        assert_eq!(latest[0].run_id, "run-b");
        assert_eq!(latest[1].run_id, "run-a");
        // Another workspace's launches never leak in.
        assert!(latest_node_runs(&conn, "ws2").unwrap().is_empty());
    }

    #[test]
    fn future_graph_schema_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions(component, version) VALUES ('graph', 99);",
        )
        .unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        let err = apply_pending_steps_in_tx(&tx).unwrap_err();
        assert!(err.to_string().contains("is newer than"));
    }
}
