//! Data-dir upgrade safety (R16-BP): forward migrations from every recorded
//! past schema version, the pre-migration backup, and the future-version
//! downgrade refusal. Fixtures under `tests/fixtures/upgrades/` carry each
//! component's recorded past shape so a migration never runs against only
//! the fresh-install path. Unix-only like the other engine-level suites.

#![cfg(unix)]

use std::path::PathBuf;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use rusqlite::Connection;
use serde_json::{Value, json};

/// One component's recorded past-version fixtures: (fixture name, recorded
/// version). Empty for components released only at v1.
type ComponentFixtures = &'static [(&'static str, i64)];

/// The known component/fixture matrix: (component name in `schema_versions`,
/// its current version, and the committed fixtures carrying recorded past
/// versions). Keep in sync with `db.rs`'s component modules; a drifted
/// version fails `every_component_fixture_migrates_to_current`.
const UPGRADE_MATRIX: &[(&str, i64, ComponentFixtures)] = &[
    ("bots", 3, &[("bots-v1", 1), ("bots-v2", 2)]),
    ("automations", 2, &[("automations-v1", 1)]),
    ("projects", 5, &[("projects-v1", 1)]),
    ("mentu", 1, &[]),
    ("coordination_access", 1, &[]),
    ("orchestration_mail", 1, &[]),
    ("orchestration_attempts", 1, &[]),
];

/// Same cap as `db::PRE_MIGRATION_BACKUP_RETENTION`.
const BACKUP_RETENTION: usize = 3;

fn temp_dir(name: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(&format!("drogon-upgrade-{name}-"))
        .tempdir()
        .unwrap()
}

fn fixture_sql(fixture: &str) -> &'static str {
    match fixture {
        "bots-v1" => include_str!("fixtures/upgrades/bots-v1.sql"),
        "bots-v2" => include_str!("fixtures/upgrades/bots-v2.sql"),
        "automations-v1" => include_str!("fixtures/upgrades/automations-v1.sql"),
        "projects-v1" => include_str!("fixtures/upgrades/projects-v1.sql"),
        "main-schema-v1" => include_str!("fixtures/upgrades/main-schema-v1.sql"),
        "workspaces-only-pre-projects" => {
            include_str!("fixtures/upgrades/workspaces-only-pre-projects.sql")
        }
        "projects-v3-with-pre-projects-orphan" => {
            include_str!("fixtures/upgrades/projects-v3-with-pre-projects-orphan.sql")
        }
        "projects-v1-with-secondary-worktree" => {
            include_str!("fixtures/upgrades/projects-v1-with-secondary-worktree.sql")
        }
        other => panic!("unknown fixture {other}"),
    }
}

/// Seeds the fixture and runs the *current* build's `Engine::open` over it,
/// exercising exactly what a Drogon upgrade does to Carlos's data dir.
fn open_seeded(name: &str, fixture: &str) -> (tempfile::TempDir, Engine) {
    let dir = temp_dir(name);
    seed(&dir, fixture);
    let engine = Engine::open(dir.path()).unwrap();
    (dir, engine)
}

fn seed(dir: &tempfile::TempDir, fixture: &str) {
    Connection::open(dir.path().join("drogon.sqlite3"))
        .unwrap()
        .execute_batch(fixture_sql(fixture))
        .unwrap();
}

fn db_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("drogon.sqlite3")
}

fn read_db(dir: &tempfile::TempDir) -> Connection {
    Connection::open(db_path(dir)).unwrap()
}

