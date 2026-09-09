//! Tests for [`super::PreparedSession`], [`super::WorkerEnvironment`],
//! [`super::reserve`], and [`super::launch_reserved`]: real isolated SQLite
//! plus real PTY echo probes. No mocked sessions.
//!
//! Synthetic secrets are compared internally as booleans only and never
//! printed; failure messages stay static.

#![cfg(unix)]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::{Connection, TransactionBehavior};

use super::{PreparedSession, WorkerEnvironment, launch_reserved, reserve};
use crate::coordination_identity::DispatchCredential;
use crate::session;

const READ_BUDGET: Duration = Duration::from_secs(5);

/// Scratch data dir for launches whose test never inspects the session
/// environment: it only feeds env strings and the shim-dir PATH entry.
fn no_dir() -> &'static std::path::Path {
    std::path::Path::new("/tmp")
}

#[test]
fn launch_refuses_an_open_transaction_before_spawning() {
    let db = Arc::new(open_fixture());
    let plan = reserve_committed(&db, "/tmp", "/bin/echo", &["must-not-launch".into()]);
    db.lock().unwrap().execute_batch("BEGIN IMMEDIATE").unwrap();
    let result = launch_reserved(db.clone(), no_dir(), plan, None, &[]);
    db.lock().unwrap().execute_batch("ROLLBACK").unwrap();
    if let Ok((_, handle, _)) = &result {
        stop_quietly(handle);
    }
    assert!(
        result.is_err(),
        "launch must never run while its connection is in a transaction"
    );
}

#[test]
fn launch_refuses_changed_creation_identity() {
    let db = Arc::new(open_fixture());
    let plan = reserve_committed(&db, "/tmp", "/bin/echo", &["must-not-launch".into()]);
    db.lock()
        .unwrap()
        .execute(
            "UPDATE sessions SET created_at = 'altered' WHERE id = ?1",
            [plan.session_id()],
        )
        .unwrap();
    let result = launch_reserved(db, no_dir(), plan, None, &[]);
    if let Ok((_, handle, _)) = &result {
        stop_quietly(handle);
    }
    assert!(
        result.is_err(),
        "persisted creation identity must match the reservation"
    );
}

fn open_fixture() -> Mutex<Connection> {
    let conn = Connection::open_in_memory().expect("in-memory fixture db");
    conn.execute_batch(
        "CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            host_id TEXT NOT NULL,
            incarnation TEXT NOT NULL,
            command TEXT NOT NULL,
            args_json TEXT NOT NULL,
            cols INTEGER NOT NULL,
            rows INTEGER NOT NULL,
            verdict TEXT NOT NULL,
            exit_code INTEGER,
            created_at TEXT NOT NULL,
            harness_id TEXT,
            parent_session_id TEXT
        );",
    )
    .expect("sessions schema");
    Mutex::new(conn)
}

fn begin_immediate(conn: &Connection) -> rusqlite::Transaction<'_> {
    rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate).expect("tx")
}

fn reserve_committed(
    db: &Mutex<Connection>,
    cwd: &str,
    command: &str,
    args: &[String],
) -> PreparedSession {
    let conn = db.lock().unwrap();
    let tx = begin_immediate(&conn);
    let plan = reserve(&tx, "host-1", "ws-1", cwd, command, args, None, None, 80, 24).expect("reserve");
    tx.commit().expect("commit reservation");
    plan
}

fn worker_env(
    plan: &PreparedSession,
    dir: &std::path::Path,
    credential: DispatchCredential,
) -> WorkerEnvironment {
    WorkerEnvironment::new(
        credential,
        "host-1",
        "run-1",
        "task-1",
        "dispatch-1",
        plan.session_id(),
        plan.incarnation(),
        dir.to_str().expect("utf8 dir"),
        "/usr/bin/drogon-cli",
    )
    .expect("valid worker env")
}

