//! Durable worker resource-retention state for `orchestration.workerRetain`
//! and its minimum integration with `orchestration.workerRelease`.
// MIT Copyright (c) 2026 Lovecast Inc.
// Source behavior: src/main/runtime/rpc/methods/orchestration-worker-release.ts
// and src/main/runtime/orchestration/db/worker-terminal/worker-terminal-archive.ts
// (retainWorkerTerminalResource dispositions only; no archive parity claimed).
//!
//! The table records, per dispatch, whether its resources are held
//! (`retained`), committed to release (`release_pending` / `release_unknown`)
//! or finished (`released`). Retain itself performs no process or filesystem
//! effects and never equates process exit with release: it only writes the
//! `retained` / `user_requested` row. A committed release cannot be undone
//! by retain; an explicit release clears a requested retention and records
//! the actual release outcome.

use rusqlite::{OptionalExtension, Transaction, params};

use drogon_protocol::RpcError;

pub(crate) const SCHEMA_COMPONENT: &str = "worker_resource_retention";
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// Durable per-dispatch resource state. `retained` means a user-requested
/// hold; `release_pending` / `release_unknown` mean release already
/// committed; `released` means release finished.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResourceState {
    Retained,
    ReleasePending,
    ReleaseUnknown,
    Released,
}

impl ResourceState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Retained => "retained",
            Self::ReleasePending => "release_pending",
            Self::ReleaseUnknown => "release_unknown",
            Self::Released => "released",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "retained" => Some(Self::Retained),
            "release_pending" => Some(Self::ReleasePending),
            "release_unknown" => Some(Self::ReleaseUnknown),
            "released" => Some(Self::Released),
            _ => None,
        }
    }
}

/// Outcome of a retain attempt, mirroring the source dispositions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RetainDisposition {
    /// Freshly recorded (or re-recorded) user-requested hold.
    Retained,
    /// The resource already finished release.
    AlreadyReleased,
    /// Release already committed; carries which committed state was found so
    /// callers report `release_pending` vs `release_unknown` honestly.
    ReleaseCommitted(ResourceState),
}

fn create_v1_table(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS worker_resource_retention (
            dispatch_id TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            reason TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
}

pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    // Fail upgrade-safety style: a newer writer owns this component.
    if let Some(found) = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SCHEMA_COMPONENT],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        && found > SCHEMA_VERSION
    {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some(format!(
                "{SCHEMA_COMPONENT} schema version {found} is newer than supported {SCHEMA_VERSION}"
            )),
        ));
    }
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    let mut from_version = existing.unwrap_or(0);
    if from_version < 0 {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some(format!(
                "Invalid {SCHEMA_COMPONENT} schema version {from_version}"
            )),
        ));
    }
    while from_version < SCHEMA_VERSION {
        let next_version = from_version + 1;
        match next_version {
            1 => create_v1_table(tx)?,
            _ => unreachable!("no migration step defined for version {next_version}"),
        }
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)
             ON CONFLICT(component) DO UPDATE SET version = excluded.version",
            params![SCHEMA_COMPONENT, next_version],
        )?;
        from_version = next_version;
    }
    Ok(())
}

