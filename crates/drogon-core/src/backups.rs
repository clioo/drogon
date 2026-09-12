//! Restore path for the pre-migration backups `db.rs` already writes
//! (install-resilience audit P6). The backup mechanism itself —
//! `VACUUM INTO` snapshots under `<data-dir>/backups/pre-migration-*`
//! with a `manifest.json`, retention 3 — is sound and tested; this module
//! makes it usable: validated listing, classification against the running
//! build's own schema versions, and a reversible restore.
//!
//! Restore ordering is deliberate: validate the backup's manifest against
//! its contents, refuse anything newer than this build (it would land the
//! user in the same downgrade refusal they are trying to escape), snapshot
//! the current live database into `pre-restore-*` so the restore itself is
//! reversible, stage + `quick_check` the replacement file, then atomically
//! rename it over the live database. The exclusive data-dir lock (the
//! daemon's whole-lifetime flock) is held across the entire operation; see
//! [`lock`] for why it is mirrored here rather than imported.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::db::{self, DB_FILE_NAME};

pub const BACKUPS_DIR_NAME: &str = "backups";
pub const PRE_MIGRATION_PREFIX: &str = "pre-migration-";
pub const PRE_RESTORE_PREFIX: &str = "pre-restore-";
pub const MANIFEST_FILE_NAME: &str = "manifest.json";
pub const PRE_MIGRATION_MANIFEST_KIND: &str = "drogon-pre-migration-backup";
pub const PRE_RESTORE_MANIFEST_KIND: &str = "drogon-pre-restore-backup";

/// The exclusive data-dir lock, mirrored from `drogond::lock` on purpose.
/// The restore runs from `drogon-cli` (or the desktop bridge spawning it)
/// exactly when no daemon is serving — but "no daemon is serving" is only
/// known to the OS: a daemon from another install, or one an operator
/// started by hand, may still own the directory. Acquiring the *same*
/// flock file with the same exclusive, fail-fast semantics is what makes a
/// restore refuse (`another drogond instance already holds the exclusive
/// lock …`) instead of corrupting a live database under a running daemon.
/// This is the daemon's one lock reused, not a second locking scheme; the
/// end-to-end acceptance drives a real `drogond` against a restore to pin
/// the two implementations to each other.
pub mod lock {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::unix::io::AsRawFd;
    use std::path::Path;

    /// Same file `drogond::lock::LOCK_FILE_NAME` guards. Keep identical.
    pub const LOCK_FILE_NAME: &str = ".drogond.lock";

    /// Held for as long as this value is alive; dropping it (process exit
    /// included) releases the lock. Never remove the lock file itself —
    /// only the flock state matters (same rationale as `drogond::lock`).
    pub struct DataDirLock {
        _file: File,
    }

    /// Mirrors `drogond::lock::acquire_exclusive`: create-or-open
    /// `.drogond.lock` (0600, never following symlinks) and take
    /// `LOCK_EX | LOCK_NB` so a held directory fails immediately.
    pub fn acquire_exclusive(data_dir: &Path) -> io::Result<DataDirLock> {
        let path = data_dir.join(LOCK_FILE_NAME);
        use std::os::unix::fs::OpenOptionsExt;
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)?;
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        // SAFETY: `file`'s fd is valid for the duration of this call and the
        // lock is released only when `file` is dropped or the process exits.
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if rc != 0 {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!(
                    "another drogond instance already holds the exclusive lock on this data directory: {}",
                    io::Error::last_os_error()
                ),
            ));
        }
        Ok(DataDirLock { _file: file })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_second_lock_attempt_is_refused_while_the_first_is_held() {
            let dir = tempfile::tempdir().unwrap();
            let first = acquire_exclusive(dir.path()).unwrap();
            let second = acquire_exclusive(dir.path());
            assert!(second.is_err());
            drop(first);
            assert!(acquire_exclusive(dir.path()).is_ok());
        }

        #[test]
        fn a_symlinked_lock_cannot_modify_its_target() {
            use std::os::unix::fs::{PermissionsExt, symlink};
            let dir = tempfile::tempdir().unwrap();
            let target = dir.path().join("unrelated");
            std::fs::write(&target, "preserve").unwrap();
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o644)).unwrap();
            symlink(&target, dir.path().join(LOCK_FILE_NAME)).unwrap();
            assert!(acquire_exclusive(dir.path()).is_err());
            assert_eq!(std::fs::read_to_string(&target).unwrap(), "preserve");
            assert_eq!(
                std::fs::metadata(target).unwrap().permissions().mode() & 0o777,
                0o644
            );
        }
    }
}

