//! Canonical Bot conversation identity (C05).
//!
//! A logical Bot conversation is the stable `(bot_id, project_id, host_id)`
//! triple — never a provider-native session. A native
//! `{session_id, incarnation}` reference is an optional, replaceable link
//! that lets a view read reply bytes through the existing `session.read`
//! path; losing it never loses the conversation, and a stale incarnation
//! never proves a live process.
//!
//! This module is a pure domain state machine over the EXISTING
//! store/session transport (`bots::records::Bot`,
//! `bots::records::BotMessage`, `session.read`). It owns no database table,
//! no runner and no outbox: the storage owner persists [`Conversation`]
//! rows (or derives them from the Bot row) transactionally beside the
//! existing Bot/message rows, and C06/C08/C10/C11 consume the
//! [`OpenConversationRequest`] / [`ContextReferenceDto`] shapes below
//! instead of inventing their own launcher.
//!
//! Partial-status note: until the storage owner adopts this (transactional
//! `bot_conversations` rows or an equivalent projection), callers hold
//! [`Conversation`] in memory keyed by [`conversation_id`]. The ID
//! derivation, validation and transition rules here are already final; only
//! the durable projection is pending handover.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::policy::harness_overrides;
use super::records::Bot;
use crate::claim_identity::js_trim;

/// Code-point bound for conversation scope IDs, matching
/// `bots::input::parse_bot_id` (`1..=16_384`).
const MAX_SCOPE_ID_LEN: usize = 16_384;
/// Bound for an effective provider/model override, matching
/// `bots::input`'s explicit-model bound (512 code points).
const MAX_RUNTIME_OVERRIDE_LEN: usize = 512;
/// Bound for a context hash string (hex sha256 is 64 chars; allow margin
/// for future hash agility without accepting unbounded input).
const MAX_CONTEXT_HASH_LEN: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversationError {
    EmptyBotId,
    EmptyProjectId,
    EmptyHostId,
    IdTooLong(&'static str),
    BotMismatch { expected: String, actual: String },
    ProjectMismatch { expected: String, actual: String },
    HostMismatch { expected: String, actual: String },
    EmptySessionId,
    EmptyIncarnation,
    InvalidContextVersion(u64),
    EmptyContextHash,
    ContextHashTooLong,
    EmptyRunId,
    EmptyPrompt,
    PromptTooLong,
    NoActiveTurn,
    HasActiveTurn,
    UnknownConversation(String),
}

impl std::fmt::Display for ConversationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyBotId => write!(f, "bot id must be non-empty"),
            Self::EmptyProjectId => write!(f, "project id must be non-empty"),
            Self::EmptyHostId => write!(f, "host id must be non-empty"),
            Self::IdTooLong(which) => write!(f, "{which} id exceeds 16384 code points"),
            Self::BotMismatch { expected, actual } => write!(
                f,
                "conversation belongs to bot {expected} but target names {actual}"
            ),
            Self::ProjectMismatch { expected, actual } => write!(
                f,
                "conversation belongs to project {expected} but target names {actual}"
            ),
            Self::HostMismatch { expected, actual } => write!(
                f,
                "conversation belongs to host {expected} but target names {actual}"
            ),
            Self::EmptySessionId => write!(f, "native session id must be non-empty"),
            Self::EmptyIncarnation => write!(f, "native incarnation must be non-empty"),
            Self::InvalidContextVersion(v) => {
                write!(f, "context version {v} is invalid; versions start at 1")
            }
            Self::EmptyContextHash => write!(f, "context hash must be non-empty"),
            Self::ContextHashTooLong => write!(f, "context hash exceeds 1024 chars"),
            Self::EmptyRunId => write!(f, "originating run id must be non-empty"),
            Self::EmptyPrompt => write!(f, "prompt must be non-empty"),
            Self::PromptTooLong => write!(f, "prompt exceeds 262144 code points"),
            Self::NoActiveTurn => write!(f, "no active turn to steer"),
            Self::HasActiveTurn => write!(f, "a turn is already active"),
            Self::UnknownConversation(id) => write!(f, "unknown conversation {id}"),
        }
    }
}

impl std::error::Error for ConversationError {}

fn codepoint_len(s: &str) -> usize {
    s.chars().count()
}

