//! Tasks RPCs (journey J6): open GitHub Issues for one git Project via
//! `gh`, and "start task" worktree creation with a durable issue link.
//! Read methods run directly; `tasks.start` runs through the request ledger
//! (`Engine::mutating`) so a retried requestId dedupes instead of creating
//! a second worktree, exactly like `worktree.create` itself. All processes
//! spawn through `crate::git_process`'s bounded primitive — no shell, every
//! argv shape built inside this module. Local host only.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use drogon_protocol::RpcError;
use drogon_protocol::tasks::{MAX_TASKS_PAGE, MAX_TASKS_PER_PAGE};
use drogon_protocol::tasks::{
    TaskIssue, TaskIssueState, TaskLabel, TaskLink, TasksLinksParams, TasksLinksResult,
    TasksListParams, TasksListResult, TasksShowParams, TasksShowResult, TasksStartParams,
    TasksStartResult,
};
use drogon_protocol::worktree::Worktree;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::git_process::{self, GitProbeBudget, SpawnOutcome};
use crate::{Engine, error, now_rfc3339};

// --- `gh` binary resolution -------------------------------------------------
//
// Production always resolves `gh` from `PATH` at spawn time. Integration
// tests point at a fixture script by direct path through this per-process
// override instead of mutating process-global `PATH` (which would be racy
// under parallel tests) — the same rationale as git_process's `*_with_bin`
// seams, lifted to the engine level because these RPCs resolve the binary
// internally.

static GH_BIN_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Test seam: override the `gh` binary path for this process, or clear the
/// override with `None` to resolve `gh` from `PATH` again. Never global
/// environment state, only this process's own resolution.
pub fn set_gh_bin_override(path: Option<PathBuf>) {
    *GH_BIN_OVERRIDE.lock().unwrap() = path;
}

fn gh_bin() -> PathBuf {
    GH_BIN_OVERRIDE
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| PathBuf::from("gh"))
}

fn tasks_budget() -> GitProbeBudget {
    GitProbeBudget {
        timeout: Duration::from_secs(30),
        max_combined_output_bytes: 4 * 1024 * 1024,
    }
}

fn gh_unavailable(message: String) -> RpcError {
    RpcError::new("gh_unavailable", message)
}

fn gh_unauthenticated(message: String) -> RpcError {
    RpcError::new("gh_unauthenticated", message)
}

fn no_github_remote(message: String) -> RpcError {
    RpcError::new("no_github_remote", message)
}

