//! Canonical Bot conversation identity (C05, source-partial).
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
//!
//! Compatibility note (C05 follow-up): the first draft of this module
//! (PR #390) derived `format!("{bot_id}:{project_id}")`, omitting the
//! host and assuming UUID-shaped ids without delimiters while the
//! validators admit arbitrary text. That scheme was never persisted —
//! [`Conversation`] rows are unmounted, no historical migration exists —
//! and is superseded here by the versioned [`conversation_id`] encoding
//! below, which covers the full triple and round-trips arbitrary id text.
//!
//! C08 renewal-marker contract (proposal — NOT implemented here, owned by
//! `bots::storage` when the root handover lands):
//! ```sql
//! CREATE TABLE bot_conversation_markers (
//!     conversation_id TEXT PRIMARY KEY, -- per-conversation, never per-Bot
//!     boundary_seq INTEGER NOT NULL,    -- monotonically increasing
//!     boundary_date TEXT NOT NULL,      -- local YYYY-MM-DD for the seq
//!     created_at REAL NOT NULL,
//!     applied_to_session TEXT           -- nullable native ref, or NULL
//! );
//! ```
//! - Scope is per `conversation_id`: two project conversations of one Bot
//!   renew independently. A single per-Bot `applied_to_session` pointer is
//!   rejected — it cannot address two conversations at once.
//! - Admission is atomic: one transaction reads the marker row, the queue
//!   head and the active turn; the next-eligible message is admitted only
//!   when no turn is active, and the marker advance (`boundary_seq + 1`)
//!   commits in that same transaction.
//! - A marker write performs zero session/harness I/O and no inference:
//!   renewal takes effect on the next admitted message's dispatch, never
//!   mid-active-turn (switching the native link while `active_turn` is
//!   `Some` is refused).
//! - No catch-up storm: when several dates elapsed, exactly one boundary
//!   advances per admission (`boundary_seq + 1`); the writer never
//!   synthesizes N sessions or replays N days at once, and a bare marker
//!   never spawns an empty session or inference by itself.

use serde::{Deserialize, Serialize};

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
    BotMismatch {
        expected: String,
        actual: String,
    },
    ProjectMismatch {
        expected: String,
        actual: String,
    },
    HostMismatch {
        expected: String,
        actual: String,
    },
    EmptySessionId,
    EmptyIncarnation,
    EmptyHarness,
    InvalidContextVersion(u64),
    EmptyContextHash,
    ContextHashTooLong,
    EmptyRunId,
    EmptyPrompt,
    PromptTooLong,
    NoActiveTurn,
    HasActiveTurn,
    UnknownConversation(String),
    /// A conversation id that is not a `v1`-encoded triple (wrong version,
    /// wrong part count, bad percent-escape, or empty decoded parts).
    /// Never constructed from payload content beyond the offending id,
    /// which is routing metadata, not a secret.
    MalformedConversationId(String),
    /// A frozen context view that does not belong to this Bot, carries a
    /// zero version, or carries an empty hash.
    ForeignFrozenContext,
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
            Self::EmptyHarness => write!(f, "harness must be non-empty"),
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
            Self::MalformedConversationId(id) => {
                write!(f, "malformed conversation id {id}")
            }
            Self::ForeignFrozenContext => {
                write!(f, "frozen context does not belong to this conversation")
            }
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

/// Version tag of the [`conversation_id`] encoding. Bumped only when the
/// encoding itself changes; parsers refuse any other version rather than
/// guessing.
pub const CONVERSATION_ID_VERSION: &str = "v1";

/// `encodeURIComponent`-compatible percent-encoding: bytes outside
/// `A-Za-z0-9` and `-_.!~*'()` are emitted as `%XX` over the UTF-8
/// encoding, exactly like the renderer's `encodeURIComponent`, so both
/// sides agree byte-for-byte. Colons, `%` itself and every other
/// delimiter always escape — encoded parts never contain a raw `:` and
/// the triple join below stays injective for arbitrary id text.
fn pct_encode(s: &str) -> String {
    const BARE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()";
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        if BARE.contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn pct_decode(s: &str) -> Result<String, ConversationError> {
    let malformed = || ConversationError::MalformedConversationId(s.to_string());
    let bytes = s.as_bytes();
    let mut raw: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(malformed());
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|_| malformed())?;
            let byte = u8::from_str_radix(hex, 16).map_err(|_| malformed())?;
            raw.push(byte);
            i += 3;
        } else if bytes[i] == b':' {
            // A raw colon inside a part means the id was not minted by
            // [`conversation_id`]; refuse rather than mis-split.
            return Err(malformed());
        } else {
            raw.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(raw).map_err(|_| malformed())
}

/// Deterministic logical-conversation id for the full
/// `(bot_id, project_id, host_id)` triple: `v1` plus one
/// percent-encoded part per scope field. The host IS part of the id — the
/// same Bot/project on two hosts resolves to two conversations, and each
/// refuses the other's targets via [`Conversation::check_target`].
/// Injective for arbitrary id text (validators admit colons, `%` and
/// unicode): encoded parts never contain a raw `:`.
pub fn conversation_id(
    bot_id: &str,
    project_id: &str,
    host_id: &str,
) -> Result<String, ConversationError> {
    let scope = ConversationScope::new(bot_id, project_id, host_id)?;
    Ok(format!(
        "{}:{}:{}:{}",
        CONVERSATION_ID_VERSION,
        pct_encode(&scope.bot_id),
        pct_encode(&scope.project_id),
        pct_encode(&scope.host_id)
    ))
}

