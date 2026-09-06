//! Aggregate-startup tests for the `bots`/`automations` capability schema
//! gate wired into `Engine::open` (`db::migrate_and_recover`, see
//! `docs/migration/bot-state-admission.md`). Unlike `tests/bot_storage.rs`
//! and `tests/automation_records.rs`, which call `bots::storage::migrate`
//! / `automations::storage::migrate` directly, these tests go through the
//! real `Engine::open` entry point and a raw connection to the same
//! on-disk file, so they exercise the actual aggregate ordering rather
//! than each component in isolation. See `tests/bot_automation_startup_atomicity.rs`
//! for the real single-transaction atomicity guarantees (this file predates
//! that fix and only covers the ordering/refusal behavior that both the
//! earlier precheck-based gate and the current one-transaction gate share).

use drogon_core::automations::storage as astorage;
use drogon_core::bots::storage as bstorage;
use drogon_core::{DB_FILE_NAME, Engine};
use rusqlite::{Connection, OptionalExtension};

fn recorded_version(conn: &Connection, component: &str) -> Option<i64> {
    conn.query_row(
        "SELECT version FROM schema_versions WHERE component = ?1",
        [component],
        |r| r.get(0),
    )
    .optional()
    .unwrap()
}

#[test]
fn engine_open_registers_both_capability_schemas_at_their_current_version() {
    let dir = tempfile::tempdir().unwrap();
    let _engine = Engine::open(dir.path()).unwrap();

    let conn = Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    assert_eq!(
        recorded_version(&conn, "bots"),
        Some(bstorage::BOTS_SCHEMA_VERSION)
    );
    assert_eq!(
        recorded_version(&conn, "automations"),
        Some(astorage::AUTOMATIONS_SCHEMA_VERSION)
    );

    // Both components' real tables are present and usable through their
    // public store functions, not merely `schema_versions`-recorded.
    assert!(
        astorage::get_automation(&conn, "missing")
            .unwrap()
            .is_none()
    );
    assert!(
        bstorage::get_bot(&conn, "host-1", "/repo", "missing")
            .unwrap()
            .is_none()
    );
}

#[test]
fn engine_reopen_is_idempotent_and_preserves_prior_capability_data() {
    let dir = tempfile::tempdir().unwrap();
    {
        let _engine = Engine::open(dir.path()).unwrap();
        let conn = Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        let bot = sample_bot("b1");
        bstorage::create_bot(&conn, "host-1", "/repo", &bot).unwrap();
    }
    {
        // A second `Engine::open` against the same data dir must not error,
        // must not reset either component's recorded version, and must not
        // lose data the first open's caller wrote.
        let _engine = Engine::open(dir.path()).unwrap();
        let conn = Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        assert_eq!(
            recorded_version(&conn, "bots"),
            Some(bstorage::BOTS_SCHEMA_VERSION)
        );
        assert_eq!(
            recorded_version(&conn, "automations"),
            Some(astorage::AUTOMATIONS_SCHEMA_VERSION)
        );
        let bot = bstorage::get_bot(&conn, "host-1", "/repo", "b1")
            .unwrap()
            .unwrap();
        assert_eq!(bot.id, "b1");
    }
}

#[test]
fn engine_open_steps_a_genuine_old_bots_schema_forward_to_current() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join(DB_FILE_NAME);
    std::fs::create_dir_all(dir.path()).unwrap();
    {
        // Hand-build a genuine v1 `bots` database (no `rev` column, no
        // dedupe index) sharing the connection with a fully-current
        // `automations` schema, the same way a real reopen after an
        // in-place binary upgrade would look.
        let c = Connection::open(&db_path).unwrap();
        astorage::migrate(&c).unwrap();
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
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
             INSERT INTO schema_versions(component, version) VALUES ('bots', 1);",
        )
        .unwrap();
        c.execute(
            "INSERT INTO bots (id, host_id, folder, updated_at, payload_json) VALUES ('b1', ?1, ?2, 0.0, ?3)",
            rusqlite::params![
                "host-1",
                "/repo",
                serde_json::to_string(&sample_bot("b1")).unwrap()
            ],
        )
        .unwrap();
    }

    // `Engine::open` must forward-step the recorded-v1 `bots` schema to
    // current, not treat the database as already-current or refuse it.
    let _engine = Engine::open(dir.path()).unwrap();
    let conn = Connection::open(&db_path).unwrap();
    assert_eq!(
        recorded_version(&conn, "bots"),
        Some(bstorage::BOTS_SCHEMA_VERSION)
    );
    let bot = bstorage::get_bot(&conn, "host-1", "/repo", "b1")
        .unwrap()
        .unwrap();
    assert_eq!(bot.id, "b1");
}

