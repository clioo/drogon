//! Worktree RPCs (`docs/migration/rewrite-mvp-plan.md` J1): each Worktree of
//! a git Project registers its own Workspace so `session.start` works
//! unchanged. A folder Project has no separate worktree-creation step —
//! `worktree.list` synthesizes its one implicit worktree from the Project
//! itself (see `list`).
//!
//! `git worktree add`/`remove` are the only two mutating `git` invocations
//! this crate makes; `git_process.rs` is scoped to read-only operations on
//! purpose, so this module builds its own small bounded-spawn wrapper on top
//! of `git_process`'s shared primitives (admission cap, timeout, combined
//! output cap, kill+reap) rather than duplicating that machinery.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use drogon_protocol::RpcError;
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

use crate::git::{CapabilityCache, HostScope};
use crate::git_process::{
    self, GitProbeBudget, ParsedGitOutput, ReadOnlyGitOperation, SpawnOutcome,
};
use crate::git_worktree;
use crate::{Engine, error, now_rfc3339, require_str};

const GIT_TIMEOUT: Duration = Duration::from_secs(30);
const GIT_MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

fn budget() -> GitProbeBudget {
    GitProbeBudget {
        timeout: GIT_TIMEOUT,
        max_combined_output_bytes: GIT_MAX_OUTPUT_BYTES,
    }
}

