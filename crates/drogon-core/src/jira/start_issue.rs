//! Jira start-from-issue (R17-C): turn a Jira issue into a worktree through
//! the SAME daemon-side creation path as `tasks.start` (GitHub) — no
//! parallel worktree machinery — named from the issue key the fork's way
//! (`getJiraIssueWorkspaceSeed` in the fork's `src/shared/workspace-name.ts`
//! and `task-page-source-context.tsx`).
//! MIT Copyright (c) 2026 Lovecast Inc.

use drogon_protocol::RpcError;
use drogon_protocol::jira::{JiraStartIssueParams, JiraStartIssueResult};
use serde_json::json;

use crate::Engine;

/// Port of the fork's `slugifyForWorkspaceName`
/// (`src/shared/workspace-name.ts`): lowercase, slashes and whitespace
/// folds become hyphens, non `[a-z0-9._-]` characters collapse to hyphens,
/// no `..`, no leading/trailing `.-`, capped at 48 chars. The result is
/// git-ref-safe, which is why the composer preview and the daemon agree.
pub fn slugify_for_workspace_name(input: &str) -> String {
    // The fork first removes intra-word apostrophes ("don't" must not
    // become "don-t"): normalize curly quotes, then drop an apostrophe
    // with alphanumeric neighbors on both sides.
    let chars: Vec<char> = input
        .replace(['\u{2018}', '\u{2019}'], "'")
        .chars()
        .collect();
    let mut folded = String::with_capacity(input.len());
    for (index, ch) in chars.iter().enumerate() {
        if *ch == '\''
            && index > 0
            && index + 1 < chars.len()
            && chars[index - 1].is_alphanumeric()
            && chars[index + 1].is_alphanumeric()
        {
            continue;
        }
        if ch.is_whitespace() {
            if !folded.is_empty() && !folded.ends_with('-') {
                folded.push('-');
            }
            continue;
        }
        for lc in ch.to_lowercase() {
            folded.push(lc);
        }
    }
    // Everything outside [a-z0-9._-] becomes a hyphen (after lowercasing,
    // non-ASCII letters land here exactly like the fork's regex).
    let mapped: String = folded
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    // `-+` -> `-`.
    let mut collapsed = String::with_capacity(mapped.len());
    let mut last = '\0';
    for ch in mapped.chars() {
        if ch == '-' && last == '-' {
            continue;
        }
        collapsed.push(ch);
        last = ch;
    }
    // `..` is illegal in git refs; single dots survive.
    while collapsed.contains("..") {
        collapsed = collapsed.replace("..", ".");
    }
    let trimmed = collapsed.trim_matches(|c| c == '.' || c == '-');
    let mut out: String = trimmed.chars().take(48).collect();
    while out.ends_with(['-', '.', '_']) {
        out.pop();
    }
    out
}

/// Port of the fork's `getLinkedWorkItemTitleSubject`
/// (`src/shared/workspace-name.ts`) without the regex dependency: strips a
/// leading issue/PR/MR number prefix (`Issue #123: `), a leading `#123: `,
/// and any `(#123)` / `#123` tokens anywhere in the title. The alternation
/// is tried in the fork's order (issue, pr, pull request, mr, merge
/// request); matching is ASCII case-insensitive.
fn linked_work_item_title_subject(title: &str) -> String {
    let mut subject = title.trim().to_string();
    if let Some(rest) = strip_number_prefix(&subject) {
        subject = rest.trim().to_string();
    }
    // `(\([#!]?\d+\))`: literal parens wrapping an optional marker and
    // digits — removed everywhere.
    let mut without_parens = String::with_capacity(subject.len());
    let chars: Vec<char> = subject.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '('
            && index + 1 < chars.len()
            && matches!(chars[index + 1], '#' | '!')
            && index + 2 < chars.len()
            && chars[index + 2].is_ascii_digit()
        {
            let mut cursor = index + 2;
            while cursor < chars.len() && chars[cursor].is_ascii_digit() {
                cursor += 1;
            }
            if cursor < chars.len() && chars[cursor] == ')' {
                index = cursor + 1;
                continue;
            }
        }
        without_parens.push(chars[index]);
        index += 1;
    }
    // `\b#\d+\b`: a `#` at a word boundary, digits, then a word boundary.
    let chars: Vec<char> = without_parens.chars().collect();
    let mut kept: Vec<char> = Vec::with_capacity(chars.len());
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        if ch == '#' {
            let prev_ok = kept
                .last()
                .is_none_or(|c| !(c.is_ascii_alphanumeric() || *c == '_'));
            let mut cursor = index + 1;
            while cursor < chars.len() && chars[cursor].is_ascii_digit() {
                cursor += 1;
            }
            let digits = cursor - index - 1;
            let next_ok = cursor >= chars.len()
                || !(chars[cursor].is_ascii_alphanumeric() || chars[cursor] == '_');
            if prev_ok && digits > 0 && next_ok {
                index = cursor;
                continue;
            }
        }
        kept.push(ch);
        index += 1;
    }
    kept.into_iter().collect::<String>().trim().to_string()
}

