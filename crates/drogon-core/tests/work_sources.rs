//! Work board sources beyond Jira, through the public `Engine` API against
//! the stateful fake Linear/GitHub (`scripts/fixtures/work-sources`):
//! which sources are allowed, how each connects (Linear API key; GitHub gh
//! login or pasted token), and a full import → sync → push round trip for a
//! Linear team, a GitHub Project and a repository's issues. The fixture is
//! changed from the outside through its control endpoints, the way a
//! teammate would. No test contacts Linear or GitHub, and a fake `gh`
//! stands in for the real one (whose login is never read).

#![cfg(unix)]

#[path = "jira_support.rs"]
mod support;

use std::io::{BufRead, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard};

use drogon_core::tasks_rpc;
use serde_json::{Value, json};
use support::TestContext;

/// The gh override is process-global.
static GH_LOCK: Mutex<()> = Mutex::new(());

struct FakeSources {
    child: Child,
    port: u16,
    _dir: tempfile::TempDir,
}

impl Drop for FakeSources {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl FakeSources {
    fn start() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let script = root.join("scripts/fixtures/work-sources/fake-sources-server.mjs");
        let dir = tempfile::tempdir().unwrap();
        let mut child =
            Command::new(std::env::var("DROGON_TEST_NODE").unwrap_or_else(|_| "node".into()))
                .arg(&script)
                .args(["--port", "0", "--log"])
                .arg(dir.path().join("requests.jsonl"))
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn the fake sources server (node on PATH or DROGON_TEST_NODE)");
        let line = BufReader::new(child.stdout.take().unwrap())
            .lines()
            .next()
            .unwrap()
            .unwrap();
        let port = line
            .trim()
            .strip_prefix("LISTEN ")
            .unwrap()
            .parse()
            .unwrap();
        FakeSources {
            child,
            port,
            _dir: dir,
        }
    }

    fn url(&self, service: &str) -> String {
        format!("http://127.0.0.1:{}/{service}", self.port)
    }

    fn control(&self, path: &str, body: Value) {
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
            ])
            .arg(body.to_string())
            .arg(format!("http://127.0.0.1:{}/__fixture/{path}", self.port))
            .status()
            .unwrap();
        assert!(status.success(), "fixture control {path}");
    }
}

/// A fake `gh`: logged in (prints the fixture token) or logged out.
struct Gh {
    _guard: MutexGuard<'static, ()>,
    _dir: tempfile::TempDir,
}

impl Gh {
    fn set(logged_in: bool) -> Self {
        let guard = GH_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gh");
        let body = if logged_in {
            "#!/bin/sh\n[ \"$1 $2\" = \"auth token\" ] && { echo ghp_fixture; exit 0; }\nexit 1\n"
        } else {
            "#!/bin/sh\necho 'You are not logged into any GitHub hosts.' >&2\nexit 1\n"
        };
        std::fs::write(&path, body).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        tasks_rpc::set_gh_bin_override(Some(path));
        Gh {
            _guard: guard,
            _dir: dir,
        }
    }
}

impl Drop for Gh {
    fn drop(&mut self) {
        tasks_rpc::set_gh_bin_override(None);
    }
}

fn source<'a>(sources: &'a Value, id: &str) -> &'a Value {
    sources["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap()
}

