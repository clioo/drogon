//! Additive Git review RPC shapes (journey J2): status, unified diff,
//! stage/unstage, commit, push and `gh pr create`. The execution host must
//! still verify workspace ownership; like `workspace_files.rs`, this module
//! is shape validation only.

use crate::RpcError;
use crate::orchestration_common::{validate_opaque_token, validate_task_text};
use serde::{Deserialize, Serialize};

/// Advertised in `status.capabilities` only when the Git RPC group below is
/// actually implemented and tested (per `protocol-v1.md` §capabilities).
pub const GIT_CAPABILITY: &str = "git.v1";
/// Wire ceiling for one repo-relative Git path, matching files.
pub const MAX_GIT_PATH_BYTES: usize = 32_768;
/// At most this many paths per stage/unstage call, matching directory lists.
pub const MAX_GIT_PATHS: usize = 1_000;
/// Unified diff text returned per `git.diff` call; longer output is cut with
/// `truncated: true`, never silently dropped.
pub const MAX_GIT_DIFF_BYTES: u64 = 65_536;
/// Commit message bound: task-shaped free text (may contain newlines).
pub const MAX_GIT_MESSAGE_BYTES: usize = 8_192;
/// PR title is one line; the body may contain newlines.
pub const MAX_GIT_PR_TITLE_BYTES: usize = 512;
pub const MAX_GIT_PR_BODY_BYTES: usize = 32_768;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitScope {
    pub host_id: String,
    pub workspace_id: String,
}

impl GitScope {
    pub fn validate(&self, host_id: &str) -> Result<(), RpcError> {
        validate_opaque_token(&self.host_id, 128, "Invalid git execution host.")?;
        validate_opaque_token(&self.workspace_id, 128, "Invalid git workspace identity.")?;
        if self.host_id != host_id {
            return Err(RpcError::new(
                "unsupported_host",
                "The git execution host is not served by this endpoint.",
            ));
        }
        Ok(())
    }
}

/// One repo-relative path: NUL-free, bounded, never absolute and never
/// escaping the workspace root via `..`. Mirrors the syntactic half of
/// `workspace_files::validate_rel`; the core re-checks against the open
/// workspace root before spawning.
pub fn validate_git_path(path: &str) -> Result<(), RpcError> {
    if path.is_empty() || path.len() > MAX_GIT_PATH_BYTES || path.contains('\0') {
        return Err(RpcError::new("invalid_argument", "Invalid git path."));
    }
    let rel = std::path::Path::new(path);
    if rel.is_absolute() {
        return Err(RpcError::new("invalid_argument", "Invalid git path."));
    }
    for component in rel.components() {
        if matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        ) {
            return Err(RpcError::new("invalid_argument", "Invalid git path."));
        }
    }
    Ok(())
}

