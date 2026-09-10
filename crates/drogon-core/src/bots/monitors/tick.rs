//! Monitor producer tick: evaluate admitted `local_file_digest.v1`
//! monitors and commit change events into the delegation outbox.
//!
//! Pure evaluation ([`eval`]) and the pure commit decision ([`commit`])
//! already exist; this module is the small durable driver between them
//! and storage. For every admitted monitor, oldest-first:
//!
//! 1. Resolve the project root from the caller-supplied map (the daemon
//!    loads it from the `projects` table; tests use a temp dir). No root
//!    → honest `IoError` check-in, never a silent skip.
//! 2. Read the file bounded (`max_bytes + 1` so oversize is observed, not
//!    truncated) with NO database guard held, canonicalize-and-compare
//!    against the project root (symlink escape → `Forbidden` check-in,
//!    mirroring `bot_self_mgmt::read_scoped_file`'s containment read).
//! 3. [`evaluate_bytes`](super::eval::evaluate_bytes) or
//!    [`read_failure`](super::eval::read_failure), then
//!    [`decide_commit`](super::commit::decide_commit).
//! 4. Persist, per decision:
//!    - `Advance`: cursor + `last_event_id` + success evidence, the check
//!      row, and the outbox enqueue in ONE transaction (via
//!      [`commit_advance_in_tx`](super::storage::commit_advance_in_tx) —
//!      the enqueue closure writes the [`DelegationEvent`](crate::bots::delegation::DelegationEvent));
//!      cursor and outbox commit atomically, never one without the other.
//!    - `Retain(NoChange | DuplicateTick)`: the check row plus success
//!      evidence (cursor unchanged).
//!    - `Retain(ErrorRetained)`: consecutive-errors +1, backoff watermark
//!      ([`backoff_ms`](super::commit::backoff_ms)), 512-char-truncated
//!      `last_error`, and the check row.
//!    - `Retain(Disabled) | RefuseStale`: nothing (cannot happen from our
//!      own fresh evaluation; a concurrent edit won the CAS race — the
//!      next tick re-reads).
//!
//! Admission mirrors the documented gates: disabled and unapproved monitors
//! never evaluate, and the backoff watermark (`next_eligible_at_ms`) is
//! honored before any file I/O. v1 polls every admitted monitor each tick;
//! per-monitor cron gating is future work (the `MonitorTrigger::Scheduled`
//! intent is carried but not yet enforced — stated, not hidden).

use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::Connection;

use super::commit::{CommitDecision, CommitInput, RetainReason, StoredMonitorState, backoff_ms};
use super::eval::{self, resolve_scoped_path};
use super::record::MonitorRecord;
use super::result::MonitorErrorKind;
use super::storage::{self, DeliveryState, StoredCheck};
use crate::bots::delegation::DelegationEvent;

/// Outcome counts for one producer pass, for tests and operator logs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MonitorTickSummary {
    pub checked: usize,
    pub advanced: usize,
    pub no_change: usize,
    pub duplicate: usize,
    pub errors: usize,
    /// Disabled, unapproved, or backoff-gated monitors left untouched.
    pub skipped: usize,
    /// Storage failures; the monitor keeps its old state for next tick.
    pub failed: usize,
}

/// `last_error` keeps the 512-char truncation precedent (`bot_self_mgmt`'s
/// persisted-error bound): enough to diagnose, never an unbounded blob.
const LAST_ERROR_MAX_CHARS: usize = 512;

fn truncate_error(message: &str) -> String {
    if message.chars().count() > LAST_ERROR_MAX_CHARS {
        let kept: String = message.chars().take(LAST_ERROR_MAX_CHARS).collect();
        format!("{kept}…")
    } else {
        message.to_string()
    }
}

fn stored_of(record: &MonitorRecord) -> StoredMonitorState {
    StoredMonitorState {
        monitor_id: record.id.clone(),
        version: record.version,
        cursor: record.cursor.clone(),
        last_event_id: record.last_event_id.clone(),
        enabled: record.enabled,
    }
}

