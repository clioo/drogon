//! C06 PROPOSAL coverage: stable Jira issue→session links, exercised
//! through the UNWIRED store module (`src/jira/session_links.rs`, declared
//! here via test-local `#[path]` because `jira/mod.rs` is root-held and
//! the module must stay unreachable from the daemon until the additive
//! export handover). Purely in-process: an in-memory SQLite with the
//! minimal host schema — no Engine construction, no daemon, no server, no
//! HTTP, no filesystem outside rusqlite's temp store.
//! MIT Copyright (c) 2026 Lovecast Inc.

#[path = "../src/jira/session_links.rs"]
mod session_links;

use drogon_core::jira::identity::{InstanceIdentitySource, JiraTaskIdentity};
use rusqlite::params;
use session_links::{
    BeginIntentOutcome, InstanceTier, JiraSessionLink, LinkState, SessionResolution,
    abandon_intent, begin_intent, complete_intent, find_link, find_pending_recovery,
    find_worktree_for_identity, history_for_project, link_existing, list_for_project,
    record_created_worktree, resolve_session_state, unlink,
};

const HOST: &str = "host-1";

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

fn provisional(site: &str, issue_id: &str, key: &str) -> JiraTaskIdentity {
    JiraTaskIdentity::resolve_provisional(site, issue_id, key).unwrap()
}

