//! C06 stable Jira issue→session links: integration coverage of the PUBLIC
//! store API (`drogon_core::jira::identity::{jira_instance_id,
//! JiraTaskIdentity}` + `...::session_links`). Purely in-process: an
//! in-memory SQLite with the minimal host schema — no Engine construction,
//! no daemon, no server, no HTTP, no filesystem outside rusqlite's temp
//! store. MIT Copyright (c) 2026 Lovecast Inc.

use drogon_core::jira::identity::session_links::{
    BeginIntentOutcome, JiraSessionLink, LinkState, SessionResolution, abandon_intent,
    begin_intent, complete_intent, find_link, find_pending_recovery, find_worktree_for_identity,
    history_for_project, link_existing, list_for_project, record_created_worktree,
    resolve_session_state, unlink,
};
use drogon_core::jira::identity::{JiraTaskIdentity, jira_instance_id};
use rusqlite::params;

fn fixture_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE projects (id TEXT PRIMARY KEY);
         CREATE TABLE worktrees (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            created_at TEXT NOT NULL
         );
         CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            workspace_id TEXT,
            verdict TEXT NOT NULL
         );
         INSERT INTO projects (id) VALUES ('p1'), ('p2');",
    )
    .unwrap();
    conn
}

fn identity(site: &str, issue_id: &str, key: &str) -> JiraTaskIdentity {
    JiraTaskIdentity::resolve(site, issue_id, key).unwrap()
}

fn add_worktree(conn: &rusqlite::Connection, id: &str, project_id: &str) {
    conn.execute(
        "INSERT INTO worktrees (id, project_id, created_at) VALUES (?1, ?2, '2026-01-01T00:00:00Z')",
        params![id, project_id],
    )
    .unwrap();
}

fn add_session(conn: &rusqlite::Connection, id: &str, verdict: &str) {
    conn.execute(
        "INSERT INTO sessions (id, workspace_id, verdict) VALUES (?1, 'ws-1', ?2)",
        params![id, verdict],
    )
    .unwrap();
}

/// Acceptance 1: the same displayed issue key on two Jira instances and two
/// projects stays isolated.
#[test]
fn same_key_on_two_instances_and_projects_stays_isolated() {
    let conn = fixture_db();
    assert_ne!(
        jira_instance_id("https://acme.atlassian.net").unwrap(),
        jira_instance_id("https://globex.atlassian.net").unwrap()
    );
    let acme = identity("https://acme.atlassian.net", "10001", "DROG-42");
    let globex = identity("https://globex.atlassian.net", "10001", "DROG-42");
    add_worktree(&conn, "wt-a1", "p1");
    add_worktree(&conn, "wt-g1", "p1");
    add_worktree(&conn, "wt-a2", "p2");
    link_existing(&conn, &acme, "p1", "wt-a1", None, None).unwrap();
    link_existing(&conn, &globex, "p1", "wt-g1", None, None).unwrap();
    link_existing(&conn, &acme, "p2", "wt-a2", None, None).unwrap();
    assert_eq!(
        find_worktree_for_identity(&conn, &acme, "p1")
            .unwrap()
            .as_deref(),
        Some("wt-a1")
    );
    assert_eq!(
        find_worktree_for_identity(&conn, &globex, "p1")
            .unwrap()
            .as_deref(),
        Some("wt-g1")
    );
    assert_eq!(
        find_worktree_for_identity(&conn, &acme, "p2")
            .unwrap()
            .as_deref(),
        Some("wt-a2")
    );
    assert_eq!(list_for_project(&conn, "p1").unwrap().len(), 2);
    assert_eq!(list_for_project(&conn, "p2").unwrap().len(), 1);
}