fn version_of(conn: &Connection, component: &str) -> i64 {
    conn.query_row(
        "SELECT version FROM schema_versions WHERE component = ?1",
        [component],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn every_component_fixture_migrates_to_current() {
    for (component, current, fixtures) in UPGRADE_MATRIX {
        for (fixture, from) in fixtures.iter().copied() {
            let tag = format!("{component}-v{from}");
            let (dir, _engine) = open_seeded(&tag, fixture);
            let conn = read_db(&dir);
            assert_eq!(
                version_of(&conn, component),
                *current,
                "{component}: fixture {fixture} (v{from}) must land at v{current}"
            );
        }
    }
}

#[test]
fn bots_rows_survive_v1_to_v3_migration() {
    let (dir, _engine) = open_seeded("bots-rows", "bots-v1");
    let conn = read_db(&dir);
    // The seeded bot row is intact; the v1→v2 step defaulted its new `rev`.
    let (payload, rev): (String, i64) = conn
        .query_row(
            "SELECT payload_json, rev FROM bots WHERE id = 'bot-seed'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(payload.contains("\"bot-seed\""));
    assert_eq!(rev, 0, "v1→v2 defaults rev to 0 for pre-existing rows");
    // The v2→v3 step adds bot_messages without touching existing tables.
    let messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM bot_messages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(messages, 0);
    let runs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bot_responsibility_runs WHERE id = 'run-seed'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(runs, 1, "responsibility-run history survives");
}

#[test]
fn bots_rows_survive_v2_to_v3_migration() {
    let (dir, _engine) = open_seeded("bots-v2-rows", "bots-v2");
    let conn = read_db(&dir);
    let rev: i64 = conn
        .query_row("SELECT rev FROM bots WHERE id = 'bot-seed'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(rev, 7, "a non-default rev must never be rewritten");
}

#[test]
fn projects_v1_gains_title_column_without_losing_worktrees() {
    let (dir, _engine) = open_seeded("projects-title", "projects-v1");
    let conn = read_db(&dir);
    let has_title: bool = conn
        .prepare("PRAGMA table_info(worktrees)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .any(|name| name.unwrap() == "title");
    assert!(has_title, "v1 worktrees must gain the title column");
    let (branch, title): (String, Option<String>) = conn
        .query_row(
            "SELECT branch, title FROM worktrees WHERE id = 'wt-seed'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(branch, "main");
    assert_eq!(title, None);
}

#[test]
fn automations_v1_keeps_records_and_gains_the_composite_index() {
    let (dir, _engine) = open_seeded("automations-rows", "automations-v1");
    let conn = read_db(&dir);
    let name: String = conn
        .query_row(
            "SELECT payload_json FROM automations WHERE id = 'auto-seed'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(name.contains("Seed Automation"));
    let index: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='automation_runs_automation_id_id'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(index, 1, "v1→v2 adds the composite runs index");
}

#[test]
fn main_schema_v1_gains_sessions_columns_and_keeps_rows() {
    let dir = temp_dir("main-schema");
    seed(&dir, "main-schema-v1");
    Engine::open(dir.path()).unwrap();
    let conn = read_db(&dir);
    let (harness_id, needs_input_at): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT harness_id, needs_input_at FROM sessions WHERE id = 'sess-seed'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(harness_id, None);
    assert_eq!(needs_input_at, None);
}

#[test]
fn first_upgrade_creates_exactly_one_pre_migration_backup_with_manifest() {
    let dir = temp_dir("backup-once");
    seed(&dir, "bots-v1");
    let _engine = Engine::open(dir.path()).unwrap();
    let backups = dir.path().join("backups");
    let entries: Vec<PathBuf> = std::fs::read_dir(&backups)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    assert_eq!(
        entries.len(),
        1,
        "exactly one backup on the first forward migration: {entries:?}"
    );
    let backup_db = entries[0].join("drogon.sqlite3");
    assert!(backup_db.is_file(), "snapshot carries the sqlite file");
    // The snapshot holds the pre-migration shape: bots still recorded at v1.
    let snapshot = Connection::open(&backup_db).unwrap();
    assert_eq!(version_of(&snapshot, "bots"), 1);
    let manifest_path = entries[0].join("manifest.json");
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&manifest_path).unwrap()).unwrap();
    assert_eq!(manifest["kind"], "drogon-pre-migration-backup");
    assert_eq!(manifest["pending_migrations"][0]["component"], "bots");
    assert_eq!(
        manifest["pending_migrations"][0]["recorded_version"].as_i64(),
        Some(1)
    );
    assert_eq!(
        manifest["pending_migrations"][0]["migrating_to"].as_i64(),
        Some(3)
    );
    // Reopening the already-current dir must not create another backup.
    let _again = Engine::open(dir.path()).unwrap();
    let entries: Vec<PathBuf> = std::fs::read_dir(&backups)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    assert_eq!(
        entries.len(),
        1,
        "backup is created once, not on every open"
    );
}

#[test]
fn pre_migration_backups_are_pruned_to_retention() {
    let dir = temp_dir("backup-prune");
    seed(&dir, "bots-v1");
    let backups = dir.path().join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    // Three stale backups already on disk; the new one makes four, so the
    // retention cap must evict the oldest stamp, not the lexicographically
    // first name.
    for name in [
        "pre-migration-1000",
        "pre-migration-2000",
        "pre-migration-3000",
    ] {
        std::fs::create_dir_all(backups.join(name)).unwrap();
    }
    Engine::open(dir.path()).unwrap();
    let mut names: Vec<String> = std::fs::read_dir(&backups)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    assert!(
        names.len() <= BACKUP_RETENTION,
        "retention breached: {names:?}"
    );
    assert!(
        !names.contains(&"pre-migration-1000".to_string()),
        "oldest backup pruned: {names:?}"
    );
}

#[test]
fn future_versions_are_refused_for_every_component_naming_the_data_dir() {
    for (component, current, _) in UPGRADE_MATRIX {
        let tag = format!("refuse-{component}");
        let dir = temp_dir(&tag);
        Connection::open(db_path(&dir))
            .unwrap()
            .execute_batch(&format!(
                "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
                 INSERT INTO schema_versions(component, version) VALUES ('{component}', {});",
                current + 1
            ))
            .unwrap();
        let error = Engine::open(dir.path())
            .err()
            .unwrap_or_else(|| panic!("{component}: a future schema version must be refused"));
        let message = error.message;
        assert!(
            message.contains("is newer than"),
            "{component}: refusal must carry the uniform 'is newer than' copy, got: {message}"
        );
        // (The data-dir naming itself is appended by drogond's bootstrap
        // wrapper — asserted in `drogond`'s own test against the same db.)
        // The refusal is read-only: no component tables were created.
        let conn = Connection::open(db_path(&dir)).unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(
            !tables
                .iter()
                .any(|t| t == "bots" || t == "projects" || t == "mentu_approvals"),
            "{component}: refusal must not create component tables, saw {tables:?}"
        );
    }
}

#[test]
fn fresh_dir_opens_without_backup_and_current_dir_reopens_cleanly() {
    let dir = temp_dir("fresh");
    let _engine = Engine::open(dir.path()).unwrap();
    assert!(
        !dir.path().join("backups").exists(),
        "a fresh data dir never needs a pre-migration backup"
    );
    let _again = Engine::open(dir.path()).unwrap();
}

#[test]
fn refusal_leaves_the_data_dir_untouched() {
    let dir = temp_dir("untouched");
    Connection::open(db_path(&dir))
        .unwrap()
        .execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions(component, version) VALUES ('bots', 99);",
        )
        .unwrap();
    let error = Engine::open(dir.path()).err().unwrap();
    assert!(error.message.contains("is newer than"));
    // The dir still holds exactly the refusal shape.
    let conn = Connection::open(db_path(&dir)).unwrap();
    assert_eq!(version_of(&conn, "bots"), 99);
    let backups = dir.path().join("backups");
    assert!(
        !backups.exists(),
        "a refused (downgrade) open must not create a backup: the dir is not ours to touch"
    );
}

// User-feature-closure item 5: an old (pre-Projects, dc12c7a-era) daemon's
// directly-registered folder workspaces must survive an upgrade to this
// build automatically -- no re-add required. `project::list` reads only
// `projects`, so the fix is a one-time backfill from `workspaces` into
// `projects` on the "no recorded projects schema version" migration branch
// (see `backfill_projects_from_pre_existing_folder_workspaces` in
// `project.rs`).

#[test]
fn old_folder_workspace_reappears_as_a_project_without_re_adding() {
    let (dir, engine) = open_seeded("pre-projects-folder", "workspaces-only-pre-projects");
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "list-1".into(),
        auth: None,
        method: "project.list".into(),
        params: json!({}),
    });
    assert!(response.ok, "{response:?}");
    let result = response.result.unwrap();
    let projects = result["projects"].as_array().unwrap();
    let backfilled = projects
        .iter()
        .find(|p| p["path"] == "/tmp/seed-old-folder")
        .unwrap_or_else(|| panic!("old folder workspace missing from project.list: {projects:?}"));
    assert_eq!(backfilled["name"], "old-folder");
    assert_eq!(backfilled["kind"], "folder");
    assert_eq!(backfilled["hostId"], "host-old");
    // Never a re-registration under a fresh id every reopen: the second
    // open must be the current-version no-op branch, not another backfill
    // pass. The fixture also seeds an old git-kind workspace (next test),
    // so both must be present and both must stay stable across reopen.
    let id_first_open = backfilled["id"].as_str().unwrap().to_string();
    drop(engine);
    let engine_again = Engine::open(dir.path()).unwrap();
    let response_again = engine_again.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "list-2".into(),
        auth: None,
        method: "project.list".into(),
        params: json!({}),
    });
    let projects_again = response_again.result.unwrap();
    let projects_again = projects_again["projects"].as_array().unwrap();
    assert_eq!(
        projects_again.len(),
        2,
        "reopening must never duplicate a backfilled project: {projects_again:?}"
    );
    let refound = projects_again
        .iter()
        .find(|p| p["path"] == "/tmp/seed-old-folder")
        .unwrap();
    assert_eq!(refound["id"], Value::String(id_first_open));
}

