//! C11 local Bot assignment domain tests: set/replace/clear with expected
//! version, scope isolation, host fencing, deleted-Bot honesty and history
//! preservation. The module is compiled standalone via `#[path]` until the
//! held `jira/mod.rs` absorbs it; these tests drive it directly against a
//! temp-dir SQLite file, exactly the controlled-filesystem + pure-computation
//! slice allowed by the task — no Engine construction, no daemon, no HTTP, no
//! harness child, no Jira client anywhere in the path (that absence is the
//! zero-remote-writes property, enforced by construction).

#[path = "../src/jira/bot_assignment.rs"]
mod bot_assignment;

use bot_assignment::{
    AssignmentAction, AssignmentError, AssignmentScope, BotState, ExpectedVersion, TaskProvider,
    assign_bot, assignment_history, clear_assignment, read_assignment,
};
use rusqlite::Connection;
use tempfile::TempDir;

/// The `bots` table exactly as `bots::storage` creates it, plus one fixture
/// Bot per call — assignment scope-checks resolve against this real shape.
fn seed_db(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bots (
            id TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            updated_at REAL NOT NULL,
            rev INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL
        );",
    )
    .unwrap();
}

fn seed_bot(conn: &Connection, id: &str, host_id: &str, folder: &str, name: &str) {
    conn.execute(
        "INSERT INTO bots (id, host_id, folder, updated_at, payload_json) VALUES (?1, ?2, ?3, 0, ?4)",
        rusqlite::params![
            id,
            host_id,
            folder,
            format!(
                r#"{{"id":"{id}","displayIdentity":{{"displayName":"{name}"}}}}"#
            )
        ],
    )
    .unwrap();
}

fn scope(host: &str, project: &str, instance: &str, task: &str) -> AssignmentScope {
    AssignmentScope {
        host_id: host.to_string(),
        project_id: project.to_string(),
        provider: TaskProvider::Jira,
        instance: instance.to_string(),
        task_id: task.to_string(),
    }
}

fn jira_scope(host: &str, project: &str, site: &str, issue_id: &str) -> AssignmentScope {
    scope(host, project, site, issue_id)
}

fn open_db(dir: &TempDir) -> Connection {
    let conn = Connection::open(dir.path().join("drogon.db")).unwrap();
    seed_db(&conn);
    conn
}

// --- happy path -------------------------------------------------------------

#[test]
fn assign_then_read_round_trips_with_version_one_and_live_name() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");

    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    let assigned = assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, Some("req-1")).unwrap();
    assert_eq!(assigned.record.version, 1);
    assert_eq!(assigned.record.bot_id, "bot-1");
    assert_eq!(assigned.record.bot_folder, "ws-1");
    assert_eq!(assigned.record.bot_name, "Muse");
    assert_eq!(assigned.bot_state, BotState::Active);
    assert_eq!(assigned.record.scope.task_id, "10001");

    let read = read_assignment(&conn, &s).unwrap().unwrap();
    assert_eq!(read.record.version, 1);
    assert_eq!(read.bot_state, BotState::Active);
    assert!(read.record.assigned_at.ends_with('Z'));
}

#[test]
fn unassigned_reads_none() {
    let dir = TempDir::new().unwrap();
    let conn = open_db(&dir);
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assert!(read_assignment(&conn, &s).unwrap().is_none());
    assert!(assignment_history(&conn, &s).unwrap().is_empty());
}

#[test]
fn bot_rename_flows_through_read_without_reassignment() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();

    conn.execute(
        "UPDATE bots SET payload_json = ?1 WHERE id = 'bot-1'",
        rusqlite::params![r#"{"displayIdentity":{"displayName":"Muse Spark"}}"#],
    )
    .unwrap();
    let read = read_assignment(&conn, &s).unwrap().unwrap();
    assert_eq!(read.record.bot_name, "Muse Spark");
    // The version did not move: a rename is not a mutation of the assignment.
    assert_eq!(read.record.version, 1);
}

// --- concurrency ------------------------------------------------------------

