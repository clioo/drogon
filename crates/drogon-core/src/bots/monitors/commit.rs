//! Atomic commit decision: cursor advancement plus outbox intent.
//!
//! Pure decision logic — no storage, no network, no locks. The durable
//! write itself belongs to the caller, which must:
//!
//! 1. Hold no network work inside the DB transaction.
//! 2. Compare-and-swap the monitor row on `(id, version, rev)` with
//!    `expected_version` (see [`CommitInput::expected_version`]): a stale
//!    version or a stale expectation refuses the commit, so replays and
//!    out-of-order evaluations can neither duplicate a local event nor
//!    roll the cursor backward.
//! 3. Persist the returned [`MonitorEventIntent`] through the canonical
//!    C05 transactional local-delivery API in the **same** transaction as
//!    the cursor write; on any failure persist neither (no lost
//!    notification, no falsely advanced cursor).
//!
//! Delivery itself stays outside the transaction, and inference never
//! happens here (see `super::policy`).

use super::result::{MonitorCheckResult, MonitorOutcome, validate_result_shape};

/// First backoff step after one error (5 s), doubling per consecutive
/// error up to [`MAX_BACKOFF_MS`] (5 min).
pub const BASE_BACKOFF_MS: f64 = 5_000.0;
pub const MAX_BACKOFF_MS: f64 = 300_000.0;

/// Minimal stored projection the decision needs. The durable row carries
/// more (see `super::record`/`super::storage`); this keeps the pure
/// decision testable without a database.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredMonitorState {
    pub monitor_id: String,
    pub version: u64,
    pub cursor: Option<String>,
    pub last_event_id: Option<String>,
    pub enabled: bool,
}

/// Caller-supplied claim about which version it evaluated against. A tick
/// that read version N but finds the row at version M (> N) is stale.
#[derive(Debug, Clone, PartialEq)]
pub struct CommitInput {
    pub expected_version: u64,
}

/// One outgoing local notification/event. The caller persists this value
/// via C05 and delivers it (notification surface) outside the DB
/// transaction. Never a model request.
///
/// Reconciliation with the C05 corrected API (`bots::delivery` at
/// 37ca140, read-only): the caller maps this intent onto an
/// `EnqueueResultRequest` field-for-field — `delivery_id` =
/// [`MonitorEventIntent::delivery_id`], `bot_id`/`project_id`/`host_id`
/// from this intent (`bot_id` is `None` for project-level monitors; the
/// caller resolves the destination bot, this layer never invents one),
/// `run_id` = the originating check id (or [`MonitorEventIntent::delivery_id`]
/// when the caller folds check and event into one row), `payload_hash` =
/// `payload_hash_for` over the exact rendered notification bytes (the
/// renderer owns that copy; [`MonitorEventIntent::content_digest`] is the
/// hash basis) — EXCEPT `conversation_id`, which this layer never mints:
/// C05 conversation ids are versioned triples the native side owns
/// (renderer parses native-minted ids only), so which conversation
/// receives monitor events is a C05/C08/root routing decision and the
/// precise small missing seam alongside the notification copy and the
/// Engine/migration/scheduler hookup.
#[derive(Debug, Clone, PartialEq)]
pub struct MonitorEventIntent {
    pub event_id: String,
    pub monitor_id: String,
    pub monitor_version: u64,
    pub cursor: String,
    pub host_id: String,
    pub project_id: String,
    pub resource: String,
    /// Owning bot when the monitor was created from the Bot surface;
    /// `None` for project-level monitors.
    pub bot_id: Option<String>,
    pub observed_at_ms: f64,
}

impl MonitorEventIntent {
    /// Stable C05 delivery id for this event: the content-bound event id.
    /// Same event ⇒ same id, so C05's same-id + same-hash enqueue returns
    /// the stored row instead of duplicating; different content mints a
    /// different id by construction, so same-id + different-hash
    /// `PayloadConflict` cannot arise from this layer.
    pub fn delivery_id(&self) -> &str {
        &self.event_id
    }

    /// The content digest behind this event (the cursor minus its `v1:`
    /// prefix) — the hash basis the caller uses when it renders the exact
    /// notification bytes for C05 `payload_hash_for`.
    pub fn content_digest(&self) -> &str {
        self.cursor.strip_prefix("v1:").unwrap_or(&self.cursor)
    }
}

