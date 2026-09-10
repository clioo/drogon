//! Versioned structured monitor result (C10 checkpoint 1).
//!
//! Schema version 1 carries exactly three outcomes:
//! - `no_change`: the bytes digest to the stored cursor; zero model calls,
//!   zero conversations.
//! - `changed`: new bytes observed; carries a stable `event_id` and the new
//!   `cursor`. One new version creates one committed local event.
//! - `error`: absence, 401/403/500-shaped failures, oversized or malformed
//!   output, timeout, or refusal (needs-approval, disabled, stale, rate
//!   limited). An error retains the prior cursor and emits nothing.
//!
//! Every result is shape-validated before any cursor commit; network-shaped
//! fields are never invented here (v1 reads local files only).

use serde::{Deserialize, Serialize};

/// Wire/storage schema version for [`MonitorCheckResult`].
pub const RESULT_SCHEMA_VERSION: u32 = 1;
/// Longest admitted human-readable error message in chars.
pub const MAX_ERROR_MESSAGE_CHARS: usize = 1024;

/// Honest error taxonomy for v1. Timeout/oversized/malformed exist so the
/// commit path can retain the cursor for them; the local-file evaluator
/// only ever constructs the IO/approval/disabled/stale/rate-limited arms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MonitorErrorKind {
    NotFound,
    Forbidden,
    Unauthorized,
    IoError,
    Oversized,
    Malformed,
    Timeout,
    NeedsApproval,
    Disabled,
    StaleVersion,
    RateLimited,
}

