//! Deterministic evaluation for `local_file_digest.v1`.
//!
//! Pure computation only: the caller performs the bounded file read (with
//! its own timeout, outside any DB lock) and hands the bytes here. No
//! processes, no network, no model calls — unchanged checks never leave
//! this function. Absence/permission/oversize failures are modeled by the
//! caller via [`read_failure`] into an honest error, never a silent
//! no-change or a deletion.

use sha2::{Digest, Sha256};

use super::record::MonitorRecord;
use super::result::{MonitorCheckResult, MonitorErrorKind};

/// `sha256` hex of raw file bytes.
pub fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Stable cursor for a content digest.
pub fn cursor_for_digest(digest_hex: &str) -> String {
    format!("v1:{digest_hex}")
}

/// Stable event id for one monitor version observing one digest. Same
/// inputs always yield the same id, so replays and duplicate ticks
/// collapse onto one event.
pub fn event_id_for(monitor_id: &str, approved_rule_hash: &str, digest_hex: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(monitor_id.as_bytes());
    hasher.update([0u8]);
    hasher.update(approved_rule_hash.as_bytes());
    hasher.update([0u8]);
    hasher.update(digest_hex.as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    format!("mev_{}", &hex[..32])
}

/// Pure lexical containment check: join `resource` onto `project_root`
/// without touching the filesystem. Returns the joined display path on
/// success. Rejects absolute resources and any `..` escape above the
/// project root.
pub fn resolve_scoped_path(project_root: &str, resource: &str) -> Result<String, String> {
    if project_root.is_empty() {
        return Err("project root must not be empty".to_string());
    }
    if resource.is_empty() || resource.starts_with('/') {
        return Err("resource must be project-relative".to_string());
    }
    let mut depth: i64 = 0;
    for segment in resource.split('/') {
        match segment {
            "" => return Err("resource must not contain empty segments".to_string()),
            "." => {}
            ".." => {
                depth -= 1;
                if depth < 0 {
                    return Err("resource escapes the project root".to_string());
                }
            }
            _ => depth += 1,
        }
    }
    let root = project_root.trim_end_matches('/');
    Ok(format!("{root}/{resource}"))
}

/// Evaluate already-read bytes against the stored record. The caller
/// guarantees `file_bytes.len()` is the complete file (it enforced
/// `max_bytes` while reading); a longer slice here is still treated as
/// oversized rather than truncated.
pub fn evaluate_bytes(
    record: &MonitorRecord,
    file_bytes: &[u8],
    observed_at_ms: f64,
) -> MonitorCheckResult {
    if !record.enabled {
        return MonitorCheckResult::error(
            &record.id,
            record.version,
            MonitorErrorKind::Disabled,
            "monitor is disabled",
            observed_at_ms,
        );
    }
    if !record.is_approved() {
        return MonitorCheckResult::error(
            &record.id,
            record.version,
            MonitorErrorKind::NeedsApproval,
            "rule changed since approval; approve the new rule before checks run",
            observed_at_ms,
        );
    }
    let Some(file_rule) = record.rule.local_file() else {
        // The file evaluator is only defined for `local_file_digest.v1`.
        // Other kinds are admitted (P1) but their execution arrives with the
        // bounded runner (P2); refusing here is honest, never a no-change.
        return MonitorCheckResult::error(
            &record.id,
            record.version,
            MonitorErrorKind::Malformed,
            format!(
                "rule kind {} has no file evaluator in this build",
                record.rule.kind_str()
            ),
            observed_at_ms,
        );
    };
    let bound = file_rule.max_bytes as usize;
    if file_bytes.len() > bound {
        return MonitorCheckResult::error(
            &record.id,
            record.version,
            MonitorErrorKind::Oversized,
            format!(
                "file is {} bytes, over the {} byte bound; prior cursor retained",
                file_bytes.len(),
                bound
            ),
            observed_at_ms,
        );
    }
    let digest = digest_bytes(file_bytes);
    let cursor = cursor_for_digest(&digest);
    match &record.cursor {
        Some(stored) if *stored == cursor => {
            MonitorCheckResult::no_change(&record.id, record.version, cursor, observed_at_ms)
        }
        _ => {
            let event_id = event_id_for(&record.id, &record.approved_rule_hash, &digest);
            MonitorCheckResult::changed(
                &record.id,
                record.version,
                event_id,
                cursor,
                observed_at_ms,
            )
        }
    }
}

/// Model a failed file read as an honest error result. `kind` must be one
/// of NotFound/Forbidden/Unauthorized/IoError/Timeout; anything else is a
/// caller bug and is coerced to IoError rather than trusted.
pub fn read_failure(
    record: &MonitorRecord,
    kind: MonitorErrorKind,
    message: impl Into<String>,
    observed_at_ms: f64,
) -> MonitorCheckResult {
    let kind = match kind {
        MonitorErrorKind::NotFound
        | MonitorErrorKind::Forbidden
        | MonitorErrorKind::Unauthorized
        | MonitorErrorKind::IoError
        | MonitorErrorKind::Timeout => kind,
        _ => MonitorErrorKind::IoError,
    };
    MonitorCheckResult::error(&record.id, record.version, kind, message, observed_at_ms)
}

#[cfg(test)]
mod tests {
    use super::super::record::{MonitorTrigger, new_monitor};
    use super::super::rule::{LocalFileRule, MonitorRule};
    use super::*;

    fn record(cursor: Option<String>) -> MonitorRecord {
        let rule = MonitorRule::LocalFileDigest(LocalFileRule {
            host_id: "h".to_string(),
            project_id: "p".to_string(),
            resource: "notes/a.md".to_string(),
            max_bytes: 1024,
        });
        let hash = rule.approval_hash();
        let mut rec = new_monitor(
            "mon-1".into(),
            Some("bot-1".into()),
            rule,
            MonitorTrigger::Manual,
            hash,
            1.0,
        )
        .unwrap();
        rec.cursor = cursor;
        rec
    }

    #[test]
    fn same_bytes_after_restart_is_no_change_with_stable_cursor() {
        let bytes = b"hello";
        let first = evaluate_bytes(&record(None), bytes, 10.0);
        let cursor = first.cursor().unwrap().to_string();
        let event = first.event_id().unwrap().to_string();
        let mut stored = record(Some(cursor.clone()));
        let second = evaluate_bytes(&stored, bytes, 20.0);
        assert!(matches!(
            second.outcome,
            super::super::result::MonitorOutcome::NoChange { .. }
        ));
        assert_eq!(second.cursor().unwrap(), cursor);
        // A "restart" (same stored cursor) repeats the same answer.
        stored.cursor = Some(cursor.clone());
        let third = evaluate_bytes(&stored, bytes, 30.0);
        assert_eq!(third.cursor().unwrap(), cursor);
        let _ = event;
    }

    #[test]
    fn one_new_version_creates_one_stable_event_id() {
        let a = evaluate_bytes(&record(None), b"v1", 10.0);
        let b = evaluate_bytes(&record(None), b"v1", 11.0);
        assert_eq!(a.event_id(), b.event_id());
        let c = evaluate_bytes(&record(None), b"v2", 12.0);
        assert_ne!(a.event_id(), c.event_id());
    }

    #[test]
    fn oversize_is_error_not_change() {
        let rec = record(None);
        let big = vec![b'x'; 2048];
        let result = evaluate_bytes(&rec, &big, 5.0);
        assert!(result.is_error());
        assert!(result.cursor().is_none());
    }

    #[test]
    fn scoped_paths_reject_escape() {
        assert!(resolve_scoped_path("/proj", "notes/a.md").is_ok());
        assert!(resolve_scoped_path("/proj", "../etc/passwd").is_err());
        assert!(resolve_scoped_path("/proj", "/abs").is_err());
    }

    #[test]
    fn non_file_kind_is_an_honest_error_not_a_no_change() {
        let rule = MonitorRule::ScriptCommand(super::super::rule::ScriptRule {
            host_id: "h".to_string(),
            project_id: "p".to_string(),
            script_path: "scripts/watch.sh".to_string(),
            script_hash: "ab".repeat(32),
            interpreter: super::super::rule::ScriptInterpreter::GhApi,
            argv: vec!["repos/clioo/drogon/pulls".to_string()],
            timeout_ms: 30_000,
            max_output_bytes: 65_536,
            secret_refs: vec![],
        });
        let hash = rule.approval_hash();
        let rec = new_monitor(
            "mon-script".into(),
            Some("bot-1".into()),
            rule,
            MonitorTrigger::Manual,
            hash,
            1.0,
        )
        .unwrap();
        let result = evaluate_bytes(&rec, b"anything", 5.0);
        assert!(result.is_error());
        assert!(result.cursor().is_none());
    }

    #[test]
    fn re_approval_after_an_edit_re_keys_event_identity() {
        // The event id mixes the APPROVED rule hash, so an observation after
        // an edit can never dedupe against a pre-edit event even when the
        // bytes are identical.
        let before = record(None);
        let first = evaluate_bytes(&before, b"same bytes", 10.0);
        let first_id = first.event_id().unwrap().to_string();

        let edited = super::super::record::staged_rule_edit(
            before,
            MonitorRule::LocalFileDigest(LocalFileRule {
                host_id: "h".to_string(),
                project_id: "p".to_string(),
                resource: "notes/other.md".to_string(),
                max_bytes: 1024,
            }),
            20.0,
        )
        .unwrap();
        assert!(!edited.is_approved(), "an edit re-parks the monitor");
        let re_approved = super::super::record::approve_rule(edited, 30.0);
        assert!(re_approved.is_approved());
        let second = evaluate_bytes(&re_approved, b"same bytes", 40.0);
        let second_id = second.event_id().unwrap().to_string();
        assert_ne!(first_id, second_id, "post-edit events re-key");
    }
}