fn check_scope_id(
    value: &str,
    empty: ConversationError,
    field: &'static str,
) -> Result<String, ConversationError> {
    let trimmed = js_trim(value).to_string();
    if trimmed.is_empty() {
        return Err(empty);
    }
    if codepoint_len(&trimmed) > MAX_SCOPE_ID_LEN {
        return Err(ConversationError::IdTooLong(field));
    }
    Ok(trimmed)
}

/// The canonical scope triple. `project_id` is the stable id of the
/// authoritative project record (`crate::project`), never a folder path or
/// display title — scope decisions follow project identity (C04 rule).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationScope {
    pub bot_id: String,
    pub project_id: String,
    pub host_id: String,
}

impl ConversationScope {
    pub fn new(bot_id: &str, project_id: &str, host_id: &str) -> Result<Self, ConversationError> {
        Ok(Self {
            bot_id: check_scope_id(bot_id, ConversationError::EmptyBotId, "bot")?,
            project_id: check_scope_id(project_id, ConversationError::EmptyProjectId, "project")?,
            host_id: check_scope_id(host_id, ConversationError::EmptyHostId, "host")?,
        })
    }
}

/// Deterministic logical-conversation id for `(bot_id, project_id)`.
///
/// `host_id` is NOT part of the id: one host owns the conversation record
/// (see [`ConversationScope`]); a second host never reopens the same row,
/// it resolves its own scope and is rejected on mismatch instead.
/// Bot and project ids in this tree are UUIDs without `:` so the
/// concatenation is injective in practice; if a future id charset admits
/// `:`, this must move to a length-prefixed encoding.
pub fn conversation_id(bot_id: &str, project_id: &str) -> Result<String, ConversationError> {
    let scope = ConversationScope::new(bot_id, project_id, "host-placeholder")?;
    Ok(format!("{}:{}", scope.bot_id, scope.project_id))
}

/// Same as [`conversation_id`] but validates the real host as well and
/// returns the full scope plus the derived id.
pub fn resolve_conversation(
    bot_id: &str,
    project_id: &str,
    host_id: &str,
) -> Result<(ConversationScope, String), ConversationError> {
    let scope = ConversationScope::new(bot_id, project_id, host_id)?;
    let id = format!("{}:{}", scope.bot_id, scope.project_id);
    Ok((scope, id))
}

/// A provider-native session link. Optional and replaceable: it lets a view
/// read reply bytes via `session.read`, and never replaces the Drogon
/// conversation identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRef {
    pub session_id: String,
    pub incarnation: String,
}

impl NativeRef {
    pub fn new(session_id: &str, incarnation: &str) -> Result<Self, ConversationError> {
        let session_id = js_trim(session_id).to_string();
        if session_id.is_empty() {
            return Err(ConversationError::EmptySessionId);
        }
        if codepoint_len(&session_id) > MAX_SCOPE_ID_LEN {
            return Err(ConversationError::IdTooLong("session"));
        }
        let incarnation = js_trim(incarnation).to_string();
        if incarnation.is_empty() {
            return Err(ConversationError::EmptyIncarnation);
        }
        if codepoint_len(&incarnation) > MAX_SCOPE_ID_LEN {
            return Err(ConversationError::IdTooLong("incarnation"));
        }
        Ok(Self {
            session_id,
            incarnation,
        })
    }
}

/// The effective harness/provider/model a turn actually runs with,
/// resolved once from the Bot's stored policy and persisted here so
/// recovery stays truthful even if the Bot's policy later changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveRuntime {
    pub harness: String,
    pub provider: Option<String>,
    pub model: Option<String>,
}

impl EffectiveRuntime {
    pub fn new(
        harness: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<Self, ConversationError> {
        let harness = js_trim(harness).to_string();
        if harness.is_empty() {
            return Err(ConversationError::EmptyHostId);
        }
        let clean = |v: &str| {
            let t = js_trim(v);
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        };
        let provider = provider.and_then(clean);
        let model = model.and_then(clean);
        for value in [&provider, &model].into_iter().flatten() {
            if codepoint_len(value) > MAX_RUNTIME_OVERRIDE_LEN {
                return Err(ConversationError::IdTooLong("model"));
            }
        }
        Ok(Self {
            harness,
            provider,
            model,
        })
    }

    /// Single authority for policy resolution: delegates to
    /// `bots::policy::harness_overrides` so the conversation never invents
    /// a second provider/model split.
    pub fn for_bot(bot: &Bot) -> Self {
        let overrides = harness_overrides(bot);
        Self {
            harness: overrides.harness_id,
            provider: overrides.provider,
            model: overrides.model,
        }
    }
}

/// The context version/hash that produced a result: the identity version
/// (C04, starts at 1) plus a sha256 over the canonical identity+memory
/// snapshot, so a resumed conversation can say honestly which context a
/// result came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRef {
    pub version: u64,
    pub hash: String,
    pub identity_version: u64,
}

