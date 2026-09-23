//! Foreground-agent observation for harness-less sessions.
//!
//! A plain `session.start` shell in which the user then runs `claude` keeps
//! `harness_id = None`, so the row would read `Terminal 1 - zsh` forever.
//! This module observes the session PTY's foreground process group instead:
//! `tcgetpgrp` on the master fd (via portable-pty's
//! `MasterPty::process_group_leader`), resolved to an executable path and
//! matched against the harness catalog's own executables.
//!
//! The result is an observation, never an inference, never persisted, and
//! never authority: hook admission, restart and `agentState` keep using the
//! launch `harness_id` only. Under-reporting is correct; a guess is not.
//! Read paths never spawn child processes (no `ps` fork per snapshot).

use std::time::{Duration, Instant};

/// How long one foreground probe stays cached per session. The renderer's
/// `session.list` poll (about 3 s) shares a probe across rapid successive
/// reads, without ever turning a poll into a process-probe storm.
pub(crate) const OBSERVED_TTL: Duration = Duration::from_millis(1_000);

/// Memoized observation for one session, keyed on the observed pgid.
#[derive(Debug, Default)]
pub(crate) struct ForegroundMemo {
    pgid: Option<i32>,
    harness: Option<String>,
    at: Option<String>,
    checked_at: Option<Instant>,
}

impl ForegroundMemo {
    /// Returns the cached observation when it is still fresh for this pgid,
    /// or `None` when the caller must probe again.
    pub(crate) fn cached(
        &self,
        pgid: Option<i32>,
        now: Instant,
    ) -> Option<(Option<String>, Option<String>)> {
        let checked_at = self.checked_at?;
        if self.pgid != pgid {
            return None;
        }
        if now.duration_since(checked_at) > OBSERVED_TTL {
            return None;
        }
        Some((self.harness.clone(), self.at.clone()))
    }

    /// Stores a fresh probe and returns the effective `(harness, at)` pair —
    /// the memo's pinned stamp when pgid and harness are unchanged, the
    /// newly minted stamp otherwise. Callers must return THIS pair, not the
    /// locally minted `at`: returning the local stamp rechurns
    /// `observedHarnessAt` once per TTL on the wire.
    pub(crate) fn store(
        &mut self,
        pgid: Option<i32>,
        harness: Option<String>,
        at: Option<String>,
        now: Instant,
    ) -> (Option<String>, Option<String>) {
        // Pin the first observation's stamp while the same pgid keeps
        // resolving to the same harness: a re-probe with nothing changed
        // must not churn `observedHarnessAt` every TTL. Only a changed pgid
        // or a changed harness mints a new stamp.
        if self.pgid == pgid && self.harness == harness && self.at.is_some() {
            self.checked_at = Some(now);
        } else {
            self.pgid = pgid;
            self.harness = harness;
            self.at = at;
            self.checked_at = Some(now);
        }
        (self.harness.clone(), self.at.clone())
    }
}

/// Matches a file name against the harness catalog's own executables
/// (`claude`, `pi`, `opencode`, `agy`, `codex`) and returns the shared
/// session contract's harness ID vocabulary (`HarnessId` wire spelling),
/// never an executable name. The two vocabularies coincide for every
/// harness except Antigravity, whose executable is `agy` and whose wire id
/// is `antigravity`. Matches on `HarnessId::executable()`; maps through
/// `crate::harness::harness_id_wire` — never a hand-copied list.
pub(crate) fn match_harness_executable(file_name: &str) -> Option<String> {
    for harness in drogon_harness::HarnessId::ALL {
        if file_name == harness.executable() {
            return Some(crate::harness::harness_id_wire(harness).to_string());
        }
    }
    None
}

/// Genuine runtimes that exec a script, whose own name proves nothing: the
/// harness, if any, hides in the process's argv. Shells (`sh`, `bash`,
/// `zsh`, `dash`) and `env` are deliberately NOT shims: a shell's argv
/// describes what the shell was asked to run at some point, not what is
/// running now, so scanning it would invent an agent (e.g. a session
/// created as `/bin/sh -c '... claude ...'` sitting at its prompt would
/// report `claude` while nothing runs but the prompt). `env claude` and
/// `sh -c claude` both exec the harness anyway, which the direct
/// executable match already sees.
fn is_runtime_shim(file_name: &str) -> bool {
    matches!(
        file_name,
        "node" | "bun" | "deno" | "python" | "python3" | "npx"
    )
}

