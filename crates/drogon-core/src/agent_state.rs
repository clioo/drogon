//! Pure agent-state derivation for a Session's PTY activity plus the harness
//! hook signal. `docs/migration/rewrite-mvp-plan.md` J1: "estado del agente
//! (trabajando, inactivo, esperando)". `session.rs` owns observing the
//! actual facts (PTY output timing, exit, hook events); this module only
//! classifies them, so the 3s window and the exited/needs-input precedence
//! are unit-testable without a real PTY or clock.
//!
//! `NeedsInput` is produced by `session.hook_event`, fed by four
//! mechanisms, one per hook-reporting harness (installed by
//! `hooks.rs`/`harness_hooks/**` for `harness.start`):
//! - claude: the `Notification`/`Stop` hooks in a per-session `--settings`
//!   file.
//! - opencode: a status plugin installed into an `OPENCODE_CONFIG_DIR`
//!   overlay, reporting `session.idle`/`permission.asked`/`question.asked`
//!   as [`opencode_events::SESSION_IDLE`]/[`opencode_events::PERMISSION_REQUEST`]/
//!   [`opencode_events::ASK_USER_QUESTION`].
//! - pi: an agent-status extension loaded with `--extension`, reporting
//!   `agent_end`/`agent_settled`/`tool_approval_requested` as
//!   [`pi_events::AGENT_END`]/[`pi_events::TOOL_APPROVAL_REQUESTED`].
//! - codex: a private `CODEX_HOME/hooks.json` command hook, reporting
//!   [`codex_events::PERMISSION_REQUEST`] and [`codex_events::STOP`].
//!
//! The fork's exact wait/clear split (issue #360, 100% parity with the
//! reference's agent-hook listeners): a session is `needs_input` only
//! while the harness is genuinely waiting on the user — claude
//! `Notification` (this repo's install surface for the fork's
//! `PermissionRequest`), opencode `permission.asked`/`question.asked`, pi
//! `tool_approval_requested`, codex `PermissionRequest`. Turn-end and
//! idle signals are CLEARS, never waits: claude `Stop`, opencode
//! `session.idle`, pi `agent_end`/`agent_settled` and codex `Stop` all
//! mean the turn concluded (the reference maps every one of them to
//! `done`), so a finished Pi turn reads `idle`, never `needs_input`.
//!
//! For claude, later PTY output alone clears the signal back to
//! activity-based derivation (`session.rs`'s reader thread clears it
//! unconditionally on every chunk) — a plain CLI that only redraws in
//! response to real input. OpenCode, Pi, and interactive Codex can repaint
//! while genuinely still waiting, so generic PTY output would clear a real
//! wait signal within a frame or two and make "the agent is waiting for
//! you" a lie. Their sessions opt out of the generic clear
//! (`SessionHandle::set_explicit_wait_clear`) and are cleared only by their
//! own hook's events — the resumption events [`opencode_events::NEW_TURN`]/
//! [`opencode_events::TOOL_START`]/[`opencode_events::PERMISSION_REPLIED`]/
//! [`opencode_events::QUESTION_REPLIED`] and [`pi_events::AGENT_START`]/
//! [`pi_events::TOOL_START`]/[`pi_events::TOOL_APPROVAL_RESOLVED`], plus the
//! turn-end clears [`opencode_events::SESSION_IDLE`] and
//! [`pi_events::AGENT_END`] — via [`classify_hook_event`]. Exit takes
//! precedence over either mechanism.
//!
//! Those same explicit-clear sessions also derive `Working` from their
//! hook lifecycle ([`HookTurn`]), not from the raw activity clock: a turn
//! reported by a resumption hook stays `Working` through silent thinking
//! past the activity window, and the user's own echo at an idle prompt
//! never manufactures a spinner the agent's hooks never reported (#358
//! fork parity — Orca's sidebar status is hook-driven, never
//! output-driven). The turn-end clears conclude that lifecycle: they
//! close the turn and read `idle` on the harness's own authority, so the
//! user's echo at the idle prompt after a finished turn does not spin the
//! row back to `working` either.

use std::time::Duration;

/// Claude Code `--settings` hook event names (`hooks.rs`'s
/// `settings_json`/`hook_command`). `Notification` stays the wait signal
/// (this install's surface for the fork's `PermissionRequest`); `Stop` is
/// a turn-end clear — the fork maps Claude's `Stop` to `done`.
pub(crate) mod claude_events {
    pub(crate) const STOP: &str = "Stop";
    pub(crate) const NOTIFICATION: &str = "Notification";
}

