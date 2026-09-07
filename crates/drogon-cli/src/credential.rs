//! Worker credential selection for `Request.auth`.
//!
//! Absent `DROGON_DISPATCH_CAPABILITY` preserves the existing service-token
//! flow. A present variable is authoritative: a valid value goes verbatim to
//! the wire and the service token file is never opened; anything else fails
//! `unauthorized` before any connection, with no fallback and no echo of the
//! supplied value. `MAX_CREDENTIAL_BYTES` is a transport input bound (frames
//! cap at 1 MiB); tokens stay opaque — the server, not the CLI, judges them.

use std::path::Path;

use crate::error::CliError;
use crate::paths;

pub const DISPATCH_CAPABILITY_ENV: &str = "DROGON_DISPATCH_CAPABILITY";

/// Conservative cap on an environment-supplied bearer secret.
pub const MAX_CREDENTIAL_BYTES: usize = 4096;

fn unauthorized(request_id: &str) -> CliError {
    CliError::local(
        drogon_protocol::RpcError::new(
            "unauthorized",
            format!("invalid {DISPATCH_CAPABILITY_ENV}"),
        ),
        request_id,
    )
}

fn is_usable_credential(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CREDENTIAL_BYTES
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Whether a dispatch-scoped credential is present in the environment
/// (including a present-but-invalid one, which fails closed in `resolve`).
/// The native orchestration CLI uses this to pick the actor scope: presence
/// means worker actor, absence means coordinator actor — the availability of
/// an admin token file never decides.
pub fn dispatch_credential_present() -> bool {
    std::env::var_os(DISPATCH_CAPABILITY_ENV).is_some()
}

/// Resolves the wire credential. Only the absent-variable case reads the
/// service token file; every other decision precedes filesystem and network.
pub fn resolve(data_dir: &Path, request_id: &str) -> Result<String, CliError> {
    let Some(raw) = std::env::var_os(DISPATCH_CAPABILITY_ENV) else {
        return paths::read_auth_token(data_dir)
            .map_err(|error| CliError::local(error, request_id));
    };
    let Ok(value) = raw.into_string() else {
        return Err(unauthorized(request_id));
    };
    if !is_usable_credential(&value) {
        return Err(unauthorized(request_id));
    }
    Ok(value)
}
