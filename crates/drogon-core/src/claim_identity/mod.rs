//! Native agent-session claim identity.
//!
//! Rust port of Orca's `src/main/runtime/agent-session-claim-identity.ts`
//! (Lovecast Inc., MIT, source revision
//! c97906287bb7a390b25e2025b600d9fb3c25d9c3) for the Drogon rewrite, per
//! `docs/migration/native-claim-identity-contract.md`. Translates the source
//! module's canonicalization, signing, ephemeral signer and persistent
//! key-loading behavior exactly — the digest format (version 1, the two
//! `orca-...` labels, field order, u32 big-endian UTF-8 length prefixes,
//! HMAC-SHA256, base64url without padding, key-id derivation) is a wire
//! compatibility contract with the TypeScript implementation, not a new
//! signing format.
//!
//! A signed claim binds identity bytes to a coordination key. It does not
//! grant lease ownership and does not prove process liveness; leases,
//! handle transitions and RPC wiring are separate capabilities.
//!
//! Platform notes (honest, per the contract):
//! - Darwin: canonicalization matches Node's `realpathSync` + `normalize`,
//!   including the `/var` → `/private/var` alias resolution.
//! - Windows: Rust `fs::canonicalize` returns extended-length (`\\?\`)
//!   spellings while the source signs Node `realpathSync` spellings; the
//!   `windows_path` seam maps canonical output back (stripping `\\?\` /
//!   remapping `\\?\UNC\` for ordinary inputs, preserving explicitly
//!   namespaced ones) and applies Unicode lowercasing as the closest
//!   equivalent of `toLocaleLowerCase('en-US')`. That path is untested on
//!   this host.
//! - Linux: expected to match the Darwin code path but is untested here.

mod resume;
mod signer;
#[cfg(windows)]
mod windows_path;

pub use resume::{
    AgentProviderSessionKey, AgentProviderSessionMetadata, RESUMABLE_TUI_AGENTS, ResumableTuiAgent,
    get_agent_resume_argv, has_unsafe_provider_session_id_chars, is_resumable_tui_agent,
    normalize_agent_provider_session,
};
pub use signer::{
    AgentSessionClaimSigner, AgentSessionExecutionClaim, CanonicalAgentSessionIdentity,
    ProviderExecutionNamespace, create_ephemeral_agent_session_claim_signer,
    load_agent_session_claim_signer,
};
#[cfg(windows)]
use windows_path::normalize_windows_canonical_path;

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// Coordination key length in bytes (source `COORDINATION_KEY_BYTES`).
pub const COORDINATION_KEY_BYTES: usize = 32;
/// Persistent coordination key filename inside the profile directory.
pub const COORDINATION_KEY_FILE: &str = "agent-session-authority.key";
/// Maximum UTF-8 byte length of a Pi/Prime transcript path.
pub const TRANSCRIPT_PATH_MAX_BYTES: usize = 16 * 1024;
/// Claim digest format version (source `AGENT_SESSION_CLAIM_DIGEST_VERSION`).
pub const AGENT_SESSION_CLAIM_DIGEST_VERSION: u32 = 1;

/// Typed failures of the claim-identity capability.
///
/// The two typed variants preserve the source's machine-readable error codes;
/// native filesystem failures are reported explicitly as [`Self::Io`] instead
/// of being folded into a rejection code — the source propagates the same
/// raw filesystem errors out of `realpathSync`/`statSync`/`readFileSync`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimIdentityError {
    /// `agent_session_identity_required`: the (agent, provider session) pair
    /// does not name a resumable identity, or a Pi/Prime transcript path is
    /// not an absolute bounded path naming a canonical regular file.
    IdentityRequired,
    /// `agent_session_ownership_unknown`: a coordination key exists but is
    /// not exactly 32 bytes. Fails closed without rotation.
    OwnershipUnknown,
    /// A native filesystem operation failed; `operation` names the failing
    /// step (mkdir, realpath, stat, read, random_bytes), `path` the involved
    /// path, `message` the OS error text.
    Io {
        operation: &'static str,
        path: PathBuf,
        message: String,
    },
}

impl fmt::Display for ClaimIdentityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IdentityRequired => write!(f, "agent_session_identity_required"),
            Self::OwnershipUnknown => write!(f, "agent_session_ownership_unknown"),
            Self::Io {
                operation,
                path,
                message,
            } => write!(
                f,
                "filesystem error during {operation} at {path:?}: {message}"
            ),
        }
    }
}

impl std::error::Error for ClaimIdentityError {}

