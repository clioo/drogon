//! Durable agent-session record and its single-writer lease — port of the
//! pinned source `src/shared/agent-session-record.ts`
//! (c97906287bb7a390b25e2025b600d9fb3c25d9c3).
//!
//! The record is the session's identity — where it runs, which provider it
//! talks to, which account home is pinned to it — and is independent of any
//! terminal tab. The lease is the separate question of which process is
//! currently allowed to write to it.
//!
//! All bounds are JavaScript UTF-16 code-unit counts (`String.prototype.length`)
//! and every null-versus-absent rule from the source validators is preserved:
//! fields the source requires to be present (even when null) are rejected
//! when absent, and fields the source treats as optional accept absence.

use serde_json::{Map, Value};

use super::provider_handle::{
    HandleProvider, ProviderHandleLink, is_handle_chain_json, js_utf16_len, json_safe_integer,
};
use super::{Extensions, serialized_extensions, split_extensions};

pub(crate) const AGENT_SESSION_RECORD_SCHEMA_VERSION: u32 = 2;
pub(crate) const MAX_ID_UTF16_LENGTH: usize = 512;
pub(crate) const MAX_PATH_UTF16_LENGTH: usize = 4096;
pub(crate) const MAX_LAUNCH_ENV_ENTRIES: usize = 256;
pub(crate) const MAX_LAUNCH_ENV_VALUE_UTF16_LENGTH: usize = 65_536;
pub(crate) const MAX_LAUNCH_ARGS: usize = 256;
pub(crate) const MAX_LAUNCH_ARGS_BYTES: usize = 16 * 1024;
pub(crate) const MAX_OPTIONS_ENTRIES: usize = 32;

// Known members per object level; anything else at that level is preserved
// verbatim in `extensions`, exactly like the source object spreads that
// rebuild record/lease and carry the nested objects by reference.
const RECORD_KNOWN_KEYS: &[&str] = &[
    "schemaVersion",
    "sessionId",
    "location",
    "provider",
    "providerHandleChain",
    "accountHome",
    "options",
    "launchArgs",
    "lease",
    "createdAt",
    "updatedAt",
];
const LOCATION_KNOWN_KEYS: &[&str] = &[
    "executionHostId",
    "wslDistro",
    "workspaceId",
    "workspaceKind",
];
const ACCOUNT_HOME_KNOWN_KEYS: &[&str] = &["variable", "path"];
const PROCESS_KNOWN_KEYS: &[&str] = &["hostId", "pid", "processStartTimeMs", "spawnToken"];
const JOURNAL_CHECKPOINT_KNOWN_KEYS: &[&str] = &["epoch", "sequence"];
const DEATH_EVIDENCE_KNOWN_KEYS: &[&str] = &["kind", "detail", "observedAt"];
const LEASE_KNOWN_KEYS: &[&str] = &[
    "sessionId",
    "runtimeKind",
    "runtimeFence",
    "handoffStage",
    "provenHandleLinkId",
    "ownerProcess",
    "reservedSpawnToken",
    "processlessAt",
    "leaseDeadlineAt",
    "lastRenewedAt",
    "handoffOperationId",
    "journalCheckpoint",
    "claimKeyId",
    "claimStatus",
    "unreconciled",
    "minimumNextFence",
    "deathEvidence",
    "settlementRetryRequired",
    "settlementRetryId",
];

// `SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/` — the quantifier counts
// UTF-16 units, but every matched character is ASCII, so char count is exact.
const SESSION_ID_MIN_LENGTH: usize = 8;
const SESSION_ID_MAX_LENGTH: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceKind {
    GitWorktree,
    Folder,
}

impl WorkspaceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GitWorktree => "git-worktree",
            Self::Folder => "folder",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "git-worktree" => Some(Self::GitWorktree),
            "folder" => Some(Self::Folder),
            _ => None,
        }
    }
}

/// Where the provider process actually runs. WSL is called out separately
/// from the execution host id because a WSL workspace is served by the local
/// host but is a distinct filesystem, account root, and process namespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionLocation {
    pub execution_host_id: String,
    pub wsl_distro: Option<String>,
    pub workspace_id: String,
    pub workspace_kind: WorkspaceKind,
    /// Unknown members, preserved verbatim like the source object graph.
    pub extensions: Extensions,
}

/// Account root pinned at launch by the account selector, so a resume cannot
/// drift to another login.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountHomeVariable {
    ClaudeConfigDir,
    CodexHome,
}

impl AccountHomeVariable {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeConfigDir => "CLAUDE_CONFIG_DIR",
            Self::CodexHome => "CODEX_HOME",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "CLAUDE_CONFIG_DIR" => Some(Self::ClaudeConfigDir),
            "CODEX_HOME" => Some(Self::CodexHome),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountHome {
    pub variable: AccountHomeVariable,
    pub path: String,
    pub extensions: Extensions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerRuntimeKind {
    Native,
    Tui,
}

impl OwnerRuntimeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Tui => "tui",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "native" => Some(Self::Native),
            "tui" => Some(Self::Tui),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandoffStage {
    Preparing,
    OldOwnerStopped,
    NewOwnerProving,
    Recovering,
    ManualRecovery,
}

impl HandoffStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::OldOwnerStopped => "old-owner-stopped",
            Self::NewOwnerProving => "new-owner-proving",
            Self::Recovering => "recovering",
            Self::ManualRecovery => "manual-recovery",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "preparing" => Some(Self::Preparing),
            "old-owner-stopped" => Some(Self::OldOwnerStopped),
            "new-owner-proving" => Some(Self::NewOwnerProving),
            "recovering" => Some(Self::Recovering),
            "manual-recovery" => Some(Self::ManualRecovery),
            _ => None,
        }
    }
}

