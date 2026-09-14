//! Local, no-network provisioning of the pinned `mentu-recipes` runtime
//! (journey J9 fresh-install usability). MIT Copyright (c) 2026 Lovecast
//! Inc. Mirrors the read-only reference's
//! build-time provisioning script
//! (`config/scripts/mentu-runtime-package.cjs`'s `provisionMentuRuntime`):
//! given a candidate binary already on disk, verify its sha256 against the
//! lock and, only on a match, atomically copy it into the fixed runtime
//! path. This module never fetches, clones or builds anything itself and
//! never touches `PATH` or Homebrew — the caller (this repo's explicit
//! provisioning helper or the user-initiated desktop Settings installer) is
//! responsible for how `source_path` came to exist locally.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{MentuRuntimeInstallResult, MentuRuntimeInstallStatus};
use sha2::{Digest, Sha256};

use super::runtime;

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

/// Verifies `source_path` against the pinned lock sha256 (or the test
/// seam's override — same one `runtime::runtime_info` honors) and, only if
/// it matches, atomically activates it at the fixed runtime path for
/// `data_dir`. A destination already holding those exact verified bytes is
/// left untouched (`already_installed`), so calling this repeatedly with
/// the same source is a no-op past the first call. Never partially writes
/// the destination: the candidate is staged in a sibling temp file and
/// `rename`d into place, so a reader (`runtime::runtime_info`,
/// `require_verified_runtime`) never observes a half-written binary.
pub fn install_runtime(
    data_dir: &Path,
    source_path: &Path,
) -> Result<MentuRuntimeInstallResult, RpcError> {
    let source_metadata = fs::symlink_metadata(source_path).map_err(|e| {
        RpcError::new(
            "mentu_runtime_source_unreadable",
            format!("Cannot read the provided runtime source: {e}"),
        )
    })?;
    if !source_metadata.file_type().is_file() {
        return Err(RpcError::new(
            "mentu_runtime_source_unreadable",
            "The provided runtime source must be a regular file.",
        ));
    }
    let source_bytes = fs::read(source_path).map_err(|e| {
        RpcError::new(
            "mentu_runtime_source_unreadable",
            format!("Cannot read the provided runtime source: {e}"),
        )
    })?;
    let actual = sha256_hex(&source_bytes);
    let expected = runtime::expected_sha256();
    if actual != expected {
        return Err(RpcError::new(
            "mentu_runtime_lock_mismatch",
            "The provided runtime does not match the approved Mentu runtime lock.",
        ));
    }

    let destination = runtime::resolve_runtime_path(data_dir);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| RpcError::new("io_error", format!("cannot create runtime dir: {e}")))?;
    }

    // Do not follow a destination symlink when deciding that the runtime is
    // already installed. `activate` must replace it with the verified bytes.
    let already_installed = fs::symlink_metadata(&destination)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
        && fs::read(&destination)
            .map(|existing| existing == source_bytes)
            .unwrap_or(false);
    if !already_installed {
        activate(&destination, &source_bytes)?;
    }

    Ok(MentuRuntimeInstallResult {
        runtime: runtime::runtime_info(data_dir),
        status: if already_installed {
            MentuRuntimeInstallStatus::AlreadyInstalled
        } else {
            MentuRuntimeInstallStatus::Installed
        },
    })
}

