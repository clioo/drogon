//! Git capability baseline: host-scoped capability rejection memory and a
//! `git status --porcelain=v2` parser for the Git 2.25 baseline subset.
//! See `docs/migration/verticals/V3/git-capability-baseline.md` and the
//! source policy at `docs/reference/git-compatibility.md`. This module is
//! pure/std-only: no process spawning, no I/O.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::error;
use drogon_protocol::RpcError;

/// One entry in the source compatibility table
/// (`docs/reference/git-compatibility.md#current-capabilities`), plus the
/// placeholder-that-fails-open row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    FetchNoWriteFetchHead,
    WorktreeListZ,
    RevParsePathFormat,
    ForEachRefExclude,
    MergeTreeWriteTree,
    MergeTreeMergeBase,
    DecoratePlaceholder,
}

impl Capability {
    /// The exact source-table identifier, used for docs/log correlation.
    pub fn key(&self) -> &'static str {
        match self {
            Capability::FetchNoWriteFetchHead => "fetch-no-write-fetch-head",
            Capability::WorktreeListZ => "worktree-list-z",
            Capability::RevParsePathFormat => "rev-parse-path-format",
            Capability::ForEachRefExclude => "for-each-ref-exclude",
            Capability::MergeTreeWriteTree => "merge-tree-write-tree",
            Capability::MergeTreeMergeBase => "merge-tree-merge-base",
            Capability::DecoratePlaceholder => "decorate-placeholder",
        }
    }

    const ALL: [Capability; 7] = [
        Capability::FetchNoWriteFetchHead,
        Capability::WorktreeListZ,
        Capability::RevParsePathFormat,
        Capability::ForEachRefExclude,
        Capability::MergeTreeWriteTree,
        Capability::MergeTreeMergeBase,
        Capability::DecoratePlaceholder,
    ];
}

/// The execution host a capability rejection is scoped to. Never version-
/// sniffed: a behavior probe plus this scope key is the sole authority, per
/// `docs/reference/git-compatibility.md`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum HostScope {
    Native,
    Wsl(String),
    Ssh(String),
    Relay(String),
}

impl HostScope {
    pub fn native() -> Self {
        HostScope::Native
    }

    pub fn wsl(distro: impl Into<String>) -> Self {
        HostScope::Wsl(distro.into())
    }

    pub fn ssh(provider: impl Into<String>) -> Self {
        HostScope::Ssh(provider.into())
    }

    pub fn relay(relay_id: impl Into<String>) -> Self {
        HostScope::Relay(relay_id.into())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RejectionRecord {
    rejected_at: Instant,
}

/// Outcome of `begin_probe`: whether the caller must run the probe (leader)
/// or should wait on the in-flight one (follower). Single-flight coalescing
/// shape only; this module does not itself block or spawn processes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeOutcome {
    Leader,
    Follower,
}

/// Per-host-scope capability rejection memory. A rejection recorded for one
/// `HostScope` never leaks to another. `should_retry` implements the
/// self-heal contract: after `interval` elapses, a caller may retry the
/// preferred command, and a subsequent `record_success` clears the memory.
pub struct CapabilityCache {
    rejections: Mutex<HashMap<(HostScope, Capability), RejectionRecord>>,
    in_flight: Mutex<HashMap<(HostScope, Capability), ()>>,
}

impl Default for CapabilityCache {
    fn default() -> Self {
        Self::new()
    }
}

impl CapabilityCache {
    pub fn new() -> Self {
        Self {
            rejections: Mutex::new(HashMap::new()),
            in_flight: Mutex::new(HashMap::new()),
        }
    }

    pub fn record_rejection(&self, scope: &HostScope, capability: Capability) {
        self.rejections.lock().unwrap().insert(
            (scope.clone(), capability),
            RejectionRecord {
                rejected_at: Instant::now(),
            },
        );
    }

    pub fn record_success(&self, scope: &HostScope, capability: Capability) {
        self.rejections
            .lock()
            .unwrap()
            .remove(&(scope.clone(), capability));
    }

    pub fn is_rejected(&self, scope: &HostScope, capability: Capability) -> bool {
        self.rejections
            .lock()
            .unwrap()
            .contains_key(&(scope.clone(), capability))
    }

