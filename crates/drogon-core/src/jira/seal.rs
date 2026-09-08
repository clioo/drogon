//! At-rest encryption for Jira API tokens (R17-A).
//!
//! Ported behavior: the fork seals tokens with the OS keychain
//! (`safeStorage`) and falls back to a 0600 plaintext file when no keychain
//! is reachable (`src/main/integration-credential-file.ts`,
//! `src/main/jira/site-credential-store.ts`). The Drogon daemon has no
//! keychain binding, so this module implements the file-based encrypted
//! fallback the task mandates instead of the plaintext one: a random
//! 32-byte key held at `<jira-dir>/.token-key` (0600) seals each token as
//! `v1.<base64url(nonce || mac || ciphertext)>`. Keystream blocks are
//! HMAC-SHA256(key_enc, nonce || counter); `mac` is HMAC-SHA256 over
//! nonce||ciphertext, so tampering or a wrong key reads back as a
//! decryption error, never as token junk. Legacy/imported plaintext token
//! files (printable UTF-8) are still honored, mirroring the fork's legacy
//! read path; binary blobs that are neither sealed nor printable plaintext
//! surface as `CredentialDecryptionError`.
//! MIT Copyright (c) 2026 Lovecast Inc.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use getrandom::fill;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 16;
const MAC_LEN: usize = 32;
const SEAL_PREFIX: &str = "v1.";

/// Mirrors the fork's `CredentialDecryptionError`
/// (`src/main/integration-credential-file.ts`): raised when a token file
/// holds bytes that cannot be turned back into a usable token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialDecryptionError(pub String);

impl std::fmt::Display for CredentialDecryptionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CredentialDecryptionError {}

/// Mirrors the fork's `credentialDecryptionMessage`.
pub fn credential_decryption_message(service: &str) -> String {
    format!("{service} credential could not be decrypted. Reconnect to store a fresh token.")
}

/// Load (or lazily create) the 32-byte sealing key for a jira data dir.
pub fn load_or_create_key(
    jira_dir: &std::path::Path,
) -> std::result::Result<[u8; KEY_LEN], String> {
    let key_path = jira_dir.join(".token-key");
    if let Ok(raw) = std::fs::read(&key_path) {
        if raw.len() == KEY_LEN {
            let mut key = [0u8; KEY_LEN];
            key.copy_from_slice(&raw);
            return Ok(key);
        }
        // A wrong-sized key file is treated as corruption: rotate it so the
        // next save reseals every token, exactly like a keychain re-sign.
        rotate_key(&key_path)?;
    }
    let mut key = [0u8; KEY_LEN];
    fill(&mut key).map_err(|e| format!("cannot generate token key: {e}"))?;
    write_key(&key_path, &key)?;
    Ok(key)
}

fn rotate_key(key_path: &std::path::Path) -> std::result::Result<(), String> {
    let mut key = [0u8; KEY_LEN];
    fill(&mut key).map_err(|e| format!("cannot rotate token key: {e}"))?;
    write_key(key_path, &key)
}

fn write_key(key_path: &std::path::Path, key: &[u8; KEY_LEN]) -> std::result::Result<(), String> {
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create jira dir: {e}"))?;
    }
    write_file_600(key_path, key)
}

/// Write `data` to `path` atomically (sibling temp + rename, like the
/// fork's `writeCredentialFileAtomic`) with 0600 permissions.
pub fn write_file_600(path: &std::path::Path, data: &[u8]) -> std::result::Result<(), String> {
    let temp = path.with_extension("tmp");
    {
        use std::io::Write as _;
        let mut file = std::fs::File::create(&temp)
            .map_err(|e| format!("cannot write {}: {e}", temp.display()))?;
        // Why: a single write may be short; loop like the fork's writeSync.
        file.write_all(data)
            .map_err(|e| format!("cannot write {}: {e}", temp.display()))?;
        file.sync_all()
            .map_err(|e| format!("cannot fsync {}: {e}", temp.display()))?;
    }
    std::fs::rename(&temp, path).map_err(|e| format!("cannot rename temp file: {e}"))?;
    restrict_to_owner(path);
    Ok(())
}

/// Best-effort chmod 0600 (documented no-op where POSIX modes do not apply).
fn restrict_to_owner(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    let _ = path;
}

fn hmac(key: &[u8; KEY_LEN], label: u8, data: &[u8]) -> [u8; MAC_LEN] {
    // Domain separation between keystream blocks and the MAC.
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(&[label]);
    mac.update(data);
    let out = mac.finalize().into_bytes();
    let mut bytes = [0u8; MAC_LEN];
    bytes.copy_from_slice(&out);
    bytes
}

fn keystream_block(key: &[u8; KEY_LEN], nonce: &[u8; NONCE_LEN], counter: u32) -> [u8; MAC_LEN] {
    let mut buf = Vec::with_capacity(NONCE_LEN + 4);
    buf.extend_from_slice(nonce);
    buf.extend_from_slice(&counter.to_be_bytes());
    hmac(key, 0x01, &buf)
}