#[test]
fn concurrent_expected_version_updates_cannot_silently_overwrite() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    seed_bot(&conn, "bot-2", "host-a", "ws-1", "Luna");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");

    let first = assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();
    assert_eq!(first.record.version, 1);

    // Two surfaces both read version 1 and both try to replace it.
    let winner = assign_bot(&mut conn, &s, "bot-2", ExpectedVersion::Version(1), None).unwrap();
    assert_eq!(winner.record.version, 2);
    let loser = assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::Version(1), None);
    assert_eq!(
        loser.unwrap_err(),
        AssignmentError::VersionConflict {
            expected: Some(1),
            current: Some(2),
        }
    );

    // The stored assignment is exactly the winner's, version 2.
    let read = read_assignment(&conn, &s).unwrap().unwrap();
    assert_eq!(read.record.bot_id, "bot-2");
    assert_eq!(read.record.version, 2);
}

#[test]
fn new_expected_version_conflicts_when_an_assignment_exists() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();

    let err = assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap_err();
    assert_eq!(
        err,
        AssignmentError::VersionConflict {
            expected: None,
            current: Some(1),
        }
    );
}

#[test]
fn clear_conflicts_on_stale_version_and_zero_is_never_a_version() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();

    assert_eq!(
        clear_assignment(&mut conn, &s, ExpectedVersion::Version(9), None).unwrap_err(),
        AssignmentError::VersionConflict {
            expected: Some(9),
            current: Some(1),
        }
    );
    assert!(ExpectedVersion::from_wire(Some(0)).is_err());
    assert_eq!(
        ExpectedVersion::from_wire(None).unwrap(),
        ExpectedVersion::New
    );
    assert_eq!(
        ExpectedVersion::from_wire(Some(3)).unwrap(),
        ExpectedVersion::Version(3)
    );
}

#[test]
fn clear_removes_the_row_appends_history_and_second_clear_is_a_noop() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();

    clear_assignment(
        &mut conn,
        &s,
        ExpectedVersion::Version(1),
        Some("req-clear"),
    )
    .unwrap();
    assert!(read_assignment(&conn, &s).unwrap().is_none());

    // Clearing again (nothing assigned, expected New) holds the requested
    // end state, so it is a no-op rather than a conflict.
    clear_assignment(&mut conn, &s, ExpectedVersion::New, None).unwrap();
    // ...but clearing with a version when nothing exists reports the truth.
    assert_eq!(
        clear_assignment(&mut conn, &s, ExpectedVersion::Version(1), None).unwrap_err(),
        AssignmentError::VersionConflict {
            expected: Some(1),
            current: None,
        }
    );

    let history = assignment_history(&conn, &s).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].action, AssignmentAction::Assigned);
    assert_eq!(history[1].action, AssignmentAction::Cleared);
    assert_eq!(history[1].version, 2);
    assert_eq!(history[1].bot_name, "Muse");
    assert_eq!(history[1].bot_id, None);
}

// --- scope isolation --------------------------------------------------------

#[test]
fn same_issue_identity_across_projects_and_instances_stays_isolated() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    seed_bot(&conn, "bot-2", "host-a", "ws-2", "Luna");

    let in_proj1 = jira_scope("host-a", "proj-1", "site-x", "10001");
    let in_proj2 = jira_scope("host-a", "proj-2", "site-x", "10001");
    let on_site_y = jira_scope("host-a", "proj-1", "site-y", "10001");

    assign_bot(&mut conn, &in_proj1, "bot-1", ExpectedVersion::New, None).unwrap();
    assign_bot(&mut conn, &in_proj2, "bot-2", ExpectedVersion::New, None).unwrap();
    assign_bot(&mut conn, &on_site_y, "bot-2", ExpectedVersion::New, None).unwrap();

    // Each scope sees only its own Bot; mutating proj-2 never touches proj-1.
    assert_eq!(
        read_assignment(&conn, &in_proj1)
            .unwrap()
            .unwrap()
            .record
            .bot_id,
        "bot-1"
    );
    assert_eq!(
        read_assignment(&conn, &in_proj2)
            .unwrap()
            .unwrap()
            .record
            .bot_id,
        "bot-2"
    );
    assert_eq!(
        read_assignment(&conn, &on_site_y)
            .unwrap()
            .unwrap()
            .record
            .bot_id,
        "bot-2"
    );
    clear_assignment(&mut conn, &in_proj2, ExpectedVersion::Version(1), None).unwrap();
    assert!(read_assignment(&conn, &in_proj1).unwrap().is_some());
    assert!(read_assignment(&conn, &in_proj2).unwrap().is_none());
    assert!(read_assignment(&conn, &on_site_y).unwrap().is_some());
}