/// The `^(?:issue|pr|pull request|mr|merge request)\s*[#!]?\d+\s*[:-]\s*`
/// prefix, or `^#\d+\s*[:-]\s*`, tried in the fork's alternation order.
fn strip_number_prefix(input: &str) -> Option<String> {
    const ALTERNATIVES: [&str; 5] = ["issue", "pr", "pull request", "mr", "merge request"];
    for alt in ALTERNATIVES {
        if starts_with_ignore_ascii_case(input, alt) {
            let tail: String = input.chars().skip(alt.chars().count()).collect();
            if let Some(rest) = strip_after_label(&tail) {
                return Some(rest);
            }
        }
    }
    let rest = input.strip_prefix('#')?;
    strip_after_label(rest)
}

/// Char-wise ASCII case-insensitive prefix check (never slices a char
/// boundary, whatever the input starts with).
fn starts_with_ignore_ascii_case(input: &str, prefix: &str) -> bool {
    let mut chars = input.chars();
    for expected in prefix.chars() {
        match chars.next() {
            Some(actual) if actual.eq_ignore_ascii_case(&expected) => {}
            _ => return false,
        }
    }
    true
}

/// Consumes `\s*[#!]?\d+\s*[:-]\s*` from the start; returns the rest when
/// the whole shape matches.
fn strip_after_label(after_label: &str) -> Option<String> {
    let chars: Vec<(usize, char)> = after_label.char_indices().collect();
    let mut index = 0;
    while index < chars.len() && chars[index].1.is_whitespace() {
        index += 1;
    }
    if index < chars.len() && matches!(chars[index].1, '#' | '!') {
        index += 1;
    }
    let digits_start = index;
    while index < chars.len() && chars[index].1.is_ascii_digit() {
        index += 1;
    }
    if index == digits_start {
        return None;
    }
    while index < chars.len() && chars[index].1.is_whitespace() {
        index += 1;
    }
    if index >= chars.len() || !matches!(chars[index].1, ':' | '-') {
        return None;
    }
    index += 1;
    while index < chars.len() && chars[index].1.is_whitespace() {
        index += 1;
    }
    Some(after_label[chars[index].0..].to_string())
}

/// Port of the fork's `getLinkedWorkItemWorkspaceName`
/// (`src/shared/workspace-name.ts`) for Jira work items — the seed hook
/// feeds it `{ type: 'issue', provider: 'jira', number: 0, title:
/// "{key} {title}", jiraIdentifier: key }`: displayName is `KEY Subject`
/// (identifier uppercased, the composite title's number tokens and leading
/// identifier prefix removed), seedName the slugified display name.
pub fn jira_issue_workspace_seed(key: &str, title: &str) -> Option<(String, String)> {
    let identifier = key;
    let composite = format!("{key} {title}");
    let mut subject = linked_work_item_title_subject(&composite);
    if subject.is_empty() {
        subject = composite.trim().to_string();
    }
    if !identifier.is_empty() {
        // `^IDENT\s*[:-]?\s*` (case-insensitive). The identifier is ASCII
        // (Jira keys match `[A-Z][A-Z0-9_]*-\d+`); match by chars so
        // multi-byte subjects cannot split a char boundary.
        let upper_ident: Vec<char> = identifier.to_uppercase().chars().collect();
        let subject_chars: Vec<char> = subject.chars().collect();
        let matches = subject_chars.len() >= upper_ident.len()
            && subject_chars[..upper_ident.len()]
                .iter()
                .collect::<String>()
                .to_uppercase()
                .chars()
                .eq(upper_ident.iter().copied());
        if matches {
            let rest: String = subject_chars[upper_ident.len()..].iter().collect();
            // `\s*[:-]?\s*` — whitespace first, at most ONE `:` or `-`.
            let rest = rest.trim_start();
            let rest = rest.strip_prefix([':', '-']).unwrap_or(rest).trim_start();
            subject = rest.to_string();
        }
    }
    let display = if subject.is_empty() {
        identifier.to_uppercase()
    } else {
        format!("{} {subject}", identifier.to_uppercase())
    };
    let seed = slugify_for_workspace_name(&display);
    if seed.is_empty() {
        None
    } else {
        Some((display, seed))
    }
}