fn keys(view: &Value) -> Vec<String> {
    let mut keys: Vec<String> = view["tickets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["externalKey"].as_str().unwrap().to_string())
        .collect();
    keys.sort();
    keys
}

fn column_name(view: &Value, ticket: &Value) -> String {
    view["columns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == ticket["columnId"])
        .map(|c| c["name"].as_str().unwrap().to_string())
        .unwrap_or_default()
}

fn column_id(view: &Value, name: &str) -> Value {
    view["columns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == name)
        .unwrap()["id"]
        .clone()
}

fn activity(ctx: &TestContext, key: &str) -> Vec<String> {
    ctx.ok("work.ticket_show", json!({"ticketId": key}))["activity"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["text"].as_str().unwrap().to_string())
        .collect()
}

fn project(ctx: &TestContext) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("Drogon");
    std::fs::create_dir_all(&folder).unwrap();
    let id = ctx.ok("project.add", json!({"path": folder.to_str().unwrap()}))["id"]
        .as_str()
        .unwrap()
        .to_string();
    (dir, id)
}

#[test]
fn every_source_starts_allowed_and_can_be_turned_off() {
    let _gh = Gh::set(false);
    let ctx = TestContext::open();
    let sources = ctx.ok("work.sources", json!({}));
    let ids: Vec<&str> = sources["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["jira", "linear", "github", "plane"]);
    for id in ids {
        let s = source(&sources, id);
        assert_eq!(s["enabled"], true, "{id} starts allowed");
        assert_eq!(s["connected"], false, "{id} starts unconnected");
    }
    assert_eq!(source(&sources, "linear")["sprintTerm"], "cycle");
    assert_eq!(source(&sources, "github")["sprintTerm"], "iteration");
    assert_eq!(source(&sources, "linear")["connect"], "api_key");
    assert!(
        source(&sources, "linear")["helpUrl"]
            .as_str()
            .unwrap()
            .starts_with("https://linear.app/settings")
    );

    // Not connected: each source says where to connect.
    assert_eq!(
        ctx.err("work.provider_boards", json!({"provider": "linear"}))
            .code,
        "linear_not_connected"
    );
    let gh = ctx.err("work.provider_boards", json!({"provider": "github"}));
    assert_eq!(gh.code, "github_not_connected");
    assert!(gh.message.contains("gh auth login"));
    assert!(
        ctx.err("work.provider_boards", json!({"provider": "gitlab"}))
            .message
            .contains("known: jira, linear, github")
    );

    // Turned off: never read, whatever the connection.
    let off = ctx.ok(
        "work.source_update",
        json!({"provider": "jira", "enabled": false}),
    );
    assert_eq!(off["enabled"], false);
    let refused = ctx.err("work.provider_boards", json!({"provider": "jira"}));
    assert_eq!(refused.code, "source_disabled");
    assert!(refused.message.contains("Jira is turned off for Work"));
    assert!(
        ctx.err(
            "work.import_preview",
            json!({"provider": "jira", "externalBoardId": "7"})
        )
        .message
        .contains("turned off")
    );
    assert_eq!(
        source(&ctx.ok("work.sources", json!({})), "jira")["enabled"],
        false
    );
    ctx.ok(
        "work.source_update",
        json!({"provider": "jira", "enabled": true}),
    );
    assert_eq!(
        ctx.err("work.provider_boards", json!({"provider": "jira"}))
            .code,
        "jira_not_connected"
    );
    assert!(
        ctx.err("work.source_update", json!({"provider": "jira"}))
            .message
            .contains("enabled is required")
    );
    assert!(
        ctx.err("work.source_connect", json!({"provider": "jira"}))
            .message
            .contains("Tasks page")
    );
    assert!(
        ctx.err("work.source_connect", json!({"provider": "github"}))
            .message
            .contains("gh auth login")
    );
}

#[test]
fn plane_connects_imports_syncs_pushes_and_resolves_conflicts() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    let api = fx.url("plane");
    let connect = |key: &str, slug: &str| json!({"provider":"plane", "apiKey":key, "apiUrl":api, "workspaceSlug":slug});
    assert_eq!(
        ctx.err("work.provider_boards", json!({"provider":"plane"}))
            .code,
        "plane_not_connected"
    );
    assert_eq!(
        ctx.err("work.source_connect", connect("wrong", "drogon"))
            .code,
        "plane_auth_required"
    );
    assert_eq!(
        ctx.err("work.source_connect", connect("plane_fixture", "missing"))
            .code,
        "not_found"
    );
    assert_eq!(
        ctx.err("work.source_connect", connect("plane_fixture", "../drogon"))
            .code,
        "invalid_argument"
    );
    assert!(
        !ctx.dir
            .path()
            .join("integrations/work/plane.token")
            .exists()
    );
    let connected = ctx.ok("work.source_connect", connect("plane_fixture", "drogon"));
    assert_eq!(connected["connected"], true);
    assert_eq!(connected["account"], "Jon Doe · drogon");
    assert_eq!(connected["workspaceSlug"], "drogon");
    assert_eq!(
        connected["helpUrl"],
        "https://app.plane.so/profile/api-tokens"
    );
    assert!(!connected.to_string().contains("plane_fixture"));
    let token_path = ctx.dir.path().join("integrations/work/plane.token");
    let sealed = std::fs::read(&token_path).unwrap();
    assert!(sealed.starts_with(b"v1."));
    assert!(!String::from_utf8_lossy(&sealed).contains("plane_fixture"));
    assert_eq!(
        std::fs::metadata(&token_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let boards = ctx.ok("work.provider_boards", json!({"provider":"plane"}));
    assert_eq!(
        boards["boards"].as_array().unwrap().len(),
        3,
        "all project pages"
    );
    assert_eq!(boards["boards"][0]["kind"], "scrum");
    assert_eq!(
        ctx.err(
            "work.provider_boards",
            json!({"provider":"plane", "siteId":"other"})
        )
        .code,
        "plane_workspace_mismatch"
    );

    let preview = || {
        ctx.ok(
            "work.import_preview",
            json!({"provider":"plane", "externalBoardId":"plane-app"}),
        )
    };
    let p = preview();
    assert_eq!(
        p["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["name"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "Backlog",
            "Todo",
            "In Progress",
            "In Review",
            "Done",
            "Cancelled"
        ]
    );
    assert_eq!(p["sprints"].as_array().unwrap().len(), 3);
    assert_eq!(p["issues"].as_array().unwrap().len(), 5, "all issue pages");
    let active = ctx.ok(
        "work.import_preview",
        json!({"provider":"plane", "externalBoardId":"plane-app", "scope":"sprint:pc-active"}),
    );
    assert_eq!(active["issues"].as_array().unwrap().len(), 2);
    let backlog = ctx.ok(
        "work.import_preview",
        json!({"provider":"plane", "externalBoardId":"plane-app", "scope":"backlog"}),
    );
    assert_eq!(backlog["issues"].as_array().unwrap().len(), 1);
    let imported = ctx.ok("work.board_import", json!({"provider":"plane", "externalBoardId":"plane-app", "issueKeys":["APP-128","APP-129","APP-130","APP-131","APP-132"]}));
    assert_eq!(imported["imported"], 5);
    let board = imported["board"]["id"].clone();
    assert_eq!(imported["board"]["siteId"], "drogon");
    let view = ctx.ok("work.board", json!({"boardId":board}));
    assert_eq!(keys(&view), ["APP-128", "APP-129"]);
    let ticket = ctx.ok("work.ticket_show", json!({"ticketId":"APP-128"}));
    assert_eq!(ticket["issueType"], "Bug");
    assert_eq!(ticket["assignee"], "Jon Doe");
    assert_eq!(ticket["priority"], "high");
    assert_eq!(
        ticket["externalUrl"],
        "https://app.plane.so/drogon/projects/plane-app/issues/pi-1/"
    );
    assert!(activity(&ctx, "APP-128").contains(&"Imported APP-128 from Plane (In Review)".into()));

    let progress = column_id(&view, "In Progress");
    let review = column_id(&view, "In Review");
    ctx.ok(
        "work.ticket_move",
        json!({"ticketId":"APP-129", "columnId":progress}),
    );
    assert_eq!(
        ctx.ok("work.ticket_push", json!({"ticketId":"APP-129"}))["pushed"],
        true
    );
    let issue = |key: &str| {
        preview()["issues"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["key"] == key)
            .cloned()
            .unwrap()
    };
    assert_eq!(issue("APP-129")["status"]["name"], "In Progress");
    fx.control(
        "plane/issue/APP-128",
        json!({"state":"ps-done", "name":"Renamed upstream"}),
    );
    assert_eq!(
        ctx.ok("work.board_sync", json!({"boardId":board}))["moved"],
        1
    );
    assert_eq!(
        ctx.ok("work.ticket_show", json!({"ticketId":"APP-128"}))["title"],
        "Renamed upstream"
    );

    ctx.ok(
        "work.ticket_move",
        json!({"ticketId":"APP-129", "columnId":review}),
    );
    fx.control("plane/issue/APP-129", json!({"state":"ps-done"}));
    ctx.ok("work.board_sync", json!({"boardId":board}));
    assert_eq!(
        ctx.ok("work.ticket_show", json!({"ticketId":"APP-129"}))["sync"],
        "conflict"
    );
    ctx.ok(
        "work.ticket_resolve",
        json!({"ticketId":"APP-129", "keep":"plane"}),
    );
    assert_eq!(
        ctx.ok("work.ticket_show", json!({"ticketId":"APP-129"}))["sync"],
        "synced"
    );
    ctx.ok(
        "work.ticket_move",
        json!({"ticketId":"APP-129", "columnId":review}),
    );
    fx.control("plane/issue/APP-129", json!({"state":"ps-todo"}));
    ctx.ok("work.board_sync", json!({"boardId":board}));
    ctx.ok(
        "work.ticket_resolve",
        json!({"ticketId":"APP-129", "keep":"ours"}),
    );
    assert_eq!(issue("APP-129")["status"]["name"], "In Review");

    ctx.ok(
        "work.ticket_sprint",
        json!({"ticketId":"APP-130", "to":"active"}),
    );
    assert_eq!(
        ctx.ok("work.ticket_push", json!({"ticketId":"APP-130"}))["fields"],
        json!(["sprint"])
    );
    assert_eq!(issue("APP-130")["sprint"]["id"], "pc-active");
    ctx.ok(
        "work.ticket_sprint",
        json!({"ticketId":"APP-130", "to":"backlog"}),
    );
    ctx.ok("work.ticket_push", json!({"ticketId":"APP-130"}));
    assert!(issue("APP-130")["sprint"].is_null());

    ctx.ok(
        "work.ticket_move",
        json!({"ticketId":"APP-129", "columnId":progress}),
    );
    fx.control("plane/config", json!({"failure":{"path":"/work-items/pi-2/", "status":403, "message":"Project permission denied"}}));
    let refused = ctx.ok("work.ticket_push", json!({"ticketId":"APP-129"}));
    assert_eq!(refused["pushed"], false);
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .contains("Project permission denied")
    );
    fx.control("plane/config", json!({}));
    ctx.ok("work.ticket_push", json!({"ticketId":"APP-129"}));
    fx.control("plane/issue/APP-129", json!({"deleted":true}));
    assert_eq!(
        ctx.ok("work.board_sync", json!({"boardId":board}))["removed"],
        1
    );

    ctx.ok(
        "work.ticket_move",
        json!({"ticketId":"APP-128", "columnId":review}),
    );
    ctx.ok(
        "work.source_update",
        json!({"provider":"plane", "enabled":false}),
    );
    for (method, params) in [
        ("work.provider_boards", json!({"provider":"plane"})),
        (
            "work.import_preview",
            json!({"provider":"plane", "externalBoardId":"plane-app"}),
        ),
        (
            "work.board_import",
            json!({"provider":"plane", "externalBoardId":"plane-ops", "all":true}),
        ),
        ("work.board_sync", json!({"boardId":board})),
        ("work.board_push", json!({"boardId":board})),
    ] {
        assert_eq!(ctx.err(method, params).code, "source_disabled", "{method}");
    }
    ctx.ok(
        "work.source_update",
        json!({"provider":"plane", "enabled":true}),
    );
    let disconnected = ctx.ok("work.source_disconnect", json!({"provider":"plane"}));
    assert_eq!(disconnected["boards"], 1);
    assert!(!token_path.exists());
    assert_eq!(
        ctx.err("work.board_sync", json!({"boardId":board})).code,
        "plane_not_connected"
    );
}

#[test]
fn plane_refuses_incomplete_pagination_and_preserves_service_errors() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok("work.source_connect", json!({"provider":"plane", "apiKey":"plane_fixture", "apiUrl":fx.url("plane"), "workspaceSlug":"drogon"}));
    fx.control("plane/config", json!({"pagination":"repeat"}));
    assert!(
        ctx.err(
            "work.import_preview",
            json!({"provider":"plane", "externalBoardId":"plane-app"})
        )
        .message
        .contains("repeated pagination cursor")
    );
    fx.control(
        "plane/config",
        json!({"failure":{"path":"/projects/", "status":429, "message":"Rate limit exceeded"}}),
    );
    let error = ctx.err("work.provider_boards", json!({"provider":"plane"}));
    assert_eq!(error.code, "plane_rate_limited");
    assert!(error.message.contains("retry after 9s"));
    fx.control("plane/config", json!({}));
    assert_eq!(
        ctx.ok("work.provider_boards", json!({"provider":"plane"}))["boards"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn plane_creates_real_work_items_and_auto_imports_new_assignments() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok("work.source_connect", json!({"provider":"plane", "apiKey":"plane_fixture", "apiUrl":fx.url("plane"), "workspaceSlug":"drogon"}));
    let imported = ctx.ok("work.board_import", json!({"provider":"plane", "externalBoardId":"plane-app", "issueKeys":["APP-128"], "autoImportMine":true}));
    let board = imported["board"]["id"].clone();
    let created = ctx.ok("work.ticket_create", json!({"boardId":board, "columnId":"In Progress", "title":"Created from Drogon", "description":"Plain <context> & details"}));
    assert_eq!(created["externalKey"], "APP-133");
    assert_eq!(created["externalStatus"]["name"], "In Progress");
    assert_eq!(created["sprintName"], "Current cycle");
    assert_eq!(created["sync"], "synced");
    assert_eq!(created["warnings"], json!([]));
    fx.control(
        "plane/issue/APP-130",
        json!({"cycle":"pc-active", "assignees":[{"id":"plane-me", "display_name":"Jon Doe"}]}),
    );
    ctx.ok("work.board_sync", json!({"boardId":board}));
    assert!(keys(&ctx.ok("work.board", json!({"boardId":board}))).contains(&"APP-130".into()));
    assert!(
        activity(&ctx, "APP-130").contains(&"Assigned to you in Plane: imported on sync".into())
    );
    // Failed reconnects preserve the last working connection.
    ctx.err("work.source_connect", json!({"provider":"plane", "apiKey":"wrong", "apiUrl":fx.url("plane"), "workspaceSlug":"drogon"}));
    assert_eq!(
        source(&ctx.ok("work.sources", json!({})), "plane")["connected"],
        true
    );
    ctx.ok("work.board_sync", json!({"boardId":board}));
}

#[test]
fn plane_creation_keeps_its_confirmed_identity_when_read_back_fails() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok("work.source_connect", json!({"provider": "plane", "apiKey": "plane_fixture", "apiUrl": fx.url("plane"), "workspaceSlug": "drogon"}));
    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "plane", "externalBoardId": "plane-app", "issueKeys": ["APP-128"]}),
    );
    let board = imported["board"]["id"].clone();
    fx.control("plane/config", json!({"failure": {"path": "/work-items/pi-6/", "status": 503, "message": "Read-back unavailable"}}));
    let response = ctx.call("work.ticket_create", json!({"boardId": board, "columnId": "In Progress", "title": "Retain confirmed creation", "description": "Do not create twice"}));
    assert!(
        response.ok,
        "creation succeeded remotely: {:?}",
        response.error
    );
    let created = response.result.unwrap();
    assert_eq!(created["externalId"], "pi-6");
    assert_eq!(created["externalKey"], "APP-133");
    assert_eq!(
        created["externalUrl"],
        "https://app.plane.so/drogon/projects/plane-app/issues/pi-6/"
    );
    assert_eq!(created["sprintName"], "Current cycle");
    assert!(
        created["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap().contains("Read-back unavailable")),
        "{created}"
    );
    let saved = ctx.ok("work.ticket_show", json!({"ticketId": created["id"]}));
    assert_eq!(saved["externalId"], "pi-6");
    fx.control("plane/config", json!({}));
    ctx.ok("work.board_sync", json!({"boardId": board}));
    let saved = ctx.ok("work.ticket_show", json!({"ticketId": created["id"]}));
    assert_eq!(saved["removed"], false);
    assert_eq!(saved["title"], "Retain confirmed creation");
    let log = std::fs::read_to_string(fx._dir.path().join("requests.jsonl")).unwrap();
    let posts = log
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .filter(|r| {
            r["service"] == "plane"
                && r["method"] == "POST"
                && r["path"]
                    .as_str()
                    .is_some_and(|p| p.ends_with("/work-items/"))
        })
        .count();
    assert_eq!(
        posts, 1,
        "recovery must read the existing work item, not create another"
    );
}

#[test]
fn linear_connects_with_an_api_key_and_round_trips_a_team() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    let (_dir, project_id) = project(&ctx);
    let api = fx.url("linear");

    // A bad key is refused with Linear's own words, and nothing is kept.
    let refused = ctx.err(
        "work.source_connect",
        json!({"provider": "linear", "apiKey": "lin_api_wrong", "apiUrl": api}),
    );
    assert!(
        refused.message.contains("Authentication required"),
        "{}",
        refused.message
    );
    assert!(
        ctx.err(
            "work.source_connect",
            json!({"provider": "linear", "apiUrl": api})
        )
        .message
        .contains("apiKey is required")
    );
    let connected = ctx.ok(
        "work.source_connect",
        json!({"provider": "linear", "apiKey": "lin_api_fixture", "apiUrl": api}),
    );
    assert_eq!(connected["connected"], true);
    assert_eq!(connected["via"], "token");
    assert_eq!(connected["account"], "Jon Doe · Drogon Fixture");
    assert!(
        !connected.to_string().contains("lin_api_fixture"),
        "the key is never echoed"
    );
    let sealed = std::fs::read(ctx.dir.path().join("integrations/work/linear.token")).unwrap();
    assert!(sealed.starts_with(b"v1."), "the key is sealed on disk");
    assert!(!String::from_utf8_lossy(&sealed).contains("lin_api_fixture"));

    let boards = ctx.ok("work.provider_boards", json!({"provider": "linear"}));
    let teams: Vec<(&str, &str)> = boards["boards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| (b["name"].as_str().unwrap(), b["kind"].as_str().unwrap()))
        .collect();
    assert_eq!(teams, [("Engineering", "scrum"), ("Operations", "kanban")]);
    // Recommendations: your open issues per team (ENG-1 in review, OPS-1
    // in progress; the done and unassigned ones do not count).
    let assigned: Vec<u64> = boards["boards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["assignedOpen"].as_u64().unwrap())
        .collect();
    assert_eq!(assigned, [1, 1]);
    // A Linear board is its team: nothing is only shared through a project.
    assert!(
        boards["boards"]
            .as_array()
            .unwrap()
            .iter()
            .all(|b| b["assignedInProject"] == 0)
    );

    let preview = ctx.ok(
        "work.import_preview",
        json!({"provider": "linear", "externalBoardId": "team-eng"}),
    );
    let columns: Vec<&str> = preview["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        columns,
        [
            "Backlog",
            "Todo",
            "In Progress",
            "In Review",
            "Done",
            "Canceled"
        ]
    );
    let cycles: Vec<(&str, &str)> = preview["sprints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["name"].as_str().unwrap(), s["state"].as_str().unwrap()))
        .collect();
    assert_eq!(
        cycles,
        [
            ("Cycle 11", "closed"),
            ("Cycle 12 · Resume polish", "active"),
            ("Cycle 13", "future")
        ]
    );
    assert_eq!(
        preview["issues"].as_array().unwrap().len(),
        5,
        "every page of the team's issues"
    );
    let cycle12 = ctx.ok(
        "work.import_preview",
        json!({"provider": "linear", "externalBoardId": "team-eng", "scope": "sprint:cy-12"}),
    );
    assert_eq!(cycle12["issues"].as_array().unwrap().len(), 3);

    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "linear", "externalBoardId": "team-eng", "issueKeys": ["ENG-1", "ENG-2", "ENG-5"], "projectId": project_id}),
    );
    assert_eq!(imported["imported"], 3);
    let board = imported["board"]["id"].as_str().unwrap().to_string();
    assert_eq!(imported["board"]["provider"], "linear");
    assert_eq!(imported["board"]["siteUrl"], "https://linear.app/drogon");
    let view = ctx.ok("work.board", json!({"boardId": board}));
    assert_eq!(view["view"]["sprint"]["name"], "Cycle 12 · Resume polish");
    // Canceled starts collapsed; any column folds and unfolds.
    let collapsed: Vec<(&str, bool)> = view["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["name"].as_str().unwrap(),
                c["collapsed"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        collapsed,
        [
            ("Backlog", false),
            ("Todo", false),
            ("In Progress", false),
            ("In Review", false),
            ("Done", false),
            ("Canceled", true)
        ]
    );
    let done = column_id(&view, "Done");
    assert_eq!(
        ctx.ok(
            "work.column_update",
            json!({"columnId": done, "collapsed": true})
        )["collapsed"],
        true
    );
    assert_eq!(
        ctx.ok(
            "work.column_update",
            json!({"columnId": done, "collapsed": false})
        )["collapsed"],
        false
    );
    assert_eq!(keys(&view), ["ENG-1", "ENG-2"]);
    assert_eq!(
        keys(&ctx.ok(
            "work.board",
            json!({"boardId": board, "sprintId": "backlog"})
        )),
        ["ENG-5"]
    );

    let t = ctx.ok("work.ticket_show", json!({"ticketId": "ENG-1"}));
    assert_eq!(t["provider"], "linear");
    assert_eq!(t["externalUrl"], "https://linear.app/drogon/issue/ENG-1");
    assert_eq!(t["priority"], "High");
    assert_eq!(t["assignee"], "Jon Doe");
    assert_eq!(t["issueType"], "backend");
    assert_eq!(column_name(&view, &t), "In Review");
    assert!(
        activity(&ctx, "ENG-1").contains(&"Imported ENG-1 from Linear (In Review)".to_string())
    );

    // A Drogon move waits for push; the push changes Linear's state.
    let moved = ctx.ok(
        "work.ticket_move",
        json!({"ticketId": "ENG-2", "columnId": column_id(&view, "In Progress")}),
    );
    assert_eq!(moved["sync"], "pending");
    assert!(
        activity(&ctx, "ENG-2")
            .contains(&"Moved Todo → In Progress; not synced to Linear".to_string())
    );
    let pushed = ctx.ok("work.ticket_push", json!({"ticketId": "ENG-2"}));
    assert_eq!(pushed["pushed"], true, "{pushed}");
    let issue = |key: &str| {
        ctx.ok(
            "work.import_preview",
            json!({"provider": "linear", "externalBoardId": "team-eng"}),
        )["issues"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["key"] == key)
            .cloned()
            .unwrap()
    };
    assert_eq!(issue("ENG-2")["status"]["name"], "In Progress");

    // Linear moves ENG-1: the card follows.
    fx.control("linear/issue/ENG-1", json!({"state": "Done"}));
    let synced = ctx.ok("work.board_sync", json!({"boardId": board}));
    assert_eq!(synced["moved"], 1, "{synced}");
    assert!(activity(&ctx, "ENG-1").contains(&"Moved by Linear: In Review → Done".to_string()));

    // Carry the backlog idea into the active cycle, then push.
    let carried = ctx.ok(
        "work.ticket_sprint",
        json!({"ticketId": "ENG-5", "to": "active"}),
    );
    assert_eq!(carried["sprintPending"], true);
    assert_eq!(
        ctx.ok("work.ticket_push", json!({"ticketId": "ENG-5"}))["fields"],
        json!(["sprint"])
    );
    assert_eq!(issue("ENG-5")["sprint"]["id"], "cy-12");

    // Linear's refusal reads as Linear's error; the card keeps its move.
    ctx.ok(
        "work.ticket_move",
        json!({"ticketId": "ENG-2", "columnId": column_id(&view, "In Review")}),
    );
    fx.control("linear/issue/ENG-2", json!({"deleted": true}));
    let refused = ctx.ok("work.ticket_push", json!({"ticketId": "ENG-2"}));
    assert_eq!(refused["pushed"], false);
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .contains("Entity not found"),
        "{refused}"
    );
    // …and the next sync flags it as gone from Linear.
    assert_eq!(
        ctx.ok("work.board_sync", json!({"boardId": board}))["removed"],
        1
    );
    assert!(
        activity(&ctx, "ENG-2")
            .contains(&"Not in Linear anymore; kept here with its sessions".to_string())
    );

    // Turned off: no sync, and the scheduler leaves it alone.
    ctx.ok(
        "work.source_update",
        json!({"provider": "linear", "enabled": false}),
    );
    assert_eq!(
        ctx.err("work.board_sync", json!({"boardId": board})).code,
        "source_disabled"
    );
    let before = ctx.ok("work.board", json!({"boardId": board}))["board"].clone();
    drogon_core::automations::scheduler::tick_once(
        &ctx.engine,
        (before["lastSyncedAt"].as_i64().unwrap() + 3_600_000) as f64,
    );
    let after = ctx.ok("work.board", json!({"boardId": board}))["board"].clone();
    assert_eq!(after["lastSyncedAt"], before["lastSyncedAt"]);
    ctx.ok(
        "work.source_update",
        json!({"provider": "linear", "enabled": true}),
    );

    // Disconnect forgets the key; imported boards stay.
    let off = ctx.ok("work.source_disconnect", json!({"provider": "linear"}));
    assert_eq!(off["connected"], false);
    assert_eq!(off["boards"], 1);
    assert!(
        !ctx.dir
            .path()
            .join("integrations/work/linear.token")
            .exists()
    );
    assert_eq!(
        ctx.err("work.board_sync", json!({"boardId": board})).code,
        "linear_not_connected"
    );
}