/// Drain retained PTY output until the probe marker appears or the budget
/// expires. Returns the collected text; callers assert booleans only.
fn read_text(handle: &session::SessionHandle, until: &str) -> String {
    let mut cursor = 0u64;
    let mut text = String::new();
    let deadline = Instant::now() + READ_BUDGET;
    while Instant::now() < deadline {
        let out = session::read(handle, cursor, 65_536).expect("read");
        cursor = out["nextCursor"].as_u64().expect("cursor");
        let bytes =
            session::base64_decode(out["dataBase64"].as_str().expect("base64")).expect("decode");
        text.push_str(&String::from_utf8_lossy(&bytes));
        if text.contains(until) {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    text
}

fn stop_quietly(handle: &session::SessionHandle) {
    let _ = session::stop(handle);
}

/// Stops the owned child on drop so a failed assertion cannot leave an
/// unowned process behind. Explicit stops stay; this is the backstop.
struct ChildGuard<'a> {
    handle: &'a session::SessionHandle,
}

impl Drop for ChildGuard<'_> {
    fn drop(&mut self) {
        let _ = session::stop(self.handle);
    }
}

#[test]
fn pending_row_visible_only_after_commit() {
    let dir = tempfile::tempdir().expect("isolated dir");
    let path = dir.path().join("admission.sqlite3");
    let conn_a = Connection::open(&path).expect("db A");
    conn_a
        .execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host_id TEXT NOT NULL,
                incarnation TEXT NOT NULL, command TEXT NOT NULL, args_json TEXT NOT NULL,
                cols INTEGER NOT NULL, rows INTEGER NOT NULL, verdict TEXT NOT NULL,
                exit_code INTEGER, created_at TEXT NOT NULL, harness_id TEXT,
                parent_session_id TEXT
            );",
        )
        .expect("schema");
    let conn_b = Connection::open(&path).expect("db B");

    let tx = begin_immediate(&conn_a);
    let plan = reserve(
        &tx,
        "host-1",
        "ws-1",
        "/tmp",
        "/bin/echo",
        &[],
        None,
        None,
        80,
        24,
    )
    .expect("reserve");
    let hidden: i64 = conn_b
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .expect("count");
    assert_eq!(hidden, 0, "uncommitted reservation must be invisible");
    tx.commit().expect("commit");
    let visible: i64 = conn_b
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND verdict = 'pending'",
            [&plan.session_id().to_string()],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(visible, 1);
}

#[test]
fn rollback_reservation_spawns_no_child() {
    let dir = tempfile::tempdir().expect("isolated dir");
    let marker = dir.path().join("spawned.marker");
    let db = open_fixture();
    let plan = {
        let conn = db.lock().unwrap();
        let tx = begin_immediate(&conn);
        reserve(
            &tx,
            "host-1",
            "ws-1",
            dir.path().to_str().expect("utf8"),
            "/bin/sh",
            &["-c".into(), format!("touch {}", marker.display())],
            None,
            None,
            80,
            24,
        )
        .expect("reserve")
        // No commit: the transaction rolls back when `tx` drops here.
    };
    let outcome = launch_reserved(Arc::new(db), no_dir(), plan, None, &[]);
    match outcome {
        Err(err) => assert_eq!(err.code, "unverifiable"),
        Ok((_, handle, _)) => {
            stop_quietly(&handle);
            panic!("rolled-back reservation must be refused");
        }
    }
    assert!(!marker.exists(), "rolled-back reservation must never spawn");
}

#[test]
fn launch_returns_exact_reserved_identity() {
    let db = Arc::new(open_fixture());
    let plan = reserve_committed(&db, "/tmp", "/bin/echo", &["hello".into()]);
    let expected_id = plan.session_id().to_string();
    let expected_incarnation = plan.incarnation().to_string();
    let expected_workspace = plan.workspace_id().to_string();
    let expected_host = plan.host_id().to_string();
    let (id, handle, _) = launch_reserved(db.clone(), no_dir(), plan, None, &[]).expect("launch");
    let _guard = ChildGuard { handle: &handle };
    assert_eq!(id, expected_id);
    assert_eq!(handle.session_id, expected_id);
    assert_eq!(handle.incarnation, expected_incarnation);
    assert_eq!(handle.workspace_id, expected_workspace);
    assert_eq!(handle.host_id, expected_host);
    stop_quietly(&handle);
}

