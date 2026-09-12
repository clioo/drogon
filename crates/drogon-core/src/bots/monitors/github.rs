//! `github_pr.v1` evaluation: one bounded, authenticated read of a
//! repository's open pull requests, then a dedupe decision over the pull
//! numbers.
//!
//! Three properties this module owns, each pinned by its own test:
//!
//! - **The token never persists.** The rule names secret REFERENCES; the
//!   value is resolved by [`crate::integrations::resolve`] inside the
//!   caller's transaction (grant re-read every tick) and lives only in the
//!   memory of one `curl` child. Every byte this module can return for
//!   persistence (error text, check-in messages) has passed
//!   [`crate::integrations::resolve::scrub_for_persist`].
//! - **The same PR never fires twice.** Dedupe is a per-monitor table of
//!   pull numbers that have already been released
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
use super::rule::{GITHUB_PULLS_PER_PAGE, GithubPrFilter, GithubPrRule};

/// A watch whose last successful check is older than this seeds forward
/// instead of replaying the backlog. Matches the delegation drain's own
/// outage grace: a change older than this is one nobody was watching.
pub const GITHUB_CATCH_UP_GRACE_MS: f64 = 30.0 * 60.0 * 1000.0;

/// Longest persisted error text (chars) — the check-in message bound.
const MAX_ERROR_CHARS: usize = 512;

/// How many pull numbers a monitor's seen set retains (newest kept). A
/// repository with more open pull requests than this still works: the
/// oldest numbers fall out of the set, and a pull request that leaves and
/// re-enters the open list may be released again — bounded, honest, and
/// never unbounded growth.
pub const MAX_SEEN_PULLS: usize = 512;

/// The pull-request subset this watch needs from GitHub's pull list.
#[derive(Debug, Clone, Deserialize)]
struct GithubPull {
    number: u64,
    #[serde(default)]
    assignees: Vec<GithubLogin>,
    #[serde(default)]
    requested_reviewers: Vec<GithubLogin>,
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

/// Stable event id for one pull request on one monitor: `mev_<sha256[..32]>`.
/// The same PR on the same watch always mints the same event id, so a
/// redelivered tick is a duplicate rather than a second release.
pub fn event_id_for_pull(monitor_id: &str, pull_number: u64) -> String {
    let digest = crate::bots::monitors::eval::digest_bytes(
        format!("github_pr:{monitor_id}:{pull_number}").as_bytes(),
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
    pull_numbers: &[u64],
    seen: &BTreeSet<u64>,
    seed_baseline: bool,
) -> GithubDedupeDecision {
    let _ = monitor_id;
    if seed_baseline {
        let mut baseline = seen.clone();
        baseline.extend(pull_numbers.iter().copied());
        prune(&mut baseline);
        return GithubDedupeDecision::Seed {
            cursor: cursor_for_seen(&baseline),
        };
    }
    let unseen = pull_numbers
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
    pull_numbers: &[u64],
    seen: &BTreeSet<u64>,
) -> BTreeSet<u64> {
    let mut next = seen.clone();
    match decision {
        GithubDedupeDecision::Nothing => {}
        GithubDedupeDecision::Release { number, .. } => {
            next.insert(*number);
        }
        GithubDedupeDecision::Seed { .. } => next.extend(pull_numbers.iter().copied()),
    }
    prune(&mut next);
    next
}

/// Turn a decision into the outcome the tick commits.
pub fn result_for(
    monitor_id: &str,
    monitor_version: u64,
    decision: &GithubDedupeDecision,
    pull_numbers: &[u64],
    seen: &BTreeSet<u64>,
    cursor_before: Option<&str>,
    observed_at_ms: f64,
) -> GithubPollOutcome {
    let seen_next = seen_after(decision, pull_numbers, seen);
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
                event_id_for_pull(monitor_id, *number),
                cursor.clone(),
                observed_at_ms,
            ),
            resource: resource_for_pull(*number),
            seen: seen_next,
        },
    }
}