fn io_error(operation: &'static str, path: &Path, err: &std::io::Error) -> ClaimIdentityError {
    ClaimIdentityError::Io {
        operation,
        path: path.to_path_buf(),
        message: err.to_string(),
    }
}

#[cfg(windows)]
fn platform_canonical_string(
    original: &Path,
    canonical: &Path,
) -> Result<String, ClaimIdentityError> {
    // Rust canonicalize returns extended-length (`\\?\`) spellings while the
    // source signs Node realpathSync spellings; the pure seam maps the signed
    // string back (see windows_path). Only ever applied to the *returned*
    // transcript string, never to a path used for filesystem access — the
    // `\\?\` prefix is what keeps long (>MAX_PATH) canonical paths statable.
    // Untested on this host.
    Ok(normalize_windows_canonical_path(
        &original.to_string_lossy(),
        &canonical.to_string_lossy(),
    ))
}

#[cfg(not(windows))]
fn platform_canonical_string(
    _original: &Path,
    canonical: &Path,
) -> Result<String, ClaimIdentityError> {
    canonical
        .to_str()
        .map(str::to_string)
        .ok_or(ClaimIdentityError::IdentityRequired)
}

/// Raw canonicalization: `fs::canonicalize` resolves symlinks (like
/// `realpathSync`) and its result is already normalized. On Windows the
/// returned PathBuf keeps the filesystem-safe extended-length spelling and
/// MUST be the one used for further filesystem access. Filesystem failures
/// (missing path, symlink loop) propagate as native errors exactly like the
/// source.
fn canonical_path_for_platform(value: &Path) -> Result<PathBuf, ClaimIdentityError> {
    fs::canonicalize(value).map_err(|err| io_error("realpath", value, &err))
}

/// Source `canonicalizeAgentSessionIdentity`: validates the agent and
/// provider session, then pins Pi/Prime identities to the canonical
/// on-execution-host transcript file.
///
/// Rejections (`agent_session_identity_required`) cover unsupported agents,
/// malformed metadata, provider-key mismatches, non-absolute or over-bound
/// transcript paths and transcript paths that do not name a regular file.
/// A transcript path that cannot be resolved at all is a native filesystem
/// error, matching the source's `realpathSync` failure mode.
pub fn canonicalize_agent_session_identity(
    agent: &str,
    raw_provider_session: &Value,
) -> Result<CanonicalAgentSessionIdentity, ClaimIdentityError> {
    let agent =
        ResumableTuiAgent::from_agent_name(agent).ok_or(ClaimIdentityError::IdentityRequired)?;
    let provider_session = normalize_agent_provider_session(raw_provider_session)
        .ok_or(ClaimIdentityError::IdentityRequired)?;
    if get_agent_resume_argv(agent, &provider_session, None).is_none() {
        return Err(ClaimIdentityError::IdentityRequired);
    }
    if !agent.resumes_by_transcript() {
        return Ok(CanonicalAgentSessionIdentity {
            agent,
            provider_session,
        });
    }
    let transcript_path = provider_session
        .transcript_path
        .as_deref()
        .ok_or(ClaimIdentityError::IdentityRequired)?;
    let transcript = Path::new(transcript_path);
    if !transcript.is_absolute() || transcript_path.len() > TRANSCRIPT_PATH_MAX_BYTES {
        return Err(ClaimIdentityError::IdentityRequired);
    }
    // Validate the regular file on the RAW canonical PathBuf. Stripping the
    // extended-length prefix first (as the seam does for the signed string)
    // would hand a long (>MAX_PATH) path back to the Windows APIs without
    // the prefix that makes it statable.
    let raw_canonical_transcript_path = canonical_path_for_platform(transcript)?;
    // statSync follows symlinks, so `fs::metadata` (not `symlink_metadata`)
    // is the faithful translation.
    let metadata = fs::metadata(&raw_canonical_transcript_path)
        .map_err(|err| io_error("stat", &raw_canonical_transcript_path, &err))?;
    if !metadata.file_type().is_file() {
        return Err(ClaimIdentityError::IdentityRequired);
    }
    // Only the returned/signed transcript string goes through the platform
    // spelling mapping; symlink target segments stay canonical.
    let canonical = platform_canonical_string(transcript, &raw_canonical_transcript_path)?;
    Ok(CanonicalAgentSessionIdentity {
        agent,
        provider_session: AgentProviderSessionMetadata {
            transcript_path: Some(canonical),
            ..provider_session
        },
    })
}
