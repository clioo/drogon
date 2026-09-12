//! `drogon-cli backups`: validated listing and reversible restore of the
//! pre-migration backups the daemon writes on every forward migration
//! (install-resilience audit P6). Local on purpose: the restore is needed
//! exactly when NO daemon is serving — the whole-lifetime data-dir lock is
//! taken by the restore itself (see `drogon_core::backups::lock`), so a
//! live daemon makes it refuse instead of racing it.

use std::path::Path;

use serde_json::json;

use crate::cli::BackupsAction;
use crate::commands::RunOutcome;
use crate::error::CliError;
use drogon_core::backups::{
    self, BackupEntry, RestoreError, list_pre_migration_backups, list_pre_restore_snapshots,
    restore_pre_migration_backup,
};

pub fn run(
    request_id: &str,
    json: bool,
    action: &BackupsAction,
    data_dir: &Path,
) -> Result<RunOutcome, CliError> {
    match action {
        BackupsAction::List => list(request_id, json, data_dir),
        BackupsAction::Restore { backup_id } => {
            restore(request_id, json, data_dir, backup_id)
        }
    }
}

fn list(request_id: &str, json: bool, data_dir: &Path) -> Result<RunOutcome, CliError> {
    let backups = list_pre_migration_backups(data_dir)
        .map_err(|e| local(request_id, "io_error", format!("cannot list backups: {e}")))?;
    let snapshots = list_pre_restore_snapshots(data_dir)
        .map_err(|e| local(request_id, "io_error", format!("cannot list snapshots: {e}")))?;
    if json {
        let payload = json!({
            "dataDir": data_dir.to_string_lossy(),
            "backups": backups
                .iter()
                .map(entry_json)
                .collect::<Vec<_>>(),
            "preRestoreSnapshots": snapshots
                .iter()
                .map(entry_json)
                .collect::<Vec<_>>(),
        });
        Ok(RunOutcome {
            stdout: serde_json::to_string_pretty(&payload).map_err(|err| {
                local(request_id, "internal_error", format!("cannot encode response: {err}"))
            })?,
            exit_code: 0,
            stderr_note: None,
        })
    } else {
        let mut text = String::new();
        if backups.is_empty() {
            text.push_str("No pre-migration backups in this data directory.\n");
        } else {
            text.push_str(&format!(
                "{} pre-migration backup(s) in {}:\n",
                backups.len(),
                data_dir.join(backups::BACKUPS_DIR_NAME).display()
            ));
            for entry in &backups {
                text.push_str(&entry_line(entry));
            }
        }
        if !snapshots.is_empty() {
            text.push_str(&format!(
                "\n{} pre-restore snapshot(s) (state saved just before one restore):\n",
                snapshots.len()
            ));
            for entry in &snapshots {
                text.push_str(&entry_line(entry));
            }
        }
        Ok(RunOutcome {
            stdout: text,
            exit_code: 0,
            stderr_note: None,
        })
    }
}

fn restore(
    request_id: &str,
    json: bool,
    data_dir: &Path,
    backup_id: &str,
) -> Result<RunOutcome, CliError> {
    let report = restore_pre_migration_backup(data_dir, backup_id).map_err(|error| match error {
        RestoreError::UnknownBackup(_) => local(
            request_id,
            "not_found",
            error.to_string(),
        ),
        RestoreError::InvalidBackup(reason) => {
            local(request_id, "invalid_argument", format!("backup refused: {reason}"))
        }
        RestoreError::NewerThanThisBuild(reason) => {
            local(request_id, "invalid_argument", format!("backup refused: {reason}"))
        }
        RestoreError::LockHeld(io) => {
            let mut error = drogon_protocol::RpcError::new(
                "runtime_busy",
                format!(
                    "restore refused: a running daemon holds this data directory. Quit Drogon (or stop the daemon) and try again: {io}"
                ),
            );
            error.retryable = true;
            CliError::Local {
                error,
                request_id: request_id.to_string(),
            }
        }
        other => local(request_id, "io_error", other.to_string()),
    })?;
    if json {
        let payload = json!({
            "restoredBackupId": report.restored_backup_id,
            "preRestoreSnapshotId": report.pre_restore_snapshot_id,
            "databaseFile": report.database_file.to_string_lossy(),
            "sizeBytes": report.database_bytes,
        });
        Ok(RunOutcome {
            stdout: serde_json::to_string_pretty(&payload).map_err(|err| {
                local(request_id, "internal_error", format!("cannot encode response: {err}"))
            })?,
            exit_code: 0,
            stderr_note: None,
        })
    } else {
        let snapshot = report
            .pre_restore_snapshot_id
            .as_deref()
            .map(|id| format!(" The overwritten state was snapshotted as {id}."))
            .unwrap_or_else(|| " There was no live database to snapshot.".to_string());
        Ok(RunOutcome {
            stdout: format!(
                "Restored {} ({} bytes) over the live database.{snapshot} Relaunch Drogon to continue.",
                report.restored_backup_id, report.database_bytes
            ),
            exit_code: 0,
            stderr_note: None,
        })
    }
}

fn entry_json(entry: &BackupEntry) -> serde_json::Value {
    let (restorable, invalid_reason, not_restorable_reason) = match (&entry.invalid_reason, &entry.not_restorable_reason) {
        (None, None) => (true, None, None),
        (Some(reason), _) => (false, Some(reason.clone()), None),
        (None, Some(reason)) => (false, None, Some(reason.clone())),
    };
    json!({
        "id": entry.id,
        "createdAt": entry.manifest.as_ref().map(|m| m.created_at.clone()),
        "originalDataDir": entry.manifest.as_ref().map(|m| m.original_data_dir.clone()),
        "writerBuildVersion": entry.manifest.as_ref().map(|m| m.writer_build_version.clone()),
        "sizeBytes": entry.database_bytes,
        "pendingMigrations": entry
            .manifest
            .as_ref()
            .map(|m| {
                m.pending_migrations
                    .iter()
                    .map(|p| {
                        json!({
                            "component": p.component,
                            "recordedVersion": p.recorded_version,
                            "migratingTo": p.migrating_to,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        "restorable": restorable,
        "invalidReason": invalid_reason,
        "notRestorableReason": not_restorable_reason,
    })
}

fn entry_line(entry: &BackupEntry) -> String {
    let stamp = entry
        .manifest
        .as_ref()
        .map(|m| m.created_at.clone())
        .unwrap_or_else(|| "unknown time".to_string());
    let size = entry
        .database_bytes
        .map(|bytes| format!("{bytes} bytes"))
        .unwrap_or_else(|| "no database file".to_string());
    let verdict = if let Some(reason) = &entry.invalid_reason {
        format!("UNUSABLE: {reason}")
    } else if let Some(reason) = &entry.not_restorable_reason {
        format!("NOT RESTORABLE BY THIS BUILD: {reason}")
    } else {
        "restorable by this build".to_string()
    };
    let components = entry
        .manifest
        .as_ref()
        .map(|m| {
            m.pending_migrations
                .iter()
                .map(|p| format!("{} {}→{}", p.component, p.recorded_version, p.migrating_to))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|s| !s.is_empty())
        .map(|s| format!("    migrated: {s}\n"))
        .unwrap_or_default();
    format!("  {}  {stamp}  {size}  {verdict}\n{components}", entry.id)
}

fn local(request_id: &str, code: &str, message: String) -> CliError {
    CliError::local(drogon_protocol::RpcError::new(code, message), request_id)
}
