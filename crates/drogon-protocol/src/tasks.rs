//! Wire types for Tasks (journey J6): GitHub Issues listed through `gh`
//! for one git Project, with "start task" worktree links. The execution
//! host still verifies project ownership; like `git.rs`, this module is
//! shape validation only. GitHub only: no provider abstraction.

use crate::RpcError;
use crate::orchestration_common::validate_opaque_token;
use crate::worktree::Worktree;
use serde::{Deserialize, Serialize};

/// Advertised in `status.capabilities` only when the Tasks RPC group below
/// is actually implemented and tested (per `protocol-v1.md` §capabilities).
pub const TASKS_CAPABILITY: &str = "tasks.v1";
/// Free-text filter bound: a substring match, never a search language.
pub const MAX_TASKS_QUERY_BYTES: usize = 256;
/// Page size default for `tasks.list`: the source TaskPage's effective page
/// size for a single repo (PER_REPO_FETCH_LIMIT 36, one selected repo), so
/// the daemon's default window matches the reference pagination bar.
pub const DEFAULT_TASKS_PER_PAGE: u64 = 36;
/// GitHub never returns more than 100 items per fetch; a larger `perPage`
/// would silently lie about its own window.
pub const MAX_TASKS_PER_PAGE: u64 = 100;
/// Farthest page `tasks.list` serves. Bounds the upstream fetch to
/// `MAX_TASKS_PAGE * MAX_TASKS_PER_PAGE + 1` rows, inside GitHub's own
/// 1000-row search window.
pub const MAX_TASKS_PAGE: u64 = 10;

/// Which issues `tasks.list` returns. Serializes lowercase on the wire;
/// the core maps `gh`'s `OPEN`/`CLOSED` spellings onto these.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TaskIssueState {
    #[default]
    Open,
    Closed,
    All,
}

impl TaskIssueState {
    pub fn as_gh_flag(self) -> &'static str {
        match self {
            TaskIssueState::Open => "open",
            TaskIssueState::Closed => "closed",
            TaskIssueState::All => "all",
        }
    }
}

/// Which collection `tasks.list`/`tasks.start` serve. Serializes lowercase
/// on the wire; absent means issues, so every pre-PR caller keeps working.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TasksListMode {
    #[default]
    Issues,
    Pulls,
}

/// Which git remote supplies the GitHub repo a tasks query reads. Absent
/// means `auto`: upstream when the project has a GitHub upstream remote,
/// else origin — the reference client's fork-contribution heuristic
/// (`resolvePrWorkItemSource`: upstream-first for issues and PRs alike).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TasksRemoteSource {
    Origin,
    Upstream,
}

/// PR lifecycle states. `gh pr list --json` reports `OPEN`/`CLOSED`/`MERGED`
/// plus the `isDraft` flag; the core maps those onto these.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskPullRequestState {
    Open,
    Closed,
    Merged,
    Draft,
}

/// `gh`'s `reviewDecision` spelling, echoed verbatim on the wire.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PRReviewDecision {
    Approved,
    ChangesRequested,
    ReviewRequired,
}

/// Rolled-up check verdict for one PR, derived in the core from `gh`'s
/// `statusCheckRollup` entries.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CheckState {
    Success,
    Failure,
    Pending,
    Neutral,
    None,
}

/// Counted check outcomes for one PR. The renderer keys its ChecksCell pill
/// (label and tone) off `state` so the two can never contradict.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCheckSummary {
    pub state: CheckState,
    pub total: u64,
    pub passed: u64,
    pub failed: u64,
    pub pending: u64,
    pub neutral: u64,
}

