//! Worktree RPCs (journey J1): each Worktree of
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
        SpawnOutcome::Exited {
            status: _, stderr, ..
        } if git_process::is_missing_git_tool(&stderr) => Err(git_process::git_unavailable()),
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

/// Whether `project_path`'s git still has an admin entry for a working tree
/// at `worktree_path`, including a prunable one whose directory has already
/// vanished. `None` means the probe itself could not answer -- no usable
/// `git`, an unreadable repository -- and nothing may be concluded from it.
fn git_registers_worktree(project_path: &Path, worktree_path: &str) -> Option<bool> {
    let cache = CapabilityCache::new();
    let entries = match git_process::run_read_only_git(
        ReadOnlyGitOperation::WorktreeList,
        project_path,
        &HostScope::Native,
        &cache,
        budget(),
    ) {
        Ok(ParsedGitOutput::WorktreeList(entries)) => entries,
        Ok(ParsedGitOutput::Status(_)) | Err(_) => return None,
    };
    let wanted = canonical_or_raw(worktree_path);
    Some(
        entries
            .into_iter()
            .any(|entry| canonical_or_raw(&entry.path) == wanted),
    )
}

/// What the engine may still do after `git worktree remove` has refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RemoveRecovery {
    /// Hand git's own verdict back unchanged.
    ReportGitFailure,
    /// Refuse, but name the Force path -- git's fatal does not.
    OfferForce,
    /// Delete the checkout here and retire whatever git still holds.
    DeleteCheckoutDirectory,
}

/// The whole of #604 in one decision.
///
/// `still_registered` is `git_registers_worktree`'s answer, and a probe that
/// could not answer (`None`) is the one case that forbids everything: a run
/// of `git` that never reached a verdict -- no git on PATH, a timeout, a
/// killed capture -- proves nothing about the checkout, so deleting a user's
/// directory on the strength of it would be a guess. A probe that *did*
/// answer also proves git is present and the repository readable, which is
/// what makes the accompanying failure a real refusal rather than a broken
/// environment.
///
/// Given a real refusal, `force` is the desktop dialog's Force checkbox and
/// the CLI's `--force`, and it has to mean every removal the user ticking it
/// has already accepted. That is strictly more than `git worktree remove
/// --force` covers: git demands `-f -f` for a locked working tree, and for a
/// working tree it no longer registers it has no entry to remove at all and
/// dies "is not a working tree" however many flags follow. Deleting the
/// checkout is the only thing left that can retire such a row, so force does
/// it. Unforced, an unregistered row gets copy that names Force, because
/// git's fatal tells the user nothing they can act on.
fn recovery_after_failed_git_remove(force: bool, still_registered: Option<bool>) -> RemoveRecovery {
    match (force, still_registered) {
        (_, None) => RemoveRecovery::ReportGitFailure,
        (true, Some(_)) => RemoveRecovery::DeleteCheckoutDirectory,
        // git's refusal already reads "use --force to delete it"; repeating
        // it is better than paraphrasing it.
        (false, Some(true)) => RemoveRecovery::ReportGitFailure,
        (false, Some(false)) => RemoveRecovery::OfferForce,
    }
}

/// Deletes a checkout directory git would not delete itself. Guarded rather
/// than a bare `remove_dir_all`: this is the only place the engine removes a
/// user directory git is not mediating, so the target must be an absolute
/// path that is neither the project checkout nor one of its ancestors -- the
/// guard that keeps a forced delete off the primary worktree, which git
/// refuses with "is a main working tree". A path that is already gone is a
/// success; the caller's next step is dropping the rows either way.
fn delete_checkout_directory(project_path: &Path, worktree_path: &Path) -> Result<(), RpcError> {
    if !worktree_path.is_absolute() {
        return Err(error::invalid_argument(format!(
            "refusing to delete \"{}\": the recorded workspace path is not absolute",
            worktree_path.display()
        )));
    }
    // The parent is resolved but the final component deliberately is not: a
    // symlinked workspace has to be unlinked, never followed, or the guards
    // below would clear a directory belonging to whatever the link points at.
    let (Some(parent), Some(name)) = (worktree_path.parent(), worktree_path.file_name()) else {
        return Err(error::invalid_argument(format!(
            "refusing to delete \"{}\": it names no directory under a parent",
            worktree_path.display()
        )));
    };
    let target = std::fs::canonicalize(parent)
        .unwrap_or_else(|_| parent.to_path_buf())
        .join(name);
    let project =
        std::fs::canonicalize(project_path).unwrap_or_else(|_| project_path.to_path_buf());
    if project == target || project.starts_with(&target) {
        return Err(error::invalid_argument(format!(
            "refusing to delete \"{}\": it is the project checkout or contains it",
            target.display()
        )));
    }
    let metadata = match std::fs::symlink_metadata(&target) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(error::io_error(format!(
                "could not inspect \"{}\": {err}",
                target.display()
            )));
        }
    };
    let deleted = if metadata.is_dir() {
        std::fs::remove_dir_all(&target)
    } else {
        std::fs::remove_file(&target)
    };
    match deleted {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(error::io_error(format!(
            "could not delete \"{}\": {err}",
            target.display()
        ))),
    }
}