/// Shared bounded-spawn outcome mapping (mirrors `worktree_rpc::run_git`'s
/// shape; that helper is module-private, so the mapping is repeated here
/// rather than widened for one caller).
fn map_spawn_outcome(
    program: &str,
    argv: &[String],
    outcome: SpawnOutcome,
) -> Result<String, RpcError> {
    match outcome {
        SpawnOutcome::Exited { status, stdout, .. } if status.success() => Ok(stdout),
        SpawnOutcome::Exited { status, stderr, .. } => Err(error::io_error(format!(
            "{program} {} exited with {status}: {}",
            argv.join(" "),
            stderr.trim()
        ))),
        SpawnOutcome::TimedOut => Err(error::unverifiable(format!(
            "{program} {} timed out and was killed before completing",
            argv.join(" ")
        ))),
        SpawnOutcome::CapExceeded => Err(error::io_error(format!(
            "{program} {} exceeded the configured combined output byte cap and was killed",
            argv.join(" ")
        ))),
        SpawnOutcome::UnreapedAfterKill => Err(error::unverifiable(format!(
            "{program} {} was killed but could not be confirmed reaped",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureUnfinished => Err(error::unverifiable(format!(
            "{program} {} exited but its output capture had not finished draining",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureReadError(e) => Err(error::io_error(format!(
            "{program} {} output capture failed: {e}",
            argv.join(" ")
        ))),
        SpawnOutcome::CaptureInvalidUtf8(which) => Err(error::io_error(format!(
            "{program} {} produced {which} that is not valid UTF-8",
            argv.join(" ")
        ))),
    }
}

fn run_git(cwd: &Path, argv: &[String]) -> Result<String, RpcError> {
    let cmd = git_process::build_git_command_with_bin(Path::new("git"), cwd, argv);
    let outcome = git_process::spawn_and_capture_bounded(cmd, &tasks_budget())?;
    map_spawn_outcome("git", argv, outcome)
}

/// Runs one fixed `gh` argv shape. A missing binary becomes the typed
/// `gh_unavailable` error and auth-shaped stderr becomes the typed
/// `gh_unauthenticated` error; every other failure keeps the shared
/// `io_error`/`unverifiable` mapping so a real repo or network failure is
/// never mislabeled as "install/auth gh".
fn run_gh(cwd: &Path, argv: &[String]) -> Result<String, RpcError> {
    let cmd = git_process::build_gh_command_with_bin(&gh_bin(), cwd, argv);
    let outcome = match git_process::spawn_and_capture_bounded(cmd, &tasks_budget()) {
        Ok(outcome) => outcome,
        Err(spawn_err) if spawn_err.code == "io_error" => {
            return Err(gh_unavailable(format!(
                "gh executable could not be spawned ({}): install gh or check PATH",
                spawn_err.message
            )));
        }
        Err(spawn_err) => return Err(spawn_err),
    };
    match &outcome {
        SpawnOutcome::Exited { status, stderr, .. }
            if !status.success() && git_process::is_gh_auth_failure(stderr) =>
        {
            Err(gh_unauthenticated(format!(
                "gh is not authenticated for this host ({}): run `gh auth login`, then retry",
                stderr.trim()
            )))
        }
        _ => map_spawn_outcome("gh", argv, outcome),
    }
}

// --- GitHub remote detection -------------------------------------------------

/// Parses `owner/repo` out of an origin URL. Accepts the transports `gh`
/// itself accepts for github.com (`https://`, `http://`, `git@` scp syntax,
/// `ssh://git@`); anything else (no remote, another host, unparsable)
/// means this project has no GitHub remote, never a guessed repo.
fn parse_github_repo(url: &str) -> Option<String> {
    let url = url.trim();
    let path = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest.to_string()
    } else {
        let without_scheme = url.split("://").nth(1).unwrap_or(url);
        let without_user = without_scheme
            .split('@')
            .next_back()
            .unwrap_or(without_scheme);
        let (host, path) = match without_user.split_once(['/', ':']) {
            Some((host, path)) => (host, path),
            None => return None,
        };
        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }
        path.to_string()
    };
    let path = path.strip_suffix(".git").unwrap_or(&path);
    let path = path.trim_matches('/');
    let (owner, repo) = path.split_once('/')?;
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

/// Resolves the `owner/repo` slug from the project's origin remote without
/// any network traffic (`git config --get`, local only). A missing origin
/// (`git config --get` exits non-zero) and a non-GitHub origin both become
/// the typed `no_github_remote` error; timeouts stay `unverifiable`.
fn github_repo_for_project(project_path: &str) -> Result<String, RpcError> {
    let argv = vec![
        "config".to_string(),
        "--get".to_string(),
        "remote.origin.url".to_string(),
    ];
    let url = match run_git(Path::new(project_path), &argv) {
        Ok(url) => url,
        Err(err) if err.code == "io_error" => {
            return Err(no_github_remote(
                "this repository has no origin remote pointing at GitHub".to_string(),
            ));
        }
        Err(err) => return Err(err),
    };
    parse_github_repo(&url).ok_or_else(|| {
        no_github_remote(format!(
            "the origin remote ('{}') is not a GitHub repository",
            url.trim()
        ))
    })
}

// --- `gh issue` JSON ----------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GhLabel {
    #[serde(default)]
    name: String,
    #[serde(default)]
    color: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhAssignee {
    #[serde(default)]
    login: String,
}

#[derive(Debug, Deserialize)]
struct GhIssue {
    #[serde(default)]
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    labels: Vec<GhLabel>,
    #[serde(default)]
    assignees: Vec<GhAssignee>,
    #[serde(default)]
    author: Option<GhAssignee>,
    #[serde(rename = "updatedAt", default)]
    updated_at: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    body: Option<String>,
}

fn convert_issue(raw: GhIssue) -> Result<TaskIssue, RpcError> {
    if raw.number == 0 || raw.title.is_empty() {
        return Err(error::io_error(
            "gh returned an issue without a number or title".to_string(),
        ));
    }
    let state = match raw.state.as_deref().unwrap_or("OPEN") {
        "OPEN" => TaskIssueState::Open,
        "CLOSED" => TaskIssueState::Closed,
        other => {
            return Err(error::io_error(format!(
                "gh returned an unknown issue state: {other}"
            )));
        }
    };
    Ok(TaskIssue {
        number: raw.number,
        title: raw.title,
        state,
        labels: raw
            .labels
            .into_iter()
            .filter(|label| !label.name.is_empty())
            .map(|label| TaskLabel {
                name: label.name,
                color: label.color,
            })
            .collect(),
        assignees: raw
            .assignees
            .into_iter()
            .map(|assignee| assignee.login)
            .filter(|login| !login.is_empty())
            .collect(),
        author: raw
            .author
            .map(|author| author.login)
            .filter(|login| !login.is_empty()),
        updated_at: raw.updated_at,
        url: raw.url,
        body: raw.body,
    })
}

fn list_argv(repo: &str, state: TaskIssueState, limit: u64) -> Vec<String> {
    vec![
        "issue".to_string(),
        "list".to_string(),
        "--repo".to_string(),
        repo.to_string(),
        "--state".to_string(),
        state.as_gh_flag().to_string(),
        "--limit".to_string(),
        limit.to_string(),
        "--json".to_string(),
        "number,title,state,labels,assignees,author,updatedAt,url".to_string(),
    ]
}

fn view_argv(repo: &str, number: u64) -> Vec<String> {
    vec![
        "issue".to_string(),
        "view".to_string(),
        number.to_string(),
        "--repo".to_string(),
        repo.to_string(),
        "--json".to_string(),
        "number,title,state,body,labels,assignees,updatedAt,url".to_string(),
    ]
}

/// Client-side substring filter: title contains (case-insensitive), or an
/// exact issue-number match (`123` or `#123`). `gh --search` needs repo
/// search qualifiers and ranks; a bounded local filter is honest and exact.
fn matches_query(issue: &TaskIssue, query: &str) -> bool {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.trim_start_matches('#') == issue.number.to_string() {
        return true;
    }
    issue.title.to_lowercase().contains(&trimmed.to_lowercase())
}

// --- worktree naming ----------------------------------------------------------

/// Derives the `issue-123-slug` branch/directory name from an issue title:
/// lowercase alphanumerics, every other run collapsed to one `-`, at most
/// 40 title chars, `task` when nothing survives. The result always goes
/// through `worktree.create`'s own `validate_worktree_add` before use.
fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = true;
    for ch in title.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
        if slug.len() >= 40 {
            break;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "task".to_string()
    } else {
        slug
    }
}

fn start_branch_name(number: u64, title: &str, attempt: u32) -> String {
    let base = format!("issue-{number}-{}", slugify(title));
    if attempt == 0 {
        base
    } else {
        format!("{base}-{}", attempt + 1)
    }
}

// --- `task_links` rows ---------------------------------------------------------
//
// The link table is ensured lazily (`IF NOT EXISTS`, idempotent and
// race-safe under SQLite) inside the handlers that need it, following the
// `create_tables`/`apply_pending_steps` shape without a second migration
// track: links only ever exist alongside worktrees, and `tasks.links`
// inner-joins `worktrees` so a removed worktree's link stops resolving
// instead of dangling.

fn ensure_task_links_table(conn: &rusqlite::Connection) -> Result<(), RpcError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS task_links (
            project_id TEXT NOT NULL,
            issue_number INTEGER NOT NULL,
            worktree_id TEXT NOT NULL UNIQUE,
            branch TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (project_id, issue_number)
        );",
    )
    .map_err(error::from_sqlite)
}

fn worktree_struct(conn: &rusqlite::Connection, worktree_id: &str) -> Result<Worktree, RpcError> {
    conn.query_row(
        "SELECT id, project_id, workspace_id, path, branch, head, base_ref FROM worktrees WHERE id = ?1",
        [worktree_id],
        |row| {
            Ok(Worktree {
                id: row.get(0)?,
                project_id: row.get(1)?,
                workspace_id: row.get(2)?,
                path: row.get(3)?,
                branch: row.get(4)?,
                head: row.get(5)?,
                base_ref: row.get(6)?,
                created_at: String::new(),
            })
        },
    )
    .optional()
    .map_err(error::from_sqlite)?
    .ok_or_else(|| error::not_found("linked worktree no longer exists"))
}

fn link_struct(
    project_id: &str,
    issue_number: u64,
    worktree: &Worktree,
    created_at: &str,
) -> TaskLink {
    TaskLink {
        project_id: project_id.to_string(),
        issue_number,
        worktree_id: worktree.id.clone(),
        branch: worktree.branch.clone(),
        created_at: created_at.to_string(),
    }
}

fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone())
        .map_err(|_| error::invalid_argument("Invalid tasks request parameters"))
}

