//! Claim signing, ephemeral signers and persistent coordination-key loading.
//!
//! Ported from Orca's `src/main/runtime/agent-session-claim-identity.ts`
//! (Lovecast Inc., MIT, source revision
//! c97906287bb7a390b25e2025b600d9fb3c25d9c3). The digest format is a
//! compatibility contract and is preserved exactly: digest version 1, the two
//! `orca-...` domain-separation labels, fixed field order, u32 big-endian
//! UTF-8 length prefixes, HMAC-SHA256 and base64url without padding.
//!
//! A signing claim attests identity bytes under a coordination key. It does
//! not grant lease ownership and does not prove process liveness.

use std::fmt;
use std::fs;
use std::io::Write;
use std::path::Path;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use super::resume::{AgentProviderSessionMetadata, ResumableTuiAgent};
use super::{COORDINATION_KEY_BYTES, COORDINATION_KEY_FILE, ClaimIdentityError};

/// Fixed identity label separating the agent-session claim HMAC domain.
const IDENTITY_DIGEST_LABEL: &str = "orca-agent-session-claim-v1";
/// Fixed worktree label separating the worktree-scope HMAC domain.
const WORKTREE_DIGEST_LABEL: &str = "orca-agent-session-worktree-v1";

/// Provider execution namespace fields included in every signed digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderExecutionNamespace {
    pub machine: String,
    pub principal: String,
    pub container: String,
    pub provider_root: String,
}

/// A canonicalized (agent, provider session) identity ready for signing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalAgentSessionIdentity {
    pub agent: ResumableTuiAgent,
    pub provider_session: AgentProviderSessionMetadata,
}

/// The signed execution claim produced by
/// [`AgentSessionClaimSigner::create_claim`]. Mirrors the source
/// `AgentSessionExecutionClaim`; contains only opaque digests and the key id,
/// never key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSessionExecutionClaim {
    pub digest_version: u32,
    pub key_id: String,
    pub identity_digest: String,
    pub worktree_scope_digest: String,
    pub agent: ResumableTuiAgent,
}

/// Source `encodeFields`: each field as UTF-8 bytes prefixed with its length
/// as a u32 big-endian.
fn encode_fields(fields: &[&str]) -> Vec<u8> {
    let mut out = Vec::new();
    for field in fields {
        let bytes = field.as_bytes();
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        out.extend_from_slice(bytes);
    }
    out
}

fn hmac_sha256_b64url(key: &[u8; 32], fields: &[&str]) -> String {
    let mut mac =
        <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC-SHA256 accepts keys of any length");
    mac.update(&encode_fields(fields));
    URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
}

fn sha256_b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

/// Signs canonical agent-session identities and worktree scopes. The 32-byte
/// coordination key is never exposed: no accessor returns it, `Debug` is
/// redacted and no serialization derives from this type.
pub struct AgentSessionClaimSigner {
    authority_domain_id: String,
    key: [u8; COORDINATION_KEY_BYTES],
    key_id: String,
}

impl AgentSessionClaimSigner {
    /// Source constructor: rejects keys that are not exactly 32 bytes with
    /// `agent_session_ownership_unknown`.
    pub fn try_new(authority_domain_id: &str, key: &[u8]) -> Result<Self, ClaimIdentityError> {
        if key.len() != COORDINATION_KEY_BYTES {
            return Err(ClaimIdentityError::OwnershipUnknown);
        }
        let mut key_bytes = [0u8; COORDINATION_KEY_BYTES];
        key_bytes.copy_from_slice(key);
        // key id = base64url(sha256(key)) truncated to 22 chars.
        let mut key_id = sha256_b64url(&key_bytes);
        key_id.truncate(22);
        Ok(Self {
            authority_domain_id: authority_domain_id.to_string(),
            key: key_bytes,
            key_id,
        })
    }

    /// Opaque public key identifier (`base64url(sha256(key))[:22]`).
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// Source `createClaim`: deterministic HMAC-SHA256 digests over the
    /// length-prefixed identity and worktree fields.
    pub fn create_claim(
        &self,
        namespace: &ProviderExecutionNamespace,
        identity: &CanonicalAgentSessionIdentity,
        canonical_worktree_id: &str,
    ) -> AgentSessionExecutionClaim {
        let namespace_fields = [
            namespace.machine.as_str(),
            namespace.principal.as_str(),
            namespace.container.as_str(),
            namespace.provider_root.as_str(),
        ];
        let transcript_field = if identity.agent.resumes_by_transcript() {
            identity
                .provider_session
                .transcript_path
                .as_deref()
                .unwrap_or("")
        } else {
            ""
        };
        let identity_fields = [
            IDENTITY_DIGEST_LABEL,
            self.authority_domain_id.as_str(),
            namespace_fields[0],
            namespace_fields[1],
            namespace_fields[2],
            namespace_fields[3],
            identity.agent.as_str(),
            identity.provider_session.key.as_str(),
            identity.provider_session.id.as_str(),
            transcript_field,
        ];
        let worktree_fields = [
            WORKTREE_DIGEST_LABEL,
            self.authority_domain_id.as_str(),
            namespace_fields[0],
            namespace_fields[1],
            namespace_fields[2],
            namespace_fields[3],
            canonical_worktree_id,
        ];
        AgentSessionExecutionClaim {
            digest_version: super::AGENT_SESSION_CLAIM_DIGEST_VERSION,
            key_id: self.key_id.clone(),
            identity_digest: hmac_sha256_b64url(&self.key, &identity_fields),
            worktree_scope_digest: hmac_sha256_b64url(&self.key, &worktree_fields),
            agent: identity.agent,
        }
    }
}