#[test]
fn scope_validation_rejects_blank_oversized_and_unknown_provider_fields() {
    let mut blank = jira_scope("host-a", "proj-1", "site-x", "10001");
    blank.task_id = "   ".to_string();
    assert!(matches!(
        blank.validate(),
        Err(AssignmentError::InvalidScope(_))
    ));

    let mut oversized = jira_scope("host-a", "proj-1", "site-x", "10001");
    oversized.instance = "x".repeat(513);
    assert!(matches!(
        oversized.validate(),
        Err(AssignmentError::InvalidScope(_))
    ));

    assert!(TaskProvider::parse("linear").is_err());
    assert_eq!(TaskProvider::parse("github").unwrap(), TaskProvider::Github);

    // Whitespace is trimmed, not rejected, so an honest identity with stray
    // padding still lands normalized.
    let padded = scope("  host-a  ", "proj-1", "site-x", "10001");
    let checked = padded.validate().unwrap();
    assert_eq!(checked.host_id, "host-a");
}

// --- bot scope fencing ------------------------------------------------------

#[test]
fn backend_rejects_a_bot_from_another_host() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-other", "host-b", "ws-1", "RemoteHostBot");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");

    let err = assign_bot(&mut conn, &s, "bot-other", ExpectedVersion::New, None).unwrap_err();
    assert_eq!(
        err,
        AssignmentError::BotHostMismatch {
            bot_id: "bot-other".to_string(),
            bot_host: "host-b".to_string(),
            assignment_host: "host-a".to_string(),
        }
    );
    // Nothing was written.
    assert!(read_assignment(&conn, &s).unwrap().is_none());
}

#[test]
fn backend_rejects_a_missing_bot_before_touching_the_row() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assert_eq!(
        assign_bot(&mut conn, &s, "ghost", ExpectedVersion::New, None).unwrap_err(),
        AssignmentError::BotNotFound {
            bot_id: "ghost".to_string(),
        }
    );
    // A stale-version replace against a missing bot is also refused.
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();
    assert!(matches!(
        assign_bot(&mut conn, &s, "ghost", ExpectedVersion::Version(1), None),
        Err(AssignmentError::BotNotFound { .. })
    ));
}

#[test]
fn empty_bot_id_is_refused() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assert!(matches!(
        assign_bot(&mut conn, &s, "  ", ExpectedVersion::New, None),
        Err(AssignmentError::InvalidScope(_))
    ));
}

// --- deleted bot honesty + history preservation ------------------------------

#[test]
fn deleted_bot_reads_as_deleted_preserving_row_and_history() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();

    // `bot.delete` removes the bot row; the assignment must NOT silently
    // disappear or rewrite itself.
    conn.execute("DELETE FROM bots WHERE id = 'bot-1'", [])
        .unwrap();
    let read = read_assignment(&conn, &s).unwrap().unwrap();
    assert_eq!(read.bot_state, BotState::Deleted);
    assert_eq!(read.record.bot_id, "bot-1");
    // The assignment-time name snapshot still displays.
    assert_eq!(read.record.bot_name, "Muse");

    let history = assignment_history(&conn, &s).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].bot_id.as_deref(), Some("bot-1"));
    assert_eq!(history[0].bot_name, "Muse");
}

#[test]
fn bot_moved_to_another_host_reads_as_deleted_for_this_host() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();
    conn.execute("UPDATE bots SET host_id = 'host-b' WHERE id = 'bot-1'", [])
        .unwrap();
    assert_eq!(
        read_assignment(&conn, &s).unwrap().unwrap().bot_state,
        BotState::Deleted
    );
}