/// Inverse of [`conversation_id`]: splits the version tag, decodes each
/// part and re-validates the triple. Anything not minted by
/// [`conversation_id`] is [`ConversationError::MalformedConversationId`].
pub fn parse_conversation_id(id: &str) -> Result<ConversationScope, ConversationError> {
    let malformed = || ConversationError::MalformedConversationId(id.to_string());
    let mut parts = id.split(':');
    let (version, bot, project, host, extra) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    );
    if extra.is_some() {
        return Err(malformed());
    }
    let (version, bot, project, host) = match (version, bot, project, host) {
        (Some(v), Some(b), Some(p), Some(h)) => (v, b, p, h),
        _ => return Err(malformed()),
    };
    if version != CONVERSATION_ID_VERSION {
        return Err(malformed());
    }
    let scope =
        ConversationScope::new(&pct_decode(bot)?, &pct_decode(project)?, &pct_decode(host)?)
            .map_err(|_| malformed())?;
    Ok(scope)
}

/// Validates the full triple and returns the scope plus the derived id.
/// Repeated calls for the same triple return the same id; any scope field
/// difference yields a different id.
pub fn resolve_conversation(
    bot_id: &str,
    project_id: &str,
    host_id: &str,
) -> Result<(ConversationScope, String), ConversationError> {
    let scope = ConversationScope::new(bot_id, project_id, host_id)?;
    let id = conversation_id(&scope.bot_id, &scope.project_id, &scope.host_id)?;
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

/// Where the [`EffectiveRuntime`] values came from. A conversation opened
/// from a stored Bot starts as [`Self::ProposedFromPolicy`]: the Bot's
/// policy defaults, never yet executed. The owner replaces it with
/// [`Self::ActualDispatch`] via [`Conversation::record_effective_runtime`]
/// once `harness.start` runs, carrying the exact params sent — only then
/// may recovery call the values effective. Rendering a proposed runtime as
/// effective would mislabel unexecuted defaults as observed truth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectiveSource {
    ProposedFromPolicy,
    ActualDispatch,
}

/// The harness/provider/model a turn runs with. `source` tells whether the
/// values are the Bot's stored-policy proposal or the params an actual
/// dispatch sent; recovery must only trust [`EffectiveSource::ActualDispatch`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveRuntime {
    pub harness: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub source: EffectiveSource,
}

impl EffectiveRuntime {
    /// Proposed runtime from the Bot's stored policy (delegates to
    /// `bots::policy::harness_overrides` so the provider/model split has a
    /// single authority). Explicitly NOT yet dispatched: `source` is
    /// [`EffectiveSource::ProposedFromPolicy`].
    pub fn proposed(
        harness: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<Self, ConversationError> {
        let harness = js_trim(harness).to_string();
        if harness.is_empty() {
            return Err(ConversationError::EmptyHarness);
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
            source: EffectiveSource::ProposedFromPolicy,
        })
    }

    /// The runtime an actual dispatch sent: same shape, tagged
    /// [`EffectiveSource::ActualDispatch`]. The owner calls this with the
    /// exact `harness.start` params (never re-derived from stored policy
    /// at read time).
    pub fn dispatched(
        harness: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<Self, ConversationError> {
        let mut runtime = Self::proposed(harness, provider, model)?;
        runtime.source = EffectiveSource::ActualDispatch;
        Ok(runtime)
    }

    /// Single authority for the policy split: the Bot's stored defaults as
    /// a proposal, never as dispatched truth.
    pub fn proposed_from_bot(bot: &Bot) -> Self {
        let overrides = harness_overrides(bot);
        Self {
            harness: overrides.harness_id,
            provider: overrides.provider,
            model: overrides.model,
            source: EffectiveSource::ProposedFromPolicy,
        }
    }
}

/// One frozen memory contribution, mirroring C04's `FrozenMemoryRef`
/// (C04 source `bots::prompt` at ae8365b): the record id plus the exact
/// version its content was read at. Scope/project travel with the stored
/// memory rows; C05 keeps only what recovery must compare.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenMemoryView {
    pub id: String,
    pub version: u64,
}

/// The caller-supplied frozen prompt context: a projection of C04's
/// `FrozenPromptContext` (`bot_id`, `identity_version`, `frozen_at`,
/// per-memory id+version, `context_hash`). C05 never recomputes this hash
/// — it adopts the exact reference the C04 scoped composer
/// (`build_scoped_operating_prompt`) produced, whose fingerprint covers
/// the identity version plus each visible memory's id, version, scope,
/// project and content. Any locally-computed hash over bare contents
/// would silently diverge from that authority and is refused by
/// construction (there is no hash constructor here, only adoption).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenContextView {
    pub bot_id: String,
    pub identity_version: u64,
    pub frozen_at: f64,
    pub memories: Vec<FrozenMemoryView>,
    pub context_hash: String,
}

