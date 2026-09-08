//! Exclusive, whole-data-directory ownership. Two probe-then-act steps
//! (endpoint hard-link/rename, token rotation, `Engine::open`'s crash-
//! recovery sweep) are each individually racy against a second `drogond`
//! starting concurrently against the same directory. An OS advisory lock,
//! held for this process's entire lifetime, removes the race instead of
//! narrowing it: a second starter blocks on nothing and fails immediately.
//!
//! Unix (`flock(2)`, below) and Windows (`LockFileEx`, under
//! `cfg(windows)`) get independent implementations, same as `endpoint.rs`'s
//! two transports: the two platforms' exclusive-lock primitives have
//! different failure shapes and neither maps cleanly onto the other.

pub const LOCK_FILE_NAME: &str = ".drogond.lock";

/// A replacement can be launched as soon as the old daemon has admitted
/// `runtime.shutdown`, but that reply is sent before the serving thread has
/// drained connections and dropped its process-lifetime data-dir lock. Keep
/// the normal probe immediate while giving a startup a bounded handoff window
/// for that owned lock to be released.
pub const STARTUP_LOCK_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(unix)]
mod unix {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::unix::io::AsRawFd;
    use std::path::Path;

    use super::LOCK_FILE_NAME;

    /// Held for as long as this value is alive; dropping it (process exit
    /// included) releases the lock. Never remove the lock file itself —
    /// only the flock state matters, and unlinking it would let a third
    /// process race a create+lock against a path we still hold open.
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

    /// Acquire the process-lifetime lock, waiting only for a bounded startup
    /// handoff when the incumbent is already winding down. The immediate
    /// `acquire_exclusive` remains available for callers that need a pure
    /// probe; this path is used by the real daemon startup.
    pub fn acquire_exclusive_with_wait(
        data_dir: &Path,
        max_wait: std::time::Duration,
    ) -> io::Result<DataDirLock> {
        let deadline = std::time::Instant::now() + max_wait;
        loop {
            match acquire_exclusive(data_dir) {
                Ok(lock) => return Ok(lock),
                Err(error)
                    if error.kind() == io::ErrorKind::AddrInUse
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => return Err(error),
            }
        }
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
        fn startup_wait_retries_until_the_prior_owner_releases() {
            let dir = tempfile::tempdir().unwrap();
            let first = acquire_exclusive(dir.path()).unwrap();
            let path = dir.path().to_path_buf();
            let waiter = std::thread::spawn(move || {
                acquire_exclusive_with_wait(&path, std::time::Duration::from_secs(1)).is_ok()
            });
            std::thread::sleep(std::time::Duration::from_millis(25));
            drop(first);
            assert!(waiter.join().unwrap());
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
}

#[cfg(unix)]
pub use unix::{DataDirLock, acquire_exclusive, acquire_exclusive_with_wait};

// Windows uses the OS file lock; data-file ACLs are inherited from the parent.
#[cfg(windows)]
mod windows {
    use std::fs::OpenOptions;
    use std::io;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, LockFileEx,
    };
    use windows_sys::Win32::System::IO::OVERLAPPED;

    use super::LOCK_FILE_NAME;

    /// Held for as long as this value is alive; dropping it (process exit
    /// included) closes the handle, which releases the lock — Windows
    /// releases a `LockFileEx` lock automatically when the last handle to
    /// the file closes, so no explicit `UnlockFileEx` call is needed on the
    /// normal drop path. Never remove the lock file itself, matching the
    /// Unix side's rationale.
    pub struct DataDirLock {
        _file: std::fs::File,
    }

    pub fn acquire_exclusive(data_dir: &Path) -> io::Result<DataDirLock> {
        let path = data_dir.join(LOCK_FILE_NAME);
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)?;
        let handle = file.as_raw_handle() as HANDLE;
        // Safety: `handle` is open for the duration of this call;
        // `overlapped` is required by `LockFileEx`'s signature even for a
        // whole-file lock on a synchronously-opened handle, and a
        // zero-initialized one (offset 0) is the documented way to express
        // "lock from the start" without asynchronous completion —
        // `LOCKFILE_FAIL_IMMEDIATELY` means this call never actually goes
        // pending, so there is no overlapped-completion dance to drive here
        // (unlike `endpoint.rs`'s named-pipe I/O).
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            LockFileEx(
                handle,
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        };
        if ok == 0 {
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

    pub fn acquire_exclusive_with_wait(
        data_dir: &Path,
        max_wait: std::time::Duration,
    ) -> io::Result<DataDirLock> {
        let deadline = std::time::Instant::now() + max_wait;
        loop {
            match acquire_exclusive(data_dir) {
                Ok(lock) => return Ok(lock),
                Err(error)
                    if error.kind() == io::ErrorKind::AddrInUse
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(error) => return Err(error),
            }
        }
    }
}

#[cfg(windows)]
pub use windows::{DataDirLock, acquire_exclusive, acquire_exclusive_with_wait};