impl ContextRef {
    pub fn new(version: u64, hash: &str, identity_version: u64) -> Result<Self, ConversationError> {
        if version == 0 {
            return Err(ConversationError::InvalidContextVersion(version));
        }
        if identity_version == 0 {
            return Err(ConversationError::InvalidContextVersion(identity_version));
        }
        let hash = js_trim(hash).to_string();
        if hash.is_empty() {
            return Err(ConversationError::EmptyContextHash);
        }
        if hash.len() > MAX_CONTEXT_HASH_LEN {
            return Err(ConversationError::ContextHashTooLong);
        }
        Ok(Self {
            version,
            hash,
            identity_version,
        })
    }
}

/// Canonical sha256 hex over `(identity_version, memory_contents)`.
/// Pure and deterministic: the same identity+memories always hash the
/// same, so recovery can compare hashes instead of trusting a version
/// counter alone.
pub fn compute_context_hash(identity_version: u64, memory_contents: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(identity_version.to_le_bytes());
    hasher.update([0u8]);
    for memory in memory_contents {
        hasher.update(memory.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

/// Honest native-session liveness. `NoSession` means the conversation holds
/// no native link at all — rendered as "no session", never as a liveness
/// claim. A stored link with no fresh observation is `Unverifiable`, never
/// `Live`: losing contact never proves exit, and absence never proves life.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeLiveness {
    Live,
    Unverifiable,
    Exited,
}

impl NativeLiveness {
    /// Maps a `session.read`/snapshot verdict string to the honest
    /// verdict. Only the exact `"live"` string is live and only `"exited"`
    /// is exited; anything else (including `""` and unknown future
    /// verdicts) is unverifiable — never synthesized as live.
    pub fn classify(verdict: &str) -> Self {
        match verdict {
            "live" => Self::Live,
            "exited" => Self::Exited,
            _ => Self::Unverifiable,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Unverifiable => "unverifiable",
            Self::Exited => "exited",
        }
    }
}

/// One queued input waiting for the active turn to finish. FIFO: insertion
/// order is display/commit order, never re-sorted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedInput {
    pub id: String,
    pub prompt: String,
    pub queued_at: f64,
}

/// The currently-running turn, if any. At most one turn is active per
/// conversation; queue/steer never create a second one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTurn {
    pub request_id: String,
    pub started_at: f64,
}

/// The canonical conversation record. Durable fields only — never raw
/// transcripts (reply bytes stay in the session ring and are read via
/// `session.read` from [`NativeRef`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub bot_id: String,
    pub project_id: String,
    pub host_id: String,
    pub effective: EffectiveRuntime,
    pub originating_run_id: String,
    pub context: ContextRef,
    pub native: Option<NativeRef>,
    pub previous_native: Option<NativeRef>,
    pub identity_version: u64,
    pub active_turn: Option<ActiveTurn>,
    pub queue: Vec<QueuedInput>,
    pub created_at: f64,
    pub updated_at: f64,
}

impl Conversation {
    /// Opens (or re-resolves) the one logical conversation for
    /// `(bot_id, project_id, host_id)`. The id is deterministic, so
    /// repeated opens for the same triple find the same conversation and
    /// different projects stay separate — the caller persists/looks up by
    /// this id.
    pub fn open(
        bot_id: &str,
        project_id: &str,
        host_id: &str,
        effective: EffectiveRuntime,
        originating_run_id: &str,
        context: ContextRef,
        now: f64,
    ) -> Result<Self, ConversationError> {
        let (scope, id) = resolve_conversation(bot_id, project_id, host_id)?;
        let originating_run_id = js_trim(originating_run_id).to_string();
        if originating_run_id.is_empty() {
            return Err(ConversationError::EmptyRunId);
        }
        Ok(Self {
            id,
            bot_id: scope.bot_id,
            project_id: scope.project_id,
            host_id: scope.host_id,
            effective,
            originating_run_id,
            identity_version: context.identity_version,
            context,
            native: None,
            previous_native: None,
            active_turn: None,
            queue: Vec::new(),
            created_at: now,
            updated_at: now,
        })
    }

