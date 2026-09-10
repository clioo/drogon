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

#[allow(clippy::too_many_arguments)]
fn worktree_json(
    id: &str,
    project_id: &str,
    workspace_id: &str,
    path: &str,
    branch: &str,
    head: &str,
    base_ref: Option<&str>,
    title: Option<&str>,
    note: Option<&str>,
    parent_worktree_id: Option<&str>,
    created_at: &str,
) -> Value {
    json!({
        "id": id,
        "projectId": project_id,
        "workspaceId": workspace_id,
        "path": path,
        "branch": branch,
        "head": head,
        "baseRef": base_ref,
        "title": title,
        "note": note,
        "parentWorktreeId": parent_worktree_id,
        "createdAt": created_at,
    })
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
        conn.execute(
            "INSERT INTO worktrees (id, project_id, workspace_id, path, branch, head, base_ref, note, parent_worktree_id, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![id, project_id, workspace_id, canonical_target_str, branch_name, head, base_ref, note, parent_worktree_id, created_at],
        )
        .map_err(error::from_sqlite)?;

        Ok(worktree_json(
            &id,
            &project_id,
            &workspace_id,
            &canonical_target_str,
            &branch_name,
            &head,
            base_ref.as_deref(),
            None,
            note.as_deref(),
            parent_worktree_id.as_deref(),
            &created_at,
        ))
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
            let workspace_id: Option<String> = conn
                .query_row(
                    "SELECT id FROM workspaces WHERE path = ?1",
                    [&project.path],
                    |r| r.get(0),
                )
                .optional()
                .map_err(error::from_sqlite)?;
            let workspace_id = workspace_id.ok_or_else(|| {
                error::internal_error("folder project's implicit workspace is missing")
            })?;
            return Ok(json!({
                "worktrees": [worktree_json(
                    &project.id, &project.id, &workspace_id, &project.path, "", "", None, None,
                    None, None, &project.created_at,
                )]
            }));
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at FROM worktrees WHERE project_id = ?1 ORDER BY created_at",
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
                worktree_json(
                    &row.id,
                    &project_id,
                    &row.workspace_id,
                    &row.path,
                    &branch,
                    &head,
                    row.base_ref.as_deref(),
                    row.title.as_deref(),
                    row.note.as_deref(),
                    row.parent_worktree_id.as_deref(),
                    &row.created_at,
                )
            })
            .collect();

        Ok(json!({ "worktrees": worktrees }))
    }

    pub(super) fn do_worktree_remove(&self, params: &Value) -> Result<Value, RpcError> {
        let id = require_str(params, "id")?.to_string();
        let force = optional_bool(params, "force", false)?;

        let (project_path, worktree_path, workspace_id) = {
            let conn = self.db.lock().unwrap();
            conn.query_row(
                "SELECT p.path, w.path, w.workspace_id FROM worktrees w JOIN projects p ON p.id = w.project_id WHERE w.id = ?1",
                [&id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
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

        let conn = self.db.lock().unwrap();
        conn.execute("DELETE FROM worktrees WHERE id = ?1", [&id])
            .map_err(error::from_sqlite)?;
        conn.execute("DELETE FROM workspaces WHERE id = ?1", [&workspace_id])
            .map_err(error::from_sqlite)?;
        Ok(json!({ "id": id, "removed": true }))
    }

    /// Display-title rename (`worktree.rename { worktreeId, name }`).
    /// Renames exactly what Orca's inline rename renames: the card's
    /// display title stored on the worktree row. The git branch and the
    /// worktree directory are untouched — verify by comparing `branch`
    /// and `path` before and after.
    #[allow(clippy::type_complexity)]
    pub(super) fn do_worktree_rename(&self, params: &Value) -> Result<Value, RpcError> {
        let decoded: drogon_protocol::worktree::WorktreeRenameParams =
            serde_json::from_value(params.clone())
                .map_err(|_| error::invalid_argument("Invalid worktree.rename parameters"))?;
        decoded.validate_name()?;
        let name = decoded.name.trim().to_string();

        let conn = self.db.lock().unwrap();
        let changed = conn
            .execute(
                "UPDATE worktrees SET title = ?1 WHERE id = ?2",
                rusqlite::params![name, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
        if changed == 0 {
            return Err(error::not_found("worktree not found"));
        }
        let row: (
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ) = conn
            .query_row(
                "SELECT id, project_id, workspace_id, path, branch, head, base_ref, note, parent_worktree_id, created_at FROM worktrees WHERE id = ?1",
                [&decoded.worktree_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                    ))
                },
            )
            .map_err(error::from_sqlite)?;
        Ok(worktree_json(
            &row.0,
            &row.1,
            &row.2,
            &row.3,
            &row.4,
            &row.5,
            row.6.as_deref(),
            Some(&name),
            row.7.as_deref(),
            row.8.as_deref(),
            &row.9,
        ))
    }

    /// Worktree-meta update (`worktree.update`): the note (the composer's
    /// Advanced Note row) and the sidebar-nesting parent. Each field is
    /// tri-state — absent leaves the column untouched, explicit null
    /// clears it. The parent is nesting only: it never changes the base
    /// branch, matching the fork's picker copy.
    #[allow(clippy::type_complexity)]
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
        let project_id: String = conn
            .query_row(
                "SELECT project_id FROM worktrees WHERE id = ?1",
                [&decoded.worktree_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(error::from_sqlite)?
            .ok_or_else(|| error::not_found("worktree not found"))?;
        if let Some(parent) = &decoded.parent_worktree_id {
            if let Some(parent_id) = parent {
                validate_parent_update(&conn, &decoded.worktree_id, &project_id, parent_id)?;
            }
            conn.execute(
                "UPDATE worktrees SET parent_worktree_id = ?1 WHERE id = ?2",
                rusqlite::params![parent, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
        }
        if let Some(note) = &decoded.note {
            let trimmed = note.as_deref().map(str::trim).filter(|s| !s.is_empty());
            conn.execute(
                "UPDATE worktrees SET note = ?1 WHERE id = ?2",
                rusqlite::params![trimmed, decoded.worktree_id],
            )
            .map_err(error::from_sqlite)?;
        }
        let row: (
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
        ) = conn
            .query_row(
                "SELECT id, project_id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at FROM worktrees WHERE id = ?1",
                [&decoded.worktree_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                    ))
                },
            )
            .map_err(error::from_sqlite)?;
        Ok(worktree_json(
            &row.0,
            &row.1,
            &row.2,
            &row.3,
            &row.4,
            &row.5,
            row.6.as_deref(),
            row.7.as_deref(),
            row.8.as_deref(),
            row.9.as_deref(),
            &row.10,
        ))
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