// Coordinator review (msg_4fea8de5f97c): "preserve registrations, not just
// the easiest folder case" -- a pre-Projects daemon registered git-kind
// paths as directly-attachable workspaces exactly like folder ones (no
// Project/Worktree split existed yet), so the recovery must preserve them
// too, not just quietly leave them un-invented.
#[test]
fn old_git_kind_workspace_is_backfilled_with_its_own_attachable_worktree() {
    let (dir, engine) = open_seeded("pre-projects-git", "workspaces-only-pre-projects");
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "list-1".into(),
        auth: None,
        method: "project.list".into(),
        params: json!({}),
    });
    let listed = response.result.unwrap();
    let projects = listed["projects"].as_array().unwrap();
    let backfilled = projects
        .iter()
        .find(|p| p["path"] == "/tmp/seed-old-git-worktree")
        .unwrap_or_else(|| panic!("old git workspace missing from project.list: {projects:?}"));
    assert_eq!(backfilled["name"], "old-git-worktree");
    assert_eq!(backfilled["kind"], "git");
    assert_eq!(backfilled["hostId"], "host-old");
    let project_id = backfilled["id"].as_str().unwrap().to_string();

    // Preserved as immediately session-attachable, not merely visible:
    // exactly one worktree, the primary checkout (path == project.path),
    // reusing the SAME workspace_id the old daemon's registration used --
    // never a new, second workspace row for the same path.
    let worktrees = engine
        .dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: "wt-list-1".into(),
            auth: None,
            method: "worktree.list".into(),
            params: json!({"projectId": project_id}),
        })
        .result
        .unwrap();
    let worktrees = worktrees["worktrees"].as_array().unwrap();
    assert_eq!(worktrees.len(), 1, "{worktrees:?}");
    assert_eq!(worktrees[0]["path"], "/tmp/seed-old-git-worktree");
    let workspace_id = worktrees[0]["workspaceId"].as_str().unwrap().to_string();

    let conn = read_db(&dir);
    let (ws_count, ws_id): (i64, String) = conn
        .query_row(
            "SELECT COUNT(*), MIN(id) FROM workspaces WHERE path = '/tmp/seed-old-git-worktree'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(ws_count, 1, "must reuse the old workspace row, never duplicate it");
    assert_eq!(ws_id, workspace_id);
}

