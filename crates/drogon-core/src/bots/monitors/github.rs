//! `github_pr.v1` / `github_issue.v1` evaluation: one bounded,
//! authenticated read of a repository's open pull requests (or open
//! issues), then a dedupe decision over their numbers.
//!
//! The two kinds share EVERY line below — the transport, the dedupe set,
//! the seeding rule and the commit shape — because a watch that replayed
//! the backlog on first run would be the same bug twice. Only three things
//! differ, all carried by [`GithubTarget`]: the list path GitHub is asked
//! for, the namespace an event id is minted in, and the `pull/<n>` vs
//! `issue/<n>` resource a release names. One extra rule applies to issues
//! alone: GitHub's issues endpoint also returns pull requests (every PR is
//! an issue), and [`filter_items`] drops those, so an issue watch never
//! fires for a pull request.
//!
//! Three properties this module owns, each pinned by its own test:
//!
//! - **The token never persists.** The rule names secret REFERENCES; the
//!   value is resolved by [`crate::integrations::resolve`] inside the
//!   caller's transaction (grant re-read every tick) and lives only in the
//!   memory of one `curl` child. Every byte this module can return for
//!   persistence (error text, check-in messages) has passed
//!   [`crate::integrations::resolve::scrub_for_persist`].
//! - **The same PR (or issue) never fires twice.** Dedupe is a per-monitor
//!   table of the numbers that have already been released
//!   (`bot_monitor_github_seen`), never a digest of the response bytes: an
//!   unrelated comment on PR #41 cannot re-release it. A seen set that
//!   cannot be READ (a locked or corrupt database, a row that is not a
//!   number) fails the tick as [`MonitorErrorKind::IoError`]; only a table
//!   that does not exist reads as "this watch has never released anything".
//! - **The whole open list is read, or the poll says so.** One poll walks
//!   the pages of the open list (oldest first) until a short page or a
//!   `Link` header without `rel="next"` ends it, bounded by
//!   [`GITHUB_MAX_PAGES`]. A list longer than that bound is an honest
//!   `Oversized` error: a truncated prefix is never committed as "the open
//!   set", because treating one page as the whole list is exactly how a
//!   repository with more than 100 open items never sees its newest pull
//!   request.
//! - **An outage is never a catch-up storm.** A watch that was not
//!   watching (first ever check, or a gap wider than the greater of
//!   [`GITHUB_CATCH_UP_GRACE_MS`] and twice its cron interval) SEEDS: it
//!   records the pull requests it can see as already seen and releases
//!   nothing. Manual-trigger monitors use the plain catch-up grace. The
//!   delegation drain's own stale-grace then applies to the change that was
//!   observed while the daemon was down — the same "never caught up" rule as
//!   the scheduler's missed-run grace.
//!
//! Transport: the platform `curl` binary (the daemon has no HTTP client
//! dependency; see `crate::jira::client`, whose bounded-curl discipline this
//! reuses, including its test-only binary override seam). GET only, no
//! redirects, connect and total deadlines, a hard body ceiling read before
//! parsing, and no response body ever persisted.

use std::collections::BTreeSet;
use std::io::Read as _;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Deserialize;

use super::result::{MonitorCheckResult, MonitorErrorKind};
use super::rule::{
    GITHUB_MAX_PAGES, GITHUB_PULLS_PER_PAGE, GithubIssueFilter, GithubIssueRule, GithubPrFilter,
    GithubPrRule,
};

/// A watch whose last successful check is older than this seeds forward
/// instead of replaying the backlog. Matches the delegation drain's own
/// outage grace: a change older than this is one nobody was watching.
pub const GITHUB_CATCH_UP_GRACE_MS: f64 = 30.0 * 60.0 * 1000.0;

/// Longest persisted error text (chars) — the check-in message bound.
const MAX_ERROR_CHARS: usize = 512;

/// Longest response header block a poll reads, in bytes. GitHub's own block
/// is a couple of kilobytes; this is the ceiling that keeps the paging
/// signal from becoming a second unbounded read.
const MAX_HEADER_BYTES: usize = 16 * 1024;

/// How many numbers a monitor's seen set retains (newest kept). The
/// oldest numbers fall out of the set, so one that leaves and re-enters
/// the open list may be released again — bounded, honest, and never
/// unbounded growth.
///
/// This bounds the DEDUPE SET, not the watch's reach: a poll walks every
/// page of the open list (see [`read_open_items`]), so the newest item is
/// seen even while older ones stay open. What this bound costs is memory of
/// the OLDEST releases, never anything the watch can no longer see.
pub const MAX_SEEN_PULLS: usize = 512;

/// Which GitHub collection a watch reads. A monitor has exactly one kind,
/// so this is fixed for the life of a rule and rides inside its approval
/// hash by way of the rule variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GithubTarget {
    /// `github_pr.v1`: the repository's open pull requests.
    Pulls,
    /// `github_issue.v1`: the repository's open issues, pull requests
    /// excluded.
    Issues,
}

impl GithubTarget {
    /// The REST list path segment this target reads.
    pub fn path_segment(self) -> &'static str {
        match self {
            Self::Pulls => "pulls",
            Self::Issues => "issues",
        }
    }

    /// Namespace for minted event ids, so an id says which kind of case it
    /// belongs to and the two can never be confused in evidence.
    pub fn event_namespace(self) -> &'static str {
        match self {
            Self::Pulls => "github_pr",
            Self::Issues => "github_issue",
        }
    }

    /// The `resource` prefix one released number carries (`pull/42`,
    /// `issue/42`) — WHAT the firing released.
    pub fn resource_prefix(self) -> &'static str {
        match self {
            Self::Pulls => "pull",
            Self::Issues => "issue",
        }
    }
}

/// Which open items a watch considers "for me". The pull-request kind's
/// third case (`review_requested`) has no issue analogue; an issue rule
/// simply never produces it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GithubWatchFilter {
    Opened,
    Assigned,
    ReviewRequested,
}

/// The kind-independent projection of a GitHub watch rule: everything one
/// poll needs, borrowed. Both rule kinds convert into it, so the evaluator
/// below has a single code path and the two watches cannot drift.
pub struct GithubWatch<'a> {
    pub target: GithubTarget,
    pub repo: &'a str,
    pub filter: GithubWatchFilter,
    /// The login `assigned` / `review_requested` compare against. `None`
    /// with such a filter matches nothing (validation forbids the shape;
    /// the evaluator still refuses to guess).
    pub login: Option<&'a str>,
    pub api_base: Option<&'a str>,
    pub timeout_ms: u64,
    pub max_body_bytes: u64,
}

impl<'a> From<&'a GithubPrRule> for GithubWatch<'a> {
    fn from(rule: &'a GithubPrRule) -> Self {
        Self {
            target: GithubTarget::Pulls,
            repo: &rule.repo,
            filter: match rule.filter {
                GithubPrFilter::Opened => GithubWatchFilter::Opened,
                GithubPrFilter::Assigned => GithubWatchFilter::Assigned,
                GithubPrFilter::ReviewRequested => GithubWatchFilter::ReviewRequested,
            },
            login: rule.login.as_deref(),
            api_base: rule.api_base.as_deref(),
            timeout_ms: rule.timeout_ms,
            max_body_bytes: rule.max_body_bytes,
        }
    }
}

impl<'a> From<&'a GithubIssueRule> for GithubWatch<'a> {
    fn from(rule: &'a GithubIssueRule) -> Self {
        Self {
            target: GithubTarget::Issues,
            repo: &rule.repo,
            filter: match rule.filter {
                GithubIssueFilter::Opened => GithubWatchFilter::Opened,
                GithubIssueFilter::Assigned => GithubWatchFilter::Assigned,
            },
            login: rule.login.as_deref(),
            api_base: rule.api_base.as_deref(),
            timeout_ms: rule.timeout_ms,
            max_body_bytes: rule.max_body_bytes,
        }
    }
}

