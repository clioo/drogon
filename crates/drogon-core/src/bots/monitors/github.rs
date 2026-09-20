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
//!   unrelated comment on PR #41 cannot re-release it.
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
    GITHUB_PULLS_PER_PAGE, GithubIssueFilter, GithubIssueRule, GithubPrFilter, GithubPrRule,
};

/// A watch whose last successful check is older than this seeds forward
/// instead of replaying the backlog. Matches the delegation drain's own
/// outage grace: a change older than this is one nobody was watching.
pub const GITHUB_CATCH_UP_GRACE_MS: f64 = 30.0 * 60.0 * 1000.0;

/// Longest persisted error text (chars) — the check-in message bound.
const MAX_ERROR_CHARS: usize = 512;

/// How many numbers a monitor's seen set retains (newest kept). The
/// oldest numbers fall out of the set, so one that leaves and re-enters
/// the open list may be released again — bounded, honest, and never
/// unbounded growth.
///
/// This bounds the DEDUPE SET, not the watch's reach: one poll reads a
/// single page of [`GITHUB_PULLS_PER_PAGE`] oldest-first, so a repository
/// with more than that many open items does not see the newest ones until
/// older ones close. That page limit is pre-existing and shared by both
/// kinds; paginating is a separate change.
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

/// The exact URL one poll reads:
/// `{apiBase}/repos/{owner}/{name}/{pulls|issues}`.
pub fn list_url(target: GithubTarget, api_base: &str, repo: &str) -> Result<String, String> {
    let base = api_base.trim_end_matches('/');
    let segments: Vec<&str> = repo.split('/').collect();
    if segments.len() != 2 || segments.iter().any(|segment| segment.is_empty()) {
        return Err("repo must be 'owner/name'".to_string());
    }
    Ok(format!(
        "{base}/repos/{}/{}/{}?state=open&sort=created&direction=asc&per_page={GITHUB_PULLS_PER_PAGE}",
        segments[0],
        segments[1],
        target.path_segment(),
    ))
}

/// The bounded HTTP read result, reduced to what a watch needs.
pub struct GithubFetch {
    pub status: u16,
    pub body: String,
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
    })
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

/// Read the seen set for one monitor. Absent / unreadable tables read as an
/// empty set (a watch that never released anything — never an error).
pub fn seen_for_monitor(conn: &Connection, monitor_id: &str) -> BTreeSet<u64> {
    // `pull_number` is the column's historical name; the table is keyed by
    // (monitor_id, number) and a monitor has exactly ONE kind, so an issue
    // watch's numbers live here too without a migration or any chance of
    // collision with a pull-request watch's.
    let read = || -> Result<Vec<u64>, rusqlite::Error> {
        let mut stmt = conn.prepare(
            "SELECT pull_number FROM bot_monitor_github_seen WHERE monitor_id = ?1 ORDER BY pull_number",
        )?;
        let rows = stmt.query_map([monitor_id], |r| r.get::<_, i64>(0))?;
        Ok(rows.filter_map(|r| r.ok()).map(|n| n as u64).collect())
    };
    match read() {
        Ok(numbers) => numbers.into_iter().collect(),
        Err(e) => {
            eprintln!("[github-monitor] seen-set read failed: {e}");
            BTreeSet::new()
        }
    }
}

/// Write the seen set for one monitor inside the caller's transaction
/// (the same transaction as the cursor CAS, so a cursor can never advance
/// past a pull request whose "seen" row was lost).
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
    let url = match list_url(watch.target, api_base, watch.repo) {
        Ok(url) => url,
        Err(message) => {
            return GithubPollOutcome::Error {
                error_kind: MonitorErrorKind::Malformed,
                message: truncate(&message),
            };
        }
    };
    let auth = token.map(|token| format!("Authorization: Bearer {token}"));
    let fetched = match fetch(
        &url,
        auth.as_deref(),
        watch.timeout_ms,
        watch.max_body_bytes,
    ) {
        Ok(fetched) => fetched,
        Err(error) => {
            let detail = match &error {
                GithubFetchError::Timeout => "the GitHub read timed out".to_string(),
                GithubFetchError::Oversized => {
                    "the GitHub response exceeded the rule's body bound".to_string()
                }
                GithubFetchError::Transport(detail) => {
                    format!("the GitHub read failed: {}", scrub(detail, token))
                }
            };
            return GithubPollOutcome::Error {
                error_kind: error.error_kind(),
                message: truncate(&detail),
            };
        }
    };
    if fetched.status != 200 {
        return GithubPollOutcome::Error {
            error_kind: error_kind_for_status(fetched.status),
            message: truncate(&scrub(
                &format!(
                    "GitHub answered HTTP {} for {}/{}",
                    fetched.status,
                    watch.repo,
                    watch.target.path_segment()
                ),
                token,
            )),
        };
    }
    let views = match parse_items(&fetched.body) {
        Ok(views) => views,
        Err(message) => {
            return GithubPollOutcome::Error {
                error_kind: MonitorErrorKind::Malformed,
                message: truncate(&scrub(&message, token)),
            };
        }
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
    fn url_carries_the_repo_the_collection_and_the_paging_bound() {
        assert_eq!(
            list_url(
                GithubTarget::Pulls,
                "https://api.github.com",
                "clioo/drogon"
            )
            .unwrap(),
            "https://api.github.com/repos/clioo/drogon/pulls?state=open&sort=created&direction=asc&per_page=100"
        );
        // The issue watch reads the ISSUES collection of the same repo —
        // the only difference in the request it sends.
        assert_eq!(
            list_url(
                GithubTarget::Issues,
                "https://api.github.com",
                "clioo/drogon"
            )
            .unwrap(),
            "https://api.github.com/repos/clioo/drogon/issues?state=open&sort=created&direction=asc&per_page=100"
        );
        // A trailing slash never doubles.
        assert!(
            list_url(GithubTarget::Pulls, "http://127.0.0.1:9/", "a/b")
                .unwrap()
                .starts_with("http://127.0.0.1:9/repos/a/b")
        );
        assert!(list_url(GithubTarget::Issues, "https://api.github.com", "drogon").is_err());
        assert!(list_url(GithubTarget::Issues, "https://api.github.com", "a/").is_err());
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