    /// True when the capability was never rejected, or the rejection is
    /// older than `interval` and eligible for a self-heal retry.
    pub fn should_retry(
        &self,
        scope: &HostScope,
        capability: Capability,
        interval: Duration,
    ) -> bool {
        match self
            .rejections
            .lock()
            .unwrap()
            .get(&(scope.clone(), capability))
        {
            None => true,
            Some(record) => record.rejected_at.elapsed() >= interval,
        }
    }

    /// Single-flight probe coalescing: the first caller for a given
    /// `(scope, capability)` becomes the `Leader` and must run the probe;
    /// concurrent callers before `finish_probe` get `Follower` and must not
    /// duplicate the process spawn.
    pub fn begin_probe(&self, scope: &HostScope, capability: Capability) -> ProbeOutcome {
        use std::collections::hash_map::Entry;

        let mut in_flight = self.in_flight.lock().unwrap();
        match in_flight.entry((scope.clone(), capability)) {
            Entry::Occupied(_) => ProbeOutcome::Follower,
            Entry::Vacant(slot) => {
                slot.insert(());
                ProbeOutcome::Leader
            }
        }
    }

    pub fn finish_probe(&self, scope: &HostScope, capability: Capability) {
        self.in_flight
            .lock()
            .unwrap()
            .remove(&(scope.clone(), capability));
    }

    /// Read-only peek: true while a Leader's probe for `(scope, capability)`
    /// is still in flight. Unlike `begin_probe`, never inserts — a Follower
    /// can poll this repeatedly without risking becoming a new Leader itself
    /// the moment the real Leader finishes.
    ///
    /// `#[allow(dead_code)]`: exercised by `crate::git_process`'s Follower
    /// path and by `tests/git_process_bounds.rs`, not by `tests/git_baseline.rs`
    /// (this method's own `#[path]` inclusion there predates it) — the
    /// attribute lives here, on the item itself, so it applies wherever this
    /// source file is compiled without needing to edit that other test file.
    #[allow(dead_code)]
    pub fn is_in_flight(&self, scope: &HostScope, capability: Capability) -> bool {
        self.in_flight
            .lock()
            .unwrap()
            .contains_key(&(scope.clone(), capability))
    }
}

/// RAII obligation for a future execution layer: hold one of these across
/// every fallible probe call made between `begin_probe` and its natural
/// completion (including calls that may bail out early via `?`). `Drop`
/// calls `finish_probe` unconditionally, so an early return can never leave
/// a `(scope, capability)` pair stuck reporting `Follower` forever because
/// nothing called `finish_probe` on the error path. This module does not
/// itself run any probe; it only defines the guard shape the caller who
/// eventually does must use.
pub struct ProbeGuard<'a> {
    cache: &'a CapabilityCache,
    scope: HostScope,
    capability: Capability,
}

impl<'a> ProbeGuard<'a> {
    pub fn new(cache: &'a CapabilityCache, scope: HostScope, capability: Capability) -> Self {
        Self {
            cache,
            scope,
            capability,
        }
    }
}

impl Drop for ProbeGuard<'_> {
    fn drop(&mut self) {
        self.cache.finish_probe(&self.scope, self.capability);
    }
}

/// One row of the ordered probe list: the preferred command to try first,
/// and the baseline-compatible fallback if the preferred form is rejected.
/// Data only — this change does not spawn any process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbePlanEntry {
    pub capability: Capability,
    pub preferred_command: Vec<String>,
    pub fallback_command: Vec<String>,
}

