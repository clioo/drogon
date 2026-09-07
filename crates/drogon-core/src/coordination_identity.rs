//! Internal coordination identity seam: dispatch credential minting and
//! actor-scoped receipt keys. Constructible only by in-crate (authenticated
//! engine) code; grants no authorization itself. Never derive an actor ID
//! from a secret or capability hash — IDs arrive from authenticated context.
//! Persisting credentials and wiring keys into the ledgers are root-owned
//! integration steps; legacy request keys, fingerprints, and `requests.rs`
//! are untouched.

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_scope::{
    COORDINATION_CONTRACT_VERSION, MAX_CONSUMER_GENERATION,
};
use sha2::{Digest, Sha256};

#[cfg(test)]
#[path = "coordination_identity_tests.rs"]
mod coordination_identity_tests;

pub(crate) struct DispatchCredential {
    secret: String,
}

impl DispatchCredential {
    pub(crate) fn mint() -> Result<Self, RpcError> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|err| {
            crate::error::internal_error(format!("credential entropy unavailable: {err}"))
        })?;
        Ok(Self {
            secret: encode_hex(&bytes),
        })
    }

    /// Explicit accessor for private environment injection only.
    pub(crate) fn as_secret_str(&self) -> &str {
        &self.secret
    }

    /// SHA-256 of the transported string; matches the presented wire secret.
    pub(crate) fn digest(&self) -> String {
        encode_hex(&Sha256::digest(self.secret.as_bytes()))
    }
}

impl std::fmt::Debug for DispatchCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DispatchCredential(redacted)")
    }
}

#[derive(Clone)]
pub(crate) enum Actor {
    AdminBootstrap {
        host_id: String,
        coordinator_id: String,
    },
    Coordinator {
        host_id: String,
        run_id: String,
        coordinator_id: String,
        consumer_generation: u64,
    },
    Worker {
        host_id: String,
        run_id: String,
        task_id: String,
        dispatch_id: String,
        session_id: String,
        incarnation: String,
    },
}

impl Actor {
    /// Domain/version-prefixed SHA-256 over a length-prefixed field tuple —
    /// unambiguous without delimiter joining. No raw actor fields appear in
    /// the key. Every field is validated first; failures are fail-closed.
    pub(crate) fn receipt_key(&self, external_request_id: &str) -> Result<String, RpcError> {
        validate_external_id(external_request_id)?;
        let mut hasher = Sha256::new();
        push_field(&mut hasher, b"drogon-coordination");
        push_field(
            &mut hasher,
            COORDINATION_CONTRACT_VERSION.to_string().as_bytes(),
        );
        match self {
            Actor::AdminBootstrap {
                host_id,
                coordinator_id,
            } => {
                validate_id(host_id)?;
                validate_id(coordinator_id)?;
                push_field(&mut hasher, b"admin-bootstrap");
                push_field(&mut hasher, host_id.as_bytes());
                push_field(&mut hasher, coordinator_id.as_bytes());
            }
            Actor::Coordinator {
                host_id,
                run_id,
                coordinator_id,
                consumer_generation,
            } => {
                validate_id(host_id)?;
                validate_id(run_id)?;
                validate_id(coordinator_id)?;
                if !(1..=MAX_CONSUMER_GENERATION).contains(consumer_generation) {
                    return Err(RpcError::new(
                        "invalid_argument",
                        "invalid consumer generation",
                    ));
                }
                push_field(&mut hasher, b"coordinator");
                push_field(&mut hasher, host_id.as_bytes());
                push_field(&mut hasher, run_id.as_bytes());
                push_field(&mut hasher, coordinator_id.as_bytes());
                push_field(&mut hasher, &consumer_generation.to_le_bytes());
            }
            Actor::Worker {
                host_id,
                run_id,
                task_id,
                dispatch_id,
                session_id,
                incarnation,
            } => {
                validate_id(host_id)?;
                validate_id(run_id)?;
                validate_id(task_id)?;
                validate_id(dispatch_id)?;
                validate_id(session_id)?;
                validate_id(incarnation)?;
                push_field(&mut hasher, b"worker");
                push_field(&mut hasher, host_id.as_bytes());
                push_field(&mut hasher, run_id.as_bytes());
                push_field(&mut hasher, task_id.as_bytes());
                push_field(&mut hasher, dispatch_id.as_bytes());
                push_field(&mut hasher, session_id.as_bytes());
                push_field(&mut hasher, incarnation.as_bytes());
            }
        }
        push_field(&mut hasher, external_request_id.as_bytes());
        // NUL is forbidden in external request IDs, isolating the legacy namespace.
        Ok(format!(
            "\0drogon-coordination-v1:{}",
            encode_hex(&hasher.finalize())
        ))
    }
}

fn push_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Bounds mirror `orchestration_scope` shape validation; messages stay static
/// so errors never include raw identity material.
fn validate_id(value: &str) -> Result<(), RpcError> {
    if value.is_empty()
        || value.len() > 128
        || value.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(RpcError::new(
            "invalid_argument",
            "invalid coordination identity",
        ));
    }
    Ok(())
}

/// Rules mirror the `Request` envelope's request-id validation.
fn validate_external_id(value: &str) -> Result<(), RpcError> {
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(RpcError::new(
            "invalid_argument",
            "invalid external request id",
        ));
    }
    Ok(())
}
