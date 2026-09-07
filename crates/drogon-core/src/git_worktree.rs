//! `git worktree list` parsing (NUL-delimited `-z` and legacy line-block
//! forms) and a safe `git worktree add` path/branch validator. See
//! `docs/migration/verticals/V3/git-worktree-safety.md` and the
//! `worktree-list-z` row in `docs/reference/git-compatibility.md`. This
//! module is pure/std-only: no process spawning, no I/O. It does not import
//! `crate::git` (that module is not wired into this crate's module tree yet,
//! per `git_baseline.rs`'s test comment), so the `worktree-list-z`
//! capability is referenced by its exact string key rather than the enum.

use std::path::Path;

use crate::error;
use drogon_protocol::RpcError;

/// One parsed record from `git worktree list --porcelain` or
/// `--porcelain -z`. `locked`/`prunable` capture only presence: Git's
/// optional free-text reason after either keyword is not preserved, matching
/// this module's field list.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorktreeEntry {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
}

fn build_entry(lines: &[&str]) -> Result<WorktreeEntry, RpcError> {
    let mut entry = WorktreeEntry::default();
    let mut saw_worktree = false;

    for (i, line) in lines.iter().enumerate() {
        if i == 0 {
            let path = line.strip_prefix("worktree ").ok_or_else(|| {
                error::invalid_argument(format!(
                    "malformed worktree record (expected 'worktree <path>' first): {line}"
                ))
            })?;
            if path.is_empty() {
                return Err(error::invalid_argument(
                    "malformed worktree record: empty path".to_string(),
                ));
            }
            entry.path = path.to_string();
            saw_worktree = true;
            continue;
        }

        if let Some(head) = line.strip_prefix("HEAD ") {
            entry.head = Some(head.to_string());
        } else if let Some(branch) = line.strip_prefix("branch ") {
            entry.branch = Some(branch.to_string());
        } else if *line == "bare" {
            entry.bare = true;
        } else if *line == "detached" {
            entry.detached = true;
        } else if *line == "locked" || line.starts_with("locked ") {
            entry.locked = true;
        } else if *line == "prunable" || line.starts_with("prunable ") {
            entry.prunable = true;
        } else {
            return Err(error::invalid_argument(format!(
                "unknown worktree record line: {line}"
            )));
        }
    }

    if !saw_worktree {
        return Err(error::invalid_argument(
            "malformed worktree record: missing 'worktree' line".to_string(),
        ));
    }
    Ok(entry)
}

fn parse_nul_delimited(input: &str) -> Result<Vec<WorktreeEntry>, RpcError> {
    let mut entries = Vec::new();
    let mut current: Vec<&str> = Vec::new();

    for token in input.split('\0') {
        if token.is_empty() {
            if !current.is_empty() {
                entries.push(build_entry(&current)?);
                current.clear();
            }
            continue;
        }
        current.push(token);
    }
    if !current.is_empty() {
        entries.push(build_entry(&current)?);
    }
    Ok(entries)
}

fn parse_line_block(input: &str) -> Result<Vec<WorktreeEntry>, RpcError> {
    let mut entries = Vec::new();
    let mut current: Vec<&str> = Vec::new();

    for line in input.lines() {
        if line.is_empty() {
            if !current.is_empty() {
                entries.push(build_entry(&current)?);
                current.clear();
            }
            continue;
        }
        current.push(line);
    }
    if !current.is_empty() {
        entries.push(build_entry(&current)?);
    }
    Ok(entries)
}

/// Parses either `git worktree list --porcelain -z` output (NUL-delimited
/// fields, record separator is an empty field) or the pre-2.36
/// `git worktree list --porcelain` line-block form (newline-delimited
/// fields, record separator is a blank line). The two forms carry the same
/// field vocabulary, so the caller does not need to know in advance which
/// one it captured: presence of a NUL byte selects the `-z` parser.
pub fn parse_worktree_list_porcelain(input: &str) -> Result<Vec<WorktreeEntry>, RpcError> {
    if input.contains('\0') {
        parse_nul_delimited(input)
    } else {
        parse_line_block(input)
    }
}

// --- worktree-list-z probe plan (string-keyed, no enum duplication) -------

/// The exact `docs/reference/git-compatibility.md#current-capabilities`
/// identifier for this capability, matching
/// `crate::git::Capability::WorktreeListZ.key()`. Referenced by string
/// because `crate::git` is not wired into this crate's module tree (see the
/// module doc comment); a `tests/git_worktree.rs` case cross-checks this
/// constant against the real enum via a `#[path]` include, so the two
/// cannot silently drift.
pub const WORKTREE_LIST_Z_CAPABILITY_KEY: &str = "worktree-list-z";

/// The preferred/fallback command pair for listing worktrees. Data only:
/// this module does not spawn `git`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeProbePlanEntry {
    pub capability_key: &'static str,
    pub preferred_command: Vec<String>,
    pub fallback_command: Vec<String>,
}