fn cmd(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

/// The ordered probe list with a fallback command per capability, mirroring
/// `docs/reference/git-compatibility.md#current-capabilities`. Order
/// reflects the dependency for command construction (fetch/worktree probes
/// before ref/merge probes), not measured cost.
///
/// # INERT DATA — must not be executed as capability discovery
///
/// This function returns a plain data table, not a runnable discovery
/// procedure. Do not feed these `preferred_command`/`fallback_command`
/// vectors straight to a process spawn as a "try the preferred command, fall
/// back on rejection" probe: several rows are unsafe or outright invalid
/// run that way —
/// - `FetchNoWriteFetchHead`'s commands are a real, unbounded `git fetch
///   origin`: a mutating network call with no timeout, no scope limit, and
///   real side effects on failure/partial completion.
/// - `MergeTreeWriteTree` / `MergeTreeMergeBase`'s commands omit the
///   revision arguments `git merge-tree` requires, so as written they are
///   not valid invocations, let alone safe ones.
/// - `DecoratePlaceholder`'s `git log` commands carry no `-n`/revision
///   range and would walk the entire unbounded history.
///
/// A future execution layer must redesign each row as a bounded, revision-
/// scoped operation wrapper — and hold a [`ProbeGuard`] across every
/// fallible call the wrapper makes — before any of these commands are
/// actually spawned. Until that redesign lands, treat this table as
/// documentation, never as an executable plan.
pub fn baseline_probe_plan() -> Vec<ProbePlanEntry> {
    vec![
        ProbePlanEntry {
            capability: Capability::FetchNoWriteFetchHead,
            preferred_command: cmd(&["fetch", "--no-write-fetch-head", "origin"]),
            fallback_command: cmd(&["fetch", "origin"]),
        },
        ProbePlanEntry {
            capability: Capability::WorktreeListZ,
            // Real Git rejects a bare `-z`: "fatal: the option '-z'
            // requires '--porcelain'" (verified live against Git 2.50.1).
            // `--porcelain` alone is also the pre-2.36 line-block fallback
            // the worktree parser already handles.
            preferred_command: cmd(&["worktree", "list", "--porcelain", "-z"]),
            fallback_command: cmd(&["worktree", "list", "--porcelain"]),
        },
        ProbePlanEntry {
            capability: Capability::RevParsePathFormat,
            preferred_command: cmd(&["rev-parse", "--path-format=absolute", "--git-dir"]),
            fallback_command: cmd(&["rev-parse", "--git-dir"]),
        },
        ProbePlanEntry {
            capability: Capability::ForEachRefExclude,
            preferred_command: cmd(&[
                "for-each-ref",
                "--exclude=refs/remotes/*/HEAD",
                "refs/remotes",
            ]),
            fallback_command: cmd(&["for-each-ref", "refs/remotes"]),
        },
        ProbePlanEntry {
            capability: Capability::MergeTreeWriteTree,
            preferred_command: cmd(&["merge-tree", "--write-tree"]),
            fallback_command: cmd(&["merge-tree"]),
        },
        ProbePlanEntry {
            capability: Capability::MergeTreeMergeBase,
            preferred_command: cmd(&["merge-tree", "--write-tree", "--merge-base"]),
            fallback_command: cmd(&["merge-tree", "--write-tree"]),
        },
        ProbePlanEntry {
            capability: Capability::DecoratePlaceholder,
            preferred_command: cmd(&["log", "--format=%(decorate:separator=\x1f)"]),
            fallback_command: cmd(&["log", "--format=%D"]),
        },
    ]
}

// --- status --porcelain=v2 baseline parser ---------------------------------

/// Parsed `# branch.*` header lines. Every field is optional: a shallow or
/// detached-HEAD repo may omit some of them, and the baseline parser must
/// not require post-2.25 fields.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StatusHeader {
    pub oid: Option<String>,
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: Option<i64>,
    pub behind: Option<i64>,
}

