//! Generic per-integration sealed secret store (P0), generalized from the
//! Jira site-token store (`crate::jira::sites`).
//!
//! Layout under the daemon data dir (NEVER `~/.orca`, never the Bot homes):
//! `<data-dir>/integrations/<kind>/<name>.enc`, one sealed value per
//! `(kind, name)`, with the sealing key at
//! `<data-dir>/integrations/<kind>/.token-key` ([`super::seal`]). `kind` is
//! a lowercase integration id (`jira`, `github`, `granola`, …) and `name`
//! is a bare secret reference (`GITHUB_TOKEN_REF`) — both are validated so
//! neither can traverse out of its directory. Missing files read back as
//! "not configured"; per-name decryption failures are recorded in
//! `credential_errors` so status surfaces can explain a failing read
//! without re-touching the file.
//!
//! Only secret VALUES are ever written here, always sealed; callers persist
//! only the bare-name REFERENCE (see `bot_secret_grants`). MIT Copyright
//! (c) 2026 Lovecast Inc.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::seal::{self, CredentialDecryptionError};

/// Longest admitted integration kind (fits any sane integration id).
pub const MAX_KIND_CHARS: usize = 32;

/// Validate an integration kind: lowercase ASCII start, then lowercase
/// ASCII digits `_` `-`. Rejects path separators, `.` and uppercase so the
/// kind can never traverse out of `<data-dir>/integrations/`.
pub fn validate_kind(kind: &str) -> Result<(), String> {
    if kind.is_empty() || kind.len() > MAX_KIND_CHARS {
        return Err(format!(
            "integration kind must be 1..={MAX_KIND_CHARS} bytes"
        ));
    }
    let first = kind.as_bytes()[0];
    if !first.is_ascii_lowercase() {
        return Err("integration kind must start with a lowercase ASCII letter".to_string());
    }
    if !kind
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
    {
        return Err(
            "integration kind must match [a-z][a-z0-9_-]* (no separators, no dots)".to_string(),
        );
    }
    Ok(())
}

/// A sealed secret store for one integration kind. Cheap to construct from
/// the data dir; the only in-memory state is the decrypt-failure map (never
/// a value cache — values are re-opened from the sealed file on every read
/// so a revocation or re-seal takes effect immediately).
pub struct SecretStore {
    kind: String,
    kind_dir: PathBuf,
    credential_errors: Mutex<HashMap<String, String>>,
}

impl std::fmt::Debug for SecretStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Manual Debug: the struct never holds values, but keep the
        // contract explicit and testable.
        f.debug_struct("SecretStore")
            .field("kind", &self.kind)
            .field("kind_dir", &self.kind_dir)
            .finish_non_exhaustive()
    }
}

impl SecretStore {
    pub fn new(data_dir: &Path, kind: &str) -> Result<Self, String> {
        validate_kind(kind)?;
        Ok(Self {
            kind: kind.to_string(),
            kind_dir: data_dir.join("integrations").join(kind),
            credential_errors: Mutex::new(HashMap::new()),
        })
    }

    /// The integration kind this store is scoped to.
    pub fn kind(&self) -> &str {
        &self.kind
    }

    fn secret_path(&self, name: &str) -> Result<PathBuf, String> {
        crate::bots::monitors::record::validate_secret_ref(name)
            .map_err(|e| format!("invalid secret reference: {e}"))?;
        Ok(self.kind_dir.join(format!("{name}.enc")))
    }

    /// Whether a non-empty sealed file exists for `name` (the fork's
    /// `credentialFileHasContent`, against split-brain status).
    pub fn has_secret(&self, name: &str) -> bool {
        match self.secret_path(name) {
            Ok(path) => std::fs::metadata(path)
                .map(|meta| meta.len() > 0)
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    /// Read a secret. `Ok(None)` = not configured; decryption failures are
    /// recorded in `credential_errors` and returned as
    /// `Err(CredentialDecryptionError)`.
    pub fn read_secret(&self, name: &str) -> Result<Option<String>, CredentialDecryptionError> {
        let path = match self.secret_path(name) {
            Ok(path) => path,
            Err(message) => return Err(CredentialDecryptionError(message)),
        };
        let Ok(raw) = std::fs::read(&path) else {
            return Ok(None);
        };
        let key = self
            .seal_key()
            .map_err(|e| CredentialDecryptionError(format!("cannot load sealing key: {e}")))?;
        match seal::open_token(&key, &raw, &display_kind(&self.kind)) {
            Ok(secret) => {
                self.credential_errors.lock().unwrap().remove(name);
                Ok(secret)
            }
            Err(error) => {
                self.credential_errors
                    .lock()
                    .unwrap()
                    .insert(name.to_string(), error.0.clone());
                Err(error)
            }
        }
    }

    pub fn save_secret(&self, name: &str, value: &str) -> Result<(), String> {
        let path = self.secret_path(name)?;
        std::fs::create_dir_all(&self.kind_dir)
            .map_err(|e| format!("cannot create {} integration dir: {e}", self.kind))?;
        let key = self.seal_key()?;
        let sealed = seal::seal_token(&key, value);
        seal::write_file_600(&path, &sealed)?;
        self.credential_errors.lock().unwrap().remove(name);
        Ok(())
    }

    pub fn delete_secret(&self, name: &str) {
        self.credential_errors.lock().unwrap().remove(name);
        if let Ok(path) = self.secret_path(name) {
            let _ = std::fs::remove_file(path);
        }
    }

    /// The recorded decrypt failure for `name`, if any.
    pub fn credential_error(&self, name: &str) -> Option<String> {
        self.credential_errors.lock().unwrap().get(name).cloned()
    }

    /// Configured secret NAMES for this kind, sorted — references only,
    /// never values. Unreadable/invalid entries are skipped silently.
    pub fn secret_names(&self) -> Vec<String> {
        let mut names = Vec::new();
        let Ok(entries) = std::fs::read_dir(&self.kind_dir) else {
            return names;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str().and_then(|n| n.strip_suffix(".enc")) else {
                continue;
            };
            if self.secret_path(name).is_ok() {
                names.push(name.to_string());
            }
        }
        names.sort();
        names
    }

    fn seal_key(&self) -> Result<[u8; 32], String> {
        seal::load_or_create_key(&self.kind_dir)
    }
}

/// The user-facing integration name used in error messages (`jira` ->
/// `Jira`); message text only, never a key or path input.
fn display_kind(kind: &str) -> String {
    let mut chars = kind.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => kind.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANARY: &str = "canary-value-DROGON-P0-7f3a";

    fn make_store(dir: &Path, kind: &str) -> SecretStore {
        SecretStore::new(dir, kind).unwrap()
    }

    #[test]
    fn canary_value_round_trips_through_the_file_sealed_store() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "github");
        store.save_secret("CANARY_REF", CANARY).unwrap();
        // A fresh store instance (daemon restart semantics) reads the same
        // sealed file back exactly.
        let reopened = make_store(dir.path(), "github");
        assert_eq!(
            reopened.read_secret("CANARY_REF").unwrap().as_deref(),
            Some(CANARY)
        );
        assert!(reopened.has_secret("CANARY_REF"));
        assert_eq!(reopened.credential_error("CANARY_REF"), None);
    }

