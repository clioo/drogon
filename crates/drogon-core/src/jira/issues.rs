//! Jira issue reads and mutations (R17-C): single-issue detail with the
//! ADF description rendered to markdown, paged comments, transitions, and
//! the create/update/comment write paths — the daemon port of the fork's
//! `src/main/jira/jira-issue-read.ts`, `jira-issue-comments.ts`,
//! `jira-transition-queries.ts` and `jira-issue-mutations.ts`.
//! MIT Copyright (c) 2026 Lovecast Inc.

use drogon_protocol::RpcError;
use drogon_protocol::jira::*;

use super::adf::{adf_to_markdown_text, to_body_text};
use super::client::{HttpRequest, JiraRequestError, jira_request, to_rpc_error};
use super::mapping::{
    ISSUE_FIELDS, as_record, as_string, issue_url, map_jira_issue, map_status, map_user,
};
use super::ops::{ClientForSite, first_client, get_clients};
use super::sites::SiteSelection;
use super::{JiraState, ops::encode_path_segment};

/// The fork's `ISSUE_DETAIL_FIELDS`: the list fields plus `attachment`.
/// Attachments themselves are not ported (no binary plumbing), but the
/// field list matches so a Server/DC site sees the same request shape.
pub const ISSUE_DETAIL_FIELDS: [&str; 12] = [
    "summary",
    "description",
    "project",
    "issuetype",
    "status",
    "assignee",
    "reporter",
    "priority",
    "labels",
    "attachment",
    "created",
    "updated",
];

fn detail_issue(client: &ClientForSite, raw: &serde_json::Value) -> JiraIssue {
    let site: JiraSite = (&client.site).into();
    let mut issue = map_jira_issue(&site, raw);
    let fields = as_record(raw.get("fields"));
    let description = adf_to_markdown_text(fields.get("description"));
    issue.description = if description.is_empty() {
        None
    } else {
        Some(description)
    };
    issue
}

fn map_comment(raw: &serde_json::Value) -> JiraComment {
    let record = as_record(Some(raw));
    JiraComment {
        id: as_string(record.get("id")),
        body: adf_to_markdown_text(record.get("body")),
        created_at: {
            let created = as_string(record.get("created"));
            if created.is_empty() {
                humantime_now()
            } else {
                created
            }
        },
        updated_at: {
            let updated = as_string(record.get("updated"));
            if updated.is_empty() {
                None
            } else {
                Some(updated)
            }
        },
        user: map_user(record.get("author")),
    }
}

fn humantime_now() -> String {
    // The fork falls back to `new Date().toISOString()`; Drogon formats UTC
    // itself instead of pulling a time crate.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}.000Z")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn auth_or<T>(
    state: &JiraState,
    client: &ClientForSite,
    outcome: Result<T, JiraRequestError>,
) -> Result<T, RpcError> {
    match outcome {
        Ok(value) => Ok(value),
        Err(error) => {
            if error.status() == Some(401) {
                super::ops::clear_token_for(state, &client.site.id);
                return Err(to_rpc_error(&error));
            }
            Err(to_rpc_error(&error))
        }
    }
}

// --- reads ------------------------------------------------------------------

/// The fork's `getIssue`: walk the resolved clients and return the first
/// readable issue; a 404 on one site is not final when another site may
/// own the key (the fork `continue`s on non-auth failures), and nothing
/// found is an honest `null`, never an error.
pub fn get_issue(
    state: &JiraState,
    key: &str,
    site_id: Option<&str>,
) -> Result<Option<JiraIssue>, RpcError> {
    let entries = get_clients(
        &state.sites,
        site_id.map(|id| {
            if id == "all" {
                SiteSelection::All
            } else {
                SiteSelection::Site(id.to_string())
            }
        }),
    )?;
    let surface_site_failure = site_id.is_some() && site_id != Some("all") || entries.len() <= 1;
    for entry in &entries {
        let queue = state.site_queue(&entry.site.id);
        let _permit = queue.lock().unwrap();
        let path = format!(
            "{}/issue/{}?fields={}&expand=renderedFields",
            super::client::api_base_path(entry.site.auth_type),
            encode_path_segment(key),
            ISSUE_DETAIL_FIELDS.join(","),
        );
        let request = HttpRequest {
            url: format!("{}{path}", entry.site.site_url),
            method: "GET",
            authorization: &entry.authorization,
            body: None,
            cancel: None,
            timeout: super::client::REQUEST_TIMEOUT,
        };
        match jira_request(&request) {
            Ok(raw) => return Ok(Some(detail_issue(entry, &raw))),
            Err(error) => {
                if error.status() == Some(401) {
                    super::ops::clear_token_for(state, &entry.site.id);
                    if surface_site_failure {
                        return Err(to_rpc_error(&error));
                    }
                    continue;
                }
                // 404/permission gaps: the key may live on another site.
                continue;
            }
        }
    }
    Ok(None)
}