/// The subset this watch needs from GitHub's pull or issue list.
#[derive(Debug, Clone, Deserialize)]
struct GithubItem {
    number: u64,
    #[serde(default)]
    assignees: Vec<GithubLogin>,
    #[serde(default)]
    requested_reviewers: Vec<GithubLogin>,
    /// Present (and non-null) only on a pull request. GitHub's ISSUES
    /// endpoint returns pull requests too — every PR is an issue — and
    /// this is the field that tells them apart, so an issue watch can drop
    /// them instead of firing a triage session for a code review.
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubLogin {
    login: String,
}

/// What one poll decided. `Emit` carries a ready-to-commit check result for
/// one released pull request plus the seen set its commit must record;
/// `Seed` carries the silently-advanced baseline (cursor + seen set);
/// `Error` is an honest check-in that retains the prior cursor.
#[derive(Debug, Clone, PartialEq)]
pub enum GithubPollOutcome {
    Emit {
        result: MonitorCheckResult,
        /// `pull/<n>` for the released pull request.
        resource: String,
        /// The dedupe set to commit with this cursor.
        seen: BTreeSet<u64>,
    },
    Seed {
        cursor: String,
        seen: BTreeSet<u64>,
        reason: &'static str,
    },
    Error {
        error_kind: MonitorErrorKind,
        message: String,
    },
}

/// The pure dedupe decision, split out so it is testable without a network
/// or a clock: given the repository's open pull numbers, the numbers
/// already released, and the current cursor, what happens now?
#[derive(Debug, Clone, PartialEq)]
pub enum GithubDedupeDecision {
    /// No unseen pull request: nothing to release.
    Nothing,
    /// Release this pull request (the oldest unseen one, so a burst drains
    /// in arrival order) and record the resulting seen-set cursor.
    Release { number: u64, cursor: String },
    /// Record these numbers as the baseline and release nothing.
    Seed { cursor: String },
}

/// Deterministic, bounded cursor for a seen set: `v1:<sha256 of the sorted
/// numbers joined by commas>`. Same set ⇒ same cursor (so a replay is a
/// no-change tick); a different set ⇒ a different cursor.
pub fn cursor_for_seen(seen: &BTreeSet<u64>) -> String {
    let joined = seen
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    crate::bots::monitors::eval::cursor_for_digest(&crate::bots::monitors::eval::digest_bytes(
        joined.as_bytes(),
    ))
}

/// Stable event id for one released number on one monitor:
/// `mev_<sha256[..32]>`. The same PR (or issue) on the same watch always
/// mints the same event id, so a redelivered tick is a duplicate rather
/// than a second release. The target's namespace is part of the digest, so
/// a pull-request watch and an issue watch can never mint the same id.
pub fn event_id_for_number(target: GithubTarget, monitor_id: &str, number: u64) -> String {
    let digest = crate::bots::monitors::eval::digest_bytes(
        format!("{}:{monitor_id}:{number}", target.event_namespace()).as_bytes(),
    );
    crate::bots::monitors::eval::event_id_for(monitor_id, &"00".repeat(32), &digest)
}

/// Prune a seen set to the newest [`MAX_SEEN_PULLS`] numbers.
fn prune(seen: &mut BTreeSet<u64>) {
    while seen.len() > MAX_SEEN_PULLS {
        let oldest = *seen.iter().next().expect("non-empty");
        seen.remove(&oldest);
    }
}

/// Decide now, given the current state. Pure.
///
/// The RELEASED set is what gets committed, never "every pull I can see":
/// releasing one pull request only ever marks that one seen, so a burst
/// drains one per tick instead of silently swallowing the rest.
pub fn decide(
    monitor_id: &str,
    numbers: &[u64],
    seen: &BTreeSet<u64>,
    seed_baseline: bool,
) -> GithubDedupeDecision {
    let _ = monitor_id;
    if seed_baseline {
        let mut baseline = seen.clone();
        baseline.extend(numbers.iter().copied());
        prune(&mut baseline);
        return GithubDedupeDecision::Seed {
            cursor: cursor_for_seen(&baseline),
        };
    }
    let unseen = numbers
        .iter()
        .copied()
        .filter(|number| !seen.contains(number))
        .min();
    match unseen {
        None => GithubDedupeDecision::Nothing,
        Some(number) => {
            let mut released = seen.clone();
            released.insert(number);
            prune(&mut released);
            GithubDedupeDecision::Release {
                number,
                cursor: cursor_for_seen(&released),
            }
        }
    }
}

/// The seen set a decision commits alongside its cursor.
pub fn seen_after(
    decision: &GithubDedupeDecision,
    numbers: &[u64],
    seen: &BTreeSet<u64>,
) -> BTreeSet<u64> {
    let mut next = seen.clone();
    match decision {
        GithubDedupeDecision::Nothing => {}
        GithubDedupeDecision::Release { number, .. } => {
            next.insert(*number);
        }
        GithubDedupeDecision::Seed { .. } => next.extend(numbers.iter().copied()),
    }
    prune(&mut next);
    next
}

/// Turn a decision into the outcome the tick commits.
/// What one poll observed, for [`result_for`]: the watch it belongs to,
/// the numbers it read and the state it read them against.
pub struct PollContext<'a> {
    pub target: GithubTarget,
    pub monitor_id: &'a str,
    pub monitor_version: u64,
    /// The filtered numbers this poll saw.
    pub numbers: &'a [u64],
    /// The dedupe set as it was BEFORE this poll.
    pub seen: &'a BTreeSet<u64>,
    /// Last accepted cursor, retained by a no-change tick.
    pub cursor_before: Option<&'a str>,
    pub observed_at_ms: f64,
}

pub fn result_for(poll: &PollContext<'_>, decision: &GithubDedupeDecision) -> GithubPollOutcome {
    let PollContext {
        target,
        monitor_id,
        monitor_version,
        numbers,
        seen,
        cursor_before,
        observed_at_ms,
    } = *poll;
    let seen_next = seen_after(decision, numbers, seen);
    match decision {
        GithubDedupeDecision::Nothing => GithubPollOutcome::Emit {
            result: MonitorCheckResult::no_change(
                monitor_id,
                monitor_version,
                cursor_before
                    .map(str::to_string)
                    .unwrap_or_else(|| cursor_for_seen(seen)),
                observed_at_ms,
            ),
            resource: String::new(),
            seen: seen_next,
        },
        GithubDedupeDecision::Seed { cursor } => GithubPollOutcome::Seed {
            cursor: cursor.clone(),
            seen: seen_next,
            reason: "baseline seeded; the backlog is never replayed",
        },
        GithubDedupeDecision::Release { number, cursor } => GithubPollOutcome::Emit {
            result: MonitorCheckResult::changed(
                monitor_id,
                monitor_version,
                event_id_for_number(target, monitor_id, *number),
                cursor.clone(),
                observed_at_ms,
            ),
            resource: resource_for_number(target, *number),
            seen: seen_next,
        },
    }
}

/// Filter GitHub's list down to the watch's case.
///
/// An ISSUE watch drops every item carrying `pull_request` first: GitHub's
/// issues endpoint returns pull requests as issues, and a watch asked for
/// issues must never release a code review as if it were a bug report.
pub fn filter_items(watch: &GithubWatch<'_>, items: &[GithubItemView]) -> Vec<u64> {
    let mut numbers: Vec<u64> = items
        .iter()
        .filter(|item| match watch.target {
            GithubTarget::Issues => !item.is_pull_request,
            GithubTarget::Pulls => true,
        })
        .filter(|item| match watch.filter {
            GithubWatchFilter::Opened => true,
            GithubWatchFilter::Assigned => watch
                .login
                .is_some_and(|login| item.assignees.iter().any(|who| who == login)),
            GithubWatchFilter::ReviewRequested => watch
                .login
                .is_some_and(|login| item.requested_reviewers.iter().any(|who| who == login)),
        })
        .map(|item| item.number)
        .collect();
    numbers.sort_unstable();
    numbers
}

/// One pull request or issue as the filter sees it (a projection of the
/// JSON above, so the filter is testable without a server).
#[derive(Debug, Clone, PartialEq)]
pub struct GithubItemView {
    pub number: u64,
    pub assignees: Vec<String>,
    pub requested_reviewers: Vec<String>,
    /// True when GitHub marked this row as a pull request.
    pub is_pull_request: bool,
}

impl GithubItemView {
    fn from_wire(item: GithubItem) -> Self {
        Self {
            number: item.number,
            assignees: item.assignees.into_iter().map(|who| who.login).collect(),
            requested_reviewers: item
                .requested_reviewers
                .into_iter()
                .map(|who| who.login)
                .collect(),
            is_pull_request: item.pull_request.is_some_and(|value| !value.is_null()),
        }
    }
}

/// Parse GitHub's list body into the projection. A body that is not a JSON
/// array of objects is a `Malformed` refusal, never a guess.
pub fn parse_items(body: &str) -> Result<Vec<GithubItemView>, String> {
    let items: Vec<GithubItem> =
        serde_json::from_str(body).map_err(|e| format!("list is not the expected JSON: {e}"))?;
    Ok(items.into_iter().map(GithubItemView::from_wire).collect())
}

/// The exact URL one poll reads for ONE page (1-based):
/// `{apiBase}/repos/{owner}/{name}/{pulls|issues}?...&page={page}`.
///
/// The page number is minted here rather than taken from the response's
/// `Link` header on purpose: the header is a SIGNAL that another page
/// exists ([`link_has_next`]), never a URL this transport will follow. The
/// `Authorization` header only ever rides to the base the rule named, so a
/// rewritten `Link` cannot walk the token to another host — the same reason
/// the transport refuses redirects.
pub fn list_url(
    target: GithubTarget,
    api_base: &str,
    repo: &str,
    page: u32,
) -> Result<String, String> {
    let base = api_base.trim_end_matches('/');
    let segments: Vec<&str> = repo.split('/').collect();
    if segments.len() != 2 || segments.iter().any(|segment| segment.is_empty()) {
        return Err("repo must be 'owner/name'".to_string());
    }
    Ok(format!(
        "{base}/repos/{}/{}/{}?state=open&sort=created&direction=asc&per_page={GITHUB_PULLS_PER_PAGE}&page={page}",
        segments[0],
        segments[1],
        target.path_segment(),
    ))
}

