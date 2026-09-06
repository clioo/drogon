//! Durable provider handle chain for an agent session — port of the pinned
//! source `src/shared/agent-session-provider-handle.ts`
//! (c97906287bb7a390b25e2025b600d9fb3c25d9c3).
//!
//! Handles are keyed per provider: Claude's session id is the identity root
//! and its leaf uuid is a branch cursor; Codex's thread id is the whole key.
//! Resumes extend the chain, forks start a new identity root, and the chain
//! records which is which so a fork is never presented as a resume.
//!
//! Length semantics are JavaScript UTF-16 code-unit counts
//! (`String.prototype.length`), and handle keys embed `JSON.stringify`
//! output, so both are reproduced exactly here rather than approximated.

use serde_json::Value;

use super::error::SessionAuthorityError;

/// Bounded so one session cannot grow an unbounded persisted record.
pub(crate) const MAX_PROVIDER_HANDLE_LINKS: usize = 256;

/// `MAX_HANDLE_FIELD_LENGTH` from the source, in JS UTF-16 code units.
pub(crate) const MAX_HANDLE_FIELD_UTF16_LENGTH: usize = 512;

/// The two structured handle providers at the pinned source boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HandleProvider {
    Claude,
    Codex,
}

impl HandleProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }
}

/// Runtime guard for persisted/remote provider metadata. Unknown values must
/// not impersonate Codex (`isAgentSessionHandleProvider`).
pub fn is_handle_provider_value(value: &Value) -> bool {
    value
        .as_str()
        .and_then(HandleProvider::from_str_opt)
        .is_some()
}

/// One provider conversation handle (discriminated union in the source).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderHandle {
    Claude {
        session_id: String,
        leaf_uuid: Option<String>,
    },
    Codex {
        thread_id: String,
    },
}

impl ProviderHandle {
    pub fn provider(&self) -> HandleProvider {
        match self {
            Self::Claude { .. } => HandleProvider::Claude,
            Self::Codex { .. } => HandleProvider::Codex,
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Self::Claude {
                session_id,
                leaf_uuid,
            } => {
                let mut object = serde_json::Map::new();
                object.insert("provider".to_string(), Value::from("claude"));
                object.insert("sessionId".to_string(), Value::from(session_id.clone()));
                object.insert(
                    "leafUuid".to_string(),
                    leaf_uuid.clone().map(Value::from).unwrap_or(Value::Null),
                );
                Value::Object(object)
            }
            Self::Codex { thread_id } => {
                let mut object = serde_json::Map::new();
                object.insert("provider".to_string(), Value::from("codex"));
                object.insert("threadId".to_string(), Value::from(thread_id.clone()));
                Value::Object(object)
            }
        }
    }

    /// `isAgentSessionProviderHandle` + conversion. A null leaf is valid; an
    /// absent or empty one is not.
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        match object.get("provider").and_then(Value::as_str) {
            Some("claude") => {
                let session_id = object
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .filter(|field| is_handle_field(field))?
                    .to_string();
                let leaf_value = object.get("leafUuid")?;
                let leaf_uuid = match leaf_value {
                    Value::Null => None,
                    Value::String(leaf) if is_handle_field(leaf) => Some(leaf.clone()),
                    _ => return None,
                };
                Some(Self::Claude {
                    session_id,
                    leaf_uuid,
                })
            }
            Some("codex") => {
                let thread_id = object
                    .get("threadId")
                    .and_then(Value::as_str)
                    .filter(|field| is_handle_field(field))?
                    .to_string();
                Some(Self::Codex { thread_id })
            }
            _ => None,
        }
    }
}

/// How a link entered the chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandleOrigin {
    Created,
    Adopted,
    Resumed,
    Forked,
}

impl HandleOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Adopted => "adopted",
            Self::Resumed => "resumed",
            Self::Forked => "forked",
        }
    }

    pub fn from_str_opt(value: &str) -> Option<Self> {
        match value {
            "created" => Some(Self::Created),
            "adopted" => Some(Self::Adopted),
            "resumed" => Some(Self::Resumed),
            "forked" => Some(Self::Forked),
            _ => None,
        }
    }
}

