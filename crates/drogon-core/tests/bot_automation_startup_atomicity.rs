//! Real single-transaction aggregate startup atomicity for `Engine::open`
//! (`db::migrate_and_recover`, see `docs/migration/bot-state-admission.md`).
//!
//! This supersedes the weaker "precheck, then let each component commit
//! its own steps independently" gate from an earlier revision, which this
//! task's root review explicitly rejected: `Engine::open` used to create
//! the main schema unconditionally (auto-committing immediately, before
//! any capability-schema check ever ran), and separately ran
//! prior-instance session/request recovery before the capability check
//! too -- so a startup attempt that ultimately failed could still have
//! durably created tables and flipped `pending`/`live` rows to
//! `unverifiable`/`done`. Every test below drives the real `Engine::open`
//! entry point (not `db::migrate_and_recover` or either storage module's
//! `migrate` called directly), takes a snapshot of every schema/content
//! fact this task cares about before the call, and asserts the snapshot
//! is byte-for-byte identical afterward whenever `Engine::open` returns an
//! error -- proving refusal/rollback leaves no persisted trace at all.

use std::sync::{Arc, Barrier};
use std::thread;

use drogon_core::{DB_FILE_NAME, Engine};
use rusqlite::{Connection, OptionalExtension};

/// Every schema/content fact this task's atomicity guarantee covers,
/// captured generically enough to reuse across all five scenarios below.
#[derive(Debug, PartialEq, Eq, Clone)]
struct Snapshot {
    /// `(name, sql)` for every table/index/view/trigger in `sqlite_master`,
    /// sorted -- catches both "a table exists that shouldn't" and "an
    /// existing table's definition silently changed".
    schema_objects: Vec<(String, String)>,
    schema_versions: Vec<(String, i64)>,
    /// `(id, verdict)` for every session row.
    sessions: Vec<(String, String)>,
    /// `(request_id, status, error_json)` for every request row.
    requests: Vec<(String, String, Option<String>)>,
    host_id: Option<String>,
}

fn snapshot(conn: &Connection) -> Snapshot {
    let has_table = |name: &str| -> bool {
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    };

    let schema_objects = {
        let mut stmt = conn
            .prepare("SELECT name, COALESCE(sql, '') FROM sqlite_master ORDER BY name")
            .unwrap();
        let mut rows: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        rows.sort();
        rows
    };

    let schema_versions = if has_table("schema_versions") {
        let mut stmt = conn
            .prepare("SELECT component, version FROM schema_versions ORDER BY component")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    } else {
        Vec::new()
    };

    let sessions = if has_table("sessions") {
        let mut stmt = conn
            .prepare("SELECT id, verdict FROM sessions ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    } else {
        Vec::new()
    };

    let requests = if has_table("requests") {
        let mut stmt = conn
            .prepare("SELECT request_id, status, error_json FROM requests ORDER BY request_id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    } else {
        Vec::new()
    };

    let host_id = if has_table("meta") {
        conn.query_row("SELECT value FROM meta WHERE key = 'host_id'", [], |r| {
            r.get(0)
        })
        .optional()
        .unwrap()
    } else {
        None
    };

    Snapshot {
        schema_objects,
        schema_versions,
        sessions,
        requests,
        host_id,
    }
}

fn open_conn(dir: &std::path::Path) -> Connection {
    Connection::open(dir.join(DB_FILE_NAME)).unwrap()
}

// --- Scenario 1: future Bots version, main tables missing, older (but --
// --- supported) Automations ------------------------------------------------

#[test]
fn refused_future_bots_version_leaves_missing_main_tables_missing_and_older_automations_untouched()
{
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join(DB_FILE_NAME);
    {
        // A genuine, real v1 `automations` schema (older than current, but
        // supported) sharing the connection with a `bots` version this
        // build cannot support. No main tables exist yet at all.
        let c = Connection::open(&db_path).unwrap();
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             CREATE TABLE automations (
                id TEXT PRIMARY KEY, bot_id TEXT, payload_json TEXT NOT NULL
             );
             CREATE INDEX automations_bot_id ON automations(bot_id);
             CREATE TABLE automation_runs (
                id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, payload_json TEXT NOT NULL
             );
             CREATE INDEX automation_runs_automation_id ON automation_runs(automation_id);
             INSERT INTO schema_versions(component, version) VALUES ('automations', 1);
             INSERT INTO schema_versions(component, version) VALUES ('bots', 999);",
        )
        .unwrap();
    }

    let before = snapshot(&open_conn(dir.path()));
    let result = Engine::open(dir.path());
    assert!(
        result.is_err(),
        "a future-versioned bots schema must refuse Engine::open"
    );
    let after = snapshot(&open_conn(dir.path()));

    assert_eq!(
        before, after,
        "a refused Engine::open must not create the main schema, advance automations, \
         or touch anything else, even though automations alone was at a supported version"
    );
    assert!(
        !after
            .schema_objects
            .iter()
            .any(|(name, _)| name == "sessions"
                || name == "workspaces"
                || name == "requests"
                || name == "meta"),
        "main tables must not exist after a refused aggregate startup gate"
    );
    assert_eq!(
        after.schema_versions,
        vec![("automations".to_string(), 1), ("bots".to_string(), 999)],
        "automations must not have been advanced past 1 despite being independently supported"
    );
}

// --- Scenario 2: future Automation version, pending/live sessions, --------
// --- pending requests -------------------------------------------------------

#[test]
fn refused_future_automations_version_leaves_pending_live_sessions_and_requests_untouched() {
    let dir = tempfile::tempdir().unwrap();
    {
        // A fully-working Engine::open first, to get a real host id and a
        // fully current schema...
        let _engine = Engine::open(dir.path()).unwrap();
    }
    let db_path = dir.path().join(DB_FILE_NAME);
    {
        // ...then hand-plant exactly the state a crashed prior instance
        // would leave: a `live` session, a `pending` session, and a
        // `pending` request -- plus bump `automations` to a future version.
        let c = Connection::open(&db_path).unwrap();
        c.execute_batch(
            "INSERT INTO workspaces (id, path, name, kind, host_id, created_at)
                VALUES ('w1', '/repo', 'repo', 'git', 'h1', '2020-01-01T00:00:00Z');
             INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at)
                VALUES ('s-live', 'w1', 'h1', 'inc-1', '/bin/sh', '[]', 80, 24, 'live', NULL, '2020-01-01T00:00:00Z');
             INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at)
                VALUES ('s-pending', 'w1', 'h1', 'inc-2', '/bin/sh', '[]', 80, 24, 'pending', NULL, '2020-01-01T00:00:00Z');
             INSERT INTO requests (request_id, method, fingerprint, status, result_json, error_json, created_at)
                VALUES ('r-pending', 'session.start', 'fp', 'pending', NULL, NULL, '2020-01-01T00:00:00Z');
             UPDATE schema_versions SET version = 999 WHERE component = 'automations';",
        )
        .unwrap();
    }

    let before = snapshot(&open_conn(dir.path()));
    let result = Engine::open(dir.path());
    assert!(
        result.is_err(),
        "a future-versioned automations schema must refuse Engine::open"
    );
    let after = snapshot(&open_conn(dir.path()));

    assert_eq!(
        before, after,
        "a refused Engine::open must not run prior-instance recovery: 'live'/'pending' \
         sessions and 'pending' requests must survive exactly as they were"
    );
    assert_eq!(
        after.sessions,
        vec![
            ("s-live".to_string(), "live".to_string()),
            ("s-pending".to_string(), "pending".to_string()),
        ]
    );
    assert_eq!(after.requests[0].1, "pending");
    assert!(after.requests[0].2.is_none());
}