fn cmd(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

/// Real Git (verified live on this host, Git 2.50.1) rejects a bare
/// `worktree list -z` with `fatal: the option '-z' requires '--porcelain'`;
/// the preferred command below carries `--porcelain` for that reason. The
/// fallback drops `-z` for Git before 2.36, which understands `--porcelain`
/// without it. See `docs/migration/verticals/V3/git-worktree-safety.md`.
pub fn worktree_list_probe_plan() -> WorktreeProbePlanEntry {
    WorktreeProbePlanEntry {
        capability_key: WORKTREE_LIST_Z_CAPABILITY_KEY,
        preferred_command: cmd(&["worktree", "list", "--porcelain", "-z"]),
        fallback_command: cmd(&["worktree", "list", "--porcelain"]),
    }
}

// --- safe worktree-add validation ------------------------------------------

fn contains_nul(s: &str) -> bool {
    s.bytes().any(|b| b == 0)
}

fn is_absolute_path(path: &str) -> bool {
    if path.starts_with('/') || path.starts_with('\\') {
        return true;
    }
    // Windows drive-letter absolute form, e.g. "C:\x" or "C:/x": relevant
    // even on a non-Windows build host because a worktree add plan may
    // target a Windows or WSL execution host.
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return bytes[2] == b'/' || bytes[2] == b'\\';
    }
    Path::new(path).is_absolute()
}

fn split_segments(path: &str) -> impl Iterator<Item = &str> {
    path.split(['/', '\\'])
}

/// Refuses a candidate `git worktree add <path>` target that is absolute,
/// contains a NUL byte, or traverses outside `root` via a `..` segment. Pure
/// lexical validation: this module does no filesystem I/O, so it cannot
/// detect a symlink-based escape.
fn validate_worktree_path(path: &str) -> Result<(), RpcError> {
    if contains_nul(path) {
        return Err(error::invalid_argument(
            "worktree path must not contain a NUL byte".to_string(),
        ));
    }
    if path.is_empty() {
        return Err(error::invalid_argument(
            "worktree path must not be empty".to_string(),
        ));
    }
    if is_absolute_path(path) {
        return Err(error::invalid_argument(format!(
            "worktree path must be relative to root: {path}"
        )));
    }
    if split_segments(path).any(|segment| segment == "..") {
        return Err(error::invalid_argument(format!(
            "worktree path must not escape root via '..': {path}"
        )));
    }
    Ok(())
}

/// Refuses a branch name that `git check-ref-format` (or a shell splitting
/// its argument list) would treat unsafely: whitespace, control characters,
/// the `~^:?*[` glyphs Git ref syntax gives special meaning to, a leading
/// `-` (an option-injection shape) or `/`, a `..` component separator, and a
/// `.lock` suffix (Git's own lockfile convention).
fn validate_branch_name(name: &str) -> Result<(), RpcError> {
    if contains_nul(name) {
        return Err(error::invalid_argument(
            "branch name must not contain a NUL byte".to_string(),
        ));
    }
    if name.is_empty() {
        return Err(error::invalid_argument(
            "branch name must not be empty".to_string(),
        ));
    }
    if name.chars().any(|c| c == ' ' || c.is_control()) {
        return Err(error::invalid_argument(format!(
            "branch name must not contain whitespace or control characters: {name}"
        )));
    }
    const FORBIDDEN_CHARS: [char; 6] = ['~', '^', ':', '?', '*', '['];
    if name.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return Err(error::invalid_argument(format!(
            "branch name must not contain '~', '^', ':', '?', '*', or '[': {name}"
        )));
    }
    if name.starts_with('-') {
        return Err(error::invalid_argument(format!(
            "branch name must not start with '-': {name}"
        )));
    }
    if name.starts_with('/') {
        return Err(error::invalid_argument(format!(
            "branch name must not start with '/': {name}"
        )));
    }
    if name.contains("..") {
        return Err(error::invalid_argument(format!(
            "branch name must not contain '..': {name}"
        )));
    }
    if name.ends_with(".lock") {
        return Err(error::invalid_argument(format!(
            "branch name must not end with '.lock': {name}"
        )));
    }
    Ok(())
}

/// Validates a planned `git worktree add <path> [<branch>]` invocation
/// before it is ever spawned. `root` is accepted for interface symmetry with
/// the caller's `(root, path, branch)` plan shape; path safety is enforced
/// against `path` itself (absolute-path and `..`-segment rejection), since
/// this module has no filesystem access to canonicalize `root` and probe
/// containment against it.
pub fn validate_worktree_add(root: &str, path: &str, branch: Option<&str>) -> Result<(), RpcError> {
    if contains_nul(root) {
        return Err(error::invalid_argument(
            "worktree root must not contain a NUL byte".to_string(),
        ));
    }
    validate_worktree_path(path)?;
    if let Some(branch_name) = branch {
        validate_branch_name(branch_name)?;
    }
    Ok(())
}