fn activate(destination: &Path, bytes: &[u8]) -> Result<(), RpcError> {
    let file_name = destination
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let temp_id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
    let temp =
        destination.with_file_name(format!("{file_name}.tmp-{}-{temp_id}", std::process::id()));
    let staged = fs::write(&temp, bytes)
        .map_err(|e| RpcError::new("io_error", format!("cannot stage runtime: {e}")))
        .and_then(|()| make_executable(&temp));
    if let Err(e) = staged {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    if let Err(e) = fs::rename(&temp, destination) {
        let _ = fs::remove_file(&temp);
        return Err(RpcError::new(
            "io_error",
            format!("cannot activate runtime: {e}"),
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), RpcError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
        .map_err(|e| RpcError::new("io_error", format!("cannot make runtime executable: {e}")))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), RpcError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    struct Override {
        // Shares `runtime`'s own test lock, not a second module-local one:
        // both modules' tests mutate the same process-wide
        // `EXPECTED_SHA256_OVERRIDE`, and only one shared lock actually
        // serializes that across parallel test threads.
        _lock: MutexGuard<'static, ()>,
    }

    impl Override {
        fn set(sha256: &str) -> Self {
            let lock = runtime::SHA256_OVERRIDE_TEST_LOCK
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            runtime::set_expected_sha256_override(Some(sha256.to_string()));
            Self { _lock: lock }
        }
    }

    impl Drop for Override {
        fn drop(&mut self) {
            runtime::set_expected_sha256_override(None);
        }
    }

    fn write_source(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn installs_a_matching_source_and_is_idempotent_on_replay() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let bytes = b"#!/bin/sh\necho fixture\n";
        let expected = sha256_hex(bytes);
        let _override = Override::set(&expected);
        let source = write_source(root.path(), "source-bin", bytes);

        let first = install_runtime(&data_dir, &source).unwrap();
        assert_eq!(first.status, MentuRuntimeInstallStatus::Installed);
        assert!(first.runtime.available);
        assert!(first.runtime.lock_matches);
        let destination = runtime::resolve_runtime_path(&data_dir);
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&destination).unwrap().permissions().mode();
            assert_ne!(mode & 0o111, 0, "installed runtime must be executable");
        }

        // A second call with the identical source is a no-op past the copy:
        // reported as already-installed, and no leftover temp files remain
        // in the bin directory.
        let second = install_runtime(&data_dir, &source).unwrap();
        assert_eq!(second.status, MentuRuntimeInstallStatus::AlreadyInstalled);
        let bin_dir = destination.parent().unwrap();
        let leftovers: Vec<_> = fs::read_dir(bin_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
    }

    #[test]
    fn refuses_a_mismatched_source_and_writes_nothing() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let _override = Override::set(&"f".repeat(64));
        let source = write_source(root.path(), "source-bin", b"not the approved bytes");

        let err = install_runtime(&data_dir, &source).unwrap_err();
        assert_eq!(err.code, "mentu_runtime_lock_mismatch");
        let destination = runtime::resolve_runtime_path(&data_dir);
        assert!(
            fs::metadata(&destination).is_err(),
            "a rejected source must never be written to the runtime path"
        );
    }

    #[test]
    fn replaces_a_stale_destination_that_no_longer_matches_the_lock() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let good_bytes = b"#!/bin/sh\necho good\n";
        let expected = sha256_hex(good_bytes);
        let _override = Override::set(&expected);

        let destination = runtime::resolve_runtime_path(&data_dir);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(&destination, b"stale bytes from a prior lock").unwrap();

        let source = write_source(root.path(), "source-bin", good_bytes);
        let result = install_runtime(&data_dir, &source).unwrap();
        assert_eq!(result.status, MentuRuntimeInstallStatus::Installed);
        assert_eq!(fs::read(&destination).unwrap(), good_bytes);
    }

    #[test]
    fn reports_an_unreadable_source_honestly() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let _override = Override::set(&"f".repeat(64));
        let missing = root.path().join("does-not-exist");

        let err = install_runtime(&data_dir, &missing).unwrap_err();
        assert_eq!(err.code, "mentu_runtime_source_unreadable");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_source_without_following_it() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let bytes = b"#!/bin/sh\necho fixture\n";
        let _override = Override::set(&sha256_hex(bytes));
        let real = write_source(root.path(), "real-source", bytes);
        let link = root.path().join("source-link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let err = install_runtime(&data_dir, &link).unwrap_err();

        assert_eq!(err.code, "mentu_runtime_source_unreadable");
        assert!(!runtime::resolve_runtime_path(&data_dir).exists());
    }

    #[cfg(unix)]
    #[test]
    fn replaces_a_destination_symlink_instead_of_trusting_its_target() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let bytes = b"#!/bin/sh\necho approved\n";
        let _override = Override::set(&sha256_hex(bytes));
        let destination = runtime::resolve_runtime_path(&data_dir);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        let outside = root.path().join("outside");
        fs::write(&outside, bytes).unwrap();
        std::os::unix::fs::symlink(&outside, &destination).unwrap();
        let source = write_source(root.path(), "source-bin", bytes);

        let result = install_runtime(&data_dir, &source).unwrap();

        assert_eq!(result.status, MentuRuntimeInstallStatus::Installed);
        assert!(
            fs::symlink_metadata(&destination)
                .unwrap()
                .file_type()
                .is_file()
        );
        assert_eq!(fs::read(&destination).unwrap(), bytes);
        assert_eq!(fs::read(&outside).unwrap(), bytes);
    }
}
