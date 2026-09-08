//! Project registration and storage. A Project is either a git repository or
//! a plain folder that owns Worktrees (`docs/migration/rewrite-mvp-plan.md`
//! J1). Mirrors `workspace.rs`'s canonicalize-and-classify shape, but never
//! reuses its table: a Project and a Workspace are different entities (a
//! Project owns zero or more Worktrees, each of which registers its own
//! Workspace so `session.start` works unchanged).

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Value, json};

use crate::{Engine, error, now_rfc3339, optional_str, require_str};

/// Quick Session scratch layout (the fork's `drogon-quick-session-scratch`):
/// `<data-dir>/quick-sessions/session-<id>/` with an ownership marker the
/// delete path verifies before removing anything.
pub(crate) const QUICK_SESSION_ROOT: &str = "quick-sessions";
pub(crate) const QUICK_SESSION_MARKER: &str = ".drogon-quick-session.json";
pub(crate) const QUICK_SESSION_MARKER_OWNER: &str = "drogon";
pub(crate) const QUICK_SESSION_DEFAULT_NAME: &str = "Quick Session";

pub(crate) const PROJECTS_SCHEMA_COMPONENT: &str = "projects";
pub(crate) const PROJECTS_SCHEMA_VERSION: i64 = 3;

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
    // v2 adds the nullable display-title column renamed by
    // `worktree.rename` (Orca's inline rename renames the card's display
    // title only — never the git branch, never the directory).
    fn apply_v2_title_column(tx: &Transaction) -> rusqlite::Result<()> {
        let has_title: bool = tx
            .prepare("PRAGMA table_info(worktrees)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|name| name == "title");
        if !has_title {
            tx.execute("ALTER TABLE worktrees ADD COLUMN title TEXT", [])?;
        }
        Ok(())
    }
    fn add_column_if_missing(
        tx: &Transaction,
        table: &str,
        column: &str,
        ddl: &str,
    ) -> rusqlite::Result<()> {
        let has_column: bool = tx
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .any(|name| name == column);
        if !has_column {
            tx.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {ddl}"))?;
        }
        Ok(())
    }
    // v3: the composer Advanced rows — the worktree note and
    // sidebar-nesting parent, the project's setup script, the
    // Quick Session scratch marker, and per-project sparse-checkout
    // presets.
    fn apply_v3_composer_columns(tx: &Transaction) -> rusqlite::Result<()> {
        add_column_if_missing(tx, "worktrees", "note", "TEXT")?;
        add_column_if_missing(tx, "worktrees", "parent_worktree_id", "TEXT")?;
        add_column_if_missing(tx, "projects", "setup_script", "TEXT")?;
        add_column_if_missing(
            tx,
            "projects",
            "quick_session",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS sparse_presets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                directories_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(project_id, name)
            );",
        )
    }
    match existing {
        None => {
            create_v1_tables(tx)?;
            apply_v2_title_column(tx)?;
            apply_v3_composer_columns(tx)?;
            tx.execute(
                "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
                params![PROJECTS_SCHEMA_COMPONENT, PROJECTS_SCHEMA_VERSION],
            )?;
        }
        // Downgrade guard: a recorded version newer than
        // `PROJECTS_SCHEMA_VERSION` was written by a build this one cannot
        // understand. The old `_ => {}` arm silently accepted it, letting an
        // older build write rows into a future schema.
        Some(found) if found > PROJECTS_SCHEMA_VERSION => {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
                Some(format!(
                    "projects schema version {found} is newer than supported {PROJECTS_SCHEMA_VERSION}"
                )),
            ));
        }
        Some(1) => {
            apply_v2_title_column(tx)?;
            apply_v3_composer_columns(tx)?;
            tx.execute(
                "UPDATE schema_versions SET version = ?2 WHERE component = ?1",
                params![PROJECTS_SCHEMA_COMPONENT, PROJECTS_SCHEMA_VERSION],
            )?;
        }
        Some(2) => {
            apply_v3_composer_columns(tx)?;
            tx.execute(
                "UPDATE schema_versions SET version = ?2 WHERE component = ?1",
                params![PROJECTS_SCHEMA_COMPONENT, PROJECTS_SCHEMA_VERSION],
            )?;
        }
        _ => {}
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

