//! MIT Copyright (c) 2026 Lovecast Inc.
//! Monotonic daemon feature-protocol version (install-resilience P4),
//! mirroring the read-only Orca reference
//! `src/main/daemon/daemon-protocol-version.ts` (currently 36), whose header
//! states the principle this rewrite lacked: "daemons survive app updates,
//! so wire behavior must be version-gated."
//!
//! Additive by contract: the envelope's `PROTOCOL_VERSION` (1) stays an
//! equality-checked handshake and is NEVER bumped here; this module tracks
//! the finer-grained "which wire-visible behaviors does this daemon build
//! admit" floor that `daemon.status` reports as `featureProtocol` and
//! desktop feature gates compare against. An older reader of a status reply
//! ignores the field; nothing existing changes shape.
//!
//! Bump policy (mirrors the reference's): increment [`FEATURE_PROTOCOL_VERSION`]
//! exactly when a wire-visible daemon behavior lands (a new RPC field, a new
//! method an older daemon would refuse, a changed refusal vocabulary), and
//! name a constant for the feature at that version. Do NOT bump for
//! internal-only changes a peer cannot observe. A caller feature-detects
//! live (`daemon.version >= FEATURE_X`) instead of sending an RPC the
//! connected daemon would refuse with a raw serde error.

/// The feature-protocol floor every daemon build reports. Version 1 is the
/// pre-tracking wire surface (envelope protocol 1, no tracked behaviors);
/// the first tracked behavior landed at 2.
pub const FEATURE_PROTOCOL_VERSION: u32 = 2;

/// `bot.run` admits the `interactive` field (the hand-parsed allowlist in
/// `crates/drogon-core/src/bot_run_rpc.rs`'s `parse_bot_run_request`). A
/// daemon below this floor refuses any `bot.run` carrying `interactive`
/// with `invalid_argument: "unknown field interactive"` — the exact
/// raw-serde skew refusal that motivated this module.
pub const BOT_RUN_INTERACTIVE_FIELD_PROTOCOL: u32 = 2;

/// Live feature detection: does a daemon reporting `feature_protocol`
/// admit the `bot.run` `interactive` field? `false` — never an error —
/// lets the caller pick an older strategy or surface the restart
/// affordance instead of forwarding a doomed call.
pub fn supports_bot_run_interactive(feature_protocol: u32) -> bool {
    feature_protocol >= BOT_RUN_INTERACTIVE_FIELD_PROTOCOL
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_floors_never_exceed_the_current_version() {
        const { assert!(FEATURE_PROTOCOL_VERSION >= BOT_RUN_INTERACTIVE_FIELD_PROTOCOL) }
    }

    #[test]
    fn interactive_detection_is_a_live_floor_comparison() {
        assert!(supports_bot_run_interactive(FEATURE_PROTOCOL_VERSION));
        assert!(supports_bot_run_interactive(2));
        assert!(!supports_bot_run_interactive(1));
    }
}
