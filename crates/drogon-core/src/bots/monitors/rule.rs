//! Monitor rule set (C10 checkpoint 1; rule schema v2).
//!
//! v1 shipped exactly one kind: `local_file_digest.v1` — an approved,
//! scoped local-file content digest with bounded bytes and an explicit
//! `(host_id, project_id, resource)` scope.
//!
//! v2 adds two **additive**, serde-tagged kinds behind a schema bump:
//! `script_command.v1` (a hash-pinned script file under the Bot home, run
//! through an allowlisted interpreter with structured argv) and
//! `http_poll.v1` (a GET-only, read-only URL poll identified by URL hash).
//! The existing variant's canonical bytes are unchanged, so already
//! approved `local_file_digest.v1` records stay approved and running.
//!
//! v3 adds one more additive kind: `github_pr.v1`, the owner's headline
//! case — "a pull request was opened (or assigned to me / asks for my
//! review)". It names a repository and a filter, resolves its token from
//! the sealed store by reference, and carries the two per-case dispatch
//! choices (the harness and the skills the released session must use).
//! Every field that can reach a dispatched prompt (`harness`, `skills`,
//! `repo`) is constrained to an id-like alphabet, so a rule can never
//! smuggle free-form prose — and therefore never watched content — into a
//! prompt. Dedupe is by pull-request number, not by response bytes: the
//! same PR never fires twice (see `super::github`).
//!
//! Security posture (the reason these fields live in the rule):
//! - Every approval-relevant field is a field of the rule enum, so
//!   [`MonitorRule::canonical_bytes`]/[`MonitorRule::approval_hash`] cover
//!   it *by construction*. Editing script path, pinned hash, interpreter,
//!   argv, secret refs, URL hash, cursor spec, or any bound changes the
//!   hash, invalidates prior approval, and parks the monitor at
//!   needs-approval. There is deliberately no separate approval path.
//! - `script_command.v1` carries no `cwd`: the working directory is always
//!   the Bot home root, a server constant, never caller input.
//! - `http_poll.v1` carries no `method`: v1 is GET-only and read-only.
//! - The interpreter is a closed allowlist enum, never a free string. The
//!   only admitted v2 interpreter is `GhApi`; `Bun`/`Python3` are reserved
//!   for a reviewed v3 addition.
//!
//! The caller reads file bytes / runs the interpreter (bounded, with its
//! own timeout) outside any DB lock; this module only validates the rule
//! shape and derives the approval hash.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};

/// The original (v1) rule kind string. Its canonical bytes never change.
pub const RULE_KIND_LOCAL_FILE_DIGEST: &str = "local_file_digest.v1";
/// Hash-pinned script rule kind (v2).
pub const RULE_KIND_SCRIPT_COMMAND: &str = "script_command.v1";
/// GET-only URL poll rule kind (v2).
pub const RULE_KIND_HTTP_POLL: &str = "http_poll.v1";
/// GitHub pull-request watch rule kind (v3).
pub const RULE_KIND_GITHUB_PR: &str = "github_pr.v1";
/// Schema version of the rule shape itself.
pub const RULE_SCHEMA_VERSION: u32 = 3;
/// Longest admitted scope/path string in bytes (host, project, resource).
pub const MAX_SCOPE_STRING_BYTES: usize = 1024;
/// Hard ceiling for any monitored file read in bytes (256 KiB).
pub const MAX_FILE_BYTES: u64 = 256 * 1024;
/// How many secret references a single rule may carry.
pub const MAX_SECRET_REFS: usize = 16;

/// Per-argument byte ceiling for `script_command.v1.argv`.
pub const MAX_SCRIPT_ARG_BYTES: usize = 512;
/// How many structured argv elements a script rule may carry.
pub const MAX_SCRIPT_ARGV_ARGS: usize = 64;
/// Script timeout bounds (milliseconds).
pub const MIN_SCRIPT_TIMEOUT_MS: u64 = 1;
pub const MAX_SCRIPT_TIMEOUT_MS: u64 = 60_000;
pub const DEFAULT_SCRIPT_TIMEOUT_MS: u64 = 30_000;
/// Script stdout capture bounds (bytes).
pub const MIN_SCRIPT_OUTPUT_BYTES: u64 = 1;
pub const MAX_SCRIPT_OUTPUT_BYTES: u64 = 256 * 1024;
pub const DEFAULT_SCRIPT_OUTPUT_BYTES: u64 = 64 * 1024;
/// HTTP poll timeout bounds (milliseconds).
pub const MIN_HTTP_TIMEOUT_MS: u64 = 1;
pub const MAX_HTTP_TIMEOUT_MS: u64 = 60_000;
pub const DEFAULT_HTTP_TIMEOUT_MS: u64 = 30_000;
/// HTTP poll body bounds (bytes).
pub const MIN_HTTP_BODY_BYTES: u64 = 1;
pub const MAX_HTTP_BODY_BYTES: u64 = 256 * 1024;
pub const DEFAULT_HTTP_BODY_BYTES: u64 = 64 * 1024;
/// Longest admitted `cursor_spec.path` in bytes.
pub const MAX_HTTP_CURSOR_PATH_BYTES: usize = 512;
/// Longest admitted `github_pr.v1.repo` ("owner/name") in bytes.
pub const MAX_REPO_BYTES: usize = 256;
/// Longest admitted `github_pr.v1.apiBase` in bytes.
pub const MAX_API_BASE_BYTES: usize = 512;
/// Longest admitted `github_pr.v1.harness` in bytes (an id, never prose).
pub const MAX_HARNESS_BYTES: usize = 32;
/// Longest admitted `github_pr.v1.skills[i]` in bytes (an id, never prose).
pub const MAX_SKILL_NAME_BYTES: usize = 64;
/// How many skills one case may name.
pub const MAX_CASE_SKILLS: usize = 16;
/// Longest admitted `github_pr.v1.login` (a GitHub account login).
pub const MAX_LOGIN_BYTES: usize = 39;
/// Default GitHub REST base when the rule names none.
pub const DEFAULT_GITHUB_API_BASE: &str = "https://api.github.com";
/// How many pull requests one poll reads (GitHub's own page ceiling).
pub const GITHUB_PULLS_PER_PAGE: u16 = 100;

