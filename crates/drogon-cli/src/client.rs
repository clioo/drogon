//! RPC client: request-id generation, strict per-method result decoding.

use std::path::Path;
use std::time::Duration;

use base64::Engine as _;
use drogon_protocol::Request;
use serde::Deserialize;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Live,
    Unverifiable,
    Exited,
}

#[derive(Debug, Clone, Deserialize)]
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
}

impl Workspace {
    pub fn kind_str(&self) -> &'static str {
        match self.kind {
            WorkspaceKind::Folder => "folder",
            WorkspaceKind::Git => "git",
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

#[derive(Debug, Clone, Deserialize)]
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
    /// Resolves the endpoint and reads the auth token. A missing runtime is
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
        let auth_token = paths::read_auth_token(data_dir).map_err(|error| CliError::Local {
            error,
            request_id: request_id.to_string(),
        })?;
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

/// Session identities and PTY geometry must be real: empty ids and
/// out-of-range dimensions are structurally decodable but not actionable.
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
    Ok(())
}

pub fn check_session_list(list: &SessionList) -> Result<(), String> {
    for session in &list.sessions {
        check_session(session).map_err(|err| format!("session {}: {err}", session.id))?;
    }
    Ok(())
}

/// A read result must be internally consistent: valid base64 whose decoded
/// byte count exactly fills the reported cursor range.
pub fn check_read(result: &ReadResult) -> Result<(), String> {
    check_session(&result.session)
        .map_err(|err| format!("session {}: {err}", result.session.id))?;
    if result.next_cursor < result.start_cursor {
        return Err(format!(
            "nextCursor ({}) must not be below startCursor ({})",
            result.next_cursor, result.start_cursor
        ));
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(result.data_base64.as_bytes())
        .map_err(|_| "dataBase64 is not valid base64".to_string())?;
    let span = result.next_cursor - result.start_cursor;
    if decoded.len() as u64 != span {
        return Err(format!(
            "cursor range covers {span} bytes but dataBase64 decodes to {}",
            decoded.len()
        ));
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
            "createdAt": "yesterday"
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
            "futureField": 7
        }))
        .unwrap();
        assert_eq!(session.verdict, Verdict::Unverifiable);
    }

    #[test]
    fn workspace_rejects_unknown_kind() {
        let workspace: Result<Workspace, _> = serde_json::from_value(serde_json::json!({
            "id": "w1", "path": "/tmp", "name": "n", "kind": "svn", "hostId": "h1"
        }));
        assert!(workspace.is_err());
    }
}