#[test]
fn a_github_project_round_trips_status_iterations_and_removal() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    let api = fx.url("github");
    let refused = ctx.err(
        "work.source_connect",
        json!({"provider": "github", "apiKey": "ghp_wrong", "apiUrl": api}),
    );
    assert!(
        refused.message.contains("Bad credentials"),
        "{}",
        refused.message
    );
    let connected = ctx.ok(
        "work.source_connect",
        json!({"provider": "github", "apiKey": "ghp_fixture", "apiUrl": api}),
    );
    assert_eq!(connected["account"], "octo-fixture");
    assert_eq!(connected["via"], "token");
    assert_eq!(connected["apiUrl"], api.as_str());

    let boards = ctx.ok("work.provider_boards", json!({"provider": "github"}));
    let listed: Vec<(&str, &str)> = boards["boards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| (b["id"].as_str().unwrap(), b["kind"].as_str().unwrap()))
        .collect();
    assert_eq!(
        listed,
        [
            ("project:PVT_roadmap", "scrum"),
            ("project:PVT_ops", "kanban"),
            ("repo:clioo/drogon", "kanban"),
            ("repo:octo-fixture/notes", "kanban"),
        ]
    );
    // GitHub has no recommendations yet: every board reads zero.
    assert!(
        boards["boards"]
            .as_array()
            .unwrap()
            .iter()
            .all(|b| b["assignedOpen"] == 0 && b["assignedInProject"] == 0)
    );

    let preview = ctx.ok(
        "work.import_preview",
        json!({"provider": "github", "externalBoardId": "project:PVT_roadmap"}),
    );
    let columns: Vec<&str> = preview["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(columns, ["No Status", "Todo", "In Progress", "Done"]);
    let iterations: Vec<(&str, &str)> = preview["sprints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["name"].as_str().unwrap(), s["state"].as_str().unwrap()))
        .collect();
    assert_eq!(
        iterations,
        [
            ("Iteration 1", "closed"),
            ("Iteration 2", "active"),
            ("Iteration 3", "future")
        ]
    );
    let issue_keys: Vec<&str> = preview["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["key"].as_str().unwrap())
        .collect();
    assert_eq!(
        issue_keys,
        [
            "clioo/drogon#10",
            "clioo/drogon#11",
            "clioo/drogon#12",
            "clioo/drogon#13",
            "clioo/drogon#14",
            "clioo/drogon#15"
        ],
        "drafts are left out"
    );

    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "github", "externalBoardId": "project:PVT_roadmap", "all": true}),
    );
    assert_eq!(imported["imported"], 6);
    let board = imported["board"]["id"].as_str().unwrap().to_string();
    assert_eq!(imported["board"]["siteUrl"], api.as_str());
    let view = ctx.ok("work.board", json!({"boardId": board}));
    assert_eq!(view["view"]["sprint"]["name"], "Iteration 2");
    assert_eq!(
        keys(&view),
        [
            "clioo/drogon#10",
            "clioo/drogon#11",
            "clioo/drogon#14",
            "clioo/drogon#15"
        ]
    );
    assert_eq!(
        keys(&ctx.ok(
            "work.board",
            json!({"boardId": board, "sprintId": "backlog"})
        )),
        ["clioo/drogon#13"]
    );
    let closed = ctx.ok("work.board", json!({"boardId": board, "sprintId": "it-1"}));
    assert_eq!(closed["view"]["readOnly"], true);
    assert_eq!(keys(&closed), ["clioo/drogon#12"]);

    let t = ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#10"}));
    assert_eq!(t["priority"], "P0");
    assert_eq!(t["assignee"], "Octo Fixture");
    assert_eq!(t["issueType"], "Issue");
    assert_eq!(
        t["externalUrl"],
        "https://github.com/clioo/drogon/issues/10"
    );
    assert_eq!(column_name(&view, &t), "In Progress");
    let pr = ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#15"}));
    assert_eq!(pr["issueType"], "Pull request");
    let draft = ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#13"}));
    assert_eq!(draft["externalStatus"]["name"], "No Status");
    assert_eq!(column_name(&view, &draft), "No Status");

    let item = |key: &str| {
        ctx.ok(
            "work.import_preview",
            json!({"provider": "github", "externalBoardId": "project:PVT_roadmap"}),
        )["issues"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["key"] == key)
            .cloned()
            .unwrap()
    };
    // Status push sets the Status field; "No Status" clears it.
    ctx.ok(
        "work.ticket_move",
        json!({"ticketId": "clioo/drogon#11", "columnId": column_id(&view, "Done")}),
    );
    ctx.ok(
        "work.ticket_move",
        json!({"ticketId": "clioo/drogon#14", "columnId": column_id(&view, "No Status")}),
    );
    let pushed = ctx.ok("work.board_push", json!({"boardId": board}));
    assert_eq!(
        (pushed["pushed"].as_i64(), pushed["failed"].as_i64()),
        (Some(2), Some(0)),
        "{pushed}"
    );
    assert_eq!(item("clioo/drogon#11")["status"]["name"], "Done");
    assert_eq!(item("clioo/drogon#14")["status"]["name"], "No Status");

    // An iteration change on GitHub moves the ticket between sprints; a
    // status change moves the card.
    fx.control("github/item", json!({"project": "PVT_roadmap", "key": "clioo/drogon#10", "status": "Done", "iteration": "Iteration 3"}));
    let synced = ctx.ok("work.board_sync", json!({"boardId": board}));
    assert_eq!(synced["moved"], 1, "{synced}");
    let t = ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#10"}));
    assert_eq!(t["sprintName"], "Iteration 3");
    assert!(
        activity(&ctx, "clioo/drogon#10")
            .contains(&"GitHub moved it from Iteration 2 to Iteration 3".to_string())
    );
    assert!(
        activity(&ctx, "clioo/drogon#10")
            .contains(&"Moved by GitHub: In Progress → Done".to_string())
    );

    // Carry the backlog issue into the active iteration.
    ctx.ok(
        "work.ticket_sprint",
        json!({"ticketId": "clioo/drogon#13", "to": "active"}),
    );
    assert_eq!(
        ctx.ok("work.ticket_push", json!({"ticketId": "clioo/drogon#13"}))["pushed"],
        true
    );
    assert_eq!(item("clioo/drogon#13")["sprint"]["name"], "Iteration 2");
    // Back to the backlog clears the iteration.
    ctx.ok(
        "work.ticket_sprint",
        json!({"ticketId": "clioo/drogon#13", "to": "backlog"}),
    );
    ctx.ok("work.ticket_push", json!({"ticketId": "clioo/drogon#13"}));
    assert_eq!(item("clioo/drogon#13")["sprint"], Value::Null);

    // An item removed from the project is flagged, never deleted.
    fx.control(
        "github/item",
        json!({"project": "PVT_roadmap", "key": "clioo/drogon#14", "deleted": true}),
    );
    assert_eq!(
        ctx.ok("work.board_sync", json!({"boardId": board}))["removed"],
        1
    );
    assert_eq!(
        ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#14"}))["sync"],
        "removed"
    );
}