    #[test]
    fn sealed_file_is_hex_sealed_and_0600_and_never_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "github");
        store.save_secret("CANARY_REF", CANARY).unwrap();
        let raw = std::fs::read(dir.path().join("integrations/github/CANARY_REF.enc")).unwrap();
        assert!(raw.starts_with(b"v1."), "sealed envelope prefix");
        assert!(
            !raw.windows(CANARY.len()).any(|w| w == CANARY.as_bytes()),
            "raw file must not contain the value"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(dir.path().join("integrations/github/CANARY_REF.enc"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn tampered_secret_records_a_per_name_error() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "granola");
        store.save_secret("GRANOLA_REF", CANARY).unwrap();
        let path = dir.path().join("integrations/granola/GRANOLA_REF.enc");
        let mut raw = std::fs::read(&path).unwrap();
        raw[10] ^= 0x01;
        std::fs::write(&path, raw).unwrap();
        let error = store.read_secret("GRANOLA_REF").unwrap_err();
        assert!(error.0.contains("could not be decrypted"));
        assert_eq!(store.credential_error("GRANOLA_REF"), Some(error.0));
        // Re-saving clears the recorded error.
        store.save_secret("GRANOLA_REF", CANARY).unwrap();
        assert_eq!(store.credential_error("GRANOLA_REF"), None);
    }

    #[test]
    fn missing_secret_reads_as_not_configured() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "github");
        assert_eq!(store.read_secret("ABSENT_REF").unwrap(), None);
        assert!(!store.has_secret("ABSENT_REF"));
        // An empty file also counts as "not configured" (the fork's
        // credentialFileHasContent semantics).
        std::fs::create_dir_all(dir.path().join("integrations/github")).unwrap();
        std::fs::write(dir.path().join("integrations/github/EMPTY_REF.enc"), b"").unwrap();
        assert_eq!(store.read_secret("EMPTY_REF").unwrap(), None);
        assert!(!store.has_secret("EMPTY_REF"));
    }

    #[test]
    fn kind_is_validated_against_traversal() {
        for bad in [
            "",
            "Jira",
            "../escape",
            "a/b",
            "a.b",
            "a:b",
            "a=b",
            "jira ",
            &"x".repeat(33),
        ] {
            assert!(
                SecretStore::new(tempfile::tempdir().unwrap().path(), bad).is_err(),
                "{bad:?}"
            );
        }
        for good in ["jira", "github", "granola", "custom-1", "a_b"] {
            let dir = tempfile::tempdir().unwrap();
            assert!(SecretStore::new(dir.path(), good).is_ok(), "{good:?}");
        }
    }

    #[test]
    fn secret_names_are_validated_against_traversal_and_keyvalue_shape() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "github");
        for bad in [
            "../escape",
            "a/b",
            "KEY=value",
            "with:colon",
            "with\nnewline",
            "",
            &"x".repeat(129),
        ] {
            assert!(store.save_secret(bad, "v").is_err(), "{bad:?}");
            assert!(!store.has_secret(bad), "{bad:?}");
        }
        // The rejected names must not have created files outside the kind dir.
        assert!(store.secret_names().is_empty());
    }

    #[test]
    fn secret_names_lists_references_only() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "github");
        store.save_secret("B_REF", CANARY).unwrap();
        store.save_secret("A_REF", CANARY).unwrap();
        // The key file and stray files never appear as names.
        assert_eq!(store.secret_names(), vec!["A_REF", "B_REF"]);
    }

    #[test]
    fn debug_never_carries_values() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "github");
        store.save_secret("CANARY_REF", CANARY).unwrap();
        // Read once so the error map is exercised, then assert Debug is clean.
        let _ = store.read_secret("CANARY_REF").unwrap();
        assert!(!format!("{store:?}").contains(CANARY));
    }

    #[test]
    fn delete_removes_the_sealed_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = make_store(dir.path(), "github");
        store.save_secret("GONE_REF", CANARY).unwrap();
        assert!(store.has_secret("GONE_REF"));
        store.delete_secret("GONE_REF");
        assert!(!store.has_secret("GONE_REF"));
        assert_eq!(store.read_secret("GONE_REF").unwrap(), None);
    }
}