/// argv for one `git worktree remove`. A forced removal passes `--force`
/// twice, not once: git refuses a *locked* working tree under a single flag
/// and answers "use 'remove -f -f' to override or unlock first", so the one
/// flag Drogon used to send left the Force checkbox unable to delete exactly
/// the workspaces it exists for (#604).
fn git_worktree_remove_argv(worktree_path: &str, force: bool) -> Vec<String> {
    let mut argv = vec!["worktree".to_string(), "remove".to_string()];
    if force {
        argv.push("--force".to_string());
        argv.push("--force".to_string());
    }
    argv.push(worktree_path.to_string());
    argv
}

/// Removes the checkout behind one workspace row, returning once nothing is
/// left for the caller to do but drop the rows. See
/// `recovery_after_failed_git_remove` for what `force` has to mean here.
fn remove_worktree_checkout(
    project_path: &Path,
    worktree_path: &str,
    force: bool,
) -> Result<(), RpcError> {
    let argv = git_worktree_remove_argv(worktree_path, force);
    // Git itself refuses a dirty worktree without --force; this call
    // never re-implements that check.
    let failure = match run_git(project_path, &argv) {
        Ok(_) => return Ok(()),
        Err(failure) => failure,
    };

    match recovery_after_failed_git_remove(
        force,
        git_registers_worktree(project_path, worktree_path),
    ) {
        RemoveRecovery::ReportGitFailure => Err(failure),
        RemoveRecovery::OfferForce => Err(error::io_error(format!(
            "git no longer registers a working tree at \"{worktree_path}\", so it cannot remove it. Use Force to delete the leftover directory and clear this workspace."
        ))),
        RemoveRecovery::DeleteCheckoutDirectory => {
            delete_checkout_directory(project_path, Path::new(worktree_path))?;
            // The directory is gone, but git may still hold the admin entry
            // that made `remove` refuse, and the name stays taken until that
            // entry goes. Retrying the same scoped remove retires exactly
            // this worktree's entry, now that what it objected to is no
            // longer there. `git worktree prune` would do it too -- and would
            // also deregister every *other* worktree whose directory merely
            // happens to be away right now (an unmounted volume, a detached
            // drive), which deleting this workspace has no business doing.
            let _ = run_git(project_path, &git_worktree_remove_argv(worktree_path, true));
            Ok(())
        }
    }
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
            creator: self.creator.as_deref(),
        })
    }
}

