//! Jira RPC dispatch (R17-A): parameter admission and result serialization
//! for the `jira.*` methods, wired into `Engine::dispatch_inner` in lib.rs.
//! Method names mirror the fork's IPC/RPC surface
//! (`src/main/ipc/jira.ts`, `src/main/runtime/rpc/methods/jira.ts`).
//! MIT Copyright (c) 2026 Lovecast Inc.

use drogon_protocol::RpcError;
use drogon_protocol::jira::*;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::Engine;

use super::sites::SiteSelection;

fn parse<T: DeserializeOwned>(params: &Value, what: &str) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|e| RpcError::new("invalid_argument", format!("Invalid {what}: {e}")))
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, RpcError> {
    serde_json::to_value(value)
        .map_err(|e| RpcError::new("internal_error", format!("cannot encode jira result: {e}")))
}

fn require_string(value: &Value, field: &str) -> Result<String, RpcError> {
    match value.get(field).and_then(Value::as_str) {
        Some(text) if !text.trim().is_empty() => Ok(text.trim().to_string()),
        _ => Err(RpcError::new(
            "invalid_argument",
            format!("{field} is required"),
        )),
    }
}

fn selection(params: &Value) -> Option<SiteSelection> {
    match params.get("siteId").and_then(Value::as_str) {
        Some("all") => Some(SiteSelection::All),
        Some(id) if !id.trim().is_empty() => Some(SiteSelection::Site(id.trim().to_string())),
        _ => None,
    }
}

impl Engine {
    pub(crate) fn jira_connect(&self, params: &Value) -> Result<Value, RpcError> {
        let mut typed: JiraConnectParams = parse(params, "jira.connect params")?;
        if typed.api_token.trim().is_empty() {
            return Err(RpcError::new("invalid_argument", "API token is required"));
        }
        typed.email = typed.email.trim().to_string();
        typed.api_token = typed.api_token.trim().to_string();
        typed.site_url = typed.site_url.trim().to_string();
        let viewer = super::ops::connect(&self.jira, &typed)?;
        to_value(&json!({ "ok": true, "viewer": viewer }))
    }

    pub(crate) fn jira_disconnect(&self, params: &Value) -> Result<Value, RpcError> {
        let site_id = params
            .get("siteId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty());
        super::ops::disconnect(&self.jira, site_id);
        Ok(Value::Null)
    }

    pub(crate) fn jira_select_site(&self, params: &Value) -> Result<Value, RpcError> {
        let site_id = require_string(params, "siteId")?;
        let status = super::ops::select_site(&self.jira, &site_id);
        to_value(&status)
    }

    pub(crate) fn jira_status(&self) -> Result<Value, RpcError> {
        to_value(&super::ops::status(&self.jira))
    }

    pub(crate) fn jira_test_connection(&self, params: &Value) -> Result<Value, RpcError> {
        let site_id = params
            .get("siteId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty());
        let viewer = super::ops::test_connection(&self.jira, site_id)?;
        to_value(&viewer)
    }

    pub(crate) fn jira_search_issues(&self, params: &Value) -> Result<Value, RpcError> {
        let typed: JiraSearchParams = parse(params, "jira.searchIssues params")?;
        let jql = typed.jql.trim().to_string();
        if jql.is_empty() {
            return Err(RpcError::new("invalid_argument", "Missing JQL"));
        }
        let (flag, request_id) = match typed.request_id.as_deref() {
            Some(id) if !id.trim().is_empty() && id.len() <= 128 => {
                let id = id.trim().to_string();
                (Some(self.jira.register_in_flight(&id)), Some(id))
            }
            _ => (None, None),
        };
        let result = super::ops::search_issues(
            &self.jira,
            &jql,
            typed.limit,
            typed.start_at,
            selection(params),
            flag.as_ref(),
        );
        if let (Some(id), Some(flag)) = (request_id, flag) {
            self.jira.unregister_in_flight(&id, &flag);
        }
        to_value(&result?)
    }

    pub(crate) fn jira_cancel_search_issues(&self, params: &Value) -> Result<Value, RpcError> {
        let request_id = params
            .get("requestId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty() && id.len() <= 128);
        let cancelled = match request_id {
            Some(id) => self.jira.cancel_in_flight(id),
            None => false,
        };
        Ok(json!({ "cancelled": cancelled }))
    }

    pub(crate) fn jira_list_issues(&self, params: &Value) -> Result<Value, RpcError> {
        let typed: JiraListParams = parse(params, "jira.listIssues params")?;
        let (flag, request_id) = match typed.request_id.as_deref() {
            Some(id) if !id.trim().is_empty() && id.len() <= 128 => {
                let id = id.trim().to_string();
                (Some(self.jira.register_in_flight(&id)), Some(id))
            }
            _ => (None, None),
        };
        let result = super::ops::list_issues(
            &self.jira,
            typed.filter,
            typed.limit,
            None,
            selection(params),
            flag.as_ref(),
        );
        if let (Some(id), Some(flag)) = (request_id, flag) {
            self.jira.unregister_in_flight(&id, &flag);
        }
        to_value(&result?)
    }

    pub(crate) fn jira_list_projects(&self, params: &Value) -> Result<Value, RpcError> {
        let projects = super::ops::list_projects(&self.jira, selection(params))?;
        to_value(&projects)
    }

    pub(crate) fn jira_list_issue_types(&self, params: &Value) -> Result<Value, RpcError> {
        let typed: JiraIssueTypesParams = parse(params, "jira.listIssueTypes params")?;
        let project = typed.project_id_or_key.trim().to_string();
        if project.is_empty() {
            return Err(RpcError::new("invalid_argument", "Project is required"));
        }
        let issue_types =
            super::ops::list_issue_types(&self.jira, &project, typed.site_id.as_deref())?;
        to_value(&issue_types)
    }

    pub(crate) fn jira_list_create_fields(&self, params: &Value) -> Result<Value, RpcError> {
        let typed: JiraCreateFieldsParams = parse(params, "jira.listCreateFields params")?;
        let project = typed.project_id_or_key.trim().to_string();
        let issue_type = typed.issue_type_id.trim().to_string();
        if project.is_empty() {
            return Err(RpcError::new("invalid_argument", "Project is required"));
        }
        if issue_type.is_empty() {
            return Err(RpcError::new("invalid_argument", "Issue type is required"));
        }
        let fields = super::ops::list_create_fields(
            &self.jira,
            &project,
            &issue_type,
            typed.site_id.as_deref(),
        )?;
        to_value(&fields)
    }

    pub(crate) fn jira_list_priorities(&self, params: &Value) -> Result<Value, RpcError> {
        let site_id = params
            .get("siteId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty());
        let priorities = super::ops::list_priorities(&self.jira, site_id)?;
        to_value(&priorities)
    }

    pub(crate) fn jira_search_users(&self, params: &Value) -> Result<Value, RpcError> {
        let query = params
            .get("query")
            .and_then(Value::as_str)
            .map(str::to_string);
        let site_id = params
            .get("siteId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty());
        let users = super::ops::search_users(&self.jira, query.as_deref(), site_id)?;
        to_value(&users)
    }
}
