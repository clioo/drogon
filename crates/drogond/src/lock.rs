//! Exclusive, whole-data-directory ownership. Two probe-then-act steps
//! (endpoint hard-link/rename, token rotation, `Engine::open`'s crash-
//! recovery sweep) are each individually racy against a second `drogond`
//! starting concurrently against the same directory. An OS advisory lock,
//! held for this process's entire lifetime, removes the race instead of
//! narrowing it: a second starter blocks on nothing and fails immediately.
#![cfg(unix)]

use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::io::AsRawFd;
use std::path::Path;

pub const LOCK_FILE_NAME: &str = ".drogond.lock";

/// Held for as long as this value is alive; dropping it (process exit
/// included) releases the lock. Never remove the lock file itself — only
/// the flock state matters, and unlinking it would let a third process race
/// a create+lock against a path we still hold open.
pub struct DataDirLock {
    _file: File,
}

pub fn acquire_exclusive(data_dir: &Path) -> io::Result<DataDirLock> {
    let path = data_dir.join(LOCK_FILE_NAME);
    use std::os::unix::fs::OpenOptionsExt;
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    // SAFETY: `file`'s fd is valid for the duration of this call and the
    // lock is released only when `file` is dropped or the process exits.
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc != 0 {
        return Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            format!(
                "another drogond instance already holds the exclusive lock on this data directory: {}",
                io::Error::last_os_error()
            ),
        ));
    }
    Ok(DataDirLock { _file: file })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_lock_attempt_is_refused_while_the_first_is_held() {
        let dir = tempfile::tempdir().unwrap();
        let first = acquire_exclusive(dir.path()).unwrap();
        let second = acquire_exclusive(dir.path());
        assert!(second.is_err());
        drop(first);
        assert!(acquire_exclusive(dir.path()).is_ok());
    }

    #[test]
    fn a_symlinked_lock_cannot_modify_its_target() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("unrelated");
        std::fs::write(&target, "preserve").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o644)).unwrap();
        symlink(&target, dir.path().join(LOCK_FILE_NAME)).unwrap();
        assert!(acquire_exclusive(dir.path()).is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "preserve");
        assert_eq!(
            std::fs::metadata(target).unwrap().permissions().mode() & 0o777,
            0o644
        );
    }
}
