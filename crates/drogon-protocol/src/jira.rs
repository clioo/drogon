//! Jira integration protocol types (R17-A), ported from the orca-drogon fork's
//! `src/shared/jira-types.ts`.
//! MIT Copyright (c) 2026 Lovecast Inc.

use serde::{Deserialize, Serialize};

/// `cloud` = Atlassian Cloud (email + API token, Basic auth, REST v3).
/// `server` = self-hosted Jira Server/Data Center (PAT or password, REST v2).
/// Older stored sites omit the field and mean `cloud`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum JiraAuthType {
    #[default]
    Cloud,
    Server,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSite {
    pub id: String,
    pub site_url: String,
    pub email: String,
    pub display_name: String,
    pub account_id: String,
    #[serde(default)]
    pub auth_type: JiraAuthType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraViewer {
    pub account_id: String,
    pub display_name: String,
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraConnectionStatus {
    pub connected: bool,
    pub viewer: Option<JiraViewer>,
    #[serde(default)]
    pub sites: Vec<JiraSite>,
    pub active_site_id: Option<String>,
    pub selected_site_id: Option<String>,
    /// Set when a stored token file exists but could not be decrypted, so
    /// the UI can explain reads failing while the connection still looks saved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraProject {
    pub id: String,
    pub key: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueType {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtask: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCreateFieldAllowedValue {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCreateField {
    pub key: String,
    pub name: String,
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<JiraCreateFieldSchema>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_values: Option<Vec<JiraCreateFieldAllowedValue>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCreateFieldSchema {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraUser {
    pub account_id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraPriority {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraStatus {
    pub id: String,
    pub name: String,
    pub category_key: String,
    pub category_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_name: Option<String>,
}

/// The fork's four list filters. Their JQL lives in the daemon
/// (`filter_to_jql`), ported from the fork's `jira-issue-search.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JiraIssueFilter {
    Assigned,
    Reported,
    All,
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub id: String,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub site_name: Option<String>,
    pub title: String,
    pub url: String,
    pub project: JiraProject,
    pub issue_type: JiraIssueType,
    pub status: JiraStatus,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee: Option<JiraUser>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reporter: Option<JiraUser>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<JiraPriority>,
    pub updated_at: String,
    pub created_at: String,
}

/// Search/list result: the fork's renderer boundary returns a bare issue
/// array; Drogon adds `total`/`isLast` additively so the Tasks page can
/// render the "N shown" counter and drive paging without a second call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSearchResult {
    pub issues: Vec<JiraIssue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_last: Option<bool>,
}

// --- RPC parameter shapes -------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraConnectParams {
    pub site_url: String,
    #[serde(default)]
    pub email: String,
    pub api_token: String,
    #[serde(default)]
    pub auth_type: Option<JiraAuthType>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSiteParams {
    #[serde(default)]
    pub site_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSearchParams {
    pub jql: String,
    #[serde(default)]
    pub limit: Option<u32>,
    /// Additive over the fork (which always starts at 0): page offset for
    /// explicit paging; absent behaves exactly like the fork.
    #[serde(default)]
    pub start_at: Option<u32>,
    #[serde(default)]
    pub site_id: Option<String>,
    /// Renderer-chosen id: reusing it cancels the previous in-flight search
    /// with the same id (the fork aborts a search when the query changes).
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraListParams {
    #[serde(default)]
    pub filter: Option<JiraIssueFilter>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub site_id: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueTypesParams {
    pub project_id_or_key: String,
    #[serde(default)]
    pub site_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCreateFieldsParams {
    pub project_id_or_key: String,
    pub issue_type_id: String,
    #[serde(default)]
    pub site_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCancelParams {
    #[serde(default)]
    pub request_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn site_round_trips_camel_case_with_cloud_default() {
        let site: JiraSite = serde_json::from_value(json!({
            "id": "s1", "siteUrl": "https://x.atlassian.net",
            "email": "a@b.c", "displayName": "A", "accountId": "acct-1"
        }))
        .unwrap();
        assert_eq!(site.auth_type, JiraAuthType::Cloud);
        let value = serde_json::to_value(&site).unwrap();
        assert_eq!(value["siteUrl"], "https://x.atlassian.net");
        assert!(!value.as_object().unwrap().contains_key("siteId"));
    }

    #[test]
    fn filter_deserializes_lowercase() {
        for (raw, expected) in [
            ("assigned", JiraIssueFilter::Assigned),
            ("reported", JiraIssueFilter::Reported),
            ("all", JiraIssueFilter::All),
            ("done", JiraIssueFilter::Done),
        ] {
            let parsed: JiraIssueFilter = serde_json::from_str(&format!("\"{raw}\"")).unwrap();
            assert_eq!(parsed, expected);
        }
    }
}
