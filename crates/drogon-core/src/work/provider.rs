//! External ticket providers for the Work board.
//!
//! The board speaks to one trait, [`WorkProvider`]: list boards, read a
//! board's columns and sprints, list and read issues, change an issue's
//! status, and move it between sprints. Jira is the first implementation
//! ([`JiraProvider`], agile REST API over the Tasks page's saved Jira
//! connection); another system (Linear, GitHub Projects…) plugs in by
//! implementing the same trait and registering in [`provider_for`], without
//! touching the board, sync or UI code that consumes [`ExtIssue`].

use serde::Serialize;
use serde_json::{Value, json};

use crate::jira::JiraState;
use crate::jira::client::{HttpRequest, JiraRequestError, api_base_path, jira_request};
use crate::jira::mapping::{as_record, as_string, as_string_or};
use crate::jira::ops::{ClientForSite, encode_path_segment, first_client};
use drogon_protocol::RpcError;

/// Provider kinds the board knows; the only one today is Jira.
pub(crate) const PROVIDERS: &[&str] = &["jira"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtBoard {
    pub id: String,
    pub name: String,
    /// `scrum` (has sprints) or `kanban`.
    pub kind: String,
    pub project_key: Option<String>,
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtStatus {
    pub id: String,
    pub name: String,
    /// `new`, `indeterminate` or `done`.
    pub category: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtColumn {
    pub name: String,
    pub statuses: Vec<ExtStatus>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtSprint {
    pub id: String,
    pub name: String,
    /// `active`, `closed` or `future`.
    pub state: String,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtIssue {
    pub id: String,
    pub key: String,
    pub url: String,
    pub title: String,
    pub description: String,
    pub issue_type: Option<String>,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub status: ExtStatus,
    /// The issue's current (active or future) sprint.
    pub sprint: Option<ExtSprint>,
    /// Closed sprints the issue passed through.
    pub closed_sprints: Vec<ExtSprint>,
    pub project: Option<String>,
    pub updated: String,
}

/// Which issues of a board to list for import.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum IssueScope {
    Board,
    Backlog,
    Sprint(String),
}

/// A provider failure: the message is shown to the user as is.
#[derive(Debug, Clone)]
pub(crate) struct ProviderError {
    pub code: String,
    pub message: String,
}

impl ProviderError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

impl From<ProviderError> for RpcError {
    fn from(error: ProviderError) -> Self {
        RpcError::new(&error.code, error.message)
    }
}

pub(crate) type ProviderResult<T> = Result<T, ProviderError>;

pub(crate) trait WorkProvider {
    fn kind(&self) -> &'static str;
    fn list_boards(&self) -> ProviderResult<Vec<ExtBoard>>;
    fn board(&self, board_id: &str) -> ProviderResult<ExtBoard>;
    fn board_columns(&self, board_id: &str) -> ProviderResult<Vec<ExtColumn>>;
    /// Every status the site knows (what a column can be mapped to).
    fn list_statuses(&self) -> ProviderResult<Vec<ExtStatus>>;
    /// Every sprint of a scrum board (empty for a kanban board).
    fn list_sprints(&self, board_id: &str) -> ProviderResult<Vec<ExtSprint>>;
    fn list_issues(&self, board_id: &str, scope: &IssueScope) -> ProviderResult<Vec<ExtIssue>>;
    /// `Ok(None)` when the issue no longer exists (or is no longer visible).
    fn get_issue(&self, key: &str) -> ProviderResult<Option<ExtIssue>>;
    /// Move the issue to `status_id` through the workflow; refuses when no
    /// transition from its current status leads there.
    fn set_status(&self, key: &str, status_id: &str) -> ProviderResult<()>;
    /// Put the issue in `sprint_id`, or in the backlog for `None`.
    fn move_to_sprint(&self, key: &str, sprint_id: Option<&str>) -> ProviderResult<()>;
}

/// The provider for a board source. `site` selects the account/site within
/// the provider (a Jira site id; `None` = the provider's default).
pub(crate) fn provider_for<'a>(
    kind: &str,
    jira: &'a JiraState,
    site: Option<&str>,
) -> ProviderResult<Box<dyn WorkProvider + 'a>> {
    match kind {
        "jira" => Ok(Box::new(JiraProvider::new(jira, site)?)),
        other => Err(ProviderError::new(
            "invalid_argument",
            format!(
                "unknown ticket provider {other}; supported: {}",
                PROVIDERS.join(", ")
            ),
        )),
    }
}

// ------------------------------------------------------------------ Jira --

pub(crate) struct JiraProvider<'a> {
    state: &'a JiraState,
    client: ClientForSite,
}

const AGILE: &str = "/rest/agile/1.0";
const ISSUE_FIELDS: &str =
    "summary,description,issuetype,priority,status,assignee,project,updated,sprint,closedSprints";

fn jira_error(error: &JiraRequestError) -> ProviderError {
    let rpc = crate::jira::client::to_rpc_error(error);
    ProviderError::new(&rpc.code, rpc.message)
}

impl<'a> JiraProvider<'a> {
    pub(crate) fn new(state: &'a JiraState, site: Option<&str>) -> ProviderResult<Self> {
        let client = first_client(state, site)
            .map_err(|e| ProviderError::new(&e.code, e.message))?
            .ok_or_else(|| {
                ProviderError::new(
                    "jira_not_connected",
                    "Jira is not connected. Connect it from the Tasks page first.",
                )
            })?;
        Ok(Self { state, client })
    }

    pub(crate) fn site_id(&self) -> &str {
        &self.client.site.id
    }

    pub(crate) fn site_url(&self) -> &str {
        &self.client.site.site_url
    }

    fn api(&self) -> &'static str {
        api_base_path(self.client.site.auth_type)
    }

    fn call(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, JiraRequestError> {
        let queue = self.state.site_queue(&self.client.site.id);
        let _permit = queue.lock().unwrap();
        let request = HttpRequest {
            url: format!("{}{path}", self.client.site.site_url),
            method,
            authorization: &self.client.authorization,
            body: body.map(|b| b.to_string()),
            cancel: None,
            timeout: crate::jira::client::REQUEST_TIMEOUT,
        };
        let result = jira_request(&request);
        if let Err(error) = &result
            && error.status() == Some(401)
        {
            crate::jira::ops::clear_token_for(self.state, &self.client.site.id);
        }
        result
    }

    fn get(&self, path: &str) -> ProviderResult<Value> {
        self.call("GET", path, None).map_err(|e| jira_error(&e))
    }

    /// Walks a paged agile collection (`values` or `issues`).
    fn paged(&self, path: &str, key: &str) -> ProviderResult<Vec<Value>> {
        let mut out = Vec::new();
        let separator = if path.contains('?') { '&' } else { '?' };
        for _ in 0..50 {
            let page = self.get(&format!(
                "{path}{separator}startAt={}&maxResults=50",
                out.len()
            ))?;
            let items = page
                .get(key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let got = items.len();
            out.extend(items);
            let total = page.get("total").and_then(Value::as_u64);
            let last = page.get("isLast").and_then(Value::as_bool).unwrap_or(false);
            if got == 0 || last || total.is_some_and(|t| out.len() as u64 >= t) {
                break;
            }
        }
        Ok(out)
    }

    fn statuses(&self) -> ProviderResult<Vec<ExtStatus>> {
        let raw = self.get(&format!("{}/status", self.api()))?;
        Ok(raw
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|s| map_status(Some(s)))
            .collect())
    }

    fn map_issue(&self, raw: &Value) -> ExtIssue {
        let fields = as_record(raw.get("fields"));
        let key = as_string(raw.get("key"));
        let named = |field: &str| {
            fields
                .get(field)
                .and_then(|v| v.get("name").or_else(|| v.get("displayName")))
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        let description = match fields.get("description") {
            Some(Value::String(text)) => text.clone(),
            other => crate::jira::adf::adf_to_markdown_text(other),
        };
        ExtIssue {
            id: as_string_or(raw.get("id"), &key),
            url: format!("{}/browse/{key}", self.client.site.site_url),
            title: as_string(fields.get("summary")),
            description,
            issue_type: named("issuetype"),
            priority: named("priority"),
            assignee: fields
                .get("assignee")
                .and_then(|v| v.get("displayName"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            status: map_status(fields.get("status")),
            sprint: fields.get("sprint").and_then(map_sprint),
            closed_sprints: fields
                .get("closedSprints")
                .and_then(Value::as_array)
                .map(|all| all.iter().filter_map(map_sprint).collect())
                .unwrap_or_default(),
            project: fields
                .get("project")
                .and_then(|v| v.get("name"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            updated: as_string(fields.get("updated")),
            key,
        }
    }

    fn map_board(raw: &Value) -> ExtBoard {
        let location = raw.get("location");
        let text = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_owned);
        ExtBoard {
            id: match raw.get("id") {
                Some(Value::Number(n)) => n.to_string(),
                other => as_string(other),
            },
            name: as_string(raw.get("name")),
            kind: as_string_or(raw.get("type"), "kanban"),
            project_key: text(location.and_then(|l| l.get("projectKey"))),
            project_name: text(location.and_then(|l| l.get("projectName"))),
        }
    }
}

fn map_status(value: Option<&Value>) -> ExtStatus {
    let status = as_record(value);
    let category = as_record(status.get("statusCategory"));
    ExtStatus {
        id: as_string(status.get("id")),
        name: as_string_or(status.get("name"), "Unknown"),
        category: as_string_or(category.get("key"), "undefined"),
    }
}

fn map_sprint(raw: &Value) -> Option<ExtSprint> {
    if raw.is_null() {
        return None;
    }
    let id = match raw.get("id") {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        _ => return None,
    };
    let text = |f: &str| raw.get(f).and_then(Value::as_str).map(str::to_owned);
    Some(ExtSprint {
        id,
        name: text("name").unwrap_or_default(),
        state: text("state")
            .unwrap_or_else(|| "future".into())
            .to_lowercase(),
        start: text("startDate"),
        end: text("endDate"),
    })
}

impl WorkProvider for JiraProvider<'_> {
    fn kind(&self) -> &'static str {
        "jira"
    }

    fn list_boards(&self) -> ProviderResult<Vec<ExtBoard>> {
        Ok(self
            .paged(&format!("{AGILE}/board"), "values")?
            .iter()
            .map(Self::map_board)
            .collect())
    }

    fn board(&self, board_id: &str) -> ProviderResult<ExtBoard> {
        let raw = self.get(&format!("{AGILE}/board/{}", encode_path_segment(board_id)));
        match raw {
            Ok(raw) => Ok(Self::map_board(&raw)),
            // Some sites answer the board collection but not the item; fall
            // back to the collection.
            Err(_) => self
                .list_boards()?
                .into_iter()
                .find(|b| b.id == board_id)
                .ok_or_else(|| {
                    ProviderError::new("not_found", format!("Jira board {board_id} not found"))
                }),
        }
    }

    fn board_columns(&self, board_id: &str) -> ProviderResult<Vec<ExtColumn>> {
        let config = self.get(&format!(
            "{AGILE}/board/{}/configuration",
            encode_path_segment(board_id)
        ))?;
        let names = self.statuses().unwrap_or_default();
        let columns = config
            .get("columnConfig")
            .and_then(|c| c.get("columns"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(columns
            .iter()
            .map(|column| ExtColumn {
                name: as_string(column.get("name")),
                statuses: column
                    .get("statuses")
                    .and_then(Value::as_array)
                    .map(|all| {
                        all.iter()
                            .map(|s| {
                                let id = as_string(s.get("id"));
                                names
                                    .iter()
                                    .find(|n| n.id == id)
                                    .cloned()
                                    .unwrap_or(ExtStatus {
                                        name: id.clone(),
                                        id,
                                        category: "undefined".into(),
                                    })
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect())
    }

    fn list_statuses(&self) -> ProviderResult<Vec<ExtStatus>> {
        self.statuses()
    }

    fn list_sprints(&self, board_id: &str) -> ProviderResult<Vec<ExtSprint>> {
        let board = self.board(board_id)?;
        if board.kind != "scrum" {
            return Ok(Vec::new());
        }
        Ok(self
            .paged(
                &format!(
                    "{AGILE}/board/{}/sprint?state=active,closed,future",
                    encode_path_segment(board_id)
                ),
                "values",
            )?
            .iter()
            .filter_map(map_sprint)
            .collect())
    }

    fn list_issues(&self, board_id: &str, scope: &IssueScope) -> ProviderResult<Vec<ExtIssue>> {
        let board = encode_path_segment(board_id);
        let path = match scope {
            IssueScope::Board => format!("{AGILE}/board/{board}/issue?fields={ISSUE_FIELDS}"),
            IssueScope::Backlog => format!("{AGILE}/board/{board}/backlog?fields={ISSUE_FIELDS}"),
            IssueScope::Sprint(id) => format!(
                "{AGILE}/board/{board}/sprint/{}/issue?fields={ISSUE_FIELDS}",
                encode_path_segment(id)
            ),
        };
        Ok(self
            .paged(&path, "issues")?
            .iter()
            .map(|raw| self.map_issue(raw))
            .collect())
    }

    fn get_issue(&self, key: &str) -> ProviderResult<Option<ExtIssue>> {
        match self.call(
            "GET",
            &format!(
                "{AGILE}/issue/{}?fields={ISSUE_FIELDS}",
                encode_path_segment(key)
            ),
            None,
        ) {
            Ok(raw) => Ok(Some(self.map_issue(&raw))),
            Err(error) if error.status() == Some(404) => Ok(None),
            Err(error) => Err(jira_error(&error)),
        }
    }

    fn set_status(&self, key: &str, status_id: &str) -> ProviderResult<()> {
        let listed = self.get(&format!(
            "{}/issue/{}/transitions",
            self.api(),
            encode_path_segment(key)
        ))?;
        let transitions = listed
            .get("transitions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let Some(transition) = transitions
            .iter()
            .find(|t| t.get("to").map(|to| as_string(to.get("id"))).as_deref() == Some(status_id))
        else {
            let reachable: Vec<String> = transitions
                .iter()
                .filter_map(|t| {
                    t.get("to")
                        .and_then(|to| to.get("name"))
                        .and_then(Value::as_str)
                })
                .map(str::to_owned)
                .collect();
            return Err(ProviderError::new(
                "jira_transition_refused",
                format!(
                    "Jira's workflow has no transition from this issue's status to that one (reachable: {})",
                    if reachable.is_empty() {
                        "none".to_string()
                    } else {
                        reachable.join(", ")
                    }
                ),
            ));
        };
        self.call(
            "POST",
            &format!(
                "{}/issue/{}/transitions",
                self.api(),
                encode_path_segment(key)
            ),
            Some(json!({ "transition": { "id": as_string(transition.get("id")) } })),
        )
        .map(|_| ())
        .map_err(|e| jira_error(&e))
    }

    fn move_to_sprint(&self, key: &str, sprint_id: Option<&str>) -> ProviderResult<()> {
        let path = match sprint_id {
            Some(id) => format!("{AGILE}/sprint/{}/issue", encode_path_segment(id)),
            None => format!("{AGILE}/backlog/issue"),
        };
        self.call("POST", &path, Some(json!({ "issues": [key] })))
            .map(|_| ())
            .map_err(|e| jira_error(&e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sprints_map_numeric_and_string_ids_and_lowercase_states() {
        let sprint = map_sprint(
            &json!({"id": 25, "name": "Sprint 25", "state": "ACTIVE", "startDate": "s"}),
        )
        .unwrap();
        assert_eq!(sprint.id, "25");
        assert_eq!(sprint.state, "active");
        assert_eq!(sprint.start.as_deref(), Some("s"));
        assert!(map_sprint(&Value::Null).is_none());
        assert!(map_sprint(&json!({"name": "no id"})).is_none());
    }

    #[test]
    fn boards_map_location_and_kind() {
        let board = JiraProvider::map_board(&json!({"id": 7, "name": "P", "type": "scrum",
            "location": {"projectKey": "APP", "projectName": "Platform"}}));
        assert_eq!(board.id, "7");
        assert_eq!(board.kind, "scrum");
        assert_eq!(board.project_key.as_deref(), Some("APP"));
    }

    #[test]
    fn unknown_providers_are_refused_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let jira = JiraState::new(dir.path());
        let error = provider_for("linear", &jira, None).err().unwrap();
        assert!(error.message.contains("unknown ticket provider linear"));
        let error = provider_for("jira", &jira, None).err().unwrap();
        assert_eq!(error.code, "jira_not_connected");
    }
}
