//! Bot-side responsibility-level dispatch gating, composed **over**
//! `automations::execution`'s pure automation-eligibility decision --
//! never duplicating its host-fence/disabled logic. See
//! `docs/migration/native-bot-state-contract.md`'s "Execution remains
//! explicit": "The Bot service delegates scheduled work through the
//! automation runner. Disabled responsibilities refuse execution. Reactive
//! work cannot run from the manual scheduled-run action... Reactive
//! responsibilities do not acquire an automation merely to share a code
//! path."
//!
//! ## Precedence
//!
//! Checked in this order, first match wins -- mirroring
//! `automations::execution::evaluate_dispatch`'s own documented precedence
//! convention:
//!
//! 1. `Responsibility::enabled == false` refuses regardless of trigger kind
//!    or automation state ("disabled responsibility refuses regardless of
//!    automation state").
//! 2. A `Reactive` trigger refuses unless `reason` is a supplied
//!    `InvocationReason::ReactiveEvent(Some(_))`; `Manual`, `ScheduledDue`,
//!    and `ReactiveEvent(None)` are all refused here, before any automation
//!    is considered (there is none to consider for a reactive trigger).
//! 3. A `Scheduled` trigger requires an automation already proven owned by
//!    this Bot via [`super::storage::require_owned_automation`] --
//!    performed by the storage-composed entry point below, *before*
//!    delegating to [`execution::evaluate_and_attempt_dispatch`]. A missing
//!    or foreign-owned automation refuses here, never reaching automation
//!    evaluation at all.
//!
//! Only once all of the above pass does a `Scheduled` responsibility's
//! outcome depend on `automations::execution`'s own host-fence/disabled/
//! reactive-event decision -- so a responsibility-level refusal
//! ([`ResponsibilityRefusal`]) and an automation-level refusal
//! ([`execution::DispatchRefusal`]) are always distinguishable, never
//! conflated into one flat "refused".

use rusqlite::Connection;

use super::records::{Bot, Responsibility, ResponsibilityTrigger};
use super::storage::{self as bots_storage, StorageError};
use crate::automations::execution::{self, DispatchAttempt, DispatchRefusal, InvocationReason};
use crate::automations::records::Automation;

/// A Bot's stored [`Bot::harness_policy`] resolved into the harness launch
/// overrides a daemon dispatch should run with (issue #188).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BotHarnessOverrides {
    pub harness_id: String,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub permission_mode: Option<String>,
}

/// Pure port of the desktop's `buildBotRunHarness`
/// (`apps/desktop/src/renderer/src/features/bots/bots-page-model.ts`) so a
/// scheduler-fired or run-now responsibility dispatch resolves the same
/// overrides an explicit `bot.run` does. The stored `explicit_model` is
/// the create form's `provider/model` string: split on the first slash;
/// no slash (or an empty side) means a bare model id, which Pi also
/// accepts; null/blank means no model overrides. `permission_mode` is
/// `unattended` for Pi only: a daemon run is headless with no
/// approval-answer affordance (an inherited prompt would stall it at
/// `needs_input` forever), and Pi's flag trusts only the run's project
/// files -- other harnesses keep inherited prompts rather than silently
/// escalating theirs.
pub fn harness_overrides(bot: &Bot) -> BotHarnessOverrides {
    let stored = bot
        .harness_policy
        .explicit_model
        .as_deref()
        .map(str::trim)
        .unwrap_or("");
    let (provider, model) = match stored.find('/') {
        // `slash` is an ASCII byte index, so both slices are char boundaries.
        Some(slash) if slash > 0 && slash < stored.len() - 1 => (
            Some(stored[..slash].to_string()),
            Some(stored[slash + 1..].to_string()),
        ),
        _ => (None, (!stored.is_empty()).then(|| stored.to_string())),
    };
    BotHarnessOverrides {
        harness_id: bot.harness_policy.default_harness.clone(),
        model,
        provider,
        permission_mode: (bot.harness_policy.default_harness == "pi")
            .then(|| "unattended".to_string()),
    }
}