/// Runs one bounded, mutating `git` subcommand. Every call site below builds
/// a fixed argv shape from already-validated components; nothing here
/// forwards a caller-supplied string directly into argv without going
/// through `git_worktree::validate_worktree_add` first.
fn run_git(cwd: &Path, argv: &[String]) -> Result<String, RpcError> {
    let cmd = git_process::build_git_command_with_bin(Path::new("git"), cwd, argv);
    let outcome = git_process::spawn_and_capture_bounded(cmd, &budget())?;
    match outcome {
        SpawnOutcome::Exited { status, stdout, .. } if status.success() => Ok(stdout),
        SpawnOutcome::Exited { status, stderr, .. } => Err(error::io_error(format!(
            "git {} exited with {status}: {}",
            argv.join(" "),
            stderr.trim()
        ))),
        SpawnOutcome::TimedOut => Err(error::unverifiable(format!(
            "git {} timed out and was killed before completing",
            argv.join(" ")
        ))),
        SpawnOutcome::CapExceeded => Err(error::io_error(format!(
            "git {} exceeded the configured combined output byte cap and was killed",
            argv.join(" ")
        ))),
        SpawnOutcome::UnreapedAfterKill => Err(error::unverifiable(format!(
            "git {} was killed but could not be confirmed reaped",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureUnfinished => Err(error::unverifiable(format!(
            "git {} exited but its output capture had not finished draining",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureReadError(e) => Err(error::io_error(format!(
            "git {} output capture failed: {e}",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureInvalidUtf8(which) => Err(error::io_error(format!(
            "git {} produced {which} that is not valid UTF-8",
            argv.join(" ")
        ))),
    }
}

fn map_existing_branch_error(error: RpcError, branch: &str) -> RpcError {
    if error.code == "io_error"
        && error.message.contains("branch named")
        && error.message.contains("already exists")
    {
        return error::invalid_argument(format!(
            "branch '{branch}' already exists; choose a new worktree name and use Base ref to start from this branch"
        ));
    }
    error
}

/// The fork's reuse flow (#5181): git allows a branch in only one worktree at
/// a time, so checking out an existing branch can fail with "is already used
/// by worktree". Surface that as the composer's actionable message instead of
/// a raw git stderr dump.
fn map_branch_in_use_error(error: RpcError, branch: &str) -> RpcError {
    if error.code == "io_error" && error.message.contains("already used by worktree") {
        return error::invalid_argument(format!(
            "branch '{branch}' is already checked out in another worktree"
        ));
    }
    error
}

/// A Project's `name` becomes a directory segment under
/// `<data-dir>/workspaces/`; this keeps that join safe even for a
/// user-overridden name containing a path separator, without rejecting the
/// whole `project.add` call over a display-only field.
fn sanitize_path_component(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    match cleaned.trim() {
        "" | "." | ".." => "project".to_string(),
        trimmed => trimmed.to_string(),
    }
}

fn short_branch(full_ref: &str) -> String {
    full_ref
        .strip_prefix("refs/heads/")
        .unwrap_or(full_ref)
        .to_string()
}

/// `refs/remotes/<remote>/<branch>` strips its remote prefix (the fork's
/// `resolveLocalBranchName`): `origin/feature-x` names the local branch
/// `feature-x`, while a local ref keeps its short name verbatim.
fn short_branch_local_name(full_ref: &str, short_ref: &str) -> String {
    let Some(remote_branch) = full_ref.strip_prefix("refs/remotes/") else {
        return short_ref.to_string();
    };
    match remote_branch.split_once('/') {
        Some((_, branch)) if !branch.is_empty() => branch.to_string(),
        _ => short_ref.to_string(),
    }
}

/// The fork's `REPO_SEARCH_REFS_DEFAULT_LIMIT` and a bounded maximum so a
/// huge ref list can never stream unbounded into the renderer.
const BRANCH_SEARCH_DEFAULT_LIMIT: usize = 25;
const BRANCH_SEARCH_MAX_LIMIT: usize = 200;

fn optional_bool(params: &Value, field: &str, default: bool) -> Result<bool, RpcError> {
    match params.get(field) {
        None => Ok(default),
        Some(value) => value
            .as_bool()
            .ok_or_else(|| error::invalid_argument(format!("{field} must be a boolean"))),
    }
}

/// An optional non-empty-after-trim string field (`branch`, `note`,
/// `parentWorktreeId` on `worktree.create`): absent, null or whitespace
/// all decode to `None`.
fn optional_trimmed_str(params: &Value, field: &str) -> Result<Option<String>, RpcError> {
    match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => {
            let raw = value
                .as_str()
                .ok_or_else(|| error::invalid_argument(format!("{field} must be a string")))?;
            if raw.contains('\0') {
                return Err(error::invalid_argument(format!(
                    "{field} must not contain a NUL byte"
                )));
            }
            let trimmed = raw.trim();
            Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
        }
    }
}

/// Sparse-checkout directories, normalized like the fork's
/// `normalizeSparseDirectories`: trimmed, forward-slashed, repo-relative
/// (no absolute paths, no `..` segments), deduped, never empty entries.
fn normalize_sparse_directories(params: &Value) -> Result<Vec<String>, RpcError> {
    let Some(value) = params.get("sparse") else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let entries = value
        .as_array()
        .ok_or_else(|| error::invalid_argument("sparse must be an array of directory strings"))?;
    let mut seen = std::collections::HashSet::new();
    let mut directories = Vec::new();
    for entry in entries {
        let raw = entry
            .as_str()
            .ok_or_else(|| error::invalid_argument("sparse entries must be strings"))?;
        if raw.contains('\0') {
            return Err(error::invalid_argument(
                "sparse directories must not contain NUL bytes",
            ));
        }
        let trimmed = raw.trim();
        if trimmed.starts_with('/') || trimmed.starts_with('\\') {
            return Err(error::invalid_argument(
                "sparse directories must be repo-relative paths",
            ));
        }
        let normalized = trimmed.replace('\\', "/").trim_matches('/').to_string();
        if normalized.is_empty() || normalized == "." {
            continue;
        }
        if normalized.split('/').any(|segment| segment == "..") {
            return Err(error::invalid_argument(
                "sparse directories must be repo-relative paths",
            ));
        }
        if seen.insert(normalized.clone()) {
            directories.push(normalized);
        }
    }
    Ok(directories)
}

/// `project.saveSparsePreset` shares the create path's normalization by
/// wrapping its directories in the same `{ sparse: [...] }` shape.
pub(crate) fn normalize_sparse_directories_for_preset(
    params: &Value,
) -> Result<Vec<String>, RpcError> {
    normalize_sparse_directories(params)
}

/// Resolves a composer "Parent worktree" pick: the parent must be a
/// recorded worktree of the same project (nesting is sidebar-only, so it
/// never crosses projects).
fn validate_parent_worktree(
    conn: &rusqlite::Connection,
    project_id: &str,
    parent_worktree_id: &str,
) -> Result<(), RpcError> {
    let parent_project: Option<String> = conn
        .query_row(
            "SELECT project_id FROM worktrees WHERE id = ?1",
            [parent_worktree_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    match parent_project {
        Some(owner) if owner == project_id => Ok(()),
        Some(_) => Err(error::invalid_argument(
            "parent worktree belongs to a different project",
        )),
        None => Err(error::invalid_argument("parent worktree not found")),
    }
}

/// `worktree.update` parent validation: same-project plus cycle refusal
/// (walk the candidate's ancestor chain; reaching the worktree itself
/// would close a loop).
fn validate_parent_update(
    conn: &rusqlite::Connection,
    worktree_id: &str,
    project_id: &str,
    parent_worktree_id: &str,
) -> Result<(), RpcError> {
    if parent_worktree_id == worktree_id {
        return Err(error::invalid_argument(
            "a worktree cannot be its own parent",
        ));
    }
    validate_parent_worktree(conn, project_id, parent_worktree_id)?;
    let mut cursor = parent_worktree_id.to_string();
    for _ in 0..256 {
        let next: Option<Option<String>> = conn
            .query_row(
                "SELECT parent_worktree_id FROM worktrees WHERE id = ?1",
                [&cursor],
                |r| r.get(0),
            )
            .optional()
            .map_err(error::from_sqlite)?;
        match next.flatten() {
            Some(ancestor) => {
                if ancestor == worktree_id {
                    return Err(error::invalid_argument(
                        "parent worktree would create a nesting cycle",
                    ));
                }
                cursor = ancestor;
            }
            None => return Ok(()),
        }
    }
    Err(error::invalid_argument(
        "parent worktree would create a nesting cycle",
    ))
}

/// Best-effort canonicalization for path-identity comparisons only; a path
/// that no longer resolves (removed out from under this process) falls back
/// to its raw string rather than failing the whole reconciliation.
fn canonical_or_raw(path: &str) -> String {
    std::fs::canonicalize(path)
        .ok()
        .and_then(|p| p.to_str().map(str::to_string))
        .unwrap_or_else(|| path.to_string())
}

/// Bundles every column `worktree_json` renders, named-field construction
/// at each of its five call sites (create / list-folder / list-git /
/// rename / update) instead of a positional argument list long enough to
/// silently transpose two same-typed fields.
struct WorktreeMetaRow<'a> {
    id: &'a str,
    project_id: &'a str,
    workspace_id: &'a str,
    path: &'a str,
    branch: &'a str,
    head: &'a str,
    base_ref: Option<&'a str>,
    title: Option<&'a str>,
    note: Option<&'a str>,
    parent_worktree_id: Option<&'a str>,
    created_at: &'a str,
    /// Workspace Options metadata (Group by/Sort by/Pin/Archive/PR-link
    /// producers); see `drogon_protocol::worktree::Worktree`'s own field
    /// docs for what each means. A folder Project's synthesized implicit
    /// worktree (no real `worktrees` row) always renders these at their
    /// defaults, matching `title`/`note`/`parent_worktree_id` above.
    workspace_status: Option<&'a str>,
    is_pinned: bool,
    is_archived: bool,
    sort_order: i64,
    manual_order: Option<i64>,
    last_activity_at: Option<&'a str>,
    linked_pr: Option<i64>,
    linked_issue: Option<i64>,
    creator: Option<&'a str>,
}

fn worktree_json(fields: WorktreeMetaRow) -> Value {
    json!({
        "id": fields.id,
        "projectId": fields.project_id,
        "workspaceId": fields.workspace_id,
        "path": fields.path,
        "branch": fields.branch,
        "head": fields.head,
        "baseRef": fields.base_ref,
        "title": fields.title,
        "note": fields.note,
        "parentWorktreeId": fields.parent_worktree_id,
        "createdAt": fields.created_at,
        "workspaceStatus": fields.workspace_status,
        "isPinned": fields.is_pinned,
        "isArchived": fields.is_archived,
        "sortOrder": fields.sort_order,
        "manualOrder": fields.manual_order,
        "lastActivityAt": fields.last_activity_at,
        "linkedPr": fields.linked_pr,
        "linkedIssue": fields.linked_issue,
        "creator": fields.creator,
    })
}

/// An owned worktree row, every `worktrees` column `worktree_json` renders.
/// [`do_worktree_rename`](Engine::do_worktree_rename) and
/// [`do_worktree_update`](Engine::do_worktree_update) both re-fetch and
/// render one full row after their mutation, rather than each declaring
/// its own copy of the same 18-column tuple type.
struct StoredWorktreeRow {
    id: String,
    project_id: String,
    workspace_id: String,
    path: String,
    branch: String,
    head: String,
    base_ref: Option<String>,
    title: Option<String>,
    note: Option<String>,
    parent_worktree_id: Option<String>,
    created_at: String,
    workspace_status: Option<String>,
    is_pinned: bool,
    is_archived: bool,
    sort_order: i64,
    manual_order: Option<i64>,
    last_activity_at: Option<String>,
    linked_pr: Option<i64>,
    linked_issue: Option<i64>,
    creator: Option<String>,
}

impl StoredWorktreeRow {
    fn as_json(&self) -> Value {
        worktree_json(WorktreeMetaRow {
            id: &self.id,
            project_id: &self.project_id,
            workspace_id: &self.workspace_id,
            path: &self.path,
            branch: &self.branch,
            head: &self.head,
            base_ref: self.base_ref.as_deref(),
            title: self.title.as_deref(),
            note: self.note.as_deref(),
            parent_worktree_id: self.parent_worktree_id.as_deref(),
            created_at: &self.created_at,
            workspace_status: self.workspace_status.as_deref(),
            is_pinned: self.is_pinned,
            is_archived: self.is_archived,
            sort_order: self.sort_order,
            manual_order: self.manual_order,
            last_activity_at: self.last_activity_at.as_deref(),
            linked_pr: self.linked_pr,
            linked_issue: self.linked_issue,
            creator: self.creator.as_deref(),
        })
    }
}

fn fetch_worktree_row(
    conn: &rusqlite::Connection,
    worktree_id: &str,
) -> Result<Option<StoredWorktreeRow>, RpcError> {
    conn.query_row(
        "SELECT id, project_id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at, \
         workspace_status, is_pinned, is_archived, sort_order, manual_order, last_activity_at, linked_pr, linked_issue, creator \
         FROM worktrees WHERE id = ?1",
        [worktree_id],
        |r| {
            Ok(StoredWorktreeRow {
                id: r.get(0)?,
                project_id: r.get(1)?,
                workspace_id: r.get(2)?,
                path: r.get(3)?,
                branch: r.get(4)?,
                head: r.get(5)?,
                base_ref: r.get(6)?,
                title: r.get(7)?,
                note: r.get(8)?,
                parent_worktree_id: r.get(9)?,
                created_at: r.get(10)?,
                workspace_status: r.get(11)?,
                is_pinned: r.get(12)?,
                is_archived: r.get(13)?,
                sort_order: r.get(14)?,
                manual_order: r.get(15)?,
                last_activity_at: r.get(16)?,
                linked_pr: r.get(17)?,
                linked_issue: r.get(18)?,
                creator: r.get(19)?,
            })
        },
    )
    .optional()
    .map_err(error::from_sqlite)
}

/// Workspace Options metadata for a folder Project's implicit worktree,
/// stored on `projects` itself (no `worktrees` row exists for a folder
/// project -- see `apply_v5_workspace_options_columns`'s own doc for why).
struct FolderProjectMeta {
    workspace_status: Option<String>,
    is_pinned: bool,
    is_archived: bool,
    manual_order: Option<i64>,
    last_activity_at: Option<String>,
}

fn fetch_folder_project_meta(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<FolderProjectMeta, RpcError> {
    conn.query_row(
        "SELECT workspace_status, is_pinned, is_archived, manual_order, last_activity_at \
         FROM projects WHERE id = ?1",
        [project_id],
        |r| {
            Ok(FolderProjectMeta {
                workspace_status: r.get(0)?,
                is_pinned: r.get(1)?,
                is_archived: r.get(2)?,
                manual_order: r.get(3)?,
                last_activity_at: r.get(4)?,
            })
        },
    )
    .map_err(error::from_sqlite)
}

/// Renders a folder Project's synthesized implicit worktree, real
/// Workspace Options metadata included -- shared by
/// [`Engine::do_worktree_list`] and [`Engine::do_worktree_update`] (a
/// folder project's implicit worktree id, always `project.id`, has no
/// `worktrees` row to update, so `worktree.update` falls back to this same
/// rendering after writing to `projects` directly).
fn folder_implicit_worktree_json(
    conn: &rusqlite::Connection,
    project: &crate::project::ProjectInfo,
) -> Result<Value, RpcError> {
    let workspace_id: String = conn
        .query_row(
            "SELECT id FROM workspaces WHERE path = ?1",
            [&project.path],
            |r| r.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?
        .ok_or_else(|| error::internal_error("folder project's implicit workspace is missing"))?;
    let meta = fetch_folder_project_meta(conn, &project.id)?;
    Ok(worktree_json(WorktreeMetaRow {
        id: &project.id,
        project_id: &project.id,
        workspace_id: &workspace_id,
        path: &project.path,
        branch: "",
        head: "",
        base_ref: None,
        title: None,
        note: None,
        parent_worktree_id: None,
        created_at: &project.created_at,
        workspace_status: meta.workspace_status.as_deref(),
        is_pinned: meta.is_pinned,
        is_archived: meta.is_archived,
        sort_order: 0,
        manual_order: meta.manual_order,
        last_activity_at: meta.last_activity_at.as_deref(),
        linked_pr: None,
        linked_issue: None,
        creator: None,
    }))
}

/// `worktree.update` fallback for a folder Project's implicit worktree
/// (id == `project.id`, no `worktrees` row -- see
/// `folder_implicit_worktree_json`'s own doc). Only the four fields that
/// actually apply to a folder project (workspace status, pin, archive,
/// manual order) are honored, on `projects` directly; `note`/
/// `parentWorktreeId`/`linkedPr` have no folder-project equivalent
/// (structurally: no branch, and exactly one worktree with no sibling to
/// nest under or link a PR against), so an attempt to set one is refused
/// outright rather than silently accepted and dropped.
fn update_folder_project_meta(
    conn: &rusqlite::Connection,
    decoded: &drogon_protocol::worktree::WorktreeUpdateParams,
) -> Result<Value, RpcError> {
    if decoded.note.is_some() || decoded.parent_worktree_id.is_some() || decoded.linked_pr.is_some()
    {
        return Err(error::invalid_argument(
            "note, parentWorktreeId and linkedPr do not apply to a folder project's implicit worktree",
        ));
    }
    let project: crate::project::ProjectInfo = crate::project::get(conn, &decoded.worktree_id)?;
    if project.kind != "folder" {
        return Err(error::not_found("worktree not found"));
    }
    let mut mutated = false;
    if let Some(status) = &decoded.workspace_status {
        let trimmed = status.as_deref().map(str::trim).filter(|s| !s.is_empty());
        conn.execute(
            "UPDATE projects SET workspace_status = ?1 WHERE id = ?2",
            rusqlite::params![trimmed, project.id],
        )
        .map_err(error::from_sqlite)?;
        mutated = true;
    }
    if let Some(is_pinned) = decoded.is_pinned {
        conn.execute(
            "UPDATE projects SET is_pinned = ?1 WHERE id = ?2",
            rusqlite::params![is_pinned, project.id],
        )
        .map_err(error::from_sqlite)?;
        mutated = true;
    }
    if let Some(is_archived) = decoded.is_archived {
        conn.execute(
            "UPDATE projects SET is_archived = ?1 WHERE id = ?2",
            rusqlite::params![is_archived, project.id],
        )
        .map_err(error::from_sqlite)?;
        mutated = true;
    }
    if let Some(manual_order) = &decoded.manual_order {
        conn.execute(
            "UPDATE projects SET manual_order = ?1 WHERE id = ?2",
            rusqlite::params![manual_order, project.id],
        )
        .map_err(error::from_sqlite)?;
        mutated = true;
    }
    if mutated {
        conn.execute(
            "UPDATE projects SET last_activity_at = ?1 WHERE id = ?2",
            rusqlite::params![now_rfc3339(), project.id],
        )
        .map_err(error::from_sqlite)?;
    }
    folder_implicit_worktree_json(conn, &project)
}

impl Engine {
    pub(super) fn do_worktree_create(&self, params: &Value) -> Result<Value, RpcError> {
        let project_id = require_str(params, "projectId")?.to_string();
        let name = require_str(params, "name")?.to_string();
        let base_ref = params
            .get("baseRef")
            .map(|v| {
                v.as_str()
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .ok_or_else(|| error::invalid_argument("baseRef must be a non-empty string"))
            })
            .transpose()?;
        // The composer Advanced rows: an explicit branch name (the fork's
        // "Branch name" override — the worktree folder keeps `name`), a
        // free-text note, a sidebar-nesting parent, and sparse-checkout
        // directories.
        let branch_override = optional_trimmed_str(params, "branch")?;
        // The fork's "Reuse branch" checkbox (#5181): check out the existing
        // branch in the new worktree instead of creating a fresh branch from
        // it. The renderer gates eligibility (local branch, not checked out
        // elsewhere); the daemon still fails honestly when git refuses.
        let reuse_branch = optional_bool(params, "reuseBranch", false)?;
        let note = optional_trimmed_str(params, "note")?;
        let parent_worktree_id = optional_trimmed_str(params, "parentWorktreeId")?;
        let linked_issue: Option<i64> = match params.get("linkedIssue") {
            None | Some(Value::Null) => None,
            Some(value) => {
                let number = value.as_i64().filter(|n| *n > 0).ok_or_else(|| {
                    error::invalid_argument("linkedIssue must be a positive issue number")
                })?;
                Some(number)
            }
        };
        // Source `runHooks` contract: accepted as a legacy alias for setup
        // hooks; the native runtime has no orca.yaml hook engine, so the
        // run is honestly a no-op with a warning, never silent pretense.
        let run_hooks = optional_bool(params, "runHooks", false)?;
        let sparse = normalize_sparse_directories(params)?;
        // Creation provenance (Workspace Options "Hide: Automation-created"
        // / "CLI-created"): absent means the desktop app's own create path.
        // `drogon-cli worktree create` is the one caller that sets this
        // today; "automation" is accepted (closed set, not free text) but
        // has no producer yet -- automation-dispatched workspace creation
        // is unwired elsewhere in this build
        // (`bot_run_rpc::RunUnsupported::NewPerRunWorkspaceMode`).
        let creator = optional_trimmed_str(params, "creator")?;
        if let Some(value) = &creator
            && value != "cli"
            && value != "automation"
        {
            return Err(error::invalid_argument(
                "creator must be \"cli\" or \"automation\" when provided",
            ));
        }
        if reuse_branch && branch_override.is_none() {
            return Err(error::invalid_argument(
                "reuseBranch requires an explicit branch to check out",
            ));
        }
        if reuse_branch && base_ref.is_some() {
            return Err(error::invalid_argument(
                "reuseBranch checks out the branch itself; drop baseRef",
            ));
        }

        let project = {
            let conn = self.db.lock().unwrap();
            crate::project::get(&conn, &project_id)?
        };
        if project.kind != "git" {
            return Err(error::invalid_argument(
                "worktree.create requires a git project; a folder project has one implicit worktree",
            ));
        }
        if let Some(parent) = &parent_worktree_id {
            let conn = self.db.lock().unwrap();
            validate_parent_worktree(&conn, &project_id, parent)?;
        }

        let branch_name = branch_override.clone().unwrap_or_else(|| name.clone());
        if reuse_branch {
            // Reuse is a local-branch operation: a remote-tracking ref would
            // silently produce a detached worktree, and a typo would fail
            // later with git's own message.
            let local_ref = run_git(
                Path::new(&project.path),
                &[
                    "show-ref".to_string(),
                    "--verify".to_string(),
                    "--quiet".to_string(),
                    format!("refs/heads/{branch_name}"),
                ],
            );
            if local_ref.is_err() {
                return Err(error::invalid_argument(format!(
                    "branch '{branch_name}' is not a local branch; pick it from the Branch tab",
                )));
            }
        }
        // The fork validates an explicit override with git itself
        // (`resolveCreateBranchName`): a leading "-" is rejected outright
        // (option injection), then `git check-ref-format --branch` is the
        // authoritative validator so the composer surfaces git's own
        // message. NUL bytes were already refused when the field decoded.
        if branch_override.is_some() {
            if branch_name.starts_with('-') {
                return Err(error::invalid_argument(
                    "Branch name must not start with \"-\"",
                ));
            }
            run_git(
                Path::new(&project.path),
                &[
                    "check-ref-format".to_string(),
                    "--branch".to_string(),
                    branch_name.clone(),
                ],
            )?;
        }
        git_worktree::validate_worktree_add(&project.path, &name, Some(&branch_name))?;

        let workspaces_root = self
            .data_dir
            .join("workspaces")
            .join(sanitize_path_component(&project.name));
        std::fs::create_dir_all(&workspaces_root)
            .map_err(|e| error::io_error(format!("cannot create workspaces directory: {e}")))?;
        let target = workspaces_root.join(&name);
        if target.exists() {
            return Err(error::invalid_argument(
                "a worktree with this name already exists",
            ));
        }
        let target_str = target
            .to_str()
            .ok_or_else(|| error::invalid_argument("resolved worktree path is not UTF-8"))?
            .to_string();

        let mut argv = vec!["worktree".to_string(), "add".to_string()];
        // Sparse checkouts add with --no-checkout, then materialize only the
        // picked directories (the fork's addSparseWorktree flow).
        if !sparse.is_empty() {
            argv.push("--no-checkout".to_string());
        }
        argv.push(target_str.clone());
        if reuse_branch {
            // Reuse: check out the existing branch (never `-b`, never a base
            // ref — the branch itself is the start point).
            argv.push(branch_name.clone());
        } else {
            argv.push("-b".to_string());
            argv.push(branch_name.clone());
            if let Some(base) = &base_ref {
                argv.push(base.clone());
            }
        }
        let failure = run_git(Path::new(&project.path), &argv).err();
        if let Some(failure) = failure {
            let mapped = if reuse_branch {
                map_branch_in_use_error(failure, &branch_name)
            } else {
                map_existing_branch_error(failure, &name)
            };
            return Err(mapped);
        }
        if !sparse.is_empty() {
            let target_path = Path::new(&target_str);
            let sparse_result = (|| {
                run_git(
                    target_path,
                    &[
                        "sparse-checkout".to_string(),
                        "init".to_string(),
                        "--cone".to_string(),
                    ],
                )?;
                let mut set_argv = vec![
                    "sparse-checkout".to_string(),
                    "set".to_string(),
                    "--".to_string(),
                ];
                set_argv.extend(sparse.iter().cloned());
                run_git(target_path, &set_argv)?;
                run_git(target_path, &["checkout".to_string(), branch_name.clone()])?;
                Ok::<(), RpcError>(())
            })();
            if let Err(err) = sparse_result {
                // Failed-creation rollback (the fork's addSparseWorktree
                // cleanup): the fresh branch has no user commits, so the
                // worktree and branch are force-removed rather than left half
                // created.
                let removed = run_git(
                    Path::new(&project.path),
                    &[
                        "worktree".to_string(),
                        "remove".to_string(),
                        "--force".to_string(),
                        target_str.clone(),
                    ],
                );
                let branch_deleted = run_git(
                    Path::new(&project.path),
                    &["branch".to_string(), "-D".to_string(), branch_name.clone()],
                );
                if removed.is_err() || branch_deleted.is_err() {
                    return Err(error::io_error(format!(
                        "{} (cleanup also failed — the partially created worktree at \"{}\" may need manual removal)",
                        err.message, target_str
                    )));
                }
                return Err(err);
            }
        }

        let canonical_target = std::fs::canonicalize(&target).map_err(|e| {
            error::io_error(format!(
                "worktree created but its path could not be resolved: {e}"
            ))
        })?;
        let canonical_target_str = canonical_target
            .to_str()
            .ok_or_else(|| error::invalid_argument("resolved worktree path is not UTF-8"))?
            .to_string();
        let head = run_git(
            &canonical_target,
            &["rev-parse".to_string(), "HEAD".to_string()],
        )?
        .trim()
        .to_string();

        let conn = self.db.lock().unwrap();
        let workspace =
            crate::workspace::register(&conn, &self.host_id, &canonical_target_str, Some(&name))?;
        let workspace_id = workspace["id"]
            .as_str()
            .ok_or_else(|| error::internal_error("workspace registration missing id"))?
            .to_string();

        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_rfc3339();
        // Monotonic creation-order stamp, scoped to the owning project (the
        // only scope Sort by "Manual"'s tiebreak ever needs): one past the
        // highest `sort_order` this project has assigned so far, real
        // insertion order rather than a fake constant.
        let sort_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM worktrees WHERE project_id = ?1",
                [&project_id],
                |r| r.get(0),
            )
            .map_err(error::from_sqlite)?;
        conn.execute(
            "INSERT INTO worktrees (id, project_id, workspace_id, path, branch, head, base_ref, note, parent_worktree_id, created_at, sort_order, last_activity_at, creator, linked_issue) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            rusqlite::params![id, project_id, workspace_id, canonical_target_str, branch_name, head, base_ref, note, parent_worktree_id, created_at, sort_order, created_at, creator, linked_issue],
        )
        .map_err(error::from_sqlite)?;

        Ok(worktree_json(WorktreeMetaRow {
            id: &id,
            project_id: &project_id,
            workspace_id: &workspace_id,
            path: &canonical_target_str,
            branch: &branch_name,
            head: &head,
            base_ref: base_ref.as_deref(),
            title: None,
            note: note.as_deref(),
            parent_worktree_id: parent_worktree_id.as_deref(),
            created_at: &created_at,
            workspace_status: None,
            is_pinned: false,
            is_archived: false,
            sort_order,
            manual_order: None,
            last_activity_at: Some(&created_at),
            linked_pr: None,
            linked_issue,
            creator: creator.as_deref(),
        }))
        .map(|mut created| {
            // Source `runHooks` contract: accepted as a legacy alias for
            // setup hooks; the native runtime has no orca.yaml hook
            // engine, so the run is honestly a no-op with a warning.
            if run_hooks {
                created["warning"] =
                    json!("run-hooks is a no-op: this runtime has no orca.yaml hook engine");
            }
            created
        })
    }

    /// The fork's smart-name-field branch source (`repo-base-ref-search`):
    /// local heads plus remote refs, most recently committed first, with the
    /// symbolic `<remote>/HEAD` entries dropped. Rows carry the fork's
    /// `BaseRefSearchResult` shape — `refName` (the short ref to start from)
    /// and `localBranchName` (the local branch a reuse/create would name).
    pub(super) fn do_worktree_branch_search(&self, params: &Value) -> Result<Value, RpcError> {
        let project_id = require_str(params, "projectId")?.to_string();
        let query = optional_trimmed_str(params, "query")?
            .map(|value| value.to_lowercase())
            .unwrap_or_default();
        let limit = match params.get("limit") {
            None => BRANCH_SEARCH_DEFAULT_LIMIT,
            Some(value) => value
                .as_u64()
                .ok_or_else(|| error::invalid_argument("limit must be a positive integer"))?
                .clamp(1, BRANCH_SEARCH_MAX_LIMIT as u64) as usize,
        };
        let conn = self.db.lock().unwrap();
        let project = crate::project::get(&conn, &project_id)?;
        drop(conn);
        if project.kind != "git" {
            return Err(error::invalid_argument(
                "worktree.branch_search requires a git project",
            ));
        }
        let stdout = run_git(
            Path::new(&project.path),
            &[
                "for-each-ref".to_string(),
                "--format=%(refname)%00%(refname:short)%00%(committerdate:unix)".to_string(),
                "--sort=-committerdate".to_string(),
                "refs/heads".to_string(),
                "refs/remotes".to_string(),
            ],
        )?;
        let query = query.trim().to_lowercase();
        let mut branches = Vec::new();
        for line in stdout.lines() {
            let mut parts = line.split('\0');
            let (Some(full), Some(short)) = (parts.next(), parts.next()) else {
                continue;
            };
            // A symbolic `<remote>/HEAD` slot is a pointer, not a branch.
            if let Some(remote_branch) = full.strip_prefix("refs/remotes/")
                && remote_branch.ends_with("/HEAD")
            {
                continue;
            }
            let ref_name = short.to_string();
            let local_branch_name = short_branch_local_name(full, short);
            // Substring match over the short ref, mirroring the fork's
            // token globs (`*query*` plus segment matches) closely enough
            // that the composer's rows agree; the scan itself stays bounded
            // by the repo's ref count.
            if !query.is_empty()
                && !ref_name.to_lowercase().contains(&query)
                && !local_branch_name.to_lowercase().contains(&query)
            {
                continue;
            }
            branches.push(json!({
                "refName": ref_name,
                "localBranchName": local_branch_name,
            }));
            if branches.len() >= limit {
                break;
            }
        }
        Ok(json!({ "branches": branches }))
    }

    pub(super) fn do_worktree_list(&self, params: &Value) -> Result<Value, RpcError> {
        let project_id = require_str(params, "projectId")?.to_string();
        let conn = self.db.lock().unwrap();
        let project = crate::project::get(&conn, &project_id)?;

        if project.kind == "folder" {
            return Ok(json!({ "worktrees": [folder_implicit_worktree_json(&conn, &project)?] }));
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at, \
                 workspace_status, is_pinned, is_archived, sort_order, manual_order, last_activity_at, linked_pr, linked_issue, creator \
                 FROM worktrees WHERE project_id = ?1 ORDER BY created_at",
            )
            .map_err(error::from_sqlite)?;
        struct Row {
            id: String,
            workspace_id: String,
            path: String,
            branch: String,
            head: String,
            base_ref: Option<String>,
            title: Option<String>,
            note: Option<String>,
            parent_worktree_id: Option<String>,
            created_at: String,
            workspace_status: Option<String>,
            is_pinned: bool,
            is_archived: bool,
            sort_order: i64,
            manual_order: Option<i64>,
            last_activity_at: Option<String>,
            linked_pr: Option<i64>,
            linked_issue: Option<i64>,
            creator: Option<String>,
        }
        let rows: Vec<Row> = stmt
            .query_map([&project_id], |r| {
                Ok(Row {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    path: r.get(2)?,
                    branch: r.get(3)?,
                    head: r.get(4)?,
                    base_ref: r.get(5)?,
                    title: r.get(6)?,
                    note: r.get(7)?,
                    parent_worktree_id: r.get(8)?,
                    created_at: r.get(9)?,
                    workspace_status: r.get(10)?,
                    is_pinned: r.get(11)?,
                    is_archived: r.get(12)?,
                    sort_order: r.get(13)?,
                    manual_order: r.get(14)?,
                    last_activity_at: r.get(15)?,
                    linked_pr: r.get(16)?,
                    linked_issue: r.get(17)?,
                    creator: r.get(18)?,
                })
            })
            .map_err(error::from_sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error::from_sqlite)?;
        drop(stmt);
        drop(conn);

        // Reconciliation against the live checkout is best-effort: a
        // transient git failure must not make the DB-backed list
        // unavailable, it only forgoes the live head/branch refresh.
        let cache = CapabilityCache::new();
        let live_map: HashMap<String, (Option<String>, Option<String>)> =
            match git_process::run_read_only_git(
                ReadOnlyGitOperation::WorktreeList,
                Path::new(&project.path),
                &HostScope::Native,
                &cache,
                budget(),
            ) {
                Ok(ParsedGitOutput::WorktreeList(entries)) => entries
                    .into_iter()
                    .map(|e| (canonical_or_raw(&e.path), (e.head, e.branch)))
                    .collect(),
                Ok(ParsedGitOutput::Status(_)) | Err(_) => HashMap::new(),
            };

        let worktrees: Vec<Value> = rows
            .into_iter()
            .map(|row| {
                let live = live_map.get(&canonical_or_raw(&row.path));
                let head = live.and_then(|(h, _)| h.clone()).unwrap_or(row.head);
                let branch = live
                    .and_then(|(_, b)| b.clone())
                    .map(|b| short_branch(&b))
                    .unwrap_or(row.branch);
                worktree_json(WorktreeMetaRow {
                    id: &row.id,
                    project_id: &project_id,
                    workspace_id: &row.workspace_id,
                    path: &row.path,
                    branch: &branch,
                    head: &head,
                    base_ref: row.base_ref.as_deref(),
                    title: row.title.as_deref(),
                    note: row.note.as_deref(),
                    parent_worktree_id: row.parent_worktree_id.as_deref(),
                    created_at: &row.created_at,
                    workspace_status: row.workspace_status.as_deref(),
                    is_pinned: row.is_pinned,
                    is_archived: row.is_archived,
                    sort_order: row.sort_order,
                    manual_order: row.manual_order,
                    last_activity_at: row.last_activity_at.as_deref(),
                    linked_pr: row.linked_pr,
                    linked_issue: row.linked_issue,
                    creator: row.creator.as_deref(),
                })
            })
            .collect();

        Ok(json!({ "worktrees": worktrees }))
    }

    /// `worktree.get { id }`: one worktree row by id. The folder-project
    /// implicit worktree is addressable by the project id, matching
    /// `worktree.list`'s synthetic row.
    pub(super) fn do_worktree_get(&self, params: &Value) -> Result<Value, RpcError> {
        let id = require_str(params, "id")?.to_string();
        let conn = self.db.lock().unwrap();
        if let Some(project) = crate::project::get(&conn, &id).ok()
            && project.kind == "folder"
        {
            let worktree = folder_implicit_worktree_json(&conn, &project)?;
            return Ok(json!({ "worktree": worktree }));
        }
        let worktree = fetch_worktree_row(&conn, &id)?
            .ok_or_else(|| error::not_found("worktree not found"))?;
        Ok(json!({ "worktree": worktree.as_json() }))
    }

    /// `worktree.current { path }`: resolve a shell cwd to the enclosing
    /// Orca-managed worktree by longest canonical path-prefix match across
    /// worktree rows and folder projects. No guesses: nothing enclosing the
    /// path is a typed `not_found`, never a nearest/first worktree.
    pub(super) fn do_worktree_current(&self, params: &Value) -> Result<Value, RpcError> {
        let path = require_str(params, "path")?;
        let cwd = canonical_or_raw(path);
        let conn = self.db.lock().unwrap();
        let mut candidates: Vec<Value> = Vec::new();
        {
            let mut stmt = conn
                .prepare("SELECT id FROM worktrees")
                .map_err(error::from_sqlite)?;
            let rows = stmt
                .query_map([], |r| {
                    let id: String = r.get(0)?;
                    Ok(id)
                })
                .map_err(error::from_sqlite)?;
            for row in rows {
                let id = row.map_err(error::from_sqlite)?;
                let Some(stored) = fetch_worktree_row(&conn, &id)? else {
                    return Err(error::internal_error(
                        "worktree row vanished during listing",
                    ));
                };
                candidates.push(stored.as_json());
            }
        }
        {
            let mut stmt = conn
                .prepare("SELECT id, path, created_at FROM projects WHERE kind = 'folder'")
                .map_err(error::from_sqlite)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(error::from_sqlite)?;
            for row in rows {
                let (id, path, _created_at) = row.map_err(error::from_sqlite)?;
                let workspace_id: Option<String> = conn
                    .query_row("SELECT id FROM workspaces WHERE path = ?1", [&path], |r| {
                        r.get(0)
                    })
                    .optional()
                    .map_err(error::from_sqlite)?;
                if workspace_id.is_some()
                    && let Some(project) = crate::project::get(&conn, &id).ok()
                    && project.kind == "folder"
                {
                    candidates.push(folder_implicit_worktree_json(&conn, &project)?);
                }
            }
        }
        let mut best: Option<Value> = None;
        for candidate in candidates {
            let candidate_path = canonical_or_raw(candidate["path"].as_str().unwrap_or(""));
            let encloses = cwd == candidate_path
                || (cwd.len() > candidate_path.len()
                    && cwd.starts_with(&candidate_path)
                    && cwd.as_bytes()[candidate_path.len()] == b'/');
            if !encloses {
                continue;
            }
            let is_longer = match &best {
                Some(current) => {
                    candidate_path.len()
                        > canonical_or_raw(current["path"].as_str().unwrap_or("")).len()
                }
                None => true,
            };
            if is_longer {
                best = Some(candidate);
            }
        }
        let worktree = best.ok_or_else(|| {
            error::not_found("no Orca-managed worktree encloses the current directory")
        })?;
        Ok(json!({ "worktree": worktree }))
    }

    /// `worktree.ps { limit? }`: compact cross-worktree summary (source
    /// `worktree ps`). Each entry carries the worktree identity plus the
    /// honest live-session count for its workspace; no sidebar/activity
    /// concepts are invented. `limit` caps entries after ordering by
    /// creation; `totalCount`/`truncated` report the pre-cap inventory.
    pub(super) fn do_worktree_ps(&self, params: &Value) -> Result<Value, RpcError> {
        let limit: Option<u64> = params
            .get("limit")
            .map(|value| {
                value
                    .as_u64()
                    .filter(|n| *n >= 1)
                    .ok_or_else(|| error::invalid_argument("limit must be a positive integer"))
            })
            .transpose()?;
        let conn = self.db.lock().unwrap();
        let mut entries: Vec<Value> = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT w.id, w.project_id, w.workspace_id, w.path, w.branch, w.title, w.created_at, w.parent_worktree_id,
                            (SELECT COUNT(*) FROM sessions s WHERE s.workspace_id = w.workspace_id AND s.verdict = 'live') AS live_sessions
                     FROM worktrees w ORDER BY w.created_at",
                )
                .map_err(error::from_sqlite)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(json!({
                        "worktreeId": r.get::<_, String>(0)?,
                        "projectId": r.get::<_, String>(1)?,
                        "workspaceId": r.get::<_, String>(2)?,
                        "path": r.get::<_, String>(3)?,
                        "branch": r.get::<_, String>(4)?,
                        "displayName": r.get::<_, Option<String>>(5)?,
                        "createdAt": r.get::<_, String>(6)?,
                        "parentWorktreeId": r.get::<_, Option<String>>(7)?,
                        "liveSessions": r.get::<_, i64>(8)?,
                    }))
                })
                .map_err(error::from_sqlite)?;
            for row in rows {
                entries.push(row.map_err(error::from_sqlite)?);
            }
        }
        // Folder projects contribute their implicit worktree row, matching
        // worktree.list's synthetic row.
        {
            let mut stmt = conn
                .prepare("SELECT id, path, created_at FROM projects WHERE kind = 'folder'")
                .map_err(error::from_sqlite)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })
                .map_err(error::from_sqlite)?;
            for row in rows {
                let (id, path, created_at) = row.map_err(error::from_sqlite)?;
                let workspace: Option<(String, i64)> = conn
                    .query_row(
                        "SELECT id, (SELECT COUNT(*) FROM sessions s WHERE s.workspace_id = workspaces.id AND s.verdict = 'live') FROM workspaces WHERE path = ?1",
                        [&path],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .optional()
                    .map_err(error::from_sqlite)?;
                if let Some((workspace_id, live_sessions)) = workspace {
                    entries.push(json!({
                        "worktreeId": id,
                        "projectId": id,
                        "workspaceId": workspace_id,
                        "path": path,
                        "branch": "",
                        "displayName": Value::Null,
                        "createdAt": created_at,
                        "parentWorktreeId": Value::Null,
                        "liveSessions": live_sessions,
                    }));
                }
            }
        }
        entries.sort_by(|a, b| {
            a["createdAt"]
                .as_str()
                .cmp(&b["createdAt"].as_str())
                .then_with(|| a["worktreeId"].as_str().cmp(&b["worktreeId"].as_str()))
        });
        let total = entries.len() as u64;
        let truncated = limit.is_some_and(|cap| total > cap);
        let entries = match limit {
            Some(cap) => entries
                .into_iter()
                .take(cap.min(usize::MAX as u64) as usize)
                .collect::<Vec<_>>(),
            None => entries,
        };
        Ok(json!({
            "worktrees": entries,
            "totalCount": total,
            "truncated": truncated,
        }))
    }

    pub(super) fn do_worktree_remove(&self, params: &Value) -> Result<Value, RpcError> {
        let id = require_str(params, "id")?.to_string();
        let force = optional_bool(params, "force", false)?;
        // Source `worktree rm --delete-branch`: after the checkout is gone,
        // drop the now-orphaned branch with the *safe* `git branch -d`
        // (never `-D`): branches carrying unmerged commits survive
        // (worktree-remove-branch-deletion.test.ts).
        let delete_branch = optional_bool(params, "deleteBranch", false)?;
        // Source contract: `runHooks` is a legacy alias for running the
        // repo's archive hooks. The native runtime has no orca.yaml hook
        // engine, so the run itself is honestly a no-op — but the reply
        // carries the warning so callers never assume hooks ran.
        let run_hooks = optional_bool(params, "runHooks", false)?;

        let (project_path, worktree_path, workspace_id, branch) = {
            let conn = self.db.lock().unwrap();
            conn.query_row(
                "SELECT p.path, w.path, w.workspace_id, w.branch FROM worktrees w JOIN projects p ON p.id = w.project_id WHERE w.id = ?1",
                [&id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(error::from_sqlite)?
            .ok_or_else(|| error::not_found("worktree not found"))?
        };

        let mut argv = vec!["worktree".to_string(), "remove".to_string()];
        if force {
            argv.push("--force".to_string());
        }
        argv.push(worktree_path);
        // Git itself refuses a dirty worktree without --force; this call
        // never re-implements that check.
        run_git(Path::new(&project_path), &argv)?;

        let mut branch_deleted = false;
        if delete_branch && !branch.is_empty() {
            // Best-effort safe delete: a refusal (unmerged work) leaves the
            // branch and is not a removal failure — the worktree is already
            // gone, which is what the caller asked for first.
            let output = std::process::Command::new("git")
                .args(["-C", &project_path, "branch", "-d", &branch])
                .output();
            branch_deleted = output.map(|o| o.status.success()).unwrap_or(false);
        }

        let conn = self.db.lock().unwrap();
        conn.execute("DELETE FROM worktrees WHERE id = ?1", [&id])
            .map_err(error::from_sqlite)?;
        conn.execute("DELETE FROM workspaces WHERE id = ?1", [&workspace_id])
            .map_err(error::from_sqlite)?;
        let mut reply =
            json!({ "id": id, "removed": true, "branchDeleted": branch_deleted, "branch": branch });
        if run_hooks {
            reply["warning"] =
                json!("run-hooks is a no-op: this runtime has no orca.yaml hook engine");
        }
        Ok(reply)
    }

    /// Display-title rename (`worktree.rename { worktreeId, name }`).
    /// Renames exactly what Orca's inline rename renames: the card's
    /// display title stored on the worktree row. The git branch and the
    /// worktree directory are untouched — verify by comparing `branch`
    /// and `path` before and after.
    pub(super) fn do_worktree_rename(&self, params: &Value) -> Result<Value, RpcError> {
        let decoded: drogon_protocol::worktree::WorktreeRenameParams =
            serde_json::from_value(params.clone())
                .map_err(|_| error::invalid_argument("Invalid worktree.rename parameters"))?;
        decoded.validate_name()?;
        let name = decoded.name.trim().to_string();

        let conn = self.db.lock().unwrap();
        // A rename is a real, user-visible mutation -- bump last_activity_at
        // the same as note/status/pin/archive changes below, so Sort by
        // "Recent" and Hide "Sleeping" see it.
        let changed = conn
            .execute(
                "UPDATE worktrees SET title = ?1, last_activity_at = ?2 WHERE id = ?3",
                rusqlite::params![name, now_rfc3339(), decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
        if changed == 0 {
            return Err(error::not_found("worktree not found"));
        }
        Ok(fetch_worktree_row(&conn, &decoded.worktree_id)?
            .map(|row| row.as_json())
            .unwrap_or(Value::Null))
    }

    /// Worktree-meta update (`worktree.update`): the note (the composer's
    /// Advanced Note row), the sidebar-nesting parent, and the Workspace
    /// Options fields (workspace status, pin, archive, manual sort rank,
    /// linked PR number). The nullable fields are tri-state — absent
    /// leaves the column untouched, explicit null clears it; `isPinned`/
    /// `isArchived` are plain optional bools (no meaningful "clear"). The
    /// parent is nesting only: it never changes the base branch, matching
    /// the fork's picker copy.
    pub(super) fn do_worktree_update(&self, params: &Value) -> Result<Value, RpcError> {
        let decoded: drogon_protocol::worktree::WorktreeUpdateParams =
            serde_json::from_value(params.clone())
                .map_err(|_| error::invalid_argument("Invalid worktree.update parameters"))?;
        if let Some(Some(note)) = &decoded.note
            && note.len() > 64 * 1024
        {
            return Err(error::invalid_argument("note is too long"));
        }
        let conn = self.db.lock().unwrap();
        let project_id: Option<String> = conn
            .query_row(
                "SELECT project_id FROM worktrees WHERE id = ?1",
                [&decoded.worktree_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error::from_sqlite)?;
        let Some(project_id) = project_id else {
            // No `worktrees` row: this may be a folder project's own
            // implicit-worktree id (`project.id`, no sibling row to find --
            // see `folder_implicit_worktree_json`'s own doc). Genuinely
            // unknown ids fall through to the same `not_found` either way.
            return update_folder_project_meta(&conn, &decoded);
        };
        let mut mutated = false;
        if let Some(parent) = &decoded.parent_worktree_id {
            if let Some(parent_id) = parent {
                validate_parent_update(&conn, &decoded.worktree_id, &project_id, parent_id)?;
            }
            conn.execute(
                "UPDATE worktrees SET parent_worktree_id = ?1 WHERE id = ?2",
                rusqlite::params![parent, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(note) = &decoded.note {
            let trimmed = note.as_deref().map(str::trim).filter(|s| !s.is_empty());
            conn.execute(
                "UPDATE worktrees SET note = ?1 WHERE id = ?2",
                rusqlite::params![trimmed, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(status) = &decoded.workspace_status {
            let trimmed = status.as_deref().map(str::trim).filter(|s| !s.is_empty());
            conn.execute(
                "UPDATE worktrees SET workspace_status = ?1 WHERE id = ?2",
                rusqlite::params![trimmed, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(is_pinned) = decoded.is_pinned {
            conn.execute(
                "UPDATE worktrees SET is_pinned = ?1 WHERE id = ?2",
                rusqlite::params![is_pinned, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(is_archived) = decoded.is_archived {
            conn.execute(
                "UPDATE worktrees SET is_archived = ?1 WHERE id = ?2",
                rusqlite::params![is_archived, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(manual_order) = &decoded.manual_order {
            conn.execute(
                "UPDATE worktrees SET manual_order = ?1 WHERE id = ?2",
                rusqlite::params![manual_order, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(linked_pr) = &decoded.linked_pr {
            conn.execute(
                "UPDATE worktrees SET linked_pr = ?1 WHERE id = ?2",
                rusqlite::params![linked_pr, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(title) = &decoded.title {
            let trimmed = title.as_deref().map(str::trim).filter(|s| !s.is_empty());
            conn.execute(
                "UPDATE worktrees SET title = ?1 WHERE id = ?2",
                rusqlite::params![trimmed, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if let Some(linked_issue) = &decoded.linked_issue {
            if let Some(number) = linked_issue
                && *number <= 0
            {
                return Err(error::invalid_argument(
                    "linkedIssue must be a positive issue number",
                ));
            }
            conn.execute(
                "UPDATE worktrees SET linked_issue = ?1 WHERE id = ?2",
                rusqlite::params![linked_issue, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
            mutated = true;
        }
        if mutated {
            conn.execute(
                "UPDATE worktrees SET last_activity_at = ?1 WHERE id = ?2",
                rusqlite::params![now_rfc3339(), decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
        }
        Ok(fetch_worktree_row(&conn, &decoded.worktree_id)?
            .map(|row| row.as_json())
            .unwrap_or(Value::Null))
    }
}

impl Engine {
    /// `repo.search_refs { projectId, query, limit? }`: substring ref
    /// search over a git project's branches, remotes, and tags. The page
    /// defaults to 25 (the source `REPO_SEARCH_REFS_DEFAULT_LIMIT`) and
    /// caps at 1000; `truncated` is set whenever more refs matched than
    /// the page carried.
    pub(super) fn do_repo_search_refs(&self, params: &Value) -> Result<Value, RpcError> {
        const DEFAULT_LIMIT: usize = 25;
        const MAX_LIMIT: usize = 1_000;
        let project_id = require_str(params, "projectId")?.to_string();
        let query = require_str(params, "query")?.trim().to_string();
        let limit = match params.get("limit") {
            None | Some(Value::Null) => DEFAULT_LIMIT,
            Some(value) => {
                let requested = value
                    .as_u64()
                    .filter(|n| *n > 0)
                    .ok_or_else(|| error::invalid_argument("limit must be a positive integer"))?;
                usize::try_from(requested)
                    .map_err(|_| error::invalid_argument("limit is out of range"))?
                    .min(MAX_LIMIT)
            }
        };

        let project_path = {
            let conn = self.db.lock().unwrap();
            crate::project::get(&conn, &project_id)?.path
        };
        let output = run_git(
            Path::new(&project_path),
            &[
                "for-each-ref".to_string(),
                "--format=%(refname:short)".to_string(),
                "refs/heads".to_string(),
                "refs/remotes".to_string(),
                "refs/tags".to_string(),
            ],
        )?;
        let query_lower = query.to_lowercase();
        let matched: Vec<String> = output
            .lines()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .filter(|r| r.to_lowercase().contains(&query_lower))
            .map(str::to_string)
            .collect();
        let truncated = matched.len() > limit;
        let refs: Vec<String> = matched.into_iter().take(limit).collect();
        Ok(json!({ "refs": refs, "truncated": truncated }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_path_separators_and_traversal_names() {
        assert_eq!(sanitize_path_component("my-repo"), "my-repo");
        assert_eq!(sanitize_path_component("a/b\\c"), "a_b_c");
        assert_eq!(sanitize_path_component(".."), "project");
        assert_eq!(sanitize_path_component(""), "project");
    }

    #[test]
    fn short_branch_strips_the_refs_heads_prefix_only_when_present() {
        assert_eq!(short_branch("refs/heads/feature"), "feature");
        assert_eq!(short_branch("feature"), "feature");
    }
}