/// One durable link in the provider handle chain. `forked_from_key` is
/// `Some` only for forked links (the source requires `undefined`, not null,
/// for every other origin).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderHandleLink {
    pub link_id: String,
    pub handle: ProviderHandle,
    pub origin: HandleOrigin,
    /// Runtime fence in force when this link was minted; never decreases.
    pub minted_at_fence: i64,
    pub observed_at: i64,
    /// Key of the link a fork was seeded from; only set for forks.
    pub forked_from_key: Option<String>,
}

/// `LINK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/`, applied to chars (every
/// matched character is ASCII, so the JS UTF-16 count equals the char count).
fn is_link_id(value: &str) -> bool {
    let mut chars = value.chars();
    let count = value.chars().count();
    if count == 0 || count > 128 {
        return false;
    }
    chars.all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

/// JavaScript `String.prototype.length`: UTF-16 code units.
pub fn js_utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

/// `value === value.trim()` under JavaScript `String.prototype.trim`
/// semantics. Reuses the established `crate::claim_identity::js_trim` — the
/// single ECMAScript WhiteSpace + LineTerminator table shared across the
/// crate — so no duplicate trim logic lives in this module.
fn is_trimmed(value: &str) -> bool {
    crate::claim_identity::js_trim(value) == value
}

/// `isHandleField`: nonempty, at most 512 JS UTF-16 code units, no leading or
/// trailing whitespace.
pub fn is_handle_field(value: &str) -> bool {
    let length = js_utf16_len(value);
    (1..=MAX_HANDLE_FIELD_UTF16_LENGTH).contains(&length) && is_trimmed(value)
}

impl ProviderHandleLink {
    pub fn to_json(&self) -> Value {
        let mut object = serde_json::Map::new();
        object.insert("linkId".to_string(), Value::from(self.link_id.clone()));
        object.insert("handle".to_string(), self.handle.to_json());
        object.insert("origin".to_string(), Value::from(self.origin.as_str()));
        object.insert(
            "mintedAtFence".to_string(),
            Value::from(self.minted_at_fence),
        );
        object.insert("observedAt".to_string(), Value::from(self.observed_at));
        if let Some(forked_from_key) = &self.forked_from_key {
            object.insert(
                "forkedFromKey".to_string(),
                Value::from(forked_from_key.clone()),
            );
        }
        Value::Object(object)
    }

    /// `isAgentSessionProviderHandleLink` + conversion.
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let link_id = object.get("linkId").and_then(Value::as_str)?;
        if !is_link_id(link_id) {
            return None;
        }
        let handle = ProviderHandle::from_json(object.get("handle")?)?;
        let origin = HandleOrigin::from_str_opt(object.get("origin").and_then(Value::as_str)?)?;
        let minted_at_fence = object
            .get("mintedAtFence")
            .and_then(json_safe_integer)
            .filter(|fence| *fence >= 0)?;
        let observed_at = object.get("observedAt").and_then(json_safe_integer)?;
        // Forked links must name their seed; every other origin must leave the
        // key absent (a JSON null is rejected exactly like any other value).
        let forked_from_key = match (origin, object.get("forkedFromKey")) {
            (HandleOrigin::Forked, Some(Value::String(key))) if is_handle_field(key) => {
                Some(key.clone())
            }
            (HandleOrigin::Forked, _) => return None,
            (_, None) => None,
            (_, _) => return None,
        };
        Some(Self {
            link_id: link_id.to_string(),
            handle,
            origin,
            minted_at_fence,
            observed_at,
            forked_from_key,
        })
    }

    /// `isAgentSessionProviderHandleLink` for an already-typed link.
    pub fn is_valid(&self) -> bool {
        if !is_link_id(&self.link_id) {
            return false;
        }
        let handle_valid = match &self.handle {
            ProviderHandle::Claude {
                session_id,
                leaf_uuid,
            } => {
                is_handle_field(session_id)
                    && leaf_uuid.as_deref().map(is_handle_field).unwrap_or(true)
            }
            ProviderHandle::Codex { thread_id } => is_handle_field(thread_id),
        };
        if !handle_valid {
            return false;
        }
        if self.minted_at_fence < 0 || !is_safe_integer(self.minted_at_fence) {
            return false;
        }
        if !is_safe_integer(self.observed_at) {
            return false;
        }
        match self.origin {
            HandleOrigin::Forked => self
                .forked_from_key
                .as_deref()
                .map(is_handle_field)
                .unwrap_or(false),
            _ => self.forked_from_key.is_none(),
        }
    }
}