/// `gh`'s `mergeable` spelling, echoed verbatim on the wire.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PRMergeableState {
    Mergeable,
    Conflicting,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskLabel {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// One GitHub issue. `assignees` carries logins only; `body` is present
/// only on `tasks.show`/`tasks.start` results, never on list rows.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskIssue {
    pub number: u64,
    pub title: String,
    pub state: TaskIssueState,
    pub labels: Vec<TaskLabel>,
    pub assignees: Vec<String>,
    /// Author login, when the upstream returned one; the list rows render
    /// it in the title context line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub updated_at: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// One GitHub pull request, as listed by `gh pr list --json
/// (number,title,url,author,assignees,reviewDecision,statusCheckRollup,
/// mergeable,isDraft,headRefName,baseRefName,updatedAt,labels)`.
/// `reviewers`/`latestReviews` stay renderer-side concerns (the daemon never
/// fetches them); `checks` is the core's rollup of `statusCheckRollup`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskPullRequest {
    pub number: u64,
    pub title: String,
    pub state: TaskPullRequestState,
    pub labels: Vec<TaskLabel>,
    pub assignees: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub updated_at: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_decision: Option<PRReviewDecision>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checks: Option<ProviderCheckSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mergeable: Option<PRMergeableState>,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_ref_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_ref_name: Option<String>,
}
/// The durable link between an issue (or PR — GitHub shares one
/// numbering space, so the same `(project_id, issue_number)` row serves
/// both) and the worktree `tasks.start` created for it. Mirrors the
/// `task_links` row the core keeps.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskLink {
    pub project_id: String,
    pub issue_number: u64,
    pub worktree_id: String,
    pub branch: String,
    pub created_at: String,
}

fn validate_project_id(project_id: &str) -> Result<(), RpcError> {
    validate_opaque_token(project_id, 128, "Invalid tasks project identity.")
}