/// Why a commit retained the cursor without emitting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetainReason {
    NoChange,
    ErrorRetained,
    DuplicateTick,
    Disabled,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CommitDecision {
    /// Advance the cursor and persist `intent` atomically (same
    /// transaction, expected-version CAS, via the canonical delivery API).
    Advance {
        new_cursor: String,
        intent: MonitorEventIntent,
    },
    /// Keep the prior cursor; emit nothing.
    Retain { reason: RetainReason },
    /// The evaluation is stale or malformed: keep the cursor, emit
    /// nothing, and (for stale versions) never retry this payload.
    RefuseStale { reason: String },
}

/// Pure backoff: `consecutive_errors = 0` means eligible immediately.
pub fn backoff_ms(consecutive_errors: u32) -> f64 {
    if consecutive_errors == 0 {
        return 0.0;
    }
    let shift = consecutive_errors.saturating_sub(1).min(6);
    (BASE_BACKOFF_MS * (1u64 << shift) as f64).min(MAX_BACKOFF_MS)
}

/// Whether a tick at `now_ms` is admitted given the stored eligibility
/// watermark. Disabled monitors never admit; otherwise `now_ms` must have
/// reached `next_eligible_at_ms` when present.
pub fn should_admit(now_ms: f64, next_eligible_at_ms: Option<f64>, enabled: bool) -> bool {
    if !enabled {
        return false;
    }
    match next_eligible_at_ms {
        None => true,
        Some(not_before) => now_ms >= not_before,
    }
}