    /// Convenience: open directly from a stored [`Bot`] record, resolving
    /// the effective runtime through the single policy authority and
    /// stamping the caller's context/run. The Bot's own current session is
    /// NOT adopted: the conversation starts with no native link until the
    /// owner attaches the turn's real session via [`Self::attach_native`].
    pub fn open_from_bot(
        bot: &Bot,
        project_id: &str,
        host_id: &str,
        originating_run_id: &str,
        context: ContextRef,
        now: f64,
    ) -> Result<Self, ConversationError> {
        let effective = EffectiveRuntime::for_bot(bot);
        Self::open(
            &bot.id,
            project_id,
            host_id,
            effective,
            originating_run_id,
            context,
            now,
        )
    }

    /// Rejects any target outside this conversation's own
    /// Bot/project/host triple. Wrong-scope callers get a typed mismatch,
    /// never a silent cross-conversation write.
    pub fn check_target(
        &self,
        bot_id: &str,
        project_id: &str,
        host_id: &str,
    ) -> Result<(), ConversationError> {
        if js_trim(bot_id) != self.bot_id {
            return Err(ConversationError::BotMismatch {
                expected: self.bot_id.clone(),
                actual: js_trim(bot_id).to_string(),
            });
        }
        if js_trim(project_id) != self.project_id {
            return Err(ConversationError::ProjectMismatch {
                expected: self.project_id.clone(),
                actual: js_trim(project_id).to_string(),
            });
        }
        if js_trim(host_id) != self.host_id {
            return Err(ConversationError::HostMismatch {
                expected: self.host_id.clone(),
                actual: js_trim(host_id).to_string(),
            });
        }
        Ok(())
    }

    /// Attaches the turn's native session link. Replaces nothing silently:
    /// use [`Self::rotate_native`] when a previous link exists.
    pub fn attach_native(&mut self, native: NativeRef, now: f64) {
        self.native = Some(native);
        self.updated_at = now;
    }

    /// Rotates to a new native session, retaining the previous link as the
    /// explicit previous-session relationship recovery needs. The old link
    /// is kept verbatim (never cleared) so a stale incarnation can still
    /// be classified honestly.
    pub fn rotate_native(&mut self, next: NativeRef, now: f64) {
        let prev = self.native.replace(next);
        if let Some(prev) = prev {
            self.previous_native = Some(prev);
        }
        self.updated_at = now;
    }

    pub fn record_run(&mut self, run_id: &str, now: f64) -> Result<(), ConversationError> {
        let run_id = js_trim(run_id).to_string();
        if run_id.is_empty() {
            return Err(ConversationError::EmptyRunId);
        }
        self.originating_run_id = run_id;
        self.updated_at = now;
        Ok(())
    }

    pub fn set_context(&mut self, context: ContextRef, now: f64) {
        self.identity_version = context.identity_version;
        self.context = context;
        self.updated_at = now;
    }

    /// Starts one active turn. Refused while another turn is active: the
    /// caller queues instead (see [`Self::enqueue_input`]), so active-turn
    /// ordering is never violated by overlapping runs.
    pub fn begin_turn(&mut self, request_id: &str, now: f64) -> Result<(), ConversationError> {
        if self.active_turn.is_some() {
            return Err(ConversationError::HasActiveTurn);
        }
        let request_id = js_trim(request_id).to_string();
        if request_id.is_empty() {
            return Err(ConversationError::EmptyRunId);
        }
        self.active_turn = Some(ActiveTurn {
            request_id,
            started_at: now,
        });
        self.updated_at = now;
        Ok(())
    }

    pub fn end_turn(&mut self, now: f64) {
        self.active_turn = None;
        self.updated_at = now;
    }

    fn check_prompt(prompt: &str) -> Result<String, ConversationError> {
        if js_trim(prompt).is_empty() {
            return Err(ConversationError::EmptyPrompt);
        }
        if codepoint_len(prompt) > 262_144 {
            return Err(ConversationError::PromptTooLong);
        }
        Ok(prompt.to_string())
    }

    /// Queues one input behind the active turn (or as the next turn when
    /// idle). FIFO: appended, never inserted ahead of earlier inputs, and
    /// never disturbs the active turn.
    pub fn enqueue_input(
        &mut self,
        id: &str,
        prompt: &str,
        now: f64,
    ) -> Result<(), ConversationError> {
        let id = js_trim(id).to_string();
        if id.is_empty() {
            return Err(ConversationError::EmptyRunId);
        }
        let prompt = Self::check_prompt(prompt)?;
        self.queue.push(QueuedInput {
            id,
            prompt,
            queued_at: now,
        });
        self.updated_at = now;
        Ok(())
    }