/// Seal a token: `v1.<base64url(nonce || mac || ciphertext)>`.
pub fn seal_token(key: &[u8; KEY_LEN], token: &str) -> Vec<u8> {
    let plain = token.as_bytes();
    let mut nonce = [0u8; NONCE_LEN];
    fill(&mut nonce).expect("random source for token nonce");
    let mut ciphertext = Vec::with_capacity(plain.len());
    for (index, byte) in plain.iter().enumerate() {
        let block = keystream_block(key, &nonce, (index / MAC_LEN) as u32);
        ciphertext.push(byte ^ block[index % MAC_LEN]);
    }
    let mut mac_input = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    mac_input.extend_from_slice(&nonce);
    mac_input.extend_from_slice(&ciphertext);
    let mac = hmac(key, 0x02, &mac_input);
    let mut sealed = Vec::with_capacity(NONCE_LEN + MAC_LEN + ciphertext.len());
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&mac);
    sealed.extend_from_slice(&ciphertext);
    format!("{SEAL_PREFIX}{}", URL_SAFE_NO_PAD.encode(sealed)).into_bytes()
}

/// Open a stored token. Returns `Ok(None)` for an empty file ("missing"),
/// `Err(CredentialDecryptionError)` for sealed-but-undecryptable or
/// binary-nonprintable bytes, and `Ok(Some(token))` for sealed or legacy
/// plaintext content — the fork's `readStoredCredentialToken` semantics.
pub fn open_token(
    key: &[u8; KEY_LEN],
    raw: &[u8],
) -> std::result::Result<Option<String>, CredentialDecryptionError> {
    if raw.is_empty() {
        return Ok(None);
    }
    if let Some(encoded) = raw.strip_prefix(SEAL_PREFIX.as_bytes()) {
        let decoded = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| CredentialDecryptionError(credential_decryption_message("Jira")))?;
        if decoded.len() < NONCE_LEN + MAC_LEN {
            return Err(CredentialDecryptionError(credential_decryption_message(
                "Jira",
            )));
        }
        let mut nonce = [0u8; NONCE_LEN];
        nonce.copy_from_slice(&decoded[..NONCE_LEN]);
        let stored_mac = &decoded[NONCE_LEN..NONCE_LEN + MAC_LEN];
        let ciphertext = &decoded[NONCE_LEN + MAC_LEN..];
        let mut mac_input = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        mac_input.extend_from_slice(&nonce);
        mac_input.extend_from_slice(ciphertext);
        let expected = hmac(key, 0x02, &mac_input);
        if stored_mac != expected {
            return Err(CredentialDecryptionError(credential_decryption_message(
                "Jira",
            )));
        }
        let mut plain = Vec::with_capacity(ciphertext.len());
        for (index, byte) in ciphertext.iter().enumerate() {
            let block = keystream_block(key, &nonce, (index / MAC_LEN) as u32);
            plain.push(byte ^ block[index % MAC_LEN]);
        }
        let token = String::from_utf8(plain)
            .map_err(|_| CredentialDecryptionError(credential_decryption_message("Jira")))?;
        return Ok(if token.is_empty() { None } else { Some(token) });
    }
    // Legacy plaintext fallback (the fork's readPlaintextLegacyCredential):
    // printable UTF-8 only; a sealed-looking binary blob must never decode
    // into auth-header junk.
    let text = String::from_utf8(raw.to_vec())
        .map_err(|_| CredentialDecryptionError(credential_decryption_message("Jira")))?;
    if text.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f) {
        return Err(CredentialDecryptionError(credential_decryption_message(
            "Jira",
        )));
    }
    Ok(if text.is_empty() { None } else { Some(text) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> [u8; KEY_LEN] {
        [7u8; KEY_LEN]
    }

    #[test]
    fn sealed_token_round_trips() {
        let sealed = seal_token(&key(), "tok-abc-123");
        assert!(sealed.starts_with(b"v1."));
        let opened = open_token(&key(), &sealed).unwrap();
        assert_eq!(opened.as_deref(), Some("tok-abc-123"));
    }

    #[test]
    fn wrong_key_reads_back_as_decryption_error() {
        let sealed = seal_token(&key(), "tok-abc-123");
        let mut wrong = [9u8; KEY_LEN];
        wrong[0] = 0;
        let result = open_token(&wrong, &sealed);
        assert!(matches!(result, Err(CredentialDecryptionError(_))));
    }

    #[test]
    fn empty_file_reads_as_missing() {
        assert_eq!(open_token(&key(), b"").unwrap(), None);
    }

    #[test]
    fn legacy_plaintext_token_is_honored() {
        assert_eq!(
            open_token(&key(), b"plain-token").unwrap().as_deref(),
            Some("plain-token")
        );
    }

    #[test]
    fn binary_blob_is_a_decryption_error_not_token_junk() {
        let blob: Vec<u8> = (0u8..=255).collect();
        assert!(matches!(
            open_token(&key(), &blob),
            Err(CredentialDecryptionError(_))
        ));
    }

    #[test]
    fn control_characters_in_plaintext_refuse_to_parse() {
        let raw = b"bad\ntoken";
        assert!(matches!(
            open_token(&key(), raw),
            Err(CredentialDecryptionError(_))
        ));
    }

    #[test]
    fn key_round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let first = load_or_create_key(dir.path()).unwrap();
        let second = load_or_create_key(dir.path()).unwrap();
        assert_eq!(first, second);
        let mut perms = std::fs::metadata(dir.path().join(".token-key"))
            .unwrap()
            .permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(perms.mode() & 0o777, 0o600);
            perms.set_mode(0o600);
        }
        std::fs::set_permissions(dir.path().join(".token-key"), perms).unwrap();
    }
}
