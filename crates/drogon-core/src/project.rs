//! Project registration and storage. A Project is either a git repository or
//! a plain folder that owns Worktrees (`docs/migration/rewrite-mvp-plan.md`
//! J1). Mirrors `workspace.rs`'s canonicalize-and-classify shape, but never
//! reuses its table: a Project and a Workspace are different entities (a
//! Project owns zero or more Worktrees, each of which registers its own
//! Workspace so `session.start` works unchanged).

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Value, json};

use crate::{Engine, error, now_rfc3339, optional_str, require_str};

pub(crate) const PROJECTS_SCHEMA_COMPONENT: &str = "projects";
pub(crate) const PROJECTS_SCHEMA_VERSION: i64 = 1;

fn create_v1_tables(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            default_base_ref TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS worktrees (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL UNIQUE,
            path TEXT NOT NULL UNIQUE,
            branch TEXT NOT NULL,
            head TEXT NOT NULL,
            base_ref TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS worktrees_project ON worktrees(project_id);",
    )
}

/// Applies the `projects`/`worktrees` schema using the caller's already-open
/// transaction, in the same rollback-safe aggregate shape as
/// `bots::storage::apply_pending_steps_in_tx` (see `db::migrate_and_recover`,
/// which calls this alongside the other components).
pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![PROJECTS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        create_v1_tables(tx)?;
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
            params![PROJECTS_SCHEMA_COMPONENT, PROJECTS_SCHEMA_VERSION],
        )?;
    }
    Ok(())
}

fn classify(path: &std::path::Path) -> &'static str {
    let dot_git = path.join(".git");
    if dot_git.is_dir() || dot_git.is_file() {
        "git"
    } else {
        "folder"
    }
}

/// A Project row, resolved for `worktree_rpc`'s internal use. Never itself
/// exposed on the wire (the RPC handlers below build the wire `Value`
/// directly, like the rest of this crate's modules).
pub(crate) struct ProjectInfo {
    pub(crate) id: String,
    #[allow(dead_code)]
    pub(crate) host_id: String,
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) created_at: String,
}

pub(crate) fn get(conn: &Connection, id: &str) -> Result<ProjectInfo, drogon_protocol::RpcError> {
    conn.query_row(
        "SELECT id, host_id, path, name, kind, created_at FROM projects WHERE id = ?1",
        [id],
        |r| {
            Ok(ProjectInfo {
                id: r.get(0)?,
                host_id: r.get(1)?,
                path: r.get(2)?,
                name: r.get(3)?,
                kind: r.get(4)?,
                created_at: r.get(5)?,
            })
        },
    )
    .optional()
    .map_err(error::from_sqlite)?
    .ok_or_else(|| error::not_found("project not found"))
}

fn to_json(
    id: &str,
    host_id: &str,
    path: &str,
    name: &str,
    kind: &str,
    base_ref: Option<&str>,
) -> Value {
    json!({
        "id": id,
        "hostId": host_id,
        "path": path,
        "name": name,
        "kind": kind,
        "defaultBaseRef": base_ref,
    })
}

fn fetch_by_path(
    conn: &Connection,
    canonical_path: &str,
) -> Result<Option<Value>, drogon_protocol::RpcError> {
    conn.query_row(
        "SELECT id, host_id, path, name, kind, default_base_ref FROM projects WHERE path = ?1",
        [canonical_path],
        |r| {
            Ok(to_json(
                &r.get::<_, String>(0)?,
                &r.get::<_, String>(1)?,
                &r.get::<_, String>(2)?,
                &r.get::<_, String>(3)?,
                &r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?.as_deref(),
            ))
        },
    )
    .optional()
    .map_err(error::from_sqlite)
}

/// Registers `path` as a Project, idempotent by canonical path (same
/// contract as `workspace::register`). Detects `git` vs `folder` by presence
/// of `.git`; never runs a Git mutation to classify. A folder Project also
/// registers itself as a Workspace right away, since a folder Project has no
/// separate worktree-creation step: "A folder project exposes exactly one
/// implicit worktree = its workspace" (see `worktree_rpc::list`). A git
/// Project does NOT register its own root as a Workspace — sessions only
/// attach to a Worktree's Workspace, created by `worktree.create`.
pub(crate) fn add(
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
    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| error::invalid_argument("resolved project path is not UTF-8"))?
        .to_owned();
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
    let created_at = now_rfc3339();
    let insert = conn.execute(
        "INSERT INTO projects (id, host_id, path, name, kind, default_base_ref, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
        params![id, host_id, canonical_str, derived_name, kind, created_at],
    );
    match insert {
        Ok(_) => {
            if kind == "folder" {
                crate::workspace::register(conn, host_id, &canonical_str, Some(&derived_name))?;
            }
            Ok(to_json(
                &id,
                host_id,
                &canonical_str,
                &derived_name,
                kind,
                None,
            ))
        }
        // A concurrent add of the same canonical path lost the race on the
        // UNIQUE(path) constraint; treat it like finding it above.
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            fetch_by_path(conn, &canonical_str)?
                .ok_or_else(|| error::internal_error("project vanished after constraint race"))
        }
        Err(e) => Err(error::from_sqlite(e)),
    }
}