/// The subset of a backup's `manifest.json` this module depends on,
/// validated against the backup's actual contents before anything is
/// touched. Written by `db.rs`'s `create_pre_migration_backup`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupManifest {
    pub kind: String,
    pub created_at: String,
    pub original_data_dir: String,
    pub database_file: String,
    pub writer_build_version: String,
    /// Component versions the writer was about to migrate forward when it
    /// made this backup — the honest description of how old the backup is.
    pub pending_migrations: Vec<PendingMigrationRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMigrationRecord {
    pub component: String,
    pub recorded_version: i64,
    pub migrating_to: i64,
}

/// One `pre-migration-*` (or `pre-restore-*`) directory as the list and the
/// UI should show it: manifest contents, on-disk size, whether the manifest
/// matches the contents, and — when it does — whether THIS build may
/// restore it.
#[derive(Debug, Clone)]
pub struct BackupEntry {
    /// Directory name; the id a restore names. `pre-migration-<unix-ms>`.
    pub id: String,
    pub dir: PathBuf,
    pub database_bytes: Option<u64>,
    pub manifest: Option<BackupManifest>,
    /// Why this directory is not a usable backup; None when validation passed.
    pub invalid_reason: Option<String>,
    /// Why this (valid) backup must not be restored by this build; None
    /// when restorable. Only meaningful when `invalid_reason` is None.
    pub not_restorable_reason: Option<String>,
}

impl BackupEntry {
    pub fn restorable(&self) -> bool {
        self.invalid_reason.is_none() && self.not_restorable_reason.is_none()
    }
}

#[derive(Debug)]
pub enum RestoreError {
    /// The data-dir lock is held: a daemon owns this directory right now.
    LockHeld(std::io::Error),
    /// No `pre-migration-*` directory with this id exists here.
    UnknownBackup(String),
    /// The backup's manifest does not match its contents (or is unreadable).
    InvalidBackup(String),
    /// The backup's recorded schema is newer than this build supports;
    /// restoring it would immediately re-trigger the downgrade refusal.
    NewerThanThisBuild(String),
    /// The current live database could not be snapshotted, so a restore
    /// would not be reversible; nothing was modified.
    SnapshotFailed(String),
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for RestoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::LockHeld(e) => write!(f, "data directory is locked by a running daemon: {e}"),
            Self::UnknownBackup(id) => {
                write!(f, "no pre-migration backup named {id} exists in this data directory")
            }
            Self::InvalidBackup(reason) => write!(f, "backup refused: {reason}"),
            Self::NewerThanThisBuild(reason) => {
                write!(f, "backup refused: {reason}")
            }
            Self::SnapshotFailed(reason) => write!(
                f, "restore refused before touching anything: the current database could not be snapshotted ({reason})"
            ),
            Self::Io(e) => write!(f, "{e}"),
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
        }
    }
}

impl std::error::Error for RestoreError {}

impl From<std::io::Error> for RestoreError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<rusqlite::Error> for RestoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

#[derive(Debug)]
pub struct RestoreReport {
    pub restored_backup_id: String,
    /// `pre-restore-*` directory holding the state that was overwritten,
    /// when there was a live database to snapshot.
    pub pre_restore_snapshot_id: Option<String>,
    pub database_file: PathBuf,
    pub database_bytes: u64,
}

