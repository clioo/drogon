//! C01-A catalog contract tests: the probe/parse/freshness pipeline against
//! deterministic fixture executables — no real harness CLIs, no user
//! configuration, no credentials. Public-API contract tests against
//! `drogon_harness::catalog`.

#[cfg(unix)]
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use drogon_harness::{
    CatalogEntry, EnumerationStatus, HarnessId, HostCatalog, PROBE_OUTPUT_CAP, ProbeProvenance,
    freshness_token, probe_host_catalog, probe_host_catalog_with_budget,
};

// ---------------------------------------------------------------------
// Bounded parent/child supervision for adversarial fixtures.
//
// Architecture (coordinator-reviewed, amendments A-F): the adversarial
// probe runs in a SEPARATELY SUPERVISED CHILD TEST PROCESS (re-exec of
// this test binary in child mode), never in an uncancellable Rust thread.
// The parent owns the overall deadline from launch preparation, owns the
// fixture directory, seeds/merges an append-only identity ledger, signals
// only positively rechecked owned identities (TERM first, force only
// confirmed survivors), and retains the directory whenever containment is
// unverifiable. All parent checks are bounded; no assertion runs only
// after a potentially stuck call.

const CHILD_MODE_ENV: &str = "DROGON_CATALOG_CHILD_MODE";
const FIXTURE_DIR_ENV: &str = "DROGON_CATALOG_FIXTURE_DIR";
const LEDGER_FILE: &str = "ledger.children";
const RESULT_FILE: &str = "result.json";
/// Overall budget measured from launch preparation (amendment A): spawn,
/// bootstrap, and bounded ps/kill helpers all consume it.
#[cfg(unix)]
const SUPERVISE_OVERALL: Duration = Duration::from_secs(30);
/// Separate bounded cleanup grace after the overall deadline (amendment A).
#[cfg(unix)]
const CLEANUP_GRACE: Duration = Duration::from_secs(8);
#[cfg(unix)]
const TERM_GRACE: Duration = Duration::from_secs(2);
/// Per-identity ps budget, always consumed inside an absolute deadline.
#[cfg(unix)]
const PS_TIMEOUT: Duration = Duration::from_secs(2);
/// Cleanup (kill + reap) reserve kept INSIDE every operation deadline
/// rather than waiting until the total is exhausted.
#[cfg(unix)]
const REAP_RESERVE: Duration = Duration::from_millis(100);
#[cfg(unix)]
const TICK: Duration = Duration::from_millis(25);
/// Combined bytes one bounded helper may retain across both streams.
#[cfg(unix)]
const HELPER_OUTPUT_CAP: usize = 1 << 20;

fn in_child_mode() -> bool {
    std::env::var_os(CHILD_MODE_ENV).is_some()
}

fn fixture_dir_from_env() -> PathBuf {
    PathBuf::from(std::env::var(FIXTURE_DIR_ENV).expect("fixture dir env in child mode"))
}

/// Canonical birth identity: `lstart` under a pinned locale/TZ (amendment
/// C). The fixture children capture births with the same pinned
/// environment, so string comparison is meaningful. Pure string code,
/// kept platform-neutral because `parse_ledger_line` is platform-neutral.
fn canonical_birth(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(unix)]
fn ps_cmd(pid: &str) -> Command {
    let mut cmd = Command::new("/bin/ps");
    cmd.args(["-p", pid, "-o", "lstart=", "-o", "stat="])
        .env("LC_ALL", "C")
        .env("TZ", "UTC");
    cmd
}

/// Error from a bounded helper run. When the helper could not be
/// confirmed reaped, its `Child` ownership is returned here so the
/// caller keeps the evidence instead of silently dropping a possibly
/// zombie process — a signal (or a timeout) is never exit proof.
#[cfg(unix)]
struct BoundedError {
    message: String,
    // Not Debug on purpose: an unreaped helper must be retained as
    // ownership/evidence, never rendered and dropped by a panic message.
    unreaped: Option<std::process::Child>,
}

#[cfg(unix)]
struct PipeBuf {
    fd: std::os::unix::io::RawFd,
    open: bool,
    bytes: Vec<u8>,
}

