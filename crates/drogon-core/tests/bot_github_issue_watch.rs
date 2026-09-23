//! The native issue watch (`github_issue.v1`), end to end and fixture-only.
//!
//! This is the regression for the reported failure (issue #608): asked to
//! "watch this repository for new issues", an agent had no native verb, so
//! it hand-rolled an hourly automation whose dedupe was an LLM writing a
//! JSON file — and with no baseline step, its FIRST run treated every
//! already-open issue as new and dispatched one full session per issue at
//! once. The native watch must do the opposite on its first look: record
//! what is already open and release nothing.
//!
//! One extra rule belongs to issues alone: GitHub's issues endpoint returns
//! pull requests too (every PR is an issue). An issue watch must drop them.
//!
//! Fixtures only, never a real repository, credential or model — the same
//! discipline as `bot_github_pr_watch.rs`:
//! - `scripts/fixtures/github/fake-github-server.mjs` is the GitHub source
//!   (it serves pull requests from `/issues` exactly as the real API does,
//!   so the exclusion is proven against a faithful list, not a kind one);
//! - the token is sealed through the real `secrets.set` + `bot.grant_secret`
//!   surface into a temp data dir;
//! - the harness is a stub `codex` shell script first on `PATH`, installed
//!   before any tick that can dispatch and removed on drop, so no model runs
//!   and no user installation is touched;
//! - the git project is a temp repository created by the test.
//!
//! Everything in between is production code: the real scheduler tick, the
//! real `curl` transport, the real sealing and grant checks, the real
//! delegation drain and the real session admission.
#![cfg(unix)]

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use drogon_core::Engine;
use drogon_core::automations::scheduler;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use rusqlite::Connection;
use serde_json::{Value, json};

const FIXTURE_TOKEN: &str = "fixture-token";
const SECRET_REF: &str = "GITHUB_TOKEN_REF";
const REPO: &str = "clioo/drogon";
const LOGIN: &str = "clioo";

/// Serializes the tests that mutate the process-global harness `PATH`.
static PATH_LOCK: Mutex<()> = Mutex::new(());

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    // A fresh request id per call: the ledger dedupes on
    // (requestId, method, params).
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    engine.dispatch(request(&format!("gh-issue-watch-{id}"), method, params))
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(response.ok, "expected ok for {method}: {response:?}");
    response.result.unwrap()
}

// --- fixture GitHub source -------------------------------------------------

struct GithubFixture {
    child: Child,
    pub base: String,
    data_path: PathBuf,
    log_path: PathBuf,
}

