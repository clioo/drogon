//! Additional adversarial coverage for issue #383.  These are real Engine::dispatch
//! calls; the tests deliberately exercise foreign ownership, scope confusion,
//! request replay, and same-database races rather than calling storage helpers.
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::sync::{Arc, Barrier};
use std::thread;

fn req(id: &str, method: &str, params: Value) -> Request {
    Request { protocol: PROTOCOL_VERSION, request_id: id.into(), auth: None, method: method.into(), params }
}
fn ok(r: Response) -> Value { assert!(r.ok, "{r:?}"); r.result.unwrap() }
fn err(r: Response) -> String { assert!(!r.ok, "{r:?}"); r.error.unwrap().code }

struct Fx { dir: tempfile::TempDir, engine: Engine, ws: String, host: String }
impl Fx {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let folder = dir.path().join("folder"); std::fs::create_dir(&folder).unwrap();
        let ws = ok(engine.dispatch(req("ws", "workspace.register", json!({"path": folder}))));
        Self { dir, engine, ws: ws["id"].as_str().unwrap().into(), host: ws["hostId"].as_str().unwrap().into() }
    }
    fn bot(&self, request: &str, name: &str) -> String {
        ok(self.engine.dispatch(req(request, "bot.create", json!({
            "workspaceId": self.ws, "hostId": self.host, "body": {
                "characterPreset": "none", "displayIdentity": {"displayName": name, "handle": null, "title": null},
                "harnessPolicy": {"defaultHarness": "pi", "explicitModel": null}, "instructions": "fixture", "memories": []
            }
        }))))["id"].as_str().unwrap().into()
    }
    fn responsibility(&self, request: &str, bot: &str) -> (String, String) {
        let v = ok(self.engine.dispatch(req(request, "bot.responsibility_create", json!({
            "workspaceId": self.ws, "hostId": self.host, "botId": bot,
            "name": request, "schedule": "59 23 31 12 *", "prompt": "fixture"
        }))));
        (v["responsibilityId"].as_str().unwrap().into(), v["automationId"].as_str().unwrap().into())
    }
    fn delete(&self, request: &str, scope: &str, host: &str, bot: &str) -> Response {
        self.engine.dispatch(req(request, "bot.delete", json!({"workspaceId": scope, "hostId": host, "botId": bot})))
    }
    fn user_automation(&self, request: &str) -> String {
        ok(self.engine.dispatch(req(request, "automation.create", json!({
            "name": request, "cron": "59 23 31 12 *", "workspaceId": self.ws, "harness": "pi", "prompt": "fixture"
        }))))["id"].as_str().unwrap().into()
    }
    fn all_automation_ids(&self) -> Vec<String> {
        ok(self.engine.dispatch(req("list-unique", "automation.list", json!({}))))["automations"].as_array().unwrap()
            .iter().map(|x| x["id"].as_str().unwrap().into()).collect()
    }
}