/// Does this `Link` header advertise another page? GitHub sends
/// `<...>; rel="next", <...>; rel="last"` while paging and omits the header
/// entirely when the page in hand is the only one.
pub fn link_has_next(link: &str) -> bool {
    link.split(',').any(|entry| {
        entry.split(';').skip(1).any(|param| {
            param.split_once('=').is_some_and(|(key, value)| {
                key.trim().eq_ignore_ascii_case("rel")
                    && value.trim().trim_matches('"').eq_ignore_ascii_case("next")
            })
        })
    })
}

/// Why reading a watch's full open list failed. Each variant maps to one
/// honest monitor error; none of them is "here is a prefix, call it the
/// open set".
#[derive(Debug, Clone, PartialEq)]
pub enum GithubListError {
    /// The transport failed on some page.
    Fetch(GithubFetchError),
    /// GitHub answered a non-200 on some page.
    Status(u16),
    /// A page's body was not the expected JSON (or the repo is not
    /// `owner/name`).
    Malformed(String),
    /// The open list is longer than `pages` pages of
    /// [`GITHUB_PULLS_PER_PAGE`]. The poll holds a prefix and refuses to
    /// commit it: the newest items are exactly what a prefix hides.
    Truncated { pages: u32 },
}

/// Read every page of a watch's open list through `get`, oldest first.
///
/// `get` receives the 1-based page number and the URL to read, so a caller
/// can spend one shared deadline across the walk (and so a test can drive
/// it with no network at all). The walk stops on the first page that is
/// SHORT, or whose `Link` header does not advertise a next page; a full page
/// with no `Link` header at all is never assumed to be the last one. At
/// [`GITHUB_MAX_PAGES`] with more still to read it returns
/// [`GithubListError::Truncated`] rather than a silent prefix.
pub fn read_open_items<F>(
    target: GithubTarget,
    api_base: &str,
    repo: &str,
    mut get: F,
) -> Result<Vec<GithubItemView>, GithubListError>
where
    F: FnMut(u32, &str) -> Result<GithubFetch, GithubFetchError>,
{
    let per_page = GITHUB_PULLS_PER_PAGE as usize;
    let mut items: Vec<GithubItemView> = Vec::new();
    for page in 1..=GITHUB_MAX_PAGES {
        let url = list_url(target, api_base, repo, page).map_err(GithubListError::Malformed)?;
        let fetched = get(page, &url).map_err(GithubListError::Fetch)?;
        if fetched.status != 200 {
            return Err(GithubListError::Status(fetched.status));
        }
        let parsed = parse_items(&fetched.body).map_err(GithubListError::Malformed)?;
        let full_page = parsed.len() >= per_page;
        items.extend(parsed);
        let more = match fetched.link.as_deref() {
            // GitHub told us where the list ends; believe it while it speaks.
            Some(link) => link_has_next(link),
            // No header at all: a FULL page may still be hiding the newest
            // items, and a short page cannot. Asking for one more page is the
            // only answer that never invents an end to the list.
            None => full_page,
        };
        if !more {
            return Ok(items);
        }
    }
    Err(GithubListError::Truncated {
        pages: GITHUB_MAX_PAGES,
    })
}

/// The bounded HTTP read result, reduced to what a watch needs.
pub struct GithubFetch {
    pub status: u16,
    pub body: String,
    /// The response's `Link` header, when it sent one: GitHub's own answer
    /// to "is there another page?". `None` means the header was absent,
    /// which is NOT the same as "this is the last page".
    pub link: Option<String>,
}

/// Why a bounded `curl` read failed. Never carries a token value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubFetchError {
    Timeout,
    Transport(String),
    Oversized,
}

impl GithubFetchError {
    /// Honest monitor error kind for this transport failure.
    pub fn error_kind(&self) -> MonitorErrorKind {
        match self {
            Self::Timeout => MonitorErrorKind::Timeout,
            Self::Oversized => MonitorErrorKind::Oversized,
            Self::Transport(_) => MonitorErrorKind::IoError,
        }
    }
}

/// Read `url` with the platform `curl`, bounded. GET only, no redirects,
/// connect + total deadlines, and the body ceiling checked before the bytes
/// are handed to the parser.
///
/// The `Authorization` header rides in `curl`'s argv, exactly like the Jira
/// transport (`crate::jira::client`) — no second credential-passing
/// mechanism is invented here. The value is never written to disk, never
/// logged, and never persisted outside a sealed store; only the child's own
/// argv sees it.
pub fn fetch(
    url: &str,
    authorization: Option<&str>,
    timeout_ms: u64,
    max_body_bytes: u64,
) -> Result<GithubFetch, GithubFetchError> {
    let dir = std::env::temp_dir();
    let unique = format!("drogon-gh-{}-{}", std::process::id(), next_temp_counter());
    let body_path = dir.join(format!("{unique}.body"));
    let headers_path = dir.join(format!("{unique}.headers"));
    let mut argv: Vec<String> = vec![
        "-sS".into(),
        "--connect-timeout".into(),
        "10".into(),
        "--max-time".into(),
        (timeout_ms / 1000).max(1).to_string(),
        "--max-filesize".into(),
        max_body_bytes.to_string(),
        "-o".into(),
        body_path.to_string_lossy().into_owned(),
        "-D".into(),
        headers_path.to_string_lossy().into_owned(),
        "-w".into(),
        "%{http_code}".into(),
        "-H".into(),
        "Accept: application/vnd.github+json".into(),
        "-H".into(),
        "User-Agent: Drogon".into(),
    ];
    if let Some(header) = authorization {
        argv.push("-H".into());
        argv.push(header.to_string());
    }
    argv.push(url.to_string());

    let mut child: Child = Command::new(crate::jira::client::curl_bin())
        .args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| GithubFetchError::Transport(format!("cannot spawn curl: {e}")))?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms + 5_000);
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&body_path);
                let _ = std::fs::remove_file(&headers_path);
                return Err(GithubFetchError::Transport(format!(
                    "curl wait failed: {e}"
                )));
            }
        }
    }
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.read_to_string(&mut stdout);
    }
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }
    let body_bytes = std::fs::read(&body_path).unwrap_or_default();
    let _ = std::fs::remove_file(&body_path);
    // The header block is read under its own ceiling: `--max-filesize`
    // bounds the BODY, and a watch must never trade one unbounded read for
    // another just to learn whether a next page exists.
    let header_bytes = std::fs::read(&headers_path).unwrap_or_default();
    let _ = std::fs::remove_file(&headers_path);
    let link = link_header(&String::from_utf8_lossy(
        &header_bytes[..header_bytes.len().min(MAX_HEADER_BYTES)],
    ));
    if timed_out {
        return Err(GithubFetchError::Timeout);
    }
    if body_bytes.len() as u64 > max_body_bytes {
        return Err(GithubFetchError::Oversized);
    }
    let status = stdout
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|status| *status > 0);
    let Some(status) = status else {
        return Err(GithubFetchError::Transport(format!(
            "curl failed without an HTTP response: {}",
            stderr.trim()
        )));
    };
    Ok(GithubFetch {
        status: status as u16,
        body: String::from_utf8_lossy(&body_bytes).into_owned(),
        link,
    })
}

/// The `Link` header value out of a raw response header block, if one is
/// there. Case-insensitive on the field name, and the LAST block wins so a
/// proxy's `100 Continue` preamble cannot shadow the real answer.
fn link_header(headers: &str) -> Option<String> {
    headers
        .lines()
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            let value = value.trim();
            (name.trim().eq_ignore_ascii_case("link") && !value.is_empty())
                .then(|| value.to_string())
        })
        .next_back()
}

fn next_temp_counter() -> u64 {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

/// Map an HTTP status to the honest monitor error taxonomy.
pub fn error_kind_for_status(status: u16) -> MonitorErrorKind {
    match status {
        401 | 403 => MonitorErrorKind::Unauthorized,
        404 => MonitorErrorKind::NotFound,
        429 => MonitorErrorKind::RateLimited,
        _ => MonitorErrorKind::IoError,
    }
}

fn truncate(text: &str) -> String {
    text.chars().take(MAX_ERROR_CHARS).collect()
}

/// The dedupe table's name. The read below swallows exactly one failure —
/// this table not existing — so the name is matched, never a table some
/// view or trigger happens to reach through.
const SEEN_TABLE: &str = "bot_monitor_github_seen";

/// A seen set that could not be read: the rows may well exist and simply
/// were not returned. It is NOT an empty set, because the commit path
/// rewrites the table wholesale ([`record_seen_in_tx`] deletes every row
/// for the monitor first), so one empty read plus one release is how a
/// watch forgets everything it ever released and replays the backlog.
///
/// A tick that gets this must fail: no [`decide`], no commit, cursor and
/// rows untouched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeenReadError {
    message: String,
}