/// Filter GitHub's pull list down to the rule's case.
pub fn filter_pulls(rule: &GithubPrRule, pulls: &[GithubPullView]) -> Vec<u64> {
    let mut numbers: Vec<u64> = pulls
        .iter()
        .filter(|pull| match rule.filter {
            GithubPrFilter::Opened => true,
            GithubPrFilter::Assigned => rule
                .login
                .as_deref()
                .is_some_and(|login| pull.assignees.iter().any(|who| who == login)),
            GithubPrFilter::ReviewRequested => rule
                .login
                .as_deref()
                .is_some_and(|login| pull.requested_reviewers.iter().any(|who| who == login)),
        })
        .map(|pull| pull.number)
        .collect();
    numbers.sort_unstable();
    numbers
}

/// One pull request as the filter sees it (a projection of the JSON above,
/// so the filter is testable without a server).
#[derive(Debug, Clone, PartialEq)]
pub struct GithubPullView {
    pub number: u64,
    pub assignees: Vec<String>,
    pub requested_reviewers: Vec<String>,
}

impl GithubPullView {
    fn from_wire(pull: GithubPull) -> Self {
        Self {
            number: pull.number,
            assignees: pull.assignees.into_iter().map(|who| who.login).collect(),
            requested_reviewers: pull
                .requested_reviewers
                .into_iter()
                .map(|who| who.login)
                .collect(),
        }
    }
}

/// Parse GitHub's pull-list body into the projection. A body that is not a
/// JSON array of pull objects is a `Malformed` refusal, never a guess.
pub fn parse_pulls(body: &str) -> Result<Vec<GithubPullView>, String> {
    let pulls: Vec<GithubPull> = serde_json::from_str(body)
        .map_err(|e| format!("pull list is not the expected JSON: {e}"))?;
    Ok(pulls.into_iter().map(GithubPullView::from_wire).collect())
}

/// The exact URL one poll reads: `{apiBase}/repos/{owner}/{name}/pulls`.
pub fn pulls_url(api_base: &str, repo: &str) -> Result<String, String> {
    let base = api_base.trim_end_matches('/');
    let segments: Vec<&str> = repo.split('/').collect();
    if segments.len() != 2 {
        return Err("repo must be 'owner/name'".to_string());
    }
    Ok(format!(
        "{base}/repos/{}/{}/pulls?state=open&sort=created&direction=asc&per_page={GITHUB_PULLS_PER_PAGE}",
        segments[0], segments[1]
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
    /// Pull numbers this watch already released (or seeded).
    pub seen: &'a BTreeSet<u64>,
    /// The monitor's last successful check, which decides whether this tick
    /// seeds (first check, or a gap wider than the configured catch-up
    /// threshold) or releases.
    pub last_success_at_ms: Option<f64>,
    /// Two successive fires of the monitor's cron, used to avoid treating a
    /// naturally sparse schedule as an outage. `None` uses the plain grace.
    pub expected_interval_ms: Option<f64>,
}

/// The full evaluation of one due `github_pr.v1` monitor, with the token
/// already resolved by the caller (grant-checked, memory-only).
pub fn evaluate_with_token(
    rule: &GithubPrRule,
    persisted: &PersistedWatch<'_>,
    token: Option<&str>,
    now_ms: f64,
) -> GithubPollOutcome {
    let monitor_id = persisted.monitor_id;
    let monitor_version = persisted.monitor_version;
    let cursor_before = persisted.cursor;
    let seen = persisted.seen;
    let api_base = rule
        .api_base
        .as_deref()
        .unwrap_or(super::rule::DEFAULT_GITHUB_API_BASE);
    let url = match pulls_url(api_base, &rule.repo) {
        Ok(url) => url,
        Err(message) => {
            return GithubPollOutcome::Error {
                error_kind: MonitorErrorKind::Malformed,
                message: truncate(&message),
            };
        }
    };
    let auth = token.map(|token| format!("Authorization: Bearer {token}"));
    let fetched = match fetch(&url, auth.as_deref(), rule.timeout_ms, rule.max_body_bytes) {
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
                &format!("GitHub answered HTTP {} for {}", fetched.status, rule.repo),
                token,
            )),
        };
    }
    let views = match parse_pulls(&fetched.body) {
        Ok(views) => views,
        Err(message) => {
            return GithubPollOutcome::Error {
                error_kind: MonitorErrorKind::Malformed,
                message: truncate(&scrub(&message, token)),
            };
        }
    };
    let numbers = filter_pulls(rule, &views);
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
        monitor_id,
        monitor_version,
        &decision,
        &numbers,
        seen,
        cursor_before,
        now_ms,
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