/// Lists `backups/pre-migration-*` directories, newest first, each with its
/// parsed manifest, size, validation verdict and restorability against this
/// build. Missing `backups/` is an empty list, not an error. Invalid
/// entries are listed (with the reason) rather than hidden: the UI must be
/// able to say plainly why something cannot be restored.
pub fn list_pre_migration_backups(data_dir: &Path) -> std::io::Result<Vec<BackupEntry>> {
    list_backup_dirs(data_dir, PRE_MIGRATION_PREFIX, PRE_MIGRATION_MANIFEST_KIND)
}

/// Lists `backups/pre-restore-*` snapshots the same way. These are the
/// reversibility hatch: each holds the state that was on disk just before
/// one restore overwrote it.
pub fn list_pre_restore_snapshots(data_dir: &Path) -> std::io::Result<Vec<BackupEntry>> {
    list_backup_dirs(data_dir, PRE_RESTORE_PREFIX, PRE_RESTORE_MANIFEST_KIND)
}

fn list_backup_dirs(
    data_dir: &Path,
    prefix: &str,
    expected_kind: &str,
) -> std::io::Result<Vec<BackupEntry>> {
    let backups_dir = data_dir.join(BACKUPS_DIR_NAME);
    let read = match std::fs::read_dir(&backups_dir) {
        Ok(read) => read,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut entries = Vec::new();
    for entry in read {
        let path = entry?.path();
        let Some(id) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if !id.starts_with(prefix) {
            continue;
        }
        if !path.is_dir() {
            continue;
        }
        entries.push(build_entry(path, id.to_string(), expected_kind));
    }
    // Directory names embed unix ms of constant width, so the numeric
    // suffix is the time sort (same rule as db.rs's pruner); newest first.
    let stamp = |id: &str| {
        id.rsplit('-')
            .next()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0)
    };
    entries.sort_by_key(|entry| std::cmp::Reverse(stamp(&entry.id)));
    Ok(entries)
}

fn build_entry(dir: PathBuf, id: String, expected_kind: &str) -> BackupEntry {
    let mut entry = BackupEntry {
        id,
        dir: dir.clone(),
        database_bytes: None,
        manifest: None,
        invalid_reason: None,
        not_restorable_reason: None,
    };
    let database_file = match dir.join(DB_FILE_NAME).metadata() {
        Ok(metadata) if metadata.is_file() => {
            entry.database_bytes = Some(metadata.len());
            DB_FILE_NAME.to_string()
        }
        Ok(_) => {
            entry.invalid_reason = Some(format!(
                "{DB_FILE_NAME} in this directory is not an ordinary file"
            ));
            return entry;
        }
        Err(error) => {
            entry.invalid_reason = Some(format!("backup database file is missing: {error}"));
            return entry;
        }
    };
    let manifest_bytes = match std::fs::read(dir.join(MANIFEST_FILE_NAME)) {
        Ok(bytes) => bytes,
        Err(error) => {
            entry.invalid_reason = Some(format!("manifest.json is missing or unreadable: {error}"));
            return entry;
        }
    };
    let value: serde_json::Value = match serde_json::from_slice(&manifest_bytes) {
        Ok(value) => value,
        Err(error) => {
            entry.invalid_reason = Some(format!("manifest.json does not parse: {error}"));
            return entry;
        }
    };
    let manifest = match parse_manifest(&value, expected_kind, &database_file, &dir) {
        Ok(manifest) => manifest,
        Err(reason) => {
            entry.invalid_reason = Some(reason);
            return entry;
        }
    };
    entry.manifest = Some(manifest);
    if expected_kind == PRE_MIGRATION_MANIFEST_KIND {
        match classify_against_this_build(&dir.join(database_file)) {
            Ok(()) => {}
            Err(reason) => entry.not_restorable_reason = Some(reason),
        }
    }
    entry
}