#[test]
fn engine_open_refuses_a_future_bots_version_without_ever_creating_automations_tables() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join(DB_FILE_NAME);
    {
        // Seed only `schema_versions` (shared, version-less tracking
        // infrastructure) with a `bots` version this build cannot support.
        // `automations` has no recorded version at all yet, i.e. it would
        // be a brand-new database from that component's point of view.
        let c = Connection::open(&db_path).unwrap();
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions(component, version) VALUES ('bots', 999);",
        )
        .unwrap();
    }

    let result = Engine::open(dir.path());
    assert!(
        result.is_err(),
        "a future-versioned bots schema must refuse Engine::open"
    );

    // The aggregate gate must have refused before either component applied
    // a single migration step: `automations` was never recorded and its
    // tables were never created, even though its own precheck alone would
    // have passed (it had no recorded version to conflict with).
    let conn = Connection::open(&db_path).unwrap();
    assert_eq!(recorded_version(&conn, "automations"), None);
    let automations_table_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'automations'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        automations_table_exists, 0,
        "automations tables must not exist after a refused aggregate startup gate"
    );
    // The offending `bots` version is untouched too, not silently bumped.
    assert_eq!(recorded_version(&conn, "bots"), Some(999));
}

#[test]
fn sequential_migrate_calls_without_the_aggregate_precheck_would_partially_alter_the_database() {
    // This documents the exact hazard `db::migrate_and_recover` exists to
    // close: if a caller (mistakenly) migrated each component one at a
    // time -- checking each component's own version only as it is
    // reached, rather than checking every component before any of them
    // applies a step -- an earlier component in the sequence can commit
    // its own schema durably before a later component discovers a
    // recorded version this build does not support and refuses. The
    // process as a whole still fails, but the database is left partially
    // altered. `Engine::open` never calls `migrate` directly in this
    // order; it always goes through the real single-transaction aggregate
    // gate (see `tests/bot_automation_startup_atomicity.rs` for the direct
    // `Engine::open`-level proof). This test proves the hazard is real for
    // the naive sequential approach at the storage-function level, which
    // is why that gate is necessary and not merely cosmetic.
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join(DB_FILE_NAME);
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
         INSERT INTO schema_versions(component, version) VALUES ('bots', 999);",
    )
    .unwrap();

    // Naive sequential order: automations first (nothing recorded yet, so
    // its own precheck alone passes) ...
    astorage::migrate(&conn).unwrap();
    // ... automations is now durably fully migrated, even though the
    // overall aggregate startup is about to fail:
    assert_eq!(
        recorded_version(&conn, "automations"),
        Some(astorage::AUTOMATIONS_SCHEMA_VERSION)
    );
    let automations_table_exists: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'automations'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        automations_table_exists, 1,
        "the naive sequential order does partially alter the database"
    );

    // ... then bots, which refuses because 999 is newer than supported.
    assert!(bstorage::migrate(&conn).is_err());
}

fn sample_bot(id: &str) -> drogon_core::bots::records::Bot {
    drogon_core::bots::records::Bot {
        id: id.to_string(),
        character_preset: "none".to_string(),
        display_identity: drogon_core::bots::records::DisplayIdentity {
            display_name: "Alice".to_string(),
            handle: None,
            title: None,
        },
        harness_policy: drogon_core::bots::records::HarnessModelPolicy {
            default_harness: drogon_core::bots::records::DEFAULT_DROGON_BOT_HARNESS.to_string(),
            explicit_model: None,
        },
        instructions: String::new(),
        memories: Vec::new(),
        responsibilities: Vec::new(),
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    }
}