/// Run `cmd` bounded by ONE absolute operation deadline. Pipes are
/// drained with poll(2) while waiting (never an unbounded
/// `wait_with_output`), spawn never happens after an expired deadline,
/// and REAP_RESERVE inside the deadline is reserved for kill+reap: a
/// helper that exceeds its WORK window is killed, reaped within the
/// reserve, and reported as a timeout error — even if a status is
/// observed afterwards, because output from a killed helper is not
/// trustworthy evidence.
#[cfg(unix)]
fn run_until(
    cmd: &mut Command,
    op_deadline: Instant,
) -> Result<std::process::Output, BoundedError> {
    if Instant::now() >= op_deadline {
        return Err(BoundedError {
            message: "operation deadline already expired; not spawning".to_string(),
            unreaped: None,
        });
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => {
            return Err(BoundedError {
                message: format!("spawn: {err}"),
                unreaped: None,
            });
        }
    };
    let work_deadline = op_deadline - REAP_RESERVE;
    let mut pipes = [
        PipeBuf {
            fd: child.stdout.as_ref().expect("piped stdout").as_raw_fd(),
            open: true,
            bytes: Vec::new(),
        },
        PipeBuf {
            fd: child.stderr.as_ref().expect("piped stderr").as_raw_fd(),
            open: true,
            bytes: Vec::new(),
        },
    ];
    for pipe in &pipes {
        // SAFETY: fcntl on a live, owned pipe fd. Nonblocking setup must
        // succeed or the drain could block: fail closed.
        let flags = unsafe { libc::fcntl(pipe.fd, libc::F_GETFL) };
        if flags == -1
            || unsafe { libc::fcntl(pipe.fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1
        {
            let _ = child.kill();
            let reap_deadline = Instant::now() + REAP_RESERVE;
            while child.try_wait().ok().flatten().is_none() && Instant::now() < reap_deadline {
                std::thread::sleep(Duration::from_millis(2));
            }
            let reaped = child.try_wait().ok().flatten().is_some();
            return Err(BoundedError {
                message: format!(
                    "set_nonblocking failed: {}",
                    std::io::Error::last_os_error()
                ),
                unreaped: if reaped { None } else { Some(child) },
            });
        }
    }
    let mut status: Option<std::process::ExitStatus> = None;
    loop {
        if status.is_none() {
            match child.try_wait() {
                Ok(found) => status = found,
                Err(err) => {
                    return Err(BoundedError {
                        message: format!("wait: {err}"),
                        unreaped: Some(child),
                    });
                }
            }
        }
        if pipes.iter().all(|pipe| !pipe.open) {
            break;
        }
        if Instant::now() >= work_deadline {
            let _ = child.kill();
            while child.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline {
                std::thread::sleep(Duration::from_millis(2));
            }
            let reaped = child.try_wait().ok().flatten().is_some();
            return Err(BoundedError {
                message: "bounded command exceeded its work window".to_string(),
                unreaped: if reaped { None } else { Some(child) },
            });
        }
        let mut poll_fds: Vec<libc::pollfd> = pipes
            .iter()
            .filter(|pipe| pipe.open)
            .map(|pipe| libc::pollfd {
                fd: pipe.fd,
                events: libc::POLLIN,
                revents: 0,
            })
            .collect();
        // SAFETY: poll_fds is valid for its length; fds stay open.
        let ready =
            unsafe { libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as libc::nfds_t, 10) };
        if ready < 0 {
            let err = std::io::Error::last_os_error();
            if err.kind() != std::io::ErrorKind::Interrupted {
                let _ = child.kill();
                let reap_deadline = Instant::now() + REAP_RESERVE;
                while child.try_wait().ok().flatten().is_none() && Instant::now() < reap_deadline {
                    std::thread::sleep(Duration::from_millis(2));
                }
                let reaped = child.try_wait().ok().flatten().is_some();
                return Err(BoundedError {
                    message: format!("poll failed: {err}"),
                    unreaped: if reaped { None } else { Some(child) },
                });
            }
            continue;
        }
        if ready > 0 {
            for poll_fd in &poll_fds {
                let Some(pipe) = pipes.iter_mut().find(|p| p.fd == poll_fd.fd) else {
                    continue;
                };
                // Finite work per ready fd per cycle: bounded chunk count
                // and a combined cap, with the deadline re-checked between
                // chunks, so a continuously-producing helper can neither
                // monopolize the loop nor grow memory without limit.
                let mut chunks = 0u32;
                while chunks < 16 {
                    if Instant::now() >= work_deadline {
                        break;
                    }
                    let mut chunk = [0u8; 8192];
                    // SAFETY: live nonblocking pipe fd.
                    let n = unsafe { libc::read(pipe.fd, chunk.as_mut_ptr().cast(), chunk.len()) };
                    if n > 0 {
                        let room = HELPER_OUTPUT_CAP.saturating_sub(pipe.bytes.len());
                        pipe.bytes
                            .extend_from_slice(&chunk[..(n as usize).min(room)]);
                        chunks += 1;
                        continue;
                    }
                    if n == 0 {
                        pipe.open = false;
                    } else {
                        let err = std::io::Error::last_os_error();
                        if err.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        if err.kind() != std::io::ErrorKind::WouldBlock {
                            // EIO and friends: no more useful data.
                            pipe.open = false;
                        }
                    }
                    break;
                }
            }
        }
    }
    if status.is_none() {
        // Pipes at EOF but no exit observed (the helper closed its fds
        // while still running): bound the wait by the work window, then
        // kill with only the reserved reap time left.
        let fallback_deadline =
            std::cmp::min(Instant::now() + Duration::from_millis(50), work_deadline);
        loop {
            match child.try_wait() {
                Ok(found @ Some(_)) => {
                    status = found;
                    break;
                }
                Ok(None) if Instant::now() < fallback_deadline => {
                    std::thread::sleep(Duration::from_millis(2));
                }
                Ok(None) => {
                    let _ = child.kill();
                    while child.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline
                    {
                        std::thread::sleep(Duration::from_millis(2));
                    }
                    let reaped = child.try_wait().ok().flatten().is_some();
                    return Err(BoundedError {
                        message: "helper closed its pipes but never exited".to_string(),
                        unreaped: if reaped { None } else { Some(child) },
                    });
                }
                Err(err) => {
                    return Err(BoundedError {
                        message: format!("wait: {err}"),
                        unreaped: Some(child),
                    });
                }
            }
        }
    }
    let [out, err] = pipes;
    Ok(std::process::Output {
        status: status.expect("exit observed before return"),
        stdout: out.bytes,
        stderr: err.bytes,
    })
}

/// Strict parse of bounded ps output: successful exit, empty stderr,
/// strict UTF-8, exactly ONE complete record with a validated
/// `lstart stat` shape (real weekday/month/day/time/year, plus a
/// non-empty alphabetic stat). Malformed output never establishes
/// anything — neither alive nor replaced.
#[cfg(unix)]
fn parse_ps_record(output: &std::process::Output) -> Option<(String, String)> {
    if !output.status.success() || !output.stderr.is_empty() {
        return None;
    }
    let text = String::from_utf8(output.stdout.clone()).ok()?;
    let trimmed = text.trim();
    let mut lines = trimmed.lines();
    let line = lines.next()?;
    if lines.next().is_some() {
        return None; // multiple records
    }
    let (birth, stat) = line.rsplit_once(' ')?;
    let birth = birth.trim();
    let stat = stat.trim();
    const WEEKDAYS: &[&str] = &["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const MONTHS: &[&str] = &[
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let fields: Vec<&str> = birth.split_whitespace().collect();
    let valid_birth = fields.len() == 5
        && WEEKDAYS.contains(&fields[0])
        && MONTHS.contains(&fields[1])
        && fields[2]
            .parse::<u8>()
            .ok()
            .is_some_and(|day| (1..=31).contains(&day))
        && {
            let time: Vec<&str> = fields[3].split(':').collect();
            time.len() == 3
                && time
                    .iter()
                    .all(|part| part.len() == 2 && part.bytes().all(|b| b.is_ascii_digit()))
        }
        && fields[4].len() == 4
        && fields[4].bytes().all(|b| b.is_ascii_digit());
    let valid_stat = !stat.is_empty()
        && stat
            .chars()
            .all(|c| c.is_ascii_alphabetic() || c == '+' || c == '<' || c == '>');
    if !valid_birth || !valid_stat {
        return None;
    }
    Some((canonical_birth(birth), stat.to_string()))
}

/// Captured birth identity for a live pid. Any bounded-run failure is
/// preserved as a `BoundedError` (including unreaped helper ownership);
/// the caller decides how to retain that evidence.
#[cfg(unix)]
fn birth_of(pid: u32) -> Result<String, BoundedError> {
    let op_deadline = Instant::now() + PS_TIMEOUT;
    if Instant::now() >= op_deadline {
        return Err(BoundedError {
            message: "operation deadline already expired".to_string(),
            unreaped: None,
        });
    }
    let output = run_until(&mut ps_cmd(&pid.to_string()), op_deadline)?;
    parse_ps_record(&output)
        .map(|(birth, _)| birth)
        .ok_or_else(|| BoundedError {
            message: "ps output was not a complete single record".to_string(),
            unreaped: None,
        })
}

/// Append-only ledger entry: a strictly positive PID (within the signed
/// pid_t range) plus its birth.
#[derive(Clone, Debug, PartialEq, Eq)]
struct LedgerEntry {
    pid: u32,
    birth: String,
}

fn parse_ledger_line(line: &str) -> Result<LedgerEntry, String> {
    let (pid, birth) = line
        .split_once('|')
        .ok_or_else(|| format!("missing birth identity: {line}"))?;
    let pid: u32 = pid
        .trim()
        .parse()
        .map_err(|_| format!("pid is not a strictly positive integer: {line}"))?;
    // pid_t is a signed 32-bit type on every supported unix; values above
    // i32::MAX must be rejected before any cast near a signal.
    if pid == 0 || pid > i32::MAX as u32 {
        return Err(format!("pid outside positive pid_t range: {line}"));
    }
    let birth = birth.trim();
    if birth.is_empty() {
        return Err(format!("missing birth identity: {line}"));
    }
    Ok(LedgerEntry {
        pid,
        birth: canonical_birth(birth),
    })
}

fn read_ledger(dir: &Path) -> (Vec<LedgerEntry>, Vec<String>) {
    let mut entries = Vec::new();
    let mut malformed = Vec::new();
    let Ok(content) = std::fs::read_to_string(dir.join(LEDGER_FILE)) else {
        return (entries, malformed);
    };
    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        match parse_ledger_line(line) {
            Ok(entry) => entries.push(entry),
            Err(reason) => malformed.push(format!("{line} ({reason})")),
        }
    }
    (entries, malformed)
}

/// What a bounded identity check could prove. Only a clean, non-signaled
/// exit-1 with empty stdout AND empty stderr proves "no such process".
/// A live or replaced identity is decided ONLY by the strict single-record
/// parser. Everything else — signal termination, silent failure,
/// diagnostics, partial or unparseable output — is unverifiable, never
/// absence (amendment C).
#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Identity {
    Alive,
    Gone,
    Replaced,
    Unverifiable,
}