#[test]
fn a_repositorys_issues_are_an_open_closed_board() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok(
        "work.source_connect",
        json!({"provider": "github", "apiKey": "ghp_fixture", "apiUrl": fx.url("github")}),
    );
    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "github", "externalBoardId": "repo:clioo/drogon", "all": true}),
    );
    assert_eq!(imported["imported"], 5, "pull requests are left out");
    assert_eq!(imported["board"]["kind"], "kanban");
    let board = imported["board"]["id"].as_str().unwrap().to_string();
    let view = ctx.ok("work.board", json!({"boardId": board}));
    assert_eq!(view["view"]["kind"], "all");
    let columns: Vec<&str> = view["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(columns, ["Open", "Closed"]);
    let closed = ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#12"}));
    assert_eq!(column_name(&view, &closed), "Closed");
    assert_eq!(
        ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#13"}))["issueType"],
        "bug"
    );

    // A Drogon-only column stays in sync; closing pushes.
    let doing = ctx.ok(
        "work.column_create",
        json!({"boardId": board, "name": "Doing", "icon": "in_progress", "index": 1}),
    );
    assert_eq!(
        ctx.ok(
            "work.ticket_move",
            json!({"ticketId": "clioo/drogon#10", "columnId": doing["id"]})
        )["sync"],
        "synced"
    );
    ctx.ok(
        "work.ticket_move",
        json!({"ticketId": "clioo/drogon#11", "columnId": column_id(&view, "Closed")}),
    );
    assert_eq!(
        ctx.ok("work.ticket_push", json!({"ticketId": "clioo/drogon#11"}))["pushed"],
        true
    );
    let state = |key: &str| {
        ctx.ok(
            "work.import_preview",
            json!({"provider": "github", "externalBoardId": "repo:clioo/drogon"}),
        )["issues"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["key"] == key)
            .unwrap()["status"]["name"]
            .as_str()
            .unwrap()
            .to_string()
    };
    assert_eq!(state("clioo/drogon#11"), "Closed");

    // Reopened on GitHub: the card follows on sync.
    fx.control(
        "github/issue",
        json!({"key": "clioo/drogon#12", "state": "open"}),
    );
    assert_eq!(
        ctx.ok("work.board_sync", json!({"boardId": board}))["moved"],
        1
    );
    let view = ctx.ok("work.board", json!({"boardId": board}));
    assert_eq!(
        column_name(
            &view,
            &ctx.ok("work.ticket_show", json!({"ticketId": "clioo/drogon#12"}))
        ),
        "Open"
    );
    assert!(
        ctx.err(
            "work.ticket_sprint",
            json!({"ticketId": "clioo/drogon#12", "to": "active"})
        )
        .message
        .contains("kanban")
    );
}