impl Engine {
    fn tasks_git_project_path(&self, project_id: &str) -> Result<(String, String), RpcError> {
        let conn = self.db.lock().unwrap();
        let project = crate::project::get(&conn, project_id)?;
        if project.kind != "git" {
            return Err(error::invalid_argument(
                "tasks.* requires a git project; a folder project has no GitHub remote",
            ));
        }
        Ok((project.id, project.path))
    }

    pub(super) fn do_tasks_list(&self, value: &Value) -> Result<Value, RpcError> {
        let params: TasksListParams = decode(value)?;
        let (state, query, page, per_page) = params.validate()?;
        let (_, project_path) = self.tasks_git_project_path(&params.project_id)?;
        let repo = github_repo_for_project(&project_path)?;
        // Fetch one row past the requested window so `hasNextPage` is
        // proven, not guessed from a full page. Bounded by MAX_TASKS_PAGE *
        // MAX_TASKS_PER_PAGE + 1 (see the protocol constants).
        let fetch_limit = (page * per_page + 1).min(MAX_TASKS_PAGE * MAX_TASKS_PER_PAGE + 1);
        let stdout = run_gh(
            Path::new(&project_path),
            &list_argv(&repo, state, fetch_limit),
        )?;
        let raw: Vec<GhIssue> = serde_json::from_str(&stdout)
            .map_err(|_| error::io_error("gh issue list returned unparsable JSON".to_string()))?;
        let mut matching = Vec::with_capacity(raw.len());
        for item in raw {
            let issue = convert_issue(item)?;
            if query.as_deref().is_some_and(|q| !matches_query(&issue, q)) {
                continue;
            }
            matching.push(issue);
        }
        // Slice the requested window out of the query-filtered stream; the
        // extra fetched row proves a next page without ever being served.
        let skip = ((page - 1) * per_page) as usize;
        let has_next_page = matching.len() > skip + per_page as usize;
        let issues: Vec<TaskIssue> = matching
            .into_iter()
            .skip(skip)
            .take(per_page as usize)
            .collect();
        let result = TasksListResult {
            repo,
            issues,
            page,
            per_page,
            has_next_page,
            // `gh issue list` exposes no total count; the field stays for
            // upstreams that do (see TasksListResult.total).
            total: None,
        };
        serde_json::to_value(&result)
            .map_err(|_| error::internal_error("Could not serialize tasks list"))
    }