#[cfg(unix)]
fn classify_ps(entry: &LedgerEntry, output: &std::process::Output) -> Identity {
    let stdout_empty = output.stdout.is_empty();
    let stderr_empty = output.stderr.is_empty();
    let exit_code = output.status.code();
    // On unix a terminated-by-signal status has no exit code.
    let signaled = exit_code.is_none();
    if stdout_empty {
        if exit_code == Some(1) && stderr_empty && !signaled {
            return Identity::Gone;
        }
        return Identity::Unverifiable;
    }
    match parse_ps_record(output) {
        Some((birth, _stat)) if birth == entry.birth => Identity::Alive,
        Some(_) => Identity::Replaced,
        None => Identity::Unverifiable,
    }
}

/// Identity check with the helper's failure detail preserved: a bounded
/// run that could not confirm its own cleanup yields the error (including
/// any unreaped helper ownership) alongside the Unverifiable verdict so
/// the supervisor can retain evidence instead of discarding it.
#[cfg(unix)]
fn identity_probe(entry: &LedgerEntry, op_deadline: Instant) -> (Identity, Option<BoundedError>) {
    if Instant::now() >= op_deadline {
        return (
            Identity::Unverifiable,
            Some(BoundedError {
                message: "operation deadline reached before probe".to_string(),
                unreaped: None,
            }),
        );
    }
    match run_until(&mut ps_cmd(&entry.pid.to_string()), op_deadline) {
        Ok(output) => (classify_ps(entry, &output), None),
        Err(err) => (Identity::Unverifiable, Some(err)),
    }
}

#[cfg(unix)]
fn signal_pid(pid: u32, signal: libc::c_int) -> Result<(), String> {
    // SAFETY: `pid` was positively rechecked as an owned live identity
    // immediately before this call; signals are TERM-then-KILL only.
    let rc = unsafe { libc::kill(pid as libc::pid_t, signal) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!(
            "kill({pid}, {signal}): {}",
            std::io::Error::last_os_error()
        ))
    }
}

/// Child outcome written by the child process (the full catalog plus
/// spawn accounting for the registration cross-check, amendment B).
#[derive(serde::Serialize)]
struct ChildReport {
    catalog: drogon_harness::HostCatalog,
    declared_children: usize,
    registered_children: usize,
}

fn write_child_report(dir: &Path, report: &ChildReport) {
    let json = serde_json::to_string(report).expect("serialize child report");
    std::fs::write(dir.join(RESULT_FILE), json).expect("write child report");
}

#[cfg(unix)]
struct CleanupReport {
    actions: Vec<String>,
    unverifiable: Vec<String>,
}

#[cfg(unix)]
impl CleanupReport {
    fn is_clean(&self) -> bool {
        self.unverifiable.is_empty()
    }
}

#[cfg(unix)]
struct ChildRun {
    /// Exit evidence from the direct Child handle (no raw waitpid mixed
    /// into the Child lifecycle, amendment D).
    status: Option<std::process::ExitStatus>,
    killed_by_parent: bool,
    /// Parsed child report; `None` when the child never wrote one.
    report: Option<serde_json::Value>,
    cleanup: CleanupReport,
    /// Parent-owned fixture directory, retained when containment is
    /// unverifiable (amendments B/F).
    retained_dir: Option<PathBuf>,
    /// Bounded helpers whose own cleanup could not be confirmed; kept
    /// (not dropped silently) as cleanup evidence until the run ends.
    _unreaped_helpers: Vec<std::process::Child>,
}