/// `Number.isSafeInteger`: integers within ±(2^53 − 1). A range
/// comparison, never `i64::abs` — `abs(i64::MIN)` overflows and panics in
/// debug builds, and raw JSON `-9223372036854775808` parses as a plain i64
/// that must be rejected, not crash the validator.
pub(crate) fn is_safe_integer(value: i64) -> bool {
    const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
    (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value)
}

/// `Number.isSafeInteger(JSON.parse(raw))` over a parsed JSON number, for
/// every spelling JavaScript accepts: `1`, `1.0`, `1e0`, and exact integer
/// boundary values within ±(2^53−1) are accepted; fractions, magnitudes above
/// the safe range, and `-9223372036854775808` are rejected — never a panic.
/// Mirrors the source exactly because JavaScript parses every JSON number
/// spelling into a double and `isSafeInteger` tests the resulting value.
/// This is the single extraction path for all persisted numeric fields in
/// the slice (handle fences/observedAt, record/lease fields, owner process
/// identity, journal/death evidence fields, typed conversion, validation,
/// and transition equality via the typed values it produces).
pub(crate) fn json_safe_integer(value: &Value) -> Option<i64> {
    const MAX_SAFE_INTEGER_F64: f64 = 9_007_199_254_740_991.0;
    let number = value.as_f64()?;
    if number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER_F64 {
        Some(number as i64)
    } else {
        None
    }
}

/// Exact `JSON.stringify` string escaping for the subset of values that can
/// appear in a handle key (any well-formed UTF-8). Short escapes match the
/// ECMAScript serializer: `\b`, `\f`, `\n`, `\r`, `\t`, `\"`, `\\`; other
/// code units below 0x20 become lowercase `\u00xx`; everything else — DEL,
/// U+2028/U+2029, non-ASCII, surrogate pairs — passes through verbatim.
pub fn js_json_quote(value: &str) -> String {
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    for character in value.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\u{8}' => quoted.push_str("\\b"),
            '\u{c}' => quoted.push_str("\\f"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            character if (character as u32) < 0x20 => {
                quoted.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => quoted.push(character),
        }
    }
    quoted.push('"');
    quoted
}

/// One element of a stringified two-element array: a quoted string or null.
fn js_json_string_or_null(value: &Option<String>) -> String {
    match value {
        Some(string) => js_json_quote(string),
        None => "null".to_string(),
    }
}

/// Stable string identity for one handle
/// (`agentSessionProviderHandleKey`). Claude keys embed the JSON array
/// `[sessionId, leafUuid]`; Codex keys embed the JSON string of the thread
/// id — so ids containing delimiters can never collide.
pub fn handle_key(handle: &ProviderHandle) -> String {
    match handle {
        ProviderHandle::Claude {
            session_id,
            leaf_uuid,
        } => format!(
            "claude:[{},{}]",
            js_json_quote(session_id),
            js_json_string_or_null(leaf_uuid)
        ),
        ProviderHandle::Codex { thread_id } => {
            format!("codex:{}", js_json_quote(thread_id))
        }
    }
}

/// Identity root: the part a resume must preserve
/// (`agentSessionProviderHandleRoot`).
pub fn handle_root(handle: &ProviderHandle) -> String {
    match handle {
        ProviderHandle::Claude { session_id, .. } => {
            format!("claude:{}", js_json_quote(session_id))
        }
        ProviderHandle::Codex { thread_id } => {
            format!("codex:{}", js_json_quote(thread_id))
        }
    }
}

/// Two handles with the same key name the same writer target.
pub fn handles_equal(left: &ProviderHandle, right: &ProviderHandle) -> bool {
    handle_key(left) == handle_key(right)
}