    pub(super) fn do_tasks_show(&self, value: &Value) -> Result<Value, RpcError> {
        let params: TasksShowParams = decode(value)?;
        params.validate()?;
        let (_, project_path) = self.tasks_git_project_path(&params.project_id)?;
        let repo = github_repo_for_project(&project_path)?;
        let stdout = run_gh(Path::new(&project_path), &view_argv(&repo, params.number))?;
        let raw: GhIssue = serde_json::from_str(&stdout)
            .map_err(|_| error::io_error("gh issue view returned unparsable JSON".to_string()))?;
        let issue = convert_issue(raw)?;
        if issue.number != params.number {
            return Err(error::io_error(
                "gh issue view returned a different issue than requested".to_string(),
            ));
        }
        let result = TasksShowResult { issue };
        serde_json::to_value(&result)
            .map_err(|_| error::internal_error("Could not serialize tasks show"))
    }

    pub(super) fn do_tasks_start(&self, value: &Value) -> Result<Value, RpcError> {
        let params: TasksStartParams = decode(value)?;
        params.validate()?;
        let (project_id, project_path) = self.tasks_git_project_path(&params.project_id)?;
        let repo = github_repo_for_project(&project_path)?;

        // An existing link makes a repeated start idempotent: return the
        // live worktree instead of creating a second one. (The request
        // ledger additionally dedupes retried requestIds.)
        let existing: Option<(String, String)> = {
            let conn = self.db.lock().unwrap();
            ensure_task_links_table(&conn)?;
            conn.query_row(
                "SELECT l.worktree_id, l.created_at FROM task_links l
                 INNER JOIN worktrees w ON w.id = l.worktree_id
                 WHERE l.project_id = ?1 AND l.issue_number = ?2",
                rusqlite::params![project_id, params.number as i64],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(error::from_sqlite)?
        };
        if let Some((worktree_id, created_at)) = existing {
            let conn = self.db.lock().unwrap();
            let worktree = worktree_struct(&conn, &worktree_id)?;
            let link = link_struct(&project_id, params.number, &worktree, &created_at);
            let result = TasksStartResult {
                issue_number: params.number,
                worktree,
                link,
            };
            return serde_json::to_value(&result)
                .map_err(|_| error::internal_error("Could not serialize tasks start"));
        }

        let stdout = run_gh(Path::new(&project_path), &view_argv(&repo, params.number))?;
        let raw: GhIssue = serde_json::from_str(&stdout)
            .map_err(|_| error::io_error("gh issue view returned unparsable JSON".to_string()))?;
        let issue = convert_issue(raw)?;
        if issue.number != params.number {
            return Err(error::io_error(
                "gh issue view returned a different issue than requested".to_string(),
            ));
        }

        // `worktree.create` owns name validation and the "already exists"
        // refusal (see its message below, matched to pick a suffixed name);
        // this loop only retries that one refusal, every other error fails
        // the start honestly.
        let mut attempt = 0u32;
        let created: Value = loop {
            let name = start_branch_name(params.number, &issue.title, attempt);
            let outcome = self.do_worktree_create(&json!({
                "projectId": project_id,
                "name": name,
            }));
            match outcome {
                Ok(worktree) => break worktree,
                Err(err)
                    if err.code == "invalid_argument"
                        && err.message.contains("already exists")
                        && attempt < 8 =>
                {
                    attempt += 1;
                }
                Err(err) => return Err(err),
            }
        };
        let worktree_id = created["id"]
            .as_str()
            .ok_or_else(|| error::internal_error("worktree creation missing id"))?
            .to_string();

        let created_at = now_rfc3339();
        {
            let conn = self.db.lock().unwrap();
            ensure_task_links_table(&conn)?;
            conn.execute(
                "INSERT INTO task_links (project_id, issue_number, worktree_id, branch, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    project_id,
                    params.number as i64,
                    worktree_id,
                    created["branch"].as_str().unwrap_or(""),
                    created_at,
                ],
            )
            .map_err(error::from_sqlite)?;
        }

        let conn = self.db.lock().unwrap();
        let worktree = worktree_struct(&conn, &worktree_id)?;
        let link = link_struct(&project_id, params.number, &worktree, &created_at);
        let result = TasksStartResult {
            issue_number: params.number,
            worktree,
            link,
        };
        serde_json::to_value(&result)
            .map_err(|_| error::internal_error("Could not serialize tasks start"))
    }