/// Why a *responsibility-level* gate refused, before any automation
/// eligibility was even considered. Distinct from
/// [`execution::DispatchRefusal`]: that enum only ever fires once a
/// scheduled responsibility's owned automation has actually been resolved
/// and evaluated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponsibilityRefusal {
    /// `Responsibility::enabled` is `false` -- refused regardless of
    /// trigger kind or automation state, checked before anything else.
    Disabled,
    /// A reactive responsibility was invoked with a `reason` other than a
    /// supplied `InvocationReason::ReactiveEvent(Some(_))`. Carries the
    /// actual reason it was refused for (covers `Manual`, `ScheduledDue`,
    /// and `ReactiveEvent(None)` alike -- "polling without an event does
    /// not call a model" from the contract applies here exactly as it does
    /// to automation dispatch, just with no automation to delegate the
    /// check to).
    ReactiveRequiresSuppliedEvent(InvocationReason),
    /// A scheduled responsibility's `automation_id` does not name an
    /// automation owned by this Bot (missing entirely, or owned by a
    /// different Bot) -- `bots::storage::require_owned_automation`'s own
    /// check, surfaced here rather than re-implemented.
    UnownedAutomation(String),
}

/// Outcome of the reactive job-dispatch gate for a responsibility that
/// passed every check (enabled, and invoked with a real supplied event).
/// The gate is wired: the caller that carries event context — the
/// delegation drain (`bots::delegation`), which resolves the workspace
/// and the template-built prompt from the claimed outbox event —
/// proceeds to the existing runner seam. A caller with no event context
/// (notably `bot.run`'s responsibility turn, which arrives with a bare
/// reason and no workspace/prompt source) still refuses downstream as
/// `RunUnsupported::ReactiveDispatchParamsNotWired` rather than
/// fabricating either — see `automations::runner::prepare_run_plan_in_tx`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponsibilityJobOutcome {
    /// Delegated to `automations::execution::spawn_v1_session` for a
    /// scheduled responsibility's owned automation.
    Automation(execution::JobOutcome),
    /// A reactive responsibility passed every gate. Event-context
    /// dispatch (workspace + prompt) is the delegation drain's job.
    ReactiveReady,
}

/// The composed outcome: refused at the responsibility gate, refused by
/// the underlying automation's own eligibility evaluation, or dispatched.
/// Never both, never neither, and never collapses a responsibility refusal
/// and an automation refusal into a single case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResponsibilityDispatchAttempt {
    RefusedByResponsibility(ResponsibilityRefusal),
    RefusedByAutomation(DispatchRefusal),
    Dispatched(ResponsibilityJobOutcome),
}

/// Error re-deriving a responsibility gating decision from a durable row:
/// distinguishes a genuinely absent Bot/responsibility from one that
/// exists but could not be read back, never collapsing the two into a
/// single "not found" -- mirroring
/// `automations::execution::DispatchLookupError`.
#[derive(Debug)]
pub enum ResponsibilityLookupError {
    /// No Bot with this id exists in this `(host_id, folder)` scope.
    BotNotFound,
    /// The Bot exists but has no responsibility with this id.
    ResponsibilityNotFound,
    /// A storage failure other than an expected ownership refusal (e.g. a
    /// malformed/stale JSON payload, or any other storage error).
    Storage(StorageError),
}

impl std::fmt::Display for ResponsibilityLookupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BotNotFound => write!(f, "bot not found"),
            Self::ResponsibilityNotFound => write!(f, "responsibility not found on this bot"),
            Self::Storage(e) => write!(f, "stored bot/automation row unreadable: {e}"),
        }
    }
}

impl std::error::Error for ResponsibilityLookupError {}

