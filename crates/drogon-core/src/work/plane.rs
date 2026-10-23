//! Plane REST API v1: workspace projects, states and cycles become Work
//! boards, columns and sprints. See developers.plane.so/api-reference.
//! State changes PATCH work-items; cycles use the documented membership
//! POST/DELETE endpoints (the work-item PATCH has no cycle field).

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::{Value, json};

use super::provider::{
    ExtBoard, ExtColumn, ExtIssue, ExtSprint, ExtStatus, IssueRef, IssueScope, NewIssue,
    ProviderError, ProviderResult, WorkProvider,
};
use crate::jira::client::{
    HttpRequest, JiraRequestError, REQUEST_TIMEOUT, http_json_with_auth_header,
};
use crate::jira::ops::encode_path_segment;

pub(crate) const DEFAULT_API_URL: &str = "https://api.plane.so";

pub(crate) struct PlaneProvider {
    token: String,
    api_url: String,
    workspace: String,
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

fn invalid_response(message: &str) -> ProviderError {
    ProviderError::new("plane_error", format!("Plane returned {message}"))
}

fn request_error(error: JiraRequestError) -> ProviderError {
    let code = match error.status() {
        Some(401) => "plane_auth_required",
        Some(403) => "plane_forbidden",
        Some(404) => "not_found",
        Some(429) => "plane_rate_limited",
        _ => "plane_error",
    };
    let message = match &error {
        JiraRequestError::Timeout => "Plane request timed out.".into(),
        JiraRequestError::Cancelled => "Plane request cancelled.".into(),
        JiraRequestError::Api {
            retry_after: Some(seconds),
            status: 429,
            ..
        } => format!(
            "{} (retry after {seconds}s)",
            crate::jira::client::failure_message(&error)
        ),
        _ => crate::jira::client::failure_message(&error),
    };
    ProviderError::new(code, message)
}

/// Refuse a URL or path here: the slug is one workspace URL segment.
pub(crate) fn workspace_slug(value: &str) -> ProviderResult<String> {
    let slug = value.trim();
    if slug.is_empty()
        || !slug
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(ProviderError::new(
            "invalid_argument",
            "workspaceSlug is required for Plane: enter the slug from https://app.plane.so/<workspace-slug>/projects/",
        ));
    }
    Ok(slug.to_string())
}

impl PlaneProvider {
    pub(crate) fn new(token: String, api_url: Option<String>, workspace: String) -> Self {
        Self {
            token,
            api_url: api_url
                .unwrap_or_else(|| DEFAULT_API_URL.into())
                .trim_end_matches('/')
                .into(),
            workspace,
        }
    }

    fn call(&self, method: &str, path: &str, body: Option<Value>) -> ProviderResult<Value> {
        http_json_with_auth_header(
            &HttpRequest {
                url: format!("{}{path}", self.api_url),
                method,
                authorization: &self.token,
                body: body.map(|b| b.to_string()),
                cancel: None,
                timeout: REQUEST_TIMEOUT,
            },
            "Plane",
            "X-API-Key",
        )
        .map_err(request_error)
    }

    fn root(&self) -> String {
        format!(
            "/api/v1/workspaces/{}",
            encode_path_segment(&self.workspace)
        )
    }

    fn project_path(&self, board: &str) -> String {
        format!("{}/projects/{}", self.root(), encode_path_segment(board))
    }

    fn paged(&self, path: &str) -> ProviderResult<Vec<Value>> {
        let mut items = Vec::new();
        let mut cursor: Option<String> = None;
        let mut seen = HashSet::new();
        for _ in 0..100 {
            let separator = if path.contains('?') { '&' } else { '?' };
            let mut url = format!("{path}{separator}per_page=100");
            if let Some(cursor) = &cursor {
                url.push_str(&format!("&cursor={}", encode_path_segment(cursor)));
            }
            let page = self.call("GET", &url, None)?;
            let (values, next) = page_values(&page)?;
            items.extend(values.iter().cloned());
            let Some(next) = next else { return Ok(items) };
            if !seen.insert(next.clone()) {
                return Err(invalid_response("a repeated pagination cursor"));
            }
            cursor = Some(next);
        }
        Err(invalid_response(
            "too many pages; narrow the project before importing",
        ))
    }