/// Structural manifest validation: identity fields present and well-typed,
/// the named database file actually present, and the file carrying the
/// SQLite magic header. This is the "manifest must match its contents"
/// check a restore refuses on.
fn parse_manifest(
    value: &serde_json::Value,
    expected_kind: &str,
    database_file: &str,
    dir: &Path,
) -> Result<BackupManifest, String> {
    let obj = value.as_object().ok_or("manifest.json is not a JSON object")?;
    let kind = obj
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or("manifest is missing its kind")?;
    if kind != expected_kind {
        return Err(format!(
            "manifest kind is {kind:?}, not {expected_kind:?}"
        ));
    }
    let created_at = obj
        .get("created_at")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("manifest is missing created_at")?
        .to_string();
    let manifest_database_file = obj
        .get("database_file")
        .and_then(|v| v.as_str())
        .ok_or("manifest is missing database_file")?;
    if manifest_database_file != database_file {
        return Err(format!(
            "manifest names database file {manifest_database_file:?} but the directory carries {database_file:?}"
        ));
    }
    let header = std::fs::read(dir.join(database_file)).map_err(|e| format!("cannot read the backup database: {e}"))?;
    if header.len() < 16 || &header[..16] != b"SQLite format 3\0" {
        return Err("backup database file is not a SQLite database".to_string());
    }
    let pending_migrations = match obj.get("pending_migrations") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(list @ serde_json::Value::Array(_)) => list
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                let component = item
                    .get("component")
                    .and_then(|v| v.as_str())
                    .ok_or("a pending_migrations entry is missing component")?
                    .to_string();
                let recorded_version = item
                    .get("recorded_version")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| "a pending_migrations entry is missing recorded_version".to_string())?;
                let migrating_to = item
                    .get("migrating_to")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| "a pending_migrations entry is missing migrating_to".to_string())?;
                Ok(PendingMigrationRecord {
                    component,
                    recorded_version,
                    migrating_to,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        Some(_) => return Err("manifest pending_migrations is not a list".to_string()),
    };
    Ok(BackupManifest {
        kind: kind.to_string(),
        created_at,
        original_data_dir: obj
            .get("data_dir")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        database_file: manifest_database_file.to_string(),
        writer_build_version: obj
            .get("writer_build_version")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        pending_migrations,
    })
}

/// Compares the backup's recorded per-component schema versions against the
/// versions THIS build supports (`db.rs`'s versioned components plus the
/// orchestration domain). Any component newer than this build means the
/// restore would land in the same downgrade refusal the user is escaping.
fn classify_against_this_build(backup_db: &Path) -> Result<(), String> {
    match classify_read(backup_db) {
        Ok(()) => Ok(()),
        Err(ClassifyFailure::Sqlite(e)) => {
            Err(format!("backup database cannot be inspected: {e}"))
        }
        Err(ClassifyFailure::Newer(reason)) => Err(reason),
    }
}

/// Why a valid backup may not be restored by this build: either its
/// contents cannot be inspected at all, or they record a component newer
/// than this build supports.
enum ClassifyFailure {
    Sqlite(rusqlite::Error),
    Newer(String),
}

