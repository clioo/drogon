//! Regression for the owner's "no puedo darle click en resume session": a
//! Bot created while a worktree was selected keeps that worktree's folder as
//! its RECORD folder. Removing the worktree deletes its `workspaces` row, and
//! from then on every `bot.run` for the Bot -- Open session included -- was
//! refused because the folder had no workspace id, although the session never
//! runs there: it runs in the Bot's own provisioned home, which is still
//! registered. The monitor column on the same card failed the same way.
//!
//! The state is built through the product's own path, the way the owner hit
//! it: open the Bot's session, let the harness report its conversation, close
//! the session and forget its row, then remove the project the Bot was
//! created in. The click then sends what the Bots page sends (`workspaceId:
//! ""`, `interactive: true`, `resume: true`).
//!
//! A fixture `claude` script on `PATH` stands in for the harness: no paid
//! inference, no installed agent.
#![cfg(unix)]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// Every test here mutates the process `PATH` and `CLAUDE_CONFIG_DIR`.
static ENV_LOCK: Mutex<()> = Mutex::new(());

const PROVIDER_ID: &str = "4b1f0c9e-2d3a-4e5f-8a6b-7c8d9e0f1a2b";

fn req(method: &str, request_id: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err(response: Response) -> drogon_protocol::RpcError {
    assert!(!response.ok, "{response:?}");
    response.error.unwrap()
}

struct SavedEnv {
    key: &'static str,
    value: Option<std::ffi::OsString>,
}
impl SavedEnv {
    fn capture(key: &'static str) -> Self {
        Self {
            key,
            value: std::env::var_os(key),
        }
    }
}
impl Drop for SavedEnv {
    fn drop(&mut self) {
        match self.value.take() {
            Some(value) => unsafe { std::env::set_var(self.key, value) },
            None => unsafe { std::env::remove_var(self.key) },
        }
    }
}

/// A `claude` stand-in that keeps a per-directory conversation and honours
/// `--resume <id>` the way the real CLI does, so `RESUMED:<id>` plus the
/// stored turn proves the reopen named the right conversation in the right
/// directory. It blocks on stdin afterwards, like an idle interactive TUI.
fn install_claude_fixture(bin: &std::path::Path) {
    let script = bin.join("claude");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
echo "CWD=$(pwd)"
for arg in "$@"; do echo "ARG:$arg"; done
case "$*" in
  *--resume*)
    for arg in "$@"; do
      if [ "$previous" = "--resume" ]; then resume_id="$arg"; fi
      previous="$arg"
    done
    echo "RESUMED:${{resume_id}}"
    if [ -f ".drogon-conversation-${{resume_id}}" ]; then
      echo "CONVERSATION:$(cat .drogon-conversation-${{resume_id}})"
    else
      echo "NO SUCH CONVERSATION"
    fi
    ;;
  *)
    echo "the first turn of {PROVIDER_ID}" > .drogon-conversation-{PROVIDER_ID}
    echo "CONVERSATION:$(cat .drogon-conversation-{PROVIDER_ID})"
    ;;
esac
trap 'exit 0' TERM INT
while IFS= read -r line; do echo "you said: $line"; done
"#
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut paths =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect::<Vec<_>>();
    paths.insert(0, bin.to_path_buf());
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };
}

