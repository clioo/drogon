//! The Work board end to end through the real `drogond` and the real
//! `drogon-cli`: columns configured from the CLI, a ticket created with a
//! linked session, a move that types the column's prompt into that live
//! session, a stopped session resumed by `work ticket open`, and the
//! delivery history. The harness is a fixture `claude` on PATH (argv and
//! stdin echo; no model, no network).

#![cfg(unix)]

mod common;

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

use common::{stderr, stdout};

const READY_TIMEOUT: Duration = Duration::from_secs(30);

const FIXTURE_CLAUDE: &str = "#!/bin/sh\nfor arg in \"$@\"; do echo \"ARG:$arg\"; done\nwhile IFS= read -r line; do echo \"you said: $line\"; done\n";

struct Fixture {
    _root: tempfile::TempDir,
    data_dir: PathBuf,
    home: PathBuf,
    project: PathBuf,
    daemon: Option<Child>,
}

impl Fixture {
    fn start() -> Self {
        let root = tempfile::tempdir().expect("root");
        let data_dir = root.path().join("data");
        let home = root.path().join("home");
        let bin = root.path().join("bin");
        let project = root.path().join("Drogon");
        for dir in [&data_dir, &home, &bin, &project] {
            std::fs::create_dir_all(dir).expect("dir");
        }
        let claude = bin.join("claude");
        std::fs::write(&claude, FIXTURE_CLAUDE).expect("fixture");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755)).expect("mode");
        // A logged-out `gh` shadows the real one: the owner's GitHub login
        // is never read by a test.
        let gh = bin.join("gh");
        std::fs::write(&gh, "#!/bin/sh\nexit 1\n").expect("fixture gh");
        std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).expect("mode");
        let mut path = vec![bin.clone()];
        path.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        let mut command = Command::new(drogond_binary());
        command
            .arg("--data-dir")
            .arg(&data_dir)
            .env("HOME", &home)
            .env("CLAUDE_CONFIG_DIR", home.join(".claude"))
            .env("PATH", std::env::join_paths(path).expect("path"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for name in common::INHERITED_BINDINGS {
            command.env_remove(name);
        }
        let mut fixture = Fixture {
            _root: root,
            data_dir,
            home,
            project,
            daemon: Some(command.spawn().expect("spawn drogond")),
        };
        let deadline = Instant::now() + READY_TIMEOUT;
        loop {
            if let Ok(status) = fixture.run(&["--json", "status"]) {
                let caps = status["result"]["capabilities"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                assert!(
                    caps.iter().any(|c| c == "work.v1"),
                    "the drogond next to drogon-cli predates work.v1; run `cargo build -p drogond` first"
                );
                break;
            }
            assert!(Instant::now() < deadline, "drogond never became ready");
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = &mut fixture;
        fixture
    }

    fn command(&self, args: &[&str]) -> std::process::Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
        command.args(args);
        common::scrub_environment(&mut command, &self.data_dir);
        command.env("HOME", &self.home);
        command.output().expect("spawn drogon-cli")
    }

    /// Human form with `input` on stdin.
    fn text_with_stdin(&self, args: &[&str], input: &str) -> std::process::Output {
        use std::io::Write as _;
        let mut command = Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
        command.args(args);
        common::scrub_environment(&mut command, &self.data_dir);
        command
            .env("HOME", &self.home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().expect("spawn drogon-cli");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        child.wait_with_output().expect("drogon-cli output")
    }

    fn run(&self, args: &[&str]) -> Result<Value, String> {
        let output = self.command(args);
        if !output.status.success() {
            return Err(format!("{}\n{}", stdout(&output), stderr(&output)));
        }
        serde_json::from_str(&stdout(&output)).map_err(|e| e.to_string())
    }

    /// `--json` form: the validated envelope's `result`.
    fn json(&self, args: &[&str]) -> Value {
        let mut full = vec!["--json"];
        full.extend_from_slice(args);
        let envelope = self
            .run(&full)
            .unwrap_or_else(|e| panic!("drogon-cli {} failed: {e}", args.join(" ")));
        envelope["result"].clone()
    }

    /// Human form.
    fn text(&self, args: &[&str]) -> String {
        let output = self.command(args);
        assert!(
            output.status.success(),
            "drogon-cli {}: {}",
            args.join(" "),
            stderr(&output)
        );
        stdout(&output)
    }

    fn read(&self, session: &Value) -> String {
        let read = self.json(&[
            "terminal",
            "read",
            "--session",
            session["id"].as_str().unwrap(),
            "--incarnation",
            session["incarnation"].as_str().unwrap(),
        ]);
        read["text"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| {
                read["dataBase64"].as_str().map(|b| {
                    use base64::Engine as _;
                    String::from_utf8_lossy(
                        &base64::engine::general_purpose::STANDARD.decode(b).unwrap(),
                    )
                    .into_owned()
                })
            })
            .unwrap_or_default()
    }

    fn wait_for(&self, session: &Value, needle: &str) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let text = self.read(session);
            if text.contains(needle) {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "never saw {needle:?} in:\n{text}"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(mut child) = self.daemon.take() {
            unsafe { libc_kill(child.id() as i32, 15) };
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) if Instant::now() < deadline => {
                        std::thread::sleep(Duration::from_millis(20))
                    }
                    _ => {
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                }
            }
        }
    }
}