#[allow(clippy::too_many_arguments)]
fn to_json(
    id: &str,
    host_id: &str,
    path: &str,
    name: &str,
    kind: &str,
    base_ref: Option<&str>,
    setup_script: Option<&str>,
    quick_session: bool,
) -> Value {
    json!({
        "id": id,
        "hostId": host_id,
        "path": path,
        "name": name,
        "kind": kind,
        "defaultBaseRef": base_ref,
        "setupScript": setup_script,
        "quickSession": quick_session,
    })
}

struct ProjectRow {
    id: String,
    host_id: String,
    path: String,
    name: String,
    kind: String,
    base_ref: Option<String>,
    setup_script: Option<String>,
    quick_session: bool,
}

fn read_project_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: r.get(0)?,
        host_id: r.get(1)?,
        path: r.get(2)?,
        name: r.get(3)?,
        kind: r.get(4)?,
        base_ref: r.get(5)?,
        setup_script: r.get(6)?,
        quick_session: r.get::<_, i64>(7)? != 0,
    })
}

const PROJECT_ROW_COLUMNS: &str =
    "id, host_id, path, name, kind, default_base_ref, setup_script, quick_session";

fn project_row_json(row: &ProjectRow) -> Value {
    to_json(
        &row.id,
        &row.host_id,
        &row.path,
        &row.name,
        &row.kind,
        row.base_ref.as_deref(),
        row.setup_script.as_deref(),
        row.quick_session,
    )
}

