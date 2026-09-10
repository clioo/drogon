//! Durable issue associations for card properties; distinct from provider authentication.
use serde::{Deserialize, Serialize};

pub const CAPABILITY: &str = "worktree.issue-links.v1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IssueProvider {
    Linear,
    Jira,
}
impl IssueProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Linear => "linear",
            Self::Jira => "jira",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssueDetails {
    pub provider: IssueProvider,
    pub identifier: String,
    pub title: String,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub state_name: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeIssueLink {
    pub worktree_id: String,
    #[serde(flatten)]
    pub issue: IssueDetails,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IssueLinksParams {
    pub project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkIssueParams {
    pub worktree_id: String,
    pub issue: IssueDetails,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnlinkIssueParams {
    pub worktree_id: String,
    pub provider: IssueProvider,
}