/// Spawn this test binary in child mode under a fresh parent-owned
/// fixture directory, bound the whole run, then clean up strictly.
#[cfg(unix)]
fn supervise(test_name: &str, overall: Duration) -> ChildRun {
    let overall_deadline = Instant::now() + overall;
    let fixture_dir = tempfile::tempdir().expect("parent-owned fixture dir");
    let fixture_path = fixture_dir.path().to_path_buf();

    let mut child = std::process::Command::new(std::env::current_exe().expect("current_exe"))
        .args(["--exact", test_name, "--nocapture"])
        .env(CHILD_MODE_ENV, "1")
        .env(FIXTURE_DIR_ENV, &fixture_path)
        .spawn()
        .expect("spawn supervised child");
    // The directly spawned runner is seeded from the Child handle itself:
    // the strongest identity binding available (amendment B).
    let runner_pid = child.id();

    let mut killed_by_parent = false;
    while child.try_wait().expect("wait child").is_none() {
        if Instant::now() >= overall_deadline {
            killed_by_parent = true;
            let _ = child.kill();
            break;
        }
        std::thread::sleep(TICK);
    }
    // Bounded reap of the runner through the Child handle.
    let reap_deadline = Instant::now() + REAP_RESERVE.max(Duration::from_millis(500));
    let mut status = child.try_wait().expect("wait child");
    while status.is_none() && Instant::now() < reap_deadline {
        std::thread::sleep(TICK);
        status = child.try_wait().expect("wait child");
    }

    // Cleanup phase: separate bounded grace (amendment A). Append-only
    // ledger; late registrations keep arriving while the runner tears
    // down, so the ledger is re-read every tick (amendment B).
    let cleanup_deadline = Instant::now() + CLEANUP_GRACE;
    let mut actions = vec![format!("runner pid={runner_pid} status={status:?}")];
    let mut unverifiable: Vec<String> = Vec::new();
    // Bounded helpers that could not confirm their own reap are retained
    // here (evidence, not silently dropped) until the run ends.
    let mut unreaped_helpers: Vec<std::process::Child> = Vec::new();
    if status.is_none() {
        unverifiable.push(format!("runner pid={runner_pid} could not be reaped"));
    }
    struct Pending {
        entry: LedgerEntry,
        term_at: Option<Instant>,
    }
    let mut pending: Vec<Pending> = Vec::new();
    loop {
        let (entries, malformed) = read_ledger(&fixture_path);
        for bad in malformed {
            if !unverifiable.iter().any(|u| u.contains(&bad)) {
                unverifiable.push(format!("malformed ledger line: {bad}"));
            }
        }
        for entry in entries {
            if pending.iter().any(|p| p.entry == entry) {
                continue;
            }
            // Late-registered identity appearing after the runner exited:
            // resolvable only if it checks out now.
            pending.push(Pending {
                entry,
                term_at: None,
            });
        }
        let mut resolved = Vec::new();
        for (index, item) in pending.iter_mut().enumerate() {
            // Total-bound enforcement is per child, not per loop pass: a
            // long line of identities can never outlive cleanup_deadline.
            let now = Instant::now();
            if now >= cleanup_deadline {
                break;
            }
            // One absolute bound for this identity's whole operation:
            // never beyond cleanup_deadline, never a fresh grace.
            let op_deadline = std::cmp::min(cleanup_deadline, now + PS_TIMEOUT);
            let (identity, probe_error) = identity_probe(&item.entry, op_deadline);
            if let Some(err) = probe_error {
                actions.push(format!(
                    "pid={} probe error: {}",
                    item.entry.pid, err.message
                ));
                if let Some(helper) = err.unreaped {
                    unreaped_helpers.push(helper);
                }
            }
            match identity {
                Identity::Gone | Identity::Replaced => {
                    actions.push(format!("pid={} resolved-gone", item.entry.pid));
                    resolved.push(index);
                }
                Identity::Alive => {
                    if item.term_at.is_none() {
                        // Recheck immediately before every signal
                        // (amendment C); TERM first (amendment D).
                        let (recheck, recheck_error) = identity_probe(&item.entry, op_deadline);
                        if let Some(err) = recheck_error {
                            actions.push(format!(
                                "pid={} pre-signal probe error: {}",
                                item.entry.pid, err.message
                            ));
                            if let Some(helper) = err.unreaped {
                                unreaped_helpers.push(helper);
                            }
                        }
                        if recheck == Identity::Alive {
                            match signal_pid(item.entry.pid, libc::SIGTERM) {
                                Ok(()) => {
                                    actions.push(format!("pid={} SIGTERM", item.entry.pid));
                                    item.term_at = Some(now);
                                }
                                Err(err) => unverifiable.push(err),
                            }
                        }
                    } else if Instant::now() >= item.term_at.expect("term_at") + TERM_GRACE {
                        let op_deadline =
                            std::cmp::min(cleanup_deadline, Instant::now() + PS_TIMEOUT);
                        let (recheck, recheck_error) = identity_probe(&item.entry, op_deadline);
                        if let Some(err) = recheck_error {
                            actions.push(format!(
                                "pid={} pre-force probe error: {}",
                                item.entry.pid, err.message
                            ));
                            if let Some(helper) = err.unreaped {
                                unreaped_helpers.push(helper);
                            }
                        }
                        if recheck == Identity::Alive {
                            match signal_pid(item.entry.pid, libc::SIGKILL) {
                                Ok(()) => actions.push(format!("pid={} SIGKILL", item.entry.pid)),
                                Err(err) => unverifiable.push(err),
                            }
                        }
                        item.term_at = Some(Instant::now()); // re-grade the next force
                    }
                }
                Identity::Unverifiable => {
                    unverifiable.push(format!(
                        "pid={} identity unverifiable (ps error/silent failure)",
                        item.entry.pid
                    ));
                    resolved.push(index);
                }
            }
        }
        for index in resolved.into_iter().rev() {
            pending.swap_remove(index);
        }
        if pending.is_empty() || Instant::now() >= cleanup_deadline {
            break;
        }
        std::thread::sleep(TICK);
    }
    for item in pending {
        unverifiable.push(format!(
            "pid={} still unresolved at cleanup deadline",
            item.entry.pid
        ));
    }

    // Registration accounting (amendment B): the child declares how many
    // fixture children it spawned; an incomplete ledger cannot become
    // PASS merely because the current list is empty.
    let report: Option<serde_json::Value> = std::fs::read_to_string(fixture_path.join(RESULT_FILE))
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok());
    if let Some(value) = &report {
        let declared = value
            .get("declared_children")
            .and_then(serde_json::Value::as_u64)
            .map(|n| n as usize)
            .unwrap_or(0);
        let (entries, _) = read_ledger(&fixture_path);
        if declared > entries.len() {
            unverifiable.push(format!(
                "incomplete registration: child declared {declared} children but the ledger holds {}",
                entries.len()
            ));
        }
    }

    // A bounded helper whose own reap could not be confirmed is recorded
    // as unverifiable evidence: dropping a Child is not a reap, so the
    // run fails and the directory is retained.
    if !unreaped_helpers.is_empty() {
        unverifiable.push(format!(
            "{} bounded helper(s) could not confirm their own reap",
            unreaped_helpers.len()
        ));
    }
    // Keep the parent-owned directory until the runner and every known
    // identity are verified exited; retain on uncertainty (amendment B).
    let retain = !unverifiable.is_empty() || (!killed_by_parent && report.is_none());
    let retained_dir = if retain {
        Some(fixture_dir.keep())
    } else {
        None
    };

    ChildRun {
        status,
        killed_by_parent,
        report,
        cleanup: CleanupReport {
            actions,
            unverifiable,
        },
        retained_dir,
        _unreaped_helpers: unreaped_helpers,
    }
}

#[cfg(unix)]
impl ChildRun {
    /// Assert the supervision contract itself held: the child finished
    /// (not killed), wrote a report, and every known identity resolved.
    fn assert_clean(&self) {
        assert!(
            !self.killed_by_parent,
            "supervised child exceeded its bound; actions: {:?}",
            self.cleanup.actions
        );
        assert!(
            self.status.expect("child exit evidence").success(),
            "child failed; actions: {:?}",
            self.cleanup.actions
        );
        assert!(
            self.report.is_some(),
            "child wrote no report; actions: {:?}",
            self.cleanup.actions
        );
        assert!(
            self.cleanup.is_clean(),
            "cleanup unverifiable: {:?}; retained: {:?}",
            self.cleanup.unverifiable,
            self.retained_dir
        );
        assert!(
            self.retained_dir.is_none(),
            "clean run must not retain the fixture dir"
        );
    }

    fn catalog(&self) -> &serde_json::Value {
        self.report
            .as_ref()
            .expect("child report")
            .get("catalog")
            .expect("catalog in report")
    }
}

/// A fixture bin dir with deterministic fake CLIs. Nothing here touches a
/// real harness or the user's config.
struct FixtureBin {
    dir: tempfile::TempDir,
}

impl FixtureBin {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("fixture bin dir"),
        }
    }

    /// `script` becomes an executable named `name` in the fixture bin.
    fn add(&self, name: &str, script: &str) -> PathBuf {
        add_fixture(self.dir.path(), name, script)
    }
}

/// Writes an executable fixture script into `dir` (shared by FixtureBin
/// and by supervised child modes, whose fixture dir is parent-owned).
fn add_fixture(dir: &Path, name: &str, script: &str) -> PathBuf {
    {
        let path = dir.join(name);
        std::fs::write(&path, script).expect("write fixture script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("chmod fixture");
        }
        path
    }
}

/// The exact fixed-column shape `pi --list-models` prints on Pi 0.85.1
/// (captured live during C01-A discovery), reduced to three rows.
const FAKE_PI_TABLE: &str = "\
provider      model                            context  max-out  thinking  images
dgx-spark     qwen3.8-flash-next-nvidia-nvfp4  131.1K   4.1K     no        no
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes
zai           glm-5.3-flash                    1M       131.1K   yes       yes
";