fn read_until(
    engine: &Engine,
    session_id: &str,
    incarnation: &str,
    ready: impl Fn(&str) -> bool,
) -> (String, String) {
    use base64::Engine as _;
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut cursor = 0u64;
    let mut text = String::new();
    let mut verdict = "live".to_string();
    while Instant::now() < deadline {
        let read = ok(
            engine,
            "session.read",
            &uuid::Uuid::new_v4().to_string(),
            json!({"sessionId": session_id, "incarnation": incarnation, "cursor": cursor}),
        );
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(read["dataBase64"].as_str().unwrap())
            .unwrap();
        text.push_str(&String::from_utf8_lossy(&bytes));
        cursor = read["nextCursor"].as_u64().unwrap();
        verdict = read["session"]["verdict"].as_str().unwrap().to_string();
        if verdict == "exited" || ready(&text) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    (text, verdict)
}

struct Fx {
    root: tempfile::TempDir,
    engine: Engine,
    host_id: String,
    project_id: String,
    bot_id: String,
}

impl Fx {
    /// A folder project, the Bot created while it was selected.
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("some-feature");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let project = ok(
            &engine,
            "project.add",
            "add-project",
            json!({"path": folder}),
        );
        let project_id = project["id"].as_str().unwrap().to_string();
        let workspace = ok(
            &engine,
            "workspace.register",
            "register",
            json!({"path": folder}),
        );
        let workspace_id = workspace["id"].as_str().unwrap().to_string();
        let host_id = workspace["hostId"].as_str().unwrap().to_string();
        let bot = ok(
            &engine,
            "bot.create",
            "create",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "body": {
                    "characterPreset": "jon-snow",
                    "displayIdentity": {
                        "displayName": "Jon Snow",
                        "handle": "jon-snow",
                        "title": null
                    },
                    "harnessPolicy": {"defaultHarness": "claude", "explicitModel": null},
                    "instructions": "Watch the wall.",
                    "memories": []
                },
            }),
        );
        let bot_id = bot["id"].as_str().unwrap().to_string();
        Self {
            root,
            engine,
            host_id,
            project_id,
            bot_id,
        }
    }

    /// Exactly what the app-global Bots page sends for "Open session".
    fn open_session(&self, request_id: &str, resume: bool) -> Response {
        let mut params = json!({
            "workspaceId": "",
            "hostId": self.host_id,
            "botId": self.bot_id,
            "interactive": true,
            "harness": {"harnessId": "claude"},
        });
        if resume {
            params["resume"] = json!(true);
        }
        self.engine.dispatch(req("bot.run", request_id, params))
    }

    fn snapshot_bot(&self, request_id: &str) -> Value {
        let snapshot = ok(
            &self.engine,
            "bot.snapshot",
            request_id,
            json!({"workspaceId": "", "hostId": self.host_id, "locale": "en"}),
        );
        snapshot["bots"]
            .as_array()
            .unwrap()
            .iter()
            .find(|bot| bot["id"] == self.bot_id.as_str())
            .cloned()
            .expect("the Bot is still in the app-global snapshot")
    }

    fn monitor_list(&self, request_id: &str) -> Response {
        self.engine.dispatch(req(
            "bot.monitor_list",
            request_id,
            json!({"workspaceId": "", "hostId": self.host_id, "botId": self.bot_id}),
        ))
    }

    /// Removing the project deletes its `workspaces` row; the Bot row, keyed
    /// by folder path, stays where it was.
    fn remove_project(&self) {
        ok(
            &self.engine,
            "project.remove",
            "remove-project",
            json!({"id": self.project_id}),
        );
    }
}