/// Mirrors the in-memory claim registry's reserved / live / conflicted
/// states so a conflict survives a restart. `released` has no registry
/// equivalent: the registry expresses "no owner" by deleting the entry, and
/// a durable record that outlives its owner needs a name for that.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimStatus {
    Reserved,
    Live,
    Conflicted,
    Released,
}

impl ClaimStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reserved => "reserved",
            Self::Live => "live",
            Self::Conflicted => "conflicted",
            Self::Released => "released",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "reserved" => Some(Self::Reserved),
            "live" => Some(Self::Live),
            "conflicted" => Some(Self::Conflicted),
            "released" => Some(Self::Released),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeathEvidenceKind {
    ExitObserved,
    PidAbsent,
    IdentityMismatch,
}

impl DeathEvidenceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ExitObserved => "exit-observed",
            Self::PidAbsent => "pid-absent",
            Self::IdentityMismatch => "identity-mismatch",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "exit-observed" => Some(Self::ExitObserved),
            "pid-absent" => Some(Self::PidAbsent),
            "identity-mismatch" => Some(Self::IdentityMismatch),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeathEvidence {
    pub kind: DeathEvidenceKind,
    pub detail: String,
    pub observed_at: i64,
    pub extensions: Extensions,
}

/// PID-reuse-safe process identity. `spawn_token` is the only element
/// available on every platform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub host_id: String,
    pub pid: i64,
    pub process_start_time_ms: Option<i64>,
    pub spawn_token: String,
    pub extensions: Extensions,
}

/// Required-nullable in the source; carried by reference through every
/// transition, so unknown members travel in `extensions`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JournalCheckpoint {
    pub epoch: i64,
    pub sequence: i64,
    pub extensions: Extensions,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    pub session_id: String,
    pub runtime_kind: OwnerRuntimeKind,
    /// Durable monotonic integer; only acquisition CAS and proven eviction
    /// move it.
    pub runtime_fence: i64,
    pub handoff_stage: Option<HandoffStage>,
    /// Link id of the provider handle this owner proved; the full chain
    /// lives on the record.
    pub proven_handle_link_id: Option<String>,
    /// Null between the durable reservation and the observed spawn.
    pub owner_process: Option<ProcessIdentity>,
    /// Reserved before any process exists, then matched against the child's
    /// environment.
    pub reserved_spawn_token: Option<String>,
    /// Optional nullable in the source (`?: number | null`): the source
    /// writes `null` explicitly (reservation, commit, evict), so absence and
    /// null are distinct persisted states — outer `None` is absent, inner
    /// `None` is null.
    pub processless_at: Option<Option<i64>>,
    pub lease_deadline_at: i64,
    pub last_renewed_at: i64,
    pub handoff_operation_id: Option<String>,
    pub journal_checkpoint: Option<JournalCheckpoint>,
    /// Key id that minted the HMAC claim this lease was granted under.
    pub claim_key_id: String,
    pub claim_status: ClaimStatus,
    /// True from load until the host adjudicates it; no writer is granted
    /// while set.
    pub unreconciled: bool,
    /// Lowest fence a future grant may use, set only after backup recovery.
    /// The source lease validator does not check this field at all, so the
    /// port accepts and preserves the raw persisted JSON value — never
    /// rejecting the record on it and never dropping non-integer data.
    /// Later-slice policy (fence minting) interprets it separately.
    pub minimum_next_fence: Option<Value>,
    pub death_evidence: Option<DeathEvidence>,
    /// A positively observed provider exit whose terminal journal settlement
    /// still needs retry.
    pub settlement_retry_required: Option<bool>,
    /// Stable lifecycle batch id used when retrying the terminal settlement.
    pub settlement_retry_id: Option<String>,
    /// Unknown members, carried through the source's `{...record.lease}`
    /// spreads verbatim; known fields always serialize from typed state, so
    /// no stale shadow of them can exist here.
    pub extensions: Extensions,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSessionRecord {
    pub session_id: String,
    pub location: ExecutionLocation,
    pub provider: HandleProvider,
    pub provider_handle_chain: Vec<ProviderHandleLink>,
    pub account_home: AccountHome,
    /// Provider options acknowledged for the next turn, restored across
    /// owner replacement; insertion order is preserved.
    pub options: Option<Vec<(String, String)>>,
    pub launch_args: Option<Vec<String>>,
    pub lease: Lease,
    pub created_at: i64,
    pub updated_at: i64,
    /// Unknown record-level members, carried through the source's
    /// `{...record}` spreads verbatim. `launchEnv` never reaches here: the
    /// source refuses its presence on a schema-v2 record outright.
    pub extensions: Extensions,
}