#[test]
fn recovered_unverifiable_row_never_launches() {
    let dir = tempfile::tempdir().expect("isolated dir");
    let marker = dir.path().join("recovered.marker");
    let db = open_fixture();
    let plan = reserve_committed(
        &db,
        dir.path().to_str().expect("utf8"),
        "/bin/sh",
        &["-c".into(), format!("touch {}", marker.display())],
    );
    // Simulate crash recovery sweeping the pending row to `unverifiable`.
    db.lock()
        .unwrap()
        .execute(
            "UPDATE sessions SET verdict = 'unverifiable' WHERE id = ?1",
            [&plan.session_id().to_string()],
        )
        .expect("sweep");
    let outcome = launch_reserved(Arc::new(db), no_dir(), plan, None, &[]);
    match outcome {
        Err(err) => assert_eq!(err.code, "unverifiable"),
        Ok((_, handle, _)) => {
            stop_quietly(&handle);
            panic!("recovered row must be refused");
        }
    }
    assert!(!marker.exists(), "recovered row must never launch");
}

#[test]
fn altered_row_never_launches() {
    let dir = tempfile::tempdir().expect("isolated dir");
    let marker = dir.path().join("altered.marker");
    let db = open_fixture();
    let plan = reserve_committed(
        &db,
        dir.path().to_str().expect("utf8"),
        "/bin/sh",
        &["-c".into(), format!("touch {}", marker.display())],
    );
    db.lock()
        .unwrap()
        .execute(
            "UPDATE sessions SET command = '/bin/echo' WHERE id = ?1",
            [&plan.session_id().to_string()],
        )
        .expect("alter");
    let outcome = launch_reserved(Arc::new(db), no_dir(), plan, None, &[]);
    match outcome {
        Err(_) => {}
        Ok((_, handle, _)) => {
            stop_quietly(&handle);
            panic!("altered row must be refused");
        }
    }
    assert!(!marker.exists(), "altered row must never launch");
}

#[test]
fn default_spawn_matches_reserve_commit_launch() {
    // Seam-level pin: the unchanged `spawn` behaves as reserve + commit +
    // launch with no worker context.
    let db = Arc::new(open_fixture());
    let (id, handle, _) = session::spawn(
        db,
        no_dir(),
        "host-1".into(),
        "ws-1".into(),
        "/tmp",
        "/bin/echo".into(),
        vec!["hello".into()],
        None,
        None,
        80,
        24,
    )
    .expect("spawn");
    let _guard = ChildGuard { handle: &handle };
    assert!(!id.is_empty());
    assert_eq!(handle.session_id, id);
    stop_quietly(&handle);
}