impl Drop for GithubFixture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl GithubFixture {
    fn start(dir: &Path) -> Self {
        let script = repo_root().join("scripts/fixtures/github/fake-github-server.mjs");
        let data_path = dir.join("github-data.json");
        let log_path = dir.join("github-requests.jsonl");
        fs::write(&data_path, br#"{"issues":[],"pulls":[]}"#).unwrap();
        let node = std::env::var("DROGON_TEST_NODE").unwrap_or_else(|_| "node".to_string());
        let mut child = Command::new(node)
            .arg(&script)
            .arg("--data")
            .arg(&data_path)
            .arg("--port")
            .arg("0")
            .arg("--log")
            .arg(&log_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn fake github server (node must be on PATH or DROGON_TEST_NODE)");
        let stdout = child.stdout.take().expect("fixture stdout");
        let line = BufReader::new(stdout)
            .lines()
            .next()
            .expect("fixture LISTEN line")
            .expect("fixture LISTEN line read");
        let port: u16 = line
            .trim()
            .strip_prefix("LISTEN ")
            .expect("LISTEN prefix")
            .parse()
            .expect("port number");
        Self {
            child,
            base: format!("http://127.0.0.1:{port}"),
            data_path,
            log_path,
        }
    }

    /// Replace the repository's open issues and open pull requests. The
    /// fixture serves BOTH from `/issues` (the PRs marked as the real API
    /// marks them), so "a new issue appears" and "a PR is in the issue
    /// list" are both a file write.
    fn set_world(&self, issues: &[Value], pulls: &[Value]) {
        fs::write(
            &self.data_path,
            serde_json::to_vec(&json!({ "issues": issues, "pulls": pulls })).unwrap(),
        )
        .unwrap();
    }

    fn set_issues(&self, issues: &[Value]) {
        self.set_world(issues, &[]);
    }

    fn requests(&self) -> Vec<Value> {
        let Ok(text) = fs::read_to_string(&self.log_path) else {
            return Vec::new();
        };
        text.lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).expect("log line json"))
            .collect()
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn git_output(dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn issue(number: u64, assignees: &[&str]) -> Value {
    json!({
        "number": number,
        "title": format!("Issue {number}"),
        "state": "open",
        "updated_at": "2026-09-18T00:00:00Z",
        "assignees": assignees.iter().map(|login| json!({"login": login})).collect::<Vec<_>>(),
    })
}

fn pull(number: u64, assignees: &[&str]) -> Value {
    json!({
        "number": number,
        "title": format!("PR {number}"),
        "state": "open",
        "updated_at": "2026-09-18T00:00:00Z",
        "assignees": assignees.iter().map(|login| json!({"login": login})).collect::<Vec<_>>(),
        "requested_reviewers": [],
    })
}

// --- fixture world ---------------------------------------------------------

struct Fixture {
    dir: tempfile::TempDir,
    engine: Engine,
    github: GithubFixture,
    repo: PathBuf,
    project_id: String,
    workspace_id: String,
    host_id: String,
    bot_id: String,
    monitor_id: String,
    stub: StubHarness,
}

fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

impl Fixture {
    /// A real git project registered as a workspace and project, a Bot
    /// living in it, one sealed+granted GitHub token, and an approved
    /// `github_issue.v1` watch. `triage_action` binds the reactive
    /// responsibility the watch releases; without it the watch observes
    /// only, which is how the monitoring semantics are asserted without
    /// ever dispatching anything.
    fn new(triage_action: bool) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let stub = StubHarness::install(dir.path());
        let repo = dir.path().join("project");
        fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-q", "-b", "main"]);
        git(&repo, &["config", "user.email", "fixture@example.com"]);
        git(&repo, &["config", "user.name", "fixture"]);
        fs::write(repo.join("README.md"), "fixture\n").unwrap();
        git(&repo, &["add", "README.md"]);
        git(&repo, &["commit", "-q", "-m", "init"]);

        let engine = Engine::open(&dir.path().join("data")).unwrap();
        let registered = ok(
            &engine,
            "workspace.register",
            json!({"path": repo.to_str().unwrap()}),
        );
        let workspace_id = registered["id"].as_str().unwrap().to_string();
        let host_id = registered["hostId"].as_str().unwrap().to_string();
        let project = ok(
            &engine,
            "project.add",
            json!({"path": repo.to_str().unwrap()}),
        );
        let project_id = project["id"].as_str().unwrap().to_string();
        let bot = ok(
            &engine,
            "bot.create",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {"displayName": "Triager", "handle": null, "title": null},
                    "harnessPolicy": {"defaultHarness": "codex", "explicitModel": null},
                    "instructions": "Triage what is reported here.",
                    "memories": [],
                },
            }),
        );
        let bot_id = bot["id"].as_str().unwrap().to_string();

