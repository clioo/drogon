//! C10 bots monitors: bounded deterministic checks with durable change events.
//!
//! ## Frozen rule set (checkpoint 1)
//!
//! Exactly one rule type exists: [`rule::RULE_KIND_LOCAL_FILE_DIGEST`] — an
//! approved scoped local-file content digest with bounded bytes and an
//! explicit `(host_id, project_id, resource)` scope. No shell, no
//! interpreter, no network, no generic plugin or supervisor. New rule
//! types require a new checkpoint and a schema version bump.
//!
//! ## Versioned result semantics
//!
//! Every check yields [`result::MonitorCheckResult`] at schema version
//! [`result::RESULT_SCHEMA_VERSION`]:
//! - `no_change { cursor }`: bytes digest to the stored cursor. Zero model
//!   calls, zero conversations, zero events.
//! - `changed { event_id, cursor }`: new bytes observed. `event_id` and
//!   `cursor` are stable functions of `(monitor_id, approved_rule_hash,
//!   content_digest)`, so repeats and restarts collapse onto one event.
//! - `error { error_kind, message }`: absence, 401/403/500-shaped
//!   failures, oversized/malformed output, timeout, or a refusal
//!   (needs-approval, disabled, stale, rate-limited). Errors retain the
//!   prior cursor and emit nothing — never a silent no-change, never a
//!   deletion.
//!
//! Results are shape-validated ([`result::validate_result_shape`]) before
//! any cursor commit.
//!
//! ## Expected-version cursor + outbox transaction
//!
//! The pure decision is [`commit::decide_commit`]. The durable write
//! belongs to the caller and must, in one transaction:
//! 1. Do no network work inside the transaction.
//! 2. CAS the monitor row on `(id, version, rev)` with the tick's
//!    `expected_version`; stale versions or expectations refuse, so
//!    replays and out-of-order evaluations neither duplicate a local
//!    event nor roll the cursor backward.
//! 3. Persist the [`commit::MonitorEventIntent`] through the canonical C05
//!    transactional local-delivery API in the same transaction as the
//!    cursor write; on any failure persist neither.
//!
//! Scheduling/firing reuses the existing automation scheduler and runner
//! (C08 owns admission and renewal); the durable driver is [`tick`], and
//! committed change events land in the delegation outbox
//! (`bots::delegation`) in the same transaction as the cursor write.
//! This module defines no timer, launcher, or model caller. The
//! same-transaction cursor-CAS + outbox-enqueue shape is
//! [`storage::commit_advance_in_tx`], whose caller-supplied `enqueue`
//! closure is the delegation outbox write.
//!
//! ## Approval, secrets, and policy
//!
//! Rule edits invalidate approval ([`record::staged_rule_edit`]); only an
//! explicit [`record::approve_rule`] re-arms the monitor. Records carry
//! secret **references** only, never values (v1 carries none at all).
//! Changes default to a local notification/event ([`policy`]); inference
//! runs only through an explicitly enabled responsibility policy, and
//! unchanged polls always produce zero model requests.
//!
//! ## Honesty notes
//!
//! - Byte limits are cooperative: they bound how much the caller reads,
//!   they do not prove cancellable I/O. Timeouts/cancellation live with
//!   the scheduler/runner owner (C08), not in this pure module.
//! - v1 performs no process, HTTP, or model work; `Timeout` and
//!   network-shaped errors exist in the taxonomy so future rules and the
//!   commit path treat them as errors, not as change/no-change.
//! - Disable/delete stop new admissions; active turns elsewhere are
//!   untouched. History, last success/error, backoff/rate-limit state, and
//!   delivery uncertainty are retained.

pub mod commit;
pub mod eval;
pub mod policy;
pub mod record;
pub mod result;
pub mod rule;
pub mod storage;
pub mod tick;

pub use commit::{
    BASE_BACKOFF_MS, CommitDecision, CommitInput, MAX_BACKOFF_MS, MonitorEventIntent, RetainReason,
    StoredMonitorState, backoff_ms, decide_commit, should_admit,
};
pub use eval::{cursor_for_digest, digest_bytes, evaluate_bytes, event_id_for, read_failure};
pub use policy::MonitorInferencePolicy;
pub use record::{MonitorRecord, MonitorTrigger, approve_rule, new_monitor, staged_rule_edit};
pub use result::{MonitorCheckResult, MonitorErrorKind, MonitorOutcome, RESULT_SCHEMA_VERSION};
pub use rule::{MAX_FILE_BYTES, MonitorRule, RULE_KIND_LOCAL_FILE_DIGEST, RULE_SCHEMA_VERSION};
pub use storage::{CommitTxError, commit_advance_in_tx};
pub use storage::{DeliveryState, StoredCheck};
