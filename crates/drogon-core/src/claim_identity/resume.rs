//! Resumable-agent identity model and provider-session metadata
//! normalization.
//!
//! Ported from Orca's `src/shared/agent-session-resume.ts` (Lovecast Inc.,
//! MIT, source revision c97906287bb7a390b25e2025b600d9fb3c25d9c3) for the
//! claim-identity capability. Only the pieces the claim pipeline consumes are
//! translated here: the supported-agent set, session-id normalization (with
//! JavaScript UTF-16 length and `String.prototype.trim` semantics),
//! control-character rejection and per-agent resume argv rules. Hook-payload
//! extraction (`extractAgentProviderSession`) is resume-side and stays
//! outside this finite capability.

use serde_json::Value;

/// Every TUI agent whose sessions can be resumed, in source order.
pub const RESUMABLE_TUI_AGENTS: &[&str] = &[
    "claude",
    "codex",
    "gemini",
    "antigravity",
    "opencode",
    "pi",
    "mimo-code",
    "droid",
    "grok",
    "devin",
    "omp",
    "prime-agent",
    "copilot",
    "kimi",
];

/// Provider-owned resume key kinds, mirroring the source
/// `AgentProviderSessionKey`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AgentProviderSessionKey {
    SessionId,
    ConversationId,
}

impl AgentProviderSessionKey {
    /// The wire spelling used inside signed identity digests.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SessionId => "session_id",
            Self::ConversationId => "conversation_id",
        }
    }

    /// Parses the exact wire spellings; anything else is unsupported.
    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "session_id" => Some(Self::SessionId),
            "conversation_id" => Some(Self::ConversationId),
            _ => None,
        }
    }
}

/// A supported resumable TUI agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ResumableTuiAgent {
    Claude,
    Codex,
    Gemini,
    Antigravity,
    Opencode,
    Pi,
    MimoCode,
    Droid,
    Grok,
    Devin,
    Omp,
    PrimeAgent,
    Copilot,
    Kimi,
}

impl ResumableTuiAgent {
    /// The wire spelling used inside signed identity digests.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
            Self::Antigravity => "antigravity",
            Self::Opencode => "opencode",
            Self::Pi => "pi",
            Self::MimoCode => "mimo-code",
            Self::Droid => "droid",
            Self::Grok => "grok",
            Self::Devin => "devin",
            Self::Omp => "omp",
            Self::PrimeAgent => "prime-agent",
            Self::Copilot => "copilot",
            Self::Kimi => "kimi",
        }
    }

    /// Parses the exact agent spellings; anything else is unsupported.
    pub fn from_agent_name(value: &str) -> Option<Self> {
        match value {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "gemini" => Some(Self::Gemini),
            "antigravity" => Some(Self::Antigravity),
            "opencode" => Some(Self::Opencode),
            "pi" => Some(Self::Pi),
            "mimo-code" => Some(Self::MimoCode),
            "droid" => Some(Self::Droid),
            "grok" => Some(Self::Grok),
            "devin" => Some(Self::Devin),
            "omp" => Some(Self::Omp),
            "prime-agent" => Some(Self::PrimeAgent),
            "copilot" => Some(Self::Copilot),
            "kimi" => Some(Self::Kimi),
            _ => None,
        }
    }

    /// Pi-family sessions resume by transcript file identity.
    pub(crate) fn resumes_by_transcript(self) -> bool {
        matches!(self, Self::Pi | Self::PrimeAgent)
    }
}

/// Provider-owned values that identify the CLI resume target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentProviderSessionMetadata {
    pub key: AgentProviderSessionKey,
    pub id: String,
    /// Authoritative on-disk transcript/rollout path reported by the agent's
    /// hook, when available.
    pub transcript_path: Option<String>,
}

/// Maximum provider session id length in UTF-16 code units, matching the
/// source's JavaScript `String.length` comparison.
const PROVIDER_SESSION_ID_MAX_LENGTH: usize = 512;

/// ECMAScript `WhiteSpace` + `LineTerminator` set trimmed by
/// `String.prototype.trim`.
fn is_js_trim_char(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | '\u{20}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// JavaScript `String.prototype.trim`: strips the ECMAScript WhiteSpace and
/// LineTerminator code points from both ends.
pub(crate) fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_trim_char)
}