/// A single non-header status line, restricted to the baseline subset:
/// ordinary changed entries (`1`), rename/copy entries (`2`), unmerged
/// conflict entries (`u`), untracked (`?`) and ignored (`!`) paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusEntry {
    Ordinary {
        xy: String,
        path: String,
    },
    RenameOrCopy {
        xy: String,
        score: String,
        path: String,
        orig_path: String,
    },
    Unmerged {
        xy: String,
        path: String,
    },
    Untracked {
        path: String,
    },
    Ignored {
        path: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedStatus {
    pub header: StatusHeader,
    pub entries: Vec<StatusEntry>,
    /// Names from `git remote` (never URLs: those can carry credentials).
    /// Empty when the repo has no remote configured. Filled by the status
    /// runner, not the porcelain parser (porcelain carries no remote list).
    pub remotes: Vec<String>,
}

fn parse_ab(field: &str) -> Result<(Option<i64>, Option<i64>), RpcError> {
    // Expected shape: "+<ahead> -<behind>", e.g. "+1 -2". Split on chars, not
    // bytes: `split_at(1)` on a byte index panics whenever the first
    // character of a malformed part is multi-byte UTF-8 (it lands mid-
    // character rather than on a char boundary), so every split here goes
    // through `chars()` instead.
    let mut ahead = None;
    let mut behind = None;
    for part in field.split_whitespace() {
        let mut chars = part.chars();
        let sign = chars.next().ok_or_else(|| {
            error::invalid_argument(format!("malformed branch.ab field: {field}"))
        })?;
        let digits: String = chars.collect();
        let value: i64 = digits
            .parse()
            .map_err(|_| error::invalid_argument(format!("malformed branch.ab field: {field}")))?;
        match sign {
            '+' => ahead = Some(value),
            '-' => behind = Some(value),
            _ => {
                return Err(error::invalid_argument(format!(
                    "malformed branch.ab field: {field}"
                )));
            }
        }
    }
    Ok((ahead, behind))
}

fn parse_header_line(line: &str, header: &mut StatusHeader) -> Result<(), RpcError> {
    let rest = line
        .strip_prefix("# ")
        .ok_or_else(|| error::invalid_argument(format!("malformed header line: {line}")))?;
    let (key, value) = rest
        .split_once(' ')
        .ok_or_else(|| error::invalid_argument(format!("malformed header line: {line}")))?;
    match key {
        "branch.oid" => header.oid = Some(value.to_string()),
        "branch.head" => header.head = Some(value.to_string()),
        "branch.upstream" => header.upstream = Some(value.to_string()),
        "branch.ab" => {
            let (ahead, behind) = parse_ab(value)?;
            header.ahead = ahead;
            header.behind = behind;
        }
        // Baseline parser: unrecognized header keys are preserved-forward
        // (ignored) rather than rejected, so a newer Git's additional
        // header lines don't break the baseline subset.
        _ => {}
    }
    Ok(())
}

/// Unescapes one C-quoted-path byte payload (the content between the
/// surrounding `"` `"`, already stripped by the caller): `\\`, `\"`, the
/// standard C control-char escapes, and octal `\NNN` byte escapes (which may
/// chain across multiple escapes to spell one multi-byte UTF-8 character).
/// Per `core.quotePath` (see `git-config(1)`), Git emits exactly this form
/// for any path containing a byte outside the printable-ASCII range or a
/// quoting-metacharacter.
fn c_unquote(quoted: &str) -> Result<String, RpcError> {
    let bytes = quoted.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b != b'\\' {
            out.push(b);
            i += 1;
            continue;
        }
        i += 1;
        let esc = *bytes.get(i).ok_or_else(|| {
            error::invalid_argument(format!("truncated C-quote escape: {quoted}"))
        })?;
        match esc {
            b'\\' => {
                out.push(b'\\');
                i += 1;
            }
            b'"' => {
                out.push(b'"');
                i += 1;
            }
            b'n' => {
                out.push(b'\n');
                i += 1;
            }
            b't' => {
                out.push(b'\t');
                i += 1;
            }
            b'r' => {
                out.push(b'\r');
                i += 1;
            }
            b'a' => {
                out.push(0x07);
                i += 1;
            }
            b'b' => {
                out.push(0x08);
                i += 1;
            }
            b'f' => {
                out.push(0x0c);
                i += 1;
            }
            b'v' => {
                out.push(0x0b);
                i += 1;
            }
            b'0'..=b'7' => {
                if i + 3 > bytes.len() {
                    return Err(error::invalid_argument(format!(
                        "truncated octal escape in C-quoted path: {quoted}"
                    )));
                }
                let octal = std::str::from_utf8(&bytes[i..i + 3]).map_err(|_| {
                    error::invalid_argument(format!(
                        "invalid octal escape in C-quoted path: {quoted}"
                    ))
                })?;
                let value = u8::from_str_radix(octal, 8).map_err(|_| {
                    error::invalid_argument(format!(
                        "invalid octal escape in C-quoted path: {quoted}"
                    ))
                })?;
                out.push(value);
                i += 3;
            }
            other => {
                return Err(error::invalid_argument(format!(
                    "unknown C-quote escape '\\{}' in path: {quoted}",
                    other as char
                )));
            }
        }
    }
    String::from_utf8(out)
        .map_err(|_| error::invalid_argument(format!("C-quoted path is not valid UTF-8: {quoted}")))
}

/// Unescapes `path` if it is C-quoted (wrapped in `"` `"`), otherwise returns
/// it unchanged. Only the line-oriented porcelain form quotes paths; `-z`
/// output never does (see `parse_status_porcelain_v2_z`).
fn unquote_path(path: String) -> Result<String, RpcError> {
    if path.len() >= 2 && path.starts_with('"') && path.ends_with('"') {
        c_unquote(&path[1..path.len() - 1])
    } else {
        Ok(path)
    }
}

