//! Git review RPCs (journey J2): status, unified diff, stage/unstage,
//! commit, push and `gh pr create`. Read methods run directly; every
//! mutation runs through the request ledger (`Engine::mutating`) so a
//! retried requestId dedupes instead of double-committing. All processes
//! spawn through `crate::git_process` with bounded time and output.

use std::path::PathBuf;
use std::time::Duration;

use drogon_protocol::git::{
    GitCommitParams, GitDiffParams, GitDiscardParams, GitFetchParams, GitLineCountsParams,
    GitPrCreateParams, GitPullParams, GitPushParams, GitScope, GitStageParams, GitStatusParams,
    GitUnstageParams, MAX_GIT_DIFF_BYTES,
};
use drogon_protocol::{MAX_FRAME_BYTES, RpcError};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::git::{HostScope, StatusEntry};
use crate::git_process::ParsedGitOutput;
use crate::{Engine, error, git_process, workspace};

impl Engine {
    fn git_workspace_root(&self, scope: &GitScope) -> Result<PathBuf, RpcError> {
        scope.validate(&self.host_id)?;
        let path = workspace::owned_path(
            &self.db.lock().unwrap(),
            &self.host_id,
            &scope.workspace_id,
            &scope.host_id,
        )?;
        Ok(PathBuf::from(path))
    }

    pub(super) fn do_git_status(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitStatusParams = decode(value)?;
        let root = self.git_workspace_root(&params.scope)?;
        let cache = crate::git::CapabilityCache::new();
        let output = git_process::run_read_only_git(
            git_process::ReadOnlyGitOperation::Status,
            &root,
            &HostScope::native(),
            &cache,
            git_read_budget(),
        )?;
        let parsed = match output {
            ParsedGitOutput::Status(parsed) => parsed,
            ParsedGitOutput::WorktreeList(_) => {
                return Err(error::internal_error("git status returned worktree output"));
            }
        };
        let mut result = scope_result(&params.scope);
        result["branch"] = json!({
            "head": parsed.header.head,
            "oid": parsed.header.oid,
            "upstream": parsed.header.upstream,
            "ahead": parsed.header.ahead,
            "behind": parsed.header.behind,
            // #176: remote names (never URLs) so the panel distinguishes
            // "no remote configured" from "no upstream on a remote".
            "remotes": parsed.remotes,
        });
        let mut entries = Vec::with_capacity(parsed.entries.len());
        let mut remaining = MAX_FRAME_BYTES / 2;
        let mut truncated = false;
        for entry in parsed.entries {
            let value = status_entry_value(&entry);
            let bytes = serde_json::to_vec(&value)
                .map_err(|_| error::internal_error("Could not serialize git status entry"))?
                .len()
                + 1;
            if bytes > remaining {
                truncated = true;
                break;
            }
            remaining -= bytes;
            entries.push(value);
        }
        result["entries"] = Value::Array(entries);
        result["truncated"] = json!(truncated);
        Ok(result)
    }

    pub(super) fn do_git_diff(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitDiffParams = decode(value)?;
        params.validate_paths()?;
        let root = self.git_workspace_root(&params.scope)?;
        let staged = params.staged.unwrap_or(false);
        let diff = git_process::run_git_diff(
            &root,
            &params.path,
            staged,
            &git_process::git_diff_budget(),
        )?;
        let (diff, truncated) = truncate_to_bytes(&diff, MAX_GIT_DIFF_BYTES as usize);
        let mut result = scope_result(&params.scope);
        result["path"] = json!(params.path);
        result["staged"] = json!(staged);
        result["diff"] = json!(diff);
        result["truncated"] = json!(truncated);
        Ok(result)
    }

    pub(super) fn do_git_stage(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitStageParams = decode(value)?;
        params.validate_paths()?;
        let root = self.git_workspace_root(&params.scope)?;
        git_process::run_git_mutation(
            &root,
            &git_process::GitMutation::Stage {
                paths: params.paths.clone(),
            },
            &git_process::git_mutation_budget(),
        )?;
        let mut result = scope_result(&params.scope);
        result["paths"] = json!(params.paths);
        Ok(result)
    }