/// The fork's `getLinkedWorkItemSuggestedName` fallback: slug of the raw
/// title's subject (or the trimmed raw title).
pub fn jira_issue_suggested_name(title: &str) -> String {
    let subject = linked_work_item_title_subject(title);
    let seed_source = if subject.is_empty() {
        title.trim()
    } else {
        subject.as_str()
    };
    slugify_for_workspace_name(seed_source)
}

impl Engine {
    /// `jira.startIssue`: resolves the issue (the renderer's title is only
    /// a fallback — the daemon re-reads the site for truth, the same
    /// discipline as `tasks.start` re-reading via `gh`), creates a
    /// worktree named from the issue key the fork's way through the shared
    /// `worktree.create` path (collision-retried like `tasks.start`),
    /// stamps the worktree's display title with the issue identity (the
    /// badge/link back to the issue) and returns both names so the
    /// renderer can launch the session with the fork's initial prompt.
    pub(crate) fn jira_start_issue(
        &self,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        let typed: JiraStartIssueParams = serde_json::from_value(params.clone()).map_err(|e| {
            RpcError::new(
                "invalid_argument",
                format!("Invalid jira.startIssue params: {e}"),
            )
        })?;
        let key = typed.key.trim().to_uppercase();
        if key.is_empty() {
            return Err(RpcError::new("invalid_argument", "Issue key is required"));
        }
        // The project must be a git project — same gate as tasks.start.
        {
            let conn = self.db.lock().unwrap();
            let project = crate::project::get(&conn, &typed.project_id)?;
            if project.kind != "git" {
                return Err(RpcError::new(
                    "invalid_argument",
                    "jira.startIssue requires a git project",
                ));
            }
        }

        // The issue's live title and url drive the fork's seed naming; the
        // renderer-passed title is the fallback when the read fails
        // (offline site), never a silent generic name.
        let (title, issue_url) =
            match super::issues::get_issue(&self.jira, &key, typed.site_id.as_deref()) {
                Ok(Some(issue)) => (issue.title, Some(issue.url)),
                _ => (typed.title.clone().unwrap_or_else(|| key.clone()), None),
            };
        let (display_name, seed_name) =
            jira_issue_workspace_seed(&key, &title).unwrap_or_else(|| {
                let fallback_seed = jira_issue_suggested_name(&title);
                (
                    key.clone(),
                    if fallback_seed.is_empty() {
                        "jira-issue".to_string()
                    } else {
                        fallback_seed
                    },
                )
            });

        // Idempotency, the tasks.start way: a worktree whose display title
        // already carries this issue key is the previous start's result.
        let existing: Option<String> = {
            let conn = self.db.lock().unwrap();
            conn.query_row(
                "SELECT id FROM worktrees WHERE project_id = ?1 AND title = ?2",
                rusqlite::params![typed.project_id, display_name],
                |row| row.get::<_, String>(0),
            )
            .ok()
        };
        let worktree_id: String = if let Some(id) = existing {
            id
        } else {
            let mut attempt = 0u32;
            loop {
                let name = if attempt == 0 {
                    seed_name.clone()
                } else {
                    format!("{}-{}", attempt + 1, seed_name)
                };
                let outcome = self.do_worktree_create(&json!({
                    "projectId": typed.project_id,
                    "name": name,
                }));
                match outcome {
                    Ok(worktree) => {
                        let id = worktree["id"]
                            .as_str()
                            .ok_or_else(|| {
                                RpcError::new("internal_error", "worktree creation missing id")
                            })?
                            .to_string();
                        // The badge/link back to the issue: the sidebar card
                        // renders the worktree's display title.
                        {
                            let conn = self.db.lock().unwrap();
                            conn.execute(
                                "UPDATE worktrees SET title = ?1 WHERE id = ?2",
                                rusqlite::params![display_name, id],
                            )
                            .map_err(crate::error::from_sqlite)?;
                        }
                        break id;
                    }
                    Err(err)
                        if err.code == "invalid_argument"
                            && err.message.contains("already exists")
                            && attempt < 8 =>
                    {
                        attempt += 1;
                    }
                    Err(err) => return Err(err),
                }
            }
        };

        let conn = self.db.lock().unwrap();
        let worktree_row = conn
            .query_row(
                "SELECT id, project_id, workspace_id, path, branch, head, base_ref, title, note, parent_worktree_id, created_at FROM worktrees WHERE id = ?1",
                [&worktree_id],
                |row| {
                    Ok(drogon_protocol::worktree::Worktree {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        workspace_id: row.get(2)?,
                        path: row.get(3)?,
                        branch: row.get(4)?,
                        head: row.get(5)?,
                        base_ref: row.get(6)?,
                        title: row.get(7)?,
                        note: row.get(8)?,
                        parent_worktree_id: row.get(9)?,
                        created_at: row.get(10)?,
                        // This response only needs `path` (the new
                        // worktree's checkout location); it never round
                        // trips through `worktree.list`, so Workspace
                        // Options metadata is left at its defaults rather
                        // than re-selecting eight more columns.
                        workspace_status: None,
                        is_pinned: false,
                        is_archived: false,
                        sort_order: 0,
                        manual_order: None,
                        last_activity_at: None,
                        linked_pr: None,
                        creator: None,
                    })
                },
            )
            .map_err(crate::error::from_sqlite)?;
        let result = JiraStartIssueResult {
            ok: true,
            key: key.clone(),
            url: issue_url.unwrap_or_default(),
            display_name,
            seed_name,
            worktree: worktree_row,
        };
        serde_json::to_value(&result)
            .map_err(|_| RpcError::new("internal_error", "cannot encode jira.startIssue result"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_matches_the_fork_shape() {
        assert_eq!(
            slugify_for_workspace_name("DROG-42 Fix the thing"),
            "drog-42-fix-the-thing"
        );
        assert_eq!(slugify_for_workspace_name("  a  b\tc "), "a-b-c");
        assert_eq!(slugify_for_workspace_name("a/b\\c"), "a-b-c");
        assert_eq!(slugify_for_workspace_name("dots..dots"), "dots.dots");
        assert_eq!(slugify_for_workspace_name("--lead--trail--"), "lead-trail");
        assert_eq!(slugify_for_workspace_name(&"x".repeat(80)), "x".repeat(48));
        assert_eq!(slugify_for_workspace_name("!!!"), "");
    }

    #[test]
    fn seed_names_the_fork_way() {
        // The fork feeds the workspace-name helper the composite title
        // `{key} {summary}` and strips only ONE leading identifier, so a
        // summary that already carries the key keeps it (fork-faithful).
        let (display, seed) =
            jira_issue_workspace_seed("drog-42", "DROG-42 Fix the thing").unwrap();
        assert_eq!(display, "DROG-42 DROG-42 Fix the thing");
        assert_eq!(seed, "drog-42-drog-42-fix-the-thing");
        // A summary without the key prefix is the common case.
        let (display, seed) = jira_issue_workspace_seed("drog-42", "Fix the thing").unwrap();
        assert_eq!(display, "DROG-42 Fix the thing");
        assert_eq!(seed, "drog-42-fix-the-thing");
        let (display, seed) = jira_issue_workspace_seed("ORCA-3", "Polish the picker").unwrap();
        assert_eq!(display, "ORCA-3 Polish the picker");
        assert_eq!(seed, "orca-3-polish-the-picker");
        // `getLinkedWorkItemTitleSubject` strips `(#812)` tokens.
        let (display, seed) = jira_issue_workspace_seed("DROG-1", "Fix crash (#812)").unwrap();
        assert_eq!(display, "DROG-1 Fix crash");
        assert_eq!(seed, "drog-1-fix-crash");
        // Number tokens inside the composite subject lose only their
        // `#123` marker; a leading `Issue #123: ` prefix would also strip.
        let (display, seed) = jira_issue_workspace_seed("ISSUE-9", "issue #123: fix it").unwrap();
        assert_eq!(display, "ISSUE-9 issue : fix it");
        assert_eq!(seed, "issue-9-issue-fix-it");
        // The `Issue #123: ` prefix only strips at the very start of the
        // composite title; the Jira key always precedes the summary, so
        // for Jira seeds only the `#123` marker removal is observable.
        let (display, seed) = jira_issue_workspace_seed("DROG-2", "Issue #42: fix it").unwrap();
        assert_eq!(display, "DROG-2 Issue : fix it");
        assert_eq!(seed, "drog-2-issue-fix-it");
        assert!(jira_issue_workspace_seed("KEY-1", "日本語").is_some());
        assert_eq!(jira_issue_suggested_name("日本語"), "");
    }
}
