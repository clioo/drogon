//! Where the daemon's own log lines go once it is serving.
//!
//! The desktop spawns `drogond` detached with its stderr on a pipe it reads
//! only to classify a startup refusal. The daemon outlives that desktop on
//! purpose (a relaunch attaches to the running service), and once the reader
//! is gone every write to that pipe fails with `EPIPE`. Rust's `eprintln!`
//! panics on a failed write, so the first background tick that had anything
//! to log unwound its thread: the automation scheduler died silently, and
//! every monitor, delegation and heartbeat with it (observed 2026-09-14 on
//! the maintainer's machine — `schedulerLastTickMs` frozen for hours after a
//! desktop relaunch).
//!
//! Two structural fixes live here. Once the engine is open, stderr is pointed
//! at an append-only log file under the data directory, so diagnostics
//! survive the spawner and a reader that goes away can never take a thread
//! with it. And [`log_line`] writes a diagnostic without ever panicking, for
//! the loops whose death would be silent. Startup refusals (schema too new,
//! unsafe data dir) still reach the original stderr because they happen
//! before the redirect — the desktop classifies them from that pipe.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The log file, relative to the data directory.
pub const LOG_DIR: &str = "logs";
pub const LOG_FILE_NAME: &str = "drogond.log";

/// A log past this size is rotated to `drogond.log.1` at startup — one
/// generation is kept, so the file never grows without bound and the previous
/// service life is still readable after a restart.
pub const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;

pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_DIR).join(LOG_FILE_NAME)
}

/// Writes one diagnostic line to stderr and swallows a failed write. Use it
/// from any thread whose panic would end a background loop: `eprintln!`
/// panics when stderr is a pipe nobody reads any more.
pub fn log_line(args: std::fmt::Arguments<'_>) {
    let stderr = io::stderr();
    let mut handle = stderr.lock();
    let _ = handle.write_fmt(args);
    let _ = handle.write_all(b"\n");
    let _ = handle.flush();
}

/// Opens the log for appending, rotating it first when it is over `max_bytes`.
/// The file is private to the user (0600) like the rest of the data directory.
pub fn open_log_file(path: &Path, max_bytes: u64) -> io::Result<File> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if let Ok(metadata) = std::fs::metadata(path)
        && metadata.len() > max_bytes
    {
        let rotated = path.with_extension("log.1");
        std::fs::rename(path, rotated)?;
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

/// Points this process's stderr (fd 2) at the data directory's log file and
/// returns that path. The original stderr is closed for this process; nothing
/// written afterwards can fail because a reader went away.
#[cfg(unix)]
pub fn redirect_stderr_to_log(data_dir: &Path) -> io::Result<PathBuf> {
    use std::os::unix::io::AsRawFd;
    let path = log_path(data_dir);
    let file = open_log_file(&path, MAX_LOG_BYTES)?;
    // SAFETY: `dup2` on two valid descriptors owned by this process; fd 2 is
    // atomically replaced and `file`'s own descriptor stays valid until it is
    // dropped below, which does not affect the duplicate.
    let replaced = unsafe { libc::dup2(file.as_raw_fd(), 2) };
    if replaced == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(path)
}

/// Windows keeps its console/pipe stderr: the desktop there does not spawn a
/// detached daemon whose reader disappears, and `SetStdHandle` plumbing is
/// not worth carrying for a path no build exercises.
#[cfg(not(unix))]
pub fn redirect_stderr_to_log(_data_dir: &Path) -> io::Result<PathBuf> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "stderr redirection is only implemented on Unix",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_lives_under_the_data_directory() {
        assert_eq!(
            log_path(Path::new("/data")),
            PathBuf::from("/data/logs/drogond.log")
        );
    }

    #[test]
    fn opening_the_log_creates_its_directory_and_appends() {
        let dir = tempfile::tempdir().unwrap();
        let path = log_path(dir.path());
        {
            let mut file = open_log_file(&path, MAX_LOG_BYTES).unwrap();
            writeln!(file, "first life").unwrap();
        }
        {
            let mut file = open_log_file(&path, MAX_LOG_BYTES).unwrap();
            writeln!(file, "second life").unwrap();
        }
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text, "first life\nsecond life\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "the log is private to the user");
        }
    }

    #[test]
    fn an_oversized_log_is_rotated_once_and_the_previous_life_kept() {
        let dir = tempfile::tempdir().unwrap();
        let path = log_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "x".repeat(64)).unwrap();
        {
            let mut file = open_log_file(&path, 32).unwrap();
            writeln!(file, "fresh").unwrap();
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "fresh\n");
        let rotated = path.with_extension("log.1");
        assert_eq!(std::fs::read_to_string(&rotated).unwrap(), "x".repeat(64));
        // A second rotation replaces the previous generation, never stacks.
        std::fs::write(&path, "y".repeat(64)).unwrap();
        open_log_file(&path, 32).unwrap();
        assert_eq!(std::fs::read_to_string(&rotated).unwrap(), "y".repeat(64));
    }

    #[test]
    fn log_line_never_panics_on_a_closed_stderr() {
        // Runs the writer against the process stderr as it is; the point of
        // the function is that it cannot unwind, which the type system
        // cannot express — a write to a dead pipe is exercised end to end
        // by the daemon's own integration test.
        log_line(format_args!("diagnostics self-test {}", 1));
    }
}
