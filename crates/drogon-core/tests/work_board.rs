//! The Work board (`work.*`) through the public `Engine` API, against a real
//! SQLite file and real PTYs. Harness sessions are a shell fixture named
//! `claude` on PATH that echoes its argv and every stdin line, so delivery,
//! resume and fresh starts are observed in real session output. `gh` is
//! faked by binary path through `tasks_rpc::set_gh_bin_override`.
//!
//! Unix-only, like every PTY-backed test in this crate.

#![cfg(unix)]

use std::io::Write as _;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_core::tasks_rpc;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// PATH, CLAUDE_CONFIG_DIR and the gh override are process-global.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: unique(method),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

fn err(engine: &Engine, method: &str, params: Value) -> String {
    let response = call(engine, method, params);
    assert!(
        !response.ok,
        "{method} unexpectedly succeeded: {:?}",
        response.result
    );
    response.error.unwrap().message
}

fn unique(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    format!("{prefix}-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}

fn output_of(engine: &Engine, session: &Value) -> String {
    let read = ok(
        engine,
        "session.read",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0}),
    );
    String::from_utf8_lossy(&base64_decode(read["dataBase64"].as_str().unwrap())).into_owned()
}

fn wait_for_output(engine: &Engine, session: &Value, needle: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let text = output_of(engine, session);
        if text.contains(needle) {
            return text;
        }
        assert!(
            Instant::now() < deadline,
            "never saw {needle:?} in:\n{text}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn session_row(engine: &Engine, id: &str) -> Value {
    ok(engine, "session.list", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == id)
        .cloned()
        .unwrap_or_else(|| panic!("session {id} not listed"))
}

/// A `claude` stand-in: echoes argv, then every stdin line, and stays alive
/// like a TUI until stdin closes (so dropping the engine reaps it).
fn fake_harness_dir() -> PathBuf {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("claude");
    let mut script = std::fs::File::create(&path).unwrap();
    script
        .write_all(b"#!/bin/sh\nfor arg in \"$@\"; do echo \"ARG:$arg\"; done\nwhile IFS= read -r line; do echo \"you said: $line\"; done\n")
        .unwrap();
    drop(script);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    dir.keep()
}

struct Env {
    previous: Vec<(String, Option<std::ffi::OsString>)>,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Env {
    fn set(vars: &[(&str, &Path)]) -> Self {
        let guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let mut previous = Vec::new();
        for (key, value) in vars {
            previous.push(((*key).to_string(), std::env::var_os(key)));
            let value = if *key == "PATH" {
                std::env::join_paths(
                    std::iter::once(value.to_path_buf()).chain(
                        std::env::var_os("PATH")
                            .as_ref()
                            .map(std::env::split_paths)
                            .into_iter()
                            .flatten(),
                    ),
                )
                .unwrap()
            } else {
                value.as_os_str().to_owned()
            };
            unsafe { std::env::set_var(key, value) };
        }
        Env {
            previous,
            _guard: guard,
        }
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        tasks_rpc::set_gh_bin_override(None);
        for (key, value) in self.previous.drain(..) {
            match value {
                Some(v) => unsafe { std::env::set_var(&key, v) },
                None => unsafe { std::env::remove_var(&key) },
            }
        }
    }
}

struct Fixture {
    _root: tempfile::TempDir,
    _env: Env,
    engine: Engine,
    project_dir: PathBuf,
    config_root: PathBuf,
    project_id: String,
    workspace_id: String,
}

impl Fixture {
    /// A folder Project named `Drogon` (tickets key as `DRG-n`) whose
    /// implicit workspace is where fresh ticket sessions start.
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let project_dir = root.path().join("Drogon");
        std::fs::create_dir_all(&project_dir).unwrap();
        let config_root = root.path().join("claude-config");
        std::fs::create_dir_all(&config_root).unwrap();
        let bin = fake_harness_dir();
        let env = Env::set(&[("PATH", &bin), ("CLAUDE_CONFIG_DIR", &config_root)]);
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let project = ok(
            &engine,
            "project.add",
            json!({"path": project_dir.to_str().unwrap()}),
        );
        let project_id = project["id"].as_str().unwrap().to_string();
        let worktrees = ok(&engine, "worktree.list", json!({"projectId": project_id}));
        let workspace_id = worktrees["worktrees"][0]["workspaceId"]
            .as_str()
            .unwrap()
            .to_string();
        Fixture {
            _root: root,
            _env: env,
            engine,
            project_dir,
            config_root,
            project_id,
            workspace_id,
        }
    }

    fn column(&self, name: &str) -> Value {
        ok(&self.engine, "work.board", json!({}))["columns"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == name)
            .cloned()
            .unwrap_or_else(|| panic!("column {name} missing"))
    }

    fn ticket(&self, title: &str, column: &str) -> Value {
        ok(
            &self.engine,
            "work.ticket_create",
            json!({"title": title, "projectId": self.project_id, "columnId": column, "prUrl": "#7"}),
        )
    }

    fn launch_claude(&self) -> Value {
        ok(
            &self.engine,
            "harness.start",
            json!({"workspaceId": self.workspace_id, "harnessId": "claude", "permissionMode": "inherit"}),
        )
    }

    fn prompt_column(&self, name: &str, message: &str) -> Value {
        let column = self.column(name);
        ok(
            &self.engine,
            "work.column_update",
            json!({"columnId": column["id"], "sendOnEnter": true, "message": message}),
        )
    }

    fn stop(&self, session: &Value) {
        let stopped = ok(
            &self.engine,
            "session.stop",
            json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
        );
        assert_eq!(stopped["verdict"], "exited");
    }

    /// Puts a conversation for the project folder in the fake Claude store,
    /// so a resume continues it instead of falling back to a fresh start.
    fn remember_conversation(&self) {
        let dir = self
            .config_root
            .join("projects")
            .join(drogon_harness::claude_project_dir_name(&self.project_dir));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("conversation.jsonl"), "{}\n").unwrap();
        let canonical = self.project_dir.canonicalize().unwrap();
        let dir = self
            .config_root
            .join("projects")
            .join(drogon_harness::claude_project_dir_name(&canonical));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("conversation.jsonl"), "{}\n").unwrap();
    }
}