/// Read one scoped file, bounded. Returns the complete bytes when within
/// bound, or a caller-modelled failure kind + message. No database guard
/// is held by the caller across this call (file I/O stays off the lock).
fn read_scoped_file(
    project_root: &str,
    resource: &str,
    max_bytes: u64,
) -> std::result::Result<Vec<u8>, (MonitorErrorKind, String)> {
    let joined = resolve_scoped_path(project_root, resource).map_err(|e| {
        (
            MonitorErrorKind::Forbidden,
            format!("resource refused: {e}"),
        )
    })?;
    // Containment: the lexical join must survive canonicalization (a
    // symlink inside the project pointing outside refuses honestly).
    let canonical_root = std::fs::canonicalize(project_root).map_err(|e| {
        (
            MonitorErrorKind::NotFound,
            format!("project root unreadable: {e}"),
        )
    })?;
    let canonical_file = std::fs::canonicalize(&joined).map_err(|e| {
        let kind = match e.kind() {
            std::io::ErrorKind::NotFound => MonitorErrorKind::NotFound,
            std::io::ErrorKind::PermissionDenied => MonitorErrorKind::Forbidden,
            _ => MonitorErrorKind::IoError,
        };
        (kind, format!("read failed: {e}"))
    })?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err((
            MonitorErrorKind::Forbidden,
            "resource escapes the project root".to_string(),
        ));
    }
    let file = std::fs::File::open(&canonical_file)
        .map_err(|e| (MonitorErrorKind::IoError, format!("read failed: {e}")))?;
    let mut bytes = Vec::new();
    use std::io::Read;
    // Bound + 1: oversize must be *observed* (and reported by the pure
    // evaluator) rather than silently truncated into a wrong digest.
    let cap = max_bytes.saturating_add(1).min(usize::MAX as u64) as usize;
    file.take(cap as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| (MonitorErrorKind::IoError, format!("read failed: {e}")))?;
    Ok(bytes)
}