fn validate_issue_number(number: u64) -> Result<(), RpcError> {
    if number == 0 {
        return Err(RpcError::new("invalid_argument", "Invalid issue number."));
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksListParams {
    pub project_id: String,
    #[serde(default)]
    pub state: Option<TaskIssueState>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub page: Option<u64>,
    #[serde(default)]
    pub per_page: Option<u64>,
    #[serde(default)]
    pub mode: Option<TasksListMode>,
    /// Which remote's repo the list reads; absent is `auto`
    /// (upstream-first, see [`TasksRemoteSource`]).
    #[serde(default)]
    pub source: Option<TasksRemoteSource>,
}

/// Validated `tasks.list` inputs, defaults applied.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidatedTasksList {
    pub state: TaskIssueState,
    pub query: Option<String>,
    pub page: u64,
    pub per_page: u64,
    pub mode: TasksListMode,
    pub source: Option<TasksRemoteSource>,
}

impl TasksListParams {
    pub fn validate(&self) -> Result<ValidatedTasksList, RpcError> {
        validate_project_id(&self.project_id)?;
        let state = self.state.unwrap_or_default();
        let query = match &self.query {
            None => None,
            Some(raw) => {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    if trimmed.len() > MAX_TASKS_QUERY_BYTES || trimmed.contains('\0') {
                        return Err(RpcError::new("invalid_argument", "Invalid tasks query."));
                    }
                    Some(trimmed.to_string())
                }
            }
        };
        let page = self.page.unwrap_or(1);
        if page == 0 || page > MAX_TASKS_PAGE {
            return Err(RpcError::new("invalid_argument", "Invalid tasks page."));
        }
        let per_page = self.per_page.unwrap_or(DEFAULT_TASKS_PER_PAGE);
        if per_page == 0 || per_page > MAX_TASKS_PER_PAGE {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid tasks page size.",
            ));
        }
        Ok(ValidatedTasksList {
            state,
            query,
            page,
            per_page,
            mode: self.mode.unwrap_or_default(),
            source: self.source,
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksShowParams {
    pub project_id: String,
    pub number: u64,
    /// Same remote override as `tasks.list` (the row shown came from that
    /// remote's repo when the user pinned a source).
    #[serde(default)]
    pub source: Option<TasksRemoteSource>,
}

impl TasksShowParams {
    pub fn validate(&self) -> Result<Option<TasksRemoteSource>, RpcError> {
        validate_project_id(&self.project_id)?;
        validate_issue_number(self.number)?;
        Ok(self.source)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksStartParams {
    pub project_id: String,
    pub number: u64,
    #[serde(default)]
    pub mode: Option<TasksListMode>,
    /// Same remote override as `tasks.list`: the issue/PR being started was
    /// listed from that remote's repo.
    #[serde(default)]
    pub source: Option<TasksRemoteSource>,
}

impl TasksStartParams {
    pub fn validate(&self) -> Result<(TasksListMode, Option<TasksRemoteSource>), RpcError> {
        validate_project_id(&self.project_id)?;
        validate_issue_number(self.number)?;
        Ok((self.mode.unwrap_or_default(), self.source))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksLinksParams {
    pub project_id: String,
}

impl TasksLinksParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_project_id(&self.project_id)
    }
}

/// `tasks.remotes`: the project's GitHub remote topology, local git config
/// only — never a network probe. Feeds the renderer's issue-source
/// selector (Upstream/Origin pills).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksRemotesParams {
    pub project_id: String,
}

impl TasksRemotesParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_project_id(&self.project_id)
    }
}

/// GitHub `owner/repo` slug per remote name; a key is absent (never null)
/// when that remote is missing or does not point at github.com.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TasksRemotesResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksListResult {
    /// `owner/repo` the list was read from, so the renderer never guesses
    /// which remote answered.
    pub repo: String,
    pub issues: Vec<TaskIssue>,
    /// Pull requests for `mode: "pulls"`; empty on the issues path (the key
    /// is skipped then, never null).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pulls: Vec<TaskPullRequest>,
    /// Echoed 1-based page and effective page size, so the renderer's
    /// pagination bar reads back exactly the window this result answers.
    pub page: u64,
    pub per_page: u64,
    /// True when at least one more row exists past this page's window.
    pub has_next_page: bool,
    /// Total matching issues, present only when the upstream exposes one
    /// (`gh issue list` does not, so this stays absent on that path).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksShowResult {
    pub issue: TaskIssue,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksStartResult {
    /// Issue or PR number (GitHub shares one numbering space, and the link
    /// row keys on it either way).
    pub issue_number: u64,
    pub worktree: Worktree,
    pub link: TaskLink,
    /// The PR head branch a pulls-mode start checked out. Absent on the
    /// issues path, where the branch is the generated `issue-N-slug` name
    /// already carried on `worktree.branch`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_branch: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksLinksResult {
    pub links: Vec<TaskLink>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn issue(number: u64) -> TaskIssue {
        TaskIssue {
            number,
            title: "Fix the sidebar".into(),
            state: TaskIssueState::Open,
            labels: vec![TaskLabel {
                name: "bug".into(),
                color: Some("d73a4a".into()),
            }],
            assignees: vec!["octocat".into()],
            author: Some("helix".into()),
            updated_at: "2026-09-06T12:00:00Z".into(),
            url: "https://github.com/example/repo/issues/7".into(),
            body: None,
        }
    }

    #[test]
    fn issue_round_trips_with_exact_wire_keys_and_no_body_on_lists() {
        let value = serde_json::to_value(issue(7)).unwrap();
        assert_eq!(
            value,
            json!({
                "number": 7, "title": "Fix the sidebar", "state": "open",
                "labels": [{"name": "bug", "color": "d73a4a"}],
                "assignees": ["octocat"],
                "author": "helix",
                "updatedAt": "2026-09-06T12:00:00Z",
                "url": "https://github.com/example/repo/issues/7",
            })
        );
        let back: TaskIssue = serde_json::from_value(value).unwrap();
        assert_eq!(back, issue(7));
        assert_eq!(back.body, None);
    }

    #[test]
    fn state_flag_matches_gh_spelling_and_defaults_to_open() {
        assert_eq!(TaskIssueState::Open.as_gh_flag(), "open");
        assert_eq!(TaskIssueState::Closed.as_gh_flag(), "closed");
        assert_eq!(TaskIssueState::All.as_gh_flag(), "all");
        let params: TasksListParams =
            serde_json::from_value(json!({"projectId": "p1", "future": true})).unwrap();
        let validated = params.validate().unwrap();
        assert_eq!(validated.state, TaskIssueState::Open);
        assert_eq!(validated.mode, TasksListMode::Issues);
        assert_eq!(validated.source, None, "source defaults to auto");
        assert_eq!(validated.page, 1, "page defaults to the first page");
        assert_eq!(
            validated.per_page, DEFAULT_TASKS_PER_PAGE,
            "perPage defaults to the source page size"
        );
    }

    #[test]
    fn list_result_wire_carries_paging_under_camel_case_keys() {
        let result = TasksListResult {
            repo: "example/repo".into(),
            issues: vec![],
            pulls: vec![],
            page: 2,
            per_page: 36,
            has_next_page: true,
            total: None,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["page"], 2);
        assert_eq!(value["perPage"], 36);
        assert_eq!(value["hasNextPage"], true);
        assert_eq!(value["repo"], "example/repo");
        // `gh issue list` exposes no total: the key must be absent, not null.
        assert!(value.get("total").is_none());
        let with_total = TasksListResult {
            total: Some(87),
            ..result
        };
        let value = serde_json::to_value(&with_total).unwrap();
        assert_eq!(value["total"], 87);
    }

    #[test]
    fn list_params_bound_page_and_page_size() {
        let parse = |value: Value| -> Result<(u64, u64), RpcError> {
            let params: TasksListParams = serde_json::from_value(value).unwrap();
            let validated = params.validate()?;
            Ok((validated.page, validated.per_page))
        };
        assert_eq!(
            parse(json!({"projectId": "p1", "page": 3, "perPage": 50})).unwrap(),
            (3, 50)
        );
        for bad in [
            json!({"projectId": "p1", "page": 0}),
            json!({"projectId": "p1", "page": MAX_TASKS_PAGE + 1}),
            json!({"projectId": "p1", "perPage": 0}),
            json!({"projectId": "p1", "perPage": MAX_TASKS_PER_PAGE + 1}),
        ] {
            assert!(parse(bad.clone()).is_err(), "must reject {bad}");
        }
    }

    #[test]
    fn list_params_reject_bad_identity_and_oversized_queries() {
        let bad = TasksListParams {
            project_id: "".into(),
            state: None,
            query: None,
            page: None,
            per_page: None,
            mode: None,
            source: None,
        };
        assert!(bad.validate().is_err());
        let bad = TasksListParams {
            project_id: "p1".into(),
            state: None,
            query: Some("x".repeat(MAX_TASKS_QUERY_BYTES + 1)),
            page: None,
            per_page: None,
            mode: None,
            source: None,
        };
        assert!(bad.validate().is_err());
        let blank = TasksListParams {
            project_id: "p1".into(),
            state: Some(TaskIssueState::Closed),
            query: Some("   ".into()),
            page: None,
            per_page: None,
            mode: None,
            source: None,
        };
        let validated = blank.validate().unwrap();
        assert_eq!(validated.state, TaskIssueState::Closed);
        assert_eq!(validated.query, None);
        assert_eq!(validated.mode, TasksListMode::Issues);
    }

    #[test]
    fn list_mode_defaults_to_issues_and_parses_pulls() {
        let params: TasksListParams = serde_json::from_value(json!({"projectId": "p1"})).unwrap();
        assert_eq!(params.validate().unwrap().mode, TasksListMode::Issues);
        let params: TasksListParams =
            serde_json::from_value(json!({"projectId": "p1", "mode": "pulls"})).unwrap();
        assert_eq!(params.validate().unwrap().mode, TasksListMode::Pulls);
        let params: TasksListParams =
            serde_json::from_value(json!({"projectId": "p1", "mode": "issues"})).unwrap();
        assert_eq!(params.validate().unwrap().mode, TasksListMode::Issues);
    }

    #[test]
    fn remote_source_parses_and_round_trips() {
        let params: TasksListParams =
            serde_json::from_value(json!({"projectId": "p1", "source": "upstream"})).unwrap();
        assert_eq!(
            params.validate().unwrap().source,
            Some(TasksRemoteSource::Upstream)
        );
        let params: TasksListParams =
            serde_json::from_value(json!({"projectId": "p1", "source": "origin"})).unwrap();
        assert_eq!(
            params.validate().unwrap().source,
            Some(TasksRemoteSource::Origin)
        );
        // The topology result omits absent remotes entirely (never null),
        // so the renderer can distinguish "no upstream" from "not asked".
        let both = serde_json::to_value(TasksRemotesResult {
            origin: Some("example/repo".into()),
            upstream: Some("upstream-org/repo".into()),
        })
        .unwrap();
        assert_eq!(
            both,
            json!({"origin": "example/repo", "upstream": "upstream-org/repo"})
        );
        let sparse = serde_json::to_value(TasksRemotesResult {
            origin: Some("example/repo".into()),
            upstream: None,
        })
        .unwrap();
        assert_eq!(sparse, json!({"origin": "example/repo"}));
        assert!(
            TasksRemotesParams {
                project_id: "".into()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn pull_request_round_trips_with_exact_wire_keys() {
        let pr = TaskPullRequest {
            number: 12,
            title: "Add the PR flow".into(),
            state: TaskPullRequestState::Open,
            labels: vec![TaskLabel {
                name: "enhancement".into(),
                color: None,
            }],
            assignees: vec!["octocat".into()],
            author: Some("helix".into()),
            updated_at: "2026-09-06T12:00:00Z".into(),
            url: "https://github.com/example/repo/pull/12".into(),
            review_decision: Some(PRReviewDecision::Approved),
            checks: Some(ProviderCheckSummary {
                state: CheckState::Success,
                total: 3,
                passed: 3,
                failed: 0,
                pending: 0,
                neutral: 0,
            }),
            mergeable: Some(PRMergeableState::Mergeable),
            is_draft: false,
            head_ref_name: Some("add-pr-flow".into()),
            base_ref_name: Some("main".into()),
        };
        let value = serde_json::to_value(&pr).unwrap();
        assert_eq!(
            value,
            json!({
                "number": 12, "title": "Add the PR flow", "state": "open",
                "labels": [{"name": "enhancement"}],
                "assignees": ["octocat"],
                "author": "helix",
                "updatedAt": "2026-09-06T12:00:00Z",
                "url": "https://github.com/example/repo/pull/12",
                "reviewDecision": "APPROVED",
                "checks": {"state": "success", "total": 3, "passed": 3,
                           "failed": 0, "pending": 0, "neutral": 0},
                "mergeable": "MERGEABLE",
                "isDraft": false,
                "headRefName": "add-pr-flow",
                "baseRefName": "main",
            })
        );
        let back: TaskPullRequest = serde_json::from_value(value).unwrap();
        assert_eq!(back, pr);
    }

    #[test]
    fn show_and_start_reject_issue_zero_and_links_require_a_project() {
        let show = TasksShowParams {
            project_id: "p1".into(),
            number: 0,
            source: None,
        };
        assert!(show.validate().is_err());
        let start = TasksStartParams {
            project_id: "p1".into(),
            number: 12,
            mode: None,
            source: None,
        };
        assert_eq!(start.validate().unwrap().0, TasksListMode::Issues);
        let start = TasksStartParams {
            project_id: "p1".into(),
            number: 12,
            mode: Some(TasksListMode::Pulls),
            source: None,
        };
        assert_eq!(start.validate().unwrap().0, TasksListMode::Pulls);
        assert!(
            TasksLinksParams {
                project_id: "".into()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn start_result_carries_the_worktree_and_link_under_plural_free_keys() {
        let worktree = Worktree {
            id: "w1".into(),
            project_id: "p1".into(),
            workspace_id: "ws1".into(),
            path: "/data/workspaces/repo/issue-7-fix-the-sidebar".into(),
            branch: "issue-7-fix-the-sidebar".into(),
            head: "abc123".into(),
            base_ref: None,
            title: None,
            created_at: "2026-09-06T12:00:00Z".into(),
        };
        let result = TasksStartResult {
            issue_number: 7,
            worktree,
            link: TaskLink {
                project_id: "p1".into(),
                issue_number: 7,
                worktree_id: "w1".into(),
                branch: "issue-7-fix-the-sidebar".into(),
                created_at: "2026-09-06T12:00:00Z".into(),
            },
            head_branch: None,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["issueNumber"], 7);
        assert_eq!(value["worktree"]["branch"], "issue-7-fix-the-sidebar");
        assert_eq!(value["link"]["worktreeId"], "w1");
        assert_eq!(value["link"]["branch"], "issue-7-fix-the-sidebar");
        // Absent on the issues path: the key must be missing, not null.
        assert!(value.get("headBranch").is_none());
        let back: TasksStartResult = serde_json::from_value(value).unwrap();
        assert_eq!(back.link.issue_number, 7);
        assert_eq!(back.head_branch, None);
    }

    #[test]
    fn links_result_wraps_links_under_the_plural_key() {
        let result = TasksLinksResult { links: vec![] };
        let value = serde_json::to_value(&result).unwrap();
        assert!(value["links"].is_array());
        assert_eq!(
            serde_json::from_value::<Value>(json!({"links": [], "future": true})).unwrap()["links"],
            Value::Array(vec![])
        );
    }
}