/// The context reference that produced a result: the adopted C04 frozen
/// context. A resumed conversation states honestly which identity version
/// and memory versions a result came from; later identity/memory edits
/// apply only to subsequent turns, never retroactively.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRef {
    pub identity_version: u64,
    pub frozen_at: f64,
    pub hash: String,
    pub memories: Vec<FrozenMemoryView>,
}

impl ContextRef {
    pub fn new(
        identity_version: u64,
        frozen_at: f64,
        hash: &str,
        memories: Vec<FrozenMemoryView>,
    ) -> Result<Self, ConversationError> {
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
        for memory in &memories {
            if memory.version == 0 {
                return Err(ConversationError::InvalidContextVersion(0));
            }
        }
        Ok(Self {
            identity_version,
            frozen_at,
            hash,
            memories,
        })
    }

    /// Adopts a C04 frozen context for `bot_id`: refuses zero versions,
    /// empty hashes and foreign-bot views rather than recording a context
    /// the turn was never built from.
    pub fn adopt(bot_id: &str, frozen: &FrozenContextView) -> Result<Self, ConversationError> {
        if js_trim(bot_id) != js_trim(&frozen.bot_id) || js_trim(&frozen.bot_id).is_empty() {
            return Err(ConversationError::ForeignFrozenContext);
        }
        Self::new(
            frozen.identity_version,
            frozen.frozen_at,
            &frozen.context_hash,
            frozen.memories.clone(),
        )
        .map_err(|_| ConversationError::ForeignFrozenContext)
    }
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

    /// Convenience: open directly from a stored [`Bot`] record, carrying
    /// the policy proposal as the provisional runtime (`source` is
    /// [`EffectiveSource::ProposedFromPolicy` until the owner records the
    /// actual dispatch). The Bot's own current session is NOT adopted: the
    /// conversation starts with no native link until the owner attaches
    /// the turn's real session via [`Self::attach_native`].
    pub fn open_from_bot(
        bot: &Bot,
        project_id: &str,
        host_id: &str,
        originating_run_id: &str,
        context: ContextRef,
        now: f64,
    ) -> Result<Self, ConversationError> {
        let effective = EffectiveRuntime::proposed_from_bot(bot);
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

    /// Records the runtime an actual dispatch sent, replacing the
    /// provisional proposal. The owner calls this with the exact
    /// `harness.start` params right after dispatch; recovery trusts only
    /// [`EffectiveSource::ActualDispatch`] values.
    pub fn record_effective_runtime(&mut self, effective: EffectiveRuntime, now: f64) {
        self.effective = effective;
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
/// inventing their own launcher. The runtime fields carry the stored-policy
/// proposal (source `ProposedFromPolicy`); the owner records the actual
/// dispatch via [`Conversation::record_effective_runtime`]. `context_hash`
/// plus `identity_version` plus `memories` must be the exact C04 frozen
/// context the turn was composed from — never a locally recomputed hash.
/// (Source pin for the coordinator: `conversation::OpenConversationRequest`
/// at this commit; C10 consumes `delivery::enqueue_in_tx` with the
/// resulting [`ContextReferenceDto`].)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenConversationRequest {
    pub bot_id: String,
    pub project_id: String,
    pub host_id: String,
    pub originating_run_id: String,
    pub proposed_harness: Option<String>,
    pub proposed_provider: Option<String>,
    pub proposed_model: Option<String>,
    pub identity_version: u64,
    pub frozen_at: f64,
    pub context_hash: String,
    pub memories: Vec<FrozenMemoryView>,
}

impl OpenConversationRequest {
    pub fn open(&self, now: f64) -> Result<Conversation, ConversationError> {
        let harness = self.proposed_harness.as_deref().unwrap_or("");
        if js_trim(harness).is_empty() {
            return Err(ConversationError::EmptyHarness);
        }
        let effective = EffectiveRuntime::proposed(
            harness,
            self.proposed_provider.as_deref(),
            self.proposed_model.as_deref(),
        )?;
        let context = ContextRef::new(
            self.identity_version,
            self.frozen_at,
            &self.context_hash,
            self.memories.clone(),
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
/// scope triple, originating run, runtime (with its proposed/actual
/// source), and the adopted C04 frozen context (identity version,
/// frozen-at, per-memory id+version, hash) that produced the result.
/// Consumers must not invent narrower shapes that drop any of these
/// fields — recovery needs all of them to stay truthful.
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
    pub effective_source: EffectiveSource,
    pub identity_version: u64,
    pub frozen_at: f64,
    pub context_hash: String,
    pub memories: Vec<FrozenMemoryView>,
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
            effective_source: conversation.effective.source,
            identity_version: conversation.identity_version,
            frozen_at: conversation.context.frozen_at,
            context_hash: conversation.context.hash.clone(),
            memories: conversation.context.memories.clone(),
            native_session_id: conversation.native.as_ref().map(|n| n.session_id.clone()),
            native_incarnation: conversation.native.as_ref().map(|n| n.incarnation.clone()),
        }
    }
}
