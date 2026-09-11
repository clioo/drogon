//! RPC client: request-id generation, strict per-method result decoding.

use std::path::Path;
use std::time::Duration;

use base64::Engine as _;
use drogon_protocol::Request;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{CliError, internal_error};
use crate::paths::{self, Endpoint};
use crate::transport;

/// Typed view of `status` results (protocol v1 §Methods).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResult {
    pub host_id: String,
    pub service_instance_id: String,
    pub protocol: u32,
    pub capabilities: Vec<String>,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    Folder,
    Git,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: WorkspaceKind,
    pub host_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Live,
    Unverifiable,
    Exited,
}

/// Mirrors `session-contract.ts`'s `AgentState`. `NeedsInput` is produced
/// by `session.hook_event` (the per-session Claude Code hooks file) and
/// carries the hook timestamp in `agentStateAt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Working,
    Idle,
    NeedsInput,
    Exited,
    Unknown,
}

impl AgentState {
    pub fn as_wire(self) -> &'static str {
        match self {
            AgentState::Working => "working",
            AgentState::Idle => "idle",
            AgentState::NeedsInput => "needs_input",
            AgentState::Exited => "exited",
            AgentState::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub workspace_id: String,
    pub host_id: String,
    pub incarnation: String,
    pub command: String,
    pub args: Vec<String>,
    pub cols: u16,
    pub rows: u16,
    pub verdict: Verdict,
    pub exit_code: Option<i64>,
    #[serde(deserialize_with = "require_rfc3339")]
    pub created_at: String,
    pub agent_state: AgentState,
    pub agent_state_at: Option<String>,
}

/// A git repository or a plain folder that owns Worktrees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    Folder,
    Git,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub host_id: String,
    pub path: String,
    pub name: String,
    pub kind: ProjectKind,
    pub default_base_ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectList {
    pub projects: Vec<Project>,
}

/// A git worktree, or (for a folder Project) the implicit single worktree
/// that is the folder itself — `branch`/`head` are then empty strings, never
/// null (the wire type keeps them non-nullable; `baseRef` is the nullable
/// field).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub project_id: String,
    pub workspace_id: String,
    pub path: String,
    pub branch: String,
    pub head: String,
    pub base_ref: Option<String>,
    #[serde(deserialize_with = "require_rfc3339")]
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeList {
    pub worktrees: Vec<Worktree>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    pub id: String,
    pub removed: bool,
}

impl Workspace {
    pub fn kind_str(&self) -> &'static str {
        match self.kind {
            WorkspaceKind::Folder => "folder",
            WorkspaceKind::Git => "git",
        }
    }
}

impl Project {
    pub fn kind_str(&self) -> &'static str {
        match self.kind {
            ProjectKind::Folder => "folder",
            ProjectKind::Git => "git",
        }
    }
}

