//! P1 integration proof: the `script_command.v1` / `http_poll.v1` rule kinds
//! are admitted, validated, staged parked, and never weaken the approval
//! seam. Fixture-only: a real `Engine` over a temp data dir and the real
//! scheduler tick; no daemon, no network, no child processes, no model calls.

use drogon_core::Engine;
use drogon_core::automations::scheduler;
use drogon_core::bots::monitors::record::{MonitorTrigger, new_monitor};
use drogon_core::bots::monitors::rule::{
    HttpCursorSpec, HttpPollRule, LocalFileRule, MonitorRule, ScriptInterpreter, ScriptRule,
    validate_rule,
};
use drogon_core::bots::monitors::storage;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use rusqlite::Connection;
use serde_json::{Value, json};

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn success(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

fn failure(response: Response) -> String {
    assert!(!response.ok, "{response:?}");
    response.error.unwrap().message
}

struct Fx {
    root: tempfile::TempDir,
    engine: Engine,
    workspace_id: String,
    host_id: String,
}

impl Fx {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let workspace = success(engine.dispatch(request(
            "register",
            "workspace.register",
            json!({"path": folder}),
        )));
        let workspace_id = workspace["id"].as_str().unwrap().to_string();
        let host_id = workspace["hostId"].as_str().unwrap().to_string();
        Self {
            root,
            engine,
            workspace_id,
            host_id,
        }
    }

    fn db(&self) -> Connection {
        Connection::open(
            self.root
                .path()
                .join("data")
                .join(drogon_core::DB_FILE_NAME),
        )
        .unwrap()
    }

    fn create_bot(&self, req: &str, name: &str) -> String {
        let bot = success(self.engine.dispatch(request(
            req,
            "bot.create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {"displayName": name, "handle": null, "title": null},
                    "harnessPolicy": {"defaultHarness": "codex", "explicitModel": null},
                    "instructions": "Watch.",
                    "memories": []
                },
            }),
        )));
        bot["id"].as_str().unwrap().to_string()
    }

    fn self_call(&self, req: &str, method: &str, mut params: Value) -> Response {
        if params.get("workspaceId").is_none() {
            params["workspaceId"] = json!(self.workspace_id);
        }
        if params.get("hostId").is_none() {
            params["hostId"] = json!(self.host_id);
        }
        self.engine.dispatch(request(req, method, params))
    }

    fn provision(&self, req: &str, bot_id: &str) -> Value {
        success(self.self_call(
            req,
            "bot.self_provision",
            json!({"botId": bot_id, "actorBotId": bot_id}),
        ))
    }
}

fn script_rule(host: &str, project: &str) -> MonitorRule {
    MonitorRule::ScriptCommand(ScriptRule {
        host_id: host.to_string(),
        project_id: project.to_string(),
        script_path: "scripts/watch.sh".to_string(),
        script_hash: "ab".repeat(32),
        interpreter: ScriptInterpreter::GhApi,
        argv: vec!["repos/clioo/drogon/pulls".to_string()],
        timeout_ms: 30_000,
        max_output_bytes: 65_536,
        secret_refs: vec!["GITHUB_TOKEN_REF".to_string()],
    })
}

fn http_rule(host: &str, project: &str) -> MonitorRule {
    MonitorRule::HttpPoll(HttpPollRule {
        host_id: host.to_string(),
        project_id: project.to_string(),
        url_hash: "cd".repeat(32),
        timeout_ms: 30_000,
        max_body_bytes: 65_536,
        cursor_spec: HttpCursorSpec::JsonField {
            path: "items".to_string(),
        },
        secret_refs: vec!["GRANOLA_TOKEN".to_string()],
    })
}

fn file_rule(host: &str, project: &str) -> MonitorRule {
    MonitorRule::LocalFileDigest(LocalFileRule {
        host_id: host.to_string(),
        project_id: project.to_string(),
        resource: "notes.md".to_string(),
        max_bytes: 65_536,
    })
}

#[test]
fn mixed_kind_monitor_table_ticks_without_error() {
    let fx = Fx::new();
    std::fs::write(fx.root.path().join("folder").join("notes.md"), "v1").unwrap();
    let conn = fx.db();
    storage::migrate(&conn).unwrap();
    for (id, rule) in [
        ("mon-file", file_rule(&fx.host_id, &fx.workspace_id)),
        ("mon-script", script_rule(&fx.host_id, &fx.workspace_id)),
        ("mon-http", http_rule(&fx.host_id, &fx.workspace_id)),
    ] {
        let record = new_monitor(
            id.to_string(),
            Some("bot-1".to_string()),
            rule.clone(),
            MonitorTrigger::Scheduled {
                cron: "* * * * *".to_string(),
            },
            rule.approval_hash(),
            1.0,
        )
        .unwrap();
        storage::create_monitor(&conn, &record).unwrap();
    }

    // The real scheduler tick loads all three kinds through `scope_of`. It
    // must not fail or panic; only the file kind has an evaluator in this
    // build (P2 owns script/http execution), so the others stay un-ticked.
    scheduler::tick_once(&fx.engine, 1_700_000_000_000.0);

    let (file, _) = storage::get_monitor(&conn, "mon-file").unwrap().unwrap();
    assert!(
        file.cursor.is_some(),
        "the file monitor ticks in a mixed-kind table"
    );
    for id in ["mon-script", "mon-http"] {
        let (record, _) = storage::get_monitor(&conn, id).unwrap().unwrap();
        assert!(record.cursor.is_none(), "{id} has no evaluator yet");
        assert!(
            storage::list_checks_for_monitor(&conn, id)
                .unwrap()
                .is_empty(),
            "{id} is skipped, never error-flapped"
        );
    }
}