impl SeenReadError {
    /// The honest taxonomy for "the watch's own state was unreadable".
    pub fn error_kind(&self) -> MonitorErrorKind {
        MonitorErrorKind::IoError
    }

    /// The persisted-safe reason (sqlite's own text; never watched content
    /// and never a token, which this path never holds).
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for SeenReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Whether a failed read means the dedupe table has never been created —
/// the only failure that honestly reads as "this watch has never released
/// anything". `SQLITE_BUSY`, `SQLITE_LOCKED`, `SQLITE_CORRUPT`, a missing
/// column or an unreadable row are all rows that exist and were not read.
pub fn seen_table_missing(error: &rusqlite::Error) -> bool {
    match error {
        rusqlite::Error::SqliteFailure(failure, Some(message)) => {
            failure.code == rusqlite::ErrorCode::Unknown
                && message.contains("no such table")
                && message.contains(SEEN_TABLE)
        }
        _ => false,
    }
}

/// Read the seen set for one monitor. An absent table reads as an empty set
/// (a watch that has never persisted a row); every other failure is an
/// error the caller must not evaluate past.
pub fn seen_for_monitor(
    conn: &Connection,
    monitor_id: &str,
) -> Result<BTreeSet<u64>, SeenReadError> {
    // `pull_number` is the column's historical name; the table is keyed by
    // (monitor_id, number) and a monitor has exactly ONE kind, so an issue
    // watch's numbers live here too without a migration or any chance of
    // collision with a pull-request watch's.
    let read = || -> Result<BTreeSet<u64>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT pull_number FROM bot_monitor_github_seen WHERE monitor_id = ?1 ORDER BY pull_number",
        )?;
        let rows = stmt.query_map([monitor_id], |r| r.get::<_, i64>(0))?;
        // Every row or none: a row that fails mid-iteration (a lock taken
        // after `prepare`, a value that is not an integer) would otherwise
        // shrink the set silently, which the rewrite then makes permanent.
        let mut numbers = BTreeSet::new();
        for row in rows {
            let number = row?;
            // A pull request number is never negative: a row that says so
            // is corruption, and reading it as `u64::MAX` would both
            // survive pruning and move the cursor. Fail the read instead.
            if number < 0 {
                return Err(rusqlite::Error::IntegralValueOutOfRange(0, number));
            }
            numbers.insert(number as u64);
        }
        Ok(numbers)
    };
    match read() {
        Ok(numbers) => Ok(numbers),
        Err(e) if seen_table_missing(&e) => Ok(BTreeSet::new()),
        Err(e) => Err(SeenReadError {
            message: truncate(&format!("the watch's seen set could not be read: {e}")),
        }),
    }
}

/// Write the seen set for one monitor inside the caller's transaction
/// (the same transaction as the cursor CAS, so a cursor can never advance
/// past a pull request whose "seen" row was lost).
///
/// This REPLACES the monitor's rows, so `seen` must be the set that a
/// successful [`seen_for_monitor`] returned, carried through [`decide`].
/// A caller that reaches here after a failed read deletes the rows it
/// could not read; that is why the read returns an error the caller has
/// to handle rather than an empty set.
pub fn record_seen_in_tx(
    tx: &rusqlite::Transaction<'_>,
    monitor_id: &str,
    seen: &BTreeSet<u64>,
    at_ms: f64,
) -> Result<(), rusqlite::Error> {
    tx.execute(
        "DELETE FROM bot_monitor_github_seen WHERE monitor_id = ?1",
        [monitor_id],
    )?;
    let mut stmt = tx.prepare(
        "INSERT OR REPLACE INTO bot_monitor_github_seen (monitor_id, pull_number, seen_at_ms)
         VALUES (?1, ?2, ?3)",
    )?;
    for number in seen {
        stmt.execute(rusqlite::params![monitor_id, *number as i64, at_ms])?;
    }
    Ok(())
}

/// The persisted state of one watch: what the caller read from the monitor
/// row and the dedupe table before evaluating.
pub struct PersistedWatch<'a> {
    pub monitor_id: &'a str,
    pub monitor_version: u64,
    /// Last accepted cursor (`v1:<hex>`), `None` before the first check.
    pub cursor: Option<&'a str>,
    /// Numbers this watch already released (or seeded).
    pub seen: &'a BTreeSet<u64>,
    /// The monitor's last successful check, which decides whether this tick
    /// seeds (first check, or a gap wider than the configured catch-up
    /// threshold) or releases.
    pub last_success_at_ms: Option<f64>,
    /// Two successive fires of the monitor's cron, used to avoid treating a
    /// naturally sparse schedule as an outage. `None` uses the plain grace.
    pub expected_interval_ms: Option<f64>,
}

/// The full evaluation of one due GitHub watch — pull requests or issues,
/// one code path — with the token already resolved by the caller
/// (grant-checked, memory-only).
pub fn evaluate_with_token(
    watch: &GithubWatch<'_>,
    persisted: &PersistedWatch<'_>,
    token: Option<&str>,
    now_ms: f64,
) -> GithubPollOutcome {
    let monitor_id = persisted.monitor_id;
    let monitor_version = persisted.monitor_version;
    let cursor_before = persisted.cursor;
    let seen = persisted.seen;
    let api_base = watch
        .api_base
        .unwrap_or(super::rule::DEFAULT_GITHUB_API_BASE);
    let auth = token.map(|token| format!("Authorization: Bearer {token}"));
    // `timeout_ms` bounds the whole list read, not each page of it: paging
    // must not multiply the time one scheduler tick can spend on one watch.
    // The FIRST page always gets its read (otherwise a 1 ms rule could never
    // poll at all); every later page spends what is left of the budget.
    let deadline = Instant::now() + Duration::from_millis(watch.timeout_ms);
    let views = match read_open_items(watch.target, api_base, watch.repo, |page, url| {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if page > 1 && remaining.is_zero() {
            return Err(GithubFetchError::Timeout);
        }
        fetch(
            url,
            auth.as_deref(),
            if page == 1 {
                watch.timeout_ms
            } else {
                remaining.as_millis() as u64
            },
            watch.max_body_bytes,
        )
    }) {
        Ok(views) => views,
        Err(error) => return list_error_outcome(watch, token, &error),
    };
    let numbers = filter_items(watch, &views);
    let seed_baseline = match persisted.last_success_at_ms {
        // First ever successful check: today's open pulls are the baseline.
        None => true,
        // A gap wider than the outage grace (or twice this watch's cadence)
        // is a world nobody was watching. Long cron schedules therefore get
        // their full interval before they are treated as an outage.
        Some(last) => {
            let grace = persisted
                .expected_interval_ms
                .map(|interval| 2.0 * interval)
                .unwrap_or(0.0)
                .max(GITHUB_CATCH_UP_GRACE_MS);
            now_ms - last > grace
        }
    };
    let decision = decide(monitor_id, &numbers, seen, seed_baseline);
    result_for(
        &PollContext {
            target: watch.target,
            monitor_id,
            monitor_version,
            numbers: &numbers,
            seen,
            cursor_before,
            observed_at_ms: now_ms,
        },
        &decision,
    )
}

/// The honest check-in for a list read that did not finish. Never a
/// partial list: a caller that cannot read every page reports WHY instead
/// of committing a prefix.
fn list_error_outcome(
    watch: &GithubWatch<'_>,
    token: Option<&str>,
    error: &GithubListError,
) -> GithubPollOutcome {
    let (error_kind, detail) = match error {
        GithubListError::Fetch(fetch_error) => (
            fetch_error.error_kind(),
            match fetch_error {
                GithubFetchError::Timeout => "the GitHub read timed out".to_string(),
                GithubFetchError::Oversized => {
                    "the GitHub response exceeded the rule's body bound".to_string()
                }
                GithubFetchError::Transport(detail) => {
                    format!("the GitHub read failed: {}", scrub(detail, token))
                }
            },
        ),
        GithubListError::Status(status) => (
            error_kind_for_status(*status),
            format!(
                "GitHub answered HTTP {} for {}/{}",
                status,
                watch.repo,
                watch.target.path_segment()
            ),
        ),
        GithubListError::Malformed(message) => (MonitorErrorKind::Malformed, message.clone()),
        GithubListError::Truncated { pages } => (
            MonitorErrorKind::Oversized,
            format!(
                "{}/{} has more than {} open {} ({pages} pages of {GITHUB_PULLS_PER_PAGE}); \
                 refusing to treat the oldest page as the open list",
                watch.repo,
                watch.target.path_segment(),
                *pages as u64 * GITHUB_PULLS_PER_PAGE as u64,
                watch.target.path_segment(),
            ),
        ),
    };
    GithubPollOutcome::Error {
        error_kind,
        message: truncate(&scrub(&detail, token)),
    }
}