pub(crate) fn get_state_in_tx(
    tx: &Transaction,
    dispatch_id: &str,
) -> Result<Option<(ResourceState, String)>, RpcError> {
    let row: Option<(String, String)> = tx
        .query_row(
            "SELECT state, reason FROM worker_resource_retention WHERE dispatch_id = ?1",
            params![dispatch_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(crate::error::from_sqlite)?;
    match row {
        None => Ok(None),
        Some((state, reason)) => match ResourceState::parse(&state) {
            Some(state) => Ok(Some((state, reason))),
            None => Err(crate::error::internal_error(
                "Invalid stored worker resource state.",
            )),
        },
    }
}

/// Records a user-requested hold. No process or filesystem effects.
/// `released` stays released (`AlreadyReleased`); a committed release
/// (`release_pending` / `release_unknown`) cannot be undone
/// (`ReleaseCommitted`); otherwise the hold is (re)recorded.
pub(crate) fn retain_in_tx(
    tx: &Transaction,
    dispatch_id: &str,
    now: &str,
) -> Result<RetainDisposition, RpcError> {
    match get_state_in_tx(tx, dispatch_id)? {
        Some((ResourceState::Released, _)) => Ok(RetainDisposition::AlreadyReleased),
        Some((state @ (ResourceState::ReleasePending | ResourceState::ReleaseUnknown), _)) => {
            Ok(RetainDisposition::ReleaseCommitted(state))
        }
        Some((ResourceState::Retained, _)) | None => {
            let rows = tx
                .execute(
                    "INSERT INTO worker_resource_retention(dispatch_id, state, reason, updated_at)
                     VALUES (?1, 'retained', 'user_requested', ?2)
                     ON CONFLICT(dispatch_id) DO UPDATE SET
                       state = 'retained', reason = 'user_requested', updated_at = excluded.updated_at",
                    params![dispatch_id, now],
                )
                .map_err(crate::error::from_sqlite)?;
            if rows != 1 {
                return Err(crate::error::internal_error(
                    "Worker retain upsert did not record its row.",
                ));
            }
            Ok(RetainDisposition::Retained)
        }
    }
}

/// An explicit release clears a requested retention, then the caller records
/// the actual release outcome with [`record_release_in_tx`].
pub(crate) fn clear_retention_in_tx(tx: &Transaction, dispatch_id: &str) -> Result<(), RpcError> {
    tx.execute(
        "DELETE FROM worker_resource_retention
          WHERE dispatch_id = ?1 AND state = 'retained'",
        params![dispatch_id],
    )
    .map_err(crate::error::from_sqlite)?;
    Ok(())
}

/// Reads the recorded state outside a caller transaction (tests only).
#[cfg(test)]
pub(crate) fn test_state(
    conn: &rusqlite::Connection,
    dispatch_id: &str,
) -> Option<(String, String)> {
    conn.query_row(
        "SELECT state, reason FROM worker_resource_retention WHERE dispatch_id = ?1",
        params![dispatch_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .expect("read retention row")
}

/// Records the actual release outcome for a dispatch. Never invents an
/// archive: the row carries the disposition only.
pub(crate) fn record_release_in_tx(
    tx: &Transaction,
    dispatch_id: &str,
    state: ResourceState,
    now: &str,
) -> Result<(), RpcError> {
    debug_assert!(state != ResourceState::Retained);
    let rows = tx
        .execute(
            "INSERT INTO worker_resource_retention(dispatch_id, state, reason, updated_at)
             VALUES (?1, ?2, ?2, ?3)
             ON CONFLICT(dispatch_id) DO UPDATE SET
               state = excluded.state, reason = excluded.reason, updated_at = excluded.updated_at",
            params![dispatch_id, state.as_str(), now],
        )
        .map_err(crate::error::from_sqlite)?;
    if rows != 1 {
        return Err(crate::error::internal_error(
            "Worker release upsert did not record its row.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;

    const NOW: &str = "2026-09-09T00:00:00Z";

    fn migrated() -> Connection {
        let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
        let tx = conn.transaction().expect("begin");
        apply_pending_steps_in_tx(&tx).expect("migrate");
        tx.commit().expect("commit");
        conn
    }

    fn retain(conn: &mut Connection, dispatch: &str) -> RetainDisposition {
        let tx = conn.transaction().expect("begin");
        let disposition = retain_in_tx(&tx, dispatch, NOW).expect("retain");
        tx.commit().expect("commit");
        disposition
    }

    #[test]
    fn migration_is_idempotent_and_versioned() {
        let mut conn = migrated();
        let tx = conn.transaction().expect("begin");
        apply_pending_steps_in_tx(&tx).expect("second migrate is a no-op");
        tx.commit().expect("commit");
        let version: i64 = conn
            .query_row(
                "SELECT version FROM schema_versions WHERE component = ?1",
                params![SCHEMA_COMPONENT],
                |r| r.get(0),
            )
            .expect("version row");
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn unsupported_versions_are_refused_without_changing_retention() {
        for version in [-1, 2] {
            let mut conn = migrated();
            retain(&mut conn, "dispatch");
            conn.execute(
                "UPDATE schema_versions SET version=?1 WHERE component=?2",
                params![version, SCHEMA_COMPONENT],
            )
            .unwrap();
            let tx = conn.transaction().unwrap();
            assert!(apply_pending_steps_in_tx(&tx).is_err());
            tx.rollback().unwrap();
            assert_eq!(
                test_state(&conn, "dispatch"),
                Some(("retained".into(), "user_requested".into()))
            );
            assert_eq!(
                conn.query_row(
                    "SELECT version FROM schema_versions WHERE component=?1",
                    [SCHEMA_COMPONENT],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                version
            );
        }
    }

    #[test]
    fn migration_rollback_leaves_no_table() {
        let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
        {
            let tx = conn.transaction().expect("begin");
            apply_pending_steps_in_tx(&tx).expect("migrate");
        }
        assert!(
            conn.execute("SELECT 1 FROM worker_resource_retention", [])
                .is_err()
        );
    }

    #[test]
    fn retain_records_user_requested_without_effects() {
        let mut conn = migrated();
        assert_eq!(retain(&mut conn, "dispatch-1"), RetainDisposition::Retained);
        assert_eq!(
            test_state(&conn, "dispatch-1"),
            Some(("retained".to_string(), "user_requested".to_string()))
        );
        // Re-retaining is idempotent, never an error.
        assert_eq!(retain(&mut conn, "dispatch-1"), RetainDisposition::Retained);
    }

    #[test]
    fn released_resource_reads_already_released() {
        let mut conn = migrated();
        let tx = conn.transaction().expect("begin");
        record_release_in_tx(&tx, "dispatch-1", ResourceState::Released, NOW).expect("record");
        tx.commit().expect("commit");
        assert_eq!(
            retain(&mut conn, "dispatch-1"),
            RetainDisposition::AlreadyReleased
        );
        // The released row is untouched by the refused retain.
        assert_eq!(
            test_state(&conn, "dispatch-1"),
            Some(("released".to_string(), "released".to_string()))
        );
    }

    #[test]
    fn committed_release_cannot_be_undone() {
        for state in [ResourceState::ReleasePending, ResourceState::ReleaseUnknown] {
            let mut conn = migrated();
            let tx = conn.transaction().expect("begin");
            record_release_in_tx(&tx, "dispatch-1", state, NOW).expect("record");
            tx.commit().expect("commit");
            assert_eq!(
                retain(&mut conn, "dispatch-1"),
                RetainDisposition::ReleaseCommitted(state),
                "state {:?} must refuse retain",
                state
            );
            assert_eq!(
                test_state(&conn, "dispatch-1").map(|row| row.0),
                Some(state.as_str().to_string())
            );
        }
    }

    #[test]
    fn explicit_release_clears_requested_retention_then_records_outcome() {
        let mut conn = migrated();
        assert_eq!(retain(&mut conn, "dispatch-1"), RetainDisposition::Retained);
        let tx = conn.transaction().expect("begin");
        clear_retention_in_tx(&tx, "dispatch-1").expect("clear");
        record_release_in_tx(&tx, "dispatch-1", ResourceState::Released, NOW).expect("record");
        tx.commit().expect("commit");
        assert_eq!(
            retain(&mut conn, "dispatch-1"),
            RetainDisposition::AlreadyReleased
        );
    }

    #[test]
    fn clear_leaves_committed_and_released_rows_alone() {
        let mut conn = migrated();
        for state in [
            ResourceState::ReleasePending,
            ResourceState::ReleaseUnknown,
            ResourceState::Released,
        ] {
            let tx = conn.transaction().expect("begin");
            record_release_in_tx(&tx, "dispatch-1", state, NOW).expect("record");
            clear_retention_in_tx(&tx, "dispatch-1").expect("clear");
            tx.commit().expect("commit");
            assert_eq!(
                test_state(&conn, "dispatch-1").map(|row| row.0),
                Some(state.as_str().to_string()),
                "clear must not touch state {:?}",
                state
            );
        }
    }

    #[test]
    fn corrupt_state_fails_closed() {
        let mut conn = migrated();
        conn.execute(
            "INSERT INTO worker_resource_retention(dispatch_id, state, reason, updated_at)
             VALUES ('dispatch-1', 'bogus', 'bogus', ?1)",
            params![NOW],
        )
        .expect("plant corrupt row");
        let tx = conn.transaction().expect("begin");
        assert!(retain_in_tx(&tx, "dispatch-1", NOW).is_err());
    }
}