/// A single watched file, project-relative. `max_bytes` is the monitor
/// author's own bound and must never exceed [`MAX_FILE_BYTES`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileRule {
    pub host_id: String,
    pub project_id: String,
    /// Project-relative POSIX path (e.g. `notes/status.md`). Never
    /// absolute, never containing `..`.
    pub resource: String,
    pub max_bytes: u64,
}

/// Allowlisted script interpreter. Never a free string: an unknown tag is
/// preserved as [`ScriptInterpreter::Unsupported`] so validation can refuse
/// it with an honest error instead of a deserialization failure that would
/// take down a whole monitor listing. `Unsupported` is never admitted and
/// can never be approved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptInterpreter {
    /// The only admitted v2 interpreter: `gh api` with a server-built,
    /// read-only argv (no flags, GET-shaped).
    GhApi,
    /// Any other tag (`bun`, `python3`, `sh`, …). Representable, never
    /// admitted.
    Unsupported(String),
}

impl ScriptInterpreter {
    pub fn as_str(&self) -> &str {
        match self {
            Self::GhApi => "gh_api",
            Self::Unsupported(other) => other.as_str(),
        }
    }

    /// True only for an interpreter this build is willing to admit.
    pub fn is_allowed(&self) -> bool {
        matches!(self, Self::GhApi)
    }
}

impl Serialize for ScriptInterpreter {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ScriptInterpreter {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "gh_api" => Self::GhApi,
            _ => Self::Unsupported(raw),
        })
    }
}

/// How a `http_poll.v1` cursor is derived from a response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HttpCursorSpec {
    /// The response `ETag` header (opaque, stored as `v1:<hex>`).
    #[serde(rename = "etag")]
    ETag,
    /// A dot/bracket path into the JSON body.
    #[serde(rename = "json_field")]
    JsonField { path: String },
    /// `sha256` of the raw response body.
    #[serde(rename = "body_digest")]
    BodyDigest,
}

impl HttpCursorSpec {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::ETag | Self::BodyDigest => Ok(()),
            Self::JsonField { path } => {
                if path.is_empty() || path.len() > MAX_HTTP_CURSOR_PATH_BYTES {
                    return Err(format!(
                        "cursorSpec.path must be 1..={MAX_HTTP_CURSOR_PATH_BYTES} bytes"
                    ));
                }
                if path.bytes().any(|b| b == 0 || b.is_ascii_control()) {
                    return Err(
                        "cursorSpec.path must not contain NUL or control characters".to_string()
                    );
                }
                Ok(())
            }
        }
    }
}

/// A hash-pinned script file under the Bot home. The script text is never
/// inline in the rule: it lives as a file, and [`ScriptRule::script_hash`]
/// pins the exact approved bytes. There is no `cwd` field by design.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptRule {
    pub host_id: String,
    pub project_id: String,
    /// Home-relative POSIX path (same containment rules as `resource`).
    pub script_path: String,
    /// `sha256` hex of the approved script bytes.
    pub script_hash: String,
    pub interpreter: ScriptInterpreter,
    /// Structured arguments only; never a shell string. At least one
    /// element, each <= [`MAX_SCRIPT_ARG_BYTES`] bytes, no NUL/control
    /// characters, and (for the read-only `GhApi` interpreter) no leading
    /// `-` flag injection.
    pub argv: Vec<String>,
    pub timeout_ms: u64,
    pub max_output_bytes: u64,
    /// Bare secret **names** only; values are never stored here.
    pub secret_refs: Vec<String>,
}

/// A GET-only, read-only URL poll. The URL is approved by hash; the URL
/// text itself is never stored in the rule (a sealed companion row owns
/// it). There is no `method` field by design.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpPollRule {
    pub host_id: String,
    pub project_id: String,
    /// `sha256` hex of the approved URL.
    pub url_hash: String,
    pub timeout_ms: u64,
    pub max_body_bytes: u64,
    pub cursor_spec: HttpCursorSpec,
    pub secret_refs: Vec<String>,
}

/// Which open pull requests a `github_pr.v1` watch considers "for me".
/// The filter is applied to the `assignees` / `requested_reviewers` arrays
/// of GitHub's own pull list, so a rule needs one endpoint and no search
/// query language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubPrFilter {
    /// Any open pull request in the repository.
    Opened,
    /// Open pull requests assigned to `login`.
    Assigned,
    /// Open pull requests that request `login`'s review.
    ReviewRequested,
}

impl GithubPrFilter {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Opened => "opened",
            Self::Assigned => "assigned",
            Self::ReviewRequested => "review_requested",
        }
    }

    /// Parses the wire spelling; `None` for an unknown tag (refused, never
    /// guessed).
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "opened" => Some(Self::Opened),
            "assigned" => Some(Self::Assigned),
            "review_requested" => Some(Self::ReviewRequested),
            _ => None,
        }
    }

    /// Whether this filter needs a login to compare against.
    pub fn requires_login(&self) -> bool {
        !matches!(self, Self::Opened)
    }
}

/// A GitHub pull-request watch: the owner's headline case. `host_id` /
/// `project_id` are the scope; `repo` names the GitHub repository; the
/// filter says which open PRs count as the case. `secret_refs` names the
/// token by REFERENCE only (the value lives in the sealed store and is
/// resolved per tick, never persisted here). `harness` and `skills` are
/// the case's dispatch choices — what the released review session must run
/// with — and they ride inside the approval hash like every other field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrRule {
    pub host_id: String,
    pub project_id: String,
    /// `owner/name`.
    pub repo: String,
    pub filter: GithubPrFilter,
    /// The GitHub login this watch is for. Required unless `filter` is
    /// `opened` (an unfiltered watch compares against nothing).
    pub login: Option<String>,
    /// REST base; `None` means [`DEFAULT_GITHUB_API_BASE`]. A GitHub
    /// Enterprise host (or the test fixture's loopback server) sets it.
    pub api_base: Option<String>,
    pub timeout_ms: u64,
    pub max_body_bytes: u64,
    pub secret_refs: Vec<String>,
    /// Harness the released session must run (e.g. `codex`). `None` leaves
    /// the choice to the Bot's own harness policy.
    pub harness: Option<String>,
    /// Skills the released session must use (the owner's frontend-vs-
    /// backend rule). Ids only — rendered into the delegation prompt, so
    /// the alphabet is constrained, never free text.
    #[serde(default)]
    pub skills: Vec<String>,
}