/// JavaScript `String.length`: the number of UTF-16 code units.
pub(crate) fn utf16_len(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// Source `isResumableTuiAgent`: the exact agent spelling must be a member of
/// the supported set.
pub fn is_resumable_tui_agent(value: &str) -> bool {
    ResumableTuiAgent::from_agent_name(value).is_some()
}

/// Mirrors the source `hasUnsafeProviderSessionIdChars`: any C0 control
/// character or DEL. Surrogate halves never classify as unsafe in the source
/// (they are >= 0x7f), and Rust scalar values agree.
pub fn has_unsafe_provider_session_id_chars(value: &str) -> bool {
    value.chars().any(|c| u32::from(c) <= 0x1f || c == '\u{7f}')
}

/// Source `normalizeSessionId`: trim with JS semantics, then require a
/// non-empty id of at most 512 UTF-16 code units with no leading hyphen and
/// no unsafe control characters.
fn normalize_session_id(value: Option<&str>) -> Option<String> {
    let value = value?;
    let trimmed = js_trim(value);
    if trimmed.is_empty()
        || utf16_len(trimmed) > PROVIDER_SESSION_ID_MAX_LENGTH
        || trimmed.starts_with('-')
        || has_unsafe_provider_session_id_chars(trimmed)
    {
        return None;
    }
    Some(trimmed.to_string())
}

/// Source `readTranscriptPathFromKeys` for the single camelCase key used
/// during normalization: trim, require non-empty, reject unsafe characters.
fn read_transcript_path(record: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    let raw = record.get(key)?.as_str()?;
    let trimmed = js_trim(raw);
    if trimmed.is_empty() || has_unsafe_provider_session_id_chars(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Source `normalizeAgentProviderSession`: accepts an object with a supported
/// key spelling, a normalized id and an optional normalized transcript path.
/// Malformed metadata returns `None`, never a partially normalized record.
pub fn normalize_agent_provider_session(raw: &Value) -> Option<AgentProviderSessionMetadata> {
    let record = raw.as_object()?;
    let key = AgentProviderSessionKey::from_wire(record.get("key")?.as_str()?)?;
    let id = normalize_session_id(record.get("id").and_then(Value::as_str))?;
    // Persisted/relay metadata crosses a trust boundary too; apply the same
    // control-character rejection used for hook-reported transcript paths.
    let transcript_path = read_transcript_path(record, "transcriptPath");
    Some(AgentProviderSessionMetadata {
        key,
        id,
        transcript_path,
    })
}

/// Source `getAgentResumeArgv`: the provider-owned resume locator for each
/// agent, or `None` when the provider session does not name a resumable
/// target. `omp_resume_file_path` follows the source's
/// `path?.trim() || id` fallback with JS trim semantics.
pub fn get_agent_resume_argv(
    agent: ResumableTuiAgent,
    provider_session: &AgentProviderSessionMetadata,
    omp_resume_file_path: Option<&str>,
) -> Option<Vec<String>> {
    let id = provider_session.id.as_str();
    let session_id = AgentProviderSessionKey::SessionId;
    let transcript = provider_session.transcript_path.as_deref();
    match agent {
        ResumableTuiAgent::Claude => (provider_session.key == session_id)
            .then(|| vec!["claude".to_string(), "--resume".to_string(), id.to_string()]),
        ResumableTuiAgent::Codex => (provider_session.key == session_id)
            .then(|| vec!["codex".to_string(), "resume".to_string(), id.to_string()]),
        ResumableTuiAgent::Gemini => (provider_session.key == session_id)
            .then(|| vec!["gemini".to_string(), "--resume".to_string(), id.to_string()]),
        ResumableTuiAgent::Antigravity => {
            (provider_session.key == AgentProviderSessionKey::ConversationId).then(|| {
                vec![
                    "agy".to_string(),
                    "--conversation".to_string(),
                    id.to_string(),
                ]
            })
        }
        ResumableTuiAgent::Opencode => (provider_session.key == session_id).then(|| {
            vec![
                "opencode".to_string(),
                "--session".to_string(),
                id.to_string(),
            ]
        }),
        ResumableTuiAgent::Pi => {
            if provider_session.key != session_id {
                return None;
            }
            let transcript = transcript?;
            Some(vec![
                "pi".to_string(),
                "--session".to_string(),
                transcript.to_string(),
            ])
        }
        ResumableTuiAgent::PrimeAgent => {
            if provider_session.key != session_id {
                return None;
            }
            let transcript = transcript?;
            Some(vec![
                "prime-agent".to_string(),
                "--resume".to_string(),
                transcript.to_string(),
            ])
        }
        ResumableTuiAgent::MimoCode => (provider_session.key == session_id)
            .then(|| vec!["mimo".to_string(), "--session".to_string(), id.to_string()]),
        ResumableTuiAgent::Droid => (provider_session.key == session_id)
            .then(|| vec!["droid".to_string(), "--resume".to_string(), id.to_string()]),
        ResumableTuiAgent::Grok => (provider_session.key == session_id)
            .then(|| vec!["grok".to_string(), "--resume".to_string(), id.to_string()]),
        ResumableTuiAgent::Devin => (provider_session.key == session_id)
            .then(|| vec!["devin".to_string(), "--resume".to_string(), id.to_string()]),
        ResumableTuiAgent::Omp => {
            if provider_session.key != session_id {
                return None;
            }
            let trimmed = js_trim(omp_resume_file_path.unwrap_or(""));
            let target = if trimmed.is_empty() { id } else { trimmed };
            Some(vec![
                "omp".to_string(),
                "--resume".to_string(),
                target.to_string(),
            ])
        }
        // The joined form is the only one Copilot documents, matching the
        // persisted AI Vault resume commands.
        ResumableTuiAgent::Copilot => (provider_session.key == session_id)
            .then(|| vec!["copilot".to_string(), format!("--resume={id}")]),
        // Kimi resumes by id with --session; sessions are work-dir-scoped.
        ResumableTuiAgent::Kimi => (provider_session.key == session_id)
            .then(|| vec!["kimi".to_string(), "--session".to_string(), id.to_string()]),
    }
}