/// The most recently appended link, if any.
pub fn chain_head(chain: &[ProviderHandleLink]) -> Option<&ProviderHandleLink> {
    chain.last()
}

/// A lease names its exact proof by link id.
pub fn find_link<'a>(
    chain: &'a [ProviderHandleLink],
    link_id: &str,
) -> Option<&'a ProviderHandleLink> {
    chain.iter().find(|link| link.link_id == link_id)
}

/// `isAgentSessionProviderHandleChain`: at most 256 links, each individually
/// valid, and each one must actually append — a persisted chain must name
/// every link exactly once and satisfy the append invariants, so persisted
/// data cannot bypass them.
pub fn is_handle_chain_json(value: &Value) -> bool {
    let Some(array) = value.as_array() else {
        return false;
    };
    if array.len() > MAX_PROVIDER_HANDLE_LINKS {
        return false;
    }
    let mut validated: Vec<ProviderHandleLink> = Vec::new();
    for element in array {
        let Some(link) = ProviderHandleLink::from_json(element) else {
            return false;
        };
        let Ok(next) = append_link(&validated, &link) else {
            return false;
        };
        if next.len() != validated.len() + 1 {
            return false;
        }
        validated = next;
    }
    true
}

/// Append one link, rejecting anything that would let a fork masquerade as a
/// resume or let a late writer rewrite the chain under an older fence. The
/// source's check order — and therefore its error precedence — is preserved
/// exactly. Never mutates the input chain.
pub fn append_link(
    chain: &[ProviderHandleLink],
    link: &ProviderHandleLink,
) -> Result<Vec<ProviderHandleLink>, SessionAuthorityError> {
    if !link.is_valid() {
        return Err(SessionAuthorityError::ProviderHandleInvalid);
    }
    let Some(head) = chain_head(chain) else {
        if link.origin != HandleOrigin::Created && link.origin != HandleOrigin::Adopted {
            return Err(SessionAuthorityError::ProviderHandleInvalid);
        }
        return Ok(vec![link.clone()]);
    };
    if link.handle.provider() != head.handle.provider() {
        return Err(SessionAuthorityError::ProviderHandleProviderMismatch);
    }
    if link.minted_at_fence < head.minted_at_fence {
        return Err(SessionAuthorityError::ProviderHandleStaleFence);
    }
    if link.origin == HandleOrigin::Created || link.origin == HandleOrigin::Adopted {
        return Err(SessionAuthorityError::ProviderHandleInvalid);
    }
    let same_root = handle_root(&link.handle) == handle_root(&head.handle);
    if link.origin == HandleOrigin::Resumed && !same_root {
        // A resume that lands on another identity root forked; recording it
        // as a resume would claim continuity the provider never gave.
        return Err(SessionAuthorityError::ProviderHandleForked);
    }
    if link.origin == HandleOrigin::Forked {
        if same_root {
            return Err(SessionAuthorityError::ProviderHandleInvalid);
        }
        if link.forked_from_key.as_deref() != Some(handle_key(&head.handle).as_str()) {
            return Err(SessionAuthorityError::ProviderHandleInvalid);
        }
    }
    if link.origin == HandleOrigin::Resumed
        && handles_equal(&link.handle, &head.handle)
        && link.minted_at_fence == head.minted_at_fence
    {
        // Re-proving the same handle at the same fence is a retry, not a new
        // identity.
        return Ok(chain.to_vec());
    }
    if find_link(chain, &link.link_id).is_some() {
        // The lease names its exact proof by link id; reuse would make that
        // reference ambiguous.
        return Err(SessionAuthorityError::ProviderHandleInvalid);
    }
    if chain.len() >= MAX_PROVIDER_HANDLE_LINKS {
        // Dropping older links would erase fork provenance, so refuse and let
        // the caller roll the journal epoch instead of silently losing where
        // this conversation came from.
        return Err(SessionAuthorityError::ProviderHandleChainOverflow);
    }
    let mut next = chain.to_vec();
    next.push(link.clone());
    Ok(next)
}