/// The rule enum. `local_file_digest.v1` is byte-stable; the v2 and v3
/// variants are additive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MonitorRule {
    #[serde(rename = "local_file_digest.v1")]
    LocalFileDigest(LocalFileRule),
    #[serde(rename = "script_command.v1")]
    ScriptCommand(ScriptRule),
    #[serde(rename = "http_poll.v1")]
    HttpPoll(HttpPollRule),
    #[serde(rename = "github_pr.v1")]
    GithubPr(GithubPrRule),
}

impl MonitorRule {
    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::LocalFileDigest(_) => RULE_KIND_LOCAL_FILE_DIGEST,
            Self::ScriptCommand(_) => RULE_KIND_SCRIPT_COMMAND,
            Self::HttpPoll(_) => RULE_KIND_HTTP_POLL,
            Self::GithubPr(_) => RULE_KIND_GITHUB_PR,
        }
    }

    pub fn local_file(&self) -> Option<&LocalFileRule> {
        match self {
            Self::LocalFileDigest(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn script(&self) -> Option<&ScriptRule> {
        match self {
            Self::ScriptCommand(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn http_poll(&self) -> Option<&HttpPollRule> {
        match self {
            Self::HttpPoll(inner) => Some(inner),
            _ => None,
        }
    }

    pub fn github_pr(&self) -> Option<&GithubPrRule> {
        match self {
            Self::GithubPr(inner) => Some(inner),
            _ => None,
        }
    }

    /// The server-resolved `(host_id, project_id)` scope common to every
    /// kind. Scope resolution must never assume the file variant.
    pub fn scope(&self) -> (&str, &str) {
        match self {
            Self::LocalFileDigest(inner) => (&inner.host_id, &inner.project_id),
            Self::ScriptCommand(inner) => (&inner.host_id, &inner.project_id),
            Self::HttpPoll(inner) => (&inner.host_id, &inner.project_id),
            Self::GithubPr(inner) => (&inner.host_id, &inner.project_id),
        }
    }

    /// The `(interpreter, argv, secret_refs)` triple a [`super::record::MonitorRecord`]
    /// must mirror for this kind. The rule is the sole approval authority;
    /// the record-level fields are a denormalized mirror that
    /// `MonitorRecord::validate` keeps in lockstep (file kind: all absent).
    pub fn record_mirror(&self) -> (Option<String>, Vec<String>, Vec<String>) {
        match self {
            Self::LocalFileDigest(_) => (None, Vec::new(), Vec::new()),
            Self::ScriptCommand(inner) => (
                Some(inner.interpreter.as_str().to_string()),
                inner.argv.clone(),
                inner.secret_refs.clone(),
            ),
            Self::HttpPoll(inner) => (None, Vec::new(), inner.secret_refs.clone()),
            Self::GithubPr(inner) => (None, Vec::new(), inner.secret_refs.clone()),
        }
    }

    /// Canonical bytes for approval hashing (field order is stable).
    pub fn canonical_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// Approval hash: `sha256` hex of the canonical rule bytes. Any rule
    /// edit changes this value and invalidates prior approval.
    pub fn approval_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.canonical_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Kind-specific, display-safe fields for monitor views. Uses
    /// `ruleKind` (not `kind`) so the view never collides with the rule's
    /// own serde tag. Secret **names** are visible; values never are.
    pub fn summary_json(&self) -> serde_json::Value {
        use serde_json::json;
        match self {
            Self::LocalFileDigest(inner) => json!({
                "ruleKind": RULE_KIND_LOCAL_FILE_DIGEST,
                "hostId": inner.host_id,
                "projectId": inner.project_id,
                "resource": inner.resource,
                "maxBytes": inner.max_bytes,
            }),
            Self::ScriptCommand(inner) => json!({
                "ruleKind": RULE_KIND_SCRIPT_COMMAND,
                "hostId": inner.host_id,
                "projectId": inner.project_id,
                "scriptPath": inner.script_path,
                "scriptHash": inner.script_hash,
                "interpreter": inner.interpreter.as_str(),
                "argv": inner.argv,
                "timeoutMs": inner.timeout_ms,
                "maxOutputBytes": inner.max_output_bytes,
                "secretRefs": inner.secret_refs,
            }),
            Self::HttpPoll(inner) => json!({
                "ruleKind": RULE_KIND_HTTP_POLL,
                "hostId": inner.host_id,
                "projectId": inner.project_id,
                "urlHash": inner.url_hash,
                "timeoutMs": inner.timeout_ms,
                "maxBodyBytes": inner.max_body_bytes,
                "cursorSpec": inner.cursor_spec,
                "secretRefs": inner.secret_refs,
            }),
            Self::GithubPr(inner) => json!({
                "ruleKind": RULE_KIND_GITHUB_PR,
                "hostId": inner.host_id,
                "projectId": inner.project_id,
                "repo": inner.repo,
                "filter": inner.filter.as_str(),
                "login": inner.login,
                "apiBase": inner.api_base,
                "timeoutMs": inner.timeout_ms,
                "maxBodyBytes": inner.max_body_bytes,
                "secretRefs": inner.secret_refs,
                "caseHarness": inner.harness,
                "caseSkills": inner.skills,
            }),
        }
    }

    /// The effective REST base for a GitHub watch (the rule's own, or the
    /// public API).
    pub fn github_api_base(&self) -> Option<&str> {
        self.github_pr()
            .map(|inner| inner.api_base.as_deref().unwrap_or(DEFAULT_GITHUB_API_BASE))
    }
}

fn is_bad_scope_string(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some("must not be empty".to_string());
    }
    if value.len() > MAX_SCOPE_STRING_BYTES {
        return Some(format!("must be at most {MAX_SCOPE_STRING_BYTES} bytes"));
    }
    if value.bytes().any(|b| b == 0 || b.is_ascii_control()) {
        return Some("must not contain NUL or control characters".to_string());
    }
    None
}

fn validate_relative_path(value: &str, field: &str) -> Result<(), String> {
    if let Some(reason) = is_bad_scope_string(value) {
        return Err(format!("{field} {reason}"));
    }
    if value.starts_with('/') {
        return Err(format!("{field} must be project-relative, not absolute"));
    }
    if value.ends_with('/') {
        return Err(format!("{field} must name a file, not a directory"));
    }
    for segment in value.split('/') {
        if segment.is_empty() {
            return Err(format!("{field} must not contain empty path segments"));
        }
        if segment == "." || segment == ".." {
            return Err(format!("{field} must not contain '.' or '..' segments"));
        }
        if segment.bytes().any(|b| b == b'\\') {
            return Err(format!("{field} must use '/' separators only"));
        }
    }
    Ok(())
}

fn validate_scope(host_id: &str, project_id: &str) -> Result<(), String> {
    if let Some(reason) = is_bad_scope_string(host_id) {
        return Err(format!("hostId {reason}"));
    }
    if let Some(reason) = is_bad_scope_string(project_id) {
        return Err(format!("projectId {reason}"));
    }
    Ok(())
}

fn validate_sha256_hex(value: &str, field: &str) -> Result<(), String> {
    let ok = value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase());
    if !ok {
        return Err(format!(
            "{field} must be 64 lowercase hex characters (sha256 of the approved bytes)"
        ));
    }
    Ok(())
}

/// Bare secret reference: `[A-Za-z0-9_.-]+`, 1..=128 bytes, never a
/// `KEY=value` pair. Values are never accepted here.
pub fn validate_secret_ref(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 {
        return Err("secret reference must be 1..=128 bytes".to_string());
    }
    if value.bytes().any(|b| b == 0 || b.is_ascii_control()) {
        return Err("secret reference must not contain NUL or control characters".to_string());
    }
    if value.contains('=') || value.contains(':') || value.contains('\n') {
        return Err("secret reference must be a bare name, never a KEY=value pair".to_string());
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
    {
        return Err("secret reference must match [A-Za-z0-9_.-]+".to_string());
    }
    Ok(())
}

fn validate_secret_refs(secret_refs: &[String]) -> Result<(), String> {
    if secret_refs.len() > MAX_SECRET_REFS {
        return Err(format!("at most {MAX_SECRET_REFS} secret references"));
    }
    for secret_ref in secret_refs {
        validate_secret_ref(secret_ref)?;
    }
    Ok(())
}

fn validate_arg_bounds(argv: &[String], interpreter: &ScriptInterpreter) -> Result<(), String> {
    if argv.is_empty() {
        return Err("argv must name the operation, not be empty".to_string());
    }
    if argv.len() > MAX_SCRIPT_ARGV_ARGS {
        return Err(format!(
            "argv must have at most {MAX_SCRIPT_ARGV_ARGS} arguments"
        ));
    }
    for (index, arg) in argv.iter().enumerate() {
        if arg.is_empty() {
            return Err(format!("argv[{index}] must not be empty"));
        }
        if arg.len() > MAX_SCRIPT_ARG_BYTES {
            return Err(format!(
                "argv[{index}] must be at most {MAX_SCRIPT_ARG_BYTES} bytes"
            ));
        }
        if arg.bytes().any(|b| b == 0 || b.is_ascii_control()) {
            return Err(format!(
                "argv[{index}] must not contain NUL or control characters"
            ));
        }
        if interpreter.is_allowed() && arg.starts_with('-') {
            return Err(format!(
                "argv[{index}] must not start with '-' — {RULE_KIND_SCRIPT_COMMAND} is read-only"
            ));
        }
    }
    Ok(())
}

fn validate_script_rule(inner: &ScriptRule) -> Result<(), String> {
    validate_scope(&inner.host_id, &inner.project_id)?;
    validate_relative_path(&inner.script_path, "scriptPath")?;
    validate_sha256_hex(&inner.script_hash, "scriptHash")?;
    if !inner.interpreter.is_allowed() {
        return Err(format!(
            "interpreter {:?} is not admitted; the only v2 interpreter is gh_api",
            inner.interpreter.as_str()
        ));
    }
    validate_arg_bounds(&inner.argv, &inner.interpreter)?;
    if inner.timeout_ms < MIN_SCRIPT_TIMEOUT_MS || inner.timeout_ms > MAX_SCRIPT_TIMEOUT_MS {
        return Err(format!(
            "timeoutMs must be {MIN_SCRIPT_TIMEOUT_MS}..={MAX_SCRIPT_TIMEOUT_MS}, got {}",
            inner.timeout_ms
        ));
    }
    if inner.max_output_bytes < MIN_SCRIPT_OUTPUT_BYTES
        || inner.max_output_bytes > MAX_SCRIPT_OUTPUT_BYTES
    {
        return Err(format!(
            "maxOutputBytes must be {MIN_SCRIPT_OUTPUT_BYTES}..={MAX_SCRIPT_OUTPUT_BYTES}, got {}",
            inner.max_output_bytes
        ));
    }
    validate_secret_refs(&inner.secret_refs)?;
    Ok(())
}

/// An id-like token: no whitespace, no control characters, no shell or
/// prompt metacharacters. Used for every rule field that can reach a
/// dispatched prompt (`harness`, `skills`) so a rule cannot smuggle prose
/// — let alone watched content — into model context.
fn is_id_like(value: &str, allowed: &[u8]) -> bool {
    !value.is_empty()
        && value.bytes().all(|b| {
            b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.' || allowed.contains(&b)
        })
}

fn validate_github_pr_rule(inner: &GithubPrRule) -> Result<(), String> {
    validate_scope(&inner.host_id, &inner.project_id)?;
    if inner.repo.len() > MAX_REPO_BYTES {
        return Err(format!("repo must be at most {MAX_REPO_BYTES} bytes"));
    }
    let segments: Vec<&str> = inner.repo.split('/').collect();
    if segments.len() != 2
        || segments
            .iter()
            .any(|segment| !is_id_like(segment, &[]) || segment.len() > 100)
    {
        return Err("repo must be the 'owner/name' slug of a GitHub repository".to_string());
    }
    if inner.filter.requires_login() && inner.login.is_none() {
        return Err(format!(
            "login is required for the {} filter",
            inner.filter.as_str()
        ));
    }
    if let Some(login) = &inner.login {
        let shaped = !login.is_empty()
            && login.len() <= MAX_LOGIN_BYTES
            && login
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-');
        if !shaped {
            return Err(
                "login must be a GitHub account login (letters, digits and '-', 1..=39 bytes)"
                    .to_string(),
            );
        }
    }
    if let Some(api_base) = &inner.api_base {
        if api_base.len() > MAX_API_BASE_BYTES {
            return Err(format!(
                "apiBase must be at most {MAX_API_BASE_BYTES} bytes"
            ));
        }
        let parsed = url::Url::parse(api_base)
            .map_err(|e| format!("apiBase must be an absolute http(s) URL: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("apiBase must use the http or https scheme".to_string());
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("apiBase must not carry credentials".to_string());
        }
        if parsed.host_str().is_none() {
            return Err("apiBase must name a host".to_string());
        }
    }
    if inner.timeout_ms < MIN_HTTP_TIMEOUT_MS || inner.timeout_ms > MAX_HTTP_TIMEOUT_MS {
        return Err(format!(
            "timeoutMs must be {MIN_HTTP_TIMEOUT_MS}..={MAX_HTTP_TIMEOUT_MS}, got {}",
            inner.timeout_ms
        ));
    }
    if inner.max_body_bytes < MIN_HTTP_BODY_BYTES || inner.max_body_bytes > MAX_HTTP_BODY_BYTES {
        return Err(format!(
            "maxBodyBytes must be {MIN_HTTP_BODY_BYTES}..={MAX_HTTP_BODY_BYTES}, got {}",
            inner.max_body_bytes
        ));
    }
    validate_secret_refs(&inner.secret_refs)?;
    if let Some(harness) = &inner.harness
        && (harness.len() > MAX_HARNESS_BYTES || !is_id_like(harness, &[]))
    {
        return Err(
            "harness must be an id-like name (letters, digits, '_', '-', '.') of 1..=32 bytes"
                .to_string(),
        );
    }
    if inner.skills.len() > MAX_CASE_SKILLS {
        return Err(format!("at most {MAX_CASE_SKILLS} skills"));
    }
    for skill in &inner.skills {
        if skill.len() > MAX_SKILL_NAME_BYTES || !is_id_like(skill, &[]) {
            return Err(format!(
                "skill {skill:?} must be an id-like name (letters, digits, '_', '-', '.') of 1..={MAX_SKILL_NAME_BYTES} bytes"
            ));
        }
    }
    Ok(())
}

fn validate_http_poll_rule(inner: &HttpPollRule) -> Result<(), String> {
    validate_scope(&inner.host_id, &inner.project_id)?;
    validate_sha256_hex(&inner.url_hash, "urlHash")?;
    if inner.timeout_ms < MIN_HTTP_TIMEOUT_MS || inner.timeout_ms > MAX_HTTP_TIMEOUT_MS {
        return Err(format!(
            "timeoutMs must be {MIN_HTTP_TIMEOUT_MS}..={MAX_HTTP_TIMEOUT_MS}, got {}",
            inner.timeout_ms
        ));
    }
    if inner.max_body_bytes < MIN_HTTP_BODY_BYTES || inner.max_body_bytes > MAX_HTTP_BODY_BYTES {
        return Err(format!(
            "maxBodyBytes must be {MIN_HTTP_BODY_BYTES}..={MAX_HTTP_BODY_BYTES}, got {}",
            inner.max_body_bytes
        ));
    }
    inner.cursor_spec.validate()?;
    validate_secret_refs(&inner.secret_refs)?;
    Ok(())
}

/// Validate the rule shape. Returns `Ok(())` on success.
pub fn validate_rule(rule: &MonitorRule) -> Result<(), String> {
    match rule {
        MonitorRule::LocalFileDigest(inner) => {
            validate_scope(&inner.host_id, &inner.project_id)?;
            validate_relative_path(&inner.resource, "resource")?;
            if inner.max_bytes == 0 || inner.max_bytes > MAX_FILE_BYTES {
                return Err(format!(
                    "maxBytes must be 1..={MAX_FILE_BYTES}, got {}",
                    inner.max_bytes
                ));
            }
            Ok(())
        }
        MonitorRule::ScriptCommand(inner) => validate_script_rule(inner),
        MonitorRule::HttpPoll(inner) => validate_http_poll_rule(inner),
        MonitorRule::GithubPr(inner) => validate_github_pr_rule(inner),
    }
}

/// Build a `github_pr.v1` rule from an open wire object (the Bot self lane
/// and the user lane share this mapping so the two surfaces cannot drift).
/// The scope is server-resolved, never caller-supplied.
pub fn github_pr_rule_from_wire(
    host_id: &str,
    project_id: &str,
    params: &serde_json::Map<String, serde_json::Value>,
) -> Result<GithubPrRule, String> {
    use serde_json::Value;
    let text = |key: &str| -> Option<String> {
        params
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let repo = text("repo")
        .ok_or_else(|| format!("repo is required for {RULE_KIND_GITHUB_PR} (owner/name)"))?;
    let filter_tag = text("filter").unwrap_or_else(|| "opened".to_string());
    let filter = GithubPrFilter::parse(&filter_tag).ok_or_else(|| {
        format!("unknown filter {filter_tag:?}; opened|assigned|review_requested")
    })?;
    let login = text("login");
    let api_base = text("apiBase");
    let harness = text("harness");
    let skills = match params.get("skills") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .ok_or_else(|| "skills must be an array of non-empty names".to_string())
            })
            .collect::<Result<Vec<String>, String>>()?,
        Some(_) => return Err("skills must be an array of names".to_string()),
    };
    let rule = GithubPrRule {
        host_id: host_id.to_string(),
        project_id: project_id.to_string(),
        repo,
        filter,
        login,
        api_base,
        timeout_ms: params
            .get("timeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_HTTP_TIMEOUT_MS),
        max_body_bytes: params
            .get("maxBodyBytes")
            .and_then(Value::as_u64)
            .unwrap_or(DEFAULT_HTTP_BODY_BYTES),
        secret_refs: match params.get("secretRefs") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(items)) => items
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_string)
                        .ok_or_else(|| "secretRefs must be an array of bare names".to_string())
                })
                .collect::<Result<Vec<String>, String>>()?,
            Some(_) => return Err("secretRefs must be an array of bare names".to_string()),
        },
        harness,
        skills,
    };
    validate_github_pr_rule(&rule)?;
    Ok(rule)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_rule() -> MonitorRule {
        MonitorRule::LocalFileDigest(LocalFileRule {
            host_id: "host-1".to_string(),
            project_id: "proj-1".to_string(),
            resource: "notes/status.md".to_string(),
            max_bytes: 64 * 1024,
        })
    }

    fn script_rule() -> MonitorRule {
        MonitorRule::ScriptCommand(ScriptRule {
            host_id: "host-1".to_string(),
            project_id: "proj-1".to_string(),
            script_path: "scripts/watch.sh".to_string(),
            script_hash: "ab".repeat(32),
            interpreter: ScriptInterpreter::GhApi,
            argv: vec!["repos/clioo/drogon/pulls".to_string()],
            timeout_ms: DEFAULT_SCRIPT_TIMEOUT_MS,
            max_output_bytes: DEFAULT_SCRIPT_OUTPUT_BYTES,
            secret_refs: vec!["GITHUB_TOKEN_REF".to_string()],
        })
    }

    fn http_rule() -> MonitorRule {
        MonitorRule::HttpPoll(HttpPollRule {
            host_id: "host-1".to_string(),
            project_id: "proj-1".to_string(),
            url_hash: "cd".repeat(32),
            timeout_ms: DEFAULT_HTTP_TIMEOUT_MS,
            max_body_bytes: DEFAULT_HTTP_BODY_BYTES,
            cursor_spec: HttpCursorSpec::ETag,
            secret_refs: vec!["GRANOLA_TOKEN".to_string()],
        })
    }

    #[test]
    fn accepts_scoped_relative_file_and_reports_kind() {
        let rule = file_rule();
        assert_eq!(rule.kind_str(), RULE_KIND_LOCAL_FILE_DIGEST);
        assert_eq!(RULE_SCHEMA_VERSION, 3);
        assert!(validate_rule(&rule).is_ok());
    }

    #[test]
    fn local_file_canonical_bytes_are_frozen_across_the_kinds_bump() {
        // Compatibility proof: the v1 variant's canonical bytes are
        // byte-identical to the pre-v2 checkpoint. Already-approved rows
        // keep the same hash and never re-park.
        let expected = concat!(
            r#"{"kind":"local_file_digest.v1","hostId":"host-1","projectId":"proj-1","#,
            r#""resource":"notes/status.md","maxBytes":65536}"#
        );
        assert_eq!(file_rule().canonical_bytes(), expected.as_bytes());
        assert_eq!(
            file_rule().approval_hash(),
            "553e84cd57b5281aa064c2a2857f82153ce4b11c660fb70600a831f6de1cbf8f"
        );
    }

    #[test]
    fn rejects_absolute_and_dotdot_resources() {
        for bad in [
            "/etc/passwd",
            "../secret",
            "a/../../b",
            "dir/",
            "a//b",
            "a\\.md",
        ] {
            let mut rule = file_rule();
            let MonitorRule::LocalFileDigest(inner) = &mut rule else {
                unreachable!()
            };
            inner.resource = bad.to_string();
            assert!(validate_rule(&rule).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn rejects_oversized_and_zero_file_bounds() {
        for bound in [0, MAX_FILE_BYTES + 1] {
            let mut rule = file_rule();
            let MonitorRule::LocalFileDigest(inner) = &mut rule else {
                unreachable!()
            };
            inner.max_bytes = bound;
            assert!(validate_rule(&rule).is_err());
        }
    }

    #[test]
    fn approval_hash_changes_on_any_file_field_edit() {
        let a = file_rule();
        // hostId, projectId, resource, maxBytes — each edit must re-key.
        for mutate in [
            (|r: &mut LocalFileRule| r.host_id = "host-2".into()) as fn(&mut LocalFileRule),
            |r| r.project_id = "proj-2".into(),
            |r| r.resource = "notes/other.md".into(),
            |r| r.max_bytes = 2048,
        ] {
            let mut b = a.clone();
            let MonitorRule::LocalFileDigest(inner) = &mut b else {
                unreachable!()
            };
            mutate(inner);
            assert_ne!(a.approval_hash(), b.approval_hash());
        }
    }

    #[test]
    fn script_rule_validates_and_reports_scope_and_mirror() {
        let rule = script_rule();
        assert_eq!(rule.kind_str(), RULE_KIND_SCRIPT_COMMAND);
        assert_eq!(rule.scope(), ("host-1", "proj-1"));
        assert!(validate_rule(&rule).is_ok());
        let (interpreter, argv, refs) = rule.record_mirror();
        assert_eq!(interpreter.as_deref(), Some("gh_api"));
        assert_eq!(argv, vec!["repos/clioo/drogon/pulls".to_string()]);
        assert_eq!(refs, vec!["GITHUB_TOKEN_REF".to_string()]);
        let MonitorRule::ScriptCommand(inner) = &rule else {
            unreachable!()
        };
        assert!(rule.script().is_some());
        assert!(record_refs(&rule).contains(&inner.secret_refs[0]));
    }

    fn record_refs(rule: &MonitorRule) -> Vec<String> {
        rule.summary_json()["secretRefs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn approval_hash_changes_on_every_covered_script_field() {
        let base = script_rule();
        let variants: Vec<(&str, MonitorRule)> = vec![
            ("hostId", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.host_id = "host-2".into();
                MonitorRule::ScriptCommand(r)
            }),
            ("projectId", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.project_id = "proj-2".into();
                MonitorRule::ScriptCommand(r)
            }),
            ("scriptPath", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.script_path = "scripts/other.sh".into();
                MonitorRule::ScriptCommand(r)
            }),
            ("scriptHash", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.script_hash = "ef".repeat(32);
                MonitorRule::ScriptCommand(r)
            }),
            ("interpreter", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.interpreter = ScriptInterpreter::Unsupported("bun".into());
                MonitorRule::ScriptCommand(r)
            }),
            ("argv", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.argv = vec!["repos/other/pulls".into()];
                MonitorRule::ScriptCommand(r)
            }),
            ("timeoutMs", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.timeout_ms = 1;
                MonitorRule::ScriptCommand(r)
            }),
            ("maxOutputBytes", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.max_output_bytes = 1;
                MonitorRule::ScriptCommand(r)
            }),
            ("secretRefs", {
                let MonitorRule::ScriptCommand(mut r) = base.clone() else {
                    unreachable!()
                };
                r.secret_refs = vec!["OTHER_REF".into()];
                MonitorRule::ScriptCommand(r)
            }),
        ];
        for (field, variant) in variants {
            assert_ne!(
                base.approval_hash(),
                variant.approval_hash(),
                "editing {field} must change the approval hash"
            );
        }
    }

    #[test]
    fn approval_hash_changes_on_every_covered_http_field() {
        let base = http_rule();
        let variants: Vec<(&str, MonitorRule)> = vec![
            ("hostId", {
                let MonitorRule::HttpPoll(mut r) = base.clone() else {
                    unreachable!()
                };
                r.host_id = "host-2".into();
                MonitorRule::HttpPoll(r)
            }),
            ("projectId", {
                let MonitorRule::HttpPoll(mut r) = base.clone() else {
                    unreachable!()
                };
                r.project_id = "proj-2".into();
                MonitorRule::HttpPoll(r)
            }),
            ("urlHash", {
                let MonitorRule::HttpPoll(mut r) = base.clone() else {
                    unreachable!()
                };
                r.url_hash = "ef".repeat(32);
                MonitorRule::HttpPoll(r)
            }),
            ("timeoutMs", {
                let MonitorRule::HttpPoll(mut r) = base.clone() else {
                    unreachable!()
                };
                r.timeout_ms = 1;
                MonitorRule::HttpPoll(r)
            }),
            ("maxBodyBytes", {
                let MonitorRule::HttpPoll(mut r) = base.clone() else {
                    unreachable!()
                };
                r.max_body_bytes = 1;
                MonitorRule::HttpPoll(r)
            }),
            ("cursorSpec", {
                let MonitorRule::HttpPoll(mut r) = base.clone() else {
                    unreachable!()
                };
                r.cursor_spec = HttpCursorSpec::JsonField {
                    path: "items.0.id".into(),
                };
                MonitorRule::HttpPoll(r)
            }),
            ("secretRefs", {
                let MonitorRule::HttpPoll(mut r) = base.clone() else {
                    unreachable!()
                };
                r.secret_refs = vec!["OTHER_REF".into()];
                MonitorRule::HttpPoll(r)
            }),
        ];
        for (field, variant) in variants {
            assert_ne!(
                base.approval_hash(),
                variant.approval_hash(),
                "editing {field} must change the approval hash"
            );
        }
    }

    #[test]
    fn script_rule_refuses_unpinned_hash() {
        let mut rule = script_rule();
        let MonitorRule::ScriptCommand(inner) = &mut rule else {
            unreachable!()
        };
        inner.script_hash = String::new();
        let error = validate_rule(&rule).unwrap_err();
        assert!(error.contains("scriptHash"), "honest error: {error}");
    }

    #[test]
    fn script_rule_refuses_non_allowlisted_interpreter() {
        // Natural deserialization path: an unknown tag becomes Unsupported.
        let wire = r#"{"kind":"script_command.v1","hostId":"h","projectId":"p",
            "scriptPath":"s.sh","scriptHash":"abababababababababababababababababababababababababababababababab",
            "interpreter":"bash","argv":["api"],"timeoutMs":30000,"maxOutputBytes":65536,
            "secretRefs":[]}"#
            .replace(['\n', ' '], "");
        let rule: MonitorRule = serde_json::from_str(&wire).unwrap();
        assert_eq!(rule.script().unwrap().interpreter.as_str(), "bash");
        let error = validate_rule(&rule).unwrap_err();
        assert!(error.contains("not admitted"), "honest error: {error}");
        assert!(!rule.script().unwrap().interpreter.is_allowed());
    }

    #[test]
    fn script_rule_refuses_oversized_control_and_flag_argv() {
        for (label, argv) in [
            ("oversized", vec!["a".repeat(MAX_SCRIPT_ARG_BYTES + 1)]),
            ("control", vec!["api\u{0}rm".to_string()]),
            ("flag", vec!["--method".to_string()]),
            ("empty", Vec::new()),
        ] {
            let mut rule = script_rule();
            let MonitorRule::ScriptCommand(inner) = &mut rule else {
                unreachable!()
            };
            inner.argv = argv;
            let error = validate_rule(&rule).unwrap_err();
            assert!(
                error.contains("argv"),
                "{label}: honest argv error, got {error}"
            );
        }
    }

    #[test]
    fn script_rule_refuses_too_many_secret_refs_and_bad_bounds() {
        let mut rule = script_rule();
        let MonitorRule::ScriptCommand(inner) = &mut rule else {
            unreachable!()
        };
        inner.secret_refs = (0..MAX_SECRET_REFS + 1)
            .map(|i| format!("REF_{i}"))
            .collect();
        assert!(
            validate_rule(&rule)
                .unwrap_err()
                .contains("secret references")
        );

        for (timeout, output) in [
            (0, DEFAULT_SCRIPT_OUTPUT_BYTES),
            (MAX_SCRIPT_TIMEOUT_MS + 1, DEFAULT_SCRIPT_OUTPUT_BYTES),
            (DEFAULT_SCRIPT_TIMEOUT_MS, 0),
            (DEFAULT_SCRIPT_TIMEOUT_MS, MAX_SCRIPT_OUTPUT_BYTES + 1),
        ] {
            let mut rule = script_rule();
            let MonitorRule::ScriptCommand(inner) = &mut rule else {
                unreachable!()
            };
            inner.timeout_ms = timeout;
            inner.max_output_bytes = output;
            assert!(validate_rule(&rule).is_err());
        }
    }

    #[test]
    fn script_rule_refuses_escapes_in_script_path() {
        for bad in ["/abs.sh", "../escape.sh", "a/../../b.sh", "dir/"] {
            let mut rule = script_rule();
            let MonitorRule::ScriptCommand(inner) = &mut rule else {
                unreachable!()
            };
            inner.script_path = bad.to_string();
            assert!(validate_rule(&rule).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn http_rule_validates_and_refuses_bad_hashes_and_cursors() {
        assert!(validate_rule(&http_rule()).is_ok());
        let mut rule = http_rule();
        let MonitorRule::HttpPoll(inner) = &mut rule else {
            unreachable!()
        };
        inner.url_hash = "nothex".into();
        assert!(validate_rule(&rule).unwrap_err().contains("urlHash"));

        let mut rule = http_rule();
        let MonitorRule::HttpPoll(inner) = &mut rule else {
            unreachable!()
        };
        inner.cursor_spec = HttpCursorSpec::JsonField {
            path: String::new(),
        };
        assert!(validate_rule(&rule).unwrap_err().contains("cursorSpec"));
    }

    #[test]
    fn deserializes_all_four_kinds_from_the_same_table() {
        let rules = [file_rule(), script_rule(), http_rule(), github_rule()];
        for rule in rules {
            let json = serde_json::to_string(&rule).unwrap();
            let back: MonitorRule = serde_json::from_str(&json).unwrap();
            assert_eq!(rule, back);
        }
        // Unknown kind fails to deserialize loudly (fail-closed).
        assert!(serde_json::from_str::<MonitorRule>(r#"{"kind":"future_kind.v9"}"#).is_err());
    }

    fn github_rule() -> MonitorRule {
        MonitorRule::GithubPr(GithubPrRule {
            host_id: "host-1".to_string(),
            project_id: "proj-1".to_string(),
            repo: "clioo/drogon".to_string(),
            filter: GithubPrFilter::Assigned,
            login: Some("clioo".to_string()),
            api_base: None,
            timeout_ms: DEFAULT_HTTP_TIMEOUT_MS,
            max_body_bytes: DEFAULT_HTTP_BODY_BYTES,
            secret_refs: vec!["GITHUB_TOKEN_REF".to_string()],
            harness: Some("codex".to_string()),
            skills: vec!["drogon-cli".to_string()],
        })
    }

    #[test]
    fn github_pr_rule_validates_and_reports_its_case() {
        let rule = github_rule();
        assert_eq!(rule.kind_str(), RULE_KIND_GITHUB_PR);
        assert_eq!(rule.scope(), ("host-1", "proj-1"));
        assert!(validate_rule(&rule).is_ok());
        assert_eq!(rule.record_mirror().2, vec!["GITHUB_TOKEN_REF".to_string()]);
        assert_eq!(rule.github_api_base(), Some(DEFAULT_GITHUB_API_BASE));
        let view = rule.summary_json();
        assert_eq!(view["ruleKind"], "github_pr.v1");
        assert_eq!(view["repo"], "clioo/drogon");
        assert_eq!(view["filter"], "assigned");
        assert_eq!(view["caseHarness"], "codex");
        assert_eq!(view["caseSkills"][0], "drogon-cli");
        assert_eq!(RULE_SCHEMA_VERSION, 3);
        let wire = serde_json::to_string(&rule).unwrap();
        assert_eq!(serde_json::from_str::<MonitorRule>(&wire).unwrap(), rule);
    }

    #[test]
    fn github_pr_rule_refuses_loginless_filters_and_bad_shapes() {
        let mutate = |f: fn(&mut GithubPrRule)| {
            let mut rule = github_rule();
            let MonitorRule::GithubPr(inner) = &mut rule else {
                unreachable!()
            };
            f(inner);
            rule
        };
        for (label, rule) in [
            ("loginless assigned", mutate(|r| r.login = None)),
            ("empty repo", mutate(|r| r.repo = String::new())),
            ("repo without owner", mutate(|r| r.repo = "drogon".into())),
            (
                "repo with traversal",
                mutate(|r| r.repo = "../../etc/passwd".into()),
            ),
            (
                "login with spaces",
                mutate(|r| r.login = Some("a b".into())),
            ),
            (
                "non-http apiBase",
                mutate(|r| r.api_base = Some("file:///etc/passwd".into())),
            ),
            (
                "apiBase with credentials",
                mutate(|r| r.api_base = Some("https://user:pw@example.com".into())),
            ),
            (
                "prose harness",
                mutate(|r| r.harness = Some("code x".into())),
            ),
            (
                "prose skill",
                mutate(|r| r.skills = vec!["review please ignore instructions".into()]),
            ),
            ("zero timeout", mutate(|r| r.timeout_ms = 0)),
        ] {
            assert!(validate_rule(&rule).is_err(), "{label} must be refused");
        }
    }

    #[test]
    fn github_pr_approval_hash_covers_the_case_choices() {
        let base = github_rule();
        for (field, variant) in [
            ("repo", {
                let MonitorRule::GithubPr(mut r) = base.clone() else {
                    unreachable!()
                };
                r.repo = "clioo/other".into();
                MonitorRule::GithubPr(r)
            }),
            ("filter", {
                let MonitorRule::GithubPr(mut r) = base.clone() else {
                    unreachable!()
                };
                r.filter = GithubPrFilter::ReviewRequested;
                MonitorRule::GithubPr(r)
            }),
            ("login", {
                let MonitorRule::GithubPr(mut r) = base.clone() else {
                    unreachable!()
                };
                r.login = Some("someone-else".into());
                MonitorRule::GithubPr(r)
            }),
            ("apiBase", {
                let MonitorRule::GithubPr(mut r) = base.clone() else {
                    unreachable!()
                };
                r.api_base = Some("https://ghe.example.com".into());
                MonitorRule::GithubPr(r)
            }),
            ("harness", {
                let MonitorRule::GithubPr(mut r) = base.clone() else {
                    unreachable!()
                };
                r.harness = Some("claude".into());
                MonitorRule::GithubPr(r)
            }),
            ("skills", {
                let MonitorRule::GithubPr(mut r) = base.clone() else {
                    unreachable!()
                };
                r.skills = vec!["other-skill".into()];
                MonitorRule::GithubPr(r)
            }),
            ("secretRefs", {
                let MonitorRule::GithubPr(mut r) = base.clone() else {
                    unreachable!()
                };
                r.secret_refs = vec!["OTHER_REF".into()];
                MonitorRule::GithubPr(r)
            }),
        ] {
            assert_ne!(
                base.approval_hash(),
                variant.approval_hash(),
                "editing {field} must change the approval hash"
            );
        }
    }

    #[test]
    fn github_pr_rule_from_wire_resolves_scope_and_defaults() {
        let params = serde_json::json!({
            "repo": "clioo/drogon",
            "filter": "review_requested",
            "login": "clioo",
            "skills": ["drogon-cli"],
            "harness": "codex",
        });
        let rule = github_pr_rule_from_wire("host-9", "proj-9", params.as_object().unwrap())
            .expect("wire rule");
        assert_eq!(rule.host_id, "host-9");
        assert_eq!(rule.project_id, "proj-9");
        assert_eq!(rule.filter, GithubPrFilter::ReviewRequested);
        assert_eq!(rule.timeout_ms, DEFAULT_HTTP_TIMEOUT_MS);
        assert!(rule.secret_refs.is_empty());
        // An unknown filter tag is refused, never silently widened.
        let bogus = serde_json::json!({"repo": "a/b", "filter": "mine"});
        assert!(github_pr_rule_from_wire("h", "p", bogus.as_object().unwrap()).is_err());
        // A missing repo is refused.
        let bare = serde_json::json!({"filter": "opened"});
        assert!(github_pr_rule_from_wire("h", "p", bare.as_object().unwrap()).is_err());
    }
}