/// Why a persisted record was refused at admission time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecordReadError {
    /// `schemaVersion` is present but not the supported version 2. The raw
    /// value is quarantined — never upgraded, defaulted, or rewritten.
    UnsupportedSchema { raw: Value },
    /// Version 2 but invalid per the source validators.
    Invalid { raw: Value },
}

impl RecordReadError {
    pub fn reason(&self) -> &'static str {
        match self {
            Self::UnsupportedSchema { .. } => "unsupported_schema",
            Self::Invalid { .. } => "invalid_record",
        }
    }
}

/// `isBoundedString`: nonempty, at most `max` JS UTF-16 code units.
fn is_bounded_string(value: &str, max_utf16: usize) -> bool {
    !value.is_empty() && js_utf16_len(value) <= max_utf16
}

pub fn is_agent_session_id(value: &str) -> bool {
    let length = value.chars().count();
    (SESSION_ID_MIN_LENGTH..=SESSION_ID_MAX_LENGTH).contains(&length)
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

/// NUL cannot occur in a host id, distro name, or workspace id, so no
/// component can forge a join (`SCOPE_KEY_SEPARATOR = '\u0000'`).
const SCOPE_KEY_SEPARATOR: char = '\u{0}';

/// Scope key for host-and-workspace isolation. Native, WSL, and SSH copies
/// of one workspace id are different sessions; collapsing them would let one
/// host adjudicate another host's lease.
pub fn agent_session_scope_key(location: &ExecutionLocation) -> String {
    [
        location.execution_host_id.as_str(),
        location.wsl_distro.as_deref().unwrap_or(""),
        location.workspace_id.as_str(),
    ]
    .join(&SCOPE_KEY_SEPARATOR.to_string())
}

pub fn agent_session_execution_locations_equal(
    left: &ExecutionLocation,
    right: &ExecutionLocation,
) -> bool {
    agent_session_scope_key(left) == agent_session_scope_key(right)
        && left.workspace_kind == right.workspace_kind
}

fn bounded_string_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    max: usize,
) -> Option<&'a str> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| is_bounded_string(value, max))
}

fn safe_integer_field(object: &Map<String, Value>, key: &str) -> Option<i64> {
    object.get(key).and_then(json_safe_integer)
}

fn nonnegative_field(object: &Map<String, Value>, key: &str) -> Option<i64> {
    safe_integer_field(object, key).filter(|value| *value >= 0)
}

/// Required nullable field: must be present, and either null or passing
/// `validate`. Absence is invalid, exactly like the source validators.
fn null_or<'a, T>(
    object: &'a Map<String, Value>,
    key: &str,
    validate: impl Fn(&'a Value) -> Option<T>,
) -> Option<Option<T>> {
    match object.get(key) {
        Some(Value::Null) => Some(None),
        Some(value) => validate(value).map(Some),
        None => None,
    }
}

pub fn is_agent_session_execution_location(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let host_ok = bounded_string_field(object, "executionHostId", MAX_ID_UTF16_LENGTH).is_some();
    let distro_ok = match object.get("wslDistro") {
        Some(Value::Null) => true,
        Some(Value::String(distro)) => is_bounded_string(distro, MAX_ID_UTF16_LENGTH),
        _ => false,
    };
    let workspace_ok = bounded_string_field(object, "workspaceId", MAX_ID_UTF16_LENGTH).is_some();
    let kind_ok = object
        .get("workspaceKind")
        .and_then(Value::as_str)
        .and_then(WorkspaceKind::from_str_opt)
        .is_some();
    host_ok && distro_ok && workspace_ok && kind_ok
}

pub fn is_agent_session_process_identity(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let host_ok = bounded_string_field(object, "hostId", MAX_ID_UTF16_LENGTH).is_some();
    let pid_ok = match object.get("pid") {
        Some(value) => json_safe_integer(value).is_some_and(|pid| pid > 0),
        _ => false,
    };
    // processStartTimeMs must be present: null or a nonnegative safe integer.
    let start_ok = match object.get("processStartTimeMs") {
        Some(Value::Null) => true,
        Some(_) => nonnegative_field(object, "processStartTimeMs").is_some(),
        None => false,
    };
    let token_ok = bounded_string_field(object, "spawnToken", MAX_ID_UTF16_LENGTH).is_some();
    host_ok && pid_ok && start_ok && token_ok
}

fn is_agent_session_account_home(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object
        .get("variable")
        .and_then(Value::as_str)
        .and_then(AccountHomeVariable::from_str_opt)
        .is_some()
        && bounded_string_field(object, "path", MAX_PATH_UTF16_LENGTH).is_some()
}

fn is_agent_session_options(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() <= MAX_OPTIONS_ENTRIES
        && object.iter().all(|(key, option)| {
            is_bounded_string(key, MAX_ID_UTF16_LENGTH)
                && option
                    .as_str()
                    .map(|option| is_bounded_string(option, MAX_ID_UTF16_LENGTH))
                    .unwrap_or(false)
        })
}

