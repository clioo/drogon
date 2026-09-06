//! Native session authority — dependency slice 1: schema-v2 provider
//! conversation record model, persisted-record admission/serialization, and
//! provider-handle chain behavior, plus the one assigned record transition
//! (`record_agent_session_provider_handle`: live proven-link advance versus
//! new-owner-proving reserved/unproven recording), ported from the pinned
//! Orca source (`c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
//!
//! A provider conversation record is the session's identity — where it runs,
//! which provider it talks to, which account home is pinned to it — and is
//! independent of any terminal tab, PTY, process liveness verdict, or signed
//! claim. Lease acquisition/adjudication policy, the durable store, and
//! caller integration are later, root-owned slices; the lease *model* is
//! part of the schema and stays. This module is deliberately pure so the
//! root-owned lease/transaction integration can consume it through the
//! existing Engine SQLite connection; no store, supervisor, or caller
//! integration lives here.
//!
//! Registered as a production module in `crate::lib`; integration tests
//! consume the public API directly.

pub mod error;
pub mod provider_handle;
pub mod record;
pub mod transition;

use serde_json::Value;

/// JSON members beyond one object level's known schema-v2 fields. The source
/// keeps a single object representation: every record mutation spreads the
/// previous object and rewrites only known keys, so unknown members are
/// load-bearing persisted state, never a secondary shadow of known fields.
pub type Extensions = serde_json::Map<String, Value>;

/// Split one validated JSON object into its unknown members, verbatim.
pub(crate) fn split_extensions(
    object: &serde_json::Map<String, Value>,
    known: &[&str],
) -> Extensions {
    object
        .iter()
        .filter(|(key, _)| !known.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

/// Serialization filter: the extensions maps are public, so a typed caller
/// may insert known keys into them; skipping those keys keeps known-field
/// authority with the typed state and cannot resurrect absent optionals.
pub(crate) fn serialized_extensions(
    extensions: &Extensions,
    known: &[&str],
) -> Vec<(String, Value)> {
    extensions
        .iter()
        .filter(|(key, _)| !known.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}