/// Scrub a resolved token out of text that may be persisted.
fn scrub(text: &str, token: Option<&str>) -> String {
    match token {
        Some(token) if !token.is_empty() => {
            text.replace(token, crate::integrations::resolve::REDACTED)
        }
        _ => text.to_string(),
    }
}

/// The `(target, number)` a `pull/<n>` or `issue/<n>` resource names, if
/// the event names one. Unknown prefixes are `None` — never guessed.
pub fn case_from_resource(resource: &str) -> Option<(GithubTarget, u64)> {
    for target in [GithubTarget::Pulls, GithubTarget::Issues] {
        if let Some(number) = resource
            .strip_prefix(target.resource_prefix())
            .and_then(|rest| rest.strip_prefix('/'))
            .and_then(|number| number.parse::<u64>().ok())
        {
            return Some((target, number));
        }
    }
    None
}

/// The `resource` string one released pull request or issue carries in its
/// event.
pub fn resource_for_number(target: GithubTarget, number: u64) -> String {
    format!("{}/{number}", target.resource_prefix())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bots::monitors::rule::{
        GithubIssueFilter, GithubIssueRule, GithubPrFilter, GithubPrRule,
    };

    // --- the dedupe table's read, which the commit path trusts ------------
    //
    // `record_seen_in_tx` DELETEs every row for the monitor and writes back
    // the set it was handed. So a read that answers "empty" when the rows
    // are merely unreadable is not a small inaccuracy: it is how a watch
    // forgets PRs 10..40, re-releases 10, and replays 11, 12, ... on the
    // ticks after that. Only a table that does not exist may read as empty.

    fn seen_schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE bot_monitor_github_seen (
                monitor_id TEXT NOT NULL,
                pull_number INTEGER NOT NULL,
                seen_at_ms REAL NOT NULL,
                PRIMARY KEY (monitor_id, pull_number)
            );",
        )
        .unwrap();
    }

    fn insert_seen(conn: &Connection, monitor_id: &str, numbers: &[u64]) {
        for number in numbers {
            conn.execute(
                "INSERT INTO bot_monitor_github_seen (monitor_id, pull_number, seen_at_ms)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![monitor_id, *number as i64, 1.0f64],
            )
            .unwrap();
        }
    }

    /// A watch whose table was never created has honestly never released
    /// anything: an empty set, not a hard error, so a fresh install still
    /// seeds instead of refusing forever.
    #[test]
    fn a_missing_seen_table_reads_as_a_watch_that_never_released_anything() {
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(seen_for_monitor(&conn, "mon_1"), Ok(BTreeSet::new()));
    }

    /// The ordinary path: what the commit wrote is what the next tick reads.
    #[test]
    fn a_written_seen_set_reads_back_whole() {
        let mut conn = Connection::open_in_memory().unwrap();
        seen_schema(&conn);
        let seen: BTreeSet<u64> = (10..=40).collect();
        let tx = conn.transaction().unwrap();
        record_seen_in_tx(&tx, "mon_1", &seen, 7.0).unwrap();
        tx.commit().unwrap();
        assert_eq!(seen_for_monitor(&conn, "mon_1"), Ok(seen));
        // Another monitor's rows are not this watch's set.
        assert_eq!(seen_for_monitor(&conn, "mon_2"), Ok(BTreeSet::new()));
    }

    /// The reported failure: `SQLITE_BUSY`. The rows are there and locked.
    /// Reading them as `{}` is what lets the next commit delete them.
    #[test]
    fn a_locked_database_fails_the_read_instead_of_reading_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("monitors.sqlite3");
        let writer = Connection::open(&path).unwrap();
        seen_schema(&writer);
        insert_seen(&writer, "mon_1", &[10, 11, 40]);

        let reader = Connection::open(&path).unwrap();
        // No grace: this test is about the answer when the lock does not
        // clear, not about how long the daemon waits for it.
        reader
            .busy_timeout(std::time::Duration::from_millis(0))
            .unwrap();
        assert_eq!(
            seen_for_monitor(&reader, "mon_1"),
            Ok(BTreeSet::from([10, 11, 40])),
            "the set is readable while nothing holds the database"
        );

        writer.execute_batch("BEGIN EXCLUSIVE").unwrap();
        let locked = seen_for_monitor(&reader, "mon_1");
        writer.execute_batch("ROLLBACK").unwrap();
        let error = locked.expect_err("a locked database is an error, never an empty set");
        assert_eq!(error.error_kind(), MonitorErrorKind::IoError);
        assert!(error.message().contains("could not be read"), "{error}");

        // And the rows are still there for the tick that follows.
        assert_eq!(
            seen_for_monitor(&reader, "mon_1"),
            Ok(BTreeSet::from([10, 11, 40]))
        );
    }

    /// A row that cannot be decoded fails the whole read. Dropping it would
    /// hand the commit a SHORTER set, and the rewrite makes that permanent.
    #[test]
    fn a_row_that_is_not_a_number_fails_the_read_instead_of_shrinking_the_set() {
        let conn = Connection::open_in_memory().unwrap();
        seen_schema(&conn);
        insert_seen(&conn, "mon_1", &[10, 11]);
        conn.execute(
            "INSERT INTO bot_monitor_github_seen (monitor_id, pull_number, seen_at_ms)
             VALUES (?1, ?2, ?3)",
            rusqlite::params!["mon_1", "not-a-number", 1.0f64],
        )
        .unwrap();
        let error = seen_for_monitor(&conn, "mon_1")
            .expect_err("an undecodable row is a failed read, not a smaller set");
        assert_eq!(error.error_kind(), MonitorErrorKind::IoError);
    }

    /// A stored number no pull request can have is corruption, not a
    /// member of the set: reading it as `u64::MAX` would prune a real
    /// number out of the set and move the cursor.
    #[test]
    fn a_number_no_pull_request_can_have_fails_the_read() {
        let conn = Connection::open_in_memory().unwrap();
        seen_schema(&conn);
        insert_seen(&conn, "mon_1", &[10, 11]);
        conn.execute(
            "INSERT INTO bot_monitor_github_seen (monitor_id, pull_number, seen_at_ms)
             VALUES (?1, ?2, ?3)",
            rusqlite::params!["mon_1", -1i64, 1.0f64],
        )
        .unwrap();
        let error = seen_for_monitor(&conn, "mon_1").expect_err("a negative number is corruption");
        assert_eq!(error.error_kind(), MonitorErrorKind::IoError);
    }

    /// "The table is gone" is the ONLY swallowed failure. A table that
    /// exists but does not answer this query is unreadable state.
    #[test]
    fn an_unreadable_table_is_not_mistaken_for_a_missing_one() {
        let conn = Connection::open_in_memory().unwrap();
        seen_schema(&conn);
        insert_seen(&conn, "mon_1", &[10]);
        conn.execute_batch(
            "ALTER TABLE bot_monitor_github_seen RENAME COLUMN pull_number TO released_number",
        )
        .unwrap();
        assert!(
            seen_for_monitor(&conn, "mon_1").is_err(),
            "a column this build cannot read is an error, never an empty set"
        );

        // A view standing in for the table, over a table that is itself
        // gone: sqlite says "no such table" about the INNER name, which is
        // not this table and not evidence that this watch released nothing.
        let other = Connection::open_in_memory().unwrap();
        other
            .execute_batch(
                "CREATE TABLE rows_that_vanish (monitor_id TEXT, pull_number INTEGER, seen_at_ms REAL);
                 CREATE VIEW bot_monitor_github_seen AS SELECT * FROM rows_that_vanish;
                 DROP TABLE rows_that_vanish;",
            )
            .unwrap();
        assert!(
            seen_for_monitor(&other, "mon_1").is_err(),
            "another table's absence is not this table's absence"
        );
    }

    /// The first-run path end to end: a table that was never created reads
    /// as empty AND still seeds. The fix must never turn a new watch (or a
    /// database from before the dedupe table existed) into a hard error.
    #[test]
    fn a_watch_with_no_seen_table_still_seeds_its_baseline() {
        let conn = Connection::open_in_memory().unwrap();
        let seen = seen_for_monitor(&conn, "mon_1").expect("never an error");
        assert!(seen.is_empty());
        let decision = decide("mon_1", &[41, 42], &seen, true);
        assert!(
            matches!(decision, GithubDedupeDecision::Seed { .. }),
            "{decision:?}"
        );
    }

    /// The other half of the missing-table escape hatch: the WRITE refuses
    /// instead of pretending. A watch whose table does not exist reads as
    /// empty and then cannot commit, so the hatch can never turn into a
    /// silent release against a set nobody ever stored.
    #[test]
    fn a_missing_seen_table_refuses_the_write_rather_than_losing_it() {
        let mut conn = Connection::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        let error = record_seen_in_tx(&tx, "mon_1", &BTreeSet::from([41]), 1.0)
            .expect_err("there is no table to write into");
        assert!(seen_table_missing(&error), "{error}");
    }

    /// The classifier itself, on every shape that decides the answer.
    /// Getting this wrong in the permissive direction is the whole bug:
    /// "missing" means the empty set, and the empty set deletes rows.
    #[test]
    fn only_this_tables_absence_reads_as_never_released() {
        let conn = Connection::open_in_memory().unwrap();
        let missing = conn
            .prepare("SELECT pull_number FROM bot_monitor_github_seen")
            .expect_err("the table is not there");
        assert!(seen_table_missing(&missing), "{missing}");

        let elsewhere = conn
            .prepare("SELECT 1 FROM some_other_table")
            .expect_err("that table is not there either");
        assert!(!seen_table_missing(&elsewhere), "{elsewhere}");

        // An error that NAMES this table without being its absence: schema
        // drift, not a watch that never released anything.
        seen_schema(&conn);
        let drifted = conn
            .prepare("INSERT INTO bot_monitor_github_seen (nope) VALUES (1)")
            .expect_err("that column is not there");
        assert!(
            drifted.to_string().contains(SEEN_TABLE),
            "the message names the table: {drifted}"
        );
        assert!(!seen_table_missing(&drifted), "{drifted}");

        // The sqlite result code decides, never the text alone: a busy
        // database is unreadable state whatever its message says.
        let busy = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            Some(format!("no such table: {SEEN_TABLE}")),
        );
        assert!(!seen_table_missing(&busy), "{busy}");
    }

    fn rule(filter: GithubPrFilter, login: Option<&str>) -> GithubPrRule {
        GithubPrRule {
            host_id: "h".into(),
            project_id: "p".into(),
            repo: "clioo/drogon".into(),
            filter,
            login: login.map(str::to_string),
            api_base: None,
            timeout_ms: 30_000,
            max_body_bytes: 65_536,
            secret_refs: vec![],
            harness: None,
            skills: vec![],
        }
    }

    fn issue_rule(filter: GithubIssueFilter, login: Option<&str>) -> GithubIssueRule {
        GithubIssueRule {
            host_id: "h".into(),
            project_id: "p".into(),
            repo: "clioo/drogon".into(),
            filter,
            login: login.map(str::to_string),
            api_base: None,
            timeout_ms: 30_000,
            max_body_bytes: 65_536,
            secret_refs: vec![],
            harness: None,
            skills: vec![],
        }
    }

    fn view(number: u64, assignees: &[&str], reviewers: &[&str]) -> GithubItemView {
        GithubItemView {
            number,
            assignees: assignees.iter().map(|s| s.to_string()).collect(),
            requested_reviewers: reviewers.iter().map(|s| s.to_string()).collect(),
            is_pull_request: false,
        }
    }

    #[test]
    fn filters_by_the_case_the_owner_named() {
        let pulls = [
            view(41, &["someone"], &[]),
            view(42, &["clioo"], &["other"]),
            view(43, &[], &["clioo"]),
        ];
        assert_eq!(
            filter_items(&(&rule(GithubPrFilter::Opened, None)).into(), &pulls),
            vec![41, 42, 43]
        );
        assert_eq!(
            filter_items(
                &(&rule(GithubPrFilter::Assigned, Some("clioo"))).into(),
                &pulls
            ),
            vec![42]
        );
        assert_eq!(
            filter_items(
                &(&rule(GithubPrFilter::ReviewRequested, Some("clioo"))).into(),
                &pulls
            ),
            vec![43]
        );
        // A login nobody matches releases nothing — never a widened filter.
        assert!(
            filter_items(
                &(&rule(GithubPrFilter::Assigned, Some("nobody"))).into(),
                &pulls
            )
            .is_empty()
        );
    }

    /// GitHub's ISSUES endpoint returns pull requests as issues. An issue
    /// watch must drop them: a code review is not a bug report, and the
    /// two kinds mint different cases.
    #[test]
    fn an_issue_watch_never_releases_a_pull_request() {
        let listed = [
            view(41, &["clioo"], &[]),
            GithubItemView {
                number: 42,
                assignees: vec!["clioo".to_string()],
                requested_reviewers: vec![],
                // GitHub marks this row as a pull request.
                is_pull_request: true,
            },
            view(43, &["someone"], &[]),
        ];
        assert_eq!(
            filter_items(
                &(&issue_rule(GithubIssueFilter::Opened, None)).into(),
                &listed
            ),
            vec![41, 43],
            "the pull request is dropped before the filter runs"
        );
        assert_eq!(
            filter_items(
                &(&issue_rule(GithubIssueFilter::Assigned, Some("clioo"))).into(),
                &listed
            ),
            vec![41],
            "an assigned pull request is still not an issue"
        );
        // The same list read as PULLS keeps everything the filter admits:
        // only the issue kind applies the exclusion.
        assert_eq!(
            filter_items(&(&rule(GithubPrFilter::Opened, None)).into(), &listed),
            vec![41, 42, 43]
        );
    }

    /// Presence of the `pull_request` key is what GitHub actually sends;
    /// the projection must read it from the wire, not be told.
    #[test]
    fn the_pull_request_marker_is_read_from_the_wire() {
        let parsed = parse_items(
            r#"[{"number":41},
                {"number":42,"pull_request":{"url":"https://api.github.com/repos/a/b/pulls/42"}},
                {"number":43,"pull_request":null}]"#,
        )
        .unwrap();
        assert_eq!(
            parsed
                .iter()
                .map(|item| item.is_pull_request)
                .collect::<Vec<_>>(),
            vec![false, true, false],
            "only a non-null pull_request marks a row as a PR"
        );
    }

    #[test]
    fn the_same_pull_never_fires_twice() {
        let mut seen = BTreeSet::new();
        // First sighting releases #41 and records it.
        let first = decide("mon-1", &[41], &seen, false);
        let GithubDedupeDecision::Release { number, ref cursor } = first else {
            panic!("expected a release, got {first:?}");
        };
        assert_eq!(number, 41);
        assert_eq!(cursor, &cursor_for_seen(&BTreeSet::from([41])));
        seen = seen_after(&first, &[41], &seen);
        assert_eq!(seen, BTreeSet::from([41]));
        // The SAME pull, seen again and again (a new comment, a push, a
        // re-poll): never a second release, and never a second cursor.
        for _ in 0..3 {
            assert_eq!(
                decide("mon-1", &[41], &seen, false),
                GithubDedupeDecision::Nothing
            );
        }
        // A watched set that only ever grows around it is still quiet.
        assert_eq!(
            decide("mon-1", &[41], &seen, false),
            GithubDedupeDecision::Nothing
        );
    }

    #[test]
    fn a_burst_drains_one_pull_per_tick_in_arrival_order() {
        let mut seen = BTreeSet::new();
        let mut released = Vec::new();
        for _ in 0..3 {
            let decision = decide("mon-1", &[41, 42, 43], &seen, false);
            let GithubDedupeDecision::Release { number, ref cursor } = decision else {
                panic!("expected a release, got {decision:?}");
            };
            assert_eq!(
                cursor,
                &cursor_for_seen(&seen_after(&decision, &[41, 42, 43], &seen))
            );
            seen = seen_after(&decision, &[41, 42, 43], &seen);
            released.push(number);
        }
        assert_eq!(released, vec![41, 42, 43], "oldest first");
        // Drained: nothing left, and the cursor is a function of the set.
        assert_eq!(
            decide("mon-1", &[41, 42, 43], &seen, false),
            GithubDedupeDecision::Nothing
        );
        assert_eq!(
            cursor_for_seen(&seen),
            cursor_for_seen(&BTreeSet::from([41, 42, 43]))
        );
        // Only the released ones are marked seen — #44 arriving later fires.
        assert!(matches!(
            decide("mon-1", &[41, 42, 43, 44], &seen, false),
            GithubDedupeDecision::Release { number: 44, .. }
        ));
    }

    #[test]
    fn baseline_seeding_releases_nothing_and_is_recorded() {
        let seen = BTreeSet::new();
        let decision = decide("mon-1", &[41, 42, 43], &seen, true);
        let GithubDedupeDecision::Seed { cursor } = decision else {
            panic!("expected a seed, got {decision:?}");
        };
        let mut expected = BTreeSet::new();
        expected.extend([41, 42, 43]);
        assert_eq!(cursor, cursor_for_seen(&expected));
        // After seeding, the same list is quiet.
        assert_eq!(
            decide("mon-1", &[41, 42, 43], &expected, false),
            GithubDedupeDecision::Nothing
        );
        // A genuinely new pull request after the seed still fires.
        assert!(matches!(
            decide("mon-1", &[41, 42, 43, 44], &expected, false),
            GithubDedupeDecision::Release { number: 44, .. }
        ));
    }

    #[test]
    fn event_ids_are_stable_per_case_and_monitor() {
        let pulls = GithubTarget::Pulls;
        let issues = GithubTarget::Issues;
        let first = event_id_for_number(pulls, "mon-1", 42);
        assert_eq!(first, event_id_for_number(pulls, "mon-1", 42));
        assert_ne!(first, event_id_for_number(pulls, "mon-1", 43));
        assert_ne!(first, event_id_for_number(pulls, "mon-2", 42));
        // Issue #42 and pull request #42 are different cases even on the
        // same monitor id, so their ids must differ too.
        assert_ne!(first, event_id_for_number(issues, "mon-1", 42));
        assert!(crate::bots::monitors::result::is_valid_event_id(&first));
        assert!(crate::bots::monitors::result::is_valid_event_id(
            &event_id_for_number(issues, "mon-1", 42)
        ));
        assert_eq!(resource_for_number(pulls, 42), "pull/42");
        assert_eq!(resource_for_number(issues, 42), "issue/42");
        assert_eq!(case_from_resource("pull/42"), Some((pulls, 42)));
        assert_eq!(case_from_resource("issue/42"), Some((issues, 42)));
        assert_eq!(case_from_resource("notes/status.md"), None);
        assert_eq!(case_from_resource("pull/"), None);
        assert_eq!(case_from_resource("issue/not-a-number"), None);
    }

    #[test]
    fn outcome_mapping_carries_the_cursor_the_event_and_the_seen_set() {
        let seen = BTreeSet::from([41]);
        let decision = GithubDedupeDecision::Release {
            number: 42,
            cursor: cursor_for_seen(&BTreeSet::from([41, 42])),
        };
        // The repository also shows #43: releasing #42 must NOT mark #43 seen.
        let outcome = result_for(
            &PollContext {
                target: GithubTarget::Pulls,
                monitor_id: "mon-1",
                monitor_version: 3,
                numbers: &[41, 42, 43],
                seen: &seen,
                cursor_before: None,
                observed_at_ms: 100.0,
            },
            &decision,
        );
        let GithubPollOutcome::Emit {
            result,
            resource,
            seen: next_seen,
        } = outcome
        else {
            panic!("expected an emit");
        };
        assert_eq!(
            result.event_id(),
            Some(event_id_for_number(GithubTarget::Pulls, "mon-1", 42).as_str())
        );
        assert_eq!(
            result.cursor(),
            Some(cursor_for_seen(&BTreeSet::from([41, 42])).as_str())
        );
        assert_eq!(resource, "pull/42");
        assert_eq!(next_seen, BTreeSet::from([41, 42]));
        assert!(!next_seen.contains(&43), "an unreleased pull stays unfired");

        // No change keeps the PRIOR cursor (never a fabricated one) and
        // leaves the seen set exactly as it was.
        let prior = cursor_for_seen(&BTreeSet::from([7]));
        let quiet = result_for(
            &PollContext {
                target: GithubTarget::Pulls,
                monitor_id: "mon-1",
                monitor_version: 3,
                numbers: &[7],
                seen: &BTreeSet::from([7]),
                cursor_before: Some(&prior),
                observed_at_ms: 100.0,
            },
            &GithubDedupeDecision::Nothing,
        );
        let GithubPollOutcome::Emit {
            result,
            seen: next_seen,
            ..
        } = quiet
        else {
            panic!("expected an emit");
        };
        assert_eq!(result.cursor(), Some(prior.as_str()));
        assert!(result.event_id().is_none());
        assert_eq!(next_seen, BTreeSet::from([7]));
    }

    #[test]
    fn url_carries_the_repo_the_collection_and_the_page() {
        assert_eq!(
            list_url(
                GithubTarget::Pulls,
                "https://api.github.com",
                "clioo/drogon",
                1
            )
            .unwrap(),
            "https://api.github.com/repos/clioo/drogon/pulls?state=open&sort=created&direction=asc&per_page=100&page=1"
        );
        // The issue watch reads the ISSUES collection of the same repo —
        // the only difference in the request it sends.
        assert_eq!(
            list_url(
                GithubTarget::Issues,
                "https://api.github.com",
                "clioo/drogon",
                1
            )
            .unwrap(),
            "https://api.github.com/repos/clioo/drogon/issues?state=open&sort=created&direction=asc&per_page=100&page=1"
        );
        // The page is the only thing a later page changes: the page bound,
        // the sort and the state are the same request every time, so page 2
        // is the continuation of page 1 and not a different question.
        assert_eq!(
            list_url(
                GithubTarget::Pulls,
                "https://api.github.com",
                "clioo/drogon",
                7
            )
            .unwrap(),
            "https://api.github.com/repos/clioo/drogon/pulls?state=open&sort=created&direction=asc&per_page=100&page=7"
        );
        // A trailing slash never doubles.
        assert!(
            list_url(GithubTarget::Pulls, "http://127.0.0.1:9/", "a/b", 1)
                .unwrap()
                .starts_with("http://127.0.0.1:9/repos/a/b")
        );
        assert!(list_url(GithubTarget::Issues, "https://api.github.com", "drogon", 1).is_err());
        assert!(list_url(GithubTarget::Issues, "https://api.github.com", "a/", 1).is_err());
    }

    // --- paging: the whole open list, or an honest refusal -----------------

    /// A canned page of `count` items numbered from `first`, optionally with
    /// a `Link` header.
    fn page_of(first: u64, count: usize, link: Option<&str>) -> GithubFetch {
        let items: Vec<String> = (0..count as u64)
            .map(|offset| format!(r#"{{"number":{}}}"#, first + offset))
            .collect();
        GithubFetch {
            status: 200,
            body: format!("[{}]", items.join(",")),
            link: link.map(str::to_string),
        }
    }

    const NEXT_LINK: &str = r#"<https://api.github.com/repositories/1/pulls?page=2>; rel="next", <https://api.github.com/repositories/1/pulls?page=9>; rel="last""#;
    const LAST_LINK: &str = r#"<https://api.github.com/repositories/1/pulls?page=1>; rel="first", <https://api.github.com/repositories/1/pulls?page=1>; rel="prev""#;

    /// Walk a canned sequence of pages, recording the URLs that were asked
    /// for. Panics if the reader asks for more pages than were canned —
    /// a reader that keeps paging forever is itself a bug.
    fn walk(
        target: GithubTarget,
        pages: Vec<GithubFetch>,
    ) -> (Result<Vec<GithubItemView>, GithubListError>, Vec<String>) {
        let mut asked: Vec<String> = Vec::new();
        let mut queue = pages.into_iter();
        let read = {
            let asked = &mut asked;
            read_open_items(
                target,
                "https://api.github.com",
                "clioo/drogon",
                |_page, url| {
                    asked.push(url.to_string());
                    Ok(queue.next().expect("the reader asked for an uncanned page"))
                },
            )
        };
        (read, asked)
    }

    /// The issue's own counterexample: 101 open pull requests, the newest
    /// opened last. One page of 100 is NOT the open list, and the newest
    /// number must reach the dedupe decision.
    #[test]
    fn a_second_page_is_read_so_the_newest_item_is_never_invisible() {
        let (read, asked) = walk(
            GithubTarget::Pulls,
            vec![
                page_of(1, 100, Some(NEXT_LINK)),
                page_of(101, 1, Some(LAST_LINK)),
            ],
        );
        let items = read.expect("both pages read");
        assert_eq!(items.len(), 101);
        assert_eq!(items.last().expect("an item").number, 101);
        assert!(asked[0].ends_with("&page=1"), "first ask: {}", asked[0]);
        assert!(asked[1].ends_with("&page=2"), "second ask: {}", asked[1]);
        assert_eq!(asked.len(), 2, "no page is read twice: {asked:?}");

        // And the watch releases it: with 1..=100 already seen, the only
        // unseen number is the one that lives on page two.
        let seen: BTreeSet<u64> = (1..=100).collect();
        let numbers = filter_items(&(&rule(GithubPrFilter::Opened, None)).into(), &items);
        assert_eq!(
            decide("mon-1", &numbers, &seen, false),
            GithubDedupeDecision::Release {
                number: 101,
                cursor: cursor_for_seen(&(1..=101).collect()),
            }
        );
    }

    /// Issues have the same hole and the same fix: one code path, asserted
    /// on the issue collection too.
    #[test]
    fn an_issue_watch_pages_the_same_way() {
        let (read, asked) = walk(
            GithubTarget::Issues,
            vec![
                page_of(1, 100, Some(NEXT_LINK)),
                page_of(101, 1, Some(LAST_LINK)),
            ],
        );
        assert_eq!(read.expect("both pages read").len(), 101);
        assert!(
            asked.iter().all(|url| url.contains("/issues?")),
            "{asked:?}"
        );
        assert!(asked[1].ends_with("&page=2"), "second ask: {}", asked[1]);
    }

    /// A FULL page with `rel="next"` is not the end of the list, and a full
    /// page with NO `Link` header at all is not either: the reader asks for
    /// one more page rather than inventing an end.
    #[test]
    fn a_full_page_is_never_assumed_to_be_the_last_one() {
        let (with_link, asked) = walk(
            GithubTarget::Pulls,
            vec![page_of(1, 100, Some(NEXT_LINK)), page_of(101, 0, None)],
        );
        assert_eq!(with_link.expect("read").len(), 100);
        assert_eq!(asked.len(), 2, "rel=next must be followed: {asked:?}");

        let (no_header, asked) = walk(
            GithubTarget::Pulls,
            vec![page_of(1, 100, None), page_of(101, 5, None)],
        );
        assert_eq!(
            no_header.expect("read").len(),
            105,
            "a full page without a Link header must still be continued"
        );
        assert_eq!(asked.len(), 2, "{asked:?}");
    }

    /// Stopping: a short page ends the walk, and so does a `Link` header
    /// that advertises no next page — even on a full page, because GitHub's
    /// own header is the authority while it is present (believing it is
    /// what keeps a 1000-item repository from being called truncated).
    #[test]
    fn the_walk_stops_on_a_short_page_or_a_link_without_a_next() {
        let (short, asked) = walk(GithubTarget::Pulls, vec![page_of(1, 7, None)]);
        assert_eq!(short.expect("read").len(), 7);
        assert_eq!(asked.len(), 1, "a short page is the end: {asked:?}");

        let (ended, asked) = walk(GithubTarget::Pulls, vec![page_of(1, 100, Some(LAST_LINK))]);
        assert_eq!(ended.expect("read").len(), 100);
        assert_eq!(
            asked.len(),
            1,
            "rel=last without rel=next ends it: {asked:?}"
        );

        let (empty, asked) = walk(GithubTarget::Pulls, vec![page_of(1, 0, None)]);
        assert!(empty.expect("read").is_empty());
        assert_eq!(asked.len(), 1, "{asked:?}");
    }

    /// The cap is a refusal, never a prefix: a list still going at
    /// [`GITHUB_MAX_PAGES`] is an honest `Oversized` check-in, so nobody
    /// commits the oldest page as "the open set".
    #[test]
    fn a_list_longer_than_the_page_cap_is_an_error_not_a_prefix() {
        let pages: Vec<GithubFetch> = (0..GITHUB_MAX_PAGES)
            .map(|page| page_of(1 + page as u64 * 100, 100, Some(NEXT_LINK)))
            .collect();
        let (read, asked) = walk(GithubTarget::Pulls, pages);
        assert_eq!(
            read,
            Err(GithubListError::Truncated {
                pages: GITHUB_MAX_PAGES
            })
        );
        assert_eq!(asked.len(), GITHUB_MAX_PAGES as usize, "{}", asked.len());

        // The check-in says Oversized and names the repository and the
        // bound — never a number of items that was "seen".
        let outcome = list_error_outcome(
            &(&rule(GithubPrFilter::Opened, None)).into(),
            None,
            &GithubListError::Truncated {
                pages: GITHUB_MAX_PAGES,
            },
        );
        let GithubPollOutcome::Error {
            error_kind,
            message,
        } = outcome
        else {
            panic!("expected an error outcome");
        };
        assert_eq!(error_kind, MonitorErrorKind::Oversized);
        assert!(message.contains("clioo/drogon"), "{message}");
        assert!(message.contains("1000 open pulls"), "{message}");

        // A list that ends exactly ON the cap is complete, not truncated.
        let mut exact: Vec<GithubFetch> = (0..GITHUB_MAX_PAGES - 1)
            .map(|page| page_of(1 + page as u64 * 100, 100, Some(NEXT_LINK)))
            .collect();
        exact.push(page_of(
            1 + (GITHUB_MAX_PAGES as u64 - 1) * 100,
            100,
            Some(LAST_LINK),
        ));
        let (read, _) = walk(GithubTarget::Pulls, exact);
        assert_eq!(
            read.expect("a list that ends on the cap is read in full")
                .len(),
            GITHUB_MAX_PAGES as usize * 100
        );
    }

    /// A failure on a LATER page is the whole poll's failure. Half a list
    /// is the same silent prefix the cap refuses, so it never reaches the
    /// dedupe decision.
    #[test]
    fn a_failure_on_a_later_page_fails_the_whole_read() {
        let mut queue = vec![
            page_of(1, 100, Some(NEXT_LINK)),
            GithubFetch {
                status: 502,
                body: String::new(),
                link: None,
            },
        ]
        .into_iter();
        let read = read_open_items(
            GithubTarget::Pulls,
            "https://api.github.com",
            "clioo/drogon",
            |_page, _url| Ok(queue.next().expect("page")),
        );
        assert_eq!(read, Err(GithubListError::Status(502)));

        let mut queue = vec![
            page_of(1, 100, Some(NEXT_LINK)),
            GithubFetch {
                status: 200,
                body: "not json".into(),
                link: None,
            },
        ]
        .into_iter();
        let read = read_open_items(
            GithubTarget::Pulls,
            "https://api.github.com",
            "clioo/drogon",
            |_page, _url| Ok(queue.next().expect("page")),
        );
        assert!(
            matches!(read, Err(GithubListError::Malformed(_))),
            "{read:?}"
        );

        // A transport failure on page two is a transport failure, with the
        // kind the transport named.
        let read = read_open_items(
            GithubTarget::Pulls,
            "https://api.github.com",
            "clioo/drogon",
            |page, _url| {
                if page == 1 {
                    Ok(page_of(1, 100, Some(NEXT_LINK)))
                } else {
                    Err(GithubFetchError::Timeout)
                }
            },
        );
        assert_eq!(read, Err(GithubListError::Fetch(GithubFetchError::Timeout)));
        assert_eq!(
            GithubFetchError::Timeout.error_kind(),
            MonitorErrorKind::Timeout
        );
    }

    /// A bad repo is still refused before any request is sent.
    #[test]
    fn a_malformed_repo_is_refused_without_a_request() {
        let mut asked = 0;
        let read = read_open_items(
            GithubTarget::Pulls,
            "https://api.github.com",
            "drogon",
            |_, _| {
                asked += 1;
                Ok(page_of(1, 0, None))
            },
        );
        assert!(
            matches!(read, Err(GithubListError::Malformed(_))),
            "{read:?}"
        );
        assert_eq!(asked, 0);
    }

    #[test]
    fn the_next_relation_is_read_out_of_a_link_header() {
        assert!(link_has_next(NEXT_LINK));
        assert!(!link_has_next(LAST_LINK));
        assert!(!link_has_next(""));
        // Unquoted and oddly spaced forms are still the next relation.
        assert!(link_has_next("<https://x/y?page=2>; rel=next"));
        assert!(link_has_next("<https://x/y?page=2> ; REL = \"NEXT\""));
        // A URL that happens to contain the word is not a relation.
        assert!(!link_has_next("<https://x/next?page=2>; rel=\"prev\""));
        // ...and neither is a `next` that is not a `rel`.
        assert!(!link_has_next("<https://x/y>; type=\"next\""));
        // The header block parser finds the field whatever its case, and
        // ignores every other header around it.
        assert_eq!(
            link_header(
                "HTTP/2 200\r\nServer: github.com\r\nLINK: <https://x/y>; rel=\"next\"\r\n\r\n"
            )
            .as_deref(),
            Some("<https://x/y>; rel=\"next\"")
        );
        assert_eq!(link_header("HTTP/2 200\r\nServer: github.com\r\n"), None);
        // An empty value is no answer at all, not "the list ended".
        assert_eq!(link_header("HTTP/2 200\r\nLink:\r\n"), None);
    }

    #[test]
    fn malformed_bodies_and_statuses_are_honest_errors() {
        assert!(parse_items("not json").is_err());
        assert!(parse_items(r#"{"message":"Bad credentials"}"#).is_err());
        let pulls = parse_items(r#"[{"number":42,"assignees":[{"login":"clioo"}]}]"#).unwrap();
        assert_eq!(pulls[0].number, 42);
        assert_eq!(pulls[0].assignees, vec!["clioo".to_string()]);
        assert_eq!(error_kind_for_status(401), MonitorErrorKind::Unauthorized);
        assert_eq!(error_kind_for_status(404), MonitorErrorKind::NotFound);
        assert_eq!(error_kind_for_status(429), MonitorErrorKind::RateLimited);
        assert_eq!(error_kind_for_status(500), MonitorErrorKind::IoError);
    }

    #[test]
    fn a_token_never_survives_in_an_error_message() {
        let canary = "ghp_CANARY_TOKEN_VALUE";
        let text = scrub(
            &format!("the GitHub read failed: curl: token {canary} rejected"),
            Some(canary),
        );
        assert!(!text.contains(canary));
        assert!(text.contains(crate::integrations::resolve::REDACTED));
    }

    #[test]
    fn the_seen_set_is_bounded_to_the_newest_numbers() {
        let wide: Vec<u64> = (0..(MAX_SEEN_PULLS as u64 + 50)).collect();
        let decision = decide("mon-1", &wide, &BTreeSet::new(), true);
        let GithubDedupeDecision::Seed { cursor } = decision else {
            panic!("expected a seed");
        };
        let expected: BTreeSet<u64> = wide.iter().copied().rev().take(MAX_SEEN_PULLS).collect();
        assert_eq!(cursor, cursor_for_seen(&expected));
    }
}
