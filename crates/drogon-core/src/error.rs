//! Central mapping from internal failures to the frozen wire error codes in
//! `docs/migration/protocol-v1.md`. Every error the engine can produce goes
//! through one of these constructors so the code string set stays exact.

use drogon_protocol::RpcError;

pub(crate) fn invalid_argument(msg: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", msg.into())
}

pub(crate) fn not_found(msg: impl Into<String>) -> RpcError {
    RpcError::new("not_found", msg.into())
}

pub(crate) fn stale_incarnation() -> RpcError {
    RpcError::new(
        "stale_incarnation",
        "Session identity changed; refresh before acting.",
    )
}

pub(crate) fn unverifiable(msg: impl Into<String>) -> RpcError {
    RpcError::new("unverifiable", msg.into())
}

pub(crate) fn request_conflict() -> RpcError {
    RpcError::new(
        "request_conflict",
        "requestId was already used with different parameters.",
    )
}

pub(crate) fn method_not_found(method: &str) -> RpcError {
    RpcError::new("method_not_found", format!("Unknown method: {method}"))
}

pub(crate) fn io_error(msg: impl Into<String>) -> RpcError {
    RpcError::new("io_error", msg.into())
}

pub(crate) fn internal_error(msg: impl Into<String>) -> RpcError {
    RpcError::new("internal_error", msg.into())
}

/// `rusqlite` failures never carry attacker-controlled content by construction
/// (params are validated before touching the DB), so the message is safe to
/// surface, but callers must never forward raw driver text that could
/// contain filesystem paths beyond the data directory.
pub(crate) fn from_sqlite(err: rusqlite::Error) -> RpcError {
    internal_error(format!("storage failure: {err}"))
}
