//! Pure domain-logic dispatch evaluation for stored `Automation`s: given a
//! stored automation, the current host id, and why dispatch is being
//! considered right now, decide whether the automation is eligible to run
//! -- never as a side effect of reading/writing rows, and never by
//! inferring "yes" from silence. See
//! `docs/migration/native-bot-state-contract.md`'s "Execution remains
//! explicit" and `docs/migration/native-session-authority-contract.md` for
//! the surrounding contract this module sits inside.
//!
//! ## Scope
//!
//! This module does not spawn a harness session, run a scheduler loop, or
//! open a second database/connection. It is the decision a future
//! automation runner calls before it does any of that. [`spawn_v1_session`]
//! is a deliberate stub: V1 session spawn is not wired into this crate yet
//! (see the session-authority contract's "Runtime integration" ordering
//! slice), so it always returns [`JobOutcome::UnsupportedSessionSpawn`],
//! never a fabricated success.
//!
//! ## Host fencing (conservative, not the full source SSH-authority fence)
//!
//! `docs/migration/native-bot-state-contract.md` ("Host authority is not
//! Bot ownership") and `automations::storage`'s module doc both record that
//! the source's real `assertAutomationOwnerFence` -- resolving a live SSH
//! target registry, workspace-host table and registration generation -- is
//! **not implemented anywhere in this crate** and remains fully open. This
//! module does not fabricate that registry. Its host fence is the
//! conservative subset that is safe to decide with zero SSH/registry
//! dependencies: an `Ssh`-targeted automation is always foreign here (this
//! crate has no SSH execution capability at all), and a `Local`-targeted
//! automation is foreign unless its `execution_target_id` equals the
//! caller-supplied current host id. This never *widens* what the real
//! fence would eventually refuse; it just cannot yet grant the subset of
//! `Ssh` cases the real fence would allow once implemented.

use super::records::{Automation, ExecutionTargetType};
use super::storage::{self, StorageError};
use rusqlite::Connection;

/// Why dispatch is being considered right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvocationReason {
    /// A scheduler determined this automation's `next_run_at` is due.
    ScheduledDue,
    /// An operator explicitly asked to run this automation now.
    Manual,
    /// A reactive responsibility's deterministic adapter observed an
    /// event. `None` means no event was supplied (e.g. polling with
    /// nothing to report) -- see
    /// [`DispatchRefusal::MissingReactiveEvent`].
    ReactiveEvent(Option<String>),
}

/// Why an automation was refused dispatch. Distinct from [`JobOutcome`]:
/// a refusal means dispatch never happened at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchRefusal {
    /// `execution_target_type`/`execution_target_id` do not resolve to the
    /// caller-supplied current host -- see the module doc's "Host
    /// fencing".
    ForeignHost {
        execution_target_type: ExecutionTargetType,
        execution_target_id: String,
        current_host_id: String,
    },
    /// `Automation::enabled` is `false`.
    Disabled,
    /// `InvocationReason::ReactiveEvent(None)`: reactive dispatch requires
    /// a supplied event; polling without one must never call a model.
    MissingReactiveEvent,
}

/// The dispatch-eligibility decision itself -- separate from whether a
/// subsequently-dispatched job actually succeeds (see [`JobOutcome`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchDecision {
    Eligible,
    Refused(DispatchRefusal),
}

/// Outcome of the (not-yet-wired) job execution step for an automation
/// that was found [`DispatchDecision::Eligible`]. Kept as its own enum,
/// separate from [`DispatchDecision`], so "was this allowed to run" and
/// "did the run succeed" can never be conflated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobOutcome {
    /// V1 session spawn is not wired into this crate's execution layer
    /// yet. Always returned by [`spawn_v1_session`]; never a fabricated
    /// success.
    UnsupportedSessionSpawn,
}

/// The result of a full dispatch attempt: either refused before any job
/// ran, or dispatched with some [`JobOutcome`]. Never both, never neither.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchAttempt {
    Refused(DispatchRefusal),
    Dispatched(JobOutcome),
}