/// Provider launch environment captured by the host. Exported by the source
/// even though schema-v2 records do not carry a `launchEnv` field.
pub fn is_agent_session_launch_env(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() <= MAX_LAUNCH_ENV_ENTRIES
        && object.iter().all(|(key, entry)| {
            is_bounded_string(key, MAX_ID_UTF16_LENGTH)
                && entry
                    .as_str()
                    .map(|entry| js_utf16_len(entry) <= MAX_LAUNCH_ENV_VALUE_UTF16_LENGTH)
                    .unwrap_or(false)
        })
}

fn is_agent_session_journal_checkpoint(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    nonnegative_field(object, "epoch").is_some() && nonnegative_field(object, "sequence").is_some()
}

fn is_agent_session_death_evidence(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object
        .get("kind")
        .and_then(Value::as_str)
        .and_then(DeathEvidenceKind::from_str_opt)
        .is_some()
        && bounded_string_field(object, "detail", MAX_ID_UTF16_LENGTH).is_some()
        && nonnegative_field(object, "observedAt").is_some()
}

pub fn is_agent_session_lease(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let session_id_ok = object
        .get("sessionId")
        .and_then(Value::as_str)
        .map(is_agent_session_id)
        .unwrap_or(false);
    let runtime_kind_ok = object
        .get("runtimeKind")
        .and_then(Value::as_str)
        .and_then(OwnerRuntimeKind::from_str_opt)
        .is_some();
    let fence_ok = nonnegative_field(object, "runtimeFence").is_some();
    let handoff_ok = match object.get("handoffStage") {
        Some(Value::Null) => true,
        Some(Value::String(stage)) => HandoffStage::from_str_opt(stage).is_some(),
        _ => false,
    };
    let proven_ok = match object.get("provenHandleLinkId") {
        Some(Value::Null) => true,
        Some(Value::String(link_id)) => !link_id.is_empty() && js_utf16_len(link_id) <= 128,
        _ => false,
    };
    let owner_ok = match object.get("ownerProcess") {
        Some(Value::Null) => true,
        Some(value) => is_agent_session_process_identity(value),
        None => false,
    };
    let token_ok = match object.get("reservedSpawnToken") {
        Some(Value::Null) => true,
        Some(value) => value
            .as_str()
            .map(|token| is_bounded_string(token, MAX_ID_UTF16_LENGTH))
            .unwrap_or(false),
        None => false,
    };
    // processlessAt may be absent or null (source `?: number | null`).
    let processless_ok = match object.get("processlessAt") {
        None | Some(Value::Null) => true,
        Some(_) => nonnegative_field(object, "processlessAt").is_some(),
    };
    let deadline_ok = safe_integer_field(object, "leaseDeadlineAt").is_some();
    let renewed_ok = safe_integer_field(object, "lastRenewedAt").is_some();
    let operation_ok = match object.get("handoffOperationId") {
        Some(Value::Null) => true,
        Some(value) => value
            .as_str()
            .map(|operation| is_bounded_string(operation, MAX_ID_UTF16_LENGTH))
            .unwrap_or(false),
        None => false,
    };
    let checkpoint_ok = match object.get("journalCheckpoint") {
        Some(Value::Null) => true,
        Some(value) => is_agent_session_journal_checkpoint(value),
        None => false,
    };
    let claim_key_ok = bounded_string_field(object, "claimKeyId", MAX_ID_UTF16_LENGTH).is_some();
    let claim_status_ok = object
        .get("claimStatus")
        .and_then(Value::as_str)
        .and_then(ClaimStatus::from_str_opt)
        .is_some();
    let unreconciled_ok = matches!(object.get("unreconciled"), Some(Value::Bool(_)));
    // settlementRetryRequired accepts only absent or boolean — null is invalid.
    let settlement_required_ok = matches!(
        object.get("settlementRetryRequired"),
        None | Some(Value::Bool(_))
    );
    // settlementRetryId accepts only absent or a bounded string.
    // settlementRetryId accepts only absent or a bounded string; JSON null
    // falls into the unwrap_or(false) arm, exactly like the source check.
    let settlement_id_ok = match object.get("settlementRetryId") {
        None => true,
        Some(value) => value
            .as_str()
            .map(|retry_id| is_bounded_string(retry_id, MAX_ID_UTF16_LENGTH))
            .unwrap_or(false),
    };
    let death_ok = match object.get("deathEvidence") {
        Some(Value::Null) => true,
        Some(value) => is_agent_session_death_evidence(value),
        None => false,
    };
    session_id_ok
        && runtime_kind_ok
        && fence_ok
        && handoff_ok
        && proven_ok
        && owner_ok
        && token_ok
        && processless_ok
        && deadline_ok
        && renewed_ok
        && operation_ok
        && checkpoint_ok
        && claim_key_ok
        && claim_status_ok
        && unreconciled_ok
        && settlement_required_ok
        && settlement_id_ok
        && death_ok
}

/// Byte length of `JSON.stringify(value)` for a string array, JS-exact.
fn launch_args_serialized_bytes(arguments: &[Value]) -> usize {
    let mut serialized = String::from("[");
    for (index, argument) in arguments.iter().enumerate() {
        if index > 0 {
            serialized.push(',');
        }
        serialized.push_str(&super::provider_handle::js_json_quote(
            argument.as_str().unwrap_or(""),
        ));
    }
    serialized.push(']');
    serialized.len()
}

