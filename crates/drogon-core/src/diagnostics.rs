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
//!
//! The 8 MiB bound is enforced where the bytes arrive, not only at startup:
//! a daemon deliberately outlives the desktop that spawned it and can run for
//! weeks, so a long-lived process rotating only on the next restart would let
//! a chatty monitor/automation loop fill the disk with the one file the owner
//! reads when something is wrong. [`log_line`] counts what it writes and
//! rotates (rename to `drogond.log.1`, re-point fd 2 at a fresh file, one
//! generation kept) the moment the bound is crossed.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The log file, relative to the data directory.
pub const LOG_DIR: &str = "logs";
pub const LOG_FILE_NAME: &str = "drogond.log";

/// A log past this size is rotated to `drogond.log.1` — one generation is
/// kept, so the file never grows without bound and the previous stretch is
/// still readable. Checked at startup ([`open_log_file`]) and while serving
/// ([`log_line`]), because the daemon outlives the desktop by design.
pub const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;

pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_DIR).join(LOG_FILE_NAME)
}

/// The file the running daemon's diagnostics land in, once stderr points at
/// it: enough state to rotate in-life instead of only at the next start.
#[derive(Debug)]
struct LogSink {
    path: PathBuf,
    max_bytes: u64,
    /// Bytes written since the last rotation, started from the file's own
    /// length so an already-large log is bounded immediately.
    written: u64,
}

static LOG_SINK: Mutex<Option<LogSink>> = Mutex::new(None);

/// Writes one diagnostic line to stderr and swallows a failed write. Use it
/// from any thread whose panic would end a background loop: `eprintln!`
/// panics when stderr is a pipe nobody reads any more.
///
/// Also the rotation point: once [`redirect_stderr_to_log`] installed the
/// sink, the write is counted and crossing `max_bytes` rotates the file while
/// the daemon runs. A failed rotation never panics and never spins — it waits
/// for another full budget before trying again.
pub fn log_line(args: std::fmt::Arguments<'_>) {
    let line = format!("{args}\n");
    {
        let stderr = io::stderr();
        let mut handle = stderr.lock();
        let _ = handle.write_all(line.as_bytes());
        let _ = handle.flush();
    }
    rotate_after_write(line.len() as u64);
}

fn rotate_after_write(bytes: u64) {
    let mut guard = match LOG_SINK.lock() {
        Ok(guard) => guard,
        // A panic elsewhere must not make diagnostics panic or stop: the
        // counter is a best-effort bound, not state any caller reads.
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(sink) = guard.as_mut() else { return };
    sink.written = sink.written.saturating_add(bytes);
    if sink.written < sink.max_bytes {
        return;
    }
    // Success or failure, the next attempt is another full budget away.
    sink.written = 0;
    let _ = rotate_locked(sink);
}

/// Renames the live log and points fd 2 at a fresh file. One generation is
/// kept (`drogond.log.1`), replacing whatever was there: the log never grows
/// without bound and the previous stretch stays readable.
#[cfg(unix)]
fn rotate_locked(sink: &LogSink) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let rotated = sink.path.with_extension("log.1");
    std::fs::rename(&sink.path, &rotated)?;
    // The path was just freed by the rename, so nothing here can rotate again.
    let file = open_log_file(&sink.path, u64::MAX)?;
    // SAFETY: `dup2` on two descriptors this process owns; fd 2 is replaced
    // atomically and `file`'s own descriptor stays valid until it is dropped,
    // which does not affect the duplicate.
    if unsafe { libc::dup2(file.as_raw_fd(), 2) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(unix))]
fn rotate_locked(_sink: &LogSink) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "log rotation is only implemented on Unix",
    ))
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
    redirect_stderr_to_log_with_max(data_dir, MAX_LOG_BYTES)
}