/// Pure decision: no I/O, no clock, no hidden state. Given the automation
/// exactly as currently stored, decide eligibility. Precedence (checked in
/// this order, first match wins): host fence, then disabled, then the
/// reactive-event requirement. A foreign-host or disabled automation is
/// refused regardless of invocation reason -- neither ever "wins" over the
/// other by argument order, host fencing is checked first because it is
/// the authority question, not a business-state one.
pub fn evaluate_dispatch(
    automation: &Automation,
    current_host_id: &str,
    reason: &InvocationReason,
) -> DispatchDecision {
    if !automation_is_local_to(automation, current_host_id) {
        return DispatchDecision::Refused(DispatchRefusal::ForeignHost {
            execution_target_type: automation.execution_target_type,
            execution_target_id: automation.execution_target_id.clone(),
            current_host_id: current_host_id.to_string(),
        });
    }
    if !automation.enabled {
        return DispatchDecision::Refused(DispatchRefusal::Disabled);
    }
    if let InvocationReason::ReactiveEvent(None) = reason {
        return DispatchDecision::Refused(DispatchRefusal::MissingReactiveEvent);
    }
    DispatchDecision::Eligible
}

/// See the module doc's "Host fencing": conservative subset of the real
/// (unimplemented) SSH-authority fence. `Ssh` is always foreign; `Local`
/// is foreign unless its `execution_target_id` equals the current host.
fn automation_is_local_to(automation: &Automation, current_host_id: &str) -> bool {
    match automation.execution_target_type {
        ExecutionTargetType::Local => automation.execution_target_id == current_host_id,
        ExecutionTargetType::Ssh => false,
    }
}

/// V1 session spawn is not wired into this crate yet -- see the module
/// doc. Always [`JobOutcome::UnsupportedSessionSpawn`]; takes `&Automation`
/// only so its signature already matches what a real spawn will need.
pub fn spawn_v1_session(_automation: &Automation) -> JobOutcome {
    JobOutcome::UnsupportedSessionSpawn
}

/// Composes [`evaluate_dispatch`] and [`spawn_v1_session`] into one
/// attempt outcome.
pub fn evaluate_and_attempt_dispatch(
    automation: &Automation,
    current_host_id: &str,
    reason: &InvocationReason,
) -> DispatchAttempt {
    match evaluate_dispatch(automation, current_host_id, reason) {
        DispatchDecision::Refused(refusal) => DispatchAttempt::Refused(refusal),
        DispatchDecision::Eligible => DispatchAttempt::Dispatched(spawn_v1_session(automation)),
    }
}

/// Error re-deriving a dispatch decision from a durable row: distinguishes
/// a genuinely absent row from one that exists but could not be read back
/// (a malformed/stale JSON payload, or any other storage failure) -- never
/// collapses the two into a single "not found".
#[derive(Debug)]
pub enum DispatchLookupError {
    /// No automation with this id exists in the store.
    Missing,
    /// The row exists but could not be read back as a valid `Automation`
    /// (e.g. a payload written by a version this build no longer parses).
    Unreadable(StorageError),
}

impl std::fmt::Display for DispatchLookupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => write!(f, "automation not found"),
            Self::Unreadable(e) => write!(f, "stored automation row unreadable: {e}"),
        }
    }
}

impl std::error::Error for DispatchLookupError {}

/// Re-derives a dispatch attempt straight from the durable store: always
/// issues a fresh read (`storage::get_automation`), never trusts an
/// in-memory snapshot the caller might be holding. Calling this again
/// after the underlying connection is closed and reopened against the
/// same database file, or after a concurrent writer changed the row,
/// reflects that current row -- there is no cached/in-memory decision
/// anywhere in this module for it to go stale against.
pub fn evaluate_and_attempt_dispatch_from_storage(
    conn: &Connection,
    automation_id: &str,
    current_host_id: &str,
    reason: &InvocationReason,
) -> Result<DispatchAttempt, DispatchLookupError> {
    let automation = match storage::get_automation(conn, automation_id) {
        Ok(Some(a)) => a,
        Ok(None) => return Err(DispatchLookupError::Missing),
        Err(e) => return Err(DispatchLookupError::Unreadable(e)),
    };
    Ok(evaluate_and_attempt_dispatch(
        &automation,
        current_host_id,
        reason,
    ))
}