impl fmt::Debug for AgentSessionClaimSigner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AgentSessionClaimSigner")
            .field("authority_domain_id", &self.authority_domain_id)
            .field("key_id", &self.key_id)
            .field("key", &"<redacted 32-byte coordination key>")
            .finish()
    }
}

impl Drop for AgentSessionClaimSigner {
    fn drop(&mut self) {
        // Best-effort hygiene for the in-memory copy; the on-disk copy in the
        // profile directory is intentionally retained (source behavior).
        self.key.fill(0);
    }
}

#[cfg(unix)]
fn write_key_exclusively(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    // Source `openSync(keyPath, 'wx', 0o600)`: create-or-fail, restrictive
    // mode subject to the process umask.
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(contents)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_key_exclusively(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    // Unix mode bits have no portable equivalent; the source's 0o600 is also
    // inert on Windows. Windows behavior is untested (see child-report.md).
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(contents)?;
    Ok(())
}

fn random_key() -> Result<[u8; COORDINATION_KEY_BYTES], ClaimIdentityError> {
    let mut key = [0u8; COORDINATION_KEY_BYTES];
    getrandom::fill(&mut key).map_err(|err| ClaimIdentityError::Io {
        operation: "random_bytes",
        path: Path::new("<system entropy>").to_path_buf(),
        message: err.to_string(),
    })?;
    Ok(key)
}

/// Source `createEphemeralAgentSessionClaimSigner`: a signer over a fresh
/// 32-byte system-entropy key, discarded with the signer.
pub fn create_ephemeral_agent_session_claim_signer(
    authority_domain_id: &str,
) -> Result<AgentSessionClaimSigner, ClaimIdentityError> {
    let key = random_key()?;
    AgentSessionClaimSigner::try_new(authority_domain_id, &key)
}

/// Source `loadAgentSessionClaimSigner`: loads (or exclusively creates with
/// restrictive Unix permissions) the profile's persistent coordination key.
///
/// Why fail closed: a replaced/corrupt key could make a surviving owner look
/// absent; refuse authority instead of silently minting an incomparable
/// namespace. A key whose length is not exactly 32 bytes is therefore
/// rejected with `agent_session_ownership_unknown` and never rotated.
///
/// Concurrent first creators race on the exclusive create; the single winner
/// writes the file every loser then reads, so all callers converge on one
/// key without silently replacing it.
///
/// One deliberate translation note: within a single source process the
/// open+write pair runs synchronously on a single-threaded event loop, so
/// its post-race re-read always sees the winner's bytes — but that is a
/// same-process guarantee only. Separate source processes can absolutely
/// race: one process can read the key file after another's `openSync('wx')`
/// but before its `writeFileSync`, so the source itself offers no
/// cross-process creation-race safety and can misread a torn (e.g. empty)
/// file as a corrupt key. Rust callers additionally share one process across
/// threads, where the equivalent window is trivially reachable in-process.
/// [`read_settled_key`] keeps the deliberate bounded settle behavior: it
/// retries that window briefly, never writes, and fails closed
/// (`OwnershipUnknown` or the native error) if the winner never materializes
/// 32 bytes.
pub fn load_agent_session_claim_signer(
    profile_directory: &Path,
    authority_domain_id: &str,
) -> Result<AgentSessionClaimSigner, ClaimIdentityError> {
    let key_path = profile_directory.join(COORDINATION_KEY_FILE);
    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent).map_err(|err| ClaimIdentityError::Io {
            operation: "mkdir",
            path: parent.to_path_buf(),
            message: err.to_string(),
        })?;
    }
    let key_bytes: Vec<u8> = match fs::read(&key_path) {
        Ok(existing) if existing.len() == COORDINATION_KEY_BYTES => existing,
        // A wrong-length existing file is either corrupt (fails closed after
        // the bounded settle window) or a concurrent creator's not-yet-written
        // file (converges on the winner's bytes).
        Ok(_) => read_settled_key(&key_path)?,
        Err(_) => {
            let candidate = random_key()?;
            match write_key_exclusively(&key_path, &candidate) {
                Ok(()) => candidate.to_vec(),
                // Lost the create race: settle on whatever the winner wrote.
                Err(_) => read_settled_key(&key_path)?,
            }
        }
    };
    AgentSessionClaimSigner::try_new(authority_domain_id, &key_bytes)
}

/// Reads the coordination key, tolerating the brief create→write window of a
/// concurrent first creator: any read that does not yet return exactly 32
/// bytes is retried for up to ~100 ms. Nothing here ever writes; a key that
/// never settles fails closed afterwards (`OwnershipUnknown` from
/// `try_new`, or the native `Io` error when reads keep failing).
fn read_settled_key(key_path: &Path) -> Result<Vec<u8>, ClaimIdentityError> {
    let mut last: std::io::Result<Vec<u8>> = fs::read(key_path);
    for _ in 0..100 {
        if matches!(&last, Ok(bytes) if bytes.len() == COORDINATION_KEY_BYTES) {
            return Ok(last.expect("checked above"));
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
        last = fs::read(key_path);
    }
    match last {
        Ok(bytes) => Ok(bytes),
        Err(err) => Err(ClaimIdentityError::Io {
            operation: "read",
            path: key_path.to_path_buf(),
            message: err.to_string(),
        }),
    }
}
