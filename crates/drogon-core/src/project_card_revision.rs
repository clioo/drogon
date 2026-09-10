use rusqlite::Connection;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::error;

/// Include durable card metadata in cross-client refreshes. JSON preserves
/// field boundaries even when a status or provider title contains delimiters.
pub(crate) fn update(
    conn: &Connection,
    digest: &mut Sha256,
) -> Result<(), drogon_protocol::RpcError> {
    for (table, tail) in [
        ("projects", "NULL, NULL, NULL"),
        ("worktrees", "sort_order, linked_pr, creator"),
    ] {
        let mut statement = conn.prepare(&format!(
            "SELECT id, workspace_status, is_pinned, is_archived, manual_order, last_activity_at, {tail} FROM {table} ORDER BY id"
        )).map_err(error::from_sqlite)?;
        let rows = statement
            .query_map([], |row| {
                Ok(json!([
                    table,
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ])
                .to_string())
            })
            .map_err(error::from_sqlite)?;
        for row in rows {
            digest.update(row.map_err(error::from_sqlite)?.as_bytes());
        }
    }
    let has_links: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worktree_issue_links')",
        [], |row| row.get(0),
    ).map_err(error::from_sqlite)?;
    if has_links {
        let mut statement = conn.prepare(
            "SELECT worktree_id, project_id, provider, payload FROM worktree_issue_links ORDER BY worktree_id, provider"
        ).map_err(error::from_sqlite)?;
        let rows = statement
            .query_map([], |row| {
                Ok(json!([
                    "issue",
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ])
                .to_string())
            })
            .map_err(error::from_sqlite)?;
        for row in rows {
            digest.update(row.map_err(error::from_sqlite)?.as_bytes());
        }
    }
    Ok(())
}