fn fetch_worktree_row(
    conn: &rusqlite::Connection,
    worktree_id: &str,
) -> Result<StoredWorktreeRow, RpcError> {
    conn.query_row(
        "SELECT id, project_id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at, \
         workspace_status, is_pinned, is_archived, sort_order, manual_order, last_activity_at, linked_pr, creator \
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
                creator: r.get(18)?,
            })
        },
    )
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
    // A folder can back several Workspaces now (issue #579); the implicit
    // worktree always renders the folder's primary (earliest-created) row.
    let workspace_id: String = conn
        .query_row(
            "SELECT id FROM workspaces WHERE path = ?1 ORDER BY created_at LIMIT 1",
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
            // A folder Project owns no git worktrees, but it can own several
            // named Workspaces that share its one folder path (issue #579):
            // each is its own sidebar section with its own sessions. None of
            // the git-only Advanced options apply here, so reject them
            // honestly rather than silently ignoring them.
            if base_ref.is_some()
                || branch_override.is_some()
                || reuse_branch
                || parent_worktree_id.is_some()
                || !sparse.is_empty()
            {
                return Err(error::invalid_argument(
                    "a folder workspace has no branch, base ref, parent or sparse checkout",
                ));
            }
            return self.create_folder_workspace(
                &project,
                &name,
                note.as_deref(),
                creator.as_deref(),
            );
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
            "INSERT INTO worktrees (id, project_id, workspace_id, path, branch, head, base_ref, note, parent_worktree_id, created_at, sort_order, last_activity_at, creator) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            rusqlite::params![id, project_id, workspace_id, canonical_target_str, branch_name, head, base_ref, note, parent_worktree_id, created_at, sort_order, created_at, creator],
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
            creator: creator.as_deref(),
        }))
    }

    /// Creates an additional Workspace section for a folder Project (issue
    /// #579). A folder has no git worktrees, so this makes no `git`
    /// invocation: it registers a second Workspace at the same folder path
    /// (via [`crate::workspace::register_additional_at_path`]) and inserts a
    /// real `worktrees` row pointing at it, so the sidebar renders it as its
    /// own section grouping its own sessions — exactly like a git worktree
    /// card, minus branch/head. The folder's original implicit worktree
    /// (`id == project.id`) stays the primary; this row carries a distinct
    /// uuid, so the renderer treats it as a normal, renamable/removable card.
    fn create_folder_workspace(
        &self,
        project: &crate::project::ProjectInfo,
        name: &str,
        note: Option<&str>,
        creator: Option<&str>,
    ) -> Result<Value, RpcError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(error::invalid_argument("workspace name must not be empty"));
        }
        let conn = self.db.lock().unwrap();
        let workspace = crate::workspace::register_additional_at_path(
            &conn,
            &self.host_id,
            &project.path,
            name,
        )?;
        let workspace_id = workspace["id"]
            .as_str()
            .ok_or_else(|| error::internal_error("workspace registration missing id"))?
            .to_string();
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = now_rfc3339();
        let sort_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM worktrees WHERE project_id = ?1",
                [&project.id],
                |r| r.get(0),
            )
            .map_err(error::from_sqlite)?;
        conn.execute(
            "INSERT INTO worktrees (id, project_id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at, sort_order, last_activity_at, creator) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            rusqlite::params![id, project.id, workspace_id, project.path, "", "", Option::<String>::None, name, note, Option::<String>::None, created_at, sort_order, created_at, creator],
        )
        .map_err(error::from_sqlite)?;
        Ok(worktree_json(WorktreeMetaRow {
            id: &id,
            project_id: &project.id,
            workspace_id: &workspace_id,
            path: &project.path,
            branch: "",
            head: "",
            base_ref: None,
            title: Some(name),
            note,
            parent_worktree_id: None,
            created_at: &created_at,
            workspace_status: None,
            is_pinned: false,
            is_archived: false,
            sort_order,
            manual_order: None,
            last_activity_at: Some(&created_at),
            linked_pr: None,
            creator,
        }))
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
            // The synthesized primary (the folder itself) plus any additional
            // folder Workspaces the user created as their own sections
            // (issue #579). The additional rows are real `worktrees` rows
            // with distinct uuids sharing the folder path; they carry no
            // branch/head, so there is no git checkout to reconcile against.
            let mut worktrees = vec![folder_implicit_worktree_json(&conn, &project)?];
            let mut stmt = conn
                .prepare(
                    "SELECT id, workspace_id, path, title, note, created_at, \
                     workspace_status, is_pinned, is_archived, sort_order, manual_order, last_activity_at, creator \
                     FROM worktrees WHERE project_id = ?1 ORDER BY created_at",
                )
                .map_err(error::from_sqlite)?;
            let rows = stmt
                .query_map([&project_id], |r| {
                    Ok(worktree_json(WorktreeMetaRow {
                        id: &r.get::<_, String>(0)?,
                        project_id: &project_id,
                        workspace_id: &r.get::<_, String>(1)?,
                        path: &r.get::<_, String>(2)?,
                        branch: "",
                        head: "",
                        base_ref: None,
                        title: r.get::<_, Option<String>>(3)?.as_deref(),
                        note: r.get::<_, Option<String>>(4)?.as_deref(),
                        parent_worktree_id: None,
                        created_at: &r.get::<_, String>(5)?,
                        workspace_status: r.get::<_, Option<String>>(6)?.as_deref(),
                        is_pinned: r.get::<_, bool>(7)?,
                        is_archived: r.get::<_, bool>(8)?,
                        sort_order: r.get::<_, i64>(9)?,
                        manual_order: r.get::<_, Option<i64>>(10)?,
                        last_activity_at: r.get::<_, Option<String>>(11)?.as_deref(),
                        linked_pr: None,
                        creator: r.get::<_, Option<String>>(12)?.as_deref(),
                    }))
                })
                .map_err(error::from_sqlite)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error::from_sqlite)?;
            worktrees.extend(rows);
            return Ok(json!({ "worktrees": worktrees }));
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at, \
                 workspace_status, is_pinned, is_archived, sort_order, manual_order, last_activity_at, linked_pr, creator \
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
                    creator: r.get(17)?,
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
                    creator: row.creator.as_deref(),
                })
            })
            .collect();

        Ok(json!({ "worktrees": worktrees }))
    }

    pub(super) fn do_worktree_remove(&self, params: &Value) -> Result<Value, RpcError> {
        let id = require_str(params, "id")?.to_string();
        let force = optional_bool(params, "force", false)?;

        let row = {
            let conn = self.db.lock().unwrap();
            conn.query_row(
                "SELECT p.path, p.kind, w.path, w.workspace_id FROM worktrees w JOIN projects p ON p.id = w.project_id WHERE w.id = ?1",
                [&id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
            )
            .optional()
            .map_err(error::from_sqlite)?
        };
        let Some((project_path, project_kind, worktree_path, workspace_id)) = row else {
            return self.remove_implicit_folder_worktree(&id);
        };

        // A folder Workspace section (issue #579) has no git worktree to
        // remove — its path is the folder itself, shared with the project.
        // Removing it only unregisters this Workspace row; the folder and
        // its files are never touched.
        if project_kind != "folder" {
            remove_worktree_checkout(Path::new(&project_path), &worktree_path, force)?;
        }

        let conn = self.db.lock().unwrap();
        conn.execute("DELETE FROM worktrees WHERE id = ?1", [&id])
            .map_err(error::from_sqlite)?;
        conn.execute("DELETE FROM workspaces WHERE id = ?1", [&workspace_id])
            .map_err(error::from_sqlite)?;
        Ok(json!({ "id": id, "removed": true }))
    }

    /// `worktree.remove` for a folder Project's implicit worktree, whose id
    /// is the Project's own and which has no `worktrees` row of its own (see
    /// `folder_implicit_worktree_json`). Without this the lookup above found
    /// nothing and the sidebar's "Remove Workspace" answered "worktree not
    /// found" every time, with no Force checkbox to fall back on -- a folder
    /// workspace could not be deleted at all (#604). What that row owns is a
    /// registration, so removing it is `project.remove`: the rows go, the
    /// user's folder stays. Genuinely unknown ids keep the same `not_found`.
    fn remove_implicit_folder_worktree(&self, id: &str) -> Result<Value, RpcError> {
        let is_folder_project = {
            let conn = self.db.lock().unwrap();
            conn.query_row(
                "SELECT 1 FROM projects WHERE id = ?1 AND kind = 'folder'",
                [id],
                |_| Ok(()),
            )
            .optional()
            .map_err(error::from_sqlite)?
            .is_some()
        };
        if !is_folder_project {
            return Err(error::not_found("worktree not found"));
        }
        // A fresh params value, so nothing `project.remove` also understands
        // (`deleteFiles`) can reach it through a `worktree.remove` call.
        self.do_project_remove(&json!({ "id": id }))?;
        Ok(json!({ "id": id, "removed": true }))
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
        Ok(fetch_worktree_row(&conn, &decoded.worktree_id)?.as_json())
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
        if mutated {
            conn.execute(
                "UPDATE worktrees SET last_activity_at = ?1 WHERE id = ?2",
                rusqlite::params![now_rfc3339(), decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
        }
        Ok(fetch_worktree_row(&conn, &decoded.worktree_id)?.as_json())
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

    // --- Forced-removal recovery (#604) -------------------------------------

    #[test]
    fn a_forced_remove_passes_force_twice_as_git_demands_of_a_locked_worktree() {
        assert_eq!(
            git_worktree_remove_argv("/w", false),
            ["worktree", "remove", "/w"]
        );
        assert_eq!(
            git_worktree_remove_argv("/w", true),
            ["worktree", "remove", "--force", "--force", "/w"],
            "one --force leaves git refusing a locked working tree outright"
        );
    }

    #[test]
    fn a_probe_that_cannot_answer_never_licenses_deleting_a_directory() {
        // No git, a timeout, a killed capture: the accompanying failure says
        // nothing about the checkout, so force must not act on it either.
        assert_eq!(
            recovery_after_failed_git_remove(true, None),
            RemoveRecovery::ReportGitFailure
        );
        assert_eq!(
            recovery_after_failed_git_remove(false, None),
            RemoveRecovery::ReportGitFailure
        );
    }

    #[test]
    fn force_deletes_the_checkout_whichever_refusal_git_reached() {
        // Locked, unregistered, or anything else git exits non-zero on: the
        // user ticked Force, so the workspace goes.
        assert_eq!(
            recovery_after_failed_git_remove(true, Some(true)),
            RemoveRecovery::DeleteCheckoutDirectory
        );
        assert_eq!(
            recovery_after_failed_git_remove(true, Some(false)),
            RemoveRecovery::DeleteCheckoutDirectory
        );
    }

    #[test]
    fn unforced_keeps_gits_verdict_but_names_force_when_git_has_no_verdict_to_give() {
        assert_eq!(
            recovery_after_failed_git_remove(false, Some(true)),
            RemoveRecovery::ReportGitFailure,
            "git's own 'use --force to delete it' is the right message"
        );
        assert_eq!(
            recovery_after_failed_git_remove(false, Some(false)),
            RemoveRecovery::OfferForce,
            "'is not a working tree' tells the user nothing they can act on"
        );
    }

    // --- Checkout-directory deletion guards (#604) --------------------------

    #[test]
    fn checkout_delete_refuses_a_relative_or_project_owning_path() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        std::fs::create_dir(&project).unwrap();

        assert_eq!(
            delete_checkout_directory(&project, Path::new("workspaces/x"))
                .unwrap_err()
                .code,
            "invalid_argument"
        );
        assert_eq!(
            delete_checkout_directory(&project, &project)
                .unwrap_err()
                .code,
            "invalid_argument",
            "the project checkout is never the orphan"
        );
        assert_eq!(
            delete_checkout_directory(&project, root.path())
                .unwrap_err()
                .code,
            "invalid_argument",
            "nor is any directory containing it"
        );
        assert!(project.exists(), "a refused cleanup deletes nothing");
    }

    #[test]
    fn checkout_delete_removes_the_checkout_and_tolerates_one_already_gone() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        let orphan = root.path().join("orphan");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir_all(orphan.join("nested")).unwrap();
        std::fs::write(orphan.join("nested/file.txt"), "work").unwrap();

        delete_checkout_directory(&project, &orphan).unwrap();
        assert!(!orphan.exists());
        delete_checkout_directory(&project, &orphan)
            .expect("a path that is already gone is a success, not a failure");
    }

    #[test]
    fn checkout_delete_handles_a_path_that_is_not_a_directory() {
        // Whatever sits at the recorded path has to go, or the row it belongs
        // to becomes undeletable again -- the whole of #604.
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        let stray = root.path().join("was-a-workspace");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(&stray, "left behind").unwrap();

        delete_checkout_directory(&project, &stray).unwrap();
        assert!(!stray.exists());
    }

    #[test]
    fn checkout_delete_unlinks_a_symlinked_checkout_without_following_it() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("project");
        let elsewhere = root.path().join("elsewhere");
        let link = root.path().join("linked-workspace");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("keep.txt"), "not this workspace's").unwrap();
        std::os::unix::fs::symlink(&elsewhere, &link).unwrap();

        delete_checkout_directory(&project, &link).unwrap();
        assert!(!link.exists(), "the link itself is removed");
        assert!(
            elsewhere.join("keep.txt").exists(),
            "whatever it pointed at is left alone"
        );
    }
}
