use crate::{Engine, error};
use drogon_protocol::RpcError;
use drogon_protocol::worktree_issues::{
    IssueDetails, IssueProvider, LinkIssueParams, UnlinkIssueParams, WorktreeIssueLink,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

fn ensure_table(conn: &Connection) -> Result<(), RpcError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS worktree_issue_links (
        worktree_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('linear', 'jira')),
        payload TEXT NOT NULL,
        PRIMARY KEY(worktree_id, provider)
    ); CREATE TRIGGER IF NOT EXISTS worktree_issue_links_cleanup AFTER DELETE ON worktrees
    BEGIN DELETE FROM worktree_issue_links WHERE worktree_id = OLD.id; END;",
    )
    .map_err(error::from_sqlite)
}

pub(crate) fn validate_issue(issue: &IssueDetails) -> Result<(), RpcError> {
    let invalid = || error::invalid_argument("Invalid linked issue metadata");
    let Some((project, number)) = issue.identifier.rsplit_once('-') else {
        return Err(invalid());
    };
    if issue.identifier.len() > 128
        || project.is_empty()
        || number.is_empty()
        || !project.as_bytes()[0].is_ascii_alphabetic()
        || !project
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        || !number.bytes().all(|b| b.is_ascii_digit())
        || issue.title.len() > 4096
        || issue.title.contains('\0')
        || issue
            .site_id
            .as_ref()
            .is_some_and(|s| s.len() > 256 || s.contains('\0'))
        || issue
            .state_name
            .as_ref()
            .is_some_and(|s| s.len() > 256 || s.contains('\0'))
        || issue.labels.len() > 32
        || issue
            .labels
            .iter()
            .any(|s| s.len() > 128 || s.contains('\0'))
    {
        return Err(invalid());
    }
    if let Some(url) = &issue.url {
        let parsed = url::Url::parse(url).map_err(|_| invalid())?;
        if url.len() > 2048
            || !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || url
                .chars()
                .any(|c| c.is_control() || c.is_whitespace() || c == '\\' || c == '\u{feff}')
        {
            return Err(invalid());
        }
        if issue.provider == IssueProvider::Linear
            && (parsed.host_str() != Some("linear.app") || parsed.port().is_some())
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn require_worktree(conn: &Connection, id: &str) -> Result<String, RpcError> {
    let project: Option<String> = conn.query_row(
        "SELECT COALESCE((SELECT project_id FROM worktrees WHERE id = ?1), (SELECT id FROM projects WHERE id = ?1 AND kind = 'folder'))",
        [id], |r| r.get(0)).map_err(error::from_sqlite)?;
    project.ok_or_else(|| error::not_found("worktree does not exist"))
}

pub(crate) fn find_git_worktree_for_issue(
    conn: &Connection,
    project_id: &str,
    provider: IssueProvider,
    identifier: &str,
    site_id: Option<&str>,
) -> Result<Option<String>, RpcError> {
    ensure_table(conn)?;
    conn.query_row(
        "SELECT w.id FROM worktree_issue_links l JOIN worktrees w ON w.id = l.worktree_id AND w.project_id = l.project_id
         WHERE l.project_id = ?1 AND l.provider = ?2 AND UPPER(json_extract(l.payload, '$.identifier')) = UPPER(?3)
         AND json_extract(l.payload, '$.siteId') IS ?4
         ORDER BY w.created_at, w.id LIMIT 1",
        params![project_id, provider.as_str(), identifier, site_id], |row| row.get(0),
    ).optional().map_err(error::from_sqlite)
}

pub(crate) fn save_issue_link(
    conn: &Connection,
    worktree_id: &str,
    issue: &IssueDetails,
) -> Result<WorktreeIssueLink, RpcError> {
    validate_issue(issue)?;
    let project_id = require_worktree(conn, worktree_id)?;
    ensure_table(conn)?;
    let payload = serde_json::to_string(issue)
        .map_err(|_| error::internal_error("cannot encode linked issue"))?;
    conn.execute("INSERT INTO worktree_issue_links(worktree_id, project_id, provider, payload) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(worktree_id, provider) DO UPDATE SET payload = excluded.payload, project_id = excluded.project_id",
        params![worktree_id, project_id, issue.provider.as_str(), payload]).map_err(error::from_sqlite)?;
    Ok(WorktreeIssueLink {
        worktree_id: worktree_id.to_owned(),
        issue: issue.clone(),
    })
}

impl Engine {
    pub(super) fn do_worktree_link_issue(&self, value: &Value) -> Result<Value, RpcError> {
        let params: LinkIssueParams = serde_json::from_value(value.clone())
            .map_err(|_| error::invalid_argument("Invalid worktree.linkIssue params"))?;
        let conn = self.db.lock().unwrap();
        let link = save_issue_link(&conn, &params.worktree_id, &params.issue)?;
        serde_json::to_value(link).map_err(|_| error::internal_error("cannot encode linked issue"))
    }

    pub(super) fn do_worktree_unlink_issue(&self, value: &Value) -> Result<Value, RpcError> {
        let params: UnlinkIssueParams = serde_json::from_value(value.clone())
            .map_err(|_| error::invalid_argument("Invalid worktree.unlinkIssue params"))?;
        let conn = self.db.lock().unwrap();
        require_worktree(&conn, &params.worktree_id)?;
        ensure_table(&conn)?;
        conn.execute(
            "DELETE FROM worktree_issue_links WHERE worktree_id = ?1 AND provider = ?2",
            params![params.worktree_id, params.provider.as_str()],
        )
        .map_err(error::from_sqlite)?;
        Ok(json!({"worktreeId": params.worktree_id, "provider": params.provider, "removed": true}))
    }

    pub(super) fn do_worktree_issue_links(&self, value: &Value) -> Result<Value, RpcError> {
        let params: drogon_protocol::worktree_issues::IssueLinksParams =
            serde_json::from_value(value.clone())
                .map_err(|_| error::invalid_argument("Invalid worktree.issueLinks params"))?;
        let conn = self.db.lock().unwrap();
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1)",
                [&params.project_id],
                |r| r.get(0),
            )
            .map_err(error::from_sqlite)?;
        if !exists {
            return Err(error::not_found("project does not exist"));
        }
        ensure_table(&conn)?;
        let mut stmt = conn.prepare("SELECT l.worktree_id, l.payload FROM worktree_issue_links l WHERE l.project_id = ?1 AND (EXISTS(SELECT 1 FROM worktrees w WHERE w.id = l.worktree_id AND w.project_id = l.project_id) OR EXISTS(SELECT 1 FROM projects p WHERE p.id = l.worktree_id AND p.kind = 'folder')) ORDER BY l.worktree_id, l.provider").map_err(error::from_sqlite)?;
        let rows = stmt
            .query_map([params.project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(error::from_sqlite)?;
        let mut links = Vec::new();
        for row in rows {
            let (worktree_id, payload) = row.map_err(error::from_sqlite)?;
            let issue = serde_json::from_str(&payload)
                .map_err(|_| error::internal_error("invalid stored linked issue"))?;
            links.push(WorktreeIssueLink { worktree_id, issue });
        }
        Ok(json!({"links": links}))
    }
}