/// Provider CLI arguments captured by the host. The byte bound applies to
/// the exact `JSON.stringify` spelling, reproduced with the JS-exact
/// escaper so multibyte and escaped arguments count precisely.
pub fn is_agent_session_launch_args(value: &Value) -> bool {
    let Some(array) = value.as_array() else {
        return false;
    };
    array.len() <= MAX_LAUNCH_ARGS
        && array.iter().all(|argument| {
            argument
                .as_str()
                .map(|arg| !arg.contains('\0'))
                .unwrap_or(false)
        })
        && launch_args_serialized_bytes(array) <= MAX_LAUNCH_ARGS_BYTES
}

/// JavaScript `value === AGENT_SESSION_RECORD_SCHEMA_VERSION`: JSON number
/// spellings that parse to the same double (`2`, `2.0`, `2e0`, and any
/// decimal spelling rounding to exactly 2) are the supported version, exactly
/// like the source `===` against a JavaScript number; non-numeric values and
/// every other magnitude are not.
fn is_supported_schema_version(value: &Value) -> bool {
    value.as_f64() == Some(f64::from(AGENT_SESSION_RECORD_SCHEMA_VERSION))
}

pub fn is_agent_session_record(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    let shape_valid = object
        .get("schemaVersion")
        .is_some_and(is_supported_schema_version)
        && object
            .get("sessionId")
            .and_then(Value::as_str)
            .map(is_agent_session_id)
            .unwrap_or(false)
        && object
            .get("location")
            .map(is_agent_session_execution_location)
            .unwrap_or(false)
        && object
            .get("provider")
            .and_then(Value::as_str)
            .and_then(HandleProvider::from_str_opt)
            .is_some()
        && object
            .get("providerHandleChain")
            .map(is_handle_chain_json)
            .unwrap_or(false)
        && object
            .get("accountHome")
            .map(is_agent_session_account_home)
            .unwrap_or(false)
        && match object.get("options") {
            None => true,
            Some(value) => is_agent_session_options(value),
        }
        && match object.get("launchArgs") {
            None => true,
            Some(value) => is_agent_session_launch_args(value),
        }
        // `launchEnv` has no place on a schema-v2 record; its presence is
        // refused rather than silently ignored.
        && !object.contains_key("launchEnv")
        && object
            .get("lease")
            .map(is_agent_session_lease)
            .unwrap_or(false)
        && object.get("lease").and_then(|lease| lease.get("sessionId")) == object.get("sessionId")
        && safe_integer_field(object, "createdAt").is_some()
        && safe_integer_field(object, "updatedAt").is_some();
    if !shape_valid {
        return false;
    }
    let Some(provider) = object
        .get("provider")
        .and_then(Value::as_str)
        .and_then(HandleProvider::from_str_opt)
    else {
        return false;
    };
    let Some(chain) = object.get("providerHandleChain").and_then(Value::as_array) else {
        return false;
    };
    let Some(lease) = object.get("lease").and_then(Value::as_object) else {
        return false;
    };
    let head_link_id = chain
        .last()
        .and_then(|head| head.get("linkId"))
        .and_then(Value::as_str);
    let head_fence = chain
        .last()
        .and_then(|head| head.get("mintedAtFence"))
        .and_then(json_safe_integer);
    let chain_providers_match = chain.iter().all(|link| {
        link.get("handle")
            .and_then(|handle| handle.get("provider"))
            .and_then(Value::as_str)
            == Some(provider.as_str())
    });
    // `live` means a handle proven at exactly the current fence by the
    // recorded owner process; anything else is not a writable lease.
    let live_invariants_hold = lease.get("claimStatus") != Some(&Value::from("live"))
        || (lease.get("ownerProcess") != Some(&Value::Null)
            && head_link_id.is_some()
            && head_link_id == lease.get("provenHandleLinkId").and_then(Value::as_str)
            && head_fence.is_some()
            && head_fence == lease.get("runtimeFence").and_then(json_safe_integer));
    chain_providers_match && live_invariants_hold
}

// ---------------------------------------------------------------------------
// Typed model <-> JSON, with the same null/absent discipline as the source.
// ---------------------------------------------------------------------------

fn execution_location_from_json(value: &Value) -> Option<ExecutionLocation> {
    let object = value.as_object()?;
    Some(ExecutionLocation {
        execution_host_id: bounded_string_field(object, "executionHostId", MAX_ID_UTF16_LENGTH)?
            .to_string(),
        wsl_distro: match object.get("wslDistro") {
            Some(Value::Null) => None,
            Some(Value::String(distro)) if is_bounded_string(distro, MAX_ID_UTF16_LENGTH) => {
                Some(distro.clone())
            }
            _ => return None,
        },
        workspace_id: bounded_string_field(object, "workspaceId", MAX_ID_UTF16_LENGTH)?.to_string(),
        workspace_kind: WorkspaceKind::from_str_opt(object.get("workspaceKind")?.as_str()?)?,
        extensions: split_extensions(object, LOCATION_KNOWN_KEYS),
    })
}