#[test]
fn github_connects_through_the_gh_login_without_storing_a_token() {
    let _gh = Gh::set(true);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    // Signed in to gh: GitHub reads as connected before any click.
    let before = source(&ctx.ok("work.sources", json!({})), "github").clone();
    assert_eq!(before["connected"], true);
    assert_eq!(before["via"], "gh");
    assert_eq!(before["account"], Value::Null, "unknown until connected");
    let connected = ctx.ok(
        "work.source_connect",
        json!({"provider": "github", "apiUrl": fx.url("github")}),
    );
    assert_eq!(connected["via"], "gh");
    assert_eq!(connected["account"], "octo-fixture");
    assert!(
        !ctx.dir
            .path()
            .join("integrations/work/github.token")
            .exists(),
        "the gh token is read, never stored"
    );
    let boards = ctx.ok("work.provider_boards", json!({"provider": "github"}));
    assert_eq!(boards["boards"].as_array().unwrap().len(), 4);
    assert_eq!(
        source(&ctx.ok("work.sources", json!({})), "github")["boards"],
        0
    );
}

/// A real team's size (the owner's hit "Service disconnected": 351 issues,
/// 1.9 MB of descriptions): the picker and the board stay under one reply's
/// 1 MB, and the panel still gets every word.
#[test]
fn a_large_linear_team_fits_in_one_reply_and_keeps_whole_descriptions() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok(
        "work.source_connect",
        json!({"provider": "linear", "apiKey": "lin_api_fixture", "apiUrl": fx.url("linear")}),
    );
    fx.control(
        "linear/bulk",
        json!({"team": "team-ops", "count": 400, "descriptionBytes": 6000}),
    );
    let frame = |v: &Value| serde_json::to_vec(v).unwrap().len();

    // The picker: compact rows, no descriptions, all 401 issues.
    let preview = ctx.ok(
        "work.import_preview",
        json!({"provider": "linear", "externalBoardId": "team-ops"}),
    );
    assert_eq!(preview["total"], 401);
    assert_eq!(preview["truncated"], false);
    assert_eq!(preview["issues"].as_array().unwrap().len(), 401);
    assert!(preview["issues"][0].get("description").is_none());
    assert!(
        frame(&preview) < 1024 * 1024,
        "preview is {} bytes",
        frame(&preview)
    );

    // A board past the budget is cut, and says so.
    fx.control(
        "linear/bulk",
        json!({"team": "team-ops", "count": 2600, "descriptionBytes": 10}),
    );
    let big = ctx.ok(
        "work.import_preview",
        json!({"provider": "linear", "externalBoardId": "team-ops"}),
    );
    assert_eq!(big["total"], 3001);
    assert_eq!(big["truncated"], true);
    let shown = big["issues"].as_array().unwrap().len();
    assert!(shown > 1000 && shown < 3001, "{shown} rows");
    assert!(
        frame(&big) < 1024 * 1024,
        "preview is {} bytes",
        frame(&big)
    );

    // The board carries excerpts; one ticket carries the whole text.
    let keys: Vec<String> = preview["issues"]
        .as_array()
        .unwrap()
        .iter()
        .take(400)
        .map(|i| i["key"].as_str().unwrap().to_string())
        .collect();
    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "linear", "externalBoardId": "team-ops", "issueKeys": keys}),
    );
    assert_eq!(imported["imported"], 400);
    let view = ctx.ok("work.board", json!({"boardId": imported["board"]["id"]}));
    assert_eq!(view["tickets"].as_array().unwrap().len(), 400);
    assert!(
        frame(&view) < 1024 * 1024,
        "board is {} bytes",
        frame(&view)
    );
    assert!(
        frame(&view) / 400 < 1200,
        "{} bytes per ticket",
        frame(&view) / 400
    );
    let card = view["tickets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["externalKey"] == "OPS-1006")
        .unwrap();
    assert_eq!(card["descriptionTruncated"], true);
    assert!(card["description"].as_str().unwrap().chars().count() <= 141);
    let whole = ctx.ok("work.ticket_show", json!({"ticketId": "OPS-1006"}));
    assert_eq!(whole["descriptionTruncated"], false);
    assert_eq!(whole["description"].as_str().unwrap().len(), 6000);
}