        ok(
            &engine,
            "secrets.set",
            json!({"kind": "github", "name": SECRET_REF, "value": FIXTURE_TOKEN}),
        );
        ok(
            &engine,
            "bot.grant_secret",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "botId": bot_id,
                "secretRef": SECRET_REF,
                "kind": "github",
            }),
        );

        let github = GithubFixture::start(dir.path());
        // The reported ask, spelled natively: "watch this repo for new
        // issues" — the whole repository, so no login is needed.
        let mut params = json!({
            "workspaceId": workspace_id,
            "hostId": host_id,
            "botId": bot_id,
            "kind": "github_issue.v1",
            "repo": REPO,
            "filter": "opened",
            "apiBase": github.base,
            "secretRefs": [SECRET_REF],
            "harness": "codex",
            "skills": ["drogon-cli"],
            "cron": "* * * * *",
        });
        if triage_action {
            params["responsibilityName"] = json!("Triage new issues");
            params["instructions"] = json!("Reproduce it, fix it, open a PR and close it.");
        }
        let created = ok(&engine, "bot.monitor_create", params);
        assert_eq!(created["ruleKind"], "github_issue.v1");
        assert_eq!(created["approved"], false, "a network watch stages parked");
        let monitor_id = created["monitorId"].as_str().unwrap().to_string();
        ok(
            &engine,
            "bot.monitor_approve",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "botId": bot_id,
                "monitorId": monitor_id,
            }),
        );
        Self {
            repo,
            project_id,
            workspace_id,
            host_id,
            bot_id,
            monitor_id,
            engine,
            github,
            stub,
            dir,
        }
    }

    fn db(&self) -> Connection {
        Connection::open(self.dir.path().join("data").join(drogon_core::DB_FILE_NAME)).unwrap()
    }

    fn now_ms() -> f64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64
    }

    fn tick(&self, now_ms: f64) {
        scheduler::tick_once(&self.engine, now_ms);
    }

    fn events(&self) -> Vec<Value> {
        let conn = self.db();
        let mut stmt = conn
            .prepare("SELECT payload_json FROM bot_monitor_events ORDER BY at, rowid")
            .unwrap();
        let rows: Vec<Value> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|row| serde_json::from_str(&row.unwrap()).unwrap())
            .collect();
        rows
    }

    /// The numbers this watch has released or seeded. The dedupe table is
    /// shared with pull-request watches (its column is still spelled
    /// `pull_number`); a monitor has one kind, so these are issue numbers.
    fn seen_issues(&self) -> Vec<u64> {
        let conn = self.db();
        let mut stmt = conn
            .prepare(
                "SELECT pull_number FROM bot_monitor_github_seen WHERE monitor_id = ?1 ORDER BY pull_number",
            )
            .unwrap();
        let rows: Vec<u64> = stmt
            .query_map([&self.monitor_id], |r| r.get::<_, i64>(0))
            .unwrap()
            .map(|row| row.unwrap() as u64)
            .collect();
        rows
    }

    /// Backdate the monitor's last successful check: how a real daemon sees
    /// "I was not running for a while" (the row is its state).
    fn backdate_last_success(&self, by_ms: f64) {
        let conn = self.db();
        let payload: String = conn
            .query_row(
                "SELECT payload_json FROM bot_monitors WHERE id = ?1",
                [&self.monitor_id],
                |r| r.get(0),
            )
            .unwrap();
        let mut value: Value = serde_json::from_str(&payload).unwrap();
        let backdated = Self::now_ms() - by_ms;
        value["lastSuccessAtMs"] = json!(backdated);
        value["lastCheckAtMs"] = json!(backdated);
        conn.execute(
            "UPDATE bot_monitors SET payload_json = ?1 WHERE id = ?2",
            rusqlite::params![serde_json::to_string(&value).unwrap(), &self.monitor_id],
        )
        .unwrap();
    }

    fn monitor_view(&self) -> Value {
        let list = ok(
            &self.engine,
            "bot.monitor_list",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "botId": self.bot_id,
            }),
        );
        list["monitors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|monitor| monitor["monitorId"] == json!(self.monitor_id))
            .cloned()
            .expect("the watch is listed")
    }

    /// The workspace row for the Bot's record folder (where monitor-released
    /// Bot sessions run), not its provisioned home.
    fn bot_folder_workspace_id(&self) -> String {
        let conn = self.db();
        let folder: String = conn
            .query_row(
                "SELECT folder FROM bots WHERE id = ?1 AND host_id = ?2",
                rusqlite::params![&self.bot_id, &self.host_id],
                |r| r.get(0),
            )
            .unwrap();
        conn.query_row(
            "SELECT id FROM workspaces WHERE path = ?1 AND host_id = ?2",
            rusqlite::params![folder, &self.host_id],
            |r| r.get(0),
        )
        .expect("the bot home workspace is registered")
    }

    fn sessions_in(&self, workspace_id: &str) -> Vec<Value> {
        let listed = ok(
            &self.engine,
            "session.list",
            json!({"workspaceId": workspace_id}),
        );
        listed["sessions"].as_array().cloned().unwrap_or_default()
    }

    fn close_session(&self, session: &Value) {
        let closed = call(
            &self.engine,
            "session.close",
            json!({
                "sessionId": session["id"],
                "incarnation": session["incarnation"],
            }),
        );
        assert!(closed.ok, "session.close: {closed:?}");
    }

    /// Wait (bounded) until no process in the table runs this test's stub
    /// binary, and return the survivors (empty when cleanup held). Scoped to
    /// the fixture's own temp path, never a broad executable-name match.
    fn stub_survivors(&self, timeout: std::time::Duration) -> Vec<String> {
        let needle = self.stub.bin.to_string_lossy().to_string();
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let output = Command::new("ps")
                .args(["-ax", "-o", "pid=,command="])
                .output()
                .expect("ps runs");
            let survivors: Vec<String> = String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| line.contains(&needle))
                .map(str::to_string)
                .collect();
            if survivors.is_empty() || std::time::Instant::now() >= deadline {
                return survivors;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

/// A stub `codex` first on `PATH`: a real session is admitted (harness
/// discovery, reservation, PTY, env, hooks) without any model ever running.
/// Restores `PATH` and kills nothing else on drop.
struct StubHarness {
    _dir: tempfile::TempDir,
    _guard: std::sync::MutexGuard<'static, ()>,
    saved_path: Option<std::ffi::OsString>,
    bin: PathBuf,
    log: PathBuf,
}

impl StubHarness {
    fn install(dir: &Path) -> Self {
        let guard = PATH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let stub_dir = dir.join("stub-bin");
        fs::create_dir_all(&stub_dir).unwrap();
        let bin = stub_dir.join("codex");
        let log = dir.join("stub-codex.log");
        fs::write(
            &bin,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> {log}\ncat > /dev/null\nsleep 3\n",
                log = log.display()
            ),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt as _;
        let mut perms = fs::metadata(&bin).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&bin, perms).unwrap();
        let saved_path = std::env::var_os("PATH");
        let joined = format!(
            "{}:{}",
            stub_dir.display(),
            saved_path.clone().unwrap_or_default().to_string_lossy()
        );
        unsafe { std::env::set_var("PATH", joined) };
        Self {
            _dir: tempfile::TempDir::new().unwrap(),
            _guard: guard,
            saved_path,
            bin,
            log,
        }
    }

    fn launches(&self) -> Vec<String> {
        fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    fn wait_for_launch(&self, timeout: std::time::Duration) -> Vec<String> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let launches = self.launches();
            if !launches.is_empty() || std::time::Instant::now() >= deadline {
                return launches;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    fn is_discoverable(&self) -> bool {
        self.bin.is_file()
    }
}

impl Drop for StubHarness {
    fn drop(&mut self) {
        match self.saved_path.take() {
            Some(path) => unsafe { std::env::set_var("PATH", path) },
            None => unsafe { std::env::remove_var("PATH") },
        }
    }
}

// --- the monitoring semantics (no action bound, no dispatch) ---------------

#[test]
fn an_issue_watch_seeds_its_backlog_and_then_fires_once_per_new_issue() {
    let fx = Fixture::new(false);
    // Align the synthetic clock to the minutely cron boundary so the 45s
    // not-due assertion is independent of the wall-clock second.
    let t0 = (Fixture::now_ms() / 60_000.0).floor() * 60_000.0;

    // THE REGRESSION. Three issues are already open when the watch is
    // created — the exact shape that made the hand-rolled automation
    // dispatch three concurrent leader sessions on its first run. The
    // native watch records them as the baseline and releases NOTHING.
    fx.github
        .set_issues(&[issue(598, &[]), issue(599, &[LOGIN]), issue(600, &[])]);
    fx.tick(t0);
    assert!(
        fx.events().is_empty(),
        "the first check seeds instead of replaying every open issue: {:?}",
        fx.events()
    );
    assert_eq!(fx.seen_issues(), vec![598, 599, 600]);
    let requests = fx.github.requests();
    assert_eq!(requests.len(), 1, "exactly one read on the first tick");
    assert_eq!(
        requests[0]["path"],
        format!("/repos/{REPO}/issues"),
        "an issue watch reads the ISSUES collection, not pulls"
    );
    assert_eq!(
        requests[0]["hasCredential"], true,
        "the sealed token was sent"
    );
    assert_eq!(requests[0]["query"]["state"], "open");

    // A genuinely new issue appears.
    fx.github.set_issues(&[
        issue(598, &[]),
        issue(599, &[LOGIN]),
        issue(600, &[]),
        issue(601, &[]),
    ]);
    let before_quiet_gap = fx.github.requests().len();
    fx.tick(t0 + 45_000.0);
    assert_eq!(
        fx.github.requests().len(),
        before_quiet_gap,
        "a 45-second quiet tick is not due for a minutely watch"
    );
    fx.tick(t0 + 61_000.0);
    let events = fx.events();
    assert_eq!(events.len(), 1, "exactly one release: {events:?}");
    assert_eq!(
        events[0]["resource"], "issue/601",
        "the case names the issue, not a pull request"
    );
    assert_eq!(events[0]["projectId"], fx.workspace_id);
    assert_eq!(events[0]["botId"], fx.bot_id);
    let event_id = events[0]["eventId"].as_str().unwrap().to_string();
    assert!(event_id.starts_with("mev_"), "{event_id}");
    assert_eq!(fx.seen_issues(), vec![598, 599, 600, 601]);

    // The same issue again, unchanged and then commented on and retitled by
    // someone else, never fires twice.
    fx.tick(t0 + 122_000.0);
    assert_eq!(fx.events().len(), 1, "the same cursor is a no-change tick");
    fx.github.set_issues(&[
        issue(598, &[]),
        issue(599, &[LOGIN]),
        issue(600, &[]),
        json!({
            "number": 601,
            "title": "Issue 601 (someone commented and retitled it)",
            "state": "open",
            "updated_at": "2026-09-18T09:00:00Z",
            "assignees": [{"login": LOGIN}],
        }),
    ]);
    fx.tick(t0 + 183_000.0);
    let events = fx.events();
    assert_eq!(
        events.len(),
        1,
        "an edited, already-released issue is quiet"
    );
    assert_eq!(events[0]["eventId"], json!(event_id));

    // Outage: the daemon was down for two hours and issues piled up. The
    // watch seeds the world as it is and releases nothing — no catch-up
    // storm, the same guarantee `watch-pr` already had.
    fx.backdate_last_success(2.0 * 60.0 * 60.0 * 1000.0);
    fx.github.set_issues(&[
        issue(598, &[]),
        issue(601, &[LOGIN]),
        issue(602, &[]),
        issue(603, &[]),
        issue(604, &[]),
    ]);
    fx.tick(t0 + 244_000.0);
    assert_eq!(
        fx.events().len(),
        1,
        "an outage backlog is seeded, never replayed"
    );
    assert_eq!(fx.seen_issues(), vec![598, 599, 600, 601, 602, 603, 604]);

    // ...and the NEXT genuinely new issue still fires normally.
    fx.github.set_issues(&[issue(604, &[]), issue(605, &[])]);
    fx.tick(t0 + 305_000.0);
    let events = fx.events();
    assert_eq!(events.len(), 2, "the watch is alive again: {events:?}");
    assert_eq!(events[1]["resource"], "issue/605");
    assert_ne!(
        events[1]["eventId"].as_str().unwrap(),
        event_id,
        "a different issue mints a different event"
    );

    // The monitor's own state is honest about what it watches.
    let view = fx.monitor_view();
    assert_eq!(view["ruleKind"], "github_issue.v1");
    assert_eq!(view["repo"], REPO);
    assert_eq!(view["filter"], "opened");
    assert_eq!(view["caseHarness"], "codex");
    assert_eq!(view["caseSkills"], json!(["drogon-cli"]));
    assert_eq!(view["approved"], json!(true));
    assert_eq!(
        view["health"], "healthy",
        "an evaluated kind is never 'unsupported': {view:?}"
    );

    // An ungranted (revoked) token is an honest refusal: the watch never
    // reaches the network and records no event.
    ok(
        &fx.engine,
        "bot.revoke_secret",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
            "botId": fx.bot_id,
            "secretRef": SECRET_REF,
        }),
    );
    let before = fx.github.requests().len();
    fx.github
        .set_issues(&[issue(604, &[]), issue(605, &[]), issue(606, &[])]);
    fx.tick(t0 + 366_000.0);
    assert_eq!(
        fx.github.requests().len(),
        before,
        "an unauthorized watch never reaches the network"
    );
    assert_eq!(fx.events().len(), 2, "and releases nothing");
    assert!(
        fx.monitor_view()["lastError"]
            .as_str()
            .is_some_and(|text| text.contains("Unauthorized")),
        "{:?}",
        fx.monitor_view()
    );
}

