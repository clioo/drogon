//! Bot self-management confinement regressions (adversarial round
//! follow-up): symlink-redirect containment, case-variant handle
//! collision, and the audit-actor storage shape. Fixture temp data dirs,
//! real Engine + scheduler tick — the same posture as the E2E suite.
//!
//! Ports of the /tmp/botadv probes e7/e8/e9 (plus c4/e5 shapes) with the
//! FIXED expectations: the probes pinned the broken behavior to make the
//! gap visible; these pin the contained behavior so the gap stays closed.

use drogon_core::Engine;
use drogon_core::bot_self_mgmt::validate_bot_handle;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
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

fn success(r: Response) -> Value {
    assert!(r.ok, "{r:?}");
    r.result.unwrap()
}

fn code_of(r: Response) -> String {
    assert!(!r.ok, "{r:?}");
    r.error.unwrap().code
}

fn bot_body(name: &str, handle: Option<&str>) -> Value {
    json!({
        "characterPreset": "none",
        "displayIdentity": {"displayName": name, "handle": handle, "title": null},
        "harnessPolicy": {"defaultHarness": "codex", "explicitModel": null},
        "instructions": "Guard the realm.",
        "memories": []
    })
}

struct Fx {
    _root: tempfile::TempDir,
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
        let ws = success(engine.dispatch(request(
            "register",
            "workspace.register",
            json!({"path": folder}),
        )));
        Self {
            workspace_id: ws["id"].as_str().unwrap().to_string(),
            host_id: ws["hostId"].as_str().unwrap().to_string(),
            _root: root,
            engine,
        }
    }

    fn conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(
            self._root
                .path()
                .join("data")
                .join(drogon_core::DB_FILE_NAME),
        )
        .unwrap()
    }

    fn create_bot(&self, req: &str, name: &str, handle: Option<&str>) -> Value {
        success(self.engine.dispatch(request(
            req,
            "bot.create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "body": bot_body(name, handle),
            }),
        )))
    }

    fn call(&self, req: &str, method: &str, mut params: Value) -> Response {
        if params.get("workspaceId").is_none() {
            params["workspaceId"] = json!(self.workspace_id);
        }
        if params.get("hostId").is_none() {
            params["hostId"] = json!(self.host_id);
        }
        self.engine.dispatch(request(req, method, params))
    }

    fn provision(&self, req: &str, bot_id: &str) -> Value {
        success(self.call(
            req,
            "bot.self_provision",
            json!({"botId": bot_id, "actorBotId": bot_id}),
        ))
    }

    fn counts(&self, mid: &str) -> (i64, i64) {
        let c: i64 = self
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM bot_monitor_checks WHERE monitor_id = ?1",
                [mid],
                |r| r.get(0),
            )
            .unwrap();
        let e: i64 = self
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM bot_monitor_events WHERE monitor_id = ?1",
                [mid],
                |r| r.get(0),
            )
            .unwrap();
        (c, e)
    }
}

// --- Break (1): symlink redirect contained ---

#[test]
#[cfg(unix)]
fn symlink_planted_in_home_is_contained_no_cursor_no_event() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bid = bot["id"].as_str().unwrap().to_string();
    let p = fx.provision("p1", &bid);
    let home = p["path"].as_str().unwrap().to_string();
    let outside = fx._root.path().join("outside.txt");
    std::fs::write(&outside, "outside-v1").unwrap();

    let created = success(fx.call(
        "m1",
        "bot.self_create_monitor",
        json!({"botId": bid, "actorBotId": bid, "resource": "link.md",
               "trigger": {"kind": "scheduled", "cron": "* * * * *"}}),
    ));
    let mid = created["monitorId"].as_str().unwrap().to_string();
    let base = 1_700_000_000_000.0;
    // Baseline without the link: absent error check-in, no cursor/event.
    drogon_core::automations::scheduler::tick_once(&fx.engine, base);
    assert_eq!(fx.counts(&mid), (1, 0));

    // Plant the redirect AFTER admission, before the next tick.
    std::os::unix::fs::symlink(&outside, format!("{home}/link.md")).unwrap();
    // Mutate the outside bytes too: a following read would commit them.
    std::fs::write(&outside, "outside-v2-poison").unwrap();
    drogon_core::automations::scheduler::tick_once(&fx.engine, base + 61_000.0);

    // Contained: still no cursor, still no outbox event; the escape is an
    // honest error check-in and the monitor degrades instead of emitting.
    let view = success(fx.call(
        "l",
        "bot.self_list",
        json!({"botId": bid, "actorBotId": bid}),
    ));
    assert_eq!(view["monitors"][0]["hasCursor"], false);
    assert_eq!(view["monitors"][0]["health"], "degraded");
    assert_eq!(fx.counts(&mid), (2, 0));

    // And the escape never heals into a commit: remove the link, restore a
    // real file, and the next fire baselines legitimately.
    std::fs::remove_file(format!("{home}/link.md")).unwrap();
    std::fs::write(format!("{home}/link.md"), "legit").unwrap();
    drogon_core::automations::scheduler::tick_once(&fx.engine, base + 400_000.0);
    let view = success(fx.call(
        "l2",
        "bot.self_list",
        json!({"botId": bid, "actorBotId": bid}),
    ));
    assert_eq!(view["monitors"][0]["hasCursor"], true);
    assert_eq!(view["monitors"][0]["health"], "healthy");
    assert_eq!(fx.counts(&mid).1, 1, "only the legitimate baseline emits");
}