fn process_identity_from_json(value: &Value) -> Option<ProcessIdentity> {
    if !is_agent_session_process_identity(value) {
        return None;
    }
    let object = value.as_object()?;
    Some(ProcessIdentity {
        host_id: object.get("hostId")?.as_str()?.to_string(),
        pid: json_safe_integer(object.get("pid")?)?,
        process_start_time_ms: match object.get("processStartTimeMs") {
            Some(Value::Null) => None,
            Some(value) => Some(json_safe_integer(value)?),
            None => return None,
        },
        spawn_token: object.get("spawnToken")?.as_str()?.to_string(),
        extensions: split_extensions(object, PROCESS_KNOWN_KEYS),
    })
}

fn death_evidence_from_json(value: &Value) -> Option<DeathEvidence> {
    if !is_agent_session_death_evidence(value) {
        return None;
    }
    let object = value.as_object()?;
    Some(DeathEvidence {
        kind: DeathEvidenceKind::from_str_opt(object.get("kind")?.as_str()?)?,
        detail: object.get("detail")?.as_str()?.to_string(),
        observed_at: json_safe_integer(object.get("observedAt")?)?,
        extensions: split_extensions(object, DEATH_EVIDENCE_KNOWN_KEYS),
    })
}

fn lease_from_json(value: &Value) -> Option<Lease> {
    if !is_agent_session_lease(value) {
        return None;
    }
    let object = value.as_object()?;
    Some(Lease {
        session_id: object.get("sessionId")?.as_str()?.to_string(),
        runtime_kind: OwnerRuntimeKind::from_str_opt(object.get("runtimeKind")?.as_str()?)?,
        runtime_fence: nonnegative_field(object, "runtimeFence")?,
        handoff_stage: null_or(object, "handoffStage", |stage| {
            HandoffStage::from_str_opt(stage.as_str()?)
        })?,
        proven_handle_link_id: null_or(object, "provenHandleLinkId", |link_id| {
            link_id
                .as_str()
                .filter(|id| !id.is_empty() && js_utf16_len(id) <= 128)
                .map(str::to_string)
        })?,
        owner_process: null_or(object, "ownerProcess", process_identity_from_json)?,
        reserved_spawn_token: null_or(object, "reservedSpawnToken", |token| {
            token
                .as_str()
                .filter(|token| is_bounded_string(token, MAX_ID_UTF16_LENGTH))
                .map(str::to_string)
        })?,
        // Absent and null are distinct states in the source (it writes null
        // explicitly), so this field is optional-nullable, not collapsing.
        processless_at: match object.get("processlessAt") {
            None => None,
            Some(Value::Null) => Some(None),
            Some(value) => json_safe_integer(value).filter(|at| *at >= 0).map(Some),
        },
        lease_deadline_at: safe_integer_field(object, "leaseDeadlineAt")?,
        last_renewed_at: safe_integer_field(object, "lastRenewedAt")?,
        handoff_operation_id: null_or(object, "handoffOperationId", |operation| {
            operation
                .as_str()
                .filter(|operation| is_bounded_string(operation, MAX_ID_UTF16_LENGTH))
                .map(str::to_string)
        })?,
        journal_checkpoint: null_or(object, "journalCheckpoint", |checkpoint| {
            let object = checkpoint.as_object()?;
            Some(JournalCheckpoint {
                epoch: nonnegative_field(object, "epoch")?,
                sequence: nonnegative_field(object, "sequence")?,
                extensions: split_extensions(object, JOURNAL_CHECKPOINT_KNOWN_KEYS),
            })
        })?,
        claim_key_id: bounded_string_field(object, "claimKeyId", MAX_ID_UTF16_LENGTH)?.to_string(),
        claim_status: ClaimStatus::from_str_opt(object.get("claimStatus")?.as_str()?)?,
        unreconciled: object.get("unreconciled")?.as_bool()?,
        // The source validator does not check this field: preserve whatever
        // persisted, verbatim, so non-integer data is never silently dropped.
        minimum_next_fence: object.get("minimumNextFence").cloned(),
        death_evidence: null_or(object, "deathEvidence", death_evidence_from_json)?,
        settlement_retry_required: match object.get("settlementRetryRequired") {
            None => None,
            Some(value) => value.as_bool(),
        },
        settlement_retry_id: match object.get("settlementRetryId") {
            None => None,
            Some(value) => value.as_str().map(str::to_string),
        },
        extensions: split_extensions(object, LEASE_KNOWN_KEYS),
    })
}