/// A gh login without read:project (GitHub's INSUFFICIENT_SCOPES) or a
/// GraphQL rate limit still lists the repositories, with the reason.
#[test]
fn github_without_project_access_still_lists_repositories_and_says_why() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok(
        "work.source_connect",
        json!({"provider": "github", "apiKey": "ghp_fixture", "apiUrl": fx.url("github")}),
    );
    fx.control(
        "github/projects-error",
        json!({"type": "INSUFFICIENT_SCOPES", "message": "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']"}),
    );
    let boards = ctx.ok("work.provider_boards", json!({"provider": "github"}));
    let ids: Vec<&str> = boards["boards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["repo:clioo/drogon", "repo:octo-fixture/notes"]);
    let warning = boards["warnings"][0].as_str().unwrap();
    assert!(
        warning.contains("gh auth refresh -s read:project,project"),
        "{warning}"
    );
    // A repository still imports and syncs.
    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "github", "externalBoardId": "repo:clioo/drogon", "all": true}),
    );
    assert_eq!(imported["imported"], 5);
    fx.control(
        "github/projects-error",
        json!({"type": "RATE_LIMIT", "message": "API rate limit already exceeded for user ID 1."}),
    );
    let limited = ctx.ok("work.provider_boards", json!({"provider": "github"}));
    assert!(
        limited["warnings"][0]
            .as_str()
            .unwrap()
            .contains("API rate limit already exceeded")
    );
    fx.control("github/projects-error", json!({"message": null}));
    let fine = ctx.ok("work.provider_boards", json!({"provider": "github"}));
    assert_eq!(fine["warnings"], json!([]));
    assert_eq!(fine["boards"].as_array().unwrap().len(), 4);
}