impl MonitorErrorKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::Forbidden => "forbidden",
            Self::Unauthorized => "unauthorized",
            Self::IoError => "io_error",
            Self::Oversized => "oversized",
            Self::Malformed => "malformed",
            Self::Timeout => "timeout",
            Self::NeedsApproval => "needs_approval",
            Self::Disabled => "disabled",
            Self::StaleVersion => "stale_version",
            Self::RateLimited => "rate_limited",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MonitorOutcome {
    NoChange {
        cursor: String,
    },
    Changed {
        event_id: String,
        cursor: String,
    },
    Error {
        error_kind: MonitorErrorKind,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorCheckResult {
    pub schema_version: u32,
    pub monitor_id: String,
    pub monitor_version: u64,
    pub outcome: MonitorOutcome,
    pub observed_at_ms: f64,
}

impl MonitorCheckResult {
    pub fn no_change(
        monitor_id: &str,
        monitor_version: u64,
        cursor: String,
        observed_at_ms: f64,
    ) -> Self {
        Self {
            schema_version: RESULT_SCHEMA_VERSION,
            monitor_id: monitor_id.to_string(),
            monitor_version,
            outcome: MonitorOutcome::NoChange { cursor },
            observed_at_ms,
        }
    }

    pub fn changed(
        monitor_id: &str,
        monitor_version: u64,
        event_id: String,
        cursor: String,
        observed_at_ms: f64,
    ) -> Self {
        Self {
            schema_version: RESULT_SCHEMA_VERSION,
            monitor_id: monitor_id.to_string(),
            monitor_version,
            outcome: MonitorOutcome::Changed { event_id, cursor },
            observed_at_ms,
        }
    }

    pub fn error(
        monitor_id: &str,
        monitor_version: u64,
        error_kind: MonitorErrorKind,
        message: impl Into<String>,
        observed_at_ms: f64,
    ) -> Self {
        let message: String = message
            .into()
            .chars()
            .take(MAX_ERROR_MESSAGE_CHARS)
            .collect();
        Self {
            schema_version: RESULT_SCHEMA_VERSION,
            monitor_id: monitor_id.to_string(),
            monitor_version,
            outcome: MonitorOutcome::Error {
                error_kind,
                message,
            },
            observed_at_ms,
        }
    }

    pub fn cursor(&self) -> Option<&str> {
        match &self.outcome {
            MonitorOutcome::NoChange { cursor } | MonitorOutcome::Changed { cursor, .. } => {
                Some(cursor.as_str())
            }
            MonitorOutcome::Error { .. } => None,
        }
    }

    pub fn event_id(&self) -> Option<&str> {
        match &self.outcome {
            MonitorOutcome::Changed { event_id, .. } => Some(event_id.as_str()),
            _ => None,
        }
    }

    pub fn is_error(&self) -> bool {
        matches!(self.outcome, MonitorOutcome::Error { .. })
    }
}

/// Cursor shape: `v1:<64 lowercase hex>`.
pub fn is_valid_cursor(cursor: &str) -> bool {
    let Some(hex) = cursor.strip_prefix("v1:") else {
        return false;
    };
    hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Event-id shape: `mev_<32 lowercase hex>`.
pub fn is_valid_event_id(event_id: &str) -> bool {
    let Some(hex) = event_id.strip_prefix("mev_") else {
        return false;
    };
    hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Validate the result shape before any cursor commit. Callers must refuse
/// to advance on `Err`, retaining the prior cursor.
pub fn validate_result_shape(result: &MonitorCheckResult) -> Result<(), String> {
    if result.schema_version != RESULT_SCHEMA_VERSION {
        return Err(format!(
            "unsupported result schema version {}",
            result.schema_version
        ));
    }
    if result.monitor_id.is_empty() {
        return Err("monitorId must not be empty".to_string());
    }
    if result.monitor_id.len() > 256 {
        return Err("monitorId must be at most 256 bytes".to_string());
    }
    if !result.observed_at_ms.is_finite() || result.observed_at_ms < 0.0 {
        return Err("observedAtMs must be a finite non-negative timestamp".to_string());
    }
    match &result.outcome {
        MonitorOutcome::NoChange { cursor } => {
            if !is_valid_cursor(cursor) {
                return Err("no_change cursor has an invalid shape".to_string());
            }
            Ok(())
        }
        MonitorOutcome::Changed { event_id, cursor } => {
            if !is_valid_event_id(event_id) {
                return Err("changed eventId has an invalid shape".to_string());
            }
            if !is_valid_cursor(cursor) {
                return Err("changed cursor has an invalid shape".to_string());
            }
            Ok(())
        }
        MonitorOutcome::Error { message, .. } => {
            if message.is_empty() {
                return Err("error message must not be empty".to_string());
            }
            if message.chars().count() > MAX_ERROR_MESSAGE_CHARS {
                return Err("error message exceeds the length bound".to_string());
            }
            if message.bytes().any(|b| b == 0) {
                return Err("error message must not contain NUL".to_string());
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_no_change_changed_and_error_shapes() {
        let cursor = format!("v1:{}", "ab".repeat(32));
        let event = format!("mev_{}", "cd".repeat(16));
        assert!(
            validate_result_shape(&MonitorCheckResult::no_change(
                "m-1",
                3,
                cursor.clone(),
                10.0
            ))
            .is_ok()
        );
        assert!(
            validate_result_shape(&MonitorCheckResult::changed("m-1", 3, event, cursor, 10.0))
                .is_ok()
        );
        assert!(
            validate_result_shape(&MonitorCheckResult::error(
                "m-1",
                3,
                MonitorErrorKind::NotFound,
                "missing",
                10.0
            ))
            .is_ok()
        );
        assert_eq!(MonitorErrorKind::NotFound.as_str(), "not_found");
        assert_eq!(MonitorErrorKind::Timeout.as_str(), "timeout");
    }

    #[test]
    fn rejects_malformed_cursors_event_ids_and_versions() {
        assert!(
            validate_result_shape(&MonitorCheckResult::no_change(
                "m-1",
                3,
                "bogus".into(),
                1.0
            ))
            .is_err()
        );
        let cursor = format!("v1:{}", "ab".repeat(32));
        assert!(
            validate_result_shape(&MonitorCheckResult::changed(
                "m-1",
                3,
                "bogus".into(),
                cursor,
                1.0
            ))
            .is_err()
        );
        let mut bad =
            MonitorCheckResult::no_change("m-1", 3, format!("v1:{}", "ab".repeat(32)), 1.0);
        bad.schema_version = 999;
        assert!(validate_result_shape(&bad).is_err());
    }
}