#[test]
fn several_foreign_unowned_zero_replay_and_scopes() {
    let fx = Fx::new();
    let zero = fx.bot("zero-bot", "zero");
    let zero_receipt = ok(fx.delete("zero-delete", &fx.ws, &fx.host, &zero));
    assert_eq!(zero_receipt["automationIds"], json!([]));
    assert_eq!(err(fx.delete("zero-delete-again", &fx.ws, &fx.host, &zero)), "not_found");

    let owner = fx.bot("owner-bot", "owner");
    let other = fx.bot("other-bot", "other");
    let (_, owned_a) = fx.responsibility("owned-a", &owner);
    let (_, owned_b) = fx.responsibility("owned-b", &owner);
    let (_, foreign_owned) = fx.responsibility("foreign", &other);
    let unowned = fx.user_automation("plain-user");
    let before = fx.all_automation_ids();
    let params_receipt = ok(fx.delete("owner-delete", "", &fx.host, &owner));
    let mut receipt_ids: Vec<String> = params_receipt["automationIds"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().into()).collect();
    receipt_ids.sort();
    let mut expected = vec![owned_a.clone(), owned_b.clone()]; expected.sort();
    assert_eq!(receipt_ids, expected);
    let after = fx.all_automation_ids();
    assert!(after.contains(&foreign_owned) && after.contains(&unowned));
    assert!(!after.contains(&owned_a) && !after.contains(&owned_b));
    // Exact request-ledger replay after an unrelated automation was deleted.
    ok(fx.engine.dispatch(req("other-delete", "automation.delete", json!({"id": foreign_owned}))));
    let replay = ok(fx.delete("owner-delete", "", &fx.host, &owner));
    assert_eq!(replay, params_receipt);
    assert_eq!(fx.all_automation_ids(), vec![unowned.clone()]);
    let _ = before;

    let bot = fx.bot("scope-bot", "scope");
    let other_dir = tempfile::tempdir().unwrap();
    let other_ws = ok(fx.engine.dispatch(req("ws-other", "workspace.register", json!({"path": other_dir.path()}))))["id"].as_str().unwrap().to_string();
    let different = ok(fx.delete("scope-other-workspace", &other_ws, &fx.host, &bot));
    assert_eq!(different["botId"], bot);
    let ghost = fx.bot("ghost-bot", "ghost");
    assert_eq!(err(fx.delete("scope-ghost", "garbage-workspace", &fx.host, &ghost)), "unknown_workspace");
    assert_eq!(err(fx.delete("scope-host", "", "wrong-host", &ghost)), "foreign_workspace_host");
    assert_eq!(err(fx.delete("scope-bot-home-wrong-host", &fx.ws, "wrong-host", &ghost)), "foreign_workspace_host");
}

#[test]
fn responsibility_runs_survive_and_monitor_is_not_a_live_bot_after_delete() {
    let fx = Fx::new();
    let bot = fx.bot("history-bot", "history");
    let (_, automation) = fx.responsibility("history-responsibility", &bot);
    let folder = fx.dir.path().join("folder");
    std::fs::write(folder.join("watched.txt"), "one").unwrap();
    let monitor = fx.engine.dispatch(req("monitor", "bot.monitor_create", json!({
        "workspaceId": fx.ws, "hostId": fx.host, "botId": bot, "monitorId": "monitor-383",
        "resource": "watched.txt", "manual": true,
        "responsibilityName": "monitor-duty", "instructions": "fixture"
    })));
    assert!(monitor.ok, "monitor create failed: {monitor:?}");
    let evidence = Connection::open(fx.dir.path().join("drogon.sqlite3")).unwrap();
    evidence.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json) VALUES (?1, ?2, ?3, 1.0, ?4)",
        ("orphan-run-383", &bot, "automation-run-383", "{}"),
    ).unwrap();
    let deleted = ok(fx.delete("delete-history-bot", &fx.ws, &fx.host, &bot));
    assert_eq!(deleted["automationIds"], json!([automation]));
    // The documented delete contract retains responsibility-run evidence.  A
    // monitor record, if retained, must at least be unreachable through a
    // deleted Bot and cannot dispatch against one that no longer exists.
    assert_eq!(err(fx.engine.dispatch(req("list-deleted-monitor", "bot.monitor_list", json!({
        "workspaceId": "", "hostId": fx.host, "botId": bot
    })))), "not_found");
    let db = Connection::open(fx.dir.path().join("drogon.sqlite3")).unwrap();
    let monitor_rows: i64 = db.query_row("SELECT COUNT(*) FROM bot_monitors WHERE bot_id = ?1", [&bot], |r| r.get(0)).unwrap();
    assert_eq!(monitor_rows, 1, "the current contract leaves the monitor as inert orphaned state");
    let run_rows: i64 = db.query_row("SELECT COUNT(*) FROM bot_responsibility_runs WHERE id = 'orphan-run-383'", [], |r| r.get(0)).unwrap();
    assert_eq!(run_rows, 1, "responsibility-run evidence must survive Bot deletion");
}