#[test]
fn symlink_escape_dry_run_reports_without_committing() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bid = bot["id"].as_str().unwrap().to_string();
    let p = fx.provision("p1", &bid);
    let home = p["path"].as_str().unwrap().to_string();
    let created = success(fx.call(
        "m1",
        "bot.self_create_monitor",
        json!({"botId": bid, "actorBotId": bid, "resource": "real.md",
               "trigger": {"kind": "manual"}}),
    ));
    let mid = created["monitorId"].as_str().unwrap().to_string();
    // Point the watched resource at an outside file via an intermediate
    // symlink: real.md itself stays, but resource swap needs a rule edit —
    // instead plant real.md AS a symlink (admission saw no file, which is
    // legal: files may appear later).
    std::fs::remove_file(format!("{home}/real.md")).unwrap_or(());
    let outside = fx._root.path().join("outside.txt");
    std::fs::write(&outside, "secret").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, format!("{home}/real.md")).unwrap();
    #[cfg(not(unix))]
    std::fs::write(format!("{home}/real.md"), "secret").unwrap();

    let test = success(fx.call(
        "t",
        "bot.self_test_monitor",
        json!({"botId": bid, "actorBotId": bid, "monitorId": mid}),
    ));
    #[cfg(unix)]
    {
        assert_eq!(test["eligible"], false);
        assert!(
            test["detail"]["reason"]
                .as_str()
                .unwrap_or("")
                .contains("Forbidden"),
            "dry run must report the escape, got {test}"
        );
    }
    // Nothing committed by the dry run either way.
    assert_eq!(fx.counts(&mid), (0, 0));
}

// --- Break (2): case-variant handles collide instead of aliasing ---

#[test]
fn uppercase_handle_normalizes_to_lowercase_dir() {
    assert_eq!(validate_bot_handle("Watcher").unwrap(), "watcher");
    assert_eq!(validate_bot_handle("A-B_9").unwrap(), "a-b_9");
    assert_eq!(validate_bot_handle("@Watcher").unwrap(), "watcher");
    // The evil matrix is unchanged: case never smuggles a separator.
    for evil in ["../Evil", "A/B", "A B", "a\\b", "", "@@x"] {
        assert!(validate_bot_handle(evil).is_err(), "{evil:?} must fail");
    }
}