/// The number of a `pull/<n>` resource, if the event names one.
pub fn pull_number_from_resource(resource: &str) -> Option<u64> {
    resource
        .strip_prefix("pull/")
        .and_then(|number| number.parse::<u64>().ok())
}

/// The `resource` string one released pull request carries in its event.
pub fn resource_for_pull(number: u64) -> String {
    format!("pull/{number}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bots::monitors::rule::{GithubPrFilter, GithubPrRule};

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

    fn view(number: u64, assignees: &[&str], reviewers: &[&str]) -> GithubPullView {
        GithubPullView {
            number,
            assignees: assignees.iter().map(|s| s.to_string()).collect(),
            requested_reviewers: reviewers.iter().map(|s| s.to_string()).collect(),
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
            filter_pulls(&rule(GithubPrFilter::Opened, None), &pulls),
            vec![41, 42, 43]
        );
        assert_eq!(
            filter_pulls(&rule(GithubPrFilter::Assigned, Some("clioo")), &pulls),
            vec![42]
        );
        assert_eq!(
            filter_pulls(
                &rule(GithubPrFilter::ReviewRequested, Some("clioo")),
                &pulls
            ),
            vec![43]
        );
        // A login nobody matches releases nothing — never a widened filter.
        assert!(filter_pulls(&rule(GithubPrFilter::Assigned, Some("nobody")), &pulls).is_empty());
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
    fn event_ids_are_stable_per_pull_and_monitor() {
        let first = event_id_for_pull("mon-1", 42);
        assert_eq!(first, event_id_for_pull("mon-1", 42));
        assert_ne!(first, event_id_for_pull("mon-1", 43));
        assert_ne!(first, event_id_for_pull("mon-2", 42));
        assert!(crate::bots::monitors::result::is_valid_event_id(&first));
        assert_eq!(resource_for_pull(42), "pull/42");
        assert_eq!(pull_number_from_resource("pull/42"), Some(42));
        assert_eq!(pull_number_from_resource("notes/status.md"), None);
    }

    #[test]
    fn outcome_mapping_carries_the_cursor_the_event_and_the_seen_set() {
        let seen = BTreeSet::from([41]);
        let decision = GithubDedupeDecision::Release {
            number: 42,
            cursor: cursor_for_seen(&BTreeSet::from([41, 42])),
        };
        // The repository also shows #43: releasing #42 must NOT mark #43 seen.
        let outcome = result_for("mon-1", 3, &decision, &[41, 42, 43], &seen, None, 100.0);
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
            Some(event_id_for_pull("mon-1", 42).as_str())
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
            "mon-1",
            3,
            &GithubDedupeDecision::Nothing,
            &[7],
            &BTreeSet::from([7]),
            Some(&prior),
            100.0,
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
    fn url_carries_the_repo_and_the_paging_bound() {
        assert_eq!(
            pulls_url("https://api.github.com", "clioo/drogon").unwrap(),
            "https://api.github.com/repos/clioo/drogon/pulls?state=open&sort=created&direction=asc&per_page=100"
        );
        // A trailing slash never doubles.
        assert!(
            pulls_url("http://127.0.0.1:9/", "a/b")
                .unwrap()
                .starts_with("http://127.0.0.1:9/repos/a/b")
        );
        assert!(pulls_url("https://api.github.com", "drogon").is_err());
    }

    #[test]
    fn malformed_bodies_and_statuses_are_honest_errors() {
        assert!(parse_pulls("not json").is_err());
        assert!(parse_pulls(r#"{"message":"Bad credentials"}"#).is_err());
        let pulls = parse_pulls(r#"[{"number":42,"assignees":[{"login":"clioo"}]}]"#).unwrap();
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