#[test]
fn held_database_lock_rolls_back_the_entire_delete() {
    let fx = Fx::new();
    let bot = fx.bot("locked-bot", "locked");
    let (_, automation) = fx.responsibility("locked-responsibility", &bot);
    let lock = Connection::open(fx.dir.path().join("drogon.sqlite3")).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let failed = fx.delete("locked-delete", &fx.ws, &fx.host, &bot);
    eprintln!("held-lock delete response: {failed:?}");
    assert!(!failed.ok, "a held SQLite write lock must not report a successful delete: {failed:?}");
    drop(lock);
    let listed = fx.all_automation_ids();
    assert!(listed.contains(&automation), "failed cascade must not delete the automation");
    let snapshot = ok(fx.engine.dispatch(req("locked-snapshot", "bot.snapshot", json!({
        "workspaceId": fx.ws, "hostId": fx.host, "locale": "en-US"
    }))));
    assert!(snapshot["bots"].as_array().unwrap().iter().any(|entry| entry["id"] == bot), "failed cascade must not delete the bot");
}

#[test]
fn two_deletes_and_delete_create_race_do_not_strand_an_owned_automation() {
    let fx = Fx::new();
    let bot = fx.bot("race-bot", "race");
    let (_, initial) = fx.responsibility("race-initial", &bot);
    let db_path = fx.dir.path().to_path_buf();
    let barrier = Arc::new(Barrier::new(3));
    let host = fx.host.clone(); let bot_a = bot.clone(); let b1 = barrier.clone();
    let t1 = thread::spawn(move || { let e = Engine::open(&db_path).unwrap(); b1.wait(); e.dispatch(req("race-delete-a", "bot.delete", json!({"workspaceId":"", "hostId":host, "botId":bot_a}))) });
    let db_path = fx.dir.path().to_path_buf(); let host = fx.host.clone(); let bot_b = bot.clone(); let b2 = barrier.clone();
    let t2 = thread::spawn(move || { let e = Engine::open(&db_path).unwrap(); b2.wait(); e.dispatch(req("race-delete-b", "bot.delete", json!({"workspaceId":"", "hostId":host, "botId":bot_b}))) });
    barrier.wait();
    let r1 = t1.join().unwrap(); let r2 = t2.join().unwrap();
    assert_eq!([r1.ok, r2.ok].iter().filter(|x| **x).count(), 1, "one concurrent delete must win: {r1:?} {r2:?}");
    assert_eq!(fx.all_automation_ids(), Vec::<String>::new());

    let bot = fx.bot("race-create-bot", "race-create");
    let db_path = fx.dir.path().to_path_buf(); let host = fx.host.clone(); let ws = fx.ws.clone(); let bot_d = bot.clone(); let b3 = Arc::new(Barrier::new(2)); let b4 = b3.clone();
    let td = thread::spawn(move || { let e = Engine::open(&db_path).unwrap(); b3.wait(); e.dispatch(req("race-delete-create-delete", "bot.delete", json!({"workspaceId":ws,"hostId":host,"botId":bot_d}))) });
    let db_path = fx.dir.path().to_path_buf(); let host = fx.host.clone(); let ws = fx.ws.clone(); let bot_c = bot.clone();
    let tc = thread::spawn(move || { let e = Engine::open(&db_path).unwrap(); b4.wait(); e.dispatch(req("race-delete-create-create", "bot.responsibility_create", json!({"workspaceId":ws,"hostId":host,"botId":bot_c,"name":"racing","schedule":"59 23 31 12 *","prompt":"fixture"}))) });
    let rd = td.join().unwrap(); let rc = tc.join().unwrap();
    let ids = fx.all_automation_ids();
    assert!(ids.is_empty(), "race must leave no ownerless automation: delete={rd:?} create={rc:?} ids={ids:?}");
    let _ = initial;
}