impl From<rusqlite::Error> for ClassifyFailure {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

fn classify_read(backup_db: &Path) -> Result<(), ClassifyFailure> {
    let conn = Connection::open_with_flags(backup_db, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let has_schema_versions: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_versions'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)?;
    if has_schema_versions {
        for (component, current) in db::versioned_components() {
            let recorded: Option<i64> = conn
                .query_row(
                    "SELECT version FROM schema_versions WHERE component = ?1",
                    [component],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(recorded) = recorded
                && recorded > *current
            {
                return Err(ClassifyFailure::Newer(format!(
                    "{component} schema version {recorded} is newer than the {current} this build supports; restoring would re-trigger the downgrade refusal"
                )));
            }
        }
    }
    let has_orchestration_meta: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='orchestration_domain_meta'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)?;
    if has_orchestration_meta {
        let recorded: Option<i64> = conn
            .query_row(
                "SELECT MAX(version) FROM orchestration_domain_meta",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let target = drogon_orchestration::schema::SCHEMA_VERSION;
        if let Some(recorded) = recorded
            && recorded > target
        {
            return Err(ClassifyFailure::Newer(format!(
                "orchestration_domain schema version {recorded} is newer than the {target} this build supports; restoring would re-trigger the downgrade refusal"
            )));
        }
    }
    Ok(())
}

/// Restores one pre-migration backup over the live database. Takes the
/// daemon's exclusive data-dir lock for the whole operation (refusing while
/// a daemon serves), validates the backup, snapshots the current live
/// database into `backups/pre-restore-*`, then swaps the backup's database
/// file in. Restore ordering makes every failure leave the previous state
/// intact: nothing is modified until the snapshot exists and the
/// replacement file has passed `quick_check`.
pub fn restore_pre_migration_backup(
    data_dir: &Path,
    backup_id: &str,
) -> Result<RestoreReport, RestoreError> {
    let _lock = lock::acquire_exclusive(data_dir).map_err(RestoreError::LockHeld)?;
    validate_backup_id(backup_id)?;
    let backup_dir = data_dir.join(BACKUPS_DIR_NAME).join(backup_id);
    if !backup_dir.is_dir() {
        return Err(RestoreError::UnknownBackup(backup_id.to_string()));
    }
    let entry = build_entry(
        backup_dir.clone(),
        backup_id.to_string(),
        PRE_MIGRATION_MANIFEST_KIND,
    );
    if let Some(reason) = entry.invalid_reason {
        return Err(RestoreError::InvalidBackup(reason));
    }
    if let Some(reason) = entry.not_restorable_reason {
        return Err(RestoreError::NewerThanThisBuild(reason));
    }
    let manifest = entry.manifest.expect("validated entry carries a manifest");

    let live_db = data_dir.join(manifest.database_file.clone());
    let snapshot_id = snapshot_live_db(&live_db, backup_id).map_err(RestoreError::SnapshotFailed)?;

    // Stage the replacement inside the data directory (same filesystem, so
    // the later rename is atomic) and prove it opens clean BEFORE the live
    // file is touched.
    let staged = data_dir.join(format!(
        ".restore-stage-{}-{}",
        std::process::id(),
        crate::now_unix_ms()
    ));
    let staged_result = (|| -> Result<u64, RestoreError> {
        let bytes = std::fs::copy(backup_dir.join(manifest.database_file.clone()), &staged)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o600))?;
        }
        let conn = Connection::open_with_flags(&staged, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let check: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if check != "ok" {
            return Err(RestoreError::InvalidBackup(format!(
                "backup database failed quick_check: {check}"
            )));
        }
        drop(conn);
        Ok(bytes)
    })();
    let database_bytes = match staged_result {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = std::fs::remove_file(&staged);
            return Err(error);
        }
    };

    std::fs::rename(&staged, &live_db)?;
    // The WAL/SHM/journal siblings belong to the database that was just
    // replaced; leaving them would let stale frames be recovered on top of
    // the restored file. A crash between the rename and this sweep is safe:
    // SQLite validates WAL salts/checksums against the restored database
    // and resets a non-matching WAL.
    for suffix in ["-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(data_dir.join(format!("{}{suffix}", manifest.database_file)));
    }

    Ok(RestoreReport {
        restored_backup_id: backup_id.to_string(),
        pre_restore_snapshot_id: snapshot_id,
        database_file: live_db,
        database_bytes,
    })
}

/// `pre-migration-<unix ms>` and nothing else: the id doubles as a path
/// segment, so traversal (`..`, separators) is refused before any lookup.
fn validate_backup_id(backup_id: &str) -> Result<(), RestoreError> {
    let stamp = backup_id
        .strip_prefix(PRE_MIGRATION_PREFIX)
        .ok_or_else(|| RestoreError::UnknownBackup(backup_id.to_string()))?;
    if stamp.is_empty() || !stamp.bytes().all(|b| b.is_ascii_digit()) {
        return Err(RestoreError::UnknownBackup(backup_id.to_string()));
    }
    Ok(())
}

