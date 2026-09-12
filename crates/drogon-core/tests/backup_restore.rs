//! Install-resilience P6: the pre-migration backups `db.rs` writes on every
//! forward migration must be restorable, with honest refusals. Every test
//! here produces its backup through the REAL mechanism (a genuine
//! `Engine::open` migration over a seeded fixture), never by hand-writing a
//! backup directory, so what is restored is exactly what the daemon writes.
//! Unix-only like the other engine-level suites.

#![cfg(unix)]

use std::path::PathBuf;

use drogon_core::backups::{
    self, RestoreError, list_pre_migration_backups, list_pre_restore_snapshots,
    restore_pre_migration_backup,
};
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use rusqlite::Connection;
use serde_json::json;

fn req(method: &str, request_id: &str, params: serde_json::Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn temp_dir(name: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(&format!("drogon-restore-{name}-"))
        .tempdir()
        .unwrap()
}

fn seed(dir: &tempfile::TempDir, fixture: &str) {
    let sql = match fixture {
        "bots-v1" => include_str!("fixtures/upgrades/bots-v1.sql"),
        "automations-v1" => include_str!("fixtures/upgrades/automations-v1.sql"),
        other => panic!("unknown fixture {other}"),
    };
    Connection::open(dir.path().join("drogon.sqlite3"))
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}

fn db_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("drogon.sqlite3")
}

fn backup_ids(dir: &tempfile::TempDir) -> Vec<String> {
    list_pre_migration_backups(dir.path())
        .unwrap()
        .into_iter()
        .map(|entry| entry.id)
        .collect()
}

fn version_of(conn: &Connection, component: &str) -> i64 {
    conn.query_row(
        "SELECT version FROM schema_versions WHERE component = ?1",
        [component],
        |r| r.get(0),
    )
    .unwrap()
}