/// The fork's `getIssueComments`: paged by `comments`, ordered by created.
/// Non-auth failures degrade to an empty list (the fork warns and returns
/// []); auth failures clear the site and surface.
pub fn list_comments(
    state: &JiraState,
    key: &str,
    site_id: Option<&str>,
) -> Result<Vec<JiraComment>, RpcError> {
    let Some(entry) = first_client(state, site_id)? else {
        return Ok(Vec::new());
    };
    let queue = state.site_queue(&entry.site.id);
    let _permit = queue.lock().unwrap();
    let mut comments: Vec<serde_json::Value> = Vec::new();
    let mut start_at: u64 = 0;
    let outcome = (|| -> Result<(), JiraRequestError> {
        for _ in 0..100 {
            let path = format!(
                "{}/issue/{}/comment?maxResults=100&orderBy=created&startAt={start_at}",
                super::client::api_base_path(entry.site.auth_type),
                encode_path_segment(key),
            );
            let request = HttpRequest {
                url: format!("{}{path}", entry.site.site_url),
                method: "GET",
                authorization: &entry.authorization,
                body: None,
                cancel: None,
                timeout: super::client::REQUEST_TIMEOUT,
            };
            let response = jira_request(&request)?;
            let page = response
                .get("comments")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            let count = page.len();
            comments.extend(page);
            if !super::ops::should_fetch_next_page(&response, start_at, count, 100) {
                break;
            }
            start_at += response
                .get("maxResults")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(100);
        }
        Ok(())
    })();
    auth_or(state, &entry, outcome)?;
    Ok(comments.iter().map(map_comment).collect())
}

/// The fork's `listTransitions`: failures degrade to [] (the dialog's
/// status chip simply offers no transitions); auth surfaces.
pub fn list_transitions(
    state: &JiraState,
    key: &str,
    site_id: Option<&str>,
) -> Result<Vec<JiraTransition>, RpcError> {
    let Some(entry) = first_client(state, site_id)? else {
        return Ok(Vec::new());
    };
    let queue = state.site_queue(&entry.site.id);
    let _permit = queue.lock().unwrap();
    let path = format!(
        "{}/issue/{}/transitions",
        super::client::api_base_path(entry.site.auth_type),
        encode_path_segment(key),
    );
    let request = HttpRequest {
        url: format!("{}{path}", entry.site.site_url),
        method: "GET",
        authorization: &entry.authorization,
        body: None,
        cancel: None,
        timeout: super::client::REQUEST_TIMEOUT,
    };
    let outcome = jira_request(&request).map(|response| {
        response
            .get("transitions")
            .and_then(serde_json::Value::as_array)
            .map(|records| {
                records
                    .iter()
                    .map(|record| {
                        let record = as_record(Some(record));
                        JiraTransition {
                            id: as_string(record.get("id")),
                            name: as_string(record.get("name")),
                            to: map_status(record.get("to")),
                        }
                    })
                    .collect::<Vec<JiraTransition>>()
            })
            .unwrap_or_default()
    });
    match outcome {
        Ok(transitions) => Ok(transitions),
        Err(error) if error.status() == Some(401) => {
            super::ops::clear_token_for(state, &entry.site.id);
            Err(to_rpc_error(&error))
        }
        Err(_) => Ok(Vec::new()),
    }
}

// --- mutations --------------------------------------------------------------

/// Wrap a user id in the reference object the site expects: `{accountId}`
/// on Cloud, `{name}` on Server/DC — the fork's `userFieldRef`.
pub fn user_field_ref(auth_type: JiraAuthType, id: Option<&str>) -> serde_json::Value {
    match (auth_type, id) {
        (JiraAuthType::Server, Some(id)) => serde_json::json!({ "name": id }),
        (JiraAuthType::Server, None) => serde_json::json!({ "name": serde_json::Value::Null }),
        (_, Some(id)) => serde_json::json!({ "accountId": id }),
        (_, None) => serde_json::json!({ "accountId": serde_json::Value::Null }),
    }
}

