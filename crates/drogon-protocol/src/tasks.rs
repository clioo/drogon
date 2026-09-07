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
/// At most this many issues per `tasks.list` call; older issues are cut,
/// never paged over multiple calls in this journey.
pub const MAX_TASKS_ISSUES: usize = 100;

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
    pub updated_at: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// The durable link between an issue and the worktree `tasks.start`
/// created for it. Mirrors the `task_links` row the core keeps.
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
}

impl TasksListParams {
    pub fn validate(&self) -> Result<(TaskIssueState, Option<String>), RpcError> {
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
        Ok((state, query))
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksShowParams {
    pub project_id: String,
    pub number: u64,
}

impl TasksShowParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_project_id(&self.project_id)?;
        validate_issue_number(self.number)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksStartParams {
    pub project_id: String,
    pub number: u64,
}

impl TasksStartParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_project_id(&self.project_id)?;
        validate_issue_number(self.number)
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksListResult {
    /// `owner/repo` the list was read from, so the renderer never guesses
    /// which remote answered.
    pub repo: String,
    pub issues: Vec<TaskIssue>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksShowResult {
    pub issue: TaskIssue,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksStartResult {
    pub issue_number: u64,
    pub worktree: Worktree,
    pub link: TaskLink,
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
        assert_eq!(params.validate().unwrap().0, TaskIssueState::Open);
    }

    #[test]
    fn list_params_reject_bad_identity_and_oversized_queries() {
        let bad = TasksListParams {
            project_id: "".into(),
            state: None,
            query: None,
        };
        assert!(bad.validate().is_err());
        let bad = TasksListParams {
            project_id: "p1".into(),
            state: None,
            query: Some("x".repeat(MAX_TASKS_QUERY_BYTES + 1)),
        };
        assert!(bad.validate().is_err());
        let blank = TasksListParams {
            project_id: "p1".into(),
            state: Some(TaskIssueState::Closed),
            query: Some("   ".into()),
        };
        let (state, query) = blank.validate().unwrap();
        assert_eq!(state, TaskIssueState::Closed);
        assert_eq!(query, None);
    }

    #[test]
    fn show_and_start_reject_issue_zero_and_links_require_a_project() {
        let show = TasksShowParams {
            project_id: "p1".into(),
            number: 0,
        };
        assert!(show.validate().is_err());
        let start = TasksStartParams {
            project_id: "p1".into(),
            number: 12,
        };
        start.validate().unwrap();
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
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["issueNumber"], 7);
        assert_eq!(value["worktree"]["branch"], "issue-7-fix-the-sidebar");
        assert_eq!(value["link"]["worktreeId"], "w1");
        assert_eq!(value["link"]["branch"], "issue-7-fix-the-sidebar");
        let back: TasksStartResult = serde_json::from_value(value).unwrap();
        assert_eq!(back.link.issue_number, 7);
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