fn fetch_by_path(
    conn: &Connection,
    canonical_path: &str,
) -> Result<Option<Value>, drogon_protocol::RpcError> {
    conn.query_row(
        &format!("SELECT {PROJECT_ROW_COLUMNS} FROM projects WHERE path = ?1"),
        [canonical_path],
        |r| Ok(project_row_json(&read_project_row(r)?)),
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
                None,
                false,
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

/// Stable revision digest over the whole project registry (projects plus
/// their worktrees), for clients that must notice out-of-band changes: a
/// `drogon-cli project add` from another process writes the same tables the
/// desktop reads through `project.list`, but nothing told the desktop to
/// re-read. Polling this cheap digest (instead of the full fan-out behind
/// `project.list` + one `worktree.list` per project) lets main forward a
/// `drogon:projectsChanged` push to the renderer exactly when the registry
/// moved. Any recorded mutation — project add/remove, worktree
/// create/remove/rename — changes the digest, because every column the
/// sidebar renders feeds it; row order is fixed (`ORDER BY id`) so an
/// unchanged registry always digests identically, including across daemon
/// restarts (no sequence state to lose).
pub(crate) fn changes(conn: &Connection) -> Result<Value, drogon_protocol::RpcError> {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    let mut projects = conn
        .prepare(
            "SELECT id, host_id, path, name, kind, \
             COALESCE(default_base_ref, ''), COALESCE(setup_script, ''), \
             quick_session, created_at \
             FROM projects ORDER BY id",
        )
        .map_err(error::from_sqlite)?;
    let project_rows = projects
        .query_map([], |r| {
            Ok(format!(
                "p\0{}\0{}\0{}\0{}\0{}\0{}\0{}\0{}\0{}\n",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, String>(8)?,
            ))
        })
        .map_err(error::from_sqlite)?;
    for row in project_rows {
        digest.update(row.map_err(error::from_sqlite)?.as_bytes());
    }
    drop(projects);
    let mut worktrees = conn
        .prepare(
            "SELECT id, project_id, workspace_id, path, branch, head, \
             COALESCE(base_ref, ''), COALESCE(title, ''), COALESCE(note, ''), \
             COALESCE(parent_worktree_id, ''), created_at \
             FROM worktrees ORDER BY id",
        )
        .map_err(error::from_sqlite)?;
    let worktree_rows = worktrees
        .query_map([], |r| {
            Ok(format!(
                "w\0{}\0{}\0{}\0{}\0{}\0{}\0{}\0{}\0{}\0{}\0{}\n",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
                r.get::<_, String>(10)?,
            ))
        })
        .map_err(error::from_sqlite)?;
    for row in worktree_rows {
        digest.update(row.map_err(error::from_sqlite)?.as_bytes());
    }
    drop(worktrees);
    let mut presets = conn
        .prepare(
            "SELECT id, project_id, name, directories_json, created_at \
             FROM sparse_presets ORDER BY id",
        )
        .map_err(error::from_sqlite)?;
    let preset_rows = presets
        .query_map([], |r| {
            Ok(format!(
                "s\0{}\0{}\0{}\0{}\0{}\n",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(error::from_sqlite)?;
    for row in preset_rows {
        digest.update(row.map_err(error::from_sqlite)?.as_bytes());
    }
    Ok(json!({ "revision": format!("{:x}", digest.finalize()) }))
}

pub(crate) fn list(conn: &Connection) -> Result<Value, drogon_protocol::RpcError> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {PROJECT_ROW_COLUMNS} FROM projects ORDER BY created_at",
        ))
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map([], |r| Ok(project_row_json(&read_project_row(r)?)))
        .map_err(error::from_sqlite)?;
    let projects: Result<Vec<Value>, _> = rows.collect();
    let projects = projects.map_err(error::from_sqlite)?;
    Ok(json!({ "projects": projects }))
}

/// Removes the Project row (never the files on disk — except a Quick
/// Session's app-owned scratch folder, which `do_project_remove` deletes
/// after this row delete, matching the fork's on-explicit-delete scratch
/// cleanup). Its Worktree rows are
/// removed too (registration bookkeeping only — their git worktrees and
/// branches are untouched on disk, exactly like the underlying `worktrees`
/// checkouts becoming unmanaged rather than deleted). A folder project's
/// implicit Workspace is registration-owned by that project and is removed
/// with it; git worktree Workspace rows retain the existing orphan tolerance.
pub(crate) fn remove(conn: &Connection, id: &str) -> Result<Value, drogon_protocol::RpcError> {
    let tx = conn.unchecked_transaction().map_err(error::from_sqlite)?;
    let folder_path: Option<String> = tx
        .query_row(
            "SELECT path FROM projects WHERE id = ?1 AND kind = 'folder'",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    let existed = tx
        .execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(error::from_sqlite)?;
    if existed == 0 {
        return Err(error::not_found("project not found"));
    }
    tx.execute("DELETE FROM worktrees WHERE project_id = ?1", [id])
        .map_err(error::from_sqlite)?;
    tx.execute("DELETE FROM sparse_presets WHERE project_id = ?1", [id])
        .map_err(error::from_sqlite)?;
    if let Some(path) = folder_path {
        tx.execute("DELETE FROM workspaces WHERE path = ?1", [path])
            .map_err(error::from_sqlite)?;
    }
    tx.commit().map_err(error::from_sqlite)?;
    Ok(json!({ "id": id, "removed": true }))
}

/// Updates project settings (`project.update`). Only the setup script is
/// mutable today (Project Settings → Setup script, the fork's
/// RepositoryHookScriptSetting local field).
pub(crate) fn update(
    conn: &Connection,
    params: &Value,
) -> Result<Value, drogon_protocol::RpcError> {
    let decoded: drogon_protocol::project::ProjectUpdateParams =
        serde_json::from_value(params.clone())
            .map_err(|_| error::invalid_argument("Invalid project.update parameters"))?;
    if let Some(Some(script)) = &decoded.setup_script {
        if script.contains('\0') {
            return Err(error::invalid_argument(
                "setupScript must not contain a NUL byte",
            ));
        }
        if script.len() > 128 * 1024 {
            return Err(error::invalid_argument("setupScript is too long"));
        }
    }
    if let Some(script) = &decoded.setup_script {
        let trimmed = script.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let changed = conn
            .execute(
                "UPDATE projects SET setup_script = ?1 WHERE id = ?2",
                params![trimmed, decoded.id],
            )
            .map_err(error::from_sqlite)?;
        if changed == 0 {
            return Err(error::not_found("project not found"));
        }
    } else {
        // No mutable field supplied: still confirm the project exists.
        get(conn, &decoded.id)?;
    }
    conn.query_row(
        &format!("SELECT {PROJECT_ROW_COLUMNS} FROM projects WHERE id = ?1"),
        [&decoded.id],
        |r| Ok(project_row_json(&read_project_row(r)?)),
    )
    .map_err(error::from_sqlite)
}

fn sparse_preset_json(id: &str, project_id: &str, name: &str, directories: &[String]) -> Value {
    json!({
        "id": id,
        "projectId": project_id,
        "name": name,
        "directories": directories,
    })
}

/// Normalizes sparse preset directories with the same repo-relative rules
/// `worktree_rpc`'s create path applies (trimmed, forward-slashed, no
/// absolute paths or `..` segments, deduped, never empty).
fn normalize_preset_directories(
    directories: &[String],
) -> Result<Vec<String>, drogon_protocol::RpcError> {
    let params = json!({ "sparse": directories });
    let normalized = crate::worktree_rpc::normalize_sparse_directories_for_preset(&params)?;
    if normalized.is_empty() {
        return Err(error::invalid_argument("Add at least one directory."));
    }
    Ok(normalized)
}

pub(crate) fn sparse_presets_list(
    conn: &Connection,
    params: &Value,
) -> Result<Value, drogon_protocol::RpcError> {
    let decoded: drogon_protocol::project::SparsePresetListParams =
        serde_json::from_value(params.clone())
            .map_err(|_| error::invalid_argument("Invalid project.sparsePresets parameters"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, directories_json FROM sparse_presets WHERE project_id = ?1 ORDER BY name",
        )
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map([&decoded.project_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(error::from_sqlite)?;
    let mut presets = Vec::new();
    for row in rows {
        let (id, name, directories_json) = row.map_err(error::from_sqlite)?;
        let directories: Vec<String> = serde_json::from_str(&directories_json).unwrap_or_default();
        presets.push(sparse_preset_json(
            &id,
            &decoded.project_id,
            &name,
            &directories,
        ));
    }
    Ok(json!({ "presets": presets }))
}

pub(crate) fn sparse_presets_save(
    conn: &Connection,
    params: &Value,
) -> Result<Value, drogon_protocol::RpcError> {
    let decoded: drogon_protocol::project::SparsePresetSaveParams =
        serde_json::from_value(params.clone())
            .map_err(|_| error::invalid_argument("Invalid project.saveSparsePreset parameters"))?;
    // The project must exist and be a git project — sparse checkout is a
    // git-only composer row.
    let project = get(conn, &decoded.project_id)?;
    if project.kind != "git" {
        return Err(error::invalid_argument(
            "sparse presets require a git project",
        ));
    }
    let name = decoded.name.trim();
    if name.is_empty() {
        return Err(error::invalid_argument("Name is required."));
    }
    if name.chars().count() > 80 {
        return Err(error::invalid_argument(
            "Name must be 80 characters or fewer.",
        ));
    }
    let directories = normalize_preset_directories(&decoded.directories)?;
    let directories_json = serde_json::to_string(&directories)
        .map_err(|e| error::internal_error(format!("cannot encode directories: {e}")))?;
    let conflict: Option<String> = conn
        .query_row(
            "SELECT id FROM sparse_presets WHERE project_id = ?1 AND name = ?2",
            params![decoded.project_id, name],
            |r| r.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    if let Some(existing) = conflict
        && decoded.id.as_deref() != Some(existing.as_str())
    {
        return Err(error::invalid_argument(format!(
            "\"{name}\" already exists."
        )));
    }
    match &decoded.id {
        Some(id) => {
            let changed = conn
                .execute(
                    "UPDATE sparse_presets SET name = ?1, directories_json = ?2 WHERE id = ?3 AND project_id = ?4",
                    params![name, directories_json, id, decoded.project_id],
                )
                .map_err(error::from_sqlite)?;
            if changed == 0 {
                return Err(error::not_found("sparse preset not found"));
            }
            Ok(sparse_preset_json(
                id,
                &decoded.project_id,
                name,
                &directories,
            ))
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO sparse_presets (id, project_id, name, directories_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, decoded.project_id, name, directories_json, now_rfc3339()],
            )
            .map_err(error::from_sqlite)?;
            Ok(sparse_preset_json(
                &id,
                &decoded.project_id,
                name,
                &directories,
            ))
        }
    }
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
        let scratch: Option<String> = {
            let conn = self.db.lock().unwrap();
            conn.query_row(
                "SELECT path FROM projects WHERE id = ?1 AND quick_session != 0",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error::from_sqlite)?
        };
        let conn = self.db.lock().unwrap();
        let removed = remove(&conn, id)?;
        drop(conn);
        // Quick Session cleanup (the fork's on-explicit-delete scratch
        // removal): the directory is app-owned, but only delete it when it
        // is still the scratch this daemon created — inside the data dir's
        // quick-sessions root with a matching ownership marker.
        if let Some(path) = scratch {
            self.cleanup_quick_session_scratch(id, &path)?;
        }
        Ok(removed)
    }

    /// Deletes a Quick Session scratch folder after its project row is
    /// gone. Any doubt about ownership (moved directory, foreign marker,
    /// path outside the quick-sessions root) skips the delete rather than
    /// risking user files.
    fn cleanup_quick_session_scratch(
        &self,
        project_id: &str,
        path: &str,
    ) -> Result<(), drogon_protocol::RpcError> {
        let root = self.data_dir.join(QUICK_SESSION_ROOT);
        let canonical_root = std::fs::canonicalize(&root).unwrap_or(root);
        let candidate = std::fs::canonicalize(path)
            .map_err(|e| error::io_error(format!("quick session scratch cleanup failed: {e}")))?;
        if !candidate.starts_with(&canonical_root) {
            return Err(error::io_error(format!(
                "quick session scratch \"{}\" is outside the quick-sessions root; not deleting",
                candidate.display()
            )));
        }
        let marker = candidate.join(QUICK_SESSION_MARKER);
        let content = std::fs::read_to_string(&marker).map_err(|e| {
            error::io_error(format!("quick session scratch marker unreadable: {e}"))
        })?;
        let parsed: Value = serde_json::from_str(&content)
            .map_err(|_| error::io_error("quick session scratch marker is not valid JSON"))?;
        if parsed["owner"].as_str() != Some(QUICK_SESSION_MARKER_OWNER)
            || parsed["projectId"].as_str() != Some(project_id)
        {
            return Err(error::io_error(
                "quick session scratch marker ownership mismatch; not deleting",
            ));
        }
        std::fs::remove_dir_all(&candidate)
            .map_err(|e| error::io_error(format!("quick session scratch cleanup failed: {e}")))
    }

    /// Quick Session (`project.quickSessionCreate`): the fork's composer
    /// footer button starts the picked harness in an app-owned scratch
    /// folder. The daemon creates `<data-dir>/quick-sessions/session-<id>`
    /// (0700, with the ownership marker the delete path later checks),
    /// registers it as a folder Project — which also registers its
    /// implicit Workspace — and returns both so the renderer can select
    /// the workspace and start the agent.
    pub(super) fn do_project_quick_session_create(
        &self,
        params: &Value,
    ) -> Result<Value, drogon_protocol::RpcError> {
        let decoded: drogon_protocol::project::QuickSessionCreateParams =
            serde_json::from_value(params.clone()).map_err(|_| {
                error::invalid_argument("Invalid project.quickSessionCreate parameters")
            })?;
        let name = decoded
            .name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(QUICK_SESSION_DEFAULT_NAME)
            .to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let root = self.data_dir.join(QUICK_SESSION_ROOT);
        std::fs::create_dir_all(&root)
            .map_err(|e| error::io_error(format!("cannot create quick-sessions root: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700));
        }
        let scratch = root.join(format!("session-{id}"));
        std::fs::create_dir(&scratch)
            .map_err(|e| error::io_error(format!("cannot create quick session folder: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&scratch, std::fs::Permissions::from_mode(0o700));
        }
        let created = (|| -> Result<Value, drogon_protocol::RpcError> {
            let scratch_str = scratch
                .to_str()
                .ok_or_else(|| error::invalid_argument("scratch path is not UTF-8"))?;
            let conn = self.db.lock().unwrap();
            let project = add(&conn, &self.host_id, scratch_str, Some(&name))?;
            let project_id = project["id"]
                .as_str()
                .ok_or_else(|| error::internal_error("project registration missing id"))?
                .to_string();
            conn.execute(
                "UPDATE projects SET quick_session = 1 WHERE id = ?1",
                [&project_id],
            )
            .map_err(error::from_sqlite)?;
            // Write the marker after registration so cleanup can verify the
            // actual project id (the scratch UUID and DB project UUID are
            // deliberately separate identities). If this write fails,
            // remove the just-created row before returning.
            let marker_content = serde_json::to_string(
                &json!({"owner": QUICK_SESSION_MARKER_OWNER, "projectId": project_id}),
            )
            .map_err(|e| error::internal_error(format!("cannot encode marker: {e}")))?;
            if let Err(error) = std::fs::write(scratch.join(QUICK_SESSION_MARKER), marker_content)
                .map_err(|e| error::io_error(format!("cannot write quick session marker: {e}")))
            {
                let _ = remove(&conn, &project_id);
                return Err(error);
            }
            // Folder projects register their implicit workspace inside
            // `add`; a second register is idempotent by path and returns
            // the same row's id.
            let workspace =
                crate::workspace::register(&conn, &self.host_id, scratch_str, Some(&name))?;
            let workspace_id = workspace["id"]
                .as_str()
                .ok_or_else(|| error::internal_error("workspace registration missing id"))?
                .to_string();
            let project = conn
                .query_row(
                    &format!("SELECT {PROJECT_ROW_COLUMNS} FROM projects WHERE id = ?1"),
                    [&project_id],
                    |r| Ok(project_row_json(&read_project_row(r)?)),
                )
                .map_err(error::from_sqlite)?;
            Ok(json!({ "project": project, "workspaceId": workspace_id }))
        })();
        if created.is_err() {
            // The scratch is app-owned and pre-registration, so a failed
            // create removes it rather than littering the data dir.
            let _ = std::fs::remove_dir_all(&scratch);
        }
        created
    }

    pub(super) fn do_project_update(
        &self,
        params: &Value,
    ) -> Result<Value, drogon_protocol::RpcError> {
        let conn = self.db.lock().unwrap();
        update(&conn, params)
    }

    pub(super) fn do_project_sparse_presets(
        &self,
        params: &Value,
    ) -> Result<Value, drogon_protocol::RpcError> {
        let conn = self.db.lock().unwrap();
        sparse_presets_list(&conn, params)
    }

    pub(super) fn do_project_save_sparse_preset(
        &self,
        params: &Value,
    ) -> Result<Value, drogon_protocol::RpcError> {
        let conn = self.db.lock().unwrap();
        sparse_presets_save(&conn, params)
    }

    pub(super) fn do_project_changes(
        &self,
        _params: &Value,
    ) -> Result<Value, drogon_protocol::RpcError> {
        let conn = self.db.lock().unwrap();
        changes(&conn)
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
        let workspace_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspaces WHERE path = ?1",
                [dir.path().to_str().unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            workspace_count, 0,
            "folder project removal unregisters its implicit workspace"
        );
        assert!(remove(&conn, id).is_err(), "removing twice is not_found");
    }

    #[test]
    fn add_rejects_a_missing_path() {
        let conn = open_conn();
        assert!(add(&conn, "host-1", "/does/not/exist-xyz", None).is_err());
    }

    fn revision(conn: &Connection) -> String {
        changes(conn).unwrap()["revision"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    #[test]
    fn changes_revision_moves_on_every_registry_mutation_and_rests_otherwise() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_conn();
        let empty = revision(&conn);
        assert_eq!(revision(&conn), empty, "re-reading rests at one revision");

        let project = add(&conn, "host-1", dir.path().to_str().unwrap(), None).unwrap();
        let added = revision(&conn);
        assert_ne!(added, empty, "project.add moves the revision");
        assert_eq!(revision(&conn), added, "re-reading rests again");

        // A direct worktree row exercises the same digest a
        // `worktree.create`/`rename`/`remove` mutation feeds: the daemon
        // records all of them in this one table, and `changes` reads the
        // table rather than any single RPC's inputs.
        let project_id = project["id"].as_str().unwrap();
        conn.execute(
            "INSERT INTO worktrees (id, project_id, workspace_id, path, branch, head, base_ref, created_at) VALUES (?1,?2,?3,?4,?5,?6,NULL,?7)",
            rusqlite::params![
                "wt-1",
                project_id,
                "ws-1",
                "/tmp/wt-1",
                "feature",
                "abc",
                "2026-09-08T00:00:00Z"
            ],
        )
        .unwrap();
        let with_worktree = revision(&conn);
        assert_ne!(with_worktree, added, "a worktree row moves the revision");

        conn.execute(
            "UPDATE worktrees SET title = ?1 WHERE id = ?2",
            ["Title", "wt-1"],
        )
        .unwrap();
        let renamed = revision(&conn);
        assert_ne!(renamed, with_worktree, "a rename moves the revision");

        conn.execute("DELETE FROM worktrees WHERE id = ?1", ["wt-1"])
            .unwrap();
        assert_ne!(revision(&conn), renamed, "a worktree removal moves it");

        remove(&conn, project_id).unwrap();
        assert_eq!(
            revision(&conn),
            empty,
            "removing the only project restores the empty revision"
        );
    }
}