/// Shape a user-typed create value (scalar or array) into Jira's user
/// reference objects — the fork's `toUserFieldValue`.
fn to_user_field_value(auth_type: JiraAuthType, value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(id) => user_field_ref(auth_type, Some(id)),
        serde_json::Value::Array(members) => serde_json::Value::Array(
            members
                .iter()
                .map(|member| match member {
                    serde_json::Value::String(id) => user_field_ref(auth_type, Some(id)),
                    other => other.clone(),
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

/// The fork's `createIssue`: business failures ride `{ok:false,error}`
/// (the dialog's error surface); only an auth failure clears the site and
/// throws, like every other write.
pub fn create_issue(
    state: &JiraState,
    params: &JiraCreateIssueParams,
) -> Result<JiraCreateIssueResult, RpcError> {
    let Some(entry) = first_client(state, params.site_id.as_deref())? else {
        return Ok(JiraCreateIssueResult {
            ok: false,
            id: None,
            key: None,
            url: None,
            error: Some("Not connected to Jira.".to_string()),
        });
    };
    let title = params.title.trim();
    if title.is_empty() {
        return Ok(JiraCreateIssueResult {
            ok: false,
            id: None,
            key: None,
            url: None,
            error: Some("Title is required.".to_string()),
        });
    }
    let mut fields = serde_json::json!({
        "project": { "id": params.project_id },
        "issuetype": { "id": params.issue_type_id },
        "summary": title,
    });
    if let Some(description) = params.description.as_deref()
        && !description.trim().is_empty()
    {
        fields["description"] = to_body_text(entry.site.auth_type, description.trim());
    }
    let user_field_keys: std::collections::HashSet<&str> = params
        .user_field_keys
        .iter()
        .flatten()
        .map(String::as_str)
        .collect();
    if let Some(custom) = &params.custom_fields {
        for (field_key, value) in custom {
            if field_key.is_empty()
                || matches!(value, serde_json::Value::Null)
                || matches!(value, serde_json::Value::String(s) if s.is_empty())
            {
                continue;
            }
            fields[field_key] = if user_field_keys.contains(field_key.as_str()) {
                to_user_field_value(entry.site.auth_type, value)
            } else {
                value.clone()
            };
        }
    }
    let queue = state.site_queue(&entry.site.id);
    let _permit = queue.lock().unwrap();
    let path = format!(
        "{}/issue",
        super::client::api_base_path(entry.site.auth_type)
    );
    let request = HttpRequest {
        url: format!("{}{path}", entry.site.site_url),
        method: "POST",
        authorization: &entry.authorization,
        body: Some(serde_json::json!({ "fields": fields }).to_string()),
        cancel: None,
        timeout: super::client::REQUEST_TIMEOUT,
    };
    match jira_request(&request) {
        Ok(created) => {
            let key = as_string(created.get("key"));
            Ok(JiraCreateIssueResult {
                ok: true,
                id: Some(as_string(created.get("id"))),
                key: Some(key.clone()),
                url: Some(issue_url(&(&entry.site).into(), &key)),
                error: None,
            })
        }
        Err(error) if error.status() == Some(401) => {
            super::ops::clear_token_for(state, &entry.site.id);
            Err(to_rpc_error(&error))
        }
        Err(error) => Ok(JiraCreateIssueResult {
            ok: false,
            id: None,
            key: None,
            url: None,
            error: Some(super::client::failure_message(&error)),
        }),
    }
}

/// The fork's `updateIssue`: field writes first, then the assignee ref
/// (`PUT /assignee` takes the ref object as the bare body), then the
/// transition POST.
pub fn update_issue(
    state: &JiraState,
    key: &str,
    updates: &JiraIssueUpdate,
    site_id: Option<&str>,
) -> Result<JiraMutationResult, RpcError> {
    let Some(entry) = first_client(state, site_id)? else {
        return Ok(JiraMutationResult {
            ok: false,
            id: None,
            error: Some("Not connected to Jira.".to_string()),
        });
    };
    let queue = state.site_queue(&entry.site.id);
    let _permit = queue.lock().unwrap();
    let issue_base = format!(
        "{}{}/issue/{}",
        entry.site.site_url,
        super::client::api_base_path(entry.site.auth_type),
        encode_path_segment(key)
    );
    let outcome = (|| -> Result<(), JiraRequestError> {
        let mut fields = serde_json::Map::new();
        if let Some(title) = &updates.title {
            fields.insert(
                "summary".to_string(),
                serde_json::Value::String(title.clone()),
            );
        }
        if let Some(labels) = &updates.labels {
            fields.insert(
                "labels".to_string(),
                serde_json::Value::Array(
                    labels.iter().map(|label| label.as_str().into()).collect(),
                ),
            );
        }
        if let Some(priority_id) = &updates.priority_id {
            fields.insert(
                "priority".to_string(),
                match priority_id {
                    Some(id) => serde_json::json!({ "id": id }),
                    None => serde_json::Value::Null,
                },
            );
        }
        if !fields.is_empty() {
            let request = HttpRequest {
                url: issue_base.clone(),
                method: "PUT",
                authorization: &entry.authorization,
                body: Some(serde_json::json!({ "fields": fields }).to_string()),
                cancel: None,
                timeout: super::client::REQUEST_TIMEOUT,
            };
            jira_request(&request)?;
        }
        if let Some(assignee_account_id) = &updates.assignee_account_id {
            let body = user_field_ref(entry.site.auth_type, assignee_account_id.as_deref());
            let request = HttpRequest {
                url: format!("{issue_base}/assignee"),
                method: "PUT",
                authorization: &entry.authorization,
                body: Some(body.to_string()),
                cancel: None,
                timeout: super::client::REQUEST_TIMEOUT,
            };
            jira_request(&request)?;
        }
        if let Some(transition_id) = &updates.transition_id
            && !transition_id.is_empty()
        {
            let request = HttpRequest {
                url: format!("{issue_base}/transitions"),
                method: "POST",
                authorization: &entry.authorization,
                body: Some(
                    serde_json::json!({ "transition": { "id": transition_id } }).to_string(),
                ),
                cancel: None,
                timeout: super::client::REQUEST_TIMEOUT,
            };
            jira_request(&request)?;
        }
        Ok(())
    })();
    match outcome {
        Ok(()) => Ok(JiraMutationResult {
            ok: true,
            id: None,
            error: None,
        }),
        Err(error) if error.status() == Some(401) => {
            super::ops::clear_token_for(state, &entry.site.id);
            Err(to_rpc_error(&error))
        }
        Err(error) => Ok(JiraMutationResult {
            ok: false,
            id: None,
            error: Some(super::client::failure_message(&error)),
        }),
    }
}

/// The fork's `addIssueComment`: the body rides `toBodyText` exactly like
/// the create description (ADF on Cloud, plain text on Server/DC).
pub fn add_comment(
    state: &JiraState,
    key: &str,
    body: &str,
    site_id: Option<&str>,
) -> Result<JiraMutationResult, RpcError> {
    let Some(entry) = first_client(state, site_id)? else {
        return Ok(JiraMutationResult {
            ok: false,
            id: None,
            error: Some("Not connected to Jira.".to_string()),
        });
    };
    let queue = state.site_queue(&entry.site.id);
    let _permit = queue.lock().unwrap();
    let path = format!(
        "{}/issue/{}/comment",
        super::client::api_base_path(entry.site.auth_type),
        encode_path_segment(key)
    );
    let request = HttpRequest {
        url: format!("{}{path}", entry.site.site_url),
        method: "POST",
        authorization: &entry.authorization,
        body: Some(
            serde_json::json!({ "body": to_body_text(entry.site.auth_type, body) }).to_string(),
        ),
        cancel: None,
        timeout: super::client::REQUEST_TIMEOUT,
    };
    match jira_request(&request) {
        Ok(created) => Ok(JiraMutationResult {
            ok: true,
            id: Some(as_string(created.get("id"))),
            error: None,
        }),
        Err(error) if error.status() == Some(401) => {
            super::ops::clear_token_for(state, &entry.site.id);
            Err(to_rpc_error(&error))
        }
        Err(error) => Ok(JiraMutationResult {
            ok: false,
            id: None,
            error: Some(super::client::failure_message(&error)),
        }),
    }
}

/// The issue list fields stay importable for callers that need both shapes.
#[allow(dead_code)]
pub const _ISSUE_FIELDS_REF: [&str; 11] = ISSUE_FIELDS;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn user_field_ref_splits_by_deployment() {
        assert_eq!(
            user_field_ref(JiraAuthType::Cloud, Some("acct-1")),
            json!({ "accountId": "acct-1" })
        );
        assert_eq!(
            user_field_ref(JiraAuthType::Server, Some("jsmith")),
            json!({ "name": "jsmith" })
        );
        assert_eq!(
            user_field_ref(JiraAuthType::Cloud, None),
            json!({ "accountId": null })
        );
    }

    #[test]
    fn to_user_field_value_shapes_scalars_and_arrays() {
        assert_eq!(
            to_user_field_value(JiraAuthType::Cloud, &json!("acct-1")),
            json!({ "accountId": "acct-1" })
        );
        assert_eq!(
            to_user_field_value(
                JiraAuthType::Cloud,
                &json!(["acct-1", { "accountId": "acct-2" }])
            ),
            json!([{ "accountId": "acct-1" }, { "accountId": "acct-2" }])
        );
    }

    #[test]
    fn comment_mapping_renders_adf_and_fallbacks() {
        let comment = map_comment(&json!({
            "id": "20001",
            "body": {
                "type": "doc",
                "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "Looks good" }] }
                ]
            },
            "created": "2026-09-01T10:00:00.000+0000",
            "updated": "2026-09-02T10:00:00.000+0000",
            "author": { "accountId": "fixture-user-2", "displayName": "Ana Garcia" }
        }));
        assert_eq!(comment.id, "20001");
        assert_eq!(comment.body, "Looks good");
        assert_eq!(comment.created_at, "2026-09-01T10:00:00.000+0000");
        assert_eq!(
            comment.updated_at.as_deref(),
            Some("2026-09-02T10:00:00.000+0000")
        );
        assert_eq!(comment.user.unwrap().display_name, "Ana Garcia");
    }
}