/// Evaluate every admitted monitor once and persist the decisions.
/// `project_roots` maps `(host_id, project_id)` to a filesystem root;
/// every phase locks `db` briefly and file reads happen lock-free.
pub fn tick_monitors(
    db: &Mutex<Connection>,
    project_roots: &HashMap<(String, String), String>,
    now_ms: f64,
) -> MonitorTickSummary {
    let mut summary = MonitorTickSummary::default();
    let monitors: Vec<MonitorRecord> = match storage::list_all_monitors(&db.lock().unwrap()) {
        Ok(monitors) => monitors,
        Err(e) => {
            eprintln!("[monitors] tick list failed: {e}");
            return summary;
        }
    };
    for listed in &monitors {
        // Fresh read per monitor: a concurrent edit between list and tick
        // must be observed, never overwritten.
        let (mut record, rev) = match storage::get_monitor(&db.lock().unwrap(), &listed.id) {
            Ok(Some(found)) => found,
            Ok(None) => {
                summary.skipped += 1;
                continue;
            }
            Err(e) => {
                eprintln!("[monitors] tick read failed for {}: {e}", listed.id);
                summary.failed += 1;
                continue;
            }
        };
        if !record.enabled || !record.is_approved() {
            summary.skipped += 1;
            continue;
        }
        if !super::commit::should_admit(now_ms, record.next_eligible_at_ms, record.enabled) {
            summary.skipped += 1;
            continue;
        }
        summary.checked += 1;
        let rule = record.rule.local_file().clone();
        let key = (rule.host_id.clone(), rule.project_id.clone());
        let bytes = match project_roots.get(&key) {
            None => Err((
                MonitorErrorKind::IoError,
                format!("project {} is not registered on this host", rule.project_id),
            )),
            Some(root) => read_scoped_file(root, &rule.resource, rule.max_bytes),
        };
        let result = match bytes {
            Ok(bytes) => eval::evaluate_bytes(&record, &bytes, now_ms),
            Err((kind, message)) => eval::read_failure(&record, kind, message, now_ms),
        };
        let decision = super::commit::decide_commit(
            &stored_of(&record),
            &rule.host_id,
            &rule.project_id,
            &rule.resource,
            record.bot_id.as_deref(),
            &result,
            &CommitInput {
                expected_version: record.version,
            },
        );
        match decision {
            CommitDecision::Advance { new_cursor, intent } => {
                record.cursor = Some(new_cursor);
                record.last_event_id = Some(intent.event_id.clone());
                record.last_success_at_ms = Some(now_ms);
                record.consecutive_errors = 0;
                record.next_eligible_at_ms = None;
                record.last_error = None;
                record.updated_at_ms = now_ms;
                let check = StoredCheck {
                    id: format!("mchk-{}", intent.event_id),
                    monitor_id: record.id.clone(),
                    monitor_version: record.version,
                    started_at_ms: now_ms,
                    result: result.clone(),
                    delivery: DeliveryState::Pending,
                };
                let event = DelegationEvent {
                    event_id: intent.event_id.clone(),
                    monitor_id: intent.monitor_id.clone(),
                    monitor_version: intent.monitor_version,
                    cursor: intent.cursor.clone(),
                    host_id: intent.host_id.clone(),
                    project_id: intent.project_id.clone(),
                    resource: intent.resource.clone(),
                    bot_id: intent.bot_id.clone(),
                    observed_at_ms: intent.observed_at_ms,
                };
                let write = (|| {
                    let conn = db.lock().unwrap();
                    let tx = conn.unchecked_transaction()?;
                    storage::commit_advance_in_tx(&tx, &record, rev, &check, |tx| {
                        crate::bots::delegation::enqueue_event_in_tx(tx, &event)
                            .map(|_| ())
                            .map_err(|e| e.to_string())
                    })?;
                    tx.commit()?;
                    Ok::<(), storage::CommitTxError>(())
                })();
                match write {
                    Ok(()) => summary.advanced += 1,
                    Err(e) => {
                        eprintln!("[monitors] advance failed for {}: {e}", record.id);
                        summary.failed += 1;
                    }
                }
            }
            CommitDecision::Retain {
                reason: RetainReason::NoChange | RetainReason::DuplicateTick,
            } => {
                let duplicate = matches!(
                    result.outcome,
                    super::result::MonitorOutcome::Changed { .. }
                );
                record.last_success_at_ms = Some(now_ms);
                record.updated_at_ms = now_ms;
                let check = StoredCheck {
                    id: format!("mchk-{}-{:.0}", record.id, now_ms),
                    monitor_id: record.id.clone(),
                    monitor_version: record.version,
                    started_at_ms: now_ms,
                    result: result.clone(),
                    delivery: DeliveryState::NotApplicable,
                };
                let write = (|| {
                    let conn = db.lock().unwrap();
                    storage::cas_write(&conn, &record, rev)?;
                    storage::record_check(&conn, &check)?;
                    Ok::<(), storage::StorageError>(())
                })();
                match write {
                    Ok(()) => {
                        if duplicate {
                            summary.duplicate += 1;
                        } else {
                            summary.no_change += 1;
                        }
                    }
                    Err(e) => {
                        eprintln!("[monitors] retain failed for {}: {e}", record.id);
                        summary.failed += 1;
                    }
                }
            }
            CommitDecision::Retain {
                reason: RetainReason::ErrorRetained,
            } => {
                let message = match &result.outcome {
                    super::result::MonitorOutcome::Error { message, .. } => message.as_str(),
                    _ => "unknown monitor error",
                };
                record.consecutive_errors = record.consecutive_errors.saturating_add(1);
                record.next_eligible_at_ms = Some(now_ms + backoff_ms(record.consecutive_errors));
                record.last_error = Some(truncate_error(message));
                record.updated_at_ms = now_ms;
                let check = StoredCheck {
                    id: format!("mchk-{}-{:.0}", record.id, now_ms),
                    monitor_id: record.id.clone(),
                    monitor_version: record.version,
                    started_at_ms: now_ms,
                    result: result.clone(),
                    delivery: DeliveryState::NotApplicable,
                };
                let write = (|| {
                    let conn = db.lock().unwrap();
                    storage::cas_write(&conn, &record, rev)?;
                    storage::record_check(&conn, &check)?;
                    Ok::<(), storage::StorageError>(())
                })();
                match write {
                    Ok(()) => summary.errors += 1,
                    Err(e) => {
                        eprintln!("[monitors] error-retain failed for {}: {e}", record.id);
                        summary.failed += 1;
                    }
                }
            }
            CommitDecision::Retain {
                reason: RetainReason::Disabled,
            }
            | CommitDecision::RefuseStale { .. } => {
                // Our own fresh evaluation cannot be stale or disabled
                // (admission checked both); a concurrent writer won the
                // race — the next tick re-reads. Count as skipped, loudly.
                eprintln!("[monitors] tick lost a CAS race for {}", record.id);
                summary.skipped += 1;
            }
        }
    }
    summary
}