/// Acceptance 2: rename title/key and reconnect the same instance with
/// another account — the stable link survives and no credential identity
/// participates anywhere.
#[test]
fn rename_and_reconnect_survive_without_cross_account_reuse() {
    let conn = fixture_db();
    add_worktree(&conn, "wt-1", "p1");
    add_session(&conn, "s-1", "live");
    let original = identity("https://acme.atlassian.net", "10001", "DROG-42");
    link_existing(&conn, &original, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
    // Another account, renamed key, new title: same immutable issue id and
    // same instance URL → the SAME binding answers.
    let reconnected = identity("https://acme.atlassian.net/", "10001", "OPS-77");
    let link = find_link(&conn, &reconnected, "p1").unwrap().unwrap();
    assert_eq!(link.worktree_id, "wt-1");
    assert_eq!(link.session_id.as_deref(), Some("s-1"));
    // Refresh display fields; binding intact, exactly one row.
    let refreshed =
        link_existing(&conn, &reconnected, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
    assert_eq!(refreshed.key, "OPS-77");
    assert_eq!(list_for_project(&conn, "p1").unwrap().len(), 1);
    // The legacy per-account connection id is never part of the link.
    let events = history_for_project(&conn, "p1").unwrap();
    assert!(
        events
            .iter()
            .all(|e| !e.instance_id.contains('@') && !e.key.contains('@'))
    );
}

/// Acceptance 3: concurrent/replayed starts create one logical binding; a
/// fixture failure after the worktree checkpoint and before the session
/// receipt recovers without duplicating or stealing resources.
#[test]
fn replayed_start_and_partial_creation_recover_without_duplication() {
    let conn = fixture_db();
    let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
    assert!(matches!(
        begin_intent(&conn, &id, "p1", "intent-1").unwrap(),
        BeginIntentOutcome::Began
    ));
    // Double click with a fresh intent id joins the in-flight start.
    assert!(matches!(
        begin_intent(&conn, &id, "p1", "intent-2").unwrap(),
        BeginIntentOutcome::InFlight { ref intent_id, .. } if intent_id == "intent-1"
    ));
    // The shared worktree path returned; the daemon checkpoints BEFORE the
    // harness launch, then "dies" before the session receipt.
    add_worktree(&conn, "wt-1", "p1");
    record_created_worktree(&conn, &id, "p1", "intent-1", "wt-1", Some("ws-1")).unwrap();
    // Restart: recovery adopts exactly the recorded worktree, and a replayed
    // intent sees the same pending binding instead of creating another.
    let recovery = find_pending_recovery(&conn, &id, "p1").unwrap().unwrap();
    assert_eq!(recovery.worktree_id, "wt-1");
    assert!(matches!(
        begin_intent(&conn, &id, "p1", "intent-3").unwrap(),
        BeginIntentOutcome::Linked(ref l)
            if l.worktree_id == "wt-1" && l.state == LinkState::Pending
    ));
    let link = complete_intent(&conn, &recovery.intent_id, Some("s-1")).unwrap();
    assert_eq!(link.worktree_id, "wt-1");
    assert_eq!(link.session_id.as_deref(), Some("s-1"));
    assert_eq!(list_for_project(&conn, "p1").unwrap().len(), 1);
    // A vanished checkpoint is never adopted.
    let other = identity("https://acme.atlassian.net", "10002", "DROG-43");
    begin_intent(&conn, &other, "p1", "intent-9").unwrap();
    record_created_worktree(&conn, &other, "p1", "intent-9", "wt-1", None).unwrap();
    conn.execute("DELETE FROM worktrees WHERE id = 'wt-1'", [])
        .unwrap();
    assert!(
        find_pending_recovery(&conn, &other, "p1")
            .unwrap()
            .is_none()
    );
    abandon_intent(&conn, "intent-9", "worktree vanished").unwrap();
    assert!(find_link(&conn, &other, "p1").unwrap().is_none());
}

/// Acceptance 4: link/unlink/restart round trip preserves the session and
/// historical run records.
#[test]
fn link_unlink_restart_round_trip_preserves_records() {
    let conn = fixture_db();
    let id = identity("https://acme.atlassian.net", "10001", "DROG-42");
    add_worktree(&conn, "wt-1", "p1");
    add_session(&conn, "s-1", "exited");
    add_session(&conn, "s-2", "live");
    let link = link_existing(&conn, &id, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
    assert_eq!(
        resolve_session_state(&conn, &link).unwrap(),
        SessionResolution::Exited
    );
    assert!(unlink(&conn, &id, "p1").unwrap());
    let worktrees: i64 = conn
        .query_row("SELECT COUNT(*) FROM worktrees", [], |r| r.get(0))
        .unwrap();
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!((worktrees, sessions), (1, 2));
    // Restart of the binding onto the newer session; history keeps all.
    let relinked = link_existing(&conn, &id, "p1", "wt-1", Some("ws-1"), Some("s-2")).unwrap();
    assert_eq!(
        resolve_session_state(&conn, &relinked).unwrap(),
        SessionResolution::Live
    );
    let events = history_for_project(&conn, "p1").unwrap();
    let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
    assert_eq!(names, vec!["linked", "unlinked", "linked"]);
}

/// Acceptance 5 (data layer half): live/unverifiable/exited/no-session are
/// distinct, and loss of contact (missing row, unknown verdict) never
/// proves exit.
#[test]
fn session_resolution_is_distinct_and_loss_of_contact_is_unverifiable() {
    let conn = fixture_db();
    let mk = |session: Option<&str>| JiraSessionLink {
        session_id: session.map(str::to_string),
        ..placeholder()
    };
    fn placeholder() -> JiraSessionLink {
        JiraSessionLink {
            instance_id: String::new(),
            issue_id: String::new(),
            key: String::new(),
            instance_url: String::new(),
            project_id: String::new(),
            worktree_id: String::new(),
            workspace_id: None,
            session_id: None,
            conversation_id: None,
            intent_id: String::new(),
            state: LinkState::Pending,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
    add_session(&conn, "s-live", "live");
    add_session(&conn, "s-exited", "exited");
    add_session(&conn, "s-unver", "unverifiable");
    add_session(&conn, "s-future", "some-future-verdict");
    let conn = &conn;
    assert_eq!(
        resolve_session_state(conn, &mk(Some("s-live"))).unwrap(),
        SessionResolution::Live
    );
    assert_eq!(
        resolve_session_state(conn, &mk(Some("s-exited"))).unwrap(),
        SessionResolution::Exited
    );
    assert_eq!(
        resolve_session_state(conn, &mk(Some("s-unver"))).unwrap(),
        SessionResolution::Unverifiable
    );
    assert_eq!(
        resolve_session_state(conn, &mk(Some("s-future"))).unwrap(),
        SessionResolution::Unverifiable
    );
    assert_eq!(
        resolve_session_state(conn, &mk(Some("s-missing"))).unwrap(),
        SessionResolution::Unverifiable
    );
    assert_eq!(
        resolve_session_state(conn, &mk(None)).unwrap(),
        SessionResolution::NoSession
    );
}

/// The identity gate: legacy bindings without a resolved instance URL and
/// immutable issue id stay unresolved — never guessed from the account
/// email or the display key.
#[test]
fn unresolved_legacy_stays_unresolved() {
    assert!(JiraTaskIdentity::resolve("https://acme.atlassian.net", "", "DROG-42").is_err());
    assert!(JiraTaskIdentity::resolve("", "10001", "DROG-42").is_err());
    // The key alone never identifies: two ids on one instance differ.
    let a = identity("https://acme.atlassian.net", "10001", "DROG-42");
    let b = identity("https://acme.atlassian.net", "10002", "DROG-42");
    assert_ne!(a.link_id(), b.link_id());
}