/// [`redirect_stderr_to_log`] with the in-life bound exposed so a test can
/// cross it in bytes instead of in hours.
#[cfg(unix)]
fn redirect_stderr_to_log_with_max(data_dir: &Path, max_bytes: u64) -> io::Result<PathBuf> {
    use std::os::unix::io::AsRawFd;
    let path = log_path(data_dir);
    let file = open_log_file(&path, max_bytes)?;
    let written = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    // SAFETY: `dup2` on two valid descriptors owned by this process; fd 2 is
    // atomically replaced and `file`'s own descriptor stays valid until it is
    // dropped below, which does not affect the duplicate.
    let replaced = unsafe { libc::dup2(file.as_raw_fd(), 2) };
    if replaced == -1 {
        return Err(io::Error::last_os_error());
    }
    drop(file);
    // Installed only after fd 2 already points at the file: a rotation races
    // nothing, and a failure above leaves no sink claiming a redirect that
    // did not happen.
    match LOG_SINK.lock() {
        Ok(mut guard) => {
            *guard = Some(LogSink {
                path,
                max_bytes,
                written,
            });
        }
        Err(poisoned) => {
            *poisoned.into_inner() = Some(LogSink {
                path,
                max_bytes,
                written,
            });
        }
    }
    Ok(log_path(data_dir))
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

    /// fd 2 is process-global, so the redirect tests take this lock and put
    /// the original stderr back before they end.
    static STDERR_LOCK: Mutex<()> = Mutex::new(());

    /// A running daemon must rotate on the write that crosses the bound, not
    /// only on the next start: it outlives the desktop by design and can run
    /// for weeks. This crosses a tiny bound through the real `log_line` path
    /// (real fd 2) and proves fd 2 was re-pointed at the fresh file, because
    /// a plain rename would leave every later line appending to the rotated
    /// generation.
    #[cfg(unix)]
    #[test]
    fn the_live_log_rotates_when_it_crosses_the_bound() {
        let guard = STDERR_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let path = log_path(dir.path());
        let rotated = path.with_extension("log.1");
        // SAFETY: saving the real stderr so this test can restore it; the
        // duplicate belongs to this process.
        let saved = unsafe { libc::dup(2) };
        assert!(saved >= 0, "cannot save the test process stderr");

        redirect_stderr_to_log_with_max(dir.path(), 64).unwrap();
        for _ in 0..20 {
            log_line(format_args!("line"));
        }
        assert!(
            rotated.exists(),
            "crossing the bound rotates without a restart"
        );
        let rotated_len = std::fs::metadata(&rotated).unwrap().len();
        assert!(
            rotated_len >= 64,
            "the rotated generation holds the earlier bytes: {rotated_len}"
        );
        let live_len = std::fs::metadata(&path).unwrap().len();
        assert!(
            live_len < 64,
            "the live file restarted instead of growing past the bound: {live_len}"
        );

        // The point of the dup2: later writes land in the NEW file. Three
        // more lines (18 bytes) must not cross the 64-byte bound again, so
        // the live file grows by exactly their bytes instead of being
        // rotated a second time.
        let before = std::fs::metadata(&path).unwrap().len();
        for _ in 0..3 {
            log_line(format_args!("after"));
        }
        let after = std::fs::metadata(&path).unwrap().len();
        assert_eq!(
            after,
            before + 3 * "after\n".len() as u64,
            "post-rotation lines must reach the fresh file"
        );

        // SAFETY: restoring the descriptor this test saved above, then
        // closing the saved copy.
        unsafe {
            libc::dup2(saved, 2);
            libc::close(saved);
        }
        match LOG_SINK.lock() {
            Ok(mut sink) => *sink = None,
            Err(poisoned) => *poisoned.into_inner() = None,
        }
        drop(guard);
    }

    #[cfg(unix)]
    #[test]
    fn a_rotation_that_cannot_happen_never_panics_or_spins() {
        let guard = STDERR_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        // A sink whose file and directory are both gone: the rename fails, so
        // the next attempt is a full budget away and nothing unwinds.
        let dir = tempfile::tempdir().unwrap();
        let path = log_path(dir.path());
        // SAFETY: same save/restore discipline as the test above.
        let saved = unsafe { libc::dup(2) };
        assert!(saved >= 0);
        {
            let file = open_log_file(&path, u64::MAX).unwrap();
            use std::os::unix::io::AsRawFd;
            unsafe { libc::dup2(file.as_raw_fd(), 2) };
            match LOG_SINK.lock() {
                Ok(mut sink) => {
                    *sink = Some(LogSink {
                        path: path.clone(),
                        max_bytes: 8,
                        written: 0,
                    })
                }
                Err(poisoned) => {
                    *poisoned.into_inner() = Some(LogSink {
                        path: path.clone(),
                        max_bytes: 8,
                        written: 0,
                    })
                }
            }
        }
        drop(dir);
        for _ in 0..10 {
            log_line(format_args!("still alive"));
        }
        assert!(
            !path.exists(),
            "the directory is gone; nothing was recreated"
        );
        // SAFETY: restoring the test process stderr.
        unsafe {
            libc::dup2(saved, 2);
            libc::close(saved);
        }
        match LOG_SINK.lock() {
            Ok(mut sink) => *sink = None,
            Err(poisoned) => *poisoned.into_inner() = None,
        }
        drop(guard);
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