/// Pure: given a responsibility and (only meaningful for a `Scheduled`
/// trigger) the automation already confirmed to be owned by this Bot,
/// decide the composed outcome. No I/O, no clock, no hidden state -- the
/// caller is responsible for resolving `owned_automation` via
/// [`super::storage::require_owned_automation`] beforehand; this function
/// never performs that ownership resolution itself, only consumes its
/// result.
///
/// `owned_automation` is ignored for a `Reactive` trigger (reactive
/// responsibilities never acquire an automation -- see the module doc) and
/// required (as `Some`) for a `Scheduled` trigger to reach automation
/// evaluation at all; `None` for a `Scheduled` trigger is treated as
/// "ownership did not resolve" and refused as
/// [`ResponsibilityRefusal::UnownedAutomation`].
pub fn evaluate_and_attempt_responsibility_dispatch(
    responsibility: &Responsibility,
    owned_automation: Option<&Automation>,
    current_host_id: &str,
    reason: &InvocationReason,
) -> ResponsibilityDispatchAttempt {
    if !responsibility.enabled {
        return ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::Disabled,
        );
    }
    match &responsibility.trigger {
        ResponsibilityTrigger::Reactive { .. } => {
            match reason {
                InvocationReason::ReactiveEvent(Some(_)) => {}
                InvocationReason::Manual
                | InvocationReason::ScheduledDue
                | InvocationReason::ReactiveEvent(None) => {
                    return ResponsibilityDispatchAttempt::RefusedByResponsibility(
                        ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(reason.clone()),
                    );
                }
            }
            ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::ReactiveReady)
        }
        ResponsibilityTrigger::Scheduled { automation_id } => {
            let Some(automation) = owned_automation else {
                return ResponsibilityDispatchAttempt::RefusedByResponsibility(
                    ResponsibilityRefusal::UnownedAutomation(automation_id.clone()),
                );
            };
            match execution::evaluate_and_attempt_dispatch(automation, current_host_id, reason) {
                DispatchAttempt::Refused(refusal) => {
                    ResponsibilityDispatchAttempt::RefusedByAutomation(refusal)
                }
                DispatchAttempt::Dispatched(job) => ResponsibilityDispatchAttempt::Dispatched(
                    ResponsibilityJobOutcome::Automation(job),
                ),
            }
        }
    }
}

/// Re-derives a responsibility dispatch attempt straight from the durable
/// store: always issues fresh reads (`bots::storage::get_bot`, and for a
/// `Scheduled` trigger `bots::storage::require_owned_automation`), never
/// trusts an in-memory snapshot the caller might be holding. Calling this
/// again after the underlying connection is closed and reopened against
/// the same database file, or after a concurrent writer changed a row,
/// reflects that current state.
///
/// Enforces requirement (1) directly: a scheduled responsibility's
/// ownership is checked via `require_owned_automation` *before* any
/// automation evaluation is attempted, reusing that function rather than
/// re-implementing the ownership rule here.
pub fn evaluate_and_attempt_responsibility_dispatch_from_storage(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    bot_id: &str,
    responsibility_id: &str,
    current_host_id: &str,
    reason: &InvocationReason,
) -> Result<ResponsibilityDispatchAttempt, ResponsibilityLookupError> {
    let bot = bots_storage::get_bot(conn, host_id, folder, bot_id)
        .map_err(ResponsibilityLookupError::Storage)?
        .ok_or(ResponsibilityLookupError::BotNotFound)?;
    let responsibility = bot
        .responsibilities
        .iter()
        .find(|r| r.id == responsibility_id)
        .ok_or(ResponsibilityLookupError::ResponsibilityNotFound)?;

    let owned_automation = match &responsibility.trigger {
        ResponsibilityTrigger::Scheduled { automation_id } => {
            match bots_storage::require_owned_automation(conn, bot_id, automation_id) {
                Ok(automation) => Some(automation),
                Err(StorageError::OwnershipViolation(_)) => None,
                Err(e) => return Err(ResponsibilityLookupError::Storage(e)),
            }
        }
        ResponsibilityTrigger::Reactive { .. } => None,
    };

    Ok(evaluate_and_attempt_responsibility_dispatch(
        responsibility,
        owned_automation.as_ref(),
        current_host_id,
        reason,
    ))
}