fn fake_pi(list_models_body: &str) -> String {
    format!(
        "#!/bin/sh\n\
         case \"$1\" in\n\
         \x20 --version) echo '0.85.1'; exit 0 ;;\n\
         \x20 --list-models) cat <<'PIEOF'\n{list_models_body}PIEOF\n\
         \x20 exit 0 ;;\n\
         *) echo \"unexpected argv: $1\" >&2; exit 2 ;;\n\
         esac\n"
    )
}

fn fake_opencode(models_body: &str) -> String {
    format!(
        "#!/bin/sh\n\
         case \"$1\" in\n\
         \x20 --version) echo '1.18.30'; exit 0 ;;\n\
         \x20 models) cat <<'OCEOF'\n{models_body}OCEOF\n\
         \x20 exit 0 ;;\n\
         *) echo \"unexpected argv: $1\" >&2; exit 2 ;;\n\
         esac\n"
    )
}

#[test]
fn pi_probe_enumerates_entries_with_provenance() {
    let bin = FixtureBin::new();
    let pi = bin.add("pi", &fake_pi(FAKE_PI_TABLE));

    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.harness, HarnessId::Pi);
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert_eq!(catalog.entries.len(), 3);

    let kimi = catalog
        .entries
        .iter()
        .find(|entry| entry.provider.as_deref() == Some("kimi-coding"))
        .expect("kimi-coding entry");
    assert_eq!(kimi.id, "kimi-for-coding");
    assert_eq!(kimi.context.as_deref(), Some("262.1K"));
    assert_eq!(kimi.max_output.as_deref(), Some("32.8K"));
    assert_eq!(kimi.thinking, Some(true));
    assert_eq!(kimi.images, Some(true));

    let dgx = catalog
        .entries
        .iter()
        .find(|entry| entry.provider.as_deref() == Some("dgx-spark"))
        .expect("dgx-spark entry");
    assert_eq!(dgx.thinking, Some(false));

    let provenance = catalog.provenance.as_ref().expect("provenance");
    assert_eq!(provenance.version.as_deref(), Some("0.85.1"));
    assert_eq!(provenance.argv, ["--list-models"]);
    assert!(
        provenance.config_scope.contains("credential-free"),
        "scope must record the isolated credential-free probe: {provenance:?}"
    );
    assert!(
        catalog
            .note
            .as_deref()
            .is_some_and(|note| note.contains("auth-gated"))
    );
}

#[test]
fn pi_probe_auth_empty_answer_is_an_honest_empty_enumeration() {
    let bin = FixtureBin::new();
    let pi = bin.add(
        "pi",
        &fake_pi("No models available. Use /login to log into a provider via OAuth or API key.\n"),
    );
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert!(catalog.entries.is_empty());
    assert!(
        catalog
            .note
            .as_deref()
            .is_some_and(|note| note.contains("unverified"))
    );
}

#[test]
fn pi_probe_malformed_output_is_parse_failed_with_a_bounded_sample() {
    let bin = FixtureBin::new();
    let body = "<!DOCTYPE html><html><body>oauth redirect</body></html>\n";
    let pi = bin.add("pi", &fake_pi(body));
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.status, EnumerationStatus::ParseFailed);
    let sample = catalog.note.expect("parse sample note");
    assert!(sample.len() <= 240, "sample stays bounded: {sample}");
}

#[test]
fn missing_executable_is_not_installed() {
    let catalog = probe_host_catalog(HarnessId::Pi, Some(Path::new("/no/such/pi-here")));
    assert_eq!(catalog.status, EnumerationStatus::NotInstalled);
}

#[cfg(unix)]
#[cfg(unix)]
#[cfg(unix)]
/// Child-mode body shared by the adversarial catalog probes: run the
/// fixture probe, count the ledger the fixture scripts appended, and
/// write the report the parent will assert on.
fn child_probe_and_report(pi_script: &str, budget: Duration) {
    let dir = fixture_dir_from_env();
    let pi = add_fixture(&dir, "pi", pi_script);
    let catalog = probe_host_catalog_with_budget(HarnessId::Pi, Some(&pi), budget);
    let (entries, _) = read_ledger(&dir);
    write_child_report(
        &dir,
        &ChildReport {
            catalog,
            declared_children: entries.len(),
            registered_children: entries.len(),
        },
    );
}

