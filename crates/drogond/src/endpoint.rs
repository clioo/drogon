//! Unix-socket endpoint ownership. Ports the invariants documented in the
//! prior implementation's `daemon/AGENTS.md` (see `inventory-core.md` §1.2):
//! bind a private scratch name, hard-link it onto the canonical path, and
//! only replace an incumbent this process has itself proven dead by
//! connecting to it. Never `unlink`-then-`link`. Never treat an ambiguous
//! probe as death. No sweeper — a departing daemon leaves its name in place.
//!
//! Windows named pipes are a different mechanism entirely and are not
//! implemented here; see `unsupported_platform` in `main.rs`. This module is
//! `cfg(unix)`-only so it never silently compiles a false promise for
//! Windows.
#![cfg(unix)]

use std::io;
use std::os::unix::fs::FileTypeExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SOCKET_FILE_NAME: &str = "runtime-v1.sock";

enum Liveness {
    Live,
    Dead,
    Unknown,
}

/// Refuses to treat a symlink or a non-socket file at the canonical path as
/// an incumbent to probe at all — connecting to (or worse, later renaming
/// over) a planted regular file or a symlink pointing outside the data
/// directory is never safe, regardless of what `connect` would report.
fn reject_unsafe_incumbent(canonical: &Path) -> io::Result<()> {
    let meta = match std::fs::symlink_metadata(canonical) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let file_type = meta.file_type();
    if file_type.is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing a symlink at the canonical socket path",
        ));
    }
    if !file_type.is_socket() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing a non-socket file at the canonical socket path",
        ));
    }
    Ok(())
}

fn probe(canonical: &Path) -> Liveness {
    match UnixStream::connect(canonical) {
        Ok(_stream) => Liveness::Live,
        Err(e) => match e.kind() {
            io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound => Liveness::Dead,
            // Why: permission errors, "would block" and anything else are
            // not evidence of death. Collapsing "can't tell" into "dead" is
            // the exact defect class the source design fixed after 23
            // documented incidents (`inventory-core.md` §1.2).
            _ => Liveness::Unknown,
        },
    }
}

fn scratch_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(".p{:x}{:x}", std::process::id(), nanos)
}

/// Binds this process onto the data directory's canonical socket path,
/// refusing if a live (or unprovably-dead) incumbent already holds it.
pub fn establish(data_dir: &Path) -> io::Result<UnixListener> {
    let canonical = data_dir.join(SOCKET_FILE_NAME);
    reject_unsafe_incumbent(&canonical)?;
    let scratch: PathBuf = data_dir.join(scratch_name());
    let _ = std::fs::remove_file(&scratch);
    let listener = UnixListener::bind(&scratch)?;
    // Why here and not after linking: the scratch and canonical names share
    // one inode once linked, so setting the mode once, before the link,
    // covers both — `protocol-v1.md` requires the socket be restricted to
    // the owning user, matching the data directory (0700) and token (0600).
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&scratch, std::fs::Permissions::from_mode(0o600))?;
    }

    match std::fs::hard_link(&scratch, &canonical) {
        Ok(()) => {
            // The canonical name now has its own directory entry pointing
            // at the same listening socket; the scratch name is no longer
            // needed. This never touches a name we did not just create.
            let _ = std::fs::remove_file(&scratch);
            Ok(listener)
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            let refuse = |listener: UnixListener| -> io::Result<UnixListener> {
                let _ = std::fs::remove_file(&scratch);
                drop(listener);
                Err(io::Error::new(
                    io::ErrorKind::AddrInUse,
                    "a live (or unprovably dead) drogond already owns this data directory",
                ))
            };
            match probe(&canonical) {
                Liveness::Live | Liveness::Unknown => refuse(listener),
                Liveness::Dead => {
                    // Probe once more immediately before acting, matching
                    // the source protocol's re-check step — ownership may
                    // have changed hands between the first probe and here.
                    match probe(&canonical) {
                        Liveness::Dead => {
                            std::fs::rename(&scratch, &canonical)?;
                            Ok(listener)
                        }
                        _ => refuse(listener),
                    }
                }
            }
        }
        Err(e) => {
            let _ = std::fs::remove_file(&scratch);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_process_owns_a_fresh_directory() {
        let dir = tempfile::tempdir().unwrap();
        let listener = establish(dir.path()).unwrap();
        assert!(dir.path().join(SOCKET_FILE_NAME).exists());
        drop(listener);
    }

    #[test]
    fn a_live_incumbent_refuses_a_second_owner() {
        let dir = tempfile::tempdir().unwrap();
        let first = establish(dir.path()).unwrap();
        let second = establish(dir.path());
        assert!(
            second.is_err(),
            "must refuse while the first listener is alive"
        );
        drop(first);
    }

    #[test]
    fn a_dead_incumbents_name_is_reclaimed() {
        let dir = tempfile::tempdir().unwrap();
        let first = establish(dir.path()).unwrap();
        drop(first); // socket file remains on disk with no listener behind it
        let second = establish(dir.path());
        assert!(
            second.is_ok(),
            "a provably dead incumbent's name must be reclaimable"
        );
    }
}
