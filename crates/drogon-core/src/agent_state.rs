//! Pure agent-state derivation for a Session's PTY activity plus the Claude
//! Code hook signal. `docs/migration/rewrite-mvp-plan.md` J1: "estado del
//! agente (trabajando, inactivo, esperando)". `session.rs` owns observing
//! the actual facts (PTY output timing, exit, hook events); this module only
//! classifies them, so the 3s window and the exited/needs-input precedence
//! are unit-testable without a real PTY or clock.
//!
//! `NeedsInput` is produced by `session.hook_event` (the `Notification` and
//! `Stop` hooks in the per-session settings file `hooks.rs` writes for
//! `harness.start` with the claude harness). Any later PTY output clears it
//! back to activity-based derivation; exit takes precedence over it.

use std::time::Duration;

/// Silence-after-activity threshold: sustained output within this window is
/// `Working`; past it, `Idle`. Chosen by the task's own spec ("idle after 3s
/// of silence"), not derived from any measurement.
pub(crate) const ACTIVITY_WINDOW: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentState {
    Working,
    Idle,
    NeedsInput,
    Exited,
    Unknown,
}

impl AgentState {
    pub(crate) fn as_wire(self) -> &'static str {
        match self {
            AgentState::Working => "working",
            AgentState::Idle => "idle",
            AgentState::NeedsInput => "needs_input",
            AgentState::Exited => "exited",
            AgentState::Unknown => "unknown",
        }
    }
}

/// What this module knows about a session's PTY output history, independent
/// of wall-clock/`Instant` specifics so [`derive`] stays a pure function.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Activity {
    /// No PTY output has ever been observed for this session yet.
    NeverObserved,
    /// The most recent PTY output was observed this long ago.
    LastActiveAgo(Duration),
}

/// Exit takes precedence over everything (a session can exit mid-burst of
/// buffered output, including while waiting for input); a live session with
/// an uncleared hook signal is `NeedsInput` regardless of the activity
/// clock; a never-observed session without a signal is `Unknown` rather
/// than guessed as idle, since idle implies activity once happened.
pub(crate) fn derive(exited: bool, activity: Activity, needs_input: bool) -> AgentState {
    if exited {
        return AgentState::Exited;
    }
    if needs_input {
        return AgentState::NeedsInput;
    }
    match activity {
        Activity::NeverObserved => AgentState::Unknown,
        Activity::LastActiveAgo(elapsed) if elapsed < ACTIVITY_WINDOW => AgentState::Working,
        Activity::LastActiveAgo(_) => AgentState::Idle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exited_wins_over_any_activity_fact() {
        assert_eq!(
            derive(true, Activity::NeverObserved, false),
            AgentState::Exited
        );
        assert_eq!(
            derive(
                true,
                Activity::LastActiveAgo(Duration::from_millis(1)),
                false
            ),
            AgentState::Exited
        );
    }

    #[test]
    fn exited_wins_over_an_uncleared_hook_signal() {
        assert_eq!(
            derive(true, Activity::NeverObserved, true),
            AgentState::Exited
        );
    }

    #[test]
    fn hook_signal_wins_over_any_activity_fact() {
        assert_eq!(
            derive(false, Activity::NeverObserved, true),
            AgentState::NeedsInput
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(Duration::from_millis(0)),
                true
            ),
            AgentState::NeedsInput
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW + Duration::from_secs(60)),
                true
            ),
            AgentState::NeedsInput
        );
    }

    #[test]
    fn never_observed_is_unknown_not_idle() {
        assert_eq!(
            derive(false, Activity::NeverObserved, false),
            AgentState::Unknown
        );
    }

    #[test]
    fn within_window_is_working_at_and_past_boundary_is_idle() {
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(Duration::from_millis(0)),
                false
            ),
            AgentState::Working
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW - Duration::from_millis(1)),
                false
            ),
            AgentState::Working
        );
        assert_eq!(
            derive(false, Activity::LastActiveAgo(ACTIVITY_WINDOW), false),
            AgentState::Idle
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW + Duration::from_secs(60)),
                false
            ),
            AgentState::Idle
        );
    }

    #[test]
    fn wire_strings_match_the_frozen_contract_vocabulary() {
        assert_eq!(AgentState::Working.as_wire(), "working");
        assert_eq!(AgentState::Idle.as_wire(), "idle");
        assert_eq!(AgentState::NeedsInput.as_wire(), "needs_input");
        assert_eq!(AgentState::Exited.as_wire(), "exited");
        assert_eq!(AgentState::Unknown.as_wire(), "unknown");
    }
}