#[test]
fn self_staged_script_and_http_monitors_park_at_needs_approval() {
    let fx = Fx::new();
    let bot_id = fx.create_bot("c1", "Watcher");
    fx.provision("p1", &bot_id);

    let scripted = success(fx.self_call(
        "m-script",
        "bot.self_create_monitor",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "kind": "script_command.v1",
            "scriptPath": "scripts/watch.sh",
            "scriptHash": "ab".repeat(32),
            "interpreter": "gh_api",
            "argv": ["repos/clioo/drogon/pulls"],
            "secretRefs": ["GITHUB_TOKEN_REF"],
            "trigger": {"kind": "manual"},
        }),
    ));
    assert_eq!(scripted["ruleKind"], "script_command.v1");
    assert_eq!(scripted["approved"], false);
    assert_eq!(scripted["health"], "needs_approval");

    let polled = success(fx.self_call(
        "m-http",
        "bot.self_create_monitor",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "kind": "http_poll.v1",
            "urlHash": "cd".repeat(32),
            "cursorSpec": {"kind": "etag"},
            "secretRefs": ["GRANOLA_TOKEN"],
            "trigger": {"kind": "scheduled", "cron": "*/5 * * * *"},
        }),
    ));
    assert_eq!(polled["ruleKind"], "http_poll.v1");
    assert_eq!(polled["approved"], false);

    // The list view exposes the rule kind and secret NAMES, never values.
    let home = success(fx.self_call(
        "list",
        "bot.self_list",
        json!({"botId": bot_id, "actorBotId": bot_id}),
    ));
    let monitors = home["monitors"].as_array().unwrap();
    let script_view = monitors
        .iter()
        .find(|m| m["ruleKind"] == "script_command.v1")
        .unwrap();
    assert_eq!(script_view["secretRefs"][0], "GITHUB_TOKEN_REF");
    assert_eq!(script_view["interpreter"], "gh_api");
    assert_eq!(script_view["approved"], false);

    // The scheduler must not tick a parked monitor across kinds.
    scheduler::tick_once(&fx.engine, 1_700_000_000_000.0);
    let conn = fx.db();
    let checks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bot_monitor_checks WHERE monitor_id = ?1",
            [script_view["id"].as_str().unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(checks, 0, "a parked script monitor never runs");
}

#[test]
fn self_staged_rule_kinds_refuse_honest_errors() {
    let fx = Fx::new();
    let bot_id = fx.create_bot("c1", "Watcher");
    fx.provision("p1", &bot_id);

    let base = |extra: Value| {
        let mut params = json!({
            "botId": bot_id, "actorBotId": bot_id,
            "kind": "script_command.v1",
            "scriptPath": "scripts/watch.sh",
            "scriptHash": "ab".repeat(32),
            "interpreter": "gh_api",
            "argv": ["repos/clioo/drogon/pulls"],
            "trigger": {"kind": "manual"},
        });
        if let (Some(base), Some(extra)) = (params.as_object_mut(), extra.as_object()) {
            for (key, value) in extra {
                base.insert(key.clone(), value.clone());
            }
        }
        params
    };

    // No pinned hash.
    let message = failure(fx.self_call(
        "r1",
        "bot.self_create_monitor",
        base(json!({"scriptHash": ""})),
    ));
    assert!(message.contains("scriptHash"), "{message}");

    // Non-allowlisted interpreter.
    let message = failure(fx.self_call(
        "r2",
        "bot.self_create_monitor",
        base(json!({"interpreter": "bash"})),
    ));
    assert!(message.contains("not admitted"), "{message}");

    // Oversized argv element.
    let message = failure(fx.self_call(
        "r3",
        "bot.self_create_monitor",
        base(json!({"argv": ["a".repeat(513)]})),
    ));
    assert!(message.contains("argv"), "{message}");

    // Control character in argv.
    let message = failure(fx.self_call(
        "r4",
        "bot.self_create_monitor",
        base(json!({"argv": ["api\u{0}rm"]})),
    ));
    assert!(message.contains("argv"), "{message}");

    // More than 16 secret refs.
    let refs: Vec<String> = (0..17).map(|i| format!("REF_{i}")).collect();
    let message = failure(fx.self_call(
        "r5",
        "bot.self_create_monitor",
        base(json!({"secretRefs": refs})),
    ));
    assert!(message.contains("secret references"), "{message}");

    // Unknown kind is refused, never guessed.
    let message = failure(fx.self_call(
        "r6",
        "bot.self_create_monitor",
        base(json!({"kind": "shell.v1"})),
    ));
    assert!(message.contains("unknown monitor rule kind"), "{message}");
}

#[test]
fn script_and_http_kinds_are_admitted_by_validation() {
    assert!(validate_rule(&script_rule("h", "p")).is_ok());
    assert!(validate_rule(&http_rule("h", "p")).is_ok());
    // The old kind still validates untouched.
    assert!(validate_rule(&file_rule("h", "p")).is_ok());
}