#[cfg(unix)]
#[test]
fn timed_out_probe_is_killed_within_its_budget() {
    if in_child_mode() {
        child_probe_and_report(
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
             echo \"$$|$(LC_ALL=C TZ=UTC ps -p $$ -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             sleep 60\n",
            Duration::from_millis(300),
        );
        return;
    }
    let run = supervise(
        "timed_out_probe_is_killed_within_its_budget",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    let catalog = run.catalog();
    assert_eq!(catalog["status"], "timed_out");
    let note = catalog["note"].as_str().expect("note");
    assert!(note.contains("leader still running"), "{note}");
    assert!(note.contains("group-empty"), "{note}");
    assert!(
        run.cleanup.actions.iter().any(|a| a.contains("SIGTERM")),
        "expected TERM evidence: {:?}",
        run.cleanup.actions
    );
}

#[test]
fn opencode_probe_parses_provider_id_lines() {
    let bin = FixtureBin::new();
    let opencode = bin.add(
        "opencode",
        &fake_opencode("opencode/claude-sonnet-5\nopencode/glm-5\nbare-id\n"),
    );
    let catalog = probe_host_catalog(HarnessId::Opencode, Some(&opencode));
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert_eq!(catalog.entries.len(), 3);
    assert_eq!(catalog.entries[0].provider.as_deref(), Some("opencode"));
    assert_eq!(catalog.entries[0].id, "claude-sonnet-5");
    assert_eq!(catalog.entries[2].provider, None);
    assert_eq!(catalog.entries[2].id, "bare-id");
    let provenance = catalog.provenance.as_ref().expect("provenance");
    assert_eq!(provenance.version.as_deref(), Some("1.18.30"));
    assert!(provenance.config_scope.contains("isolated"));
}

#[test]
fn claude_has_no_enumeration_surface_and_reports_version_only() {
    let bin = FixtureBin::new();
    let claude = bin.add("claude", "#!/bin/sh\necho '2.1.266 (Claude Code)'\n");
    let catalog = probe_host_catalog(HarnessId::Claude, Some(&claude));
    assert_eq!(catalog.status, EnumerationStatus::UnsupportedSurface);
    assert!(catalog.entries.is_empty());
    assert_eq!(
        catalog
            .provenance
            .as_ref()
            .and_then(|p| p.version.as_deref()),
        Some("2.1.266 (Claude Code)")
    );
}

#[test]
fn codex_and_antigravity_report_unsupported_surface() {
    let bin = FixtureBin::new();
    let codex = bin.add("codex", "#!/bin/sh\necho 'codex-cli 1.2.3'\n");
    let catalog = probe_host_catalog(HarnessId::Codex, Some(&codex));
    assert_eq!(catalog.status, EnumerationStatus::UnsupportedSurface);

    let absent = probe_host_catalog(HarnessId::Antigravity, None);
    assert_eq!(absent.status, EnumerationStatus::NotInstalled);
}

#[test]
fn freshness_token_changes_when_the_model_set_or_version_changes() {
    let bin = FixtureBin::new();
    let pi = bin.add("pi", &fake_pi(FAKE_PI_TABLE));
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    let token = freshness_token(&catalog);
    assert!(
        token.starts_with("pi|0.85.1|"),
        "token carries executable and version: {token}"
    );
    assert!(token.contains("kimi-coding/kimi-for-coding"));

    // Same executable, one more model -> different token (catalog refresh
    // or model-set change invalidates stored selections).
    let changed = HostCatalog {
        entries: {
            let mut entries = catalog.entries.clone();
            entries.push(CatalogEntry {
                provider: Some("zai".to_string()),
                id: "glm-5.4".to_string(),
                context: None,
                max_output: None,
                thinking: None,
                images: None,
            });
            entries
        },
        ..catalog.clone()
    };
    assert_ne!(token, freshness_token(&changed));

    // Same model set, different version -> different token.
    let upgraded = HostCatalog {
        provenance: Some(ProbeProvenance {
            version: Some("0.86.0".to_string()),
            ..catalog.provenance.clone().expect("provenance")
        }),
        ..catalog.clone()
    };
    assert_ne!(token, freshness_token(&upgraded));
}

#[test]
fn probe_output_beyond_the_cap_is_drained_not_kept() {
    // Many rows beyond PROBE_OUTPUT_CAP: the capped reader retains only the
    // cap while draining the rest, and the probe still completes.
    let mut body = String::from(
        "provider      model                            context  max-out  thinking  images\n",
    );
    while body.len() < PROBE_OUTPUT_CAP + 8192 {
        body.push_str(
            "zai           glm-5.3-flash                    1M       131.1K   yes       yes\n",
        );
    }
    let bin = FixtureBin::new();
    let pi = bin.add("pi", &fake_pi(&body));
    let start = Instant::now();
    let catalog = probe_host_catalog_with_budget(HarnessId::Pi, Some(&pi), Duration::from_secs(20));
    assert_eq!(catalog.status, EnumerationStatus::Enumerated);
    assert!(!catalog.entries.is_empty());
    assert!(
        start.elapsed() < Duration::from_secs(20),
        "a chatty child must still be drained and reaped promptly"
    );
}

#[cfg(unix)]
#[cfg(unix)]
#[test]
fn leader_exits_but_grandchild_holds_pipes_is_bounded_and_reported() {
    if in_child_mode() {
        child_probe_and_report(
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
             cat <<'PIEOF'\n\
provider      model                            context  max-out  thinking  images\n\
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes\n\
PIEOF\n\
             sleep 30 & echo \"$!|$(LC_ALL=C TZ=UTC ps -p $! -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             exit 0\n",
            Duration::from_secs(10),
        );
        return;
    }
    let run = supervise(
        "leader_exits_but_grandchild_holds_pipes_is_bounded_and_reported",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    let catalog = run.catalog();
    assert_eq!(catalog["status"], "enumerated");
    assert_eq!(catalog["entries"].as_array().expect("entries").len(), 1);
    let note = catalog["note"].as_str().expect("note");
    assert!(
        note.contains("leader exited but pipes stayed open past the post-exit grace"),
        "{note}"
    );
    assert!(
        note.contains("group-empty after SIGTERM"),
        "evidence must record verified group exit, not assumed: {note}"
    );
    assert!(
        run.cleanup.actions.iter().any(|a| a.contains("SIGTERM")),
        "{:?}",
        run.cleanup.actions
    );
}

#[cfg(unix)]
#[cfg(unix)]
#[test]
fn term_resistant_descendant_is_sigkilled_and_evidence_recorded() {
    if in_child_mode() {
        child_probe_and_report(
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
             cat <<'PIEOF'\n\
provider      model                            context  max-out  thinking  images\n\
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes\n\
PIEOF\n\
             ( trap '' TERM; sleep 60 ) & echo \"$!|$(LC_ALL=C TZ=UTC ps -p $! -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             exit 0\n",
            Duration::from_secs(10),
        );
        return;
    }
    let run = supervise(
        "term_resistant_descendant_is_sigkilled_and_evidence_recorded",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    let catalog = run.catalog();
    assert_eq!(catalog["status"], "enumerated");
    let note = catalog["note"].as_str().expect("note");
    assert!(
        note.contains("group survived SIGTERM"),
        "the TERM survival must be recorded: {note}"
    );
    assert!(note.contains("group after SIGKILL: group-empty"), "{note}");
}

#[cfg(unix)]
#[cfg(unix)]
#[test]
fn redirected_stdio_survivor_is_caught_after_eof_and_leader_exit() {
    if in_child_mode() {
        child_probe_and_report(
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
             cat <<'PIEOF'\n\
provider      model                            context  max-out  thinking  images\n\
kimi-coding   kimi-for-coding                  262.1K   32.8K    yes       yes\n\
PIEOF\n\
             sleep 45 </dev/null >/dev/null 2>&1 & echo \"$!|$(LC_ALL=C TZ=UTC ps -p $! -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             exit 0\n",
            Duration::from_secs(10),
        );
        return;
    }
    let run = supervise(
        "redirected_stdio_survivor_is_caught_after_eof_and_leader_exit",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    let catalog = run.catalog();
    assert_eq!(catalog["status"], "enumerated");
    let note = catalog["note"].as_str().expect("note");
    assert!(
        note.contains("surviving group members after leader exit and pipe EOF"),
        "the invisible survivor must be recorded: {note}"
    );
}

#[cfg(unix)]
#[cfg(unix)]
#[test]
fn continuous_producer_respects_the_deadline_and_is_fully_reaped() {
    if in_child_mode() {
        child_probe_and_report(
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
             echo \"$$|$(LC_ALL=C TZ=UTC ps -p $$ -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             while :; do echo 'provider      model                            context  max-out  thinking  images'; done\n",
            Duration::from_millis(300),
        );
        return;
    }
    let run = supervise(
        "continuous_producer_respects_the_deadline_and_is_fully_reaped",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    let catalog = run.catalog();
    assert_eq!(catalog["status"], "timed_out");
    let note = catalog["note"].as_str().expect("note");
    assert!(note.contains("leader still running"), "{note}");
    assert!(note.contains("group-empty"), "{note}");
}

#[test]
fn nonzero_exit_is_probe_failed_never_model_rows() {
    // A failing enumeration (e.g. an auth error) must not parse partial
    // stdout into catalog rows.
    let bin = FixtureBin::new();
    let pi = bin.add(
        "pi",
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\n\
         echo 'provider      model'\n\
         echo 'kimi-coding   should-not-appear' \n\
         echo 'token refresh failed' >&2\n\
         exit 1\n",
    );
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&pi));
    assert_eq!(catalog.status, EnumerationStatus::ProbeFailed);
    assert!(catalog.entries.is_empty(), "no rows from a failed probe");
    let note = catalog.note.expect("failure note");
    assert!(note.contains("exited"), "{note}");
    assert!(note.contains("token refresh failed"), "{note}");
}

#[cfg(unix)]
#[test]
fn isolation_setup_failure_fails_closed_without_probing() {
    // Seeded child: TMPDIR points at a read-only dir, so the private probe
    // root cannot be created. The probe must fail closed
    // (IsolationFailed) and never spawn the executable.
    const SEED: &str = "DROGON_CATALOG_TEST_ISOLATION_FAIL";
    if std::env::var_os(SEED).is_none() {
        let guard = tempfile::tempdir().expect("parent temp dir");
        let ro = guard.path().join("read-only");
        std::fs::create_dir(&ro).unwrap();
        let fixture = guard.path().join("pi");
        // A fixture that would print a catalog if it ever ran.
        std::fs::write(
            &fixture,
            "#!/bin/sh\necho 'provider      model'\necho 'kimi-coding   kimi-for-coding'\n",
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fixture, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
        let exe = std::env::current_exe().unwrap();
        let status = std::process::Command::new(exe)
            .arg("isolation_setup_failure_fails_closed_without_probing")
            .arg("--exact")
            .arg("--nocapture")
            .env(SEED, "1")
            .env("TMPDIR", &ro)
            .env("DROGON_CATALOG_TEST_FIXTURE", &fixture)
            .status()
            .expect("spawn seeded child");
        assert!(status.success(), "seeded child must pass");
        return;
    }
    let fixture = PathBuf::from(std::env::var("DROGON_CATALOG_TEST_FIXTURE").unwrap());
    let catalog = probe_host_catalog(HarnessId::Pi, Some(&fixture));
    assert_eq!(
        catalog.status,
        EnumerationStatus::IsolationFailed,
        "probe isolation failure must fail closed: {catalog:?}"
    );
    assert!(catalog.entries.is_empty());
}

// ---------------------------------------------------------------------
// Supervisor self-tests (amendment E): each scenario runs the child mode
// below under `supervise` and asserts the PARENT-side verdict. A
// supervisor that only worked when nothing went wrong would fail here.

#[cfg(unix)]
/// Registers `pid` with its captured birth identity. Returns false when
/// the birth cannot be established: a birthless identity is NEVER written
/// to the ledger (it could not be rechecked before a signal); the caller
/// reports the gap through declared-vs-registered accounting instead.
#[cfg(unix)]
fn append_ledger(dir: &Path, pid: u32) -> Result<(), BoundedError> {
    let birth = birth_of(pid)?;
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(dir.join(LEDGER_FILE))
        .expect("open ledger");
    writeln!(file, "{pid}|{birth}").expect("append ledger");
    Ok(())
}

#[cfg(unix)]
fn spawn_shell_child(dir: &Path, script: &str, register: bool) -> u32 {
    // The handle is intentionally not waited: the child is reaped by the
    // parent supervisor through the identity ledger, not this handle.
    #[allow(clippy::zombie_processes)]
    let child = std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .current_dir(dir)
        .spawn()
        .expect("spawn shell child");
    let pid = child.id();
    if register {
        // Registration failure must NOT silently drop the BoundedError:
        // the caller reports the gap via declared-vs-registered
        // accounting (amendment B), which makes the run unverifiable.
        if let Err(err) = append_ledger(dir, pid) {
            panic!("register child with birth identity failed: {}", err.message);
        }
    }
    pid
}

#[cfg(unix)]
#[test]
fn supervisor_stalled_child_is_bounded_and_reaped() {
    if in_child_mode() {
        // Simulates a stuck probe: never writes a report.
        std::thread::sleep(Duration::from_secs(30));
        return;
    }
    let run = supervise(
        "supervisor_stalled_child_is_bounded_and_reaped",
        Duration::from_secs(3),
    );
    assert!(
        run.killed_by_parent,
        "parent must bound the stalled child; actions: {:?}",
        run.cleanup.actions
    );
    let status = run.status.expect("reaped child exit evidence");
    assert!(!status.success(), "killed child must not report success");
    assert!(
        run.report.is_none(),
        "stalled child must not have written a report"
    );
    assert!(run.cleanup.is_clean(), "{:?}", run.cleanup.unverifiable);
}

#[cfg(unix)]
#[test]
fn supervisor_child_failure_keeps_parent_bounded_and_cleans_up() {
    if in_child_mode() {
        std::thread::sleep(Duration::from_millis(100));
        panic!("intentional child failure");
    }
    let run = supervise(
        "supervisor_child_failure_keeps_parent_bounded_and_cleans_up",
        SUPERVISE_OVERALL,
    );
    let status = run.status.expect("reaped child exit evidence");
    assert!(
        !status.success(),
        "parent must observe the child failure, not hang"
    );
    assert!(run.report.is_none());
    assert!(
        run.cleanup.is_clean() && run.retained_dir.is_none(),
        "no children and a dead runner must clean up fully: {:?}",
        run.cleanup.unverifiable
    );
}

#[cfg(unix)]
#[test]
fn supervisor_delayed_registration_is_collected_during_teardown() {
    if in_child_mode() {
        let dir = fixture_dir_from_env();
        // Register only after a delay: the parent must keep reading the
        // append-only ledger while tearing down (amendment B).
        let pid = spawn_shell_child(&dir, "sleep 5", false);
        std::thread::sleep(Duration::from_millis(300));
        if let Err(err) = append_ledger(&dir, pid) {
            panic!(
                "late registration with birth identity failed: {}",
                err.message
            );
        }
        write_child_report(
            &dir,
            &ChildReport {
                catalog: drogon_harness::HostCatalog::caller_enumerated(
                    HarnessId::Pi,
                    drogon_harness::HarnessAvailability::Available,
                    None,
                    None,
                    "supervisor-self-test",
                    Vec::new(),
                    None,
                ),
                declared_children: 1,
                registered_children: 1,
            },
        );
        return;
    }
    let run = supervise(
        "supervisor_delayed_registration_is_collected_during_teardown",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    assert!(
        run.cleanup.actions.iter().any(|a| a.contains("SIGTERM")),
        "the late-registered child must be TERM-resolved: {:?}",
        run.cleanup.actions
    );
}

#[cfg(unix)]
#[test]
fn supervisor_term_resistant_child_is_forced_after_recheck() {
    if in_child_mode() {
        let dir = fixture_dir_from_env();
        spawn_shell_child(&dir, "trap '' TERM; sleep 30", true);
        write_child_report(
            &dir,
            &ChildReport {
                catalog: drogon_harness::HostCatalog::caller_enumerated(
                    HarnessId::Pi,
                    drogon_harness::HarnessAvailability::Available,
                    None,
                    None,
                    "supervisor-self-test",
                    Vec::new(),
                    None,
                ),
                declared_children: 1,
                registered_children: 1,
            },
        );
        return;
    }
    let run = supervise(
        "supervisor_term_resistant_child_is_forced_after_recheck",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    assert!(
        run.cleanup.actions.iter().any(|a| a.contains("SIGKILL")),
        "TERM-resistant child must be forced after recheck: {:?}",
        run.cleanup.actions
    );
}

#[cfg(unix)]
#[test]
fn supervisor_missing_registration_is_unverifiable_not_pass() {
    if in_child_mode() {
        let dir = fixture_dir_from_env();
        // Spawn WITHOUT registering; the child honestly reports the gap.
        // The child is short-lived so the scenario self-cleans.
        spawn_shell_child(&dir, "sleep 2", false);
        write_child_report(
            &dir,
            &ChildReport {
                catalog: drogon_harness::HostCatalog::caller_enumerated(
                    HarnessId::Pi,
                    drogon_harness::HarnessAvailability::Available,
                    None,
                    None,
                    "supervisor-self-test",
                    Vec::new(),
                    None,
                ),
                declared_children: 1,
                registered_children: 0,
            },
        );
        return;
    }
    let run = supervise(
        "supervisor_missing_registration_is_unverifiable_not_pass",
        SUPERVISE_OVERALL,
    );
    assert!(
        !run.cleanup.is_clean(),
        "incomplete registration must never become PASS"
    );
    assert!(
        run.cleanup
            .unverifiable
            .iter()
            .any(|u| u.contains("incomplete registration")),
        "{:?}",
        run.cleanup.unverifiable
    );
    assert!(
        run.retained_dir.is_some(),
        "uncertain containment must retain the fixture dir"
    );
}

#[cfg(unix)]
#[test]
fn supervisor_stale_identity_is_resolved_without_signaling() {
    if in_child_mode() {
        let dir = fixture_dir_from_env();
        // Register a child that exits immediately: by the time the parent
        // checks, the identity is stale and must be resolved-gone without
        // any signal.
        spawn_shell_child(&dir, "sleep 0.2", true);
        std::thread::sleep(Duration::from_millis(500));
        write_child_report(
            &dir,
            &ChildReport {
                catalog: drogon_harness::HostCatalog::caller_enumerated(
                    HarnessId::Pi,
                    drogon_harness::HarnessAvailability::Available,
                    None,
                    None,
                    "supervisor-self-test",
                    Vec::new(),
                    None,
                ),
                declared_children: 1,
                registered_children: 1,
            },
        );
        return;
    }
    let run = supervise(
        "supervisor_stale_identity_is_resolved_without_signaling",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    assert!(
        run.cleanup
            .actions
            .iter()
            .any(|a| a.contains("resolved-gone")),
        "{:?}",
        run.cleanup.actions
    );
    assert!(
        !run.cleanup
            .actions
            .iter()
            .any(|a| a.contains("SIGTERM") || a.contains("SIGKILL")),
        "a stale identity must never be signaled: {:?}",
        run.cleanup.actions
    );
}

#[test]
fn ledger_lines_require_positive_pids_with_birth_identities() {
    assert!(parse_ledger_line("123|Mon Sep  9 08:00:00 2026").is_ok());
    assert!(parse_ledger_line("123").is_err(), "missing birth");
    assert!(parse_ledger_line("abc|Mon").is_err(), "non-numeric pid");
    assert!(parse_ledger_line("-5|Mon").is_err(), "negative pid");
    assert!(parse_ledger_line("0|Mon").is_err(), "zero pid");
    assert!(parse_ledger_line("123|").is_err(), "empty birth");
    assert!(
        parse_ledger_line("2147483648|Mon Sep  9 08:00:00 2026").is_err(),
        "pid above i32::MAX must be rejected"
    );
    let entry = parse_ledger_line("123|  Mon   Sep  9  08:00:00   2026 ").unwrap();
    assert_eq!(entry.pid, 123);
    assert_eq!(entry.birth, "Mon Sep 9 08:00:00 2026");
}

/// Pure parser/classifier tests: every `ExitStatus` is constructed with
/// `ExitStatusExt::from_raw` (0 = success, 1<<8 = exit code 1, a signal
/// number = signaled). Constructing a status sends NO signal and spawns
/// NO process; genuine containment self-tests belong to the supervised
/// lifecycle tests, not this parser unit.
#[cfg(unix)]
mod ps_classification {
    use super::*;
    use std::os::unix::process::ExitStatusExt;

    fn status(raw: i32) -> std::process::ExitStatus {
        std::process::ExitStatus::from_raw(raw)
    }

    fn output(raw: i32, stdout: &[u8], stderr: &[u8]) -> std::process::Output {
        std::process::Output {
            status: status(raw),
            stdout: stdout.to_vec(),
            stderr: stderr.to_vec(),
        }
    }

    const VALID: &[u8] = b"Mon Sep  9 08:00:00 2026 S\n";

    fn entry(birth: &str) -> LedgerEntry {
        // Production entries are canonicalized at parse time; the test
        // helper applies the same invariant.
        LedgerEntry {
            pid: 4242,
            birth: canonical_birth(birth),
        }
    }

    #[test]
    fn valid_record_decides_alive_and_replaced() {
        let parsed = parse_ps_record(&output(0, VALID, b"")).expect("valid record");
        assert_eq!(parsed.0, "Mon Sep 9 08:00:00 2026");
        assert_eq!(
            classify_ps(&entry("Mon Sep  9 08:00:00 2026"), &output(0, VALID, b"")),
            Identity::Alive
        );
        assert_eq!(
            classify_ps(&entry("Mon Jan  1 00:00:00 2001"), &output(0, VALID, b"")),
            Identity::Replaced
        );
    }

    #[test]
    fn malformed_success_output_establishes_nothing() {
        // "Bad Month 99 nope 2026 S" succeeds but is not a real lstart
        // record: neither alive nor replaced may be concluded.
        let garbage = output(0, b"Bad Month 99 nope 2026 S\n", b"");
        assert!(parse_ps_record(&garbage).is_none());
        assert_eq!(
            classify_ps(&entry("Mon Sep  9 08:00:00 2026"), &garbage),
            Identity::Unverifiable
        );
        // Almost-valid shapes fail too: wrong weekday, bad day, bad time.
        for bad in [
            &b"Funday Sep  9 08:00:00 2026 S\n"[..],
            b"Mon Sep 99 08:00:00 2026 S\n",
            b"Mon Sep  9 8:00:00 2026 S\n",
            b"Mon Sep  9 08:00:00 26 S\n",
        ] {
            assert!(parse_ps_record(&output(0, bad, b"")).is_none(), "{:?}", bad);
        }
    }

    #[test]
    fn success_with_stderr_is_rejected() {
        assert!(parse_ps_record(&output(0, VALID, b"diag\n")).is_none());
    }

    #[test]
    fn multiline_output_is_rejected() {
        let two = b"Mon Sep  9 08:00:00 2026 S\nMon Sep  9 08:00:01 2026 R\n";
        assert!(parse_ps_record(&output(0, two, b"")).is_none());
    }

    #[test]
    fn non_utf8_output_is_rejected() {
        assert!(parse_ps_record(&output(0, b"\xff S", b"")).is_none());
    }

    #[test]
    fn exit_one_with_empty_streams_means_gone() {
        let out = output(1 << 8, b"", b"");
        assert_eq!(
            classify_ps(&entry("Mon Sep  9 08:00:00 2026"), &out),
            Identity::Gone
        );
    }

    #[test]
    fn signal_terminated_ps_is_unverifiable_not_gone() {
        // from_raw(SIGTERM) constructs a terminated-by-signal status; no
        // signal is sent.
        let out = output(libc::SIGTERM, b"", b"");
        assert_eq!(
            classify_ps(&entry("Mon Sep  9 08:00:00 2026"), &out),
            Identity::Unverifiable
        );
    }

    #[test]
    fn exit_one_with_diagnostics_is_unverifiable() {
        let out = output(1 << 8, b"", b"usage: ps\n");
        assert_eq!(
            classify_ps(&entry("Mon Sep  9 08:00:00 2026"), &out),
            Identity::Unverifiable
        );
    }
}