impl Session {
    pub fn verdict_str(&self) -> &'static str {
        match self.verdict {
            Verdict::Live => "live",
            Verdict::Unverifiable => "unverifiable",
            Verdict::Exited => "exited",
        }
    }

    /// Command plus args joined for display only; execution always uses the
    /// separate `command`/`args` fields.
    pub fn argv(&self) -> String {
        let mut joined = self.command.clone();
        for arg in &self.args {
            joined.push(' ');
            joined.push_str(arg);
        }
        joined
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceList {
    pub workspaces: Vec<Workspace>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionList {
    pub sessions: Vec<Session>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub session: Session,
    pub data_base64: String,
    pub start_cursor: u64,
    pub next_cursor: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub accepted_bytes: u64,
}

/// `harness.list` catalog. Harness ids stay strings (not the closed
/// coordinator enum) so a future service can advertise new harnesses and
/// older CLIs still display them; availability is checked against the
/// contract's three known values.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessCatalog {
    pub host_id: String,
    pub harnesses: Vec<HarnessEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEntry {
    pub harness_id: String,
    pub display_name: String,
    pub availability: String,
    pub executable: Option<String>,
}

/// The three availability values fixed by the harness contract.
pub const HARNESS_AVAILABILITIES: [&str; 3] = ["available", "missing", "unsupported_launcher"];

/// Last-run projection inside `automation.list` items.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationLastRun {
    pub id: String,
    pub status: String,
    pub trigger: String,
    pub scheduled_for: f64,
    pub error: Option<String>,
    pub exit_code: Option<i64>,
}

/// One `automation.list` / `automation.create` item.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSummary {
    pub id: String,
    pub name: String,
    pub cron: String,
    pub workspace_id: Option<String>,
    pub harness: String,
    pub prompt: String,
    pub enabled: bool,
    pub next_run_at: f64,
    pub last_run_at: Option<f64>,
    pub last_run: Option<AutomationLastRun>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationList {
    pub automations: Vec<AutomationSummary>,
}

/// One `automation.history` entry, newest first.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunView {
    pub id: String,
    pub automation_id: String,
    pub status: String,
    pub trigger: String,
    pub scheduled_for: f64,
    pub workspace_id: Option<String>,
    pub terminal_session_id: Option<String>,
    pub error: Option<String>,
    pub exit_code: Option<i64>,
    pub started_at: Option<f64>,
    pub dispatched_at: Option<f64>,
    pub created_at: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationHistory {
    pub runs: Vec<AutomationRunView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunNow {
    pub automation_id: String,
    pub run_id: Option<String>,
    pub outcome: String,
    pub status: Option<String>,
    pub refusal: Option<String>,
    pub error: Option<String>,
}

/// One decoded, validated protocol result.
#[derive(Debug, Clone)]
pub enum MethodResult {
    Status(StatusResult),
    Workspace(Workspace),
    WorkspaceList(WorkspaceList),
    Session(Session),
    SessionList(SessionList),
    Read(ReadResult),
    Write(WriteResult),
}

pub struct Client {
    endpoint: Endpoint,
    auth_token: String,
    pub data_dir: std::path::PathBuf,
}

/// A validated `ok:true` response with its raw envelope.
pub struct CallOk {
    pub request_id: String,
    pub raw: Value,
    pub result: Value,
}

impl Client {
    /// Resolves the endpoint and the wire credential: the dispatch
    /// capability when present, else the service token. A missing runtime is
    /// `unverifiable` (exit 1); this never starts a service. The request id
    /// minted by the caller (explicit `--request-id` or a fresh UUID) is
    /// attached to any failure so ambiguous mutations stay replayable.
    pub fn open(data_dir: &Path, request_id: &str) -> Result<Client, CliError> {
        if !data_dir.is_dir() {
            return Err(CliError::Local {
                error: paths::missing_runtime(format!(
                    "no Drogon runtime is reachable at {}: data directory does not exist",
                    data_dir.display()
                )),
                request_id: request_id.to_string(),
            });
        }
        let auth_token = crate::credential::resolve(data_dir, request_id)?;
        Ok(Client {
            endpoint: paths::endpoint_for(data_dir),
            auth_token,
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    /// Executes one method. The request id comes from the caller (either an
    /// explicit `--request-id` or a UUID minted before the transport stage so
    /// it can be preserved on any failure). There is no automatic retry: a
    /// lost response stays a lost response and keeps its request id.
    pub async fn call(
        &self,
        method: &str,
        params: Value,
        request_id: &str,
        timeout: Duration,
    ) -> Result<CallOk, CliError> {
        // Envelope pre-flight: validate with a Result instead of panicking on
        // externally provided params (the diagnostic `rpc` verb forwards
        // caller-chosen methods here).
        Request {
            protocol: drogon_protocol::PROTOCOL_VERSION,
            request_id: request_id.to_string(),
            auth: None,
            method: method.to_string(),
            params: params.clone(),
        }
        .validate()
        .map_err(|err| CliError::local(err, request_id))?;
        let ok = transport::roundtrip(
            &self.endpoint,
            &self.auth_token,
            method,
            params,
            request_id,
            timeout,
        )
        .await?;
        Ok(CallOk {
            request_id: ok.request_id,
            raw: ok.raw,
            result: ok.result,
        })
    }

    pub fn decode<T: serde::de::DeserializeOwned>(
        call: &CallOk,
        method: &str,
    ) -> Result<T, CliError> {
        serde_json::from_value(call.result.clone()).map_err(|_| {
            CliError::local(
                internal_error(format!(
                    "service returned a malformed {method} result; refusing to guess"
                )),
                &call.request_id,
            )
        })
    }

    /// Decode plus per-method protocol-invariant checks (wire-shape checks
    /// alone would let structurally-valid but semantically-impossible results
    /// through, e.g. cols=0 or a cursor range that does not match the bytes).
    pub fn decode_checked<T: serde::de::DeserializeOwned>(
        call: &CallOk,
        method: &str,
        check: impl Fn(&T) -> Result<(), String>,
    ) -> Result<T, CliError> {
        let decoded: T = Client::decode(call, method)?;
        check(&decoded).map_err(|violation| {
            CliError::local(
                internal_error(format!(
                    "service returned a {method} result violating protocol invariants: {violation}"
                )),
                &call.request_id,
            )
        })?;
        Ok(decoded)
    }
}

fn require_nonempty(field: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    Ok(())
}

/// `status`: identity fields present and protocol pinned to v1.
pub fn check_status(result: &StatusResult) -> Result<(), String> {
    require_nonempty("hostId", &result.host_id)?;
    require_nonempty("serviceInstanceId", &result.service_instance_id)?;
    require_nonempty("version", &result.version)?;
    if result.protocol != drogon_protocol::PROTOCOL_VERSION {
        return Err(format!(
            "protocol must be {}, got {}",
            drogon_protocol::PROTOCOL_VERSION,
            result.protocol
        ));
    }
    Ok(())
}

pub fn check_workspace(workspace: &Workspace) -> Result<(), String> {
    require_nonempty("id", &workspace.id)?;
    require_nonempty("path", &workspace.path)?;
    require_nonempty("hostId", &workspace.host_id)?;
    Ok(())
}

pub fn check_workspace_list(list: &WorkspaceList) -> Result<(), String> {
    for workspace in &list.workspaces {
        check_workspace(workspace).map_err(|err| format!("workspace {}: {err}", workspace.id))?;
    }
    Ok(())
}

pub fn check_project(project: &Project) -> Result<(), String> {
    require_nonempty("id", &project.id)?;
    require_nonempty("hostId", &project.host_id)?;
    require_nonempty("path", &project.path)?;
    require_nonempty("name", &project.name)?;
    Ok(())
}

pub fn check_project_list(list: &ProjectList) -> Result<(), String> {
    for project in &list.projects {
        check_project(project).map_err(|err| format!("project {}: {err}", project.id))?;
    }
    Ok(())
}

/// `branch`/`head` are not required nonempty here: a folder Project's
/// implicit worktree reports both as `""`, which is valid, not malformed.
pub fn check_worktree(worktree: &Worktree) -> Result<(), String> {
    require_nonempty("id", &worktree.id)?;
    require_nonempty("projectId", &worktree.project_id)?;
    require_nonempty("workspaceId", &worktree.workspace_id)?;
    require_nonempty("path", &worktree.path)?;
    Ok(())
}

pub fn check_worktree_list(list: &WorktreeList) -> Result<(), String> {
    for worktree in &list.worktrees {
        check_worktree(worktree).map_err(|err| format!("worktree {}: {err}", worktree.id))?;
    }
    Ok(())
}

pub fn check_removed(removed: &Removed, expected_id: &str) -> Result<(), String> {
    if removed.id != expected_id {
        return Err(format!(
            "removed id {:?} does not match requested {:?}",
            removed.id, expected_id
        ));
    }
    if !removed.removed {
        return Err("removed must be true".to_string());
    }
    Ok(())
}

/// Session identities and PTY geometry must be real: empty ids and
/// out-of-range dimensions are structurally decodable but not actionable.
/// Also pins the agent-state/verdict/timestamp cross-field invariants the
/// service actually implements: an exited session is always agentState
/// `exited`, and `working`/`idle`/`needs_input` carry a non-null
/// `agentStateAt` (activity stamp, the hook-event stamp for the wait
/// signal, or the hook turn transition for hook-derived states that have
/// produced no output yet — the fresh-session idle boundary and a silent
/// hook-reported turn) the card freshness ranking sorts on. An exited
/// session honestly
/// keeps its last agent-state timestamp (#222: a pre-restart wait stamp
/// outlives the exit in rows written before the daemon cleared them), so
/// `exited` accepts a null or non-null `agentStateAt`; renderers treat it
/// as history, never as a live wait signal.
pub fn check_session(session: &Session) -> Result<(), String> {
    require_nonempty("id", &session.id)?;
    require_nonempty("workspaceId", &session.workspace_id)?;
    require_nonempty("hostId", &session.host_id)?;
    require_nonempty("incarnation", &session.incarnation)?;
    if !(1..=1000).contains(&session.cols) {
        return Err(format!("cols must be 1..=1000, got {}", session.cols));
    }
    if !(1..=1000).contains(&session.rows) {
        return Err(format!("rows must be 1..=1000, got {}", session.rows));
    }
    if session.verdict == Verdict::Exited && session.agent_state != AgentState::Exited {
        return Err(format!(
            "verdict exited must pair with agentState exited, got {:?}",
            session.agent_state
        ));
    }
    match session.agent_state {
        AgentState::Working | AgentState::Idle | AgentState::NeedsInput => {
            if session.agent_state_at.is_none() {
                return Err(format!(
                    "agentState {:?} must carry a non-null agentStateAt",
                    session.agent_state
                ));
            }
        }
        AgentState::Unknown => {
            if session.agent_state_at.is_some() {
                return Err(format!(
                    "agentState {:?} must not carry an agentStateAt",
                    session.agent_state
                ));
            }
        }
        // Exited keeps its last timestamp as history (see the doc above);
        // nothing to check here.
        AgentState::Exited => {}
    }
    Ok(())
}

pub fn check_session_list(list: &SessionList) -> Result<(), String> {
    for session in &list.sessions {
        check_session(session).map_err(|err| format!("session {}: {err}", session.id))?;
    }
    Ok(())
}

/// Splits a `session.list` result into the records that satisfy the session
/// invariants plus one honest warning per rejected record, so a single bad
/// record can never fail the whole list (#222). Callers render the kept
/// records and surface the warnings on stderr.
pub fn partition_session_list(list: SessionList) -> (Vec<Session>, Vec<String>) {
    let mut kept = Vec::with_capacity(list.sessions.len());
    let mut warnings = Vec::new();
    for session in list.sessions {
        match check_session(&session) {
            Ok(()) => kept.push(session),
            Err(violation) => warnings.push(format!("session {}: {violation}", session.id)),
        }
    }
    (kept, warnings)
}

/// A read result must be internally consistent: valid base64 whose decoded
/// byte count exactly fills the reported cursor range.
pub fn check_read(result: &ReadResult) -> Result<(), String> {
    check_session(&result.session)
        .map_err(|err| format!("session {}: {err}", result.session.id))?;
    decode_terminal_bytes(&result.data_base64, result.start_cursor, result.next_cursor).map(|_| ())
}

pub fn decode_terminal_bytes(data: &str, start: u64, next: u64) -> Result<Vec<u8>, String> {
    if next < start {
        return Err(format!(
            "nextCursor ({next}) must not be below startCursor ({start})"
        ));
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "dataBase64 is not valid base64".to_string())?;
    let span = next - start;
    if decoded.len() as u64 != span {
        return Err(format!(
            "cursor range covers {span} bytes but dataBase64 decodes to {}",
            decoded.len()
        ));
    }
    Ok(decoded)
}

/// Automation identities must be real and timestamps finite: empty ids and
/// NaN times are structurally decodable but not actionable.
pub fn check_automation(summary: &AutomationSummary) -> Result<(), String> {
    require_nonempty("id", &summary.id)?;
    require_nonempty("name", &summary.name)?;
    require_nonempty("cron", &summary.cron)?;
    require_nonempty("harness", &summary.harness)?;
    if !summary.next_run_at.is_finite() || summary.next_run_at < 0.0 {
        return Err("nextRunAt must be a finite non-negative time".to_string());
    }
    if let Some(last) = &summary.last_run {
        require_nonempty("lastRun.id", &last.id)?;
        require_nonempty("lastRun.status", &last.status)?;
    }
    Ok(())
}

pub fn check_automation_list(list: &AutomationList) -> Result<(), String> {
    for summary in &list.automations {
        check_automation(summary).map_err(|err| format!("automation {}: {err}", summary.id))?;
    }
    Ok(())
}

pub fn check_automation_history(history: &AutomationHistory) -> Result<(), String> {
    for run in &history.runs {
        require_nonempty("id", &run.id)?;
        require_nonempty("status", &run.status)?;
        if !run.created_at.is_finite() {
            return Err(format!("run {} has a non-finite createdAt", run.id));
        }
    }
    Ok(())
}

pub fn check_automation_run_now(result: &AutomationRunNow) -> Result<(), String> {
    require_nonempty("automationId", &result.automation_id)?;
    if result.outcome != "dispatched" && result.outcome != "refused" {
        return Err(format!(
            "outcome must be dispatched|refused, got {}",
            result.outcome
        ));
    }
    Ok(())
}

/// Where the notes folder came from and what state it is in. Every field is
/// required: an unavailable answer without a reason, or a root without a
/// state, is exactly the dishonest shape this surface exists to prevent.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAvailability {
    pub status: String,
    pub reason: String,
    pub platform: String,
    pub supported: bool,
    pub installation: String,
    pub configuration: String,
    pub configured: bool,
    pub config_path: String,
    pub config_present: bool,
    pub transcript_root: String,
    pub transcript_root_source: String,
    pub transcript_root_state: String,
    pub read_only: bool,
}

/// One indexed meeting note.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTranscript {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub file_path: String,
    pub relative_path: String,
    pub date_folder: String,
    pub started_at: Option<String>,
    pub duration_minutes: Option<u32>,
    pub status: String,
    pub excerpt: String,
    pub failure_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingList {
    pub availability: MeetingAvailability,
    pub meetings: Vec<MeetingTranscript>,
    pub total: u64,
    pub offset: u32,
    pub limit: u32,
    pub has_more: bool,
    pub scan_truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingRead {
    pub meeting: MeetingTranscript,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}

/// Invariants `meeting.list` must satisfy before any of it is printed:
/// the folder is always named and its provenance/state are always known,
/// the index is always read-only, a failed transcript always names its
/// reason, and a healthy one never carries one.
pub fn check_meeting_list(list: &MeetingList) -> Result<(), String> {
    check_meeting_availability(&list.availability)?;
    for meeting in &list.meetings {
        check_meeting_transcript(meeting)?;
    }
    if list.limit == 0 || list.limit > 200 {
        return Err(format!("limit {} is outside 1..=200", list.limit));
    }
    let page = list.meetings.len() as u64;
    if list.has_more && (list.offset as u64).saturating_add(page) >= list.total {
        return Err(format!(
            "hasMore is true but offset {} + {} rows covers the reported total {}",
            list.offset, page, list.total
        ));
    }
    // An offset past the end is a legitimate empty page (`--offset 50` on a
    // four-meeting folder); only a page that actually carries rows can
    // overrun the reported total.
    if page > 0 && (list.offset as u64).saturating_add(page) > list.total {
        return Err(format!(
            "offset {} + {} rows exceeds the reported total {}",
            list.offset, page, list.total
        ));
    }
    Ok(())
}

pub fn check_meeting_read(read: &MeetingRead) -> Result<(), String> {
    check_meeting_transcript(&read.meeting)?;
    if read.truncated && read.size <= read.content.len() as u64 {
        return Err(format!(
            "truncated is true but size {} is not larger than the {} bytes returned",
            read.size,
            read.content.len()
        ));
    }
    Ok(())
}

fn check_meeting_availability(availability: &MeetingAvailability) -> Result<(), String> {
    if availability.status != "available" && availability.status != "unavailable" {
        return Err(format!(
            "availability.status must be available|unavailable, got {}",
            availability.status
        ));
    }
    if ![
        "unsupported-platform",
        "not-installed",
        "invalid-configuration",
        "transcript-root-missing",
        "transcript-root-unreadable",
        "empty",
        "ready",
    ]
    .contains(&availability.reason.as_str())
    {
        return Err(format!(
            "availability.reason {} is not a documented state",
            availability.reason
        ));
    }
    require_nonempty("transcriptRoot", &availability.transcript_root)?;
    require_nonempty("configPath", &availability.config_path)?;
    if !["default", "config", "environment"].contains(&availability.transcript_root_source.as_str())
    {
        return Err(format!(
            "transcriptRootSource must be default|config|environment, got {}",
            availability.transcript_root_source
        ));
    }
    if !["readable", "missing", "unreadable"].contains(&availability.transcript_root_state.as_str())
    {
        return Err(format!(
            "transcriptRootState must be readable|missing|unreadable, got {}",
            availability.transcript_root_state
        ));
    }
    if !["installed", "not-installed", "unsupported"].contains(&availability.installation.as_str())
    {
        return Err(format!(
            "installation must be installed|not-installed|unsupported, got {}",
            availability.installation
        ));
    }
    if !["defaults", "configured", "invalid"].contains(&availability.configuration.as_str()) {
        return Err(format!(
            "configuration must be defaults|configured|invalid, got {}",
            availability.configuration
        ));
    }
    if !availability.read_only {
        return Err("the meetings index must report readOnly: true".to_string());
    }
    if availability.status == "available"
        && availability.reason != "ready"
        && availability.reason != "empty"
    {
        return Err(format!(
            "status available contradicts reason {}",
            availability.reason
        ));
    }
    Ok(())
}

fn check_meeting_transcript(meeting: &MeetingTranscript) -> Result<(), String> {
    require_nonempty("id", &meeting.id)?;
    require_nonempty("title", &meeting.title)?;
    require_nonempty("fileName", &meeting.file_name)?;
    require_nonempty("filePath", &meeting.file_path)?;
    require_nonempty("relativePath", &meeting.relative_path)?;
    require_nonempty("dateFolder", &meeting.date_folder)?;
    if !meeting.id.starts_with("write-that-down:") {
        return Err(format!(
            "meeting id {} is not a Write That Down transcript id",
            meeting.id
        ));
    }
    match meeting.status.as_str() {
        "failed" => {
            if meeting.failure_reason.is_none() {
                return Err(format!(
                    "failed transcript {} must name a failureReason",
                    meeting.file_name
                ));
            }
        }
        "recording" | "saved" => {
            if meeting.failure_reason.is_some() {
                return Err(format!(
                    "healthy transcript {} must not carry a failureReason",
                    meeting.file_name
                ));
            }
            if meeting.status == "saved" && meeting.duration_minutes.is_none() {
                return Err(format!(
                    "saved transcript {} must carry a duration",
                    meeting.file_name
                ));
            }
            if meeting.status == "recording" && meeting.duration_minutes.is_some() {
                return Err(format!(
                    "recording transcript {} must not carry a duration",
                    meeting.file_name
                ));
            }
        }
        other => {
            return Err(format!(
                "meeting status must be recording|saved|failed, got {other}"
            ));
        }
    }
    Ok(())
}

/// One embedded browser pane tab, as executed by the desktop host and
/// relayed through the daemon (`browser.relay.v1`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTab {
    pub tab_id: String,
    pub workspace_id: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub error: Option<String>,
}

/// Bounded page snapshot: URL, title and DOM text for agent use.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSnapshot {
    pub tab_id: String,
    pub url: String,
    pub title: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabsList {
    pub tabs: Vec<BrowserTab>,
}

/// Relay tab identities must be real and the snapshot text bounded: the
/// daemon caps DOM text at 32768 characters, so anything larger is a
/// contract violation, never a display problem.
pub fn check_browser_tab(tab: &BrowserTab) -> Result<(), String> {
    require_nonempty("tabId", &tab.tab_id)?;
    require_nonempty("workspaceId", &tab.workspace_id)?;
    Ok(())
}

pub fn check_browser_snapshot(snapshot: &BrowserSnapshot) -> Result<(), String> {
    require_nonempty("tabId", &snapshot.tab_id)?;
    if snapshot.text.chars().count() > 32_768 {
        return Err(format!(
            "snapshot text is {} characters, over the 32768 budget",
            snapshot.text.chars().count()
        ));
    }
    Ok(())
}

pub fn check_browser_tabs(list: &BrowserTabsList) -> Result<(), String> {
    for tab in &list.tabs {
        check_browser_tab(tab).map_err(|err| format!("tab {}: {err}", tab.tab_id))?;
    }
    Ok(())
}

/// The pinned Mentu runtime's identity, as `mentu.runtime` reports it.
/// Field names mirror `crates/drogon-protocol/src/mentu.rs` exactly.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRuntimeInfo {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub expected_revision: String,
    pub expected_sha256: String,
    pub actual_sha256: Option<String>,
    pub lock_matches: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRuntimeResult {
    pub runtime: MentuRuntimeInfo,
}

/// One recipe discovered under a workspace's `.mentu/recipes`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipeSummary {
    pub id: String,
    pub path: String,
    pub name: Option<String>,
    pub valid: bool,
    pub issue: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRecipesResult {
    pub recipes: Vec<MentuRecipeSummary>,
}

/// What `mentu open` reports: the desktop's own verdict, relayed back.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuOpenResult {
    pub workspace_id: String,
    pub recipe_id: Option<String>,
    /// Always true on a successful RPC: a refusal is an RPC-level error, so
    /// this field can never claim an open that the desktop rejected.
    pub opened: bool,
}

pub fn check_mentu_runtime(result: &MentuRuntimeResult) -> Result<(), String> {
    // Same host-independent invariants the desktop's zod contract enforces:
    // the lock identity is always present, and a claimed availability must
    // be backed by an actual digest.
    require_nonempty("expectedRevision", &result.runtime.expected_revision)?;
    require_nonempty("expectedSha256", &result.runtime.expected_sha256)?;
    if result.runtime.available && result.runtime.actual_sha256.is_none() {
        return Err("runtime claims availability without an actual sha256".into());
    }
    if result.runtime.available != result.runtime.lock_matches {
        return Err("runtime availability and lock verdict disagree".into());
    }
    if result.runtime.available && result.runtime.message.is_some() {
        return Err("an available runtime must not carry an unavailable message".into());
    }
    Ok(())
}

pub fn check_mentu_recipes(result: &MentuRecipesResult) -> Result<(), String> {
    for recipe in &result.recipes {
        require_nonempty("id", &recipe.id)?;
        require_nonempty("path", &recipe.path)?;
        // An invalid recipe must say why; a bare `valid: false` would be an
        // unusable answer for an agent deciding what to do next.
        if !recipe.valid && recipe.issue.as_deref().unwrap_or("").is_empty() {
            return Err(format!("recipe {}: invalid without an issue", recipe.id));
        }
    }
    Ok(())
}

pub fn check_mentu_open(result: &MentuOpenResult) -> Result<(), String> {
    require_nonempty("workspaceId", &result.workspace_id)?;
    if !result.opened {
        return Err("the desktop reported the Mentu tab as not opened".into());
    }
    Ok(())
}

/// One explicit, content-bound approval, as the daemon recorded it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuApproval {
    pub id: String,
    pub workspace_id: String,
    pub recipe_id: String,
    pub content_hash: String,
    pub approved_at: String,
}

/// `mentu.pending_approval`: `null` means this recipe's exact current bytes
/// are NOT approved, which `mentu run` reports as a refusal rather than
/// approving them itself.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuPendingApprovalResult {
    pub approval: Option<MentuApproval>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MentuRunStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Unavailable,
}

impl MentuRunStatus {
    pub fn as_wire(self) -> &'static str {
        match self {
            MentuRunStatus::Running => "running",
            MentuRunStatus::Succeeded => "succeeded",
            MentuRunStatus::Failed => "failed",
            MentuRunStatus::Cancelled => "cancelled",
            MentuRunStatus::Unavailable => "unavailable",
        }
    }

    /// `unavailable` is terminal for the CLI's purposes: the host never
    /// confirmed an outcome, so waiting longer would not produce one.
    pub fn is_terminal(self) -> bool {
        !matches!(self, MentuRunStatus::Running)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuStepRun {
    pub label: String,
    pub backend: String,
    pub status: MentuRunStatus,
    pub exit_code: Option<i64>,
    pub duration_seconds: Option<i64>,
    pub attempts: Option<i64>,
    pub output_path: Option<String>,
    pub error_path: Option<String>,
    pub error: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRun {
    pub id: String,
    pub workspace_id: String,
    pub recipe_id: String,
    pub approval_id: String,
    pub mentu_run_id: Option<String>,
    pub status: MentuRunStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub steps: Vec<MentuStepRun>,
    pub error: Option<String>,
    pub retry_of: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunResult {
    pub run: MentuRun,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRunsResult {
    pub runs: Vec<MentuRun>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuCancelResult {
    pub run: MentuRun,
}

pub fn check_mentu_approval(approval: &MentuApproval) -> Result<(), String> {
    require_nonempty("id", &approval.id)?;
    require_nonempty("workspaceId", &approval.workspace_id)?;
    require_nonempty("recipeId", &approval.recipe_id)?;
    if approval.content_hash.len() != 64
        || !approval.content_hash.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("approval content hash is not a 64-character hex digest".into());
    }
    require_nonempty("approvedAt", &approval.approved_at)?;
    Ok(())
}

pub fn check_mentu_pending_approval(result: &MentuPendingApprovalResult) -> Result<(), String> {
    match &result.approval {
        Some(approval) => check_mentu_approval(approval),
        None => Ok(()),
    }
}

pub fn check_mentu_run(run: &MentuRun) -> Result<(), String> {
    require_nonempty("id", &run.id)?;
    require_nonempty("workspaceId", &run.workspace_id)?;
    require_nonempty("recipeId", &run.recipe_id)?;
    require_nonempty("approvalId", &run.approval_id)?;
    require_nonempty("startedAt", &run.started_at)?;
    if run.status != MentuRunStatus::Running && run.ended_at.is_none() {
        return Err(format!(
            "run {} is {} without an endedAt",
            run.id,
            run.status.as_wire()
        ));
    }
    for step in &run.steps {
        require_nonempty("label", &step.label)?;
        require_nonempty("backend", &step.backend)?;
    }
    Ok(())
}

pub fn check_mentu_run_result(result: &MentuRunResult) -> Result<(), String> {
    check_mentu_run(&result.run)
}

pub fn check_mentu_runs(result: &MentuRunsResult) -> Result<(), String> {
    for run in &result.runs {
        check_mentu_run(run).map_err(|err| format!("run {}: {err}", run.id))?;
    }
    Ok(())
}

/// The service must accept exactly the bytes the CLI sent, no more, no less.
pub fn check_write(result: &WriteResult, expected_bytes: u64) -> Result<(), String> {
    if result.accepted_bytes != expected_bytes {
        return Err(format!(
            "acceptedBytes ({}) does not match the {} bytes sent",
            result.accepted_bytes, expected_bytes
        ));
    }
    Ok(())
}

/// Catalog invariants: same host as the status identity, real ids and display
/// names, contract availability values, and executable shape consistency —
/// `available` demands an absolute host path, `missing` must not claim one.
/// Absolute-ness is judged by path shape (unix `/...`, windows `X:\…`,
/// `X:/…` or `\\unc`), never by the client's own platform path parser, so a
/// Windows execution host's paths survive on a macOS client.
pub fn check_harness_catalog(catalog: &HarnessCatalog, status_host_id: &str) -> Result<(), String> {
    require_nonempty("hostId", &catalog.host_id)?;
    if catalog.host_id != status_host_id {
        return Err(format!(
            "catalog hostId {:?} does not match the service host identity {:?}",
            catalog.host_id, status_host_id
        ));
    }
    for entry in &catalog.harnesses {
        check_harness_entry(entry)
            .map_err(|err| format!("harness {:?}: {err}", entry.harness_id))?;
    }
    Ok(())
}

fn check_harness_entry(entry: &HarnessEntry) -> Result<(), String> {
    require_nonempty("harnessId", &entry.harness_id)?;
    require_nonempty("displayName", &entry.display_name)?;
    if !HARNESS_AVAILABILITIES.contains(&entry.availability.as_str()) {
        return Err(format!(
            "unknown availability {:?} (expected one of {HARNESS_AVAILABILITIES:?})",
            entry.availability
        ));
    }
    let executable_claimed = entry
        .executable
        .as_deref()
        .is_some_and(|path| !path.is_empty());
    match entry.availability.as_str() {
        "available" => {
            let executable = entry
                .executable
                .as_deref()
                .filter(|path| !path.is_empty())
                .ok_or_else(|| "is available but claims no executable".to_string())?;
            if executable.chars().any(char::is_control) {
                return Err("executable contains control characters".to_string());
            }
            if !looks_absolute_host_path(executable) {
                return Err(format!(
                    "is available but its executable {executable:?} is not an absolute host path"
                ));
            }
        }
        "missing" => {
            if executable_claimed {
                return Err("is missing but claims an executable".to_string());
            }
        }
        // The launcher is known but unsupported on this host; the discovered
        // path may or may not be present.
        "unsupported_launcher" => {}
        _ => unreachable!("availability enum checked above"),
    }
    Ok(())
}

/// Shape-based absolute-path check that accepts either execution-host
/// convention: unix `/...`, windows drive `C:\...`/`C:/...`, or windows UNC
/// `\\server\...`.
pub fn looks_absolute_host_path(path: &str) -> bool {
    if path.is_empty() || path.chars().any(char::is_control) {
        return false;
    }
    if path.starts_with('/') {
        return true;
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    path.starts_with("\\\\")
}

/// Strict UTC RFC3339 check (`YYYY-MM-DDTHH:MM:SS[.frac][Z|±HH:MM]`). The
/// service emits `Z`-suffixed second-resolution stamps, but fractional seconds
/// and numeric offsets are legal RFC3339 too.
fn require_rfc3339<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if is_rfc3339_utc(&value) {
        Ok(value)
    } else {
        Err(serde::de::Error::custom(format!(
            "createdAt is not RFC3339: {value}"
        )))
    }
}

/// Strict RFC3339 check operating on bytes only — every byte is inspected
/// before any slicing, so malformed multi-byte UTF-8 is rejected, never
/// panicked on. Calendar validation includes month lengths and leap years,
/// and numeric UTC offsets are bounded to ±23:59.
pub fn is_rfc3339_utc(timestamp: &str) -> bool {
    let bytes = timestamp.as_bytes();
    // RFC3339 date-time is pure ASCII; bail out before any byte indexing so a
    // string like "…+aé:x" can never split a multi-byte character.
    if !timestamp.is_ascii() || bytes.len() < 20 {
        return false;
    }
    let digit = |b: u8| b.is_ascii_digit();
    let digits = |slice: &[u8]| slice.iter().all(|b| digit(*b));
    let number = |slice: &[u8]| -> Option<u32> {
        if slice.is_empty() || !digits(slice) {
            return None;
        }
        slice
            .iter()
            .fold(0u32, |acc, b| acc * 10 + u32::from(b - b'0'))
            .into()
    };
    let pattern_ok = digits(&bytes[0..4])
        && bytes[4] == b'-'
        && digits(&bytes[5..7])
        && bytes[7] == b'-'
        && digits(&bytes[8..10])
        && (bytes[10] == b'T' || bytes[10] == b't')
        && digits(&bytes[11..13])
        && bytes[13] == b':'
        && digits(&bytes[14..16])
        && bytes[16] == b':'
        && digits(&bytes[17..19]);
    if !pattern_ok {
        return false;
    }
    let year: u32 = number(&bytes[0..4]).unwrap_or(0);
    let month = number(&bytes[5..7]).unwrap_or(0);
    let day = number(&bytes[8..10]).unwrap_or(0);
    let hour = number(&bytes[11..13]).unwrap_or(99);
    let minute = number(&bytes[14..16]).unwrap_or(99);
    // Second 60 is the RFC3339 leap-second spelling.
    let second = number(&bytes[17..19]).unwrap_or(99);
    if !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 60 {
        return false;
    }
    if day == 0 || day > days_in_month(year, month) {
        return false;
    }
    // Optional fractional seconds, then Z/z or ±HH:MM.
    let mut index = 19;
    if bytes[index] == b'.' {
        index += 1;
        let fraction_start = index;
        while index < bytes.len() && digit(bytes[index]) {
            index += 1;
        }
        if index == fraction_start {
            return false;
        }
    }
    let tail = &bytes[index..];
    match tail {
        [b'Z'] | [b'z'] => true,
        [sign, h1, h2, b':', m1, m2] => {
            (sign == &b'+' || sign == &b'-')
                && digits(&[*h1, *h2])
                && digits(&[*m1, *m2])
                && number(&[*h1, *h2]).is_some_and(|h| h <= 23)
                && number(&[*m1, *m2]).is_some_and(|m| m <= 59)
        }
        _ => false,
    }
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

fn is_leap_year(year: u32) -> bool {
    year.is_multiple_of(4) && !year.is_multiple_of(100) || year.is_multiple_of(400)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_accepts_service_shape_and_legal_variants() {
        assert!(is_rfc3339_utc("2026-09-05T12:34:56Z"));
        assert!(is_rfc3339_utc("2026-09-05T12:34:56.123456Z"));
        assert!(is_rfc3339_utc("2026-09-05T12:34:56+02:00"));
        assert!(is_rfc3339_utc("2026-09-05t12:34:56z"));
        assert!(is_rfc3339_utc("2024-02-29T00:00:00Z"), "leap day is real");
        assert!(is_rfc3339_utc("2000-02-29T00:00:00Z"), "400-year leap");
        assert!(is_rfc3339_utc("2026-09-05T23:59:60Z"), "leap second");
        assert!(is_rfc3339_utc("2026-09-05T12:34:56+23:59"));
        assert!(is_rfc3339_utc("2026-09-05T12:34:56.5Z"));
    }

    #[test]
    fn rfc3339_rejects_garbage() {
        assert!(!is_rfc3339_utc(""));
        assert!(!is_rfc3339_utc("2026-09-05 12:34:56"));
        assert!(!is_rfc3339_utc("2026-13-05T12:34:56Z"));
        assert!(!is_rfc3339_utc("2026-09-05T25:34:56Z"));
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56"));
        assert!(!is_rfc3339_utc("not-a-time"));
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56.Z"));
    }

    #[test]
    fn rfc3339_rejects_calendar_impossibilities() {
        assert!(
            !is_rfc3339_utc("2026-02-31T12:34:56Z"),
            "Feb 31 does not exist"
        );
        assert!(!is_rfc3339_utc("2026-02-29T12:34:56Z"), "non-leap Feb 29");
        assert!(!is_rfc3339_utc("1900-02-29T12:34:56Z"), "century non-leap");
        assert!(!is_rfc3339_utc("2026-04-31T12:34:56Z"), "April has 30 days");
        assert!(!is_rfc3339_utc("2026-00-10T12:34:56Z"), "month zero");
        assert!(!is_rfc3339_utc("2026-09-00T12:34:56Z"), "day zero");
    }

    #[test]
    fn rfc3339_rejects_out_of_range_offsets() {
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56+99:99"));
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56+24:00"));
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56+23:60"));
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56+2:00"));
    }

    #[test]
    fn rfc3339_survives_malformed_unicode_without_panicking() {
        // The offset contains a two-byte character; naive byte slicing on the
        // string form used to panic with a char-boundary error.
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56+aé:x"));
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56é"));
        assert!(!is_rfc3339_utc("éééé-09-05T12:34:56Z"));
        assert!(!is_rfc3339_utc("2026-09-05T12:34:56Z\u{1F600}"));
        assert!(!is_rfc3339_utc("\u{0}026-09-05T12:34:56Z"));
    }

    #[test]
    fn session_rejects_non_rfc3339_created_at() {
        let session: Result<Session, _> = serde_json::from_value(serde_json::json!({
            "id": "s1", "workspaceId": "w1", "hostId": "h1",
            "incarnation": "inc", "command": "sh", "args": [],
            "cols": 80, "rows": 24, "verdict": "live", "exitCode": null,
            "createdAt": "yesterday",
            "agentState": "unknown", "agentStateAt": null
        }));
        assert!(
            session.is_err(),
            "malformed createdAt must fail strict decode"
        );
    }

    #[test]
    fn session_tolerates_additive_fields() {
        let session: Session = serde_json::from_value(serde_json::json!({
            "id": "s1", "workspaceId": "w1", "hostId": "h1",
            "incarnation": "inc", "command": "sh", "args": [],
            "cols": 80, "rows": 24, "verdict": "unverifiable", "exitCode": null,
            "createdAt": "2026-09-05T12:00:00Z",
            "agentState": "unknown", "agentStateAt": null,
            "futureField": 7
        }))
        .unwrap();
        assert_eq!(session.verdict, Verdict::Unverifiable);
    }

    fn test_session(agent_state: AgentState, agent_state_at: Option<&str>) -> Session {
        Session {
            id: "s1".into(),
            workspace_id: "w1".into(),
            host_id: "h1".into(),
            incarnation: "inc".into(),
            command: "sh".into(),
            args: vec![],
            cols: 80,
            rows: 24,
            verdict: Verdict::Live,
            exit_code: None,
            created_at: "2026-09-05T12:00:00Z".into(),
            agent_state,
            agent_state_at: agent_state_at.map(str::to_string),
        }
    }

    #[test]
    fn exited_session_may_carry_its_last_state_timestamp() {
        // #222: rows written before the daemon cleared wait stamps on exit
        // list as `exited` with a non-null `agentStateAt`; that is honest
        // history and must validate.
        let mut stamped = test_session(AgentState::Exited, Some("2026-09-05T12:00:00Z"));
        stamped.verdict = Verdict::Exited;
        assert!(check_session(&stamped).is_ok());
        let mut bare = test_session(AgentState::Exited, None);
        bare.verdict = Verdict::Exited;
        assert!(check_session(&bare).is_ok());
    }

    #[test]
    fn live_state_invariants_still_hold() {
        assert!(check_session(&test_session(AgentState::Idle, None)).is_err());
        assert!(
            check_session(&test_session(
                AgentState::Unknown,
                Some("2026-09-05T12:00:00Z")
            ))
            .is_err()
        );
        let mut mismatched = test_session(AgentState::Idle, Some("2026-09-05T12:00:00Z"));
        mismatched.verdict = Verdict::Exited;
        assert!(check_session(&mismatched).is_err());
    }

    #[test]
    fn partition_session_list_isolates_one_bad_record() {
        let mut good = test_session(AgentState::Idle, Some("2026-09-05T12:00:00Z"));
        good.id = "good-1".into();
        let mut historic = test_session(AgentState::Exited, Some("2026-09-05T12:00:00Z"));
        historic.id = "good-2".into();
        historic.verdict = Verdict::Exited;
        let mut bad = test_session(AgentState::Unknown, None);
        bad.id = "bad-9".into();
        bad.cols = 0;
        let (kept, warnings) = partition_session_list(SessionList {
            sessions: vec![good, bad, historic],
        });
        assert_eq!(kept.len(), 2);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("bad-9"), "warning names the record");
    }

    #[test]
    fn workspace_rejects_unknown_kind() {
        let workspace: Result<Workspace, _> = serde_json::from_value(serde_json::json!({
            "id": "w1", "path": "/tmp", "name": "n", "kind": "svn", "hostId": "h1"
        }));
        assert!(workspace.is_err());
    }
}

#[cfg(test)]
mod harness_tests {
    use super::*;
    use serde_json::json;

    fn entry(harness_id: &str, availability: &str, executable: Option<&str>) -> HarnessEntry {
        serde_json::from_value(json!({
            "harnessId": harness_id,
            "displayName": "Display",
            "availability": availability,
            "executable": executable,
            "futureField": 1
        }))
        .unwrap()
    }

    #[test]
    fn absolute_path_shapes_from_both_host_conventions() {
        // Unix shape.
        assert!(looks_absolute_host_path("/opt/homebrew/bin/pi"));
        // Windows drive and UNC shapes must survive on a unix client.
        assert!(looks_absolute_host_path(r"C:\Users\me\bin\claude.exe"));
        assert!(looks_absolute_host_path("C:/Users/me/bin/claude.exe"));
        assert!(looks_absolute_host_path(r"\\server\share\agy.cmd"));
        // Relative and bare names are never absolute.
        assert!(!looks_absolute_host_path("bin/pi"));
        assert!(!looks_absolute_host_path("claude"));
        assert!(!looks_absolute_host_path("./claude"));
        assert!(!looks_absolute_host_path("../claude"));
        assert!(!looks_absolute_host_path(""));
        assert!(!looks_absolute_host_path("/bad\nline"));
    }

    #[test]
    fn catalog_invariants() {
        let good = HarnessCatalog {
            host_id: "host-1".into(),
            harnesses: vec![
                entry("pi", "available", Some("/opt/homebrew/bin/pi")),
                entry("opencode", "missing", None),
                entry("agy", "unsupported_launcher", Some(r"C:\bin\agy.cmd")),
            ],
        };
        assert!(check_harness_catalog(&good, "host-1").is_ok());

        // Host identity must match the status result.
        assert!(check_harness_catalog(&good, "other-host").is_err());

        // available without executable.
        let mut no_exec = good.clone();
        no_exec.harnesses[0].executable = None;
        assert!(check_harness_catalog(&no_exec, "host-1").is_err());

        // available with a relative executable.
        let mut rel_exec = good.clone();
        rel_exec.harnesses[0].executable = Some("bin/pi".into());
        assert!(check_harness_catalog(&rel_exec, "host-1").is_err());

        // missing claiming an executable.
        let mut claimed = good.clone();
        claimed.harnesses[1].executable = Some("/usr/bin/opencode".into());
        assert!(check_harness_catalog(&claimed, "host-1").is_err());

        // unknown availability.
        let mut weird = good.clone();
        weird.harnesses[1].availability = "upgradable".into();
        assert!(check_harness_catalog(&weird, "host-1").is_err());

        // empty display name.
        let mut unnamed = good.clone();
        unnamed.harnesses[0].display_name = String::new();
        assert!(check_harness_catalog(&unnamed, "host-1").is_err());

        // empty harness id.
        let mut idless = good;
        idless.harnesses[0].harness_id = String::new();
        assert!(check_harness_catalog(&idless, "host-1").is_err());
    }

    #[test]
    fn catalog_tolerates_unknown_harness_ids_and_additive_fields() {
        let catalog: HarnessCatalog = serde_json::from_value(json!({
            "hostId": "host-1",
            "harnesses": [
                {
                    "harnessId": "future-harness-9",
                    "displayName": "Future",
                    "availability": "available",
                    "executable": "/usr/bin/future",
                    "extra": {"nested": true}
                }
            ],
            "futureCatalogField": 7
        }))
        .expect("unknown ids and additive fields must decode");
        assert_eq!(catalog.harnesses[0].harness_id, "future-harness-9");
        assert!(check_harness_catalog(&catalog, "host-1").is_ok());
    }

    #[test]
    fn start_invariants_match_workspace_and_host() {
        let session: Session = serde_json::from_value(json!({
            "id": "s1", "workspaceId": "w1", "hostId": "host-1",
            "incarnation": "tok", "command": "/usr/bin/pi", "args": [],
            "cols": 80, "rows": 24, "verdict": "live", "exitCode": null,
            "createdAt": "2026-09-05T12:00:00Z",
            "agentState": "unknown", "agentStateAt": null
        }))
        .unwrap();
        assert!(check_session(&session).is_ok());
        assert_ne!(session.workspace_id, "other");
        assert_ne!(session.host_id, "other-host");
    }
}