#[test]
fn case_variant_second_provision_is_denied_no_alias_dir() {
    let fx = Fx::new();
    let a = fx.create_bot("c1", "Upper", Some("Watcher"));
    let aid = a["id"].as_str().unwrap();
    let pa = fx.provision("p1", aid);
    assert_eq!(pa["handle"], "watcher");

    // The create-time contract (the adversarial report on the Bots data
    // model): a case-variant duplicate handle that could never boot is
    // rejected HERE, with the real reason naming the live owner, instead
    // of being accepted and failing forever at first open.
    let refused = fx.call(
        "c2",
        "bot.create",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
            "body": bot_body("Lower", Some("watcher")),
        }),
    );
    assert!(!refused.ok, "{refused:?}");
    let error = refused.error.unwrap();
    assert_eq!(error.code, "invalid_argument");
    assert!(
        error.message.contains("already owned by bot") && error.message.contains(aid),
        "the refusal must name the real owner and the real reason: {error:?}"
    );
    let bot_rows: i64 = fx
        .conn()
        .query_row("SELECT COUNT(*) FROM bots WHERE id != ?1", [aid], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(bot_rows, 0, "a refused create leaves no bot row");

    // A LEGACY case-variant pair (a data dir written before create-time
    // rejection existed, seeded straight into storage to simulate it) is
    // still denied at PROVISION time: same canonical handle means a
    // collision, never a second aliased home.
    let legacy = drogon_core::bots::records::Bot {
        id: "legacy-lower".to_string(),
        character_preset: "none".to_string(),
        display_identity: drogon_core::bots::records::DisplayIdentity {
            display_name: "Lower".to_string(),
            handle: Some("watcher".to_string()),
            title: None,
        },
        harness_policy: drogon_core::bots::records::HarnessModelPolicy {
            default_harness: "codex".to_string(),
            explicit_model: None,
        },
        instructions: "Guard the realm.".to_string(),
        memories: Vec::new(),
        responsibilities: Vec::new(),
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    };
    let folder: String = fx
        .conn()
        .query_row("SELECT folder FROM bots WHERE id = ?1", [aid], |r| r.get(0))
        .unwrap();
    drogon_core::bots::storage::create_bot(&fx.conn(), &fx.host_id, &folder, &legacy).unwrap();
    assert_eq!(
        code_of(fx.call(
            "p2",
            "bot.self_provision",
            json!({"botId": "legacy-lower", "actorBotId": "legacy-lower"}),
        )),
        "invalid_argument"
    );
    let n: i64 = fx
        .conn()
        .query_row(
            "SELECT COUNT(*) FROM bot_homes WHERE bot_id = ?1",
            ["legacy-lower"],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 0, "denied claim leaves no home row");
    // Exactly one directory exists for the canonical spelling.
    let bots_dir = std::path::Path::new(pa["path"].as_str().unwrap())
        .parent()
        .unwrap()
        .to_path_buf();
    let names: Vec<String> = std::fs::read_dir(&bots_dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(names, vec!["watcher".to_string()]);
    // A's home is untouched and still provisions idempotently.
    let pa2 = fx.provision("p1b", aid);
    assert_eq!(pa2["provisioned"], false);
    assert_eq!(pa2["path"], pa["path"]);
}

// --- Audit-doc agreement: actor stored raw ---

#[test]
fn audit_actor_is_the_raw_bot_id() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bid = bot["id"].as_str().unwrap().to_string();
    fx.provision("audit-raw", &bid);
    let actor: String = fx
        .conn()
        .query_row(
            "SELECT actor_bot_id FROM bot_audit WHERE target_bot_id = ?1 AND method = 'bot.self_provision'",
            [&bid],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(actor, bid, "actor joins directly against bot ids");
    assert!(
        !actor.starts_with("bot:"),
        "no redundant prefix in the value"
    );
}

#[test]
fn bot_prefix_actor_spoof_is_denied() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bid = bot["id"].as_str().unwrap();
    fx.provision("p1", bid);
    let r = fx.call(
        "prefix",
        "bot.self_list",
        json!({"botId": bid, "actorBotId": format!("bot:{bid}")}),
    );
    assert!(!r.ok);
    assert_eq!(r.error.unwrap().code, "foreign_bot");
}

#[test]
fn at_handle_and_64char_boundary_end_to_end() {
    let fx = Fx::new();
    let h64 = "h".repeat(64);
    let bot = fx.create_bot("c1", "Long", Some(&h64));
    let bid = bot["id"].as_str().unwrap();
    let p = fx.provision("p1", bid);
    assert_eq!(p["handle"], h64);
    assert!(p["path"].as_str().unwrap().ends_with(&h64));

    let bot2 = fx.create_bot("c2", "At", Some("@athandle"));
    let bid2 = bot2["id"].as_str().unwrap();
    let p2 = fx.provision("p2", bid2);
    assert_eq!(p2["handle"], "athandle");
    assert!(p2["path"].as_str().unwrap().ends_with("athandle"));
    assert!(!p2["path"].as_str().unwrap().contains('@'));
}