/// Decide the commit for one evaluated result. Never touches storage.
pub fn decide_commit(
    stored: &StoredMonitorState,
    host_id: &str,
    project_id: &str,
    resource: &str,
    bot_id: Option<&str>,
    result: &MonitorCheckResult,
    input: &CommitInput,
) -> CommitDecision {
    if !stored.enabled {
        return CommitDecision::Retain {
            reason: RetainReason::Disabled,
        };
    }
    if let Err(reason) = validate_result_shape(result) {
        return CommitDecision::RefuseStale {
            reason: format!("malformed result: {reason}"),
        };
    }
    if result.monitor_id != stored.monitor_id {
        return CommitDecision::RefuseStale {
            reason: "result names a different monitor".to_string(),
        };
    }
    // Script-version edit and out-of-order replay both refuse: the payload
    // was evaluated against a version that is no longer current, or the
    // caller raced a newer write.
    if result.monitor_version != stored.version || input.expected_version != stored.version {
        return CommitDecision::RefuseStale {
            reason: format!(
                "stale evaluation: result v{} expected v{} stored v{}",
                result.monitor_version, input.expected_version, stored.version
            ),
        };
    }
    match &result.outcome {
        MonitorOutcome::Error { .. } => CommitDecision::Retain {
            reason: RetainReason::ErrorRetained,
        },
        MonitorOutcome::NoChange { .. } => CommitDecision::Retain {
            reason: RetainReason::NoChange,
        },
        MonitorOutcome::Changed { event_id, cursor } => {
            // Duplicate first: the same event id implies the same digest
            // (and therefore the same cursor), so an already-emitted
            // event is a duplicate tick even though the cursor also
            // matches. Cursor equality alone (no recorded event) is a
            // same-bytes race that settled as no-change.
            if stored.last_event_id.as_deref() == Some(event_id.as_str()) {
                return CommitDecision::Retain {
                    reason: RetainReason::DuplicateTick,
                };
            }
            if stored.cursor.as_deref() == Some(cursor.as_str()) {
                return CommitDecision::Retain {
                    reason: RetainReason::NoChange,
                };
            }
            CommitDecision::Advance {
                new_cursor: cursor.clone(),
                intent: MonitorEventIntent {
                    event_id: event_id.clone(),
                    monitor_id: stored.monitor_id.clone(),
                    monitor_version: stored.version,
                    cursor: cursor.clone(),
                    host_id: host_id.to_string(),
                    project_id: project_id.to_string(),
                    resource: resource.to_string(),
                    bot_id: bot_id.map(str::to_string),
                    observed_at_ms: result.observed_at_ms,
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::result::MonitorCheckResult;
    use super::*;

    fn stored() -> StoredMonitorState {
        StoredMonitorState {
            monitor_id: "mon-1".to_string(),
            version: 2,
            cursor: Some(format!("v1:{}", "aa".repeat(32))),
            last_event_id: None,
            enabled: true,
        }
    }

    fn changed(cursor_hex: &str, event_hex: &str) -> MonitorCheckResult {
        MonitorCheckResult::changed(
            "mon-1",
            2,
            format!("mev_{event_hex}"),
            format!("v1:{cursor_hex}"),
            100.0,
        )
    }

    #[test]
    fn changed_advances_once_then_duplicates_retain() {
        let result = changed(&"bb".repeat(32), &"cc".repeat(16));
        let decision = decide_commit(
            &stored(),
            "h",
            "p",
            "notes/a.md",
            Some("bot-1"),
            &result,
            &CommitInput {
                expected_version: 2,
            },
        );
        let (cursor, intent) = match decision {
            CommitDecision::Advance { new_cursor, intent } => (new_cursor, intent),
            other => panic!("expected advance, got {other:?}"),
        };
        assert_eq!(cursor, format!("v1:{}", "bb".repeat(32)));
        assert_eq!(intent.event_id, format!("mev_{}", "cc".repeat(16)));
        // C05 enqueue mapping surface: stable delivery id, hash basis for
        // the payload hash, and the owning bot carried for routing.
        assert_eq!(intent.delivery_id(), intent.event_id.as_str());
        assert_eq!(intent.content_digest(), "bb".repeat(32).as_str());
        assert_eq!(intent.bot_id.as_deref(), Some("bot-1"));
        // Replaying the same event after it committed cannot re-emit.
        let committed = StoredMonitorState {
            cursor: Some(cursor),
            last_event_id: Some(intent.event_id.clone()),
            ..stored()
        };
        assert_eq!(
            decide_commit(
                &committed,
                "h",
                "p",
                "notes/a.md",
                Some("bot-1"),
                &result,
                &CommitInput {
                    expected_version: 2
                }
            ),
            CommitDecision::Retain {
                reason: RetainReason::DuplicateTick
            }
        );
    }

    #[test]
    fn stale_versions_and_out_of_order_expectations_refuse() {
        let result = changed(&"bb".repeat(32), &"cc".repeat(16));
        // Result evaluated at v1 against a v2 row.
        let mut old = result.clone();
        old.monitor_version = 1;
        assert!(matches!(
            decide_commit(
                &stored(),
                "h",
                "p",
                "r",
                None,
                &old,
                &CommitInput {
                    expected_version: 1
                }
            ),
            CommitDecision::RefuseStale { .. }
        ));
        // Fresh result but a stale expectation (caller raced a newer write).
        assert!(matches!(
            decide_commit(
                &stored(),
                "h",
                "p",
                "r",
                None,
                &result,
                &CommitInput {
                    expected_version: 1
                }
            ),
            CommitDecision::RefuseStale { .. }
        ));
    }

    #[test]
    fn errors_and_no_change_retain_without_emit() {
        let cursor = format!("v1:{}", "aa".repeat(32));
        let no_change = MonitorCheckResult::no_change("mon-1", 2, cursor, 5.0);
        assert_eq!(
            decide_commit(
                &stored(),
                "h",
                "p",
                "r",
                None,
                &no_change,
                &CommitInput {
                    expected_version: 2
                }
            ),
            CommitDecision::Retain {
                reason: RetainReason::NoChange
            }
        );
        let error = MonitorCheckResult::error(
            "mon-1",
            2,
            super::super::result::MonitorErrorKind::NotFound,
            "gone",
            5.0,
        );
        assert_eq!(
            decide_commit(
                &stored(),
                "h",
                "p",
                "r",
                None,
                &error,
                &CommitInput {
                    expected_version: 2
                }
            ),
            CommitDecision::Retain {
                reason: RetainReason::ErrorRetained
            }
        );
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_ms(0), 0.0);
        assert_eq!(backoff_ms(1), 5_000.0);
        assert_eq!(backoff_ms(7), MAX_BACKOFF_MS);
        assert!(!should_admit(0.0, Some(100.0), true));
        assert!(should_admit(100.0, Some(100.0), true));
        assert!(!should_admit(1_000.0, None, false));
    }
}
