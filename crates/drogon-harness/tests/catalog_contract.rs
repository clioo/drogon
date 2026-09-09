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
/// Independent declaration channel: fixtures record every pid they
/// spawn here, separately from the identity ledger, so declared-vs-
/// registered can be cross-checked from two sources.
const DECLARED_FILE: &str = "declared.children";
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

/// Sleep at most `cap`, and never past `deadline`: a fixed sleep would
/// otherwise let a bounded loop overshoot its own active deadline by up
/// to the sleep length.
#[cfg(unix)]
fn sleep_capped(deadline: Instant, cap: Duration) {
    let remaining = deadline.saturating_duration_since(Instant::now());
    std::thread::sleep(remaining.min(cap));
}

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
    // Work deadline and reap reserve are decided BEFORE spawning: the
    // helper never runs on borrowed time, and cleanup always has the
    // reserve left inside the one absolute deadline.
    let work_deadline = op_deadline - REAP_RESERVE;
    if Instant::now() >= work_deadline {
        return Err(BoundedError {
            message: "no remaining work budget; not spawning".to_string(),
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
        // Errno is captured at the instant of failure, before any
        // cleanup syscall can overwrite it.
        let fcntl_err = (flags == -1).then(std::io::Error::last_os_error);
        // F_SETFL is never attempted with a failed F_GETFL result.
        let set_rc = if flags == -1 {
            -1
        } else {
            unsafe { libc::fcntl(pipe.fd, libc::F_SETFL, flags | libc::O_NONBLOCK) }
        };
        let fcntl_err =
            fcntl_err.or((set_rc == -1 && flags != -1).then(std::io::Error::last_os_error));
        if let Some(err) = fcntl_err {
            let _ = child.kill();
            // Cleanup stays inside the ONE absolute operation deadline.
            while child.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline {
                sleep_capped(op_deadline, Duration::from_millis(2));
            }
            let reaped = child.try_wait().ok().flatten().is_some();
            return Err(BoundedError {
                message: format!("set_nonblocking failed: {err}"),
                unreaped: if reaped { None } else { Some(child) },
            });
        }
    }
    let mut status: Option<std::process::ExitStatus> = None;
    // Combined retained bytes across BOTH streams; overflow is an
    // explicit error, never a truncation-success.
    let mut total_read: usize = 0;
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
                sleep_capped(op_deadline, Duration::from_millis(2));
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
        // Cap the poll wait by the remaining work budget so a helper
        // can never sleep past its own deadline in fixed 10ms ticks.
        let remaining_ms = work_deadline
            .saturating_duration_since(Instant::now())
            .as_millis()
            .min(10) as libc::c_int;
        // SAFETY: poll_fds is valid for its length; fds stay open.
        let ready = unsafe {
            libc::poll(
                poll_fds.as_mut_ptr(),
                poll_fds.len() as libc::nfds_t,
                remaining_ms,
            )
        };
        if ready < 0 {
            let err = std::io::Error::last_os_error();
            if err.kind() != std::io::ErrorKind::Interrupted {
                let _ = child.kill();
                // Cleanup stays inside the ONE absolute operation deadline.
                while child.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline {
                    sleep_capped(op_deadline, Duration::from_millis(2));
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
                // POLLNVAL: the fd is not pollable. Explicit error, never
                // EOF evidence.
                if poll_fd.revents & libc::POLLNVAL != 0 {
                    let _ = child.kill();
                    while child.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline
                    {
                        sleep_capped(op_deadline, Duration::from_millis(2));
                    }
                    let reaped = child.try_wait().ok().flatten().is_some();
                    return Err(BoundedError {
                        message: format!("poll invalid fd {}", poll_fd.fd),
                        unreaped: if reaped { None } else { Some(child) },
                    });
                }
                let Some(pipe) = pipes.iter_mut().find(|p| p.fd == poll_fd.fd) else {
                    continue;
                };
                // Finite work per ready fd per cycle: bounded chunk count
                // and a COMBINED cap across both streams, with the
                // deadline re-checked between chunks, so a continuously-
                // producing helper can neither monopolize the loop nor
                // grow memory without limit.
                let mut chunks = 0u32;
                while chunks < 16 {
                    if Instant::now() >= work_deadline {
                        break;
                    }
                    let mut chunk = [0u8; 8192];
                    // SAFETY: live nonblocking pipe fd.
                    let n = unsafe { libc::read(pipe.fd, chunk.as_mut_ptr().cast(), chunk.len()) };
                    if n > 0 {
                        total_read += n as usize;
                        if total_read > HELPER_OUTPUT_CAP {
                            let _ = child.kill();
                            while child.try_wait().ok().flatten().is_none()
                                && Instant::now() < op_deadline
                            {
                                sleep_capped(op_deadline, Duration::from_millis(2));
                            }
                            let reaped = child.try_wait().ok().flatten().is_some();
                            return Err(BoundedError {
                                message: format!(
                                    "combined helper output exceeded {HELPER_OUTPUT_CAP} bytes"
                                ),
                                unreaped: if reaped { None } else { Some(child) },
                            });
                        }
                        pipe.bytes.extend_from_slice(&chunk[..n as usize]);
                        chunks += 1;
                        continue;
                    }
                    if n == 0 {
                        pipe.open = false;
                    } else {
                        // Capture errno BEFORE any cleanup decision.
                        let err = std::io::Error::last_os_error();
                        if err.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        if err.kind() != std::io::ErrorKind::WouldBlock {
                            // EIO/EBADF and friends are explicit errors,
                            // not EOF evidence; the helper's output is
                            // untrustworthy.
                            let _ = child.kill();
                            while child.try_wait().ok().flatten().is_none()
                                && Instant::now() < op_deadline
                            {
                                sleep_capped(op_deadline, Duration::from_millis(2));
                            }
                            let reaped = child.try_wait().ok().flatten().is_some();
                            return Err(BoundedError {
                                message: format!("read failed: {err}"),
                                unreaped: if reaped { None } else { Some(child) },
                            });
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
                    sleep_capped(op_deadline, Duration::from_millis(2));
                }
                Ok(None) => {
                    let _ = child.kill();
                    while child.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline
                    {
                        sleep_capped(op_deadline, Duration::from_millis(2));
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
    // Late evidence is not evidence: output assembled after the work
    // window closed is reported as a timeout (kill + reserved reap),
    // never as a successful Ok.
    if Instant::now() >= work_deadline {
        let _ = child.kill();
        while child.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline {
            sleep_capped(op_deadline, Duration::from_millis(2));
        }
        let reaped = child.try_wait().ok().flatten().is_some();
        return Err(BoundedError {
            message: "bounded command finished after its work window".to_string(),
            unreaped: if reaped { None } else { Some(child) },
        });
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
            let two_digits =
                |part: &str| part.len() == 2 && part.bytes().all(|b| b.is_ascii_digit());
            time.len() == 3
                && two_digits(time[0])
                && two_digits(time[1])
                && two_digits(time[2])
                && time[0].parse::<u8>().ok().is_some_and(|h| h <= 23)
                && time[1].parse::<u8>().ok().is_some_and(|m| m <= 59)
                && time[2].parse::<u8>().ok().is_some_and(|sec| sec <= 59)
        }
        && fields[4].len() == 4
        && fields[4].bytes().all(|b| b.is_ascii_digit());
    // Grammar: one base state, then modifiers only. A bare modifier
    // string ('+', 'NL') is not a live process; unknown shapes stay
    // Unverifiable rather than being guessed live.
    const BASE_STATES: &[char] = &['R', 'S', 'D', 'T', 'Z', 'W', 'X', 'I', 'U'];
    const STAT_MODIFIERS: &[char] = &['<', '>', '+', 'N', 'L', 'l', 's'];
    let mut stat_chars = stat.chars();
    let valid_stat = stat_chars
        .next()
        .is_some_and(|first| BASE_STATES.contains(&first))
        && stat_chars.all(|c| STAT_MODIFIERS.contains(&c));
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
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
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
    /// Retained registration failure evidence from the child (empty on a
    /// healthy run); any entry makes the run unverifiable.
    registration_failures: Vec<String>,
}

fn write_child_report(dir: &Path, report: &ChildReport) {
    let json = serde_json::to_string(report).expect("serialize child report");
    std::fs::write(dir.join(RESULT_FILE), json).expect("write child report");
}

/// How one ledger identity left the system: the product-vs-rescue
/// distinction. NaturalExit/Replaced mean the identity was already gone
/// (exited on its own, or the PID was recycled) and the supervisor sent
/// NOTHING; Terminated/ForceKilled are rescue actions the supervisor took
/// after positive identity rechecks.
#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResolutionOutcome {
    NaturalExit,
    Replaced,
    /// PID recycled AFTER the supervisor had already signaled: proves
    /// signals went out, so this is NOT no-signal cleanup.
    ReplacedAfterSignal,
    Terminated,
    ForceKilled,
    Unverifiable,
}

#[cfg(unix)]
#[derive(Clone, Debug)]
struct Resolution {
    pid: u32,
    outcome: ResolutionOutcome,
}

#[cfg(unix)]
struct CleanupReport {
    actions: Vec<String>,
    unverifiable: Vec<String>,
    resolutions: Vec<Resolution>,
}

#[cfg(unix)]
impl CleanupReport {
    fn is_clean(&self) -> bool {
        self.unverifiable.is_empty()
    }

    /// Identities the supervisor RESOLVED WITHOUT ANY SIGNAL.
    fn natural_resolutions(&self) -> impl Iterator<Item = &Resolution> {
        self.resolutions.iter().filter(|r| {
            matches!(
                r.outcome,
                ResolutionOutcome::NaturalExit | ResolutionOutcome::Replaced
            )
        })
    }

    /// Identities the supervisor had to rescue with a signal (TERM or
    /// KILL), each preceded by a positive identity recheck.
    fn rescues(&self) -> impl Iterator<Item = &Resolution> {
        self.resolutions.iter().filter(|r| {
            matches!(
                r.outcome,
                ResolutionOutcome::Terminated | ResolutionOutcome::ForceKilled
            )
        })
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
    /// Bounded helpers whose own cleanup could not be confirmed. Their
    /// failure is already recorded in `cleanup.unverifiable` (the run is
    /// failed and the fixture dir retained); the handles are held until
    /// the run ends so the evidence outlives any single assertion.
    unreaped_helpers: Vec<std::process::Child>,
}

/// Spawn this test binary in child mode under a fresh parent-owned
/// fixture directory, bound the whole run, then clean up strictly.
#[cfg(unix)]
fn supervise(test_name: &str, overall: Duration) -> ChildRun {
    let launch = Instant::now();
    let overall_deadline = launch + overall;
    // The cleanup grace is an extension of the SAME absolute timeline
    // decided at launch (amendment A): every later phase is min()ed into
    // it, never a fresh now+ budget.
    let cleanup_deadline = overall_deadline + CLEANUP_GRACE;
    let fixture_dir = tempfile::tempdir().expect("parent-owned fixture dir");
    let fixture_path = fixture_dir.path().to_path_buf();
    // Parent-ready handshake: created BEFORE the child is spawned, so a
    // registration can never be written before the parent is reading.
    std::fs::write(fixture_path.join("parent.ready"), b"ready\n").expect("parent ready file");

    let mut child = std::process::Command::new(std::env::current_exe().expect("current_exe"))
        .args(["--exact", test_name, "--nocapture"])
        .env(CHILD_MODE_ENV, "1")
        .env(FIXTURE_DIR_ENV, &fixture_path)
        .spawn()
        .expect("spawn supervised child");
    // The directly spawned runner is seeded from the Child handle itself:
    // the strongest identity binding available (amendment B).
    let runner_pid = child.id();

    struct Pending {
        entry: LedgerEntry,
        term_at: Option<Instant>,
        /// A SIGKILL was delivered: a later Gone resolution is
        /// ForceKilled, not Terminated.
        force_sent: bool,
        /// Any signal was delivered: later Replaced resolutions must not
        /// be mislabeled as no-signal cleanup.
        signaled: bool,
    }

    // The ledger is read from the very start: registrations can arrive
    // while the runner is still working. `seen` dedups against EVERY
    // entry ever observed, so a resolved identity is never re-added.
    let mut seen: std::collections::HashSet<LedgerEntry> = std::collections::HashSet::new();
    let mut pending: Vec<Pending> = Vec::new();
    let mut resolutions: Vec<Resolution> = Vec::new();
    let mut actions = vec![format!("runner pid={runner_pid} spawned")];
    let mut unverifiable: Vec<String> = Vec::new();
    // Bounded helpers whose own cleanup could not be confirmed; kept
    // (not dropped silently) as cleanup evidence until the run ends.
    let mut unreaped_helpers: Vec<std::process::Child> = Vec::new();
    let mut killed_by_parent = false;

    loop {
        let runner_done = match child.try_wait() {
            Ok(done) => done,
            Err(err) => {
                unverifiable.push(format!("runner wait failed: {err}"));
                None
            }
        };
        if runner_done.is_none() && Instant::now() >= overall_deadline {
            killed_by_parent = true;
            let _ = child.kill();
        }
        // Ledger read every tick: late registrations keep arriving.
        let (entries, malformed) = read_ledger(&fixture_path);
        for bad in malformed {
            let note = format!("malformed ledger line: {bad}");
            if !unverifiable.iter().any(|u| u == &note) {
                unverifiable.push(note);
            }
        }
        for entry in entries {
            if seen.insert(entry.clone()) {
                // First sight of this identity: resolve it once the
                // runner is done (a live runner may still be using it).
                pending.push(Pending {
                    entry,
                    term_at: None,
                    force_sent: false,
                    signaled: false,
                });
            }
        }
        // Resolve pending identities only after the runner has exited.
        if runner_done.is_some() {
            let mut resolved = Vec::new();
            for (index, item) in pending.iter_mut().enumerate() {
                // Total-bound enforcement is per child, not per loop
                // pass: a long line of identities can never outlive
                // cleanup_deadline.
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
                    Identity::Gone => {
                        actions.push(format!("pid={} resolved-gone", item.entry.pid));
                        let outcome = if item.force_sent {
                            ResolutionOutcome::ForceKilled
                        } else if item.term_at.is_some() {
                            ResolutionOutcome::Terminated
                        } else {
                            ResolutionOutcome::NaturalExit
                        };
                        resolutions.push(Resolution {
                            pid: item.entry.pid,
                            outcome,
                        });
                        resolved.push(index);
                    }
                    Identity::Replaced => {
                        actions.push(format!("pid={} resolved-replaced", item.entry.pid));
                        // A PID recycled AFTER we signaled still proves
                        // signals went out: it is not no-signal cleanup.
                        let outcome = if item.signaled {
                            ResolutionOutcome::ReplacedAfterSignal
                        } else {
                            ResolutionOutcome::Replaced
                        };
                        resolutions.push(Resolution {
                            pid: item.entry.pid,
                            outcome,
                        });
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
                                        item.signaled = true;
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
                                    Ok(()) => {
                                        actions.push(format!("pid={} SIGKILL", item.entry.pid));
                                        item.force_sent = true;
                                        item.signaled = true;
                                    }
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
                        resolutions.push(Resolution {
                            pid: item.entry.pid,
                            outcome: ResolutionOutcome::Unverifiable,
                        });
                        resolved.push(index);
                    }
                }
            }
            for index in resolved.into_iter().rev() {
                pending.swap_remove(index);
            }
        }
        // Exit only on QUIESCENCE, not merely an empty pending list: the
        // runner must be done AND the ledger must hold no unseen entries.
        // Otherwise late registrations would be missed.
        let quiesced = runner_done.is_some()
            && pending.is_empty()
            && seen.len() >= read_ledger(&fixture_path).0.len();
        if quiesced || Instant::now() >= cleanup_deadline {
            for item in &pending {
                unverifiable.push(format!(
                    "pid={} still unresolved at cleanup deadline",
                    item.entry.pid
                ));
            }
            break;
        }
        sleep_capped(cleanup_deadline, TICK);
    }
    // Bounded reap of the runner through the Child handle (real reaping;
    // still min()ed into the absolute cleanup timeline).
    let runner_reap_deadline = std::cmp::min(
        Instant::now() + Duration::from_millis(500),
        cleanup_deadline,
    );
    let mut status = child.try_wait().expect("wait child");
    while status.is_none() && Instant::now() < runner_reap_deadline {
        sleep_capped(runner_reap_deadline, TICK);
        status = child.try_wait().expect("wait child");
    }
    actions.push(format!("runner pid={runner_pid} status={status:?}"));
    if status.is_none() {
        unverifiable.push(format!("runner pid={runner_pid} could not be reaped"));
    }

    // Registration accounting (amendment B), independent: the parent
    // reads the ledger ITSELF and cross-checks BOTH numbers the child
    // reported - declared and registered. Strict required schema: any
    // missing field is unverifiable, never defaulted.
    let report: Option<serde_json::Value> = std::fs::read_to_string(fixture_path.join(RESULT_FILE))
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok());
    let (entries, _) = read_ledger(&fixture_path);
    match &report {
        Some(value) => {
            let declared = value
                .get("declared_children")
                .and_then(serde_json::Value::as_u64)
                .map(|n| n as usize);
            let registered_reported = value
                .get("registered_children")
                .and_then(serde_json::Value::as_u64)
                .map(|n| n as usize);
            let failures = value
                .get("registration_failures")
                .and_then(serde_json::Value::as_array);
            let catalog_ok = value.get("catalog").is_some();
            match (declared, registered_reported, failures, catalog_ok) {
                (Some(declared), Some(registered), Some(failures), true) => {
                    if declared > entries.len() {
                        unverifiable.push(format!(
                            "incomplete registration: child declared {declared} children but the ledger holds {}",
                            entries.len()
                        ));
                    }
                    // Independent declaration channel: if the fixtures
                    // declared more than the child reported, the report
                    // is suppressing evidence.
                    if let Ok(text) = std::fs::read_to_string(fixture_path.join(DECLARED_FILE)) {
                        let declared_channel = text.lines().filter(|l| !l.trim().is_empty()).count();
                        if declared_channel != declared {
                            unverifiable.push(format!(
                                "declaration mismatch: fixtures declared {declared_channel} but the report says {declared}"
                            ));
                        }
                    }
                    if registered != entries.len() {
                        unverifiable.push(format!(
                            "registration accounting mismatch: child reports {registered} registered but the ledger holds {}",
                            entries.len()
                        ));
                    }
                    for failure in failures {
                        unverifiable.push(format!("registration failure retained: {failure}"));
                    }
                }
                _ => unverifiable.push(
                    "result report missing required fields (catalog/declared_children/registered_children/registration_failures)"
                        .to_string(),
                ),
            }
        }
        None => unverifiable.push("no result report from the child".to_string()),
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
            resolutions,
        },
        retained_dir,
        unreaped_helpers,
    }
}

#[cfg(unix)]
impl ChildRun {
    /// Pids of bounded helpers whose own cleanup could not be confirmed;
    /// every one already made the run unverifiable and retained the
    /// fixture dir. Exposed so the evidence is inspectable, never
    /// silently held.
    fn unreaped_helper_pids(&self) -> Vec<u32> {
        self.unreaped_helpers
            .iter()
            .map(|child| child.id())
            .collect()
    }

    /// Assert the supervision contract itself held: the child finished
    /// (not killed), wrote a report, and every known identity resolved.
    fn assert_clean(&self) {
        assert!(
            self.unreaped_helper_pids().is_empty(),
            "unreaped bounded helpers: {:?}",
            self.unreaped_helper_pids()
        );
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

    /// Product runs must clean up WITHOUT any supervisor rescue: every
    /// identity exits through the product's own bounded machinery. A
    /// rescue here means the product leaked containment and the
    /// supervisor had to intervene - that is a failure, not a pass.
    fn assert_clean_product(&self) {
        self.assert_clean();
        assert!(
            self.cleanup.rescues().next().is_none(),
            "product run must need zero supervisor rescues; resolutions: {:?}",
            self.cleanup.resolutions
        );
        assert!(
            !self
                .cleanup
                .resolutions
                .iter()
                .any(|r| r.outcome == ResolutionOutcome::ReplacedAfterSignal),
            "product run must send no signals; resolutions: {:?}",
            self.cleanup.resolutions
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
    // Independent evidence: declared comes from the fixtures' OWN
    // declaration channel (one pid per spawned fixture), registered
    // from the identity ledger the parent also reads. Neither side
    // derives one count from the other's source.
    let declared = std::fs::read_to_string(dir.join(DECLARED_FILE))
        .map(|text| text.lines().filter(|line| !line.trim().is_empty()).count())
        .unwrap_or(0);
    write_child_report(
        &dir,
        &ChildReport {
            catalog,
            declared_children: declared,
            registered_children: entries.len(),
            registration_failures: Vec::new(),
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
             echo \"$$\" >> \"$(dirname \"$0\")/declared.children\"
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
    run.assert_clean_product();
    let catalog = run.catalog();
    assert_eq!(catalog["status"], "timed_out");
    // The TERM evidence is the PRODUCT's own bounded group cleanup,
    // recorded in the catalog note - not a supervisor rescue.
    let note = catalog["note"].as_str().expect("note");
    assert!(note.contains("leader still running"), "{note}");
    assert!(note.contains("group-empty"), "{note}");
    assert!(
        note.contains("SIGTERM") || note.contains("SIGKILL"),
        "expected product TERM/KILL evidence in the note: {note}"
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
             sleep 30 & echo \"$!\" >> \"$(dirname \"$0\")/declared.children\"
             echo \"$!|$(LC_ALL=C TZ=UTC ps -p $! -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             exit 0\n",
            Duration::from_secs(10),
        );
        return;
    }
    let run = supervise(
        "leader_exits_but_grandchild_holds_pipes_is_bounded_and_reported",
        SUPERVISE_OVERALL,
    );
    run.assert_clean_product();
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
             ( trap '' TERM; sleep 60 ) & echo \"$!\" >> \"$(dirname \"$0\")/declared.children\"
             echo \"$!|$(LC_ALL=C TZ=UTC ps -p $! -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             exit 0\n",
            Duration::from_secs(10),
        );
        return;
    }
    let run = supervise(
        "term_resistant_descendant_is_sigkilled_and_evidence_recorded",
        SUPERVISE_OVERALL,
    );
    run.assert_clean_product();
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
             sleep 45 </dev/null >/dev/null 2>&1 & echo \"$!\" >> \"$(dirname \"$0\")/declared.children\"
             echo \"$!|$(LC_ALL=C TZ=UTC ps -p $! -o lstart=)\" >> \"$(dirname \"$0\")/ledger.children\"\n\
             exit 0\n",
            Duration::from_secs(10),
        );
        return;
    }
    let run = supervise(
        "redirected_stdio_survivor_is_caught_after_eof_and_leader_exit",
        SUPERVISE_OVERALL,
    );
    run.assert_clean_product();
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
             echo \"$$\" >> \"$(dirname \"$0\")/declared.children\"
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
    run.assert_clean_product();
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
/// Registers `pid` with its captured birth identity. On failure the full
/// BoundedError (including unreaped helper ownership) is returned to the
/// caller, which must reap any unreaped helper IT owns (bounded) and then
/// report the failure - nothing is silently dropped on any registration
/// path.
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

/// Registration accounting owned by the child test process (lifecycle):
/// how many fixture children it declared, how many it registered, the
/// retained failure detail for every registration that failed, and -
/// crucially - the actual Child handles of everything it spawned. An
/// ancestor that is not the parent CANNOT reap a non-child via a PID
/// ledger; the handles make ownership explicit so the child can bounded-
/// reap what it owns where the test design allows, and the ledger+birth
/// record is the ownership transfer for fixtures that must outlive it.
#[cfg(unix)]
#[derive(Default)]
struct RegistrationLedger {
    declared: usize,
    registered: usize,
    failures: Vec<String>,
    owned: Vec<std::process::Child>,
}

#[cfg(unix)]
impl RegistrationLedger {
    fn spawn_owned(&mut self, dir: &Path, script: &str) -> Option<u32> {
        self.declared += 1;
        match std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .current_dir(dir)
            .spawn()
        {
            Ok(child) => {
                let pid = child.id();
                self.owned.push(child);
                Some(pid)
            }
            Err(err) => {
                self.failures
                    .push(format!("fixture spawn failed ({}): {err}", self.declared));
                None
            }
        }
    }

    /// Declare a fixture child WITHOUT registering it (the
    /// missing-registration self-test): the declared count rises but the
    /// ledger stays empty, and accounting must expose the gap. The
    /// caller remains responsible for the child it owns.
    fn declare_only(&mut self, dir: &Path, script: &str) -> Option<u32> {
        self.spawn_owned(dir, script)
    }

    /// Register one fixture child: spawn (ownership retained) + ledger
    /// append. Registration failures retain the full BoundedError; an
    /// unreaped ps helper from a failed birth capture is reaped HERE, in
    /// the process that owns it, bounded by an absolute deadline - and
    /// if it still cannot be reaped, that uncertainty is recorded.
    fn register(&mut self, dir: &Path, script: &str) -> Option<u32> {
        let pid = self.spawn_owned(dir, script)?;
        let op_deadline = Instant::now() + PS_TIMEOUT;
        match append_ledger(dir, pid) {
            Ok(()) => self.registered += 1,
            Err(err) => {
                let mut note = format!("pid={pid} registration failed: {}", err.message);
                if let Some(mut helper) = err.unreaped {
                    // We own this helper: bounded reap inside the
                    // absolute op deadline, never a silent drop.
                    while helper.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline
                    {
                        sleep_capped(op_deadline, Duration::from_millis(2));
                    }
                    if helper.try_wait().ok().flatten().is_some() {
                        note.push_str("; unreaped ps helper reaped by registrant");
                    } else {
                        note.push_str("; unreaped ps helper could NOT be reaped by registrant");
                    }
                    self.owned.push(helper);
                }
                self.failures.push(note);
            }
        }
        Some(pid)
    }

    /// Bounded reap of everything this child still owns, used by tests
    /// whose fixtures must NOT outlive the child. Returns the pids that
    /// could not be reaped within the deadline (visible uncertainty).
    fn reap_owned_bounded(&mut self, deadline: Instant) -> Vec<u32> {
        let mut stuck = Vec::new();
        for child in &mut self.owned {
            if child.try_wait().ok().flatten().is_some() {
                continue;
            }
            while child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                sleep_capped(deadline, Duration::from_millis(2));
            }
            if child.try_wait().ok().flatten().is_none() {
                stuck.push(child.id());
            }
        }
        stuck
    }
}

/// Delayed registration (the delayed-registration self-test) goes
/// through the same retention path: the BoundedError is never discarded.
#[cfg(unix)]
fn retain_late_registration(ledger: &mut RegistrationLedger, dir: &Path, pid: u32) {
    match append_ledger(dir, pid) {
        Ok(()) => ledger.registered += 1,
        Err(err) => {
            let mut note = format!("pid={pid} late registration failed: {}", err.message);
            if let Some(mut helper) = err.unreaped {
                let op_deadline = Instant::now() + PS_TIMEOUT;
                while helper.try_wait().ok().flatten().is_none() && Instant::now() < op_deadline {
                    sleep_capped(op_deadline, Duration::from_millis(2));
                }
                if helper.try_wait().ok().flatten().is_some() {
                    note.push_str("; unreaped ps helper reaped by registrant");
                } else {
                    note.push_str("; unreaped ps helper could NOT be reaped by registrant");
                }
                ledger.owned.push(helper);
            }
            ledger.failures.push(note);
        }
    }
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
        // append-only ledger while tearing down (amendment B). A late
        // registration failure is retained as evidence, never dropped.
        let mut ledger = RegistrationLedger::default();
        let pid = ledger.declare_only(&dir, "sleep 5").expect("fixture spawn");
        std::thread::sleep(Duration::from_millis(300));
        retain_late_registration(&mut ledger, &dir, pid);
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
                declared_children: ledger.declared,
                registered_children: ledger.registered,
                registration_failures: ledger.failures,
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
    assert!(
        run.cleanup
            .rescues()
            .any(|r| r.outcome == ResolutionOutcome::Terminated),
        "expected a Terminated rescue; resolutions: {:?}",
        run.cleanup.resolutions
    );
}

#[cfg(unix)]
#[test]
fn supervisor_term_resistant_child_is_forced_after_recheck() {
    if in_child_mode() {
        let dir = fixture_dir_from_env();
        let mut ledger = RegistrationLedger::default();
        ledger.register(&dir, "trap '' TERM; sleep 30");
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
                declared_children: ledger.declared,
                registered_children: ledger.registered,
                registration_failures: ledger.failures,
            },
        );
        return;
    }
    let run = supervise(
        "supervisor_term_resistant_child_is_forced_after_recheck",
        SUPERVISE_OVERALL,
    );
    // Genuine rescue: the TERM-trapped fixture needed the force path,
    // recorded as a structured ForceKilled resolution.
    assert!(
        run.cleanup
            .rescues()
            .any(|r| r.outcome == ResolutionOutcome::ForceKilled),
        "expected a ForceKilled rescue; resolutions: {:?}",
        run.cleanup.resolutions
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
        // The child OWNS what it spawned: bounded-reap via the handle
        // before exit (real exit evidence, no duration inference, no
        // untracked orphan), while still reporting declared=1,
        // registered=0.
        let mut ledger = RegistrationLedger::default();
        ledger.declare_only(&dir, "sleep 2");
        let stuck = ledger.reap_owned_bounded(Instant::now() + Duration::from_secs(5));
        if !stuck.is_empty() {
            ledger.failures.push(format!(
                "owned fixture(s) not reaped before child exit: {stuck:?}"
            ));
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
                declared_children: ledger.declared,
                registered_children: ledger.registered,
                registration_failures: ledger.failures,
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
fn supervisor_distinguishes_product_cleanup_from_rescue() {
    if in_child_mode() {
        let dir = fixture_dir_from_env();
        let mut ledger = RegistrationLedger::default();
        // One fixture exits promptly: pure product cleanup. One sleeps:
        // needs a rescue signal from the supervisor.
        ledger.register(&dir, "sleep 0.2");
        std::thread::sleep(Duration::from_millis(500));
        ledger.register(&dir, "sleep 30");
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
                declared_children: ledger.declared,
                registered_children: ledger.registered,
                registration_failures: ledger.failures,
            },
        );
        return;
    }
    let run = supervise(
        "supervisor_distinguishes_product_cleanup_from_rescue",
        SUPERVISE_OVERALL,
    );
    run.assert_clean();
    // The distinction is structural, not string-matching: exactly one
    // identity resolved without any signal and exactly one needed a
    // TERM-first rescue.
    let naturals: Vec<&Resolution> = run.cleanup.natural_resolutions().collect();
    let rescues: Vec<&Resolution> = run.cleanup.rescues().collect();
    assert_eq!(
        naturals.len(),
        1,
        "the prompt fixture must resolve naturally; resolutions: {:?}",
        run.cleanup.resolutions
    );
    assert_eq!(
        rescues.len(),
        1,
        "the sleeping fixture must need exactly one rescue; resolutions: {:?}",
        run.cleanup.resolutions
    );
    assert!(
        matches!(
            rescues[0].outcome,
            ResolutionOutcome::Terminated | ResolutionOutcome::ForceKilled
        ),
        "rescue must be TERM-first evidence: {:?}",
        rescues[0]
    );
    assert_ne!(
        naturals[0].pid, rescues[0].pid,
        "natural and rescued identities must be different processes"
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
        let mut ledger = RegistrationLedger::default();
        ledger.register(&dir, "sleep 0.2");
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
                declared_children: ledger.declared,
                registered_children: ledger.registered,
                registration_failures: ledger.failures,
            },
        );
        return;
    }
    let run = supervise(
        "supervisor_stale_identity_is_resolved_without_signaling",
        SUPERVISE_OVERALL,
    );
    run.assert_clean_product();
    assert!(
        run.cleanup
            .actions
            .iter()
            .any(|a| a.contains("resolved-gone")),
        "{:?}",
        run.cleanup.actions
    );
    // Product cleanup, not rescue: the identity exited on its own, so
    // the supervisor sent NOTHING (asserted both as actions and as
    // structured resolutions).
    assert!(
        run.cleanup.rescues().next().is_none(),
        "a stale identity must never be signaled; resolutions: {:?}",
        run.cleanup.resolutions
    );
    assert!(
        run.cleanup
            .natural_resolutions()
            .any(|r| r.outcome == ResolutionOutcome::NaturalExit),
        "expected a NaturalExit resolution; resolutions: {:?}",
        run.cleanup.resolutions
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
    fn out_of_range_time_is_rejected() {
        for bad in [
            &b"Mon Sep  9 99:00:00 2026 S\n"[..],
            b"Mon Sep  9 23:99:00 2026 S\n",
            b"Mon Sep  9 23:59:99 2026 S\n",
        ] {
            assert!(parse_ps_record(&output(0, bad, b"")).is_none(), "{:?}", bad);
        }
    }

    #[test]
    fn arbitrary_stat_letters_are_rejected() {
        for bad in [
            &b"Mon Sep  9 08:00:00 2026 Garbage\n"[..],
            b"Mon Sep  9 08:00:00 2026 Q\n",
        ] {
            assert!(parse_ps_record(&output(0, bad, b"")).is_none(), "{:?}", bad);
        }
    }

    #[test]
    fn stat_requires_base_state_before_modifiers() {
        // Bare modifiers are not process states.
        for bad in [
            &b"Mon Sep  9 08:00:00 2026 +\n"[..],
            b"Mon Sep  9 08:00:00 2026 NL\n",
            b"Mon Sep  9 08:00:00 2026 <\n",
        ] {
            assert!(parse_ps_record(&output(0, bad, b"")).is_none(), "{:?}", bad);
        }
        // Base state, optionally followed by modifiers, is live-shaped.
        for ok in [
            &b"Mon Sep  9 08:00:00 2026 S\n"[..],
            b"Mon Sep  9 08:00:00 2026 S+\n",
            b"Mon Sep  9 08:00:00 2026 RN\n",
        ] {
            assert!(parse_ps_record(&output(0, ok, b"")).is_some(), "{:?}", ok);
        }
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