// Regression: a `workspaces` row already referenced by a real
// `worktrees.workspace_id` is an existing worktree, not an orphan --
// worktrees existed even at the projects schema's v1, and a secondary
// (non-primary-checkout) worktree's path never matches its project's own
// `projects.path`, which alone made it look orphaned to the naive query.
// Without excluding rows already claimed by `worktrees`, the backfill
// inserted a colliding second project+worktree for this exact path and
// opening the data dir failed outright (UNIQUE constraint on
// worktrees.path) -- caught by the existing worktree_rename.rs migration
// test, reproduced and pinned here directly against the recovery itself.
#[test]
fn an_existing_secondary_worktrees_workspace_is_never_mistaken_for_an_orphan() {
    let (dir, engine) =
        open_seeded("v1-secondary-worktree", "projects-v1-with-secondary-worktree");
    let listed = engine
        .dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: "list-1".into(),
            auth: None,
            method: "project.list".into(),
            params: json!({}),
        })
        .result
        .unwrap();
    let projects = listed["projects"].as_array().unwrap();
    // No second, invented project for the secondary worktree's path.
    assert_eq!(
        projects.len(),
        1,
        "the secondary worktree's workspace must never become its own project: {projects:?}"
    );
    assert_eq!(projects[0]["path"], "/tmp/seed-repo");
    let project_id = projects[0]["id"].as_str().unwrap();

    let worktrees = engine
        .dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: "wt-list-1".into(),
            auth: None,
            method: "worktree.list".into(),
            params: json!({"projectId": project_id}),
        })
        .result
        .unwrap();
    let worktrees = worktrees["worktrees"].as_array().unwrap();
    assert_eq!(worktrees.len(), 1, "{worktrees:?}");
    assert_eq!(worktrees[0]["id"], "wt-secondary");
    assert_eq!(worktrees[0]["workspaceId"], "ws-secondary");

    // No duplicate/second workspace row was created for the same path.
    let conn = read_db(&dir);
    let ws_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspaces WHERE path = '/tmp/seed-repo-secondary-wt'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ws_count, 1);
}