/// Snapshots the current live database into `backups/pre-restore-<unix ms>/`
/// so the restore it precedes is itself reversible. Prefers the same
/// consistent-copy mechanism the pre-migration writer uses (`VACUUM INTO`
/// on a read-only connection); when that is impossible (a hot WAL that a
/// read-only opener cannot recover), falls back to copying the live file
/// set exactly as it lies, which is still a faithful, restorable unit. No
/// live database (fresh data dir) means nothing to snapshot.
fn snapshot_live_db(live_db: &Path, backup_id: &str) -> Result<Option<String>, String> {
    if !live_db.exists() {
        return Ok(None);
    }
    let data_dir = live_db
        .parent()
        .ok_or_else(|| "live database has no parent directory".to_string())?;
    let snapshots_dir = data_dir.join(BACKUPS_DIR_NAME);
    std::fs::create_dir_all(&snapshots_dir)
        .map_err(|e| format!("cannot create backups directory: {e}"))?;
    let dir = snapshots_dir.join(format!("{}{}", PRE_RESTORE_PREFIX, crate::now_unix_ms()));
    std::fs::create_dir(&dir).map_err(|e| format!("cannot create snapshot directory: {e}"))?;
    let rollback = |e: String| -> String {
        let _ = std::fs::remove_dir_all(&dir);
        e
    };
    let vacuum = Connection::open_with_flags(live_db, OpenFlags::SQLITE_OPEN_READ_ONLY).map(
        |conn| {
            conn.execute(
                "VACUUM INTO ?1",
                [dir.join(DB_FILE_NAME).to_string_lossy().as_ref()],
            )
        },
    );
    let method = match vacuum {
        Ok(Ok(_)) => "vacuum-into",
        Ok(Err(_)) | Err(_) => {
            // File-set copy fallback: mirror exactly what the live directory
            // carries, so the snapshot is the live state as it lies.
            let mut copied = false;
            for suffix in ["", "-wal", "-shm", "-journal"] {
                let source = data_dir.join(format!("{DB_FILE_NAME}{suffix}"));
                match std::fs::copy(&source, dir.join(format!("{DB_FILE_NAME}{suffix}"))) {
                    Ok(_) => copied = true,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => {
                        return Err(rollback(format!("cannot copy the live database: {error}")));
                    }
                }
            }
            if !copied {
                return Err(rollback("live database disappeared while snapshotting".into()));
            }
            "file-copy"
        }
    };
    let manifest = serde_json::json!({
        "kind": PRE_RESTORE_MANIFEST_KIND,
        "created_at": crate::now_rfc3339(),
        "data_dir": data_dir.to_string_lossy(),
        "database_file": DB_FILE_NAME,
        "writer_build_version": env!("CARGO_PKG_VERSION"),
        "method": method,
        "reason": format!("state saved immediately before restoring {backup_id} over it"),
        "restored_from": backup_id,
    });
    std::fs::write(
        dir.join(MANIFEST_FILE_NAME),
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| rollback(format!("cannot write snapshot manifest: {e}")))?,
    )
    .map_err(|e| rollback(format!("cannot write snapshot manifest: {e}")))?;
    Ok(dir
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_ids_refuse_traversal_and_foreign_shapes() {
        assert!(validate_backup_id("pre-migration-1727000000000").is_ok());
        for bad in [
            "pre-migration-",
            "pre-migration-abc",
            "pre-restore-1727000000000",
            "../pre-migration-1727000000000",
            "pre-migration-1727/../../etc",
            "",
        ] {
            assert!(
                matches!(validate_backup_id(bad), Err(RestoreError::UnknownBackup(_))),
                "{bad} must be refused"
            );
        }
    }
}