fn require_non_empty_path(path: String, line: &str) -> Result<String, RpcError> {
    if path.is_empty() {
        return Err(error::invalid_argument(format!(
            "malformed status entry (empty path): {line}"
        )));
    }
    Ok(path)
}

fn parse_ordinary_or_unmerged(line: &str, quoted: bool) -> Result<StatusEntry, RpcError> {
    let is_unmerged = line.starts_with("u ");
    let fields: Vec<&str> = line.split(' ').collect();
    let min_fields = if is_unmerged { 11 } else { 9 };
    if fields.len() < min_fields {
        return Err(error::invalid_argument(format!(
            "malformed status entry (too few fields): {line}"
        )));
    }
    let xy = fields[1].to_string();
    let path = fields[min_fields - 1..].join(" ");
    let path = require_non_empty_path(path, line)?;
    let path = if quoted {
        require_non_empty_path(unquote_path(path)?, line)?
    } else {
        path
    };
    if is_unmerged {
        Ok(StatusEntry::Unmerged { xy, path })
    } else {
        Ok(StatusEntry::Ordinary { xy, path })
    }
}

fn parse_rename_or_copy(line: &str) -> Result<StatusEntry, RpcError> {
    let fields: Vec<&str> = line.split(' ').collect();
    // "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>"
    if fields.len() < 10 {
        return Err(error::invalid_argument(format!(
            "malformed rename/copy entry (too few fields): {line}"
        )));
    }
    let xy = fields[1].to_string();
    let score = fields[8].to_string();
    let tail = fields[9..].join(" ");
    let (path, orig_path) = tail.split_once('\t').ok_or_else(|| {
        error::invalid_argument(format!(
            "malformed rename/copy entry (missing tab-separated origPath): {line}"
        ))
    })?;
    if path.is_empty() || orig_path.is_empty() {
        return Err(error::invalid_argument(format!(
            "malformed rename/copy entry (empty path): {line}"
        )));
    }
    let path = require_non_empty_path(unquote_path(path.to_string())?, line)?;
    let orig_path = require_non_empty_path(unquote_path(orig_path.to_string())?, line)?;
    Ok(StatusEntry::RenameOrCopy {
        xy,
        score,
        path,
        orig_path,
    })
}

/// Strips exactly the one format-separator space after the `?`/`!` marker
/// (`prefix_len` bytes) and, for the line-oriented (`quoted`) form,
/// C-unquotes the remainder. Anything past that one separator is the path
/// verbatim, including further leading spaces that are part of the real
/// filename — `trim_start` would silently eat those too.
fn parse_path_only(prefix_len: usize, line: &str, quoted: bool) -> Result<String, RpcError> {
    let rest = &line[prefix_len..];
    let path = rest.strip_prefix(' ').unwrap_or(rest);
    let path = require_non_empty_path(path.to_string(), line)?;
    if quoted {
        require_non_empty_path(unquote_path(path)?, line)
    } else {
        Ok(path)
    }
}

/// Parses the stable `git status --porcelain=v2` baseline subset: header
/// lines and entry kinds `1`/`2`/`u`/`?`/`!`. Never assumes a post-2.25
/// feature; malformed input returns `invalid_argument` rather than
/// panicking or silently dropping data.
pub fn parse_status_porcelain_v2(input: &str) -> Result<ParsedStatus, RpcError> {
    let mut header = StatusHeader::default();
    let mut entries = Vec::new();

    for line in input.lines() {
        if line.is_empty() {
            continue;
        }
        if line.starts_with("# ") {
            parse_header_line(line, &mut header)?;
            continue;
        }
        let kind = line
            .split(' ')
            .next()
            .ok_or_else(|| error::invalid_argument(format!("empty status line: {line}")))?;
        match kind {
            "1" | "u" => entries.push(parse_ordinary_or_unmerged(line, true)?),
            "2" => entries.push(parse_rename_or_copy(line)?),
            "?" => entries.push(StatusEntry::Untracked {
                path: parse_path_only(1, line, true)?,
            }),
            "!" => entries.push(StatusEntry::Ignored {
                path: parse_path_only(1, line, true)?,
            }),
            _ => {
                return Err(error::invalid_argument(format!(
                    "unknown status line prefix: {line}"
                )));
            }
        }
    }

    Ok(ParsedStatus {
        header,
        entries,
        // The porcelain carries no remote list; the status runner fills
        // this from `git remote` after parsing.
        remotes: Vec::new(),
    })
}