/// Admit one persisted record value. Version 2 validates per the source
/// record validator; any other version is quarantined as unsupported with
/// the raw value preserved — never rewritten into an empty or default
/// record.
pub fn admit_persisted_record(value: &Value) -> Result<AgentSessionRecord, RecordReadError> {
    let version = value
        .as_object()
        .and_then(|object| object.get("schemaVersion"));
    match version {
        Some(version) if is_supported_schema_version(version) => {}
        // A record-shaped value with an unknown (or nonnumeric) version is an
        // unsupported schema; a value with no version key at all is corrupt
        // data. Both are quarantined, neither is rewritten.
        Some(_) => {
            return Err(RecordReadError::UnsupportedSchema { raw: value.clone() });
        }
        None => {
            return Err(RecordReadError::Invalid { raw: value.clone() });
        }
    }
    if !is_agent_session_record(value) {
        return Err(RecordReadError::Invalid { raw: value.clone() });
    }
    let object = value.as_object().expect("checked above");
    let invalid = || RecordReadError::Invalid { raw: value.clone() };
    let chain = object
        .get("providerHandleChain")
        .and_then(Value::as_array)
        .expect("chain validated");
    let mut provider_handle_chain = Vec::with_capacity(chain.len());
    for link in chain {
        provider_handle_chain.push(ProviderHandleLink::from_json(link).ok_or_else(invalid)?);
    }
    let options = match object.get("options") {
        None => None,
        Some(options) => {
            let object = options.as_object().ok_or_else(invalid)?;
            Some(
                object
                    .iter()
                    .map(|(key, option)| {
                        option
                            .as_str()
                            .map(|option| (key.clone(), option.to_string()))
                            .ok_or_else(invalid)
                    })
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
    };
    let launch_args = match object.get("launchArgs") {
        None => None,
        Some(arguments) => {
            let array = arguments.as_array().ok_or_else(invalid)?;
            Some(
                array
                    .iter()
                    .map(|argument| argument.as_str().map(str::to_string).ok_or_else(invalid))
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
    };
    let home_object = object
        .get("accountHome")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    let record = AgentSessionRecord {
        session_id: object
            .get("sessionId")
            .and_then(Value::as_str)
            .expect("validated")
            .to_string(),
        location: execution_location_from_json(object.get("location").expect("validated"))
            .ok_or_else(invalid)?,
        provider: HandleProvider::from_str_opt(
            object
                .get("provider")
                .and_then(Value::as_str)
                .expect("validated"),
        )
        .expect("validated"),
        provider_handle_chain,
        account_home: AccountHome {
            variable: AccountHomeVariable::from_str_opt(
                home_object
                    .get("variable")
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?,
            )
            .ok_or_else(invalid)?,
            path: home_object
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?
                .to_string(),
            extensions: split_extensions(home_object, ACCOUNT_HOME_KNOWN_KEYS),
        },
        options,
        launch_args,
        lease: lease_from_json(object.get("lease").expect("validated")).ok_or_else(invalid)?,
        created_at: safe_integer_field(object, "createdAt").expect("validated"),
        updated_at: safe_integer_field(object, "updatedAt").expect("validated"),
        extensions: split_extensions(object, RECORD_KNOWN_KEYS),
    };
    Ok(record)
}

impl AgentSessionRecord {
    /// Serialize back to the schema-v2 JSON shape. Fields the source
    /// requires are always emitted (null when unset); fields the source
    /// treats as optional are omitted when unset. Unknown members preserved
    /// at admission are re-emitted verbatim at every level; known keys that
    /// a typed caller inserted into a public extensions map are filtered
    /// out, so known fields always serialize from typed state.
    pub fn to_json(&self) -> Value {
        let mut location = Map::new();
        location.insert(
            "executionHostId".to_string(),
            Value::from(self.location.execution_host_id.clone()),
        );
        location.insert(
            "wslDistro".to_string(),
            self.location
                .wsl_distro
                .clone()
                .map(Value::from)
                .unwrap_or(Value::Null),
        );
        location.insert(
            "workspaceId".to_string(),
            Value::from(self.location.workspace_id.clone()),
        );
        location.insert(
            "workspaceKind".to_string(),
            Value::from(self.location.workspace_kind.as_str()),
        );
        for (key, value) in serialized_extensions(&self.location.extensions, LOCATION_KNOWN_KEYS) {
            location.insert(key, value);
        }

        let mut account_home = Map::new();
        account_home.insert(
            "variable".to_string(),
            Value::from(self.account_home.variable.as_str()),
        );
        account_home.insert(
            "path".to_string(),
            Value::from(self.account_home.path.clone()),
        );
        for (key, value) in
            serialized_extensions(&self.account_home.extensions, ACCOUNT_HOME_KNOWN_KEYS)
        {
            account_home.insert(key, value);
        }

        let lease = &self.lease;
        let mut lease_json = Map::new();
        lease_json.insert(
            "sessionId".to_string(),
            Value::from(lease.session_id.clone()),
        );
        lease_json.insert(
            "runtimeKind".to_string(),
            Value::from(lease.runtime_kind.as_str()),
        );
        lease_json.insert("runtimeFence".to_string(), Value::from(lease.runtime_fence));
        lease_json.insert(
            "handoffStage".to_string(),
            lease
                .handoff_stage
                .map(|stage| Value::from(stage.as_str()))
                .unwrap_or(Value::Null),
        );
        lease_json.insert(
            "provenHandleLinkId".to_string(),
            lease
                .proven_handle_link_id
                .clone()
                .map(Value::from)
                .unwrap_or(Value::Null),
        );
        lease_json.insert(
            "ownerProcess".to_string(),
            lease
                .owner_process
                .clone()
                .map(|process| {
                    let mut object = Map::new();
                    object.insert("hostId".to_string(), Value::from(process.host_id));
                    object.insert("pid".to_string(), Value::from(process.pid));
                    object.insert(
                        "processStartTimeMs".to_string(),
                        process
                            .process_start_time_ms
                            .map(Value::from)
                            .unwrap_or(Value::Null),
                    );
                    object.insert("spawnToken".to_string(), Value::from(process.spawn_token));
                    for (key, value) in
                        serialized_extensions(&process.extensions, PROCESS_KNOWN_KEYS)
                    {
                        object.insert(key, value);
                    }
                    Value::Object(object)
                })
                .unwrap_or(Value::Null),
        );
        lease_json.insert(
            "reservedSpawnToken".to_string(),
            lease
                .reserved_spawn_token
                .clone()
                .map(Value::from)
                .unwrap_or(Value::Null),
        );
        // Absent, null, and set are three distinct persisted states.
        if let Some(processless_at) = &lease.processless_at {
            let value = match processless_at {
                None => Value::Null,
                Some(at) => Value::from(*at),
            };
            lease_json.insert("processlessAt".to_string(), value);
        }
        lease_json.insert(
            "leaseDeadlineAt".to_string(),
            Value::from(lease.lease_deadline_at),
        );
        lease_json.insert(
            "lastRenewedAt".to_string(),
            Value::from(lease.last_renewed_at),
        );
        lease_json.insert(
            "handoffOperationId".to_string(),
            lease
                .handoff_operation_id
                .clone()
                .map(Value::from)
                .unwrap_or(Value::Null),
        );
        lease_json.insert(
            "journalCheckpoint".to_string(),
            lease
                .journal_checkpoint
                .clone()
                .map(|checkpoint| {
                    let mut object = Map::new();
                    object.insert("epoch".to_string(), Value::from(checkpoint.epoch));
                    object.insert("sequence".to_string(), Value::from(checkpoint.sequence));
                    for (key, value) in
                        serialized_extensions(&checkpoint.extensions, JOURNAL_CHECKPOINT_KNOWN_KEYS)
                    {
                        object.insert(key, value);
                    }
                    Value::Object(object)
                })
                .unwrap_or(Value::Null),
        );
        lease_json.insert(
            "claimKeyId".to_string(),
            Value::from(lease.claim_key_id.clone()),
        );
        lease_json.insert(
            "claimStatus".to_string(),
            Value::from(lease.claim_status.as_str()),
        );
        lease_json.insert("unreconciled".to_string(), Value::from(lease.unreconciled));
        if let Some(minimum_next_fence) = &lease.minimum_next_fence {
            lease_json.insert("minimumNextFence".to_string(), minimum_next_fence.clone());
        }
        lease_json.insert(
            "deathEvidence".to_string(),
            lease
                .death_evidence
                .clone()
                .map(|evidence| {
                    let mut object = Map::new();
                    object.insert("kind".to_string(), Value::from(evidence.kind.as_str()));
                    object.insert("detail".to_string(), Value::from(evidence.detail));
                    object.insert("observedAt".to_string(), Value::from(evidence.observed_at));
                    for (key, value) in
                        serialized_extensions(&evidence.extensions, DEATH_EVIDENCE_KNOWN_KEYS)
                    {
                        object.insert(key, value);
                    }
                    Value::Object(object)
                })
                .unwrap_or(Value::Null),
        );
        if let Some(required) = lease.settlement_retry_required {
            lease_json.insert("settlementRetryRequired".to_string(), Value::from(required));
        }
        if let Some(retry_id) = &lease.settlement_retry_id {
            lease_json.insert(
                "settlementRetryId".to_string(),
                Value::from(retry_id.clone()),
            );
        }
        for (key, value) in serialized_extensions(&lease.extensions, LEASE_KNOWN_KEYS) {
            lease_json.insert(key, value);
        }

        let mut record = Map::new();
        record.insert(
            "schemaVersion".to_string(),
            Value::Number(serde_json::Number::from(
                AGENT_SESSION_RECORD_SCHEMA_VERSION,
            )),
        );
        record.insert(
            "sessionId".to_string(),
            Value::from(self.session_id.clone()),
        );
        record.insert("location".to_string(), Value::Object(location));
        record.insert("provider".to_string(), Value::from(self.provider.as_str()));
        record.insert(
            "providerHandleChain".to_string(),
            Value::Array(
                self.provider_handle_chain
                    .iter()
                    .map(ProviderHandleLink::to_json)
                    .collect(),
            ),
        );
        record.insert("accountHome".to_string(), Value::Object(account_home));
        if let Some(options) = &self.options {
            record.insert(
                "options".to_string(),
                Value::Object(
                    options
                        .iter()
                        .map(|(key, value)| (key.clone(), Value::from(value.clone())))
                        .collect(),
                ),
            );
        }
        if let Some(arguments) = &self.launch_args {
            record.insert(
                "launchArgs".to_string(),
                Value::Array(
                    arguments
                        .iter()
                        .map(|arg| Value::from(arg.clone()))
                        .collect(),
                ),
            );
        }
        record.insert("lease".to_string(), Value::Object(lease_json));
        record.insert("createdAt".to_string(), Value::from(self.created_at));
        record.insert("updatedAt".to_string(), Value::from(self.updated_at));
        for (key, value) in serialized_extensions(&self.extensions, RECORD_KNOWN_KEYS) {
            record.insert(key, value);
        }
        Value::Object(record)
    }
}