/// File name of a path, lossy-decoded. Empty when the path has no final
/// component.
fn file_name_of(path: &std::path::Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Scans argv entries for the first argument whose file name matches a
/// harness executable, returning the contract's harness ID vocabulary via
/// `match_harness_executable` (wire id, never an executable name).
/// Query strings and fragments are not stripped: an
/// argument only matches when its final path component is exactly a harness
/// executable, so `notclaude` and `claude-wrapper` never match.
fn match_harness_in_argv(args: &[String]) -> Option<String> {
    for arg in args {
        // Skip flag-shaped entries; a harness executable is never a flag.
        if arg.starts_with('-') {
            continue;
        }
        // The argument may be `program args` already split (Linux
        // `/proc/<pid>/cmdline` splits on NUL), or a single string on
        // macOS; either way the candidate is the final path component of
        // each whitespace-separated token after stripping wrapping quotes.
        let mut matched: Option<String> = None;
        for token in arg.split_whitespace() {
            let token = token.trim_matches(|c| c == '"' || c == '\'');
            if token.is_empty() || token.starts_with('-') {
                continue;
            }
            // Take the final `/`-separated component; a `key=value` env
            // entry never has a harness as its final component.
            let base = token.rsplit('/').next().unwrap_or(token);
            // A trailing query/fragment or ` key=value` tail is not a
            // harness executable; only an exact file name matches.
            let base = base.split(['?', '#']).next().unwrap_or(base);
            if base.is_empty() {
                continue;
            }
            if let Some(harness) = match_harness_executable(base) {
                matched = Some(harness);
                break;
            }
        }
        if matched.is_some() {
            return matched;
        }
    }
    None
}

/// Basename of the process's own `argv[0]`, when it names a harness
/// executable. `argv[0]` is self-reported by whoever `exec`'d the process —
/// a hostile parent can set it to anything — and that is acceptable here
/// because this field is a label, never authority: hook admission, restart,
/// resume and `agentState` still use the launch `harness_id` alone.
fn match_harness_in_argv0(argv: &[String]) -> Option<String> {
    let first = argv.first()?;
    // `argv[0]` is one entry, not a shell line: the candidate is its final
    // `/`-separated component, matched exactly like an executable name.
    let base = first.rsplit('/').next().unwrap_or(first);
    let base = base.split(['?', '#']).next().unwrap_or(base);
    if base.is_empty() {
        return None;
    }
    match_harness_executable(base)
}

/// Resolves a foreground pgid to a harness id (the contract's `HarnessId`
/// wire spelling, never an executable name), or `None` when nothing
/// matches, in this precedence:
/// 1. the resolved executable's basename, exactly as before (catches a
///    native binary installed under its own name);
/// 2. the process's own `argv[0]` basename — this is what catches a
///    symlinked or version-directory install (e.g. `claude` as a symlink
///    to `.../versions/2.1.278`, where the canonical executable basename
///    is a version number), because the shell sets `argv[0]` from the name
///    it resolved on `PATH`. `argv[0]` is self-reported by whoever `exec`'d
///    the process, and that is acceptable here: this field is a label,
///    never authority — hook admission, restart, resume and `agentState`
///    still use the launch `harness_id` alone;
/// 3. an `argv[1..]` scan, ONLY when the resolved executable is a runtime
///    shim (`node`, `bun`, `deno`, `python`, `python3`, `npx`). A non-shim
///    executable's arguments are never scanned: `git commit -m claude`
///    must not be labelled an agent. (`pi` already worked through this
///    step, because `/opt/homebrew/bin/pi` is a `#!/usr/bin/env node`
///    script, so node's `argv[1]` ends in `pi`.)
#[cfg(unix)]
pub(crate) fn resolve_harness(pgid: i32) -> Option<String> {
    if pgid <= 0 {
        return None;
    }
    let exe_name = executable_file_name(pgid as u32)?;
    if exe_name.is_empty() {
        return None;
    }
    if let Some(harness) = match_harness_executable(&exe_name) {
        return Some(harness);
    }
    let argv = process_argv(pgid as u32);
    if let Some(harness) = match_harness_in_argv0(&argv) {
        return Some(harness);
    }
    if !is_runtime_shim(&exe_name) {
        return None;
    }
    match_harness_in_argv(argv.get(1..).unwrap_or(&[]))
}

/// Non-unix stub: no probe exists, so nothing is ever observed.
#[cfg(not(unix))]
pub(crate) fn resolve_harness(_pgid: i32) -> Option<String> {
    None
}

/// Foreground process group of the session PTY's master, via
/// `tcgetpgrp` (portable-pty's `process_group_leader`).
#[cfg(unix)]
pub(crate) fn foreground_pgid(master: &crate::session::PtyMaster) -> Option<i32> {
    master.process_group_leader().filter(|pid| *pid > 0)
}

/// Non-unix stub: no foreground group exists.
#[cfg(not(unix))]
pub(crate) fn foreground_pgid(_master: &crate::session::PtyMaster) -> Option<i32> {
    None
}

#[cfg(target_os = "macos")]
fn executable_file_name(pid: u32) -> Option<String> {
    use std::os::unix::ffi::OsStrExt;
    // `libc::proc_pidpath` resolves the pid's executable path; no child
    // process is spawned.
    let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: `buf` is a live allocation of the stated size; `proc_pidpath`
    // writes at most that many bytes and returns the count.
    let ret = unsafe {
        libc::proc_pidpath(
            pid as libc::pid_t,
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len() as u32,
        )
    };
    if ret <= 0 {
        return None;
    }
    let len = ret as usize;
    let path = std::ffi::OsStr::from_bytes(&buf[..len]);
    Some(file_name_of(std::path::Path::new(path)))
}

#[cfg(target_os = "linux")]
fn executable_file_name(pid: u32) -> Option<String> {
    // `readlink` on `/proc/<pid>/exe`; no child process is spawned.
    if let Ok(target) = std::fs::read_link(format!("/proc/{pid}/exe")) {
        let name = file_name_of(&target);
        if !name.is_empty() {
            return Some(name);
        }
    }
    // Fallback: `/proc/<pid>/comm` names the process without a path.
    std::fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn executable_file_name(_pid: u32) -> Option<String> {
    None
}

#[cfg(target_os = "linux")]
fn process_argv(pid: u32) -> Vec<String> {
    // NUL-separated `/proc/<pid>/cmdline`; a plain file read, never a fork.
    let Ok(bytes) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
        return Vec::new();
    };
    bytes
        .split(|b| *b == 0)
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect()
}

#[cfg(target_os = "macos")]
fn process_argv(pid: u32) -> Vec<String> {
    // `sysctl KERN_PROCARGS2`: first an `int argc`, then the exec path,
    // then `argc` argv entries, then the environment. A read-only sysctl;
    // never a fork. Under-reporting on any failure.
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid as libc::c_int];
    let mut size: libc::size_t = 0;
    // SAFETY: sizing call with a null buffer; `mib` is a live 3-element
    // array and `size` is a live out-parameter.
    let sizing = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if sizing != 0 || size == 0 || size > 1024 * 1024 {
        return Vec::new();
    }
    let mut buf = vec![0u8; size];
    let mut filled = size;
    // SAFETY: `buf` is a live allocation of `filled` bytes; sysctl fills at
    // most that many and updates `filled` to the actual count.
    let ret = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            3,
            buf.as_mut_ptr() as *mut libc::c_void,
            &mut filled,
            std::ptr::null_mut(),
            0,
        )
    };
    if ret != 0 || filled < size_of::<i32>() + 1 {
        return Vec::new();
    }
    let argc = i32::from_ne_bytes([buf[0], buf[1], buf[2], buf[3]]);
    if argc <= 0 || argc > 4096 {
        return Vec::new();
    }
    // NUL-separated strings after `argc`: exec path first, then argv.
    let mut strings = Vec::new();
    let mut start = size_of::<i32>();
    while start < filled && strings.len() <= argc as usize {
        let Some(end) = buf[start..filled].iter().position(|b| *b == 0) else {
            break;
        };
        let chunk = &buf[start..start + end];
        if !chunk.is_empty() {
            strings.push(String::from_utf8_lossy(chunk).into_owned());
        }
        start += end + 1;
    }
    if strings.is_empty() {
        return Vec::new();
    }
    // First string is the exec path; the next `argc` are argv.
    strings.into_iter().skip(1).take(argc as usize).collect()
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn process_argv(_pid: u32) -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harness_executables_match_exactly_and_only_them() {
        for harness in drogon_harness::HarnessId::ALL {
            // The match is on the executable name but the result is the
            // contract's wire id — the two differ for Antigravity
            // (`agy` vs `antigravity`), so compare against
            // `harness_id_wire`, never against `executable()` itself.
            assert_eq!(
                match_harness_executable(harness.executable()),
                Some(crate::harness::harness_id_wire(harness).to_string())
            );
        }
        // The executable/wire-id divergence, pinned by name: `agy` on the
        // wire is `antigravity`, never the raw executable string.
        assert_eq!(
            match_harness_executable("agy"),
            Some("antigravity".to_string())
        );
        for non_harness in [
            "",
            "claudex",
            "notclaude",
            "claude-wrapper",
            "Claude",
            "CLAUDE",
            "node_modules",
            "my-pi",
        ] {
            assert_eq!(match_harness_executable(non_harness), None);
        }
    }

    #[test]
    fn argv_scan_matches_only_exact_harness_components() {
        assert_eq!(
            match_harness_in_argv(&["/usr/local/bin/claude".to_string()]),
            Some("claude".to_string())
        );
        assert_eq!(
            match_harness_in_argv(&["node".to_string(), "/opt/work/claude".to_string()]),
            Some("claude".to_string())
        );
        assert_eq!(
            match_harness_in_argv(&["/bin/sh".to_string(), "-c".to_string()]),
            None
        );
        assert_eq!(match_harness_in_argv(&[]), None);
        // Near-misses never match: a guess is not an observation.
        assert_eq!(match_harness_in_argv(&["/opt/notclaude".to_string()]), None);
        assert_eq!(
            match_harness_in_argv(&["/opt/claude-wrapper".to_string()]),
            None
        );
    }

    #[test]
    fn memo_pins_the_first_stamp_while_pgid_and_harness_hold() {
        let mut memo = ForegroundMemo::default();
        let first = Instant::now();
        memo.store(
            Some(11),
            Some("claude".to_string()),
            Some("2026-01-01T00:00:00Z".to_string()),
            first,
        );
        // A re-probe with nothing changed refreshes the freshness clock but
        // keeps the first observation's stamp.
        let later = first + OBSERVED_TTL + Duration::from_millis(1);
        memo.store(
            Some(11),
            Some("claude".to_string()),
            Some("2026-01-01T00:00:01Z".to_string()),
            later,
        );
        assert_eq!(
            memo.cached(Some(11), later),
            Some((
                Some("claude".to_string()),
                Some("2026-01-01T00:00:00Z".to_string())
            ))
        );
        // A changed pgid mints a new stamp, even for the same harness.
        let pgid_changed = later + OBSERVED_TTL + Duration::from_millis(1);
        memo.store(
            Some(12),
            Some("claude".to_string()),
            Some("2026-01-01T00:00:02Z".to_string()),
            pgid_changed,
        );
        assert_eq!(
            memo.cached(Some(12), pgid_changed),
            Some((
                Some("claude".to_string()),
                Some("2026-01-01T00:00:02Z".to_string())
            ))
        );
        // A changed harness on the same pgid mints a new stamp too.
        let harness_changed = pgid_changed + OBSERVED_TTL + Duration::from_millis(1);
        memo.store(
            Some(12),
            Some("pi".to_string()),
            Some("2026-01-01T00:00:03Z".to_string()),
            harness_changed,
        );
        assert_eq!(
            memo.cached(Some(12), harness_changed),
            Some((
                Some("pi".to_string()),
                Some("2026-01-01T00:00:03Z".to_string())
            ))
        );
    }

    #[test]
    fn memo_is_keyed_on_pgid_with_a_short_ttl() {
        let mut memo = ForegroundMemo::default();
        let now = Instant::now();
        assert_eq!(memo.cached(Some(11), now), None);
        memo.store(
            Some(11),
            Some("claude".to_string()),
            Some("2026-01-01T00:00:00Z".to_string()),
            now,
        );
        assert_eq!(
            memo.cached(Some(11), now),
            Some((
                Some("claude".to_string()),
                Some("2026-01-01T00:00:00Z".to_string())
            ))
        );
        // A changed pgid always re-probes, even within the TTL.
        assert_eq!(memo.cached(Some(12), now), None);
        // An expired entry re-probes too.
        assert_eq!(
            memo.cached(Some(11), now + OBSERVED_TTL + Duration::from_millis(1)),
            None
        );
    }
}