/// OpenCode status-plugin event names, ported from the reference's
/// `src/main/opencode/status-plugin-factory-source.ts` and
/// `status-plugin-lifecycle-source.ts` (`event.type` values only — see
/// `harness_hooks::opencode` for what's deliberately not ported: child
/// session ownership, busy/retry backoff, message previews).
pub(crate) mod opencode_events {
    /// `session.idle`: the agent stopped and its turn concluded (the
    /// reference maps this to `done`) — a CLEAR, never a wait (#360).
    pub(crate) const SESSION_IDLE: &str = "SessionIdle";
    /// `permission.asked`.
    pub(crate) const PERMISSION_REQUEST: &str = "PermissionRequest";
    /// `question.asked`.
    pub(crate) const ASK_USER_QUESTION: &str = "AskUserQuestion";
    /// `session.created` (new root session) or `message.updated` with a
    /// user-authored message: a new turn started.
    pub(crate) const NEW_TURN: &str = "NewTurn";
    /// `message.part.updated` for a tool part.
    pub(crate) const TOOL_START: &str = "ToolStart";
    /// `permission.replied`.
    pub(crate) const PERMISSION_REPLIED: &str = "PermissionReplied";
    /// `question.replied` or `question.rejected`.
    pub(crate) const QUESTION_REPLIED: &str = "QuestionReplied";
}

/// Pi agent-status extension event names, ported from the reference's
/// `src/main/pi/agent-status-handler-source.ts` (`pi.on(...)` names only).
pub(crate) mod pi_events {
    /// `agent_end` (without `willContinue`) or `agent_settled`: the agent's
    /// turn concluded (the reference maps this to `done`) — a CLEAR, never
    /// a wait (issue #360: a finished turn must read `idle`).
    pub(crate) const AGENT_END: &str = "AgentEnd";
    /// `tool_approval_requested`: the run is parked on a permission prompt —
    /// the only genuine Pi wait signal.
    pub(crate) const TOOL_APPROVAL_REQUESTED: &str = "ToolApprovalRequested";
    /// `before_agent_start` or `agent_start`: a new turn started.
    pub(crate) const AGENT_START: &str = "AgentStart";
    /// `tool_execution_start` or `tool_call`.
    pub(crate) const TOOL_START: &str = "ToolStart";
    /// `tool_approval_resolved`.
    pub(crate) const TOOL_APPROVAL_RESOLVED: &str = "ToolApprovalResolved";
}

/// Codex hook event names. Codex uses the same names in hooks.json and in the
/// stdin payload sent to a command hook. `PermissionRequest` is the only
/// event that means the root session is waiting for the user; `Stop` is a
/// turn-end clear (the reference maps it to `done`), and `SubagentStop`
/// merely completes a child.
pub(crate) mod codex_events {
    pub(crate) const SESSION_START: &str = "SessionStart";
    pub(crate) const USER_PROMPT_SUBMIT: &str = "UserPromptSubmit";
    pub(crate) const PRE_TOOL_USE: &str = "PreToolUse";
    pub(crate) const PERMISSION_REQUEST: &str = "PermissionRequest";
    pub(crate) const POST_TOOL_USE: &str = "PostToolUse";
    pub(crate) const SUBAGENT_START: &str = "SubagentStart";
    pub(crate) const SUBAGENT_STOP: &str = "SubagentStop";
    pub(crate) const STOP: &str = "Stop";
}

const WAIT_EVENTS: &[&str] = &[
    // Fork parity (issue #360): only genuine user-response waits. Turn-end
    // and idle signals are clears, never waits.
    claude_events::NOTIFICATION,
    opencode_events::PERMISSION_REQUEST,
    opencode_events::ASK_USER_QUESTION,
    pi_events::TOOL_APPROVAL_REQUESTED,
    codex_events::PERMISSION_REQUEST,
];

const RESUMPTION_EVENTS: &[&str] = &[
    opencode_events::NEW_TURN,
    opencode_events::TOOL_START,
    opencode_events::PERMISSION_REPLIED,
    opencode_events::QUESTION_REPLIED,
    pi_events::AGENT_START,
    pi_events::TOOL_START,
    pi_events::TOOL_APPROVAL_RESOLVED,
    codex_events::SESSION_START,
    codex_events::USER_PROMPT_SUBMIT,
    codex_events::PRE_TOOL_USE,
    codex_events::POST_TOOL_USE,
    codex_events::SUBAGENT_START,
    codex_events::SUBAGENT_STOP,
];

/// Turn-end / idle clears (the fork maps every one of these to `done`).
/// Kept apart from the resumption events because they also CLOSE the hook
/// turn: a resumption hook keeps `HookTurn::Active`, a turn-end hook moves
/// it to `HookTurn::Ended`.
const TURN_END_EVENTS: &[&str] = &[
    claude_events::STOP,
    opencode_events::SESSION_IDLE,
    pi_events::AGENT_END,
    codex_events::STOP,
];