/// The audit's test, end to end: a real migration creates a real backup;
/// the live database then advances; a restore brings the backup's contents
/// back byte-for-byte and leaves a `pre-restore-*` snapshot of what was
/// overwritten.
#[test]
fn restore_recovers_the_backup_contents_and_snapshots_the_prior_state() {
    let dir = temp_dir("end-to-end");
    seed(&dir, "bots-v1");
    let engine = Engine::open(dir.path()).unwrap();
    let backups = list_pre_migration_backups(dir.path()).unwrap();
    assert_eq!(backups.len(), 1, "the real migration created one backup");
    assert!(backups[0].restorable(), "a fresh pre-migration backup is restorable by the build that wrote it");
    assert!(backups[0].invalid_reason.is_none());
    assert!(backups[0].database_bytes.unwrap() > 0);
    let manifest = backups[0].manifest.clone().unwrap();
    assert_eq!(manifest.kind, "drogon-pre-migration-backup");
    assert_eq!(manifest.pending_migrations[0].component, "bots");
    assert_eq!(manifest.pending_migrations[0].recorded_version, 1);
    let backup_id = backups[0].id.clone();
    drop(engine);

    // Advance the live database past the backup: new durable data a
    // rollback would have to discard. (The bots table exists in both the
    // fixture's pre-migration shape and the migrated shape.)
    {
        let conn = Connection::open(db_path(&dir)).unwrap();
        conn.execute(
            "UPDATE bots SET folder = '/tmp/post-mutation' WHERE id = 'bot-seed'",
            [],
        )
        .unwrap();
    }
    let before = std::fs::read(db_path(&dir)).unwrap();

    let report = restore_pre_migration_backup(dir.path(), &backup_id).unwrap();
    assert_eq!(report.restored_backup_id, backup_id);
    let snapshot_id = report.pre_restore_snapshot_id.expect("the live db was snapshotted");
    assert!(snapshot_id.starts_with("pre-restore-"), "{snapshot_id}");

    // Byte-for-byte: the live database file is now the backup's file.
    let backup_bytes = std::fs::read(
        dir.path()
            .join("backups")
            .join(&backup_id)
            .join("drogon.sqlite3"),
    )
    .unwrap();
    let restored_bytes = std::fs::read(db_path(&dir)).unwrap();
    assert_eq!(
        restored_bytes, backup_bytes,
        "restored file matches the backup byte-for-byte"
    );
    assert_ne!(restored_bytes, before, "the advanced state was replaced");

    // The restored CONTENT matches the backup's manifest: bots recorded at
    // the pre-migration version, and the post-migration mutation gone.
    let conn = Connection::open_with_flags(
        db_path(&dir),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    assert_eq!(version_of(&conn, "bots"), 1);
    let folder: String = conn
        .query_row("SELECT folder FROM bots WHERE id = 'bot-seed'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(folder, "/tmp/seed-folder", "everything recorded after the backup is gone");
    // The stale WAL/SHM siblings of the replaced database were swept.
    assert!(!dir.path().join("drogon.sqlite3-wal").exists());
    assert!(!dir.path().join("drogon.sqlite3-shm").exists());

    // Reversibility: the pre-restore snapshot carries the state that was
    // overwritten, manifest included.
    let snapshots = list_pre_restore_snapshots(dir.path()).unwrap();
    assert_eq!(snapshots.len(), 1, "{snapshots:?}");
    assert_eq!(snapshots[0].id, snapshot_id);
    assert!(snapshots[0].manifest.is_some());
    let snapshot_conn = Connection::open(
        dir.path()
            .join("backups")
            .join(&snapshot_id)
            .join("drogon.sqlite3"),
    )
    .unwrap();
    let kept: String = snapshot_conn
        .query_row("SELECT folder FROM bots WHERE id = 'bot-seed'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        kept, "/tmp/post-mutation",
        "the overwritten state survives in the snapshot"
    );
}

/// The engine that reopens a restored data dir must accept it (no downgrade
/// refusal — the restore was classified against this build's versions).
/// Replaying the migration on the restored (older) state legitimately
/// snapshots it again: the pre-migration mechanism protects a restore the
/// same way it protects a fresh migration.
#[test]
fn a_restored_data_dir_reopens_cleanly_without_a_refusal() {
    let dir = temp_dir("reopen");
    seed(&dir, "bots-v1");
    let engine = Engine::open(dir.path()).unwrap();
    let backup_id = backup_ids(&dir).remove(0);
    drop(engine);
    restore_pre_migration_backup(dir.path(), &backup_id).unwrap();

    let _engine = Engine::open(dir.path()).unwrap();
    let ids = backup_ids(&dir);
    assert_eq!(ids.len(), 2, "reopen replays the migration and snapshots it again: {ids:?}");
    assert_ne!(ids[0], backup_id);
}

#[test]
fn a_tampered_manifest_is_refused_with_the_reason() {
    let dir = temp_dir("tampered");
    seed(&dir, "bots-v1");
    let engine = Engine::open(dir.path()).unwrap();
    let backup_id = backup_ids(&dir).remove(0);
    drop(engine);
    let backup_dir = dir.path().join("backups").join(&backup_id);

    // (a) kind rewritten: not the manifest the backup writer emits.
    std::fs::write(
        backup_dir.join("manifest.json"),
        r#"{"kind":"something-else","created_at":"t","database_file":"drogon.sqlite3"}"#,
    )
    .unwrap();
    let error = restore_pre_migration_backup(dir.path(), &backup_id).unwrap_err();
    assert!(
        matches!(error, RestoreError::InvalidBackup(ref reason) if reason.contains("kind")),
        "unexpected error: {error}"
    );

    // (b) manifest naming a database file the directory does not carry.
    std::fs::write(
        backup_dir.join("manifest.json"),
        r#"{"kind":"drogon-pre-migration-backup","created_at":"t","database_file":"other.sqlite3"}"#,
    )
    .unwrap();
    let error = restore_pre_migration_backup(dir.path(), &backup_id).unwrap_err();
    assert!(
        matches!(error, RestoreError::InvalidBackup(ref reason) if reason.contains("other.sqlite3")),
        "unexpected error: {error}"
    );

    // (c) database file replaced with non-SQLite bytes: content no longer
    // matches what any manifest could describe.
    std::fs::write(backup_dir.join("drogon.sqlite3"), b"definitely not sqlite").unwrap();
    std::fs::write(
        backup_dir.join("manifest.json"),
        r#"{"kind":"drogon-pre-migration-backup","created_at":"t","database_file":"drogon.sqlite3"}"#,
    )
    .unwrap();
    let error = restore_pre_migration_backup(dir.path(), &backup_id).unwrap_err();
    assert!(
        matches!(error, RestoreError::InvalidBackup(ref reason) if reason.contains("SQLite")),
        "unexpected error: {error}"
    );

    // The live database was never touched by any refused restore.
    let conn = Connection::open(db_path(&dir)).unwrap();
    assert_eq!(version_of(&conn, "bots"), 3, "live db stayed at its migrated version");
}

/// A backup whose contents are NEWER than this build is listed as not
/// restorable and a restore attempt refuses with the reason — never let a
/// restore land in the same downgrade refusal the user is escaping.
#[test]
fn a_backup_newer_than_this_build_is_listed_and_refused() {
    let dir = temp_dir("newer");
    seed(&dir, "bots-v1");
    let engine = Engine::open(dir.path()).unwrap();
    let backup_id = backup_ids(&dir).remove(0);
    drop(engine);

    // Simulate a backup written by a NEWER build: bump the snapshot's bots
    // component beyond what this build supports (current: 3).
    let backup_db = dir.path().join("backups").join(&backup_id).join("drogon.sqlite3");
    Connection::open(&backup_db)
        .unwrap()
        .execute("UPDATE schema_versions SET version = 4 WHERE component = 'bots'", [])
        .unwrap();

    let entries = list_pre_migration_backups(dir.path()).unwrap();
    assert_eq!(entries.len(), 1);
    assert!(!entries[0].restorable());
    assert!(entries[0].invalid_reason.is_none(), "the manifest is honest; the SCHEMA is newer");
    let reason = entries[0].not_restorable_reason.clone().unwrap();
    assert!(reason.contains("newer than"), "{reason}");
    assert!(reason.contains("bots"), "{reason}");

    let error = restore_pre_migration_backup(dir.path(), &backup_id).unwrap_err();
    assert!(
        matches!(error, RestoreError::NewerThanThisBuild(ref r) if r.contains("newer than")),
        "unexpected error: {error}"
    );
    // Refused restore: the live database is untouched.
    let conn = Connection::open(db_path(&dir)).unwrap();
    assert_eq!(version_of(&conn, "bots"), 3);
}

#[test]
fn restore_refuses_while_a_daemon_holds_the_data_dir_lock() {
    let dir = temp_dir("locked");
    seed(&dir, "bots-v1");
    let engine = Engine::open(dir.path()).unwrap();
    let backup_id = backup_ids(&dir).remove(0);
    drop(engine);

    // A live daemon holds its whole-lifetime flock (same file, same OS
    // lock the restore reuses — see backups::lock).
    let daemon_lock = drogon_core::backups::lock::acquire_exclusive(dir.path()).unwrap();
    let error = restore_pre_migration_backup(dir.path(), &backup_id).unwrap_err();
    assert!(
        matches!(error, RestoreError::LockHeld(_)),
        "unexpected error: {error}"
    );
    assert!(
        error.to_string().contains("locked by a running daemon"),
        "the reason must name the lock: {error}"
    );
    drop(daemon_lock);

    // Lock released: the restore now succeeds.
    restore_pre_migration_backup(dir.path(), &backup_id).unwrap();
}

#[test]
fn an_unknown_backup_id_is_refused_without_touching_anything() {
    let dir = temp_dir("unknown-id");
    seed(&dir, "bots-v1");
    let _engine = Engine::open(dir.path()).unwrap();
    for bad in ["pre-migration-9999999999999", "pre-migration-not-a-stamp"] {
        let error = restore_pre_migration_backup(dir.path(), bad).unwrap_err();
        assert!(matches!(error, RestoreError::UnknownBackup(_)), "{error}");
    }
    assert!(!dir.path().join("backups").join("pre-restore-1").exists());
}

/// A failed snapshot must abort the restore before anything is modified:
/// a restore that cannot be made reversible must not happen.
#[test]
fn a_failed_snapshot_aborts_the_restore_without_touching_the_live_db() {
    let dir = temp_dir("snapshot-fail");
    seed(&dir, "bots-v1");
    let engine = Engine::open(dir.path()).unwrap();
    let backup_id = backup_ids(&dir).remove(0);
    drop(engine);

    // Make snapshot creation impossible while keeping the backup itself:
    // `backups/` becomes a directory the process cannot write into, so the
    // `pre-restore-*` directory cannot be created. (The live db still has
    // no WAL here, so the VACUUM path is reached and fails at mkdir.)
    let backups_dir = dir.path().join("backups");
    let mut perms = std::fs::metadata(&backups_dir).unwrap().permissions();
    use std::os::unix::fs::PermissionsExt;
    perms.set_mode(0o500);
    std::fs::set_permissions(&backups_dir, perms.clone()).unwrap();

    let before = std::fs::read(db_path(&dir)).unwrap();
    let error = restore_pre_migration_backup(dir.path(), &backup_id).unwrap_err();
    // Restore permissions before asserting so the temp dir can be cleaned.
    perms.set_mode(0o700);
    std::fs::set_permissions(&backups_dir, perms).unwrap();
    assert!(
        matches!(error, RestoreError::SnapshotFailed(_)),
        "unexpected error: {error}"
    );
    assert_eq!(std::fs::read(db_path(&dir)).unwrap(), before, "live db untouched");
    assert!(!dir.path().join("backups").join("pre-restore-1").exists());
}

/// Smoke: a restored database still serves. Reopening the engine after a
/// restore and dispatching a real `status` request proves the swapped file
/// is a working Drogon store, not just a valid SQLite file.
#[test]
fn a_restored_engine_serves() {
    let dir = temp_dir("serves");
    seed(&dir, "automations-v1");
    let engine = Engine::open(dir.path()).unwrap();
    let backup_id = backup_ids(&dir).remove(0);
    drop(engine);
    restore_pre_migration_backup(dir.path(), &backup_id).unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch(req("status", "restore-smoke", json!({})));
    assert!(
        response.ok,
        "restored store serves status: {:?}",
        response.error
    );
}