/// GitHub's issue list contains pull requests. A watch asked for ISSUES
/// must never release one: a code review is not a bug report, and the two
/// kinds carry different cases into the dispatched prompt.
#[test]
fn a_pull_request_in_the_issue_list_is_never_released_as_an_issue() {
    let fx = Fixture::new(false);
    let t0 = (Fixture::now_ms() / 60_000.0).floor() * 60_000.0;

    fx.github.set_world(&[issue(10, &[])], &[]);
    fx.tick(t0);
    assert!(fx.events().is_empty(), "the baseline is seeded");
    assert_eq!(fx.seen_issues(), vec![10]);

    // A pull request is opened. The fixture serves it from /issues exactly
    // as GitHub does (with its `pull_request` marker) — and the watch must
    // stay completely quiet: no event, and no seen row either.
    fx.github
        .set_world(&[issue(10, &[])], &[pull(11, &[LOGIN])]);
    fx.tick(t0 + 61_000.0);
    assert!(
        fx.events().is_empty(),
        "a pull request never fires an issue watch: {:?}",
        fx.events()
    );
    assert_eq!(
        fx.seen_issues(),
        vec![10],
        "and it is not recorded as a seen issue"
    );

    // A real issue in the same poll still fires, and it is the ONLY thing
    // released — the exclusion is not a blanket mute.
    fx.github
        .set_world(&[issue(10, &[]), issue(12, &[])], &[pull(11, &[LOGIN])]);
    fx.tick(t0 + 122_000.0);
    let events = fx.events();
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0]["resource"], "issue/12");
    assert_eq!(fx.seen_issues(), vec![10, 12]);
}