#[test]
fn private_child_sees_scoped_context_without_leaks() {
    // The child echoes every expected ID (none secret) and reports the
    // capability's shape as booleans; the raw secret never traverses PTY.
    let dir = tempfile::tempdir().expect("isolated dir");
    let db = Arc::new(open_fixture());
    let plan = reserve_committed(
        &db,
        "/tmp",
        "/bin/sh",
        &[
            "-c".into(),
            r#"echo "IDS $DROGON_RUN_ID|$DROGON_TASK_ID|$DROGON_DISPATCH_ID|$DROGON_HOST_ID|$DROGON_SESSION_ID|$DROGON_SESSION_INCARNATION|$DROGON_DATA_DIR|$DROGON_CLI_COMMAND"; cap="$DROGON_DISPATCH_CAPABILITY"; [ "${#cap}" -eq 64 ] || echo "CAP-BAD-LEN"; case "$cap" in ""|*[!0-9a-f]*) echo "CAP-BAD-SHAPE";; esac; echo "SCOPED-PROBE-DONE""#.into(),
        ],
    );
    let expected_id = plan.session_id().to_string();
    let expected_incarnation = plan.incarnation().to_string();
    // The expected value is held locally for boolean comparison only; it is
    // never printed, even on failure.
    let credential = DispatchCredential::mint().expect("mint");
    let secret = credential.as_secret_str().to_string();
    let data_dir = dir.path().to_str().expect("utf8 dir").to_string();
    let env = worker_env(&plan, dir.path(), credential);
    let (id, handle, session_json) =
        launch_reserved(db.clone(), dir.path(), plan, Some(env), &[]).expect("launch");
    let _guard = ChildGuard { handle: &handle };
    assert_eq!(id, expected_id);

    let text = read_text(&handle, "SCOPED-PROBE-DONE");
    assert!(
        text.contains("SCOPED-PROBE-DONE"),
        "scoped probe must finish"
    );
    assert!(
        !text.contains(secret.as_str()),
        "PTY output must not disclose the capability"
    );
    let expected_line = format!(
        "IDS run-1|task-1|dispatch-1|host-1|{expected_id}|{expected_incarnation}|{data_dir}|/usr/bin/drogon-cli"
    );
    assert!(text.contains(&expected_line), "all scoped IDs must match");
    assert!(!text.contains("CAP-BAD"), "capability shape must hold");

    // The secret travels only through the private environment, never argv,
    // session JSON, the database row, or error surfaces.
    assert!(
        !format!("{:?}", handle.args).contains(secret.as_str()),
        "argv is clean"
    );
    assert!(
        !session_json.to_string().contains(secret.as_str()),
        "session JSON is clean"
    );
    let row: String = db
        .lock()
        .unwrap()
        .query_row(
            "SELECT command || args_json FROM sessions WHERE id = ?1",
            [&expected_id],
            |r| r.get(0),
        )
        .expect("row");
    assert!(!row.contains(secret.as_str()), "database row is clean");
    stop_quietly(&handle);
}

#[test]
fn worker_env_debug_and_errors_omit_secret() {
    let db = open_fixture();
    let plan = reserve_committed(&db, "/tmp", "/bin/echo", &[]);
    let credential = DispatchCredential::mint().expect("mint");
    let secret = credential.as_secret_str().to_string();
    let env = worker_env(&plan, std::path::Path::new("/tmp"), credential);
    assert!(
        !format!("{env:?}").contains(secret.as_str()),
        "env Debug is clean"
    );

    // Context bound to another reservation is refused before any effect,
    // without echoing the refused material.
    let other = reserve_committed(&db, "/tmp", "/bin/echo", &[]);
    let err = match launch_reserved(Arc::new(db), no_dir(), other, Some(env), &[]) {
        Err(err) => err,
        Ok(_) => panic!("mismatched context must be refused"),
    };
    assert!(
        !err.to_string().contains(secret.as_str()),
        "refusal error is clean"
    );
}