    /// Steers the currently-active turn. Requires an active turn (steering
    /// an idle conversation is a queue, not a steer) and leaves the queue
    /// order untouched.
    pub fn steer_active(&mut self, prompt: &str, now: f64) -> Result<String, ConversationError> {
        let active = self
            .active_turn
            .as_ref()
            .ok_or(ConversationError::NoActiveTurn)?;
        let prompt = Self::check_prompt(prompt)?;
        self.updated_at = now;
        Ok(format!("{}:{prompt}", active.request_id))
    }

    /// Pops the next queued input in FIFO order. Returns `None` while a
    /// turn is still active: queued inputs wait for the active turn to end,
    /// they never overtake it.
    pub fn take_next_queued(&mut self, now: f64) -> Option<QueuedInput> {
        if self.active_turn.is_some() || self.queue.is_empty() {
            return None;
        }
        self.updated_at = now;
        Some(self.queue.remove(0))
    }

    /// The honest liveness claim for the current native link given a fresh
    /// observation (or `None` when no observation was possible): `None`
    /// with no native link means "no session" (no claim at all); `None`
    /// with a link means `Unverifiable`.
    pub fn native_liveness(&self, observed_verdict: Option<&str>) -> Option<NativeLiveness> {
        self.native.as_ref()?;
        Some(match observed_verdict {
            Some(v) => NativeLiveness::classify(v),
            None => NativeLiveness::Unverifiable,
        })
    }
}

/// The small resolve/open surface C06/C08/C10/C11 consume instead of
/// inventing their own launcher. All fields are caller-supplied; the only
/// computation is the deterministic conversation id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConversationRequest {
    pub bot_id: String,
    pub project_id: String,
    pub host_id: String,
    pub originating_run_id: String,
    pub harness: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub context_version: u64,
    pub context_hash: String,
    pub identity_version: u64,
}

impl OpenConversationRequest {
    pub fn open(&self, now: f64) -> Result<Conversation, ConversationError> {
        let effective = EffectiveRuntime::new(
            self.harness.as_deref().unwrap_or(""),
            self.provider.as_deref(),
            self.model.as_deref(),
        )
        .map_err(|_| ConversationError::EmptyHostId)?;
        let context = ContextRef::new(
            self.context_version,
            &self.context_hash,
            self.identity_version,
        )?;
        Conversation::open(
            &self.bot_id,
            &self.project_id,
            &self.host_id,
            effective,
            &self.originating_run_id,
            context,
            now,
        )
    }
}

/// The exact context-reference DTO a result producer (C06/C08/C10/C11)
/// must attach when enqueueing a result for delivery: conversation id,
/// scope triple, originating run, effective runtime, and the
/// identity/context version+hash that produced the result. Consumers must
/// not invent narrower shapes that drop any of these fields — recovery
/// needs all of them to stay truthful.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextReferenceDto {
    pub conversation_id: String,
    pub bot_id: String,
    pub project_id: String,
    pub host_id: String,
    pub originating_run_id: String,
    pub effective_harness: String,
    pub effective_provider: Option<String>,
    pub effective_model: Option<String>,
    pub context_version: u64,
    pub context_hash: String,
    pub identity_version: u64,
    pub native_session_id: Option<String>,
    pub native_incarnation: Option<String>,
}

impl ContextReferenceDto {
    pub fn from_conversation(conversation: &Conversation) -> Self {
        Self {
            conversation_id: conversation.id.clone(),
            bot_id: conversation.bot_id.clone(),
            project_id: conversation.project_id.clone(),
            host_id: conversation.host_id.clone(),
            originating_run_id: conversation.originating_run_id.clone(),
            effective_harness: conversation.effective.harness.clone(),
            effective_provider: conversation.effective.provider.clone(),
            effective_model: conversation.effective.model.clone(),
            context_version: conversation.context.version,
            context_hash: conversation.context.hash.clone(),
            identity_version: conversation.identity_version,
            native_session_id: conversation.native.as_ref().map(|n| n.session_id.clone()),
            native_incarnation: conversation.native.as_ref().map(|n| n.incarnation.clone()),
        }
    }
}