pub(crate) fn list(conn: &Connection) -> Result<Value, drogon_protocol::RpcError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, host_id, path, name, kind, default_base_ref FROM projects ORDER BY created_at",
        )
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(to_json(
                &r.get::<_, String>(0)?,
                &r.get::<_, String>(1)?,
                &r.get::<_, String>(2)?,
                &r.get::<_, String>(3)?,
                &r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?.as_deref(),
            ))
        })
        .map_err(error::from_sqlite)?;
    let projects: Result<Vec<Value>, _> = rows.collect();
    let projects = projects.map_err(error::from_sqlite)?;
    Ok(json!({ "projects": projects }))
}

/// Removes the Project row (never the files on disk). Its Worktree rows are
/// removed too (registration bookkeeping only — their git worktrees and
/// branches are untouched on disk, exactly like the underlying `worktrees`
/// checkouts becoming unmanaged rather than deleted); the Workspace rows
/// those worktrees registered are left as harmless orphans, the same
/// tolerance `bots::storage::delete_bot` gives an owned Automation.
pub(crate) fn remove(conn: &Connection, id: &str) -> Result<Value, drogon_protocol::RpcError> {
    let tx = conn.unchecked_transaction().map_err(error::from_sqlite)?;
    let existed = tx
        .execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(error::from_sqlite)?;
    if existed == 0 {
        return Err(error::not_found("project not found"));
    }
    tx.execute("DELETE FROM worktrees WHERE project_id = ?1", [id])
        .map_err(error::from_sqlite)?;
    tx.commit().map_err(error::from_sqlite)?;
    Ok(json!({ "id": id, "removed": true }))
}

impl Engine {
    pub(super) fn do_project_add(
        &self,
        params: &Value,
    ) -> Result<Value, drogon_protocol::RpcError> {
        let path = require_str(params, "path")?;
        let name = optional_str(params, "name")?;
        let conn = self.db.lock().unwrap();
        add(&conn, &self.host_id, path, name)
    }

    pub(super) fn do_project_remove(
        &self,
        params: &Value,
    ) -> Result<Value, drogon_protocol::RpcError> {
        let id = require_str(params, "id")?;
        let conn = self.db.lock().unwrap();
        remove(&conn, id)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn open_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // `workspaces` is created directly (not through a schema_versions
        // step) by `db::create_tables`; mirrored here so `add`'s folder-kind
        // `workspace::register` call has a table to write into.
        conn.execute_batch(
            "CREATE TABLE workspaces (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                host_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        apply_pending_steps_in_tx(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    #[test]
    fn add_is_idempotent_by_canonical_path_and_classifies_folder() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_conn();
        let first = add(&conn, "host-1", dir.path().to_str().unwrap(), None).unwrap();
        let second = add(&conn, "host-1", dir.path().to_str().unwrap(), None).unwrap();
        assert_eq!(first["id"], second["id"]);
        assert_eq!(first["kind"], "folder");
        assert!(first["defaultBaseRef"].is_null());

        let listed = list(&conn).unwrap();
        assert_eq!(listed["projects"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn add_classifies_a_git_directory_without_shelling_out() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        let conn = open_conn();
        let project = add(&conn, "host-1", dir.path().to_str().unwrap(), None).unwrap();
        assert_eq!(project["kind"], "git");
    }

    #[test]
    fn remove_deletes_the_row_but_never_touches_the_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_conn();
        let project = add(&conn, "host-1", dir.path().to_str().unwrap(), None).unwrap();
        let id = project["id"].as_str().unwrap();
        remove(&conn, id).unwrap();
        assert!(
            dir.path().is_dir(),
            "project removal must never delete files"
        );
        assert_eq!(
            list(&conn).unwrap()["projects"].as_array().unwrap().len(),
            0
        );
        assert!(remove(&conn, id).is_err(), "removing twice is not_found");
    }

    #[test]
    fn add_rejects_a_missing_path() {
        let conn = open_conn();
        assert!(add(&conn, "host-1", "/does/not/exist-xyz", None).is_err());
    }
}