    pub(crate) fn viewer(&self) -> ProviderResult<String> {
        let user = self.call("GET", "/api/v1/users/me/", None)?;
        if user["id"].as_str().is_none_or(str::is_empty) {
            return Err(invalid_response("a user without an id"));
        }
        Ok(user["display_name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| user["first_name"].as_str())
            .unwrap_or("Plane user")
            .into())
    }

    fn states(&self, board: &str) -> ProviderResult<Vec<ExtStatus>> {
        let mut states = self.paged(&format!("{}/states/", self.project_path(board)))?;
        states.sort_by(|a, b| {
            group_rank(&a["group"])
                .cmp(&group_rank(&b["group"]))
                .then_with(|| sequence(a).total_cmp(&sequence(b)))
        });
        Ok(states.iter().map(map_state).collect())
    }

    /// v1 work items do not carry cycle membership. Read the documented
    /// cycle-issues collection rather than assuming a cycle field exists.
    fn memberships(
        &self,
        board: &str,
        cycles: &[ExtSprint],
    ) -> ProviderResult<HashMap<String, Vec<ExtSprint>>> {
        let mut memberships: HashMap<String, Vec<ExtSprint>> = HashMap::new();
        for cycle in cycles {
            for member in self.paged(&format!(
                "{}/cycles/{}/cycle-issues/",
                self.project_path(board),
                encode_path_segment(&cycle.id)
            ))? {
                let id = member["issue"]
                    .as_str()
                    .ok_or_else(|| invalid_response("a cycle membership without an issue id"))?;
                memberships
                    .entry(id.into())
                    .or_default()
                    .push(cycle.clone());
            }
        }
        Ok(memberships)
    }

    fn map_issue(
        &self,
        raw: &Value,
        board: &ExtBoard,
        states: &[ExtStatus],
        cycles: &[ExtSprint],
        me: Option<&str>,
    ) -> ProviderResult<ExtIssue> {
        let id = raw["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| invalid_response("a work item without an id"))?;
        let number = raw["sequence_id"]
            .as_u64()
            .ok_or_else(|| invalid_response("a work item without a sequence_id"))?;
        let identifier = board
            .project_key
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| invalid_response("a project without an identifier"))?;
        let state_id = raw["state"]
            .as_str()
            .or_else(|| raw["state"]["id"].as_str());
        let status = states
            .iter()
            .find(|s| Some(s.id.as_str()) == state_id)
            .cloned()
            .ok_or_else(|| invalid_response("a work item with an unknown state"))?;
        let assignees = raw["assignees"].as_array();
        // Work has one assignee slot; prefer the connected user so "mine"
        // and auto-import also work when Plane assigns several people.
        let assignee = assignees.and_then(|people| {
            people
                .iter()
                .find(|person| {
                    me.is_some() && person.as_str().or_else(|| person["id"].as_str()) == me
                })
                .or_else(|| people.first())
        });
        let assignee_id = assignee.and_then(|a| a.as_str().or_else(|| a["id"].as_str()));
        let name = assignee
            .and_then(|a| {
                a["display_name"]
                    .as_str()
                    .filter(|n| !n.is_empty())
                    .or_else(|| a["first_name"].as_str())
            })
            .or(assignee_id);
        Ok(ExtIssue {
            id: id.into(),
            key: format!("{identifier}-{number}"),
            url: format!(
                "https://app.plane.so/{}/projects/{}/issues/{}/",
                encode_path_segment(&self.workspace),
                encode_path_segment(&board.id),
                encode_path_segment(id)
            ),
            title: text(&raw["name"]),
            description: text(&raw["description_stripped"]),
            issue_type: raw["type"]["name"].as_str().map(str::to_owned),
            priority: raw["priority"]
                .as_str()
                .filter(|p| *p != "none" && !p.is_empty())
                .map(str::to_owned),
            assignee: name.map(str::to_owned),
            assignee_id: assignee_id.map(str::to_owned),
            status,
            sprint: cycles.iter().find(|c| c.state != "closed").cloned(),
            closed_sprints: cycles
                .iter()
                .filter(|c| c.state == "closed")
                .cloned()
                .collect(),
            project: Some(board.name.clone()),
            updated: text(&raw["updated_at"]),
        })
    }

    fn raw_issue(&self, board: &str, issue: IssueRef) -> ProviderResult<Value> {
        let path = match issue.id {
            Some(id) => format!(
                "{}/work-items/{}/",
                self.project_path(board),
                encode_path_segment(id)
            ),
            None => format!(
                "{}/work-items/{}/",
                self.root(),
                encode_path_segment(issue.key)
            ),
        };
        let raw = self.call("GET", &format!("{path}?expand=assignees,type"), None)?;
        let project = raw["project"]
            .as_str()
            .or_else(|| raw["project"]["id"].as_str());
        if project.is_some_and(|p| p != board) {
            return Err(ProviderError::new(
                "not_found",
                "Plane work item belongs to another project",
            ));
        }
        Ok(raw)
    }

    fn issue_id(&self, board: &str, issue: IssueRef) -> ProviderResult<String> {
        if let Some(id) = issue.id {
            return Ok(id.into());
        }
        self.raw_issue(board, issue)?["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| invalid_response("a work item without an id"))
    }
}

fn page_values(page: &Value) -> ProviderResult<(&Vec<Value>, Option<String>)> {
    // Older v1 installations return unpaginated arrays for states.
    if let Some(values) = page.as_array() {
        return Ok((values, None));
    }
    let values = page["results"]
        .as_array()
        .ok_or_else(|| invalid_response("a collection without results"))?;
    let more = page["next_page_results"]
        .as_bool()
        .ok_or_else(|| invalid_response("a collection without pagination metadata"))?;
    let next = if more {
        Some(
            page["next_cursor"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| invalid_response("a page without its next cursor"))?
                .into(),
        )
    } else {
        None
    };
    Ok((values, next))
}

fn group_rank(group: &Value) -> u8 {
    match group.as_str().unwrap_or_default() {
        "backlog" => 0,
        "unstarted" => 1,
        "started" => 2,
        "completed" => 3,
        "cancelled" => 4,
        _ => 5,
    }
}

fn sequence(raw: &Value) -> f64 {
    raw["sequence"]
        .as_f64()
        .or_else(|| raw["sequence"].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or_default()
}

fn map_state(raw: &Value) -> ExtStatus {
    ExtStatus {
        id: text(&raw["id"]),
        name: text(&raw["name"]),
        category: match raw["group"].as_str() {
            Some("started") => "indeterminate",
            Some("completed" | "cancelled") => "done",
            _ => "new",
        }
        .into(),
    }
}

fn map_board(raw: &Value) -> ExtBoard {
    ExtBoard {
        id: text(&raw["id"]),
        name: text(&raw["name"]),
        kind: if raw["cycle_view"] == true {
            "scrum"
        } else {
            "kanban"
        }
        .into(),
        project_key: raw["identifier"].as_str().map(str::to_owned),
        project_name: raw["name"].as_str().map(str::to_owned),
    }
}

fn date(value: &Value) -> Option<NaiveDate> {
    let value = value.as_str()?;
    DateTime::parse_from_rfc3339(value)
        .map(|d| d.date_naive())
        .ok()
        .or_else(|| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

fn map_cycle(raw: &Value, today: NaiveDate) -> ProviderResult<ExtSprint> {
    let state = match raw["status"].as_str() {
        Some("completed") => "closed",
        Some("current") => "active",
        Some("upcoming" | "draft") => "future",
        _ if date(&raw["end_date"]).is_some_and(|end| end < today) => "closed",
        _ if date(&raw["start_date"]).is_some_and(|start| start <= today)
            && date(&raw["end_date"]).is_some_and(|end| today <= end) =>
        {
            "active"
        }
        _ => "future",
    };
    Ok(ExtSprint {
        id: raw["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| invalid_response("a cycle without an id"))?
            .into(),
        name: text(&raw["name"]),
        state: state.into(),
        start: raw["start_date"].as_str().map(str::to_owned),
        end: raw["end_date"].as_str().map(str::to_owned),
    })
}

impl WorkProvider for PlaneProvider {
    fn kind(&self) -> &'static str {
        "plane"
    }
    fn site(&self) -> (String, String) {
        (
            self.workspace.clone(),
            format!("https://app.plane.so/{}", self.workspace),
        )
    }
    fn list_boards(&self) -> ProviderResult<Vec<ExtBoard>> {
        Ok(self
            .paged(&format!("{}/projects/", self.root()))?
            .iter()
            .map(map_board)
            .collect())
    }
    fn board(&self, board_id: &str) -> ProviderResult<ExtBoard> {
        Ok(map_board(&self.call(
            "GET",
            &format!("{}/", self.project_path(board_id)),
            None,
        )?))
    }
    fn board_columns(&self, board_id: &str) -> ProviderResult<Vec<ExtColumn>> {
        Ok(self
            .states(board_id)?
            .into_iter()
            .map(|s| ExtColumn {
                name: s.name.clone(),
                statuses: vec![s],
            })
            .collect())
    }
    fn list_statuses(&self, board_id: &str) -> ProviderResult<Vec<ExtStatus>> {
        self.states(board_id)
    }
    fn me(&self) -> ProviderResult<Option<String>> {
        let user = self.call("GET", "/api/v1/users/me/", None)?;
        Ok(user["id"].as_str().map(str::to_owned))
    }
    fn list_sprints(&self, board_id: &str) -> ProviderResult<Vec<ExtSprint>> {
        if self.board(board_id)?.kind != "scrum" {
            return Ok(Vec::new());
        }
        self.paged(&format!("{}/cycles/", self.project_path(board_id)))?
            .iter()
            .map(|c| {
                map_cycle(
                    c,
                    DateTime::<Utc>::from_timestamp_millis(crate::now_unix_ms() as i64)
                        .unwrap_or_default()
                        .date_naive(),
                )
            })
            .collect()
    }
    fn list_issues(&self, board_id: &str, scope: &IssueScope) -> ProviderResult<Vec<ExtIssue>> {
        let board = self.board(board_id)?;
        let states = self.states(board_id)?;
        let cycles = self.list_sprints(board_id)?;
        let memberships = self.memberships(board_id, &cycles)?;
        let me = self.me()?;
        let mut issues = Vec::new();
        for raw in self.paged(&format!(
            "{}/work-items/?expand=assignees,type",
            self.project_path(board_id)
        ))? {
            let cycles = memberships
                .get(&text(&raw["id"]))
                .map(Vec::as_slice)
                .unwrap_or_default();
            let issue = self.map_issue(&raw, &board, &states, cycles, me.as_deref())?;
            let include = match scope {
                IssueScope::Board | IssueScope::Sync { .. } => true,
                IssueScope::Backlog => issue.sprint.is_none() && issue.status.category != "done",
                IssueScope::Sprint(id) => cycles.iter().any(|c| c.id == *id),
            };
            if include {
                issues.push(issue)
            }
        }
        Ok(issues)
    }
    fn get_issue(&self, board_id: &str, issue: IssueRef) -> ProviderResult<Option<ExtIssue>> {
        let raw = match self.raw_issue(board_id, issue) {
            Ok(raw) => raw,
            Err(e) if e.code == "not_found" => return Ok(None),
            Err(e) => return Err(e),
        };
        let board = self.board(board_id)?;
        let states = self.states(board_id)?;
        let cycles = self.list_sprints(board_id)?;
        let memberships = self.memberships(board_id, &cycles)?;
        let me = self.me()?;
        self.map_issue(
            &raw,
            &board,
            &states,
            memberships
                .get(&text(&raw["id"]))
                .map(Vec::as_slice)
                .unwrap_or_default(),
            me.as_deref(),
        )
        .map(Some)
    }
    fn set_status(&self, board_id: &str, issue: IssueRef, status_id: &str) -> ProviderResult<()> {
        let id = self.issue_id(board_id, issue)?;
        self.call(
            "PATCH",
            &format!(
                "{}/work-items/{}/",
                self.project_path(board_id),
                encode_path_segment(&id)
            ),
            Some(json!({"state": status_id})),
        )?;
        Ok(())
    }
    fn move_to_sprint(
        &self,
        board_id: &str,
        issue: IssueRef,
        sprint_id: Option<&str>,
    ) -> ProviderResult<()> {
        let id = self.issue_id(board_id, issue)?;
        if let Some(cycle) = sprint_id {
            self.call(
                "POST",
                &format!(
                    "{}/cycles/{}/cycle-issues/",
                    self.project_path(board_id),
                    encode_path_segment(cycle)
                ),
                Some(json!({"issues": [id]})),
            )?;
        } else {
            let cycles = self.list_sprints(board_id)?;
            let memberships = self.memberships(board_id, &cycles)?;
            for cycle in memberships.get(&id).into_iter().flatten() {
                self.call(
                    "DELETE",
                    &format!(
                        "{}/cycles/{}/cycle-issues/{}/",
                        self.project_path(board_id),
                        encode_path_segment(&cycle.id),
                        encode_path_segment(&id)
                    ),
                    None,
                )?;
            }
        }
        Ok(())
    }
    fn create_issue(
        &self,
        board_id: &str,
        new: &NewIssue,
    ) -> ProviderResult<(ExtIssue, Vec<String>)> {
        self.create_issue_confirmed(board_id, new, &mut |_| Ok(()))
    }

    fn create_issue_confirmed(
        &self,
        board_id: &str,
        new: &NewIssue,
        confirmed: &mut dyn FnMut(&ExtIssue) -> ProviderResult<()>,
    ) -> ProviderResult<(ExtIssue, Vec<String>)> {
        // Read mapping metadata before creation so it cannot hide a confirmed
        // POST if the service becomes unavailable during follow-up requests.
        let board = self.board(board_id)?;
        let states = self.states(board_id)?;
        let cycles = self.list_sprints(board_id)?;
        let me = self.me()?;
        let mut input = json!({"name": new.title, "description_html": format!("<p>{}</p>", new.description.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\n', "<br>"))});
        if let Some(state) = new.status_id {
            input["state"] = json!(state)
        }
        if new.assign_to_me
            && let Some(me) = &me
        {
            input["assignees"] = json!([me])
        }
        let raw = self.call(
            "POST",
            &format!("{}/work-items/", self.project_path(board_id)),
            Some(input),
        )?;
        let id = raw["id"]
            .as_str()
            .ok_or_else(|| invalid_response("a created work item without an id"))?;
        let issue_ref = IssueRef {
            key: "",
            id: Some(id),
        };
        let mut receipt = self.map_issue(&raw, &board, &states, &[], me.as_deref())?;
        if raw["description_stripped"].is_null() {
            receipt.description = new.description.into();
        }
        confirmed(&receipt)?;
        let mut warnings = Vec::new();
        if let Some(cycle) = new.sprint_id {
            match self.move_to_sprint(board_id, issue_ref, Some(cycle)) {
                Ok(()) => {
                    receipt.sprint = cycles.iter().find(|c| c.id == cycle).cloned();
                    confirmed(&receipt)?;
                }
                Err(e) => warnings.push(format!("Created without a cycle: {}", e.message)),
            }
        }
        let issue = match self.get_issue(board_id, issue_ref) {
            Ok(Some(issue)) => issue,
            other => {
                warnings.push(format!(
                    "Created {}, but could not read it back: {}. Do not create it again.",
                    receipt.url,
                    other
                        .err()
                        .map(|e| e.message)
                        .unwrap_or_else(|| "not visible".into())
                ));
                receipt
            }
        };
        Ok((issue, warnings))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_documented_issue_fields_with_unexpanded_ids_and_closed_cycles() {
        let provider = PlaneProvider::new("fixture".into(), None, "my-team".into());
        assert_eq!(provider.api_url, DEFAULT_API_URL);
        let board =
            map_board(&json!({"id":"p", "name":"App", "identifier":"APP", "cycle_view":true}));
        assert_eq!(board.kind, "scrum");
        let states = vec![map_state(
            &json!({"id":"s", "name":"Doing", "group":"started"}),
        )];
        let today = NaiveDate::from_ymd_opt(2026, 10, 22).unwrap();
        let cycles = vec![
            map_cycle(
                &json!({"id":"c", "name":"Old", "end_date":"2026-10-01"}),
                today,
            )
            .unwrap(),
        ];
        let raw = json!({"id":"i", "name":"Fix", "sequence_id":128, "state":"s", "assignees":["u"], "description_stripped":"Plain text", "priority":"none", "updated_at":"2026-10-22T09:00:00Z"});
        let issue = provider
            .map_issue(&raw, &board, &states, &cycles, None)
            .unwrap();
        assert_eq!(issue.key, "APP-128");
        assert_eq!(
            issue.url,
            "https://app.plane.so/my-team/projects/p/issues/i/"
        );
        assert_eq!(issue.description, "Plain text");
        assert_eq!(issue.status.category, "indeterminate");
        assert_eq!(issue.assignee_id.as_deref(), Some("u"));
        assert_eq!(issue.priority, None);
        assert!(issue.sprint.is_none());
        assert_eq!(issue.closed_sprints.len(), 1);
        assert!(
            provider
                .map_issue(&json!({"id":"i"}), &board, &states, &[], None)
                .is_err()
        );
        assert!(provider.map_issue(&raw, &board, &[], &[], None).is_err());
        let mut multiple = raw.clone();
        multiple["assignees"] =
            json!([{"id":"other", "display_name":"Other"}, {"id":"me", "display_name":"Me"}]);
        assert_eq!(
            provider
                .map_issue(&multiple, &board, &states, &[], Some("me"))
                .unwrap()
                .assignee
                .as_deref(),
            Some("Me")
        );
    }

    #[test]
    fn cycles_use_status_or_dates_including_null_dates_and_end_day() {
        let today = NaiveDate::from_ymd_opt(2026, 10, 22).unwrap();
        for (extra, expected) in [
            (json!({"status":"completed"}), "closed"),
            (json!({"status":"current"}), "active"),
            (json!({"status":"upcoming"}), "future"),
            (json!({"start_date":null, "end_date":null}), "future"),
            (
                json!({"start_date":"2026-10-01T00:00:00Z", "end_date":"2026-10-22T00:00:00Z"}),
                "active",
            ),
            (json!({"end_date":"2026-10-21"}), "closed"),
        ] {
            let mut raw = json!({"id":"c", "name":"Cycle"});
            raw.as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert_eq!(map_cycle(&raw, today).unwrap().state, expected);
        }
        assert!(map_cycle(&Value::Null, today).is_err());
        assert_eq!(map_state(&json!({"group":"cancelled"})).category, "done");
    }

    #[test]
    fn pagination_requires_results_and_progress_metadata() {
        let page = json!({"results":[{"id":"1"}], "next_page_results":true,"next_cursor":"20:1:0"});
        assert_eq!(page_values(&page).unwrap().1.as_deref(), Some("20:1:0"));
        assert_eq!(page_values(&json!([])).unwrap().1, None);
        for page in [
            json!({}),
            json!({"results":[]}),
            json!({"results":[], "next_page_results":true}),
            json!({"results":[], "next_page_results":true,"next_cursor":""}),
        ] {
            assert!(page_values(&page).is_err());
        }
    }

    #[test]
    fn errors_preserve_permission_not_found_and_rate_limit_messages() {
        for (status, code) in [
            (401, "plane_auth_required"),
            (403, "plane_forbidden"),
            (404, "not_found"),
            (429, "plane_rate_limited"),
            (500, "plane_error"),
        ] {
            let error = request_error(JiraRequestError::Api {
                status,
                message: "Service refused".into(),
                retry_after: Some(9),
            });
            assert_eq!(error.code, code);
            assert!(error.message.contains("Service refused"));
            if status == 429 {
                assert!(error.message.contains("retry after 9s"));
            }
        }
        assert_eq!(
            request_error(JiraRequestError::Timeout).message,
            "Plane request timed out."
        );
        assert_eq!(
            request_error(JiraRequestError::Network("offline".into())).message,
            "offline"
        );
        for slug in ["", "../team", "https://app.plane.so/team", "team/", "a\nb"] {
            assert!(workspace_slug(slug).is_err());
        }
        assert_eq!(workspace_slug(" my-team ").unwrap(), "my-team");
    }
}