#[test]
fn reassigning_after_deletion_works_and_keeps_the_whole_history() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    seed_bot(&conn, "bot-2", "host-a", "ws-1", "Luna");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();
    conn.execute("DELETE FROM bots WHERE id = 'bot-1'", [])
        .unwrap();

    let reassigned = assign_bot(&mut conn, &s, "bot-2", ExpectedVersion::Version(1), None).unwrap();
    assert_eq!(reassigned.record.version, 2);
    assert_eq!(reassigned.bot_state, BotState::Active);

    let history = assignment_history(&conn, &s).unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].action, AssignmentAction::Assigned);
    assert_eq!(history[0].bot_name, "Muse");
    assert_eq!(history[1].action, AssignmentAction::Replaced);
    assert_eq!(history[1].bot_name, "Luna");
}

// --- history semantics -------------------------------------------------------

#[test]
fn history_records_the_full_assigned_replaced_cleared_story() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    seed_bot(&conn, "bot-2", "host-a", "ws-1", "Luna");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");

    assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, Some("r1")).unwrap();
    assign_bot(
        &mut conn,
        &s,
        "bot-2",
        ExpectedVersion::Version(1),
        Some("r2"),
    )
    .unwrap();
    clear_assignment(&mut conn, &s, ExpectedVersion::Version(2), Some("r3")).unwrap();

    let history = assignment_history(&conn, &s).unwrap();
    let actions: Vec<_> = history.iter().map(|e| e.action).collect();
    assert_eq!(
        actions,
        vec![
            AssignmentAction::Assigned,
            AssignmentAction::Replaced,
            AssignmentAction::Cleared,
        ]
    );
    let versions: Vec<u64> = history.iter().map(|e| e.version).collect();
    assert_eq!(versions, vec![1, 2, 3]);
    assert_eq!(history[0].request_id.as_deref(), Some("r1"));
    assert_eq!(history[2].request_id.as_deref(), Some("r3"));
    assert_eq!(history[1].bot_id.as_deref(), Some("bot-2"));
}

#[test]
fn history_is_scoped_like_assignments() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let s1 = jira_scope("host-a", "proj-1", "site-x", "10001");
    let s2 = jira_scope("host-a", "proj-2", "site-x", "10001");
    assign_bot(&mut conn, &s1, "bot-1", ExpectedVersion::New, None).unwrap();
    assert!(assignment_history(&conn, &s2).unwrap().is_empty());
    assert_eq!(assignment_history(&conn, &s1).unwrap().len(), 1);
}

// --- durability --------------------------------------------------------------

#[test]
fn assignment_survives_reopening_the_database() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("drogon.db");
    let s = jira_scope("host-a", "proj-1", "site-x", "10001");
    {
        let mut conn = Connection::open(&path).unwrap();
        seed_db(&conn);
        seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
        assign_bot(&mut conn, &s, "bot-1", ExpectedVersion::New, None).unwrap();
    }
    // Restart proxy: a fresh connection to the same data file (what a
    // relaunched daemon reopens) still sees the durable assignment and its
    // history. Restart/mounted-surface acceptance stays with the released
    // integration seams; this pins the storage layer itself.
    let conn = Connection::open(&path).unwrap();
    let read = read_assignment(&conn, &s).unwrap().unwrap();
    assert_eq!(read.record.bot_id, "bot-1");
    assert_eq!(read.record.version, 1);
    assert_eq!(read.bot_state, BotState::Active);
    assert_eq!(assignment_history(&conn, &s).unwrap().len(), 1);
}

#[test]
fn github_tasks_share_the_same_api_through_their_own_provider_scope() {
    let dir = TempDir::new().unwrap();
    let mut conn = open_db(&dir);
    seed_bot(&conn, "bot-1", "host-a", "ws-1", "Muse");
    let github = AssignmentScope {
        host_id: "host-a".to_string(),
        project_id: "proj-1".to_string(),
        provider: TaskProvider::Github,
        instance: "clioo/drogon".to_string(),
        task_id: "42".to_string(),
    };
    assign_bot(&mut conn, &github, "bot-1", ExpectedVersion::New, None).unwrap();
    assert_eq!(
        read_assignment(&conn, &github)
            .unwrap()
            .unwrap()
            .record
            .bot_id,
        "bot-1"
    );
    // The Jira task with coincidentally equal fields is a different scope.
    let jira_same_numbers = jira_scope("host-a", "proj-1", "clioo/drogon", "42");
    assert!(
        read_assignment(&conn, &jira_same_numbers)
            .unwrap()
            .is_none()
    );
}