fn validate_path_list(paths: &[String]) -> Result<(), RpcError> {
    if paths.is_empty() || paths.len() > MAX_GIT_PATHS {
        return Err(RpcError::new("invalid_argument", "Invalid git path list."));
    }
    for path in paths {
        validate_git_path(path)?;
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusParams {
    #[serde(flatten)]
    pub scope: GitScope,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffParams {
    #[serde(flatten)]
    pub scope: GitScope,
    pub path: String,
    pub staged: Option<bool>,
}

impl GitDiffParams {
    pub fn validate_paths(&self) -> Result<(), RpcError> {
        validate_git_path(&self.path)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStageParams {
    #[serde(flatten)]
    pub scope: GitScope,
    pub paths: Vec<String>,
}

impl GitStageParams {
    pub fn validate_paths(&self) -> Result<(), RpcError> {
        validate_path_list(&self.paths)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitUnstageParams {
    #[serde(flatten)]
    pub scope: GitScope,
    pub paths: Vec<String>,
}

impl GitUnstageParams {
    pub fn validate_paths(&self) -> Result<(), RpcError> {
        validate_path_list(&self.paths)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitParams {
    #[serde(flatten)]
    pub scope: GitScope,
    pub message: String,
    /// Fold into the previous commit instead of creating a new one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amend: Option<bool>,
}

impl GitCommitParams {
    pub fn validate_message(&self) -> Result<(), RpcError> {
        validate_task_text(
            &self.message,
            MAX_GIT_MESSAGE_BYTES,
            "Invalid commit message.",
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushParams {
    #[serde(flatten)]
    pub scope: GitScope,
}

/// Discard working-tree changes for exactly the given paths: tracked paths
/// are restored via `git checkout -- <paths>`, untracked paths are removed
/// via `git clean -fd -- <paths>` (never `-x`: ignored files survive). The
/// caller unstages first when discarding staged work.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiscardParams {
    #[serde(flatten)]
    pub scope: GitScope,
    pub paths: Vec<String>,
    pub untracked: bool,
}

impl GitDiscardParams {
    pub fn validate_paths(&self) -> Result<(), RpcError> {
        validate_path_list(&self.paths)
    }
}

/// Per-file line counts for the given paths: staged counts come from
/// `git diff --numstat --cached`, unstaged from `git diff --numstat`, and
/// untracked files report their full line count as unstaged additions.
/// `None` per side means unavailable (binary, missing, or over budget).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLineCountsParams {
    #[serde(flatten)]
    pub scope: GitScope,
    pub paths: Vec<String>,
}

impl GitLineCountsParams {
    pub fn validate_paths(&self) -> Result<(), RpcError> {
        validate_path_list(&self.paths)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullParams {
    #[serde(flatten)]
    pub scope: GitScope,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchParams {
    #[serde(flatten)]
    pub scope: GitScope,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPrCreateParams {
    #[serde(flatten)]
    pub scope: GitScope,
    pub title: String,
    pub body: Option<String>,
}

impl GitPrCreateParams {
    pub fn validate_text(&self) -> Result<(), RpcError> {
        if self.title.is_empty()
            || self.title.len() > MAX_GIT_PR_TITLE_BYTES
            || self.title.contains('\0')
            || self.title.contains('\n')
        {
            return Err(RpcError::new("invalid_argument", "Invalid PR title."));
        }
        if let Some(body) = &self.body {
            validate_task_text(body, MAX_GIT_PR_BODY_BYTES, "Invalid PR body.")?;
        }
        Ok(())
    }
}

/// One status entry on the wire: the porcelain `XY` codes verbatim plus a
/// `kind` discriminator so the renderer never re-parses codes.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    pub staged: String,
    pub unstaged: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orig_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
    /// Remote names from `git remote` (never URLs). `None`/empty means the
    /// repo has no remote configured (#176: distinct from no-upstream).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remotes: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub host_id: String,
    pub workspace_id: String,
    pub branch: GitBranch,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub host_id: String,
    pub workspace_id: String,
    pub path: String,
    pub staged: bool,
    pub diff: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub host_id: String,
    pub workspace_id: String,
    pub commit: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub host_id: String,
    pub workspace_id: String,
    pub pushed: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPrCreateResult {
    pub host_id: String,
    pub workspace_id: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiscardResult {
    pub host_id: String,
    pub workspace_id: String,
    pub paths: Vec<String>,
}

/// One file's line counts. Counts are `None` (not zero) when unavailable:
/// binary files, unreadable paths, or files over the read budget.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLineCount {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub staged_added: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub staged_removed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unstaged_added: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unstaged_removed: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLineCountsResult {
    pub host_id: String,
    pub workspace_id: String,
    pub counts: Vec<GitLineCount>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullResult {
    pub host_id: String,
    pub workspace_id: String,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchResult {
    pub host_id: String,
    pub workspace_id: String,
    pub detail: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn scope() -> GitScope {
        GitScope {
            host_id: "host".into(),
            workspace_id: "workspace".into(),
        }
    }

    #[test]
    fn scope_requires_host_and_preserves_additive_fields() {
        let mut input = json!({"hostId":"host", "workspaceId":"workspace", "future":true});
        let params: GitStatusParams = serde_json::from_value(input.clone()).unwrap();
        params.scope.validate("host").unwrap();
        input.as_object_mut().unwrap().remove("hostId");
        assert!(serde_json::from_value::<GitStatusParams>(input).is_err());
    }

    #[test]
    fn scope_refuses_other_host() {
        assert_eq!(
            scope().validate("other").unwrap_err().code,
            "unsupported_host"
        );
    }

    #[test]
    fn git_paths_reject_nul_absolute_and_parent() {
        for bad in [
            "",
            "x\0y",
            "/abs/path",
            "../escape",
            "sub/../../escape",
            &"x".repeat(MAX_GIT_PATH_BYTES + 1),
        ] {
            assert!(validate_git_path(bad).is_err(), "must reject {bad:?}");
        }
        for good in ["file.txt", "sub/dir/file.txt", ".hidden", "sp ace.txt"] {
            assert!(validate_git_path(good).is_ok(), "must accept {good:?}");
        }
    }

    #[test]
    fn path_lists_are_bounded_and_nonempty() {
        let base = GitStageParams {
            scope: scope(),
            paths: vec!["a.txt".into()],
        };
        base.validate_paths().unwrap();
        assert!(
            GitStageParams {
                scope: scope(),
                paths: vec![]
            }
            .validate_paths()
            .is_err()
        );
        assert!(
            GitStageParams {
                scope: scope(),
                paths: vec!["a.txt".into(); MAX_GIT_PATHS + 1]
            }
            .validate_paths()
            .is_err()
        );
        assert!(
            GitStageParams {
                scope: scope(),
                paths: vec!["../evil".into()]
            }
            .validate_paths()
            .is_err()
        );
        GitUnstageParams {
            scope: scope(),
            paths: vec!["a.txt".into()],
        }
        .validate_paths()
        .unwrap();
        GitDiffParams {
            scope: scope(),
            path: "a.txt".into(),
            staged: Some(true),
        }
        .validate_paths()
        .unwrap();
    }

    #[test]
    fn commit_and_pr_text_are_bounded() {
        GitCommitParams {
            scope: scope(),
            message: "fix: it\n\nbody line".into(),
            amend: None,
        }
        .validate_message()
        .unwrap();
        GitCommitParams {
            scope: scope(),
            message: "fold in".into(),
            amend: Some(true),
        }
        .validate_message()
        .unwrap();
        for bad in ["", &"x".repeat(MAX_GIT_MESSAGE_BYTES + 1), "has\0nul"] {
            assert!(
                GitCommitParams {
                    scope: scope(),
                    message: bad.into(),
                    amend: None,
                }
                .validate_message()
                .is_err()
            );
        }
        GitPrCreateParams {
            scope: scope(),
            title: "Add feature".into(),
            body: Some("line1\nline2".into()),
        }
        .validate_text()
        .unwrap();
        for title in ["", "two\nlines", &"x".repeat(MAX_GIT_PR_TITLE_BYTES + 1)] {
            assert!(
                GitPrCreateParams {
                    scope: scope(),
                    title: title.into(),
                    body: None
                }
                .validate_text()
                .is_err()
            );
        }
    }

    #[test]
    fn results_round_trip_camel_case() {
        let result = GitStatusResult {
            host_id: "host".into(),
            workspace_id: "workspace".into(),
            branch: GitBranch {
                head: Some("main".into()),
                oid: None,
                upstream: None,
                ahead: Some(1),
                behind: Some(0),
                remotes: None,
            },
            entries: vec![GitStatusEntry {
                path: "a.txt".into(),
                staged: "M".into(),
                unstaged: " ".into(),
                kind: "ordinary".into(),
                orig_path: None,
            }],
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["hostId"], "host");
        assert_eq!(value["entries"][0]["origPath"], Value::Null);
        let back: GitStatusResult = serde_json::from_value(value).unwrap();
        assert_eq!(back.entries.len(), 1);
    }
}