fn parse_rename_or_copy_z(
    entry_token: &str,
    orig_path_token: Option<&str>,
) -> Result<StatusEntry, RpcError> {
    let fields: Vec<&str> = entry_token.split(' ').collect();
    // "-z" shape: "2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>",
    // with origPath as its own NUL-terminated token immediately after (no
    // tab separator, no C-quoting — `-z` disables path quoting entirely).
    if fields.len() < 10 {
        return Err(error::invalid_argument(format!(
            "malformed rename/copy entry (too few fields): {entry_token}"
        )));
    }
    let xy = fields[1].to_string();
    let score = fields[8].to_string();
    let path = fields[9..].join(" ");
    let orig_path = orig_path_token.ok_or_else(|| {
        error::invalid_argument(format!(
            "malformed rename/copy entry (missing NUL-separated origPath): {entry_token}"
        ))
    })?;
    if path.is_empty() || orig_path.is_empty() {
        return Err(error::invalid_argument(format!(
            "malformed rename/copy entry (empty path): {entry_token}"
        )));
    }
    Ok(StatusEntry::RenameOrCopy {
        xy,
        score,
        path,
        orig_path: orig_path.to_string(),
    })
}

/// Parses the NUL-delimited (`-z`) form of `git status --porcelain=v2`:
/// same header/entry kinds as [`parse_status_porcelain_v2`], but records are
/// NUL-terminated instead of newline-terminated, paths are never C-quoted
/// (verbatim bytes, since NUL — the only byte a real filename can never
/// contain — is already an unambiguous separator), and a rename/copy
/// entry's `origPath` is its own separate NUL-terminated token rather than
/// tab-appended to the same record.
pub fn parse_status_porcelain_v2_z(input: &str) -> Result<ParsedStatus, RpcError> {
    let mut header = StatusHeader::default();
    let mut entries = Vec::new();

    // Split on NUL but do NOT filter out empty tokens: `input` is a sequence
    // of NUL-*terminated* records, so a well-formed input's only empty token
    // is the single trailing artifact after the final terminator (or none,
    // for empty input). Blanket-filtering every empty token (the previous
    // behavior) silently deletes a malformed empty `origPath` token too —
    // shifting every later `tokens.get(i + 1)` lookup onto what should have
    // been the START of the NEXT record, so a crafted empty-origPath rename
    // record would corrupt/consume that following record as if it were this
    // one's origPath instead of being rejected. Preserving positions and
    // dropping only the one legitimate trailing empty artifact makes that
    // shape a normal "unknown status line prefix" or "empty origPath"
    // rejection instead.
    let mut tokens: Vec<&str> = input.split('\0').collect();
    if tokens.last() == Some(&"") {
        tokens.pop();
    }
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        if token.starts_with("# ") {
            parse_header_line(token, &mut header)?;
            i += 1;
            continue;
        }
        let kind = token
            .split(' ')
            .next()
            .ok_or_else(|| error::invalid_argument(format!("empty status entry: {token}")))?;
        match kind {
            "1" | "u" => {
                entries.push(parse_ordinary_or_unmerged(token, false)?);
                i += 1;
            }
            "2" => {
                entries.push(parse_rename_or_copy_z(token, tokens.get(i + 1).copied())?);
                i += 2;
            }
            "?" => {
                entries.push(StatusEntry::Untracked {
                    path: parse_path_only(1, token, false)?,
                });
                i += 1;
            }
            "!" => {
                entries.push(StatusEntry::Ignored {
                    path: parse_path_only(1, token, false)?,
                });
                i += 1;
            }
            _ => {
                return Err(error::invalid_argument(format!(
                    "unknown status line prefix: {token}"
                )));
            }
        }
    }

    Ok(ParsedStatus {
        header,
        entries,
        // The porcelain carries no remote list; the status runner fills
        // this from `git remote` after parsing.
        remotes: Vec::new(),
    })
}

#[allow(dead_code)]
fn all_capabilities() -> &'static [Capability; 7] {
    &Capability::ALL
}
