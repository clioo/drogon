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
    pub fn should_retry(&self, scope: &HostScope, capability: Capability, interval: Duration) -> bool {
        match self.rejections.lock().unwrap().get(&(scope.clone(), capability)) {
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
pub fn baseline_probe_plan() -> Vec<ProbePlanEntry> {
    vec![
        ProbePlanEntry {
            capability: Capability::FetchNoWriteFetchHead,
            preferred_command: cmd(&["fetch", "--no-write-fetch-head", "origin"]),
            fallback_command: cmd(&["fetch", "origin"]),
        },
        ProbePlanEntry {
            capability: Capability::WorktreeListZ,
            preferred_command: cmd(&["worktree", "list", "-z"]),
            fallback_command: cmd(&["worktree", "list"]),
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
}

fn parse_ab(field: &str) -> Result<(Option<i64>, Option<i64>), RpcError> {
    // Expected shape: "+<ahead> -<behind>", e.g. "+1 -2".
    let mut ahead = None;
    let mut behind = None;
    for part in field.split_whitespace() {
        let (sign, digits) = part.split_at(1);
        let value: i64 = digits
            .parse()
            .map_err(|_| error::invalid_argument(format!("malformed branch.ab field: {field}")))?;
        match sign {
            "+" => ahead = Some(value),
            "-" => behind = Some(value),
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

fn parse_ordinary_or_unmerged(line: &str) -> Result<StatusEntry, RpcError> {
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
    if path.is_empty() {
        return Err(error::invalid_argument(format!(
            "malformed status entry (empty path): {line}"
        )));
    }
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
    let (path, orig_path) = tail
        .split_once('\t')
        .ok_or_else(|| {
            error::invalid_argument(format!(
                "malformed rename/copy entry (missing tab-separated origPath): {line}"
            ))
        })?;
    if path.is_empty() || orig_path.is_empty() {
        return Err(error::invalid_argument(format!(
            "malformed rename/copy entry (empty path): {line}"
        )));
    }
    Ok(StatusEntry::RenameOrCopy {
        xy,
        score,
        path: path.to_string(),
        orig_path: orig_path.to_string(),
    })
}

fn parse_path_only(prefix_len: usize, line: &str) -> Result<String, RpcError> {
    let path = line[prefix_len..].trim_start();
    if path.is_empty() {
        return Err(error::invalid_argument(format!(
            "malformed status entry (empty path): {line}"
        )));
    }
    Ok(path.to_string())
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
            "1" | "u" => entries.push(parse_ordinary_or_unmerged(line)?),
            "2" => entries.push(parse_rename_or_copy(line)?),
            "?" => entries.push(StatusEntry::Untracked {
                path: parse_path_only(1, line)?,
            }),
            "!" => entries.push(StatusEntry::Ignored {
                path: parse_path_only(1, line)?,
            }),
            _ => {
                return Err(error::invalid_argument(format!(
                    "unknown status line prefix: {line}"
                )));
            }
        }
    }

    Ok(ParsedStatus { header, entries })
}

#[allow(dead_code)]
fn all_capabilities() -> &'static [Capability; 7] {
    &Capability::ALL
}