/// A Linear team spans projects and people: the picker filters by them and
/// counts them, and "me" is the key's own user.
#[test]
fn the_linear_picker_filters_by_person_project_status_and_words() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok(
        "work.source_connect",
        json!({"provider": "linear", "apiKey": "lin_api_fixture", "apiUrl": fx.url("linear")}),
    );
    let preview = |filters: Value| {
        let mut params = json!({"provider": "linear", "externalBoardId": "team-eng"});
        params
            .as_object_mut()
            .unwrap()
            .extend(filters.as_object().unwrap().clone());
        let v = ctx.ok("work.import_preview", params);
        let keys: Vec<String> = v["issues"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["key"].as_str().unwrap().to_string())
            .collect();
        (v, keys)
    };
    let (all, keys) = preview(json!({}));
    assert_eq!(keys.len(), 5);
    assert_eq!(all["me"], "lin-user-1");
    assert_eq!(all["facets"]["mine"], 1);
    let projects: Vec<(String, i64)> = all["facets"]["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["name"].as_str().unwrap().to_string(),
                p["count"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        projects,
        [("Resume".to_string(), 2), ("Board".to_string(), 1)]
    );
    assert_eq!(all["facets"]["noProject"], 2);
    assert_eq!(preview(json!({"assignee": "me"})).1, ["ENG-1"]);
    assert_eq!(preview(json!({"project": "Resume"})).1, ["ENG-1", "ENG-3"]);
    assert_eq!(preview(json!({"project": "none"})).1, ["ENG-2", "ENG-4"]);
    assert_eq!(preview(json!({"status": "st-todo"})).1, ["ENG-2"]);
    assert_eq!(preview(json!({"query": "cycle picker"})).1, ["ENG-2"]);
    assert_eq!(all["facets"]["finished"], 1);
    assert_eq!(
        preview(json!({"open": true})).1,
        ["ENG-1", "ENG-2", "ENG-3", "ENG-5"],
        "ENG-4 is done"
    );
    assert_eq!(
        preview(json!({"assignee": "any", "project": "Resume", "query": "eng-3"})).1,
        ["ENG-3"]
    );
    let t = preview(json!({"assignee": "me"})).0;
    assert_eq!(t["issues"][0]["assigneeId"], "lin-user-1");
    assert_eq!(t["issues"][0]["project"], "Resume");
    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "linear", "externalBoardId": "team-eng", "mine": true}),
    );
    assert_eq!(imported["imported"], 1);
}