    pub(super) fn do_git_unstage(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitUnstageParams = decode(value)?;
        params.validate_paths()?;
        let root = self.git_workspace_root(&params.scope)?;
        git_process::run_git_mutation(
            &root,
            &git_process::GitMutation::Unstage {
                paths: params.paths.clone(),
            },
            &git_process::git_mutation_budget(),
        )?;
        let mut result = scope_result(&params.scope);
        result["paths"] = json!(params.paths);
        Ok(result)
    }

    pub(super) fn do_git_commit(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitCommitParams = decode(value)?;
        params.validate_message()?;
        let root = self.git_workspace_root(&params.scope)?;
        let budget = git_process::git_mutation_budget();
        git_process::run_git_mutation(
            &root,
            &git_process::GitMutation::Commit {
                message: params.message.clone(),
                amend: params.amend.unwrap_or(false),
            },
            &budget,
        )?;
        let commit = git_process::run_git_head_oid(&root, &budget)?;
        let mut result = scope_result(&params.scope);
        result["commit"] = json!(commit);
        Ok(result)
    }

    pub(super) fn do_git_push(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitPushParams = decode(value)?;
        let root = self.git_workspace_root(&params.scope)?;
        let output = git_process::run_git_mutation(
            &root,
            &git_process::GitMutation::Push,
            &git_process::git_mutation_budget(),
        )?;
        let mut result = scope_result(&params.scope);
        result["pushed"] = json!(true);
        result["detail"] = json!(last_line(&format!("{}\n{}", output.stdout, output.stderr)));
        Ok(result)
    }

    pub(super) fn do_git_discard(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitDiscardParams = decode(value)?;
        params.validate_paths()?;
        let root = self.git_workspace_root(&params.scope)?;
        let mutation = if params.untracked {
            git_process::GitMutation::DiscardUntracked {
                paths: params.paths.clone(),
            }
        } else {
            git_process::GitMutation::DiscardTracked {
                paths: params.paths.clone(),
            }
        };
        git_process::run_git_mutation(&root, &mutation, &git_process::git_mutation_budget())?;
        let mut result = scope_result(&params.scope);
        result["paths"] = json!(params.paths);
        Ok(result)
    }

    pub(super) fn do_git_line_counts(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitLineCountsParams = decode(value)?;
        params.validate_paths()?;
        let root = self.git_workspace_root(&params.scope)?;
        let budget = git_process::git_diff_budget();
        let (staged, unstaged) = git_process::run_git_numstat(&root, &params.paths, &budget)?;
        let mut staged_map = std::collections::HashMap::new();
        for (path, count) in staged {
            staged_map.insert(path, count);
        }
        let mut unstaged_map = std::collections::HashMap::new();
        for (path, count) in unstaged {
            unstaged_map.insert(path, count);
        }
        let mut counts = Vec::with_capacity(params.paths.len());
        for path in &params.paths {
            let staged_count = staged_map
                .get(path)
                .copied()
                .unwrap_or(git_process::NumstatCount {
                    added: None,
                    removed: None,
                });
            let unstaged_count =
                unstaged_map
                    .get(path)
                    .copied()
                    .unwrap_or(git_process::NumstatCount {
                        added: None,
                        removed: None,
                    });
            // Untracked files never appear in either numstat output: count
            // their lines as unstaged additions so the row badge stays
            // truthful. Tracked-but-unchanged files keep explicit nulls.
            let (unstaged_added, unstaged_removed) =
                if unstaged_map.contains_key(path) || staged_map.contains_key(path) {
                    (unstaged_count.added, unstaged_count.removed)
                } else {
                    let lines = git_process::count_untracked_lines(&root.join(path));
                    (lines, lines.map(|_| 0))
                };
            counts.push(json!({
                "path": path,
                "stagedAdded": staged_count.added,
                "stagedRemoved": staged_count.removed,
                "unstagedAdded": unstaged_added,
                "unstagedRemoved": unstaged_removed,
            }));
        }
        let mut result = scope_result(&params.scope);
        result["counts"] = Value::Array(counts);
        Ok(result)
    }