// Coordinator review: an already-upgraded store (recorded at projects
// schema v3, from some intermediate build after Projects landed but
// before this recovery existed) must still recover pre-Projects orphans
// on the NEXT open with this fix installed -- not only a data dir this
// build sees for the very first time.
#[test]
fn recovers_pre_projects_orphans_even_when_the_store_is_already_at_v3() {
    let (dir, engine) = open_seeded("already-v3-with-orphans", "projects-v3-with-pre-projects-orphan");
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "list-1".into(),
        auth: None,
        method: "project.list".into(),
        params: json!({}),
    });
    let listed = response.result.unwrap();
    let projects = listed["projects"].as_array().unwrap();
    // The pre-existing v3 project is untouched.
    assert!(
        projects.iter().any(|p| p["path"] == "/tmp/seed-v3-repo"),
        "the store's own pre-existing v3 project must survive: {projects:?}"
    );
    // The orphan predating even that build's Projects launch is recovered.
    let recovered = projects
        .iter()
        .find(|p| p["path"] == "/tmp/seed-orphan-in-v3-store")
        .unwrap_or_else(|| {
            panic!("pre-Projects orphan never recovered from an already-v3 store: {projects:?}")
        });
    assert_eq!(recovered["kind"], "folder");

    let conn = read_db(&dir);
    assert_eq!(version_of(&conn, "projects"), 5);
}

// Coordinator review: a project the user genuinely removed (project.remove
// deletes its workspaces row in the same transaction -- see project.rs's
// `remove`) must never be resurrected by this recovery on a later open,
// including from an already-v3 store.
#[test]
fn an_intentionally_removed_project_is_never_resurrected_by_recovery() {
    let (dir, engine) = open_seeded(
        "already-v3-removed-stays-removed",
        "projects-v3-with-pre-projects-orphan",
    );
    let removed_id = {
        let listed = engine
            .dispatch(Request {
                protocol: PROTOCOL_VERSION,
                request_id: "list-1".into(),
                auth: None,
                method: "project.list".into(),
                params: json!({}),
            })
            .result
            .unwrap();
        listed["projects"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["path"] == "/tmp/seed-v3-repo")
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let removal = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "remove-1".into(),
        auth: None,
        method: "project.remove".into(),
        params: json!({"id": removed_id}),
    });
    assert!(removal.ok, "{removal:?}");

    // Reopen: recovery must run again for the still-orphaned row, but must
    // never bring back the one the user just, deliberately, removed.
    drop(engine);
    let engine_again = Engine::open(dir.path()).unwrap();
    let projects_again = engine_again
        .dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: "list-2".into(),
            auth: None,
            method: "project.list".into(),
            params: json!({}),
        })
        .result
        .unwrap();
    let projects_again = projects_again["projects"].as_array().unwrap();
    assert!(
        !projects_again.iter().any(|p| p["id"] == removed_id),
        "an intentionally removed project must never come back: {projects_again:?}"
    );
    assert!(
        projects_again
            .iter()
            .any(|p| p["path"] == "/tmp/seed-orphan-in-v3-store"),
        "the unrelated orphan must still be recovered: {projects_again:?}"
    );
}

#[test]
fn fresh_install_backfill_is_a_no_op_with_no_pre_existing_workspaces() {
    let dir = temp_dir("fresh-backfill");
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "list-1".into(),
        auth: None,
        method: "project.list".into(),
        params: json!({}),
    });
    let projects = response.result.unwrap();
    assert_eq!(projects["projects"].as_array().unwrap().len(), 0);
}