/// "+" on an imported board's column creates the issue in its source, in
/// that column's status, in the cycle being worked, assigned to the owner.
#[test]
fn a_ticket_created_on_a_linear_board_is_a_new_linear_issue_in_that_column() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok(
        "work.source_connect",
        json!({"provider": "linear", "apiKey": "lin_api_fixture", "apiUrl": fx.url("linear")}),
    );
    let imported = ctx.ok(
        "work.board_import",
        json!({"provider": "linear", "externalBoardId": "team-eng", "mine": true}),
    );
    let board = imported["board"]["id"].as_str().unwrap().to_string();
    let view = ctx.ok("work.board", json!({"boardId": board}));

    let created = ctx.ok(
        "work.ticket_create",
        json!({"boardId": board, "columnId": "In Progress", "title": "Wire the create form", "description": "From **Drogon**", "nextStep": "Draft it"}),
    );
    assert_eq!(created["externalKey"], "ENG-6");
    assert_eq!(created["externalStatus"]["name"], "In Progress");
    assert_eq!(column_name(&view, &created), "In Progress");
    assert_eq!(
        created["sprintName"], "Cycle 12 · Resume polish",
        "the active cycle by default"
    );
    assert_eq!(created["assignee"], "Jon Doe");
    assert_eq!(created["nextStep"], "Draft it");
    assert_eq!(created["sync"], "synced");
    assert_eq!(created["warnings"], json!([]));
    let activity = activity(&ctx, "ENG-6");
    assert!(
        activity.contains(&"Created ENG-6 in Linear from Drogon".to_string()),
        "{activity:?}"
    );
    assert!(!activity.iter().any(|a| a.starts_with("Imported")));
    // It is really in Linear.
    let preview = ctx.ok(
        "work.import_preview",
        json!({"provider": "linear", "externalBoardId": "team-eng", "query": "wire"}),
    );
    assert_eq!(preview["issues"][0]["key"], "ENG-6");
    assert_eq!(preview["issues"][0]["importedTicketId"], created["id"]);

    // Backlog, unassigned, by column id.
    let todo = column_id(&view, "Todo");
    let later = ctx.ok(
        "work.ticket_create",
        json!({"columnId": todo, "title": "Someday", "sprintId": "backlog", "assignToMe": false}),
    );
    assert_eq!(later["sprintId"], Value::Null);
    assert_eq!(later["assignee"], Value::Null);
    assert_eq!(later["externalStatus"]["name"], "Todo");
    // A Drogon-only column keeps the card; Linear takes its default.
    let parking = ctx.ok(
        "work.column_create",
        json!({"boardId": board, "name": "Parking"}),
    );
    let parked = ctx.ok(
        "work.ticket_create",
        json!({"columnId": parking["id"], "title": "Parked"}),
    );
    assert_eq!(parked["columnId"], parking["id"]);
    assert_eq!(parked["externalStatus"]["name"], "Todo");
    // Refusals.
    assert!(
        ctx.err(
            "work.ticket_create",
            json!({"boardId": board, "title": "x", "sprintId": "Cycle 11"})
        )
        .message
        .contains("closed")
    );
    assert!(
        ctx.err(
            "work.ticket_create",
            json!({"boardId": board, "title": "x", "columnId": "Nope"})
        )
        .message
        .contains("no column Nope")
    );
    assert!(
        ctx.err(
            "work.ticket_create",
            json!({"boardId": board, "title": "x", "projectId": "p"})
        )
        .message
        .contains("set it on the ticket afterwards")
    );
    assert!(
        ctx.err(
            "work.ticket_create",
            json!({"title": "x", "assignToMe": true})
        )
        .message
        .contains("imported board")
    );
    // The column's on-enter prompt reaches a created ticket too.
    let review = column_id(&view, "In Review");
    ctx.ok("work.column_update", json!({"columnId": review, "sendOnEnter": true, "message": "Review {ticket.key}", "harnessId": "claude"}));
    let prompted = ctx.ok(
        "work.ticket_create",
        json!({"columnId": review, "title": "Prompted"}),
    );
    assert_eq!(prompted["delivery"]["trigger"], "enter");
}

#[test]
fn github_creates_issues_in_a_repository_board_and_a_project() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok(
        "work.source_connect",
        json!({"provider": "github", "apiKey": "ghp_fixture", "apiUrl": fx.url("github")}),
    );
    let project = ctx.ok("work.board_import", json!({"provider": "github", "externalBoardId": "project:PVT_roadmap", "issueKeys": ["clioo/drogon#10"]}));
    let board = project["board"]["id"].as_str().unwrap().to_string();
    let options = ctx.ok("work.create_options", json!({"boardId": board}));
    assert_eq!(options["repos"], json!(["clioo/drogon"]));
    assert!(
        ctx.err(
            "work.ticket_create",
            json!({"boardId": board, "columnId": "Todo", "title": "No repo"})
        )
        .message
        .contains("choose the repository")
    );
    let created = ctx.ok(
        "work.ticket_create",
        json!({"boardId": board, "columnId": "In Progress", "title": "From Drogon", "repo": "clioo/drogon"}),
    );
    assert_eq!(created["externalKey"], "clioo/drogon#16");
    assert_eq!(created["externalStatus"]["name"], "In Progress");
    assert_eq!(
        created["sprintName"], "Iteration 2",
        "the active iteration by default"
    );
    assert_eq!(created["assignee"], "Octo Fixture");

    let repo = ctx.ok("work.board_import", json!({"provider": "github", "externalBoardId": "repo:clioo/drogon", "issueKeys": ["clioo/drogon#10"]}));
    let repo_board = repo["board"]["id"].as_str().unwrap().to_string();
    assert_eq!(
        ctx.ok("work.create_options", json!({"boardId": repo_board}))["repos"],
        json!([])
    );
    let issue = ctx.ok(
        "work.ticket_create",
        json!({"boardId": repo_board, "title": "Plain issue"}),
    );
    assert_eq!(issue["externalKey"], "clioo/drogon#17");
    assert_eq!(issue["externalStatus"]["name"], "Open");
}

#[test]
fn a_failed_github_project_attachment_keeps_the_confirmed_issue() {
    let _gh = Gh::set(false);
    let fx = FakeSources::start();
    let ctx = TestContext::open();
    ctx.ok(
        "work.source_connect",
        json!({"provider": "github", "apiKey": "ghp_fixture", "apiUrl": fx.url("github")}),
    );
    let imported = ctx.ok("work.board_import", json!({"provider": "github", "externalBoardId": "project:PVT_roadmap", "issueKeys": ["clioo/drogon#10"]}));
    let board = imported["board"]["id"].as_str().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("curl");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    @*)
      if /usr/bin/grep -q DrogonGhAddItem "${{arg#@}}"; then
        touch '{root}/waiting'
        n=0
        while [ ! -f '{root}/release' ] && [ $n -lt 500 ]; do sleep 0.01; n=$((n + 1)); done
        exit 7
      fi
      ;;
  esac
done
exec /usr/bin/curl "$@"
"#,
            root = dir.path().display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    struct ResetCurl;
    impl Drop for ResetCurl {
        fn drop(&mut self) {
            drogon_core::jira::client::set_curl_bin_override(None);
        }
    }
    let _reset = ResetCurl;
    drogon_core::jira::client::set_curl_bin_override(Some(script));
    let (persisted_before_attachment, response) = std::thread::scope(|scope| {
        let create = scope.spawn(|| ctx.call("work.ticket_create", json!({"boardId": board, "columnId": "In Progress", "title": "Keep my remote identity", "repo": "clioo/drogon"})));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        while !dir.path().join("waiting").exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let persisted = ctx
            .call("work.ticket_show", json!({"ticketId": "clioo/drogon#16"}))
            .ok;
        std::fs::write(dir.path().join("release"), "").unwrap();
        (persisted, create.join().unwrap())
    });
    assert!(
        persisted_before_attachment,
        "confirmed issue must be durable before project attachment"
    );
    assert!(response.ok, "{:?}", response.error);
    let created = response.result.unwrap();
    assert_eq!(created["externalKey"], "clioo/drogon#16");
    assert!(
        created["externalUrl"]
            .as_str()
            .unwrap()
            .ends_with("/issues/16")
    );
    assert!(
        !created["warnings"].as_array().unwrap().is_empty(),
        "{created}"
    );
    drop(_reset);
    ctx.ok("work.board_sync", json!({"boardId": board}));
    let kept = ctx.ok("work.ticket_show", json!({"ticketId": created["id"]}));
    assert_eq!(kept["removed"], false, "{kept}");
}
