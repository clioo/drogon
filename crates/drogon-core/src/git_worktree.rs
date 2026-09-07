//! `git worktree list` parsing (NUL-delimited `-z` and legacy line-block
//! forms) and a safe `git worktree add` path/branch validator. See
//! `docs/migration/verticals/V3/git-worktree-safety.md` and the
//! `worktree-list-z` row in `docs/reference/git-compatibility.md`. This
//! module is pure/std-only: no process spawning, no I/O. It does not import
//! `crate::git` (both modules are wired into this crate's module tree, but
//! this module deliberately keeps no source dependency on that one), so the
//! `worktree-list-z` capability is referenced by its exact string key rather
//! than the enum.

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

/// Verified live against Git 2.50.1: unlike `git status --porcelain=v2`,
/// `git worktree list --porcelain` (line-block form, no `-z`) NEVER C-quotes
/// its `worktree <path>` field, even for a path containing a literal `"`, a
/// raw control byte, a tab, or non-ASCII bytes, and even with
/// `core.quotePath=true` forced — the line form has no escaping mechanism at
/// all (that gap is exactly why `-z` exists for this command). So a `"`-
/// wrapped-looking path here is never C-quoted; it is either a raw path that
/// happens to start and end with a literal `"` character, or (in the never-
/// observed case a future/older Git actually emits real C-quoting here) an
/// escape sequence we cannot safely tell apart from that literal case. Do
/// NOT reuse `crate::git`'s status-parser C-unquote heuristic here: applying
/// it would corrupt or reject a real path that legitimately starts and ends
/// with `"`, since (unlike status output) a `"`-wrapped path is not proof of
/// quoting in this command's output.
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
/// because this module deliberately keeps no source dependency on
/// `crate::git` (see the module doc comment), even though both are wired
/// into this crate's module tree; `tests/git_worktree.rs`'s pre-existing
/// `#[path]` include and `tests/git_public_api.rs`'s public-API test both
/// cross-check this constant against the real enum, so the two cannot
/// silently drift.
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

/// True for a Windows "drive-relative" path: `C:foo` or a bare `C:` (a drive
/// letter followed by `:` with no `/` or `\` immediately after). This form
/// is syntactically indistinguishable from an ordinary relative path by eye,
/// but on Windows it resolves against the *current directory of that drive
/// letter* — a per-process, per-drive slot this module has no visibility
/// into and that has nothing to do with `root`. It must be rejected under
/// the same "not actually relative to root" policy as a drive-absolute path
/// (`is_absolute_path`); a drive-absolute path is already unconditionally
/// rejected below because this module enforces "relative to root" via
/// `path` alone (no filesystem containment check against `root` — see
/// `validate_worktree_add`'s doc comment), so any path that is not
/// unambiguously relative already necessarily escapes that policy.
fn is_drive_relative_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && !(bytes.len() >= 3 && (bytes[2] == b'/' || bytes[2] == b'\\'))
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
    if is_drive_relative_path(path) {
        return Err(error::invalid_argument(format!(
            "worktree path must not be a Windows drive-relative path: {path}"
        )));
    }
    if split_segments(path).any(|segment| segment == "..") {
        return Err(error::invalid_argument(format!(
            "worktree path must not escape root via '..': {path}"
        )));
    }
    Ok(())
}

/// Refuses a branch name that `git check-ref-format --allow-onelevel` (or a
/// shell splitting its argument list) would treat unsafely.
///
/// # NOT a complete lexical implementation of `check-ref-format`
///
/// This is a defensive pre-check against the shapes this codebase's callers
/// are most likely to hit (whitespace/control-character/option-injection
/// argv hazards, plus the ref-syntax rules verified live against this host's
/// installed `git check-ref-format --allow-onelevel` on Git 2.50.1, see the
/// matrix below). It never claims to be a complete reimplementation of
/// `check-ref-format`'s grammar, and future Git versions may add rules this
/// function does not know about. `git check-ref-format` (invoked directly,
/// or transitively by whatever `git` subcommand consumes the branch name)
/// remains the sole authoritative validator at execution time; this
/// function's job is only to reject obviously-unsafe input before it ever
/// reaches an argv, not to replace that final check.
///
/// Verified-live rules covered here (all against
/// `git check-ref-format --allow-onelevel <name>`):
/// - whitespace or ASCII control characters anywhere (rule 3)
/// - the glyphs `~^:?*[` anywhere (rules 3-4)
/// - a backslash `\` anywhere (rule 9)
/// - the literal sequence `@{` anywhere (rule 7)
/// - the single character `@` (rule 8)
/// - a leading `-` (not a `check-ref-format` rule; an option-injection shape
///   for callers that pass this name on a `git` argv)
/// - an empty `/`-separated component, which also catches a leading `/`, a
///   trailing `/`, and `//` (rule 5)
/// - two consecutive dots `..` anywhere (rule 2)
/// - a trailing dot `.` on the whole name (rule 6; verified live that this
///   is NOT a per-component rule: `foo./bar` is accepted by real Git, only
///   a dot at the very end of the whole name is rejected)
/// - a `/`-separated component starting with `.`, or ending with `.lock`
///   (rule 1; verified live that both ARE per-component: `foo/.bar` and
///   `sub.lock/bar` are both rejected even though neither is the whole name)
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
    if name == "@" {
        return Err(error::invalid_argument(
            "branch name must not be the single character '@'".to_string(),
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
    if name.contains('\\') {
        return Err(error::invalid_argument(format!(
            "branch name must not contain '\\': {name}"
        )));
    }
    if name.contains("@{") {
        return Err(error::invalid_argument(format!(
            "branch name must not contain '@{{': {name}"
        )));
    }
    if name.starts_with('-') {
        return Err(error::invalid_argument(format!(
            "branch name must not start with '-': {name}"
        )));
    }
    if name.split('/').any(|component| component.is_empty()) {
        return Err(error::invalid_argument(format!(
            "branch name must not start or end with '/', or contain '//': {name}"
        )));
    }
    if name.contains("..") {
        return Err(error::invalid_argument(format!(
            "branch name must not contain '..': {name}"
        )));
    }
    if name.ends_with('.') {
        return Err(error::invalid_argument(format!(
            "branch name must not end with '.': {name}"
        )));
    }
    for component in name.split('/') {
        if component.starts_with('.') {
            return Err(error::invalid_argument(format!(
                "branch name component must not start with '.': {name}"
            )));
        }
        if component.ends_with(".lock") {
            return Err(error::invalid_argument(format!(
                "branch name component must not end with '.lock': {name}"
            )));
        }
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
