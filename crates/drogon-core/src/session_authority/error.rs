//! Session authority error codes, mirroring the pinned source's thrown error
//! strings exactly. Source pin:
//! `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (`src/shared/agent-session-provider-handle.ts`,
//! `src/main/runtime/agent-session-provider-handle-transition.ts`).
//!
//! The source throws `new Error('<code>')`; each variant's `code()` returns
//! the exact same string so ported callers and tests can match on the
//! wire-visible value. Only the codes raised by the assigned slice-1 surface
//! (handle chain + record admission + the one record transition) live here;
//! lease acquisition/adjudication codes return with the later store slice.
//! Distinct source codes stay distinct — stale fence, provider mismatch and
//! unknown ownership never collapse into one another.

use std::fmt;

/// Error codes thrown by the pinned source handle-chain and record-transition
/// paths that this slice implements.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SessionAuthorityError {
    /// `agent_session_provider_handle_invalid`
    ProviderHandleInvalid,
    /// `agent_session_provider_handle_provider_mismatch`
    ProviderHandleProviderMismatch,
    /// `agent_session_provider_handle_stale_fence`
    ProviderHandleStaleFence,
    /// `agent_session_provider_handle_forked`
    ProviderHandleForked,
    /// `agent_session_provider_handle_chain_overflow`
    ProviderHandleChainOverflow,
    /// `agent_session_stale_fence` (record-provider-handle-transition fence check)
    StaleFence,
    /// `agent_session_ownership_unknown` (raised by the assigned record
    /// transition when neither live nor new-owner-proving admits the write;
    /// the lease-policy callers that also use this code arrive with the
    /// later store slice)
    OwnershipUnknown,
}

impl SessionAuthorityError {
    /// The exact string the pinned source throws for this condition.
    pub fn code(self) -> &'static str {
        match self {
            Self::ProviderHandleInvalid => "agent_session_provider_handle_invalid",
            Self::ProviderHandleProviderMismatch => {
                "agent_session_provider_handle_provider_mismatch"
            }
            Self::ProviderHandleStaleFence => "agent_session_provider_handle_stale_fence",
            Self::ProviderHandleForked => "agent_session_provider_handle_forked",
            Self::ProviderHandleChainOverflow => "agent_session_provider_handle_chain_overflow",
            Self::StaleFence => "agent_session_stale_fence",
            Self::OwnershipUnknown => "agent_session_ownership_unknown",
        }
    }
}

impl fmt::Display for SessionAuthorityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for SessionAuthorityError {}
