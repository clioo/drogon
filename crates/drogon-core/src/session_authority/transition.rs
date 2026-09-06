//! The one assigned record transition — port of the pinned source
//! `src/main/runtime/agent-session-provider-handle-transition.ts`
//! (c97906287bb7a390b25e2025b600d9fb3c25d9c3).
//!
//! Lease acquisition, process commit, prove, renew, evict, handoff-stage and
//! journal-checkpoint transitions belong to the later, root-owned store
//! slice; they are intentionally absent here. A live record advances its
//! proven link when a new leaf is recorded; a record in new-owner-proving
//! keeps its reserved, unproven status.

use super::error::SessionAuthorityError;
use super::provider_handle::{ProviderHandleLink, append_link, chain_head};
use super::record::{AgentSessionRecord, ClaimStatus, HandoffStage};

/// Record one newly observed provider handle on a live or proving record
/// (`recordAgentSessionProviderHandle`). A live record advances its proven
/// link; a record in new-owner-proving keeps its reserved, unproven status.
pub fn record_agent_session_provider_handle(
    record: &AgentSessionRecord,
    fence: i64,
    link: &ProviderHandleLink,
    now: i64,
) -> Result<AgentSessionRecord, SessionAuthorityError> {
    if record.lease.runtime_fence != fence {
        return Err(SessionAuthorityError::StaleFence);
    }
    if link.handle.provider() != record.provider || link.minted_at_fence != fence {
        return Err(SessionAuthorityError::ProviderHandleInvalid);
    }
    if record.lease.claim_status != ClaimStatus::Live
        && record.lease.handoff_stage != Some(HandoffStage::NewOwnerProving)
    {
        return Err(SessionAuthorityError::OwnershipUnknown);
    }
    let provider_handle_chain = append_link(&record.provider_handle_chain, link)?;
    let proven_link_id = chain_head(&provider_handle_chain)
        .map(|head| head.link_id.clone())
        .ok_or(SessionAuthorityError::ProviderHandleInvalid)?;
    // Spread parity: the clone carries every extension member (record,
    // lease, links, handles, nested evidence) forward untouched; only known
    // fields are rewritten below, so updates can never resurrect stale
    // values from a shadow copy.
    let mut next = record.clone();
    next.provider_handle_chain = provider_handle_chain;
    next.lease.last_renewed_at = now;
    if next.lease.claim_status == ClaimStatus::Live {
        next.lease.proven_handle_link_id = Some(proven_link_id);
    }
    next.updated_at = now;
    Ok(next)
}