fn verified(site: &str, issue_id: &str, key: &str) -> JiraTaskIdentity {
    JiraTaskIdentity::resolve_source_backed(
        InstanceIdentitySource::CloudTenantId,
        "Aa1Bb2Cc3",
        site,
        "2026-01-01T00:00:00Z",
        issue_id,
        key,
    )
    .unwrap()
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

/// Acceptance 1: the same displayed issue key on two Jira endpoints and two
/// projects stays isolated.
#[test]
fn same_key_on_two_endpoints_and_projects_stays_isolated() {
    let conn = fixture_db();
    let acme = provisional("https://acme.atlassian.net", "10001", "DROG-42");
    let globex = provisional("https://globex.atlassian.net", "10001", "DROG-42");
    add_worktree(&conn, "wt-a1", "p1");
    add_worktree(&conn, "wt-g1", "p1");
    add_worktree(&conn, "wt-a2", "p2");
    link_existing(&conn, HOST, &acme, "p1", "wt-a1", None, None).unwrap();
    link_existing(&conn, HOST, &globex, "p1", "wt-g1", None, None).unwrap();
    link_existing(&conn, HOST, &acme, "p2", "wt-a2", None, None).unwrap();
    assert_eq!(
        find_worktree_for_identity(&conn, HOST, &acme, "p1")
            .unwrap()
            .as_deref(),
        Some("wt-a1")
    );
    assert_eq!(
        find_worktree_for_identity(&conn, HOST, &globex, "p1")
            .unwrap()
            .as_deref(),
        Some("wt-g1")
    );
    assert_eq!(
        find_worktree_for_identity(&conn, HOST, &acme, "p2")
            .unwrap()
            .as_deref(),
        Some("wt-a2")
    );
    assert_eq!(list_for_project(&conn, HOST, "p1").unwrap().len(), 2);
    assert_eq!(list_for_project(&conn, HOST, "p2").unwrap().len(), 1);
}

/// HOST SCOPE: the same issue on a different Drogon host binds separately —
/// sessions are host-scoped, so "reopen the correct session" is per host.
#[test]
fn bindings_are_scoped_per_host() {
    let conn = fixture_db();
    let id = provisional("https://acme.atlassian.net", "10001", "DROG-42");
    add_worktree(&conn, "wt-h1", "p1");
    add_worktree(&conn, "wt-h2", "p1");
    link_existing(&conn, "host-1", &id, "p1", "wt-h1", None, None).unwrap();
    link_existing(&conn, "host-2", &id, "p1", "wt-h2", None, None).unwrap();
    assert_eq!(
        find_worktree_for_identity(&conn, "host-1", &id, "p1")
            .unwrap()
            .as_deref(),
        Some("wt-h1")
    );
    assert_eq!(
        find_worktree_for_identity(&conn, "host-2", &id, "p1")
            .unwrap()
            .as_deref(),
        Some("wt-h2")
    );
    assert!(find_link(&conn, "host-3", &id, "p1").unwrap().is_none());
}

/// Acceptance 2: rename title/key and reconnect the same endpoint with
/// another account — the stable link survives and no credential identity
/// participates anywhere. The tier is explicit: a configured URL binds
/// PROVISIONALLY, and a source-backed identifier is its own namespaced row.
#[test]
fn rename_and_reconnect_survive_without_cross_account_reuse() {
    let conn = fixture_db();
    add_worktree(&conn, "wt-1", "p1");
    add_session(&conn, "s-1", "live");
    let original = provisional("https://acme.atlassian.net", "10001", "DROG-42");
    let link = link_existing(
        &conn,
        HOST,
        &original,
        "p1",
        "wt-1",
        Some("ws-1"),
        Some("s-1"),
    )
    .unwrap();
    assert_eq!(link.instance_tier, InstanceTier::Provisional);
    // Another account, renamed key: same endpoint label + immutable id →
    // the SAME provisional binding answers.
    let reconnected = provisional("https://acme.atlassian.net/", "10001", "OPS-77");
    let found = find_link(&conn, HOST, &reconnected, "p1").unwrap().unwrap();
    assert_eq!(found.worktree_id, "wt-1");
    assert_eq!(found.session_id.as_deref(), Some("s-1"));
    // A source-backed identifier is a DIFFERENT, namespaced row — the
    // identity of record, never forged by the configured URL.
    let verified = verified("https://acme.atlassian.net", "10001", "DROG-42");
    assert!(find_link(&conn, HOST, &verified, "p1").unwrap().is_none());
    let vlink = link_existing(
        &conn,
        HOST,
        &verified,
        "p1",
        "wt-1",
        Some("ws-1"),
        Some("s-1"),
    )
    .unwrap();
    assert_eq!(vlink.instance_tier, InstanceTier::SourceBacked);
    assert_eq!(vlink.instance_source.as_deref(), Some("cloud-tenant-id"));
    assert_ne!(vlink.link_id(), found.link_id());
    // No account email anywhere in the stored rows.
    assert_eq!(list_for_project(&conn, HOST, "p1").unwrap().len(), 2);
}

/// Acceptance 3: concurrent/replayed starts create one logical binding; a
/// fixture failure after the worktree checkpoint and before the session
/// receipt recovers without duplicating or stealing resources.
#[test]
fn replayed_start_and_partial_creation_recover_without_duplication() {
    let conn = fixture_db();
    let id = provisional("https://acme.atlassian.net", "10001", "DROG-42");
    assert!(matches!(
        begin_intent(&conn, HOST, &id, "p1", "intent-1").unwrap(),
        BeginIntentOutcome::Began
    ));
    // Double click with a fresh intent id joins the in-flight start.
    assert!(matches!(
        begin_intent(&conn, HOST, &id, "p1", "intent-2").unwrap(),
        BeginIntentOutcome::InFlight { ref intent_id, .. } if intent_id == "intent-1"
    ));
    // The shared worktree path returned; the daemon checkpoints BEFORE the
    // harness launch, then "dies" before the session receipt.
    add_worktree(&conn, "wt-1", "p1");
    record_created_worktree(&conn, HOST, &id, "p1", "intent-1", "wt-1", Some("ws-1")).unwrap();
    // Restart: recovery adopts exactly the recorded worktree, and a replayed
    // intent sees the same pending binding instead of creating another.
    let recovery = find_pending_recovery(&conn, HOST, &id, "p1")
        .unwrap()
        .unwrap();
    assert_eq!(recovery.worktree_id, "wt-1");
    assert!(matches!(
        begin_intent(&conn, HOST, &id, "p1", "intent-3").unwrap(),
        BeginIntentOutcome::Linked(ref l)
            if l.worktree_id == "wt-1" && l.state == LinkState::Pending
    ));
    let link = complete_intent(&conn, "intent-1", Some("s-1")).unwrap();
    assert_eq!(link.worktree_id, "wt-1");
    assert_eq!(link.session_id.as_deref(), Some("s-1"));
    assert_eq!(list_for_project(&conn, HOST, "p1").unwrap().len(), 1);
    // A vanished checkpoint is never adopted.
    let other = provisional("https://acme.atlassian.net", "10002", "DROG-43");
    begin_intent(&conn, HOST, &other, "p1", "intent-9").unwrap();
    record_created_worktree(&conn, HOST, &other, "p1", "intent-9", "wt-1", None).unwrap();
    conn.execute("DELETE FROM worktrees WHERE id = 'wt-1'", [])
        .unwrap();
    assert!(
        find_pending_recovery(&conn, HOST, &other, "p1")
            .unwrap()
            .is_none()
    );
    abandon_intent(&conn, "intent-9", "worktree vanished").unwrap();
    assert!(find_link(&conn, HOST, &other, "p1").unwrap().is_none());
}

/// Acceptance 4: link/unlink/restart round trip preserves the session and
/// historical run records.
#[test]
fn link_unlink_restart_round_trip_preserves_records() {
    let conn = fixture_db();
    let id = provisional("https://acme.atlassian.net", "10001", "DROG-42");
    add_worktree(&conn, "wt-1", "p1");
    add_session(&conn, "s-1", "exited");
    add_session(&conn, "s-2", "live");
    let link = link_existing(&conn, HOST, &id, "p1", "wt-1", Some("ws-1"), Some("s-1")).unwrap();
    assert_eq!(
        resolve_session_state(&conn, &link).unwrap(),
        SessionResolution::Exited
    );
    assert!(unlink(&conn, HOST, &id, "p1").unwrap());
    let worktrees: i64 = conn
        .query_row("SELECT COUNT(*) FROM worktrees", [], |r| r.get(0))
        .unwrap();
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!((worktrees, sessions), (1, 2));
    // Restart of the binding onto the newer session; history keeps all.
    let relinked =
        link_existing(&conn, HOST, &id, "p1", "wt-1", Some("ws-1"), Some("s-2")).unwrap();
    assert_eq!(
        resolve_session_state(&conn, &relinked).unwrap(),
        SessionResolution::Live
    );
    let events = history_for_project(&conn, HOST, "p1").unwrap();
    let names: Vec<&str> = events.iter().map(|e| e.event.as_str()).collect();
    assert_eq!(names, vec!["linked", "unlinked", "linked"]);
}

/// Acceptance 5 (data layer half): live/unverifiable/exited/no-session are
/// distinct, and loss of contact (missing row, unknown verdict) never
/// proves exit.
#[test]
fn session_resolution_is_distinct_and_loss_of_contact_is_unverifiable() {
    fn placeholder(session: Option<&str>) -> JiraSessionLink {
        JiraSessionLink {
            host_id: HOST.to_string(),
            instance_key: "provisional:x".to_string(),
            instance_tier: InstanceTier::Provisional,
            instance_source: None,
            instance_url: String::new(),
            issue_id: String::new(),
            key: String::new(),
            project_id: String::new(),
            worktree_id: String::new(),
            workspace_id: None,
            session_id: session.map(str::to_string),
            conversation_id: None,
            intent_id: String::new(),
            state: LinkState::Pending,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
    let conn = fixture_db();
    add_session(&conn, "s-live", "live");
    add_session(&conn, "s-exited", "exited");
    add_session(&conn, "s-unver", "unverifiable");
    add_session(&conn, "s-future", "some-future-verdict");
    assert_eq!(
        resolve_session_state(&conn, &placeholder(Some("s-live"))).unwrap(),
        SessionResolution::Live
    );
    assert_eq!(
        resolve_session_state(&conn, &placeholder(Some("s-exited"))).unwrap(),
        SessionResolution::Exited
    );
    assert_eq!(
        resolve_session_state(&conn, &placeholder(Some("s-unver"))).unwrap(),
        SessionResolution::Unverifiable
    );
    assert_eq!(
        resolve_session_state(&conn, &placeholder(Some("s-future"))).unwrap(),
        SessionResolution::Unverifiable
    );
    assert_eq!(
        resolve_session_state(&conn, &placeholder(Some("s-missing"))).unwrap(),
        SessionResolution::Unverifiable
    );
    assert_eq!(
        resolve_session_state(&conn, &placeholder(None)).unwrap(),
        SessionResolution::NoSession
    );
    // The wire labels stay stable for the renderer contract.
    assert_eq!(SessionResolution::Live.as_str(), "live");
    assert_eq!(SessionResolution::Unverifiable.as_str(), "unverifiable");
    assert_eq!(SessionResolution::Exited.as_str(), "exited");
    assert_eq!(SessionResolution::NoSession.as_str(), "no-session");
}

/// The identity gate: legacy bindings without a resolved endpoint and
/// immutable issue id stay unresolved — never guessed from the account
/// email or the display key.
#[test]
fn unresolved_legacy_stays_unresolved() {
    assert!(
        JiraTaskIdentity::resolve_provisional("https://acme.atlassian.net", "", "DROG-42").is_err()
    );
    assert!(JiraTaskIdentity::resolve_provisional("", "10001", "DROG-42").is_err());
    // The key alone never identifies: two ids on one endpoint differ.
    let a = provisional("https://acme.atlassian.net", "10001", "DROG-42");
    let b = provisional("https://acme.atlassian.net", "10002", "DROG-42");
    assert_ne!(a.link_id(), b.link_id());
}
