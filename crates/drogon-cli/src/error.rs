//! CLI failure taxonomy mapped to the frozen exit codes:
//! 0 ok, 1 operation/transport failure, 2 usage errors.

use drogon_protocol::{Response, RpcError};
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    /// Bad invocation: argparse failures and client-side input validation.
    /// Exit 2, message on stderr, never a JSON envelope on stdout.
    #[error("{0}")]
    Usage(String),

    /// The service answered `ok:false`. Exit 1.
    #[error("{error}")]
    Server {
        error: RpcError,
        /// The validated raw response envelope, replayed verbatim under --json
        /// so additive fields survive.
        raw: Value,
    },

    /// Local transport or protocol failure: the runtime is missing, unreachable,
    /// timed out, or answered with a malformed envelope. Exit 1 with code
    /// `unverifiable` (or `invalid_argument` for protocol-shape violations).
    #[error("{error}")]
    Local { error: RpcError, request_id: String },
}

impl CliError {
    pub fn local(error: RpcError, request_id: impl Into<String>) -> Self {
        CliError::Local {
            error,
            request_id: request_id.into(),
        }
    }

    pub fn rpc_error(&self) -> RpcError {
        match self {
            CliError::Usage(message) => RpcError::new("invalid_argument", message.clone()),
            CliError::Server { error, .. } | CliError::Local { error, .. } => error.clone(),
        }
    }

    pub fn exit_code(&self) -> u8 {
        match self {
            CliError::Usage(_) => 2,
            CliError::Server { .. } | CliError::Local { .. } => 1,
        }
    }

    /// The failure envelope to print on stdout under `--json`.
    pub fn failure_envelope(&self) -> Option<Response> {
        match self {
            CliError::Usage(_) => None,
            CliError::Server { raw, .. } => serde_json::from_value(raw.clone()).ok(),
            CliError::Local { error, request_id } => {
                Some(Response::failure(request_id.clone(), error.clone()))
            }
        }
    }

    /// Re-keys an error onto the operation's request id. Used for capability
    /// preflight failures: the preflight `status` is a read-only request with
    /// its own id, but every error the caller sees must retain the operation's
    /// replay identity.
    pub fn retaining_request_id(self, request_id: &str) -> Self {
        match self {
            CliError::Usage(message) => CliError::Usage(message),
            CliError::Local { error, .. } => CliError::Local {
                error,
                request_id: request_id.to_string(),
            },
            CliError::Server { error, .. } => CliError::Local {
                error: RpcError::new(
                    error.code.clone(),
                    format!("{} (during capability preflight)", error.message),
                ),
                request_id: request_id.to_string(),
            },
        }
    }
}

pub fn invalid_argument(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message)
}

pub fn unverifiable(message: impl Into<String>) -> RpcError {
    RpcError::new("unverifiable", message)
}

pub fn internal_error(message: impl Into<String>) -> RpcError {
    RpcError::new("internal_error", message)
}

/// The service contract routes unknown-method/feature gaps here; the CLI
/// reuses it when the capability preflight fails so the wording stays stable
/// whether the capability was absent or the method was missing.
pub fn method_not_found(message: impl Into<String>) -> RpcError {
    RpcError::new("method_not_found", message)
}