fn dispatched_session(response: Response) -> (Value, String, String) {
    assert!(response.ok, "{response:?}");
    let receipt = response.result.unwrap();
    assert_eq!(receipt["outcome"], "dispatched", "{receipt}");
    let session_id = receipt["session"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let incarnation = receipt["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    (receipt, session_id, incarnation)
}

#[test]
fn open_session_resumes_in_the_bot_home_after_its_worktree_was_removed() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_claude_dir = SavedEnv::capture("CLAUDE_CONFIG_DIR");
    let fx = Fx::new();
    let bin = tempfile::tempdir().unwrap();
    install_claude_fixture(bin.path());
    let claude_root = tempfile::tempdir().unwrap();
    unsafe { std::env::set_var("CLAUDE_CONFIG_DIR", claude_root.path()) };

    // 1. The first open provisions the home and the harness reports its
    //    conversation, which the Bot record latches.
    let (first, first_id, first_inc) = dispatched_session(fx.open_session("open-first", false));
    let (first_output, _) = read_until(&fx.engine, &first_id, &first_inc, |text| {
        text.contains("CONVERSATION:")
    });
    assert!(first_output.contains("CONVERSATION:"), "{first_output:?}");
    ok(
        &fx.engine,
        "session.hook_event",
        "hook-identity",
        json!({
            "sessionId": first_id,
            "incarnation": first_inc,
            "event": "SessionStart",
            "agentSessionId": PROVIDER_ID,
        }),
    );
    let home = fx.snapshot_bot("snapshot-latched")["home"].clone();
    let home_workspace_id = home["homeWorkspaceId"].as_str().unwrap().to_string();
    let home_path = home["path"].as_str().unwrap().to_string();
    assert_eq!(first["workspaceId"], json!(home_workspace_id), "{first}");

    // 2. The session is closed and its row forgotten, then the worktree the
    //    Bot was created in goes away.
    ok(
        &fx.engine,
        "session.stop",
        "stop-first",
        json!({"sessionId": first_id, "incarnation": first_inc}),
    );
    ok(
        &fx.engine,
        "session.forget",
        "forget-first",
        json!({"sessionId": first_id, "incarnation": first_inc}),
    );
    fx.remove_project();

    // The owner's exact snapshot: the row is gone, the conversation latched.
    let stranded = fx.snapshot_bot("snapshot-stranded");
    assert_eq!(
        stranded["currentSession"]["recordedSessionMissing"],
        json!(true),
        "{stranded}"
    );
    assert_eq!(
        stranded["currentSession"]["agentSessionId"],
        json!(PROVIDER_ID),
        "{stranded}"
    );

    // 3. The card's monitor column still reads, answering from the home.
    let monitors = fx.monitor_list("monitors-stranded");
    assert!(monitors.ok, "{monitors:?}");
    let monitors = monitors.result.unwrap();
    assert_eq!(
        monitors["workspaceId"],
        json!(home_workspace_id),
        "{monitors}"
    );
    assert_eq!(monitors["monitors"], json!([]), "{monitors}");

    // 4. The click: the session reopens the SAME conversation, in the home.
    let (reopened, second_id, second_inc) =
        dispatched_session(fx.open_session("open-after-removal", true));
    assert_eq!(
        reopened["workspaceId"],
        json!(home_workspace_id),
        "{reopened}"
    );
    let (output, verdict) = read_until(&fx.engine, &second_id, &second_inc, |text| {
        text.contains("CONVERSATION:") || text.contains("NO SUCH CONVERSATION")
    });
    assert_eq!(verdict, "live", "{output:?}");
    let cwd = std::fs::canonicalize(&home_path).unwrap();
    assert!(
        output.contains(&format!("CWD={}", cwd.display()))
            || output.contains(&format!("CWD={home_path}")),
        "the session runs in the Bot's home: {output:?}"
    );
    assert!(
        output.contains(&format!("RESUMED:{PROVIDER_ID}")),
        "the reopen names the latched conversation: {output:?}"
    );
    assert!(
        output.contains(&format!("CONVERSATION:the first turn of {PROVIDER_ID}")),
        "and gets its content back: {output:?}"
    );
    ok(
        &fx.engine,
        "session.stop",
        "stop-second",
        json!({"sessionId": second_id, "incarnation": second_inc}),
    );
    drop(fx.root);
}

#[test]
fn a_bot_without_a_home_still_gets_the_named_refusal() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let fx = Fx::new();
    fx.remove_project();
    assert_eq!(fx.snapshot_bot("snapshot-no-home")["home"], Value::Null);

    // Nothing to fall back to: no session is started, and the reason is the
    // named diagnosis, never the raw sqlite text.
    for refused in [
        err(fx.open_session("open-no-home", false)),
        err(fx.monitor_list("monitors-no-home")),
    ] {
        assert_eq!(refused.code, "workspace_deregistered", "{refused:?}");
        assert!(
            !refused.message.contains("Query returned no rows"),
            "{refused:?}"
        );
        assert!(refused.message.contains(&fx.bot_id), "{refused:?}");
    }
    let sessions = ok(&fx.engine, "session.list", "list-no-home", json!({}));
    assert_eq!(sessions["sessions"], json!([]), "{sessions}");
}