#[test]
fn default_child_sees_session_env_but_no_control_inheritance() {
    // Regardless of ambient environment, an ordinary session's child sees
    // exactly the session-safe subset: the shim dir first on PATH plus
    // DROGON_DATA_DIR / DROGON_WORKSPACE_ID / DROGON_SESSION_ID /
    // DROGON_TERMINAL=1 and TERM_PROGRAM=Drogon. Inherited ORCA_* and any
    // other DROGON_* (worker scope, credentials, a parent session's
    // identity) are stripped, never passed through. The end marker proves
    // the whole environment was read, not just its head.
    let dir = tempfile::tempdir().expect("isolated dir");
    let db = Arc::new(open_fixture());
    let plan = reserve_committed(
        &db,
        "/tmp",
        "/bin/sh",
        &["-c".into(), "env; echo ENV-PROBE-DONE".into()],
    );
    let expected_session = plan.session_id().to_string();
    let expected_data = dir.path().to_string_lossy().into_owned();
    let (_, handle, _) = launch_reserved(db, dir.path(), plan, None, &[]).expect("launch");
    let _guard = ChildGuard { handle: &handle };
    let text = read_text(&handle, "ENV-PROBE-DONE");
    assert!(
        text.contains("ENV-PROBE-DONE"),
        "full environment must be read"
    );
    let line = |name: &str| {
        text.lines()
            .find(|line| line.starts_with(&format!("{name}=")))
            .unwrap_or_else(|| panic!("session env must carry {name}"))
            .to_string()
    };
    assert_eq!(
        line("DROGON_DATA_DIR"),
        format!("DROGON_DATA_DIR={expected_data}")
    );
    assert_eq!(line("DROGON_WORKSPACE_ID"), "DROGON_WORKSPACE_ID=ws-1");
    assert_eq!(
        line("DROGON_SESSION_ID"),
        format!("DROGON_SESSION_ID={expected_session}")
    );
    assert_eq!(line("DROGON_TERMINAL"), "DROGON_TERMINAL=1");
    assert_eq!(line("TERM_PROGRAM"), "TERM_PROGRAM=Drogon");
    let path_line = line("PATH");
    assert!(
        path_line.starts_with(&format!("PATH={expected_data}/bin")),
        "shim dir must lead PATH: {path_line}"
    );
    let leaked = text.lines().any(|text_line| {
        let upper = text_line.to_ascii_uppercase();
        (upper.starts_with("ORCA_") || upper.starts_with("DROGON_"))
            && !text_line.starts_with("DROGON_DATA_DIR=")
            && !text_line.starts_with("DROGON_WORKSPACE_ID=")
            && !text_line.starts_with("DROGON_SESSION_ID=")
            && !text_line.starts_with("DROGON_TERMINAL=")
    });
    assert!(!leaked, "no other control variables must reach the child");
    stop_quietly(&handle);
}

const SEED_ORCA: &str = "ORCA_SEED_BOGUS_ISOLATED";
const SEED_DROGON: &str = "DROGON_SEED_BOGUS_ISOLATED";

#[test]
fn seeded_inherited_controls_stripped_in_isolated_subprocess() {
    // The stripping loop reads this process's environment, which tests must
    // not mutate globally. So the seeded case runs in an isolated child copy
    // of this test binary; the child then proves its PTY grandchild is clean.
    if std::env::var_os(SEED_ORCA).is_none() {
        let exe = std::env::current_exe().expect("test executable");
        let mut child = std::process::Command::new(exe);
        child
            .env(SEED_ORCA, "1")
            .env(SEED_DROGON, "1")
            .arg("--exact")
            .arg("session::session_admission::session_admission_tests::seeded_inherited_controls_stripped_in_isolated_subprocess")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = child.spawn().expect("spawn seeded self");
        let deadline = Instant::now() + Duration::from_secs(120);
        let output = loop {
            match child.try_wait().expect("poll seeded self") {
                Some(_) => break child.wait_with_output().expect("collect"),
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!("seeded subprocess exceeded its bound");
                }
                None => std::thread::sleep(Duration::from_millis(10)),
            }
        };
        assert!(output.status.success(), "seeded inner probe must pass");
        return;
    }
    // Inner probe, running only inside the seeded child above: the seeds are
    // present here, and the PTY grandchild must not see them. The session's
    // own safe subset (DROGON_DATA_DIR and friends) is still injected fresh.
    assert_eq!(std::env::var(SEED_ORCA).as_deref(), Ok("1"));
    assert_eq!(std::env::var(SEED_DROGON).as_deref(), Ok("1"));
    let db = Arc::new(open_fixture());
    let plan = reserve_committed(
        &db,
        "/tmp",
        "/bin/sh",
        &["-c".into(), "env; echo ENV-PROBE-DONE".into()],
    );
    let (_, handle, _) = launch_reserved(db, no_dir(), plan, None, &[]).expect("launch");
    let _guard = ChildGuard { handle: &handle };
    let text = read_text(&handle, "ENV-PROBE-DONE");
    assert!(
        text.contains("ENV-PROBE-DONE"),
        "full environment must be read"
    );
    assert!(
        !text
            .lines()
            .any(|line| { line.starts_with(SEED_ORCA) || line.starts_with(SEED_DROGON) }),
        "seeded controls must be stripped"
    );
    assert!(
        !text.lines().any(|line| {
            let upper = line.to_ascii_uppercase();
            (upper.starts_with("ORCA_") || upper.starts_with("DROGON_"))
                && !line.starts_with("DROGON_DATA_DIR=")
                && !line.starts_with("DROGON_WORKSPACE_ID=")
                && !line.starts_with("DROGON_SESSION_ID=")
                && !line.starts_with("DROGON_TERMINAL=")
        }),
        "only the session's own safe subset must reach the child"
    );
    stop_quietly(&handle);
}