/// What a `session.hook_event` name means: park the session on a genuine
/// user wait, report turn activity, or conclude the turn. `None` (an
/// unrecognized name) is refused by the caller before this is reached —
/// see `hooks::do_session_hook_event`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HookSignal {
    Wait,
    TurnStart,
    TurnEnd,
}

/// Classifies a `session.hook_event` event name. A single flat namespace
/// across all four hook-reporting harnesses is safe: each harness's own
/// hook plumbing is the only thing that ever names its own events (a claude session's
/// settings file never embeds `SessionIdle`, for instance), so there is no
/// cross-harness ambiguity to resolve here.
pub(crate) fn classify_hook_event(event: &str) -> Option<HookSignal> {
    if WAIT_EVENTS.contains(&event) {
        Some(HookSignal::Wait)
    } else if RESUMPTION_EVENTS.contains(&event) {
        Some(HookSignal::TurnStart)
    } else if TURN_END_EVENTS.contains(&event) {
        Some(HookSignal::TurnEnd)
    } else {
        None
    }
}

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

/// Hook-authoritative turn fact for sessions that opted into explicit
/// wait clearing (OpenCode/Pi/interactive Codex). `Untracked` keeps the
/// purely activity-based derivation (Claude, plain shells): without a
/// hook lifecycle there is no other truth to report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HookTurn {
    /// No hook lifecycle governs this session; the activity clock decides.
    Untracked,
    /// A resumption hook fired with no later wait hook: the agent's turn is
    /// running. `Working` is then truthful for the whole turn — including
    /// silent stretches past the activity window — until the next wait
    /// hook hands the session back to the user.
    Active,
    /// Hook-governed but no turn is known live (before the first hook
    /// event, or after a daemon restart lost the in-memory fact): fall
    /// back to the activity clock rather than guess.
    Inactive,
    /// A turn-end hook concluded the turn (`AgentEnd`/`SessionIdle`/`Stop`,
    /// issue #360): the row reads `Idle` on the harness's own authority
    /// and stays there — the user's echo at the idle prompt does not spin
    /// it back to `Working` — until the next resumption hook opens a new
    /// turn.
    Ended,
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
/// clock; a hook-tracked live turn is `Working` regardless of output
/// silence; a hook-tracked concluded turn is `Idle` regardless of later
/// echo; a never-observed session without a signal is `Unknown` rather
/// than guessed as idle, since idle implies activity once happened.
pub(crate) fn derive(
    exited: bool,
    activity: Activity,
    needs_input: bool,
    hook_turn: HookTurn,
) -> AgentState {
    if exited {
        return AgentState::Exited;
    }
    if needs_input {
        return AgentState::NeedsInput;
    }
    if matches!(hook_turn, HookTurn::Active) {
        return AgentState::Working;
    }
    if matches!(hook_turn, HookTurn::Ended) {
        return AgentState::Idle;
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
            derive(true, Activity::NeverObserved, false, HookTurn::Untracked),
            AgentState::Exited
        );
        assert_eq!(
            derive(
                true,
                Activity::LastActiveAgo(Duration::from_millis(1)),
                false,
                HookTurn::Untracked
            ),
            AgentState::Exited
        );
    }

    #[test]
    fn exited_wins_over_an_uncleared_hook_signal() {
        assert_eq!(
            derive(true, Activity::NeverObserved, true, HookTurn::Untracked),
            AgentState::Exited
        );
    }

    #[test]
    fn hook_signal_wins_over_any_activity_fact() {
        assert_eq!(
            derive(false, Activity::NeverObserved, true, HookTurn::Untracked),
            AgentState::NeedsInput
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(Duration::from_millis(0)),
                true,
                HookTurn::Untracked
            ),
            AgentState::NeedsInput
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW + Duration::from_secs(60)),
                true,
                HookTurn::Untracked
            ),
            AgentState::NeedsInput
        );
    }

    #[test]
    fn never_observed_is_unknown_not_idle() {
        assert_eq!(
            derive(false, Activity::NeverObserved, false, HookTurn::Untracked),
            AgentState::Unknown
        );
    }

    #[test]
    fn within_window_is_working_at_and_past_boundary_is_idle() {
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(Duration::from_millis(0)),
                false,
                HookTurn::Untracked
            ),
            AgentState::Working
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW - Duration::from_millis(1)),
                false,
                HookTurn::Untracked
            ),
            AgentState::Working
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW),
                false,
                HookTurn::Untracked
            ),
            AgentState::Idle
        );
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW + Duration::from_secs(60)),
                false,
                HookTurn::Untracked
            ),
            AgentState::Idle
        );
    }

    #[test]
    fn active_hook_turn_is_working_through_output_silence() {
        // A silent thinking stretch past the activity window must not drop
        // a hook-reported turn to idle mid-turn (#358: flickering spinner).
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(ACTIVITY_WINDOW + Duration::from_secs(60)),
                false,
                HookTurn::Active
            ),
            AgentState::Working
        );
        assert_eq!(
            derive(false, Activity::NeverObserved, false, HookTurn::Active),
            AgentState::Working
        );
    }

    #[test]
    fn needs_input_wins_over_an_active_hook_turn() {
        // The wait hook hands the session back to the user even while the
        // turn fact has not been cleared yet (ordering races between the
        // two hook events resolve toward asking, never spinning).
        assert_eq!(
            derive(
                false,
                Activity::LastActiveAgo(Duration::from_millis(0)),
                true,
                HookTurn::Active
            ),
            AgentState::NeedsInput
        );
    }

    #[test]
    fn inactive_hook_turn_falls_back_to_the_activity_clock() {
        // Before the first hook event (or after a restart lost the
        // in-memory turn fact) a hook-governed session reports exactly
        // what an untracked one would.
        for hook_turn in [HookTurn::Inactive, HookTurn::Untracked] {
            assert_eq!(
                derive(
                    false,
                    Activity::LastActiveAgo(Duration::from_millis(0)),
                    false,
                    hook_turn
                ),
                AgentState::Working
            );
            assert_eq!(
                derive(
                    false,
                    Activity::LastActiveAgo(ACTIVITY_WINDOW + Duration::from_secs(60)),
                    false,
                    hook_turn
                ),
                AgentState::Idle
            );
        }
    }

    #[test]
    fn exited_wins_over_an_active_hook_turn() {
        assert_eq!(
            derive(true, Activity::NeverObserved, false, HookTurn::Active),
            AgentState::Exited
        );
    }

    #[test]
    fn classify_hook_event_covers_every_harness_wait_and_turn_name() {
        // Issue #360 fork parity: a session is needs_input only while the
        // harness is genuinely waiting on the user.
        for event in [
            claude_events::NOTIFICATION,
            opencode_events::PERMISSION_REQUEST,
            opencode_events::ASK_USER_QUESTION,
            pi_events::TOOL_APPROVAL_REQUESTED,
            codex_events::PERMISSION_REQUEST,
        ] {
            assert_eq!(
                classify_hook_event(event),
                Some(HookSignal::Wait),
                "{event} must be a wait signal"
            );
        }
        // Turn-end/idle signals conclude the turn (the reference maps
        // every one to `done`).
        for event in [
            claude_events::STOP,
            opencode_events::SESSION_IDLE,
            pi_events::AGENT_END,
            codex_events::STOP,
        ] {
            assert_eq!(
                classify_hook_event(event),
                Some(HookSignal::TurnEnd),
                "{event} must be a turn-end signal"
            );
        }
        // Resumption events report turn activity.
        for event in [
            opencode_events::NEW_TURN,
            opencode_events::TOOL_START,
            opencode_events::PERMISSION_REPLIED,
            opencode_events::QUESTION_REPLIED,
            pi_events::AGENT_START,
            pi_events::TOOL_START,
            pi_events::TOOL_APPROVAL_RESOLVED,
            codex_events::SESSION_START,
            codex_events::USER_PROMPT_SUBMIT,
            codex_events::PRE_TOOL_USE,
            codex_events::POST_TOOL_USE,
            codex_events::SUBAGENT_START,
            codex_events::SUBAGENT_STOP,
        ] {
            assert_eq!(
                classify_hook_event(event),
                Some(HookSignal::TurnStart),
                "{event} must be a turn-start signal"
            );
        }
    }

    #[test]
    fn classify_hook_event_refuses_unknown_names() {
        for event in ["NotificationSent", "ToolResult", "bogus", ""] {
            assert_eq!(classify_hook_event(event), None, "{event} must be unknown");
        }
    }

    #[test]
    fn ended_hook_turn_reads_idle_and_ignores_echo() {
        // #360: after a turn-end hook the row is idle on the harness's own
        // authority — even for recent activity (the user's echo at the
        // idle prompt) and even with no observed activity at all.
        for activity in [
            Activity::NeverObserved,
            Activity::LastActiveAgo(Duration::from_millis(0)),
            Activity::LastActiveAgo(ACTIVITY_WINDOW + Duration::from_secs(60)),
        ] {
            assert_eq!(
                derive(false, activity, false, HookTurn::Ended),
                AgentState::Idle
            );
        }
        assert_eq!(
            derive(
                true,
                Activity::LastActiveAgo(Duration::from_millis(0)),
                false,
                HookTurn::Ended
            ),
            AgentState::Exited
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