unsafe extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, signal: i32) -> i32;
}

fn drogond_binary() -> PathBuf {
    let cli = PathBuf::from(env!("CARGO_BIN_EXE_drogon-cli"));
    let path = cli.parent().expect("target dir").join("drogond");
    assert!(
        path.is_file(),
        "{} is missing; run `cargo build -p drogond` first",
        path.display()
    );
    path
}

fn project_path(fx: &Fixture) -> &Path {
    &fx.project
}

#[test]
fn work_is_configured_and_driven_from_the_cli() {
    let fx = Fixture::start();
    let project = fx.json(&["project", "add", project_path(&fx).to_str().unwrap()]);
    let project_id = project["id"].as_str().unwrap().to_string();
    let workspace =
        fx.json(&["worktree", "list", "--project", &project_id])["worktrees"][0]["workspaceId"]
            .as_str()
            .unwrap()
            .to_string();

    // Columns: the seeded board, plus one configured entirely from here.
    let columns = fx.text(&["work", "column", "list"]);
    for name in ["To do", "In progress", "Review", "QA", "Done"] {
        assert!(columns.contains(name), "{columns}");
    }
    let created = fx.json(&[
        "work", "column", "create", "--name", "Blocked", "--icon", "blocked", "--index", "1",
    ]);
    assert_eq!(created["position"], 1);
    let review = fx.json(&[
        "work",
        "column",
        "update",
        "--column",
        "Review",
        "--on-enter",
        "true",
        "--pr-watch",
        "true",
        "--schedule",
        "15m",
        "--message",
        "Review {ticket.pr} for {ticket.id}",
        "--recipients",
        "all",
    ]);
    assert_eq!(review["sendOnEnter"], true);
    assert_eq!(review["prWatch"], true);
    assert_eq!(review["cron"], "*/15 * * * *");
    let human = fx.text(&["work", "column", "list"]);
    assert!(
        human.contains("on enter, schedule */15 * * * *, PR changes"),
        "{human}"
    );
    let refused = fx.command(&[
        "work",
        "column",
        "update",
        "--column",
        "Review",
        "--recipients",
        "some",
    ]);
    assert_eq!(
        refused.status.code(),
        Some(2),
        "usage errors are refused locally"
    );
    let empty = fx.command(&["work", "column", "update", "--column", "Review"]);
    assert_eq!(empty.status.code(), Some(2));

    // A live harness session linked at creation.
    let session = fx.json(&[
        "harness",
        "start",
        "--workspace",
        &workspace,
        "--harness",
        "claude",
    ]);
    let session_id = session["id"].as_str().unwrap().to_string();
    let ticket = fx.json(&[
        "work",
        "ticket",
        "create",
        "--title",
        "Improve Jira resume",
        "--project",
        "Drogon",
        "--column",
        "In progress",
        "--pr",
        "#648",
        "--source",
        "https://jira.example.com/browse/DRG-9",
        "--next",
        "Choose the demo scope",
        "--session",
        &session_id,
    ]);
    assert_eq!(ticket["key"], "DRG-1");
    assert_eq!(ticket["sessions"][0]["id"], session_id.as_str());
    let board = fx.text(&["work", "board"]);
    assert!(board.contains("In progress (1)"), "{board}");
    assert!(
        board.contains("DRG-1  Improve Jira resume  [Drogon]  PR #648  1 session(s)"),
        "{board}"
    );

    // Preview changes nothing; the move types the prompt into the session.
    let preview = fx.text(&[
        "work", "column", "preview", "--column", "Review", "--ticket", "DRG-1",
    ]);
    assert!(
        preview.contains(&format!("DRG-1 → resume {session_id}"))
            || preview.contains(&format!("DRG-1 → send {session_id}")),
        "{preview}"
    );
    let moved = fx.json(&[
        "work", "ticket", "move", "--ticket", "drg-1", "--column", "Review",
    ]);
    assert_eq!(moved["delivery"]["results"][0]["action"], "sent", "{moved}");
    fx.wait_for(&session, "you said: Review PR #648 for DRG-1");
    let sends = fx.text(&["work", "sends", "--ticket", "DRG-1"]);
    assert!(
        sends.contains("DRG-1 ← \"Review PR #648 for DRG-1\": sent"),
        "{sends}"
    );

    // A stopped session is resumed by `work ticket open`, in its place.
    let stop_params = format!(
        "{{\"sessionId\":\"{session_id}\",\"incarnation\":\"{}\"}}",
        session["incarnation"].as_str().unwrap()
    );
    assert_eq!(
        fx.json(&["rpc", "session.stop", "--params", &stop_params])["verdict"],
        "exited"
    );
    let opened = fx.json(&[
        "work",
        "ticket",
        "open",
        "--ticket",
        "DRG-1",
        "--session",
        &session_id,
    ]);
    let replacement = opened["session"]["id"].as_str().unwrap().to_string();
    assert_ne!(replacement, session_id);
    assert!(
        matches!(opened["action"].as_str(), Some("resumed" | "started")),
        "{opened}"
    );
    let shown = fx.json(&["work", "ticket", "show", "--ticket", "DRG-1"]);
    assert_eq!(shown["sessions"][0]["id"], replacement.as_str());
    assert_eq!(shown["sends"][0]["trigger"], "enter");

    // Manual send with an override message, then clean-up verbs.
    let sent = fx.json(&[
        "work",
        "column",
        "send",
        "--column",
        "Review",
        "--message",
        "Ping {ticket.id}",
    ]);
    assert_eq!(sent["sends"][0]["results"][0]["action"], "sent", "{sent}");
    fx.wait_for(&opened["session"], "you said: Ping DRG-1");
    let updated = fx.json(&[
        "work",
        "ticket",
        "update",
        "--ticket",
        "DRG-1",
        "--pr",
        "none",
        "--title",
        "Resume done",
    ]);
    assert_eq!(updated["prNumber"], Value::Null);
    assert_eq!(updated["title"], "Resume done");
    let list = fx.text(&["work", "ticket", "list", "--column", "review"]);
    assert!(
        list.contains("DRG-1  Resume done") && list.contains("(Review)"),
        "{list}"
    );
    fx.json(&[
        "work",
        "ticket",
        "unlink",
        "--ticket",
        "DRG-1",
        "--session",
        &replacement,
    ]);
    // A session closed for good (record forgotten) cannot be opened: the
    // ticket drops it and says so.
    let gone = fx.json(&[
        "harness",
        "start",
        "--workspace",
        &workspace,
        "--harness",
        "claude",
    ]);
    let gone_id = gone["id"].as_str().unwrap().to_string();
    fx.json(&[
        "work",
        "ticket",
        "link",
        "--ticket",
        "DRG-1",
        "--session",
        &gone_id,
    ]);
    fx.json(&[
        "terminal",
        "close",
        "--session",
        &gone_id,
        "--incarnation",
        gone["incarnation"].as_str().unwrap(),
    ]);
    let refused = fx.command(&[
        "work",
        "ticket",
        "open",
        "--ticket",
        "DRG-1",
        "--session",
        &gone_id,
    ]);
    assert_eq!(refused.status.code(), Some(1));
    assert!(stderr(&refused).contains("closed"), "{}", stderr(&refused));
    assert!(
        fx.json(&["work", "ticket", "show", "--ticket", "DRG-1"])["sessions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    fx.json(&["work", "column", "delete", "--column", "Blocked"]);
    assert!(
        fx.text(&["work", "ticket", "delete", "--ticket", "DRG-1"])
            .contains("Deleted ticket DRG-1.")
    );
    let _ = fx.command(&[
        "terminal",
        "close",
        "--session",
        &replacement,
        "--incarnation",
        opened["session"]["incarnation"].as_str().unwrap(),
    ]);
}

/// The stateful fake Jira (`scripts/fixtures/jira`, agile dataset): no
/// network beyond 127.0.0.1, no real credentials.
struct FakeJira {
    child: Child,
    url: String,
}

impl FakeJira {
    fn start() -> Self {
        use std::io::BufRead as _;
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = root.join("scripts/fixtures/jira/fake-jira-server.mjs");
        let data = root.join("scripts/fixtures/jira/data/agile-site.json");
        let mut child =
            Command::new(std::env::var("DROGON_TEST_NODE").unwrap_or_else(|_| "node".into()))
                .arg(&script)
                .args(["--port", "0", "--data"])
                .arg(&data)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn the fake Jira (node on PATH or DROGON_TEST_NODE)");
        let line = std::io::BufReader::new(child.stdout.take().unwrap())
            .lines()
            .next()
            .expect("LISTEN line")
            .expect("LISTEN read");
        let port = line
            .trim()
            .strip_prefix("LISTEN ")
            .expect("LISTEN")
            .to_string();
        FakeJira {
            child,
            url: format!("http://127.0.0.1:{port}"),
        }
    }

    /// A teammate's change in "Jira".
    fn control(&self, path: &str, body: &str) {
        let status = Command::new("curl")
            .args([
                "-sS",
                "-f",
                "-o",
                "/dev/null",
                "-X",
                "POST",
                "-H",
                "content-type: application/json",
                "-d",
                body,
            ])
            .arg(format!("{}/__fixture/{path}", self.url))
            .status()
            .expect("curl");
        assert!(status.success(), "fixture control {path}");
    }
}

impl Drop for FakeJira {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn a_jira_board_is_imported_synced_and_pushed_from_the_cli() {
    let fx = Fixture::start();
    let jira = FakeJira::start();
    let status = fx.json(&["status"]);
    assert!(
        status["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c == "work.boards.v1"),
        "the drogond next to drogon-cli predates work.boards.v1"
    );
    // Not connected yet: the CLI surfaces the daemon's instruction.
    let refused = fx.command(&["work", "import", "boards"]);
    assert_eq!(refused.status.code(), Some(1));
    assert!(
        stderr(&refused).contains("Connect it from the Tasks page"),
        "{}",
        stderr(&refused)
    );
    let connect = format!(
        "{{\"siteUrl\":\"{}\",\"email\":\"carlos@example.com\",\"apiToken\":\"fixture-token\"}}",
        jira.url
    );
    fx.json(&["rpc", "jira.connect", "--params", &connect]);
    fx.json(&["project", "add", project_path(&fx).to_str().unwrap()]);

    let boards = fx.text(&["work", "import", "boards"]);
    assert!(
        boards.contains("7  Platform Delivery (scrum)  project APP"),
        "{boards}"
    );
    let preview = fx.text(&[
        "work",
        "import",
        "preview",
        "--board",
        "7",
        "--scope",
        "sprint:25",
    ]);
    assert!(preview.contains("Review ← In Review"), "{preview}");
    assert!(
        preview.contains("APP-128  Handle session resume after PR review  [In Review · Sprint 25]"),
        "{preview}"
    );
    let usage = fx.command(&["work", "import", "run", "--board", "7"]);
    assert_eq!(
        usage.status.code(),
        Some(2),
        "choosing issues (or --all) is required"
    );
    let imported = fx.text(&[
        "work",
        "import",
        "run",
        "--board",
        "7",
        "--issue",
        "APP-128",
        "--issue",
        "APP-142",
        "--issue",
        "APP-122",
        "--project",
        "Drogon",
    ]);
    assert!(
        imported.contains("Imported 3 issue(s) into Platform Delivery"),
        "{imported}"
    );

    let listed = fx.text(&["work", "boards"]);
    assert!(
        listed.contains("My work")
            && listed.contains("Platform Delivery  (3 ticket(s))  jira scrum board 7"),
        "{listed}"
    );
    let board = fx.text(&["work", "board", "--board", "7"]);
    assert!(
        board.starts_with("Platform Delivery · Jira · Sprint 25 (active)"),
        "{board}"
    );
    assert!(board.contains("APP-128  Handle session resume after PR review  [Task · Medium · Jon Doe]  carried from Sprint 24"), "{board}");
    let backlog = fx.text(&[
        "work", "ticket", "list", "--board", "7", "--sprint", "backlog",
    ]);
    assert!(
        backlog.contains("APP-122  Clarify retry strategy"),
        "{backlog}"
    );
    let closed = fx.json(&["work", "board", "--board", "7", "--sprint", "Sprint 24"]);
    assert_eq!(closed["view"]["readOnly"], true);

    // A Drogon-only move, pushed; then a column mapping and a conflict.
    let moved = fx.text(&[
        "work", "ticket", "move", "--ticket", "APP-142", "--column", "Review",
    ]);
    assert!(
        moved.contains("(not synced to Jira → In Review)"),
        "{moved}"
    );
    let refused = fx.command(&[
        "work", "ticket", "move", "--ticket", "APP-128", "--column", "QA", "--sprint", "24",
    ]);
    assert!(
        stderr(&refused).contains("Sprint 24 is closed and read-only"),
        "{}",
        stderr(&refused)
    );
    let pushed = fx.text(&["work", "push", "--board", "7"]);
    assert!(
        pushed.contains("Pushed 1, refused 0.") && pushed.contains("APP-142: pushed."),
        "{pushed}"
    );
    let carried = fx.text(&[
        "work", "ticket", "sprint", "--ticket", "APP-122", "--to", "active",
    ]);
    assert!(
        carried.contains("not synced to Jira → Sprint 25"),
        "{carried}"
    );
    assert!(
        fx.text(&["work", "push", "--ticket", "APP-122"])
            .contains("APP-122: pushed.")
    );

    fx.json(&[
        "work", "column", "create", "--board", "7", "--name", "Blocked", "--icon", "blocked",
    ]);
    let mapped = fx.json(&[
        "work",
        "column",
        "update",
        "--column",
        "Blocked",
        "--statuses",
        "Blocked",
    ]);
    assert_eq!(mapped["statuses"][0]["id"], "10102");
    let columns = fx.json(&["work", "column", "list", "--board", "7"]);
    let blocked = columns["columns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "Blocked")
        .unwrap()
        .clone();
    assert_eq!(blocked["statuses"][0]["name"], "Blocked", "{columns}");

    fx.text(&[
        "work", "ticket", "move", "--ticket", "APP-128", "--column", "QA",
    ]);
    jira.control("issue/APP-128", "{\"status\":\"Done\"}");
    let synced = fx.text(&["work", "sync", "--board", "Platform Delivery"]);
    assert!(synced.contains("1 conflict(s)"), "{synced}");
    let shown = fx.text(&["work", "ticket", "show", "--ticket", "APP-128"]);
    assert!(
        shown.contains("(Jira: Done (yours: QA) — resolve)"),
        "{shown}"
    );
    assert!(shown.contains("drogon key: DRG-"), "{shown}");
    assert!(shown.contains("· Sprint 24 — carried over"), "{shown}");
    let bad = fx.command(&[
        "work", "ticket", "resolve", "--ticket", "APP-128", "--keep", "both",
    ]);
    assert_eq!(bad.status.code(), Some(2));
    let resolved = fx.json(&[
        "work", "ticket", "resolve", "--ticket", "APP-128", "--keep", "jira",
    ]);
    assert_eq!(resolved["sync"], "synced");

    // Sessions from the ticket, named on it.
    let started = fx.json(&[
        "work",
        "ticket",
        "new-session",
        "--ticket",
        "APP-128",
        "--harness",
        "claude",
    ]);
    let session = started["session"]["id"].as_str().unwrap().to_string();
    let renamed = fx.text(&[
        "work",
        "ticket",
        "rename-session",
        "--ticket",
        "APP-128",
        "--session",
        &session,
        "--title",
        "Implement",
    ]);
    assert!(renamed.contains("session \"Implement\""), "{renamed}");
    let _ = fx.command(&[
        "terminal",
        "close",
        "--session",
        &session,
        "--incarnation",
        started["session"]["incarnation"].as_str().unwrap(),
    ]);

    let removed = fx.text(&["work", "import", "remove", "--board", "7"]);
    assert!(
        removed.contains("Removed Platform Delivery and its 3 ticket(s)"),
        "{removed}"
    );
    assert!(
        fx.text(&["work", "boards"]).lines().count() == 2,
        "only My work is left"
    );
}

/// The fake Linear/GitHub (`scripts/fixtures/work-sources`), 127.0.0.1 only.
struct FakeSources {
    child: Child,
    url: String,
}

impl FakeSources {
    fn start() -> Self {
        use std::io::BufRead as _;
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let script = root.join("scripts/fixtures/work-sources/fake-sources-server.mjs");
        let mut child =
            Command::new(std::env::var("DROGON_TEST_NODE").unwrap_or_else(|_| "node".into()))
                .arg(&script)
                .args(["--port", "0"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn the fake sources server");
        let line = std::io::BufReader::new(child.stdout.take().unwrap())
            .lines()
            .next()
            .unwrap()
            .unwrap();
        let port = line.trim().strip_prefix("LISTEN ").unwrap().to_string();
        FakeSources {
            child,
            url: format!("http://127.0.0.1:{port}"),
        }
    }
}

impl Drop for FakeSources {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn sources_are_listed_toggled_connected_and_a_linear_team_imported_from_the_cli() {
    let fx = Fixture::start();
    let fake = FakeSources::start();
    let status = fx.json(&["status"]);
    assert!(
        status["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c == "work.sources.v1")
    );

    let listed = fx.text(&["work", "sources"]);
    assert!(
        listed.contains("Jira  not connected (connect Jira on the Tasks page)"),
        "{listed}"
    );
    assert!(listed.contains("Linear  not connected (work source connect --api-key-stdin)  — boards: teams, sprints: cycles"), "{listed}");
    assert!(
        listed.contains("GitHub  not connected (gh auth login"),
        "{listed}"
    );

    let off = fx.text(&["work", "source", "disable", "--provider", "linear"]);
    assert!(off.starts_with("Linear  off"), "{off}");
    let refused = fx.command(&["work", "import", "boards", "--provider", "linear"]);
    assert!(
        stderr(&refused).contains("Linear is turned off for Work"),
        "{}",
        stderr(&refused)
    );
    fx.text(&["work", "source", "enable", "--provider", "linear"]);

    // The key goes in on stdin and never comes back out.
    let api = format!("{}/linear", fake.url);
    let bad = fx.text_with_stdin(
        &[
            "work",
            "source",
            "connect",
            "--provider",
            "linear",
            "--api-key-stdin",
            "--api-url",
            &api,
        ],
        "lin_api_wrong\n",
    );
    assert_eq!(bad.status.code(), Some(1));
    assert!(
        stderr(&bad).contains("Authentication required"),
        "{}",
        stderr(&bad)
    );
    let empty = fx.text_with_stdin(
        &[
            "work",
            "source",
            "connect",
            "--provider",
            "linear",
            "--api-key-stdin",
        ],
        "\n",
    );
    assert_eq!(empty.status.code(), Some(2));
    let connected = fx.text_with_stdin(
        &[
            "work",
            "source",
            "connect",
            "--provider",
            "linear",
            "--api-key-stdin",
            "--api-url",
            &api,
        ],
        "lin_api_fixture\n",
    );
    assert!(connected.status.success(), "{}", stderr(&connected));
    let out = stdout(&connected);
    assert!(
        out.contains("Linear  connected as Jon Doe · Drogon Fixture"),
        "{out}"
    );
    assert!(!out.contains("lin_api_fixture"));

    let teams = fx.text(&["work", "import", "boards", "--provider", "linear"]);
    assert!(
        teams.contains("team-eng  Engineering (scrum)  project ENG"),
        "{teams}"
    );
    fx.json(&["project", "add", project_path(&fx).to_str().unwrap()]);
    let imported = fx.text(&[
        "work",
        "import",
        "run",
        "--provider",
        "linear",
        "--board",
        "team-eng",
        "--issue",
        "ENG-1",
        "--issue",
        "ENG-2",
        "--project",
        "Drogon",
    ]);
    assert!(
        imported.contains("Imported 2 issue(s) into Engineering"),
        "{imported}"
    );
    let board = fx.text(&["work", "board", "--board", "Engineering"]);
    assert!(
        board.starts_with("Engineering · Linear · Cycle 12 · Resume polish (active)"),
        "{board}"
    );
    assert!(
        board.contains("ENG-1  Resume Linear sessions after review  [backend · High · Jon Doe]"),
        "{board}"
    );
    let moved = fx.text(&[
        "work",
        "ticket",
        "move",
        "--ticket",
        "ENG-2",
        "--column",
        "In Progress",
        "--sprint",
        "cy-12",
    ]);
    assert!(
        moved.contains("(not synced to Linear → In Progress)"),
        "{moved}"
    );
    assert!(
        fx.text(&["work", "push", "--ticket", "ENG-2"])
            .contains("ENG-2: pushed.")
    );
    assert!(fx.text(&["work", "sources"]).contains("Linear  connected as Jon Doe · Drogon Fixture  — boards: teams, sprints: cycles, 1 imported"));

    let resolve = fx.command(&[
        "work", "ticket", "resolve", "--ticket", "ENG-2", "--keep", "maybe",
    ]);
    assert_eq!(resolve.status.code(), Some(2));
    let gone = fx.text(&["work", "source", "disconnect", "--provider", "linear"]);
    assert!(gone.contains("Linear  not connected"), "{gone}");
    let github = fx.command(&["work", "source", "connect", "--provider", "github"]);
    assert!(
        stderr(&github).contains("No GitHub login"),
        "{}",
        stderr(&github)
    );
}