// --- Scenario 3: supported-version late genuine SQL failure after an -----
// --- earlier component's migration could have advanced --------------------

#[test]
fn a_genuine_sql_failure_in_the_second_component_rolls_back_the_first_components_migration_too() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join(DB_FILE_NAME);
    {
        // `automations` at a genuine, real v1 schema (must step to v2).
        // `bots` also at a genuine, real v1 schema (must step to v2) --
        // but a rogue TABLE occupies the exact name `bots`'s v1->v2 step
        // needs for a `CREATE UNIQUE INDEX IF NOT EXISTS`, which SQLite
        // refuses (a real, deterministic SQL error) even with
        // `IF NOT EXISTS`, because the existing object is a different
        // kind (table, not index) with that name.
        let c = Connection::open(&db_path).unwrap();
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             CREATE TABLE automations (
                id TEXT PRIMARY KEY, bot_id TEXT, payload_json TEXT NOT NULL
             );
             CREATE INDEX automations_bot_id ON automations(bot_id);
             CREATE TABLE automation_runs (
                id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, payload_json TEXT NOT NULL
             );
             CREATE INDEX automation_runs_automation_id ON automation_runs(automation_id);
             INSERT INTO schema_versions(component, version) VALUES ('automations', 1);

             CREATE TABLE bots (
                id TEXT PRIMARY KEY, host_id TEXT NOT NULL, folder TEXT NOT NULL,
                updated_at REAL NOT NULL, payload_json TEXT NOT NULL
             );
             CREATE INDEX bots_scope ON bots(host_id, folder);
             CREATE TABLE bot_responsibility_runs (
                id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, automation_run_id TEXT,
                started_at REAL NOT NULL, payload_json TEXT NOT NULL
             );
             CREATE INDEX bot_responsibility_runs_bot_id ON bot_responsibility_runs(bot_id);
             INSERT INTO schema_versions(component, version) VALUES ('bots', 1);
             -- The deliberate conflict: a real TABLE with the exact name
             -- the bots v1->v2 step wants to create as a UNIQUE INDEX.
             CREATE TABLE bot_responsibility_runs_dedupe (poison INTEGER);",
        )
        .unwrap();
    }

    let before = snapshot(&open_conn(dir.path()));
    let result = Engine::open(dir.path());
    assert!(
        result.is_err(),
        "a genuine SQL failure partway through the aggregate gate must surface as an error"
    );
    let after = snapshot(&open_conn(dir.path()));

    assert_eq!(
        before, after,
        "automations' own successful v1->v2 step must be rolled back too, even though \
         only bots' step hit the genuine SQL error -- both are the same transaction"
    );
    assert_eq!(
        after.schema_versions,
        vec![("automations".to_string(), 1), ("bots".to_string(), 1)],
        "neither component may be recorded as having advanced past 1"
    );
    assert!(
        !after
            .schema_objects
            .iter()
            .any(|(name, _)| name == "automation_runs_automation_id_id"),
        "automations' v2 index must not exist: its migration was rolled back with bots'"
    );
    assert!(
        !after
            .schema_objects
            .iter()
            .any(|(name, sql)| name == "bots" && sql.contains("rev")),
        "bots' v1->v2 ALTER TABLE ADD COLUMN rev must not have stuck either"
    );
}

