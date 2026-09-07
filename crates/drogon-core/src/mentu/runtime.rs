//! Resolution and verification of the pinned `mentu-recipes` runtime.
//! Mirrors the fork's `mentu-runtime-identity.ts`, narrowed to this
//! product's own simpler layout: `<data-dir>/mentu/runtime/bin/mentu-recipes`
//! (or `DROGON_MENTU_RUNTIME` to override the exact executable path, the
//! test/dev seam), verified against the lock copied from
//! `.mentu/mentu-runtime-lock.json` in the read-only reference. A missing or
//! mismatched runtime fails closed: `mentu.run`/`mentu.retry` never fall
//! back to a workspace binary or a PATH lookup.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use drogon_protocol::mentu::MentuRuntimeInfo;
use sha2::{Digest, Sha256};

/// Copied from the read-only reference's `.mentu/mentu-runtime-lock.json`
/// (revision `b72a1203d46c1d930be1aead65388ddfbe9a8fc4`, mentu-recipes
/// 0.4.0, darwin-arm64). This crate never re-derives these values from the
/// reference at build time; the pinned runtime binary itself is provisioned
/// into a Drogon data directory out of band (see the PR for the exact
/// command).
pub const MENTU_LOCK_REVISION: &str = "b72a1203d46c1d930be1aead65388ddfbe9a8fc4";
pub const MENTU_LOCK_VERSION: &str = "0.4.0";
pub const MENTU_LOCK_SHA256: &str =
    "124ef7391cf060051f45307c88bb10509f5fd9e7d7a10e66516b3bdaf14aa504";

const RUNTIME_ENV_OVERRIDE: &str = "DROGON_MENTU_RUNTIME";

/// Test-only seam, mirroring `tasks_rpc::set_gh_bin_override`: integration
/// tests exercise the real fail-closed lock check against a fixture
/// `mentu-recipes` script (whose sha256 can never equal the real pinned
/// runtime's), by pointing the expected hash at the fixture's own bytes
/// instead. Production code never calls this; the default is always
/// [`MENTU_LOCK_SHA256`].
static EXPECTED_SHA256_OVERRIDE: Mutex<Option<String>> = Mutex::new(None);

pub fn set_expected_sha256_override(value: Option<String>) {
    *EXPECTED_SHA256_OVERRIDE.lock().unwrap() = value;
}

fn expected_sha256() -> String {
    EXPECTED_SHA256_OVERRIDE
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| MENTU_LOCK_SHA256.to_string())
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "mentu-recipes.exe"
    } else {
        "mentu-recipes"
    }
}

/// The runtime executable this process will invoke: `DROGON_MENTU_RUNTIME`
/// if set, else the fixed path under `data_dir`. Resolution never touches
/// `PATH` or a workspace-local binary.
pub fn resolve_runtime_path(data_dir: &Path) -> PathBuf {
    if let Ok(overridden) = std::env::var(RUNTIME_ENV_OVERRIDE) {
        return PathBuf::from(overridden);
    }
    data_dir
        .join("mentu")
        .join("runtime")
        .join("bin")
        .join(executable_name())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn probe_version(path: &Path) -> Option<String> {
    let output = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().next().map(|line| line.trim().to_string())
}

/// Availability, identity and lock verification for the current process's
/// resolved runtime. Never panics on a missing file: absence is reported as
/// `available: false`, the same as a hash mismatch — both are ordinary,
/// expected states for a data directory that has not been provisioned yet.
pub fn runtime_info(data_dir: &Path) -> MentuRuntimeInfo {
    let path = resolve_runtime_path(data_dir);
    let expected = expected_sha256();
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) => {
            return MentuRuntimeInfo {
                available: false,
                path: Some(path.to_string_lossy().into_owned()),
                version: None,
                expected_revision: MENTU_LOCK_REVISION.to_string(),
                expected_sha256: expected,
                actual_sha256: None,
                lock_matches: false,
                message: Some(format!("Mentu runtime is not available: {e}")),
            };
        }
    };
    let actual_sha256 = sha256_hex(&bytes);
    let lock_matches = actual_sha256 == expected;
    MentuRuntimeInfo {
        available: lock_matches,
        path: Some(path.to_string_lossy().into_owned()),
        version: probe_version(&path),
        expected_revision: MENTU_LOCK_REVISION.to_string(),
        expected_sha256: expected,
        actual_sha256: Some(actual_sha256),
        lock_matches,
        message: if lock_matches {
            None
        } else {
            Some("The runtime binary does not match the approved Mentu runtime lock.".to_string())
        },
    }
}

/// Fail-closed gate used by every RPC that would spawn the runtime: returns
/// the verified executable path, or an error describing why it refuses.
pub fn require_verified_runtime(data_dir: &Path) -> Result<PathBuf, drogon_protocol::RpcError> {
    let info = runtime_info(data_dir);
    if !info.available {
        return Err(drogon_protocol::RpcError::new(
            "mentu_runtime_unavailable",
            info.message
                .unwrap_or_else(|| "Mentu runtime is unavailable.".to_string()),
        ));
    }
    Ok(PathBuf::from(
        info.path.expect("available runtime has a path"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Mutex;

    /// `DROGON_MENTU_RUNTIME` is process-wide; serialize every test that
    /// touches it so parallel test threads never race each other's
    /// set_var/remove_var.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn env_override_takes_precedence_over_the_data_dir_layout() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let data_dir = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var(RUNTIME_ENV_OVERRIDE, "/tmp/fixture-mentu-recipes") };
        let resolved = resolve_runtime_path(data_dir.path());
        unsafe { std::env::remove_var(RUNTIME_ENV_OVERRIDE) };
        assert_eq!(resolved, PathBuf::from("/tmp/fixture-mentu-recipes"));
    }

    #[test]
    fn missing_runtime_is_unavailable_not_a_panic() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let data_dir = tempfile::tempdir().unwrap();
        unsafe { std::env::remove_var(RUNTIME_ENV_OVERRIDE) };
        let info = runtime_info(data_dir.path());
        assert!(!info.available);
        assert!(!info.lock_matches);
        assert!(info.message.is_some());
    }

    #[test]
    fn mismatched_sha256_is_reported_but_never_trusted() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let data_dir = tempfile::tempdir().unwrap();
        let bin_dir = data_dir.path().join("mentu").join("runtime").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let bin_path = bin_dir.join(executable_name());
        let mut file = fs::File::create(&bin_path).unwrap();
        file.write_all(b"not the real binary").unwrap();
        drop(file);
        unsafe { std::env::remove_var(RUNTIME_ENV_OVERRIDE) };
        let info = runtime_info(data_dir.path());
        assert!(!info.available);
        assert!(!info.lock_matches);
        assert_eq!(info.expected_sha256, MENTU_LOCK_SHA256);
        assert!(require_verified_runtime(data_dir.path()).is_err());
    }
}