    pub(super) fn do_git_pull(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitPullParams = decode(value)?;
        let root = self.git_workspace_root(&params.scope)?;
        let output = git_process::run_git_mutation(
            &root,
            &git_process::GitMutation::Pull,
            &git_process::git_mutation_budget(),
        )?;
        let mut result = scope_result(&params.scope);
        result["detail"] = json!(last_line(&format!("{}\n{}", output.stdout, output.stderr)));
        Ok(result)
    }

    pub(super) fn do_git_fetch(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitFetchParams = decode(value)?;
        let root = self.git_workspace_root(&params.scope)?;
        let output = git_process::run_git_mutation(
            &root,
            &git_process::GitMutation::Fetch,
            &git_process::git_mutation_budget(),
        )?;
        let mut result = scope_result(&params.scope);
        result["detail"] = json!(last_line(&format!("{}\n{}", output.stdout, output.stderr)));
        Ok(result)
    }

    pub(super) fn do_git_pr_create(&self, value: &Value) -> Result<Value, RpcError> {
        let params: GitPrCreateParams = decode(value)?;
        params.validate_text()?;
        let root = self.git_workspace_root(&params.scope)?;
        let url = git_process::run_gh_pr_create(
            &root,
            &params.title,
            params.body.as_deref(),
            &git_process::git_mutation_budget(),
        )?;
        let mut result = scope_result(&params.scope);
        result["url"] = json!(url);
        Ok(result)
    }
}

fn decode<T: DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone())
        .map_err(|_| error::invalid_argument("Invalid git request parameters"))
}

fn scope_result(scope: &GitScope) -> Value {
    json!({"hostId":scope.host_id, "workspaceId":scope.workspace_id})
}

fn git_read_budget() -> git_process::GitProbeBudget {
    git_process::GitProbeBudget {
        timeout: Duration::from_secs(30),
        max_combined_output_bytes: 16 * 1024 * 1024,
    }
}

fn status_entry_value(entry: &StatusEntry) -> Value {
    match entry {
        StatusEntry::Ordinary { xy, path } => {
            let (staged, unstaged) = xy_chars(xy);
            json!({"path":path, "staged":staged, "unstaged":unstaged, "kind":"ordinary"})
        }
        StatusEntry::RenameOrCopy {
            xy,
            score,
            path,
            orig_path,
        } => {
            let (staged, unstaged) = xy_chars(xy);
            let kind = if score.starts_with('C') {
                "copy"
            } else {
                "rename"
            };
            json!({"path":path, "staged":staged, "unstaged":unstaged, "kind":kind, "origPath":orig_path})
        }
        StatusEntry::Unmerged { xy, path } => {
            let (staged, unstaged) = xy_chars(xy);
            json!({"path":path, "staged":staged, "unstaged":unstaged, "kind":"unmerged"})
        }
        StatusEntry::Untracked { path } => {
            json!({"path":path, "staged":"?", "unstaged":"?", "kind":"untracked"})
        }
        StatusEntry::Ignored { path } => {
            json!({"path":path, "staged":"!", "unstaged":"!", "kind":"ignored"})
        }
    }
}

fn xy_chars(xy: &str) -> (String, String) {
    let mut chars = xy.chars();
    let staged = chars.next().map(String::from).unwrap_or_default();
    let unstaged = chars.next().map(String::from).unwrap_or_default();
    (staged, unstaged)
}

/// Cuts `text` to at most `max_bytes` on a char boundary, reporting whether
/// anything was cut. The diff viewer renders the prefix with a notice.
fn truncate_to_bytes(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_string(), true)
}

/// Last non-empty line, bounded: push reports on stderr ("Everything
/// up-to-date", branch updates), which can be long.
fn last_line(combined: &str) -> String {
    let line = combined
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .unwrap_or("");
    truncate_to_bytes(line, 2048).0
}
