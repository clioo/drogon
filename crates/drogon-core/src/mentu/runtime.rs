//! Resolution and verification of the pinned `mentu-recipes` runtime.
//! MIT Copyright (c) 2026 Lovecast Inc.
//! Mirrors the fork's `mentu-runtime-identity.ts`, narrowed to this
//! product's own simpler layout: `<data-dir>/mentu/runtime/bin/mentu-recipes`
//! (or `DROGON_MENTU_RUNTIME` to override the exact executable path, the
//! test/dev seam), verified against the official mentu-ai release. A missing or
//! mismatched runtime fails closed: `mentu.run`/`mentu.retry` never fall
//! back to a workspace binary or a PATH lookup.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use drogon_protocol::mentu::MentuRuntimeInfo;
use sha2::{Digest, Sha256};

/// Official mentu-ai/mentu-recipes v0.5.0, macos-arm64 release and checksum.
/// Packaging downloads and verifies these exact bytes; the desktop installs
/// its bundled copy through `mentu.runtime_install`, without PATH or network.
pub const MENTU_LOCK_REVISION: &str = "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3";
pub const MENTU_LOCK_VERSION: &str = "0.5.0";
pub const MENTU_LOCK_SHA256: &str =
    "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d";

const RUNTIME_ENV_OVERRIDE: &str = "DROGON_MENTU_RUNTIME";

/// Ported verbatim from the read-only reference's own fallback copy for this
/// state (`src/renderer/src/components/mentu/recipe-pane-controller.ts`'s
/// `capabilityResult.message ?? 'Mentu Recipes is unavailable on the
/// execution host.'`, mirrored in this repo's own
/// `recipe-pane-controller.ts`). The daemon must never format the raw I/O
/// error into this user-facing string (issue #149): it goes to stderr only.
const MENTU_RUNTIME_UNAVAILABLE_MESSAGE: &str =
    "Mentu Recipes is unavailable on the execution host.";

/// Ported verbatim from the read-only reference's
/// `mentu-runtime-identity.ts`'s sha256-mismatch message.
const MENTU_RUNTIME_MISMATCH_MESSAGE: &str =
    "The application-owned Mentu runtime does not match the approved runtime lock.";

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

/// Serializes every test in this crate that touches the process-wide
/// [`EXPECTED_SHA256_OVERRIDE`] — this module's own tests and
/// `runtime_install`'s — so parallel test threads in the same `cargo test`
/// binary never race each other's override. A second, module-local lock
/// would not actually exclude anything: both modules must share this one.
#[cfg(test)]
pub(crate) static SHA256_OVERRIDE_TEST_LOCK: Mutex<()> = Mutex::new(());

/// `pub(crate)`, not `pub`: `runtime_install` (same install/verify seam)
/// reads this to check a candidate source before activating it; nothing
/// outside the crate needs the raw expected digest without the rest of
/// [`runtime_info`]'s context.
pub(crate) fn expected_sha256() -> String {
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
            // The raw OS error (e.g. "No such file or directory (os error
            // 2)") is a daemon-operator detail, never a renderer string
            // (issue #149): it goes to stderr, the user-facing `message`
            // stays the fixed fork copy above.
            eprintln!("[mentu] runtime unavailable at {}: {e}", path.display());
            return MentuRuntimeInfo {
                available: false,
                path: Some(path.to_string_lossy().into_owned()),
                version: None,
                expected_revision: MENTU_LOCK_REVISION.to_string(),
                expected_sha256: expected,
                actual_sha256: None,
                lock_matches: false,
                message: Some(MENTU_RUNTIME_UNAVAILABLE_MESSAGE.to_string()),
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
            Some(MENTU_RUNTIME_MISMATCH_MESSAGE.to_string())
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
        // Regression for #149: the raw OS error (e.g. "os error 2") must
        // never reach this user-facing message, only the fixed fork copy.
        let message = info.message.unwrap();
        assert_eq!(message, MENTU_RUNTIME_UNAVAILABLE_MESSAGE);
        assert!(!message.to_lowercase().contains("os error"));
    }

    #[test]
    fn mismatched_sha256_is_reported_but_never_trusted() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // This test relies on no override being set (the default
        // `MENTU_LOCK_SHA256`); it must exclude `runtime_install`'s tests,
        // which set one, not just this module's own env-var lock.
        let _sha_guard = SHA256_OVERRIDE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
        assert_eq!(info.message.unwrap(), MENTU_RUNTIME_MISMATCH_MESSAGE);
        assert!(require_verified_runtime(data_dir.path()).is_err());
    }
}