// --- the owner's scenario: the released triage session ---------------------

#[test]
fn a_new_issue_releases_a_triage_session_in_the_project() {
    let fx = Fixture::new(true);
    let stub = &fx.stub;
    assert!(stub.is_discoverable());

    let t0 = Fixture::now_ms();
    fx.github.set_issues(&[issue(598, &[])]);
    fx.tick(t0);
    assert!(fx.events().is_empty(), "the baseline is seeded");
    fx.github.set_issues(&[issue(598, &[]), issue(608, &[])]);
    fx.tick(t0 + 61_000.0);

    // The event was drained by the tick tail into a real responsibility run.
    let view = fx.monitor_view();
    let firing = &view["firing"];
    assert_eq!(firing["lastOutcome"], "dispatched", "{view:?}");
    let event_id = firing["lastEventId"].as_str().unwrap().to_string();
    let run_id = firing["lastRunId"].as_str().unwrap_or_default().to_string();
    assert!(!run_id.is_empty(), "{view:?}");
    assert_eq!(firing["countToday"], 1);
    assert_eq!(
        firing["lastResource"], "issue/608",
        "the firing names the released case: {view:?}"
    );

    let home = fx.bot_folder_workspace_id();
    let home_sessions = fx.sessions_in(&home);
    assert_eq!(home_sessions.len(), 1, "one delegated run, one session");
    let delegated = &home_sessions[0];
    assert_eq!(delegated["harnessId"], "codex");
    assert_eq!(
        delegated["causedByEventId"],
        json!(event_id),
        "the Bot's own run is attributable to the event that caused it"
    );
    let prompt = delegated["args"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .find(|arg| arg.contains("Monitor delegation"))
        .expect("the delegated session carries its prompt as argv")
        .to_string();
    let project_id_from_prompt = prompt
        .lines()
        .find_map(|line| {
            let marker = "worktree create --project ";
            let project = line.split_once(marker)?.1.split_whitespace().next()?;
            Some(project.trim_matches('`').to_string())
        })
        .expect("prompt contains the project id for worktree creation");
    assert_eq!(project_id_from_prompt, fx.project_id, "{prompt}");
    // The CASE is named as an ISSUE, with the `gh` command that actually
    // reads one — never "review this pull request".
    assert!(
        prompt.contains("issue #608") && prompt.contains(REPO),
        "{prompt}"
    );
    assert!(prompt.contains("gh issue view 608"), "{prompt}");
    assert!(
        !prompt.contains("pull request #608") && !prompt.contains("gh pr diff"),
        "an issue case must never be described as a pull request: {prompt}"
    );
    assert!(
        prompt.contains("issue-608-clioo-drogon"),
        "the worktree is named after the issue case: {prompt}"
    );
    assert!(prompt.contains("harness (codex)"), "{prompt}");
    assert!(
        prompt.contains(&format!("monitor event {event_id}")),
        "{prompt}"
    );
    // ...and the stub really was the binary that ran.
    assert_eq!(
        fs::canonicalize(delegated["command"].as_str().unwrap()).unwrap(),
        fs::canonicalize(&stub.bin).unwrap(),
        "the daemon resolved the harness from PATH (canonicalized)"
    );
    let launches = stub.wait_for_launch(std::time::Duration::from_secs(5));
    assert!(
        launches.iter().any(|line| line.starts_with("exec ")),
        "the stub ran the harness's headless entrypoint: {launches:?}"
    );

    // Hop two, with the instructions the prompt actually gave: the worktree
    // the prompt named really is creatable, in the project, on that name.
    let worktree = ok(
        &fx.engine,
        "worktree.create",
        json!({"projectId": project_id_from_prompt, "name": "issue-608-clioo-drogon"}),
    );
    let triage_workspace = worktree["workspaceId"].as_str().unwrap().to_string();
    assert_ne!(triage_workspace, fx.workspace_id);
    let worktree_path = PathBuf::from(worktree["path"].as_str().unwrap());
    assert_eq!(
        fs::canonicalize(git_output(
            &worktree_path,
            &["rev-parse", "--git-common-dir"]
        ))
        .unwrap(),
        fs::canonicalize(fx.repo.join(".git")).unwrap(),
        "the triage worktree shares the project's git dir"
    );
    assert_eq!(worktree["branch"], "issue-608-clioo-drogon");

    // A SECOND new issue in the same repository is a different case: it
    // gets its own event, its own worktree name and its own run — it never
    // joins the first issue's session.
    fx.github
        .set_issues(&[issue(598, &[]), issue(608, &[]), issue(609, &[])]);
    fx.tick(t0 + 122_000.0);
    let second = fx.monitor_view();
    assert_eq!(second["firing"]["lastResource"], "issue/609", "{second:?}");
    assert_ne!(
        second["firing"]["lastEventId"].as_str().unwrap(),
        event_id,
        "a different issue is a different case"
    );
    assert_eq!(second["firing"]["countToday"], 2);

    // Cleanup: every session this test started is stopped before the temp
    // dirs go away.
    for session in fx.sessions_in(&home) {
        fx.close_session(&session);
    }
    for session in fx.sessions_in(&home) {
        assert_eq!(
            session["verdict"], "exited",
            "no session this test started may still be live: {session:?}"
        );
    }
    assert_eq!(
        fx.stub_survivors(std::time::Duration::from_secs(10)),
        Vec::<String>::new(),
        "every stub harness process this test started must be gone"
    );
}