    pub(super) fn do_tasks_links(&self, value: &Value) -> Result<Value, RpcError> {
        let params: TasksLinksParams = decode(value)?;
        params.validate()?;
        // Listing links resolves the project first so an unknown id is
        // `not_found`, never an empty list for a typo.
        let (project_id, _) = self.tasks_git_project_path(&params.project_id)?;
        let conn = self.db.lock().unwrap();
        ensure_task_links_table(&conn)?;
        let mut stmt = conn
            .prepare(
                "SELECT l.issue_number, l.worktree_id, l.branch, l.created_at FROM task_links l
                 INNER JOIN worktrees w ON w.id = l.worktree_id
                 WHERE l.project_id = ?1 ORDER BY l.issue_number",
            )
            .map_err(error::from_sqlite)?;
        let links: Vec<TaskLink> = stmt
            .query_map([&project_id], |row| {
                Ok(TaskLink {
                    project_id: project_id.clone(),
                    issue_number: row.get::<_, i64>(0)? as u64,
                    worktree_id: row.get(1)?,
                    branch: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(error::from_sqlite)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error::from_sqlite)?;
        let result = TasksLinksResult { links };
        serde_json::to_value(&result)
            .map_err(|_| error::internal_error("Could not serialize tasks links"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_ssh_and_scp_github_origins() {
        assert_eq!(
            parse_github_repo("https://github.com/example/repo.git"),
            Some("example/repo".into())
        );
        assert_eq!(
            parse_github_repo("https://github.com/example/repo"),
            Some("example/repo".into())
        );
        assert_eq!(
            parse_github_repo("git@github.com:example/repo.git"),
            Some("example/repo".into())
        );
        assert_eq!(
            parse_github_repo("ssh://git@github.com/example/repo.git"),
            Some("example/repo".into())
        );
        assert_eq!(
            parse_github_repo("  https://github.com/Example/Repo.git\n"),
            Some("Example/Repo".into())
        );
    }

    #[test]
    fn rejects_non_github_and_malformed_origins() {
        for bad in [
            "",
            "https://gitlab.com/example/repo.git",
            "git@gist.github.com:example/repo.git",
            "https://github.com/only-owner",
            "https://github.com//empty.git",
            "https://github.com/a/b/c",
            "/local/path/repo",
        ] {
            assert_eq!(parse_github_repo(bad), None, "must reject {bad:?}");
        }
    }

    #[test]
    fn slugifies_titles_into_branch_safe_names() {
        assert_eq!(slugify("Fix the sidebar crash"), "fix-the-sidebar-crash");
        assert_eq!(slugify("  spaces  & symbols!! "), "spaces-symbols");
        assert_eq!(slugify("!!!"), "task");
        assert_eq!(slugify(""), "task");
        assert_eq!(
            start_branch_name(7, "Fix the sidebar crash", 0),
            "issue-7-fix-the-sidebar-crash"
        );
        assert_eq!(
            start_branch_name(7, "Fix the sidebar crash", 1),
            "issue-7-fix-the-sidebar-crash-2"
        );
    }

    #[test]
    fn query_matches_titles_and_numbers_only() {
        let issue = TaskIssue {
            number: 123,
            title: "Fix the sidebar crash".into(),
            state: TaskIssueState::Open,
            labels: vec![],
            assignees: vec![],
            author: None,
            updated_at: String::new(),
            url: String::new(),
            body: None,
        };
        assert!(matches_query(&issue, ""));
        assert!(matches_query(&issue, "sidebar"));
        assert!(matches_query(&issue, "SIDEBAR"));
        assert!(matches_query(&issue, "123"));
        assert!(matches_query(&issue, "#123"));
        assert!(!matches_query(&issue, "browser"));
        assert!(!matches_query(&issue, "12"));
    }
}