// --- Scenario 4: reopen after a refusal/rollback is itself deterministic --
// --- and idempotent, with no cumulative drift across repeated attempts ----

#[test]
fn reopening_after_a_refusal_reproduces_the_identical_error_and_state_with_no_drift() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join(DB_FILE_NAME);
    {
        let c = Connection::open(&db_path).unwrap();
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions(component, version) VALUES ('bots', 999);",
        )
        .unwrap();
    }

    let snapshot_after_first = {
        let r1 = Engine::open(dir.path());
        assert!(r1.is_err());
        snapshot(&open_conn(dir.path()))
    };
    let snapshot_after_second = {
        let r2 = Engine::open(dir.path());
        assert!(r2.is_err());
        snapshot(&open_conn(dir.path()))
    };
    let snapshot_after_third = {
        let r3 = Engine::open(dir.path());
        assert!(r3.is_err());
        snapshot(&open_conn(dir.path()))
    };

    assert_eq!(
        snapshot_after_first, snapshot_after_second,
        "a second refused Engine::open must reproduce identical state, not accumulate drift"
    );
    assert_eq!(
        snapshot_after_second, snapshot_after_third,
        "a third refused Engine::open must still reproduce identical state"
    );
    assert_eq!(
        snapshot_after_first.schema_versions,
        vec![("bots".to_string(), 999)],
        "automations must never have been recorded across any of the three refused attempts"
    );
}

// --- Scenario 5: two concurrent real Engine::open calls against the same --
// --- data directory ----------------------------------------------------------

#[test]
fn two_concurrent_engine_open_calls_against_the_same_data_dir_both_succeed_consistently() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let barrier = Arc::new(Barrier::new(2));

    let (b1, p1) = (barrier.clone(), path.clone());
    let t1 = thread::spawn(move || {
        b1.wait();
        Engine::open(&p1)
    });
    let (b2, p2) = (barrier.clone(), path.clone());
    let t2 = thread::spawn(move || {
        b2.wait();
        Engine::open(&p2)
    });

    let r1 = t1.join().unwrap();
    let r2 = t2.join().unwrap();
    if let Err(e) = &r1 {
        panic!("first concurrent Engine::open must succeed: {e:?}");
    }
    if let Err(e) = &r2 {
        panic!("second concurrent Engine::open must succeed: {e:?}");
    }

    let conn = open_conn(dir.path());
    let final_snapshot = snapshot(&conn);
    assert_eq!(
        final_snapshot.schema_versions,
        vec![
            ("automations".to_string(), 2),
            ("bot_delegation".to_string(), 1),
            ("bot_monitors".to_string(), 2),
            ("bot_secrets".to_string(), 1),
            ("bot_self".to_string(), 1),
            ("bots".to_string(), 3),
            ("coordination_access".to_string(), 1),
            ("mentu".to_string(), 1),
            ("orchestration_attempts".to_string(), 1),
            ("orchestration_mail".to_string(), 1),
            ("projects".to_string(), 5),
            ("worker_resource_retention".to_string(), 1),
        ]
    );
    assert!(final_snapshot.host_id.is_some());
    // Both engines must agree on the same host id -- the loser of the
    // race read the winner's row rather than each creating its own.
    let e1 = r1.unwrap();
    let e2 = r2.unwrap();
    let status1 = e1.dispatch(req("status", "r1"));
    let status2 = e2.dispatch(req("status", "r2"));
    assert_eq!(
        status1.result.unwrap()["hostId"],
        status2.result.unwrap()["hostId"]
    );
}

fn req(method: &str, request_id: &str) -> drogon_protocol::Request {
    serde_json::from_value(serde_json::json!({
        "protocol": drogon_protocol::PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": {},
    }))
    .unwrap()
}