#[test]
fn worker_env_rejects_bad_shape() {
    let db = open_fixture();
    let plan = reserve_committed(&db, "/tmp", "/bin/echo", &[]);
    let mint = || DispatchCredential::mint().expect("mint");
    // NUL in any field, empty IDs, relative paths.
    assert!(
        WorkerEnvironment::new(
            mint(),
            "host-1",
            "run-1",
            "task-1",
            "dispatch-1",
            plan.session_id(),
            plan.incarnation(),
            "/tmp",
            "/usr/bin/drogon-cli\0"
        )
        .is_err()
    );
    assert!(
        WorkerEnvironment::new(
            mint(),
            "",
            "run-1",
            "task-1",
            "dispatch-1",
            plan.session_id(),
            plan.incarnation(),
            "/tmp",
            "/usr/bin/drogon-cli"
        )
        .is_err()
    );
    assert!(
        WorkerEnvironment::new(
            mint(),
            "host-1",
            "run-1",
            "task-1",
            "dispatch-1",
            plan.session_id(),
            plan.incarnation(),
            "relative/dir",
            "/usr/bin/drogon-cli"
        )
        .is_err()
    );
    assert!(
        WorkerEnvironment::new(
            mint(),
            "host-1",
            "run-1",
            "task-1",
            "dispatch-1",
            plan.session_id(),
            plan.incarnation(),
            "/tmp",
            "relative/cli"
        )
        .is_err()
    );
    // Opaque-ID byte bounds: exactly 128 bytes passes, 129 fails, and
    // multibyte text is measured in bytes, not characters.
    let id_128 = "x".repeat(128);
    let id_129 = "x".repeat(129);
    let multi_128 = "\u{e9}".repeat(64);
    let multi_129 = format!("{}x", "\u{e9}".repeat(64));
    assert_eq!(multi_128.len(), 128);
    assert_eq!(multi_129.len(), 129);
    for ok_id in [&id_128, &multi_128] {
        assert!(
            WorkerEnvironment::new(
                mint(),
                ok_id,
                "run-1",
                "task-1",
                "dispatch-1",
                plan.session_id(),
                plan.incarnation(),
                "/tmp",
                "/usr/bin/drogon-cli"
            )
            .is_ok(),
            "128-byte IDs must pass"
        );
    }
    for bad_id in [&id_129, &multi_129] {
        assert!(
            WorkerEnvironment::new(
                mint(),
                bad_id,
                "run-1",
                "task-1",
                "dispatch-1",
                plan.session_id(),
                plan.incarnation(),
                "/tmp",
                "/usr/bin/drogon-cli"
            )
            .is_err(),
            "129-byte IDs must fail"
        );
    }
}
