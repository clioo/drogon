//! Workspace registration. `protocol-v1.md`: "Ordinary folders are
//! first-class; .git may be a directory or worktree pointer file. Do not run
//! Git mutations for registration." This module only canonicalizes and
//! classifies a path — it never shells out to `git`.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

use crate::error;

pub(crate) fn register(
    conn: &Connection,
    host_id: &str,
    path: &str,
    name: Option<&str>,
) -> Result<Value, drogon_protocol::RpcError> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|_| error::invalid_argument("path does not exist or is not readable"))?;
    if !canonical.is_dir() {
        return Err(error::invalid_argument("path is not a directory"));
    }
    let canonical_str = utf8_workspace_path(&canonical)?.to_owned();
    let kind = classify(&canonical);
    let derived_name = name.map(str::to_string).unwrap_or_else(|| {
        canonical
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| canonical_str.clone())
    });

    if let Some(existing) = fetch_by_path(conn, &canonical_str)? {
        return Ok(existing);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = crate::now_rfc3339();
    let insert = conn.execute(
        "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, canonical_str, derived_name, kind, host_id, created_at],
    );
    match insert {
        Ok(_) => Ok(json!({
            "id": id, "path": canonical_str, "name": derived_name, "kind": kind, "hostId": host_id
        })),
        // Why: a concurrent register of the same canonical path lost the
        // race on the UNIQUE(path) constraint; treat it the same as finding
        // it above rather than surfacing a spurious conflict.
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            fetch_by_path(conn, &canonical_str)?
                .ok_or_else(|| error::internal_error("workspace vanished after constraint race"))
        }
        Err(e) => Err(error::from_sqlite(e)),
    }
}

fn utf8_workspace_path(path: &Path) -> Result<&str, drogon_protocol::RpcError> {
    path.to_str()
        .ok_or_else(|| error::invalid_argument("resolved workspace path is not UTF-8"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    #[test]
    fn non_utf8_paths_are_rejected_without_replacement_characters() {
        let path = std::path::PathBuf::from(OsString::from_vec(b"/workspace-\xff".to_vec()));
        assert!(utf8_workspace_path(&path).is_err());
        assert_eq!(
            utf8_workspace_path(Path::new("/workspace-é")).unwrap(),
            "/workspace-é"
        );
    }
}

fn classify(path: &Path) -> &'static str {
    let dot_git = path.join(".git");
    if dot_git.is_dir() || dot_git.is_file() {
        "git"
    } else {
        "folder"
    }
}

fn fetch_by_path(
    conn: &Connection,
    canonical_path: &str,
) -> Result<Option<Value>, drogon_protocol::RpcError> {
    conn.query_row(
        "SELECT id, path, name, kind, host_id FROM workspaces WHERE path = ?1",
        [canonical_path],
        |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "path": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "kind": r.get::<_, String>(3)?,
                "hostId": r.get::<_, String>(4)?,
            }))
        },
    )
    .optional()
    .map_err(error::from_sqlite)
}

pub(crate) fn list(conn: &Connection) -> Result<Value, drogon_protocol::RpcError> {
    let mut stmt = conn
        .prepare("SELECT id, path, name, kind, host_id FROM workspaces ORDER BY created_at")
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "path": r.get::<_, String>(1)?,
                "name": r.get::<_, String>(2)?,
                "kind": r.get::<_, String>(3)?,
                "hostId": r.get::<_, String>(4)?,
            }))
        })
        .map_err(error::from_sqlite)?;
    let workspaces: Result<Vec<Value>, _> = rows.collect();
    let workspaces = workspaces.map_err(error::from_sqlite)?;
    Ok(json!({ "workspaces": workspaces }))
}

pub(crate) fn get_path(
    conn: &Connection,
    workspace_id: &str,
) -> Result<String, drogon_protocol::RpcError> {
    conn.query_row(
        "SELECT path FROM workspaces WHERE id = ?1",
        [workspace_id],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(error::from_sqlite)?
    .ok_or_else(|| error::not_found("workspace not found"))
}