fn linked_ids(ticket: &Value) -> Vec<String> {
    ticket["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn the_board_seeds_default_columns_and_manages_them() {
    let fx = Fixture::new();
    let board = ok(&fx.engine, "work.board", json!({}));
    let names: Vec<&str> = board["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["To do", "In progress", "Review", "QA", "Done"]);
    assert!(
        board["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "Drogon")
    );

    let blocked = ok(
        &fx.engine,
        "work.column_create",
        json!({"name": "Blocked", "icon": "blocked", "index": 1}),
    );
    assert_eq!(blocked["position"], 1);
    assert!(
        err(&fx.engine, "work.column_create", json!({"name": "blocked"}))
            .contains("already exists")
    );
    assert!(
        err(
            &fx.engine,
            "work.column_create",
            json!({"name": "X", "icon": "nope"})
        )
        .contains("icon")
    );

    let updated = ok(
        &fx.engine,
        "work.column_update",
        json!({"columnId": "Blocked", "name": "Waiting", "cron": "15m", "prWatch": true,
               "message": "Check {ticket.id}", "recipients": "primary", "harnessId": "pi", "index": 4}),
    );
    assert_eq!(updated["name"], "Waiting");
    assert_eq!(updated["cron"], "*/15 * * * *");
    assert!(updated["nextRunAt"].as_i64().unwrap() > 0);
    assert_eq!(updated["recipients"], "primary");
    assert_eq!(updated["harnessId"], "pi");
    assert_eq!(updated["position"], 4);
    let cleared = ok(
        &fx.engine,
        "work.column_update",
        json!({"columnId": updated["id"], "cron": null, "harnessId": null}),
    );
    assert_eq!(cleared["cron"], Value::Null);
    assert_eq!(cleared["nextRunAt"], Value::Null);
    assert_eq!(cleared["harnessId"], Value::Null);

    // A column holding tickets cannot be dropped without a destination.
    let ticket = fx.ticket("Stuck", "Waiting");
    assert!(
        err(
            &fx.engine,
            "work.column_delete",
            json!({"columnId": "Waiting"})
        )
        .contains("moveTicketsTo")
    );
    let deleted = ok(
        &fx.engine,
        "work.column_delete",
        json!({"columnId": "Waiting", "moveTicketsTo": "To do"}),
    );
    assert_eq!(deleted["movedTickets"], 1);
    let moved = ok(
        &fx.engine,
        "work.ticket_show",
        json!({"ticketId": ticket["id"]}),
    );
    assert_eq!(moved["columnId"], fx.column("To do")["id"]);
}

#[test]
fn tickets_carry_project_keys_links_and_order() {
    let fx = Fixture::new();
    let first = fx.ticket("Plan the personal workspace", "To do");
    let second = ok(
        &fx.engine,
        "work.ticket_create",
        json!({"title": "Improve Jira resume", "projectId": fx.project_id, "columnId": "To do",
               "prUrl": "https://github.com/clioo/drogon/pull/648",
               "sourceUrl": "https://jira.example.com/browse/DRG-9", "nextStep": "Choose the scope"}),
    );
    let loose = ok(
        &fx.engine,
        "work.ticket_create",
        json!({"title": "No project yet"}),
    );
    assert_eq!(first["key"], "DRG-1");
    assert_eq!(second["key"], "DRG-2");
    assert_eq!(loose["key"], "WRK-1");
    assert_eq!(second["prNumber"], 648);
    assert_eq!(second["prUrl"], "https://github.com/clioo/drogon/pull/648");
    assert_eq!(second["sourceUrl"], "https://jira.example.com/browse/DRG-9");
    assert_eq!(second["projectName"], "Drogon");
    assert!(
        err(
            &fx.engine,
            "work.ticket_create",
            json!({"title": "x", "sourceUrl": "file:///etc/passwd"})
        )
        .contains("sourceUrl")
    );

    // Keys resolve case-insensitively; moves reorder within and across columns.
    let shown = ok(&fx.engine, "work.ticket_show", json!({"ticketId": "drg-2"}));
    assert_eq!(shown["id"], second["id"]);
    ok(
        &fx.engine,
        "work.ticket_move",
        json!({"ticketId": "DRG-2", "columnId": "To do", "index": 0}),
    );
    let order = |column: &str| -> Vec<String> {
        let board = ok(&fx.engine, "work.board", json!({}));
        let id = fx.column(column)["id"].clone();
        let mut tickets: Vec<&Value> = board["tickets"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["columnId"] == id)
            .collect();
        tickets.sort_by_key(|t| t["position"].as_i64().unwrap());
        tickets
            .iter()
            .map(|t| t["key"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(order("To do"), ["DRG-2", "DRG-1", "WRK-1"]);
    let moved = ok(
        &fx.engine,
        "work.ticket_move",
        json!({"ticketId": "DRG-1", "columnId": "In progress"}),
    );
    assert_eq!(
        moved["delivery"],
        Value::Null,
        "no prompt configured, nothing delivered"
    );
    assert_eq!(order("To do"), ["DRG-2", "WRK-1"]);
    assert_eq!(order("In progress"), ["DRG-1"]);

    let updated = ok(
        &fx.engine,
        "work.ticket_update",
        json!({"ticketId": "DRG-2", "title": "Improve Jira resume v2", "prUrl": null, "sourceUrl": ""}),
    );
    assert_eq!(updated["title"], "Improve Jira resume v2");
    assert_eq!(updated["prNumber"], Value::Null);
    assert_eq!(updated["sourceUrl"], Value::Null);

    // The project filter narrows the board; links need a real session.
    let filtered = ok(
        &fx.engine,
        "work.board",
        json!({"projectId": fx.project_id}),
    );
    assert_eq!(filtered["tickets"].as_array().unwrap().len(), 2);
    assert!(
        err(
            &fx.engine,
            "work.ticket_link_session",
            json!({"ticketId": "DRG-1", "sessionId": "nope"})
        )
        .contains("not found")
    );
    let deleted = ok(
        &fx.engine,
        "work.ticket_delete",
        json!({"ticketId": "WRK-1"}),
    );
    assert_eq!(deleted["key"], "WRK-1");
    assert!(
        err(&fx.engine, "work.ticket_show", json!({"ticketId": "WRK-1"})).contains("not found")
    );
}

#[test]
fn entering_a_column_types_its_prompt_into_every_live_linked_session() {
    let fx = Fixture::new();
    fx.prompt_column(
        "Review",
        "Review {ticket.pr} for {ticket.id}: {ticket.title}",
    );
    let ticket = fx.ticket("Improve Jira resume", "In progress");
    let first = fx.launch_claude();
    let second = fx.launch_claude();
    for session in [&first, &second] {
        ok(
            &fx.engine,
            "work.ticket_link_session",
            json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
        );
    }
    let moved = ok(
        &fx.engine,
        "work.ticket_move",
        json!({"ticketId": ticket["key"], "columnId": "Review"}),
    );
    let results = moved["delivery"]["results"].as_array().unwrap();
    assert_eq!(results.len(), 2, "{moved}");
    assert!(results.iter().all(|r| r["action"] == "sent"), "{results:?}");
    assert_eq!(
        moved["delivery"]["message"],
        "Review PR #7 for DRG-1: Improve Jira resume"
    );
    for session in [&first, &second] {
        wait_for_output(
            &fx.engine,
            session,
            "you said: Review PR #7 for DRG-1: Improve Jira resume",
        );
    }
    // The links are unchanged: live sessions are typed into, never replaced.
    let after = ok(
        &fx.engine,
        "work.ticket_show",
        json!({"ticketId": ticket["id"]}),
    );
    assert_eq!(
        linked_ids(&after),
        [
            first["id"].as_str().unwrap(),
            second["id"].as_str().unwrap()
        ]
    );
    assert_eq!(after["sends"][0]["trigger"], "enter");
    let column = fx.column("Review");
    assert_eq!(column["lastSentCount"], 2);
    assert!(column["lastSentAt"].as_i64().unwrap() > 0);

    // A move within the same column is not "entering" it.
    let reordered = ok(
        &fx.engine,
        "work.ticket_move",
        json!({"ticketId": ticket["id"], "columnId": "Review", "index": 0}),
    );
    assert_eq!(reordered["delivery"], Value::Null);

    // "Primary" sends only to the first linked session.
    ok(
        &fx.engine,
        "work.column_update",
        json!({"columnId": "Review", "recipients": "primary", "message": "Only the primary {ticket.id}"}),
    );
    let sent = ok(
        &fx.engine,
        "work.column_send",
        json!({"columnId": "Review"}),
    );
    let results = sent["sends"][0]["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["sessionId"], first["id"]);
    wait_for_output(&fx.engine, &first, "you said: Only the primary DRG-1");
    assert!(!output_of(&fx.engine, &second).contains("Only the primary"));
}

#[test]
fn a_session_that_is_no_longer_live_is_resumed_with_the_prompt_and_relinked() {
    let fx = Fixture::new();
    fx.remember_conversation();
    fx.prompt_column("QA", "QA {ticket.id} now");
    let ticket = fx.ticket("Update setup notes", "Review");
    let session = fx.launch_claude();
    ok(
        &fx.engine,
        "work.ticket_link_session",
        json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
    );
    fx.stop(&session);

    let moved = ok(
        &fx.engine,
        "work.ticket_move",
        json!({"ticketId": ticket["id"], "columnId": "QA"}),
    );
    let result = &moved["delivery"]["results"][0];
    assert_eq!(result["action"], "resumed", "{moved}");
    assert_eq!(result["sessionId"], session["id"]);
    let replacement_id = result["newSessionId"].as_str().unwrap().to_string();
    assert_ne!(replacement_id, session["id"].as_str().unwrap());
    let replacement = session_row(&fx.engine, &replacement_id);
    let args: Vec<&str> = replacement["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap())
        .collect();
    assert!(
        args.contains(&"--continue"),
        "resume must continue the conversation: {args:?}"
    );
    assert!(
        args.contains(&"QA DRG-1 now"),
        "the prompt rides the resumed launch: {args:?}"
    );
    wait_for_output(&fx.engine, &replacement, "ARG:QA DRG-1 now");
    // The replacement took the stopped session's place on the ticket.
    let after = ok(
        &fx.engine,
        "work.ticket_show",
        json!({"ticketId": ticket["id"]}),
    );
    assert_eq!(linked_ids(&after), std::slice::from_ref(&replacement_id));
    assert_eq!(after["sessions"][0]["verdict"], "live");
}

#[test]
fn with_nothing_to_resume_a_fresh_session_is_started_and_linked() {
    let fx = Fixture::new();
    fx.prompt_column("In progress", "Start {ticket.id}: {ticket.title}");
    let ticket = fx.ticket("Confirm release scope", "To do");
    assert!(ticket["sessions"].as_array().unwrap().is_empty());
    let moved = ok(
        &fx.engine,
        "work.ticket_move",
        json!({"ticketId": ticket["id"], "columnId": "In progress"}),
    );
    let result = &moved["delivery"]["results"][0];
    assert_eq!(result["action"], "started", "{moved}");
    assert_eq!(result["harnessId"], "claude");
    let started = session_row(&fx.engine, result["newSessionId"].as_str().unwrap());
    assert_eq!(
        started["workspaceId"],
        fx.workspace_id.as_str(),
        "starts in the project's workspace"
    );
    wait_for_output(
        &fx.engine,
        &started,
        "ARG:Start DRG-1: Confirm release scope",
    );
    let after = ok(
        &fx.engine,
        "work.ticket_show",
        json!({"ticketId": ticket["id"]}),
    );
    assert_eq!(
        linked_ids(&after),
        [result["newSessionId"].as_str().unwrap()]
    );
    assert_eq!(after["workspaceId"], fx.workspace_id.as_str());

    // A stopped session with no conversation to resume also starts fresh,
    // still in the stopped one's place.
    fx.stop(&started);
    let sent = ok(
        &fx.engine,
        "work.column_send",
        json!({"ticketId": ticket["id"]}),
    );
    let again = &sent["sends"][0]["results"][0];
    assert_eq!(again["action"], "started", "{sent}");
    let after = ok(
        &fx.engine,
        "work.ticket_show",
        json!({"ticketId": ticket["id"]}),
    );
    assert_eq!(
        linked_ids(&after),
        [again["newSessionId"].as_str().unwrap()]
    );

    // Without any workspace or project there is nowhere to start one.
    let loose = ok(
        &fx.engine,
        "work.ticket_create",
        json!({"title": "Nowhere"}),
    );
    let sent = ok(
        &fx.engine,
        "work.column_send",
        json!({"columnId": "In progress", "ticketId": loose["id"]}),
    );
    assert_eq!(sent["sends"][0]["results"][0]["action"], "skipped");
}

#[test]
fn preview_names_each_recipient_and_what_will_happen() {
    let fx = Fixture::new();
    let ticket = fx.ticket("Preview me", "Review");
    fx.prompt_column("Review", "Review {ticket.id}");
    let live = fx.launch_claude();
    let stopped = fx.launch_claude();
    for session in [&live, &stopped] {
        ok(
            &fx.engine,
            "work.ticket_link_session",
            json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
        );
    }
    fx.stop(&stopped);
    let preview = ok(
        &fx.engine,
        "work.column_preview",
        json!({"columnId": "Review"}),
    );
    let entry = &preview["previews"][0];
    assert_eq!(entry["message"], "Review DRG-1");
    // {column.next} names the column after this one ({ticket.status} is
    // the column itself on My work); the last column names itself.
    let next = ok(
        &fx.engine,
        "work.column_preview",
        json!({"columnId": "Review", "message": "Move {ticket.key} from {ticket.status} to {column.next}"}),
    );
    assert_eq!(
        next["previews"][0]["message"],
        "Move DRG-1 from Review to QA"
    );
    let last = ok(
        &fx.engine,
        "work.ticket_create",
        json!({"title": "Shipped", "columnId": "Done"}),
    );
    let done = ok(
        &fx.engine,
        "work.column_preview",
        json!({"columnId": "Done", "ticketId": last["id"], "message": "{column.next}"}),
    );
    assert_eq!(done["previews"][0]["message"], "Done");
    let actions: Vec<&str> = entry["recipients"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["action"].as_str().unwrap())
        .collect();
    assert_eq!(actions, ["send", "resume"]);
    // Preview changes nothing.
    assert!(
        ok(&fx.engine, "work.sends", json!({"columnId": "Review"}))["sends"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(!output_of(&fx.engine, &live).contains("you said: Review"));
    assert!(
        err(&fx.engine, "work.column_send", json!({"columnId": "Done"})).contains("no message")
    );
}

#[test]
fn opening_a_ticket_session_resumes_it_and_terminal_resumes_relink_too() {
    let fx = Fixture::new();
    fx.remember_conversation();
    let ticket = fx.ticket("Resume me", "In progress");
    let session = fx.launch_claude();
    ok(
        &fx.engine,
        "work.ticket_link_session",
        json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
    );
    let opened = ok(
        &fx.engine,
        "work.session_open",
        json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
    );
    assert_eq!(opened["action"], "open");
    assert_eq!(opened["session"]["id"], session["id"]);

    fx.stop(&session);
    let opened = ok(
        &fx.engine,
        "work.session_open",
        json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
    );
    assert_eq!(opened["action"], "resumed", "{opened}");
    let replacement = opened["session"].clone();
    assert_eq!(replacement["verdict"], "live");
    let after = ok(
        &fx.engine,
        "work.ticket_show",
        json!({"ticketId": ticket["id"]}),
    );
    assert_eq!(linked_ids(&after), [replacement["id"].as_str().unwrap()]);

    // The terminal pane's own restart (harness.start with resumeSessionId)
    // is the same boundary: the ticket follows that replacement as well.
    fx.stop(&replacement);
    let restarted = ok(
        &fx.engine,
        "harness.start",
        json!({"workspaceId": fx.workspace_id, "harnessId": "claude", "permissionMode": "inherit",
               "resume": true, "resumeSessionId": replacement["id"]}),
    );
    let after = ok(
        &fx.engine,
        "work.ticket_show",
        json!({"ticketId": ticket["id"]}),
    );
    assert_eq!(linked_ids(&after), [restarted["id"].as_str().unwrap()]);
    assert!(
        err(
            &fx.engine,
            "work.session_open",
            json!({"ticketId": ticket["id"], "sessionId": "other"})
        )
        .contains("not linked")
    );
    let unlinked = ok(
        &fx.engine,
        "work.ticket_unlink_session",
        json!({"ticketId": ticket["id"], "sessionId": restarted["id"]}),
    );
    assert!(unlinked["sessions"].as_array().unwrap().is_empty());
}

#[test]
fn a_scheduled_column_sends_to_its_tickets_on_the_scheduler_tick() {
    let fx = Fixture::new();
    let ticket = fx.ticket("Nightly check", "Review");
    let session = fx.launch_claude();
    ok(
        &fx.engine,
        "work.ticket_link_session",
        json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
    );
    let column = ok(
        &fx.engine,
        "work.column_update",
        json!({"columnId": "Review", "cron": "15m", "message": "Scheduled check for {ticket.id}"}),
    );
    let due = column["nextRunAt"].as_i64().unwrap();
    // Before it is due nothing happens.
    drogon_core::automations::scheduler::tick_once(&fx.engine, (due - 1000) as f64);
    assert!(
        ok(&fx.engine, "work.sends", json!({"columnId": "Review"}))["sends"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    drogon_core::automations::scheduler::tick_once(&fx.engine, (due + 1000) as f64);
    let sends = ok(&fx.engine, "work.sends", json!({"columnId": "Review"}));
    assert_eq!(sends["sends"][0]["trigger"], "schedule");
    assert_eq!(sends["sends"][0]["ticketKey"], "DRG-1");
    wait_for_output(&fx.engine, &session, "you said: Scheduled check for DRG-1");
    let next = fx.column("Review")["nextRunAt"].as_i64().unwrap();
    assert!(
        next > due,
        "the schedule advances past the run it just made"
    );
    // The same tick again does not repeat the send.
    drogon_core::automations::scheduler::tick_once(&fx.engine, (due + 2000) as f64);
    assert_eq!(
        ok(&fx.engine, "work.sends", json!({"columnId": "Review"}))["sends"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn a_pr_watch_sends_when_the_pull_request_changes() {
    let fx = Fixture::new();
    // A git project with a GitHub origin, so `gh pr view` has a repo.
    let repo = fx.project_dir.parent().unwrap().join("repo");
    std::fs::create_dir_all(&repo).unwrap();
    let git = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(&repo)
                .status()
                .unwrap()
                .success()
        );
    };
    git(&["init", "-q", "-b", "main"]);
    git(&[
        "-c",
        "user.email=f@x",
        "-c",
        "user.name=f",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init",
    ]);
    git(&[
        "remote",
        "add",
        "origin",
        "https://github.com/example/repo.git",
    ]);
    let project = ok(
        &fx.engine,
        "project.add",
        json!({"path": repo.to_str().unwrap()}),
    );
    let state = fx.project_dir.parent().unwrap().join("pr-state");
    std::fs::write(&state, "OPEN").unwrap();
    let gh = fx.project_dir.parent().unwrap().join("gh-fake");
    std::fs::write(
        &gh,
        format!(
            "#!/bin/sh\nif [ \"$1\" = pr ] && [ \"$2\" = view ]; then\nS=$(cat '{}')\n\
             printf '{{\"number\":7,\"title\":\"t\",\"state\":\"%s\",\"isDraft\":false,\"labels\":[],\"assignees\":[],\
             \"author\":{{\"login\":\"a\"}},\"reviewDecision\":\"\",\"statusCheckRollup\":[],\"mergeable\":\"MERGEABLE\",\
             \"headRefName\":\"f\",\"baseRefName\":\"main\",\"updatedAt\":\"2026-09-20T10:00:00Z\",\
             \"url\":\"https://github.com/example/repo/pull/7\"}}' \"$S\"\nelse\nexit 1\nfi\n",
            state.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();
    tasks_rpc::set_gh_bin_override(Some(gh));

    let ticket = ok(
        &fx.engine,
        "work.ticket_create",
        json!({"title": "Watch me", "projectId": project["id"], "columnId": "Review", "prUrl": "7",
               "workspaceId": fx.workspace_id}),
    );
    let session = fx.launch_claude();
    ok(
        &fx.engine,
        "work.ticket_link_session",
        json!({"ticketId": ticket["id"], "sessionId": session["id"]}),
    );
    ok(
        &fx.engine,
        "work.column_update",
        json!({"columnId": "Review", "prWatch": true, "message": "PR {ticket.pr} changed for {ticket.id}"}),
    );

    let t0 = 2_000_000_000_000_f64;
    // The first read only records a baseline.
    drogon_core::automations::scheduler::tick_once(&fx.engine, t0);
    assert!(
        ok(&fx.engine, "work.sends", json!({"columnId": "Review"}))["sends"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    // Unchanged after the poll interval: still nothing.
    drogon_core::automations::scheduler::tick_once(&fx.engine, t0 + 6.0 * 60_000.0);
    assert!(
        ok(&fx.engine, "work.sends", json!({"columnId": "Review"}))["sends"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    // Merged: the next poll sends.
    std::fs::write(&state, "MERGED").unwrap();
    drogon_core::automations::scheduler::tick_once(&fx.engine, t0 + 7.0 * 60_000.0);
    assert!(
        ok(&fx.engine, "work.sends", json!({"columnId": "Review"}))["sends"]
            .as_array()
            .unwrap()
            .is_empty(),
        "polls are spaced by the PR interval"
    );
    drogon_core::automations::scheduler::tick_once(&fx.engine, t0 + 12.0 * 60_000.0);
    let sends = ok(&fx.engine, "work.sends", json!({"columnId": "Review"}));
    assert_eq!(sends["sends"][0]["trigger"], "pr_change", "{sends}");
    let key = ticket["key"].as_str().unwrap();
    wait_for_output(
        &fx.engine,
        &session,
        &format!("you said: PR PR #7 changed for {key}"),
    );
}
