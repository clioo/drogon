//! Versioned translation contract from Drogon harness selections to
//! `mentu-recipes` recipe steps, derived from the PINNED runtime's source
//! at a recorded revision and cross-checked against the runtime's own
//! `adapters --json` evidence. No fictitious supported combinations:
//! anything the pinned runtime cannot execute is [`MentuTranslation::Blocked`]
//! with a source-cited explanation, never a label pretending support.
//!
//! Derivation evidence (C01-A, all at revision
//! [`CONTRACT_DERIVED_FROM_REVISION`] of `mentu-ai/mentu-recipes`):
//! - `Sources/MentuRecipesCore/Adapters.swift` (`AdapterRegistry.adapter`):
//!   registered backends are `shell`, `openai`/`openai-responses`/`chatgpt`,
//!   `openai-chat`, `deepseek`, `ollama`, `claude`, `codex`, `pi`; there is
//!   NO `opencode` or `antigravity` registration.
//! - `Sources/MentuRecipesCore/ShellAdapter.swift` (`ClaudeCLIAdapter`):
//!   model passthrough `--model`, `reasoning` → `--effort`, `thinking` →
//!   `--thinking` (the only adapter with `supportsThinking`).
//! - `Sources/MentuRecipesCore/CodexCLIAdapter.swift`: model passthrough
//!   `--model`; `reasoning` normalized with `max` → `xhigh`.
//! - `Sources/MentuRecipesCore/PiCLIAdapter.swift`: the adapter is only
//!   constructed with a `ProviderConfig` and `execute` throws
//!   "Pi requires an explicit provider with api pi, base_url, and exact
//!   model ID" without one — so a bare `backend: "pi"` recipe step is a
//!   FALSE POSITIVE: it passes `mentu-recipes check` AND `doctor --strict`
//!   (verified live against the locked 0.5.0 binary: score 100, no
//!   findings) yet can never execute. It also rejects
//!   reasoning/thinking overrides, requires an HTTP(S) `base_url` without
//!   embedded credentials/query/fragment, a credential via
//!   `api_key_env`/`api_key_vault`, Pi ≥ 0.84.1, Node ≥ 22.19, and tools
//!   restricted to read/bash/edit/write/grep/find/ls.
//! - `Sources/MentuRecipesCore/PiCLIAdapter.swift` (`execute`, model
//!   resolution): the executed model is `request.model ?? config.model`.
//!   Drogon sets step `model` and provider-config `model` to one
//!   effective value, so an explicit selection for model A is REFUSED
//!   rather than silently translated into a binding carrying model B;
//!   an omitted selection model resolves to the binding's exact ID.
//!   Provider identity is an explicitly OPEN decision: the adapter
//!   resolves the step `backend` name to a provider-config entry (the
//!   name is a recipe-map key, possibly an alias) and never sees a
//!   harness provider name, so `selection.provider` cannot be verified
//!   against the binding's `base_url` here — translations carry that
//!   limit as a note instead of a claim.
//! - `Sources/MentuRecipesCore/RecipeDoctor.swift`: `doctor --strict`
//!   surfaces `unknown_backend` (observed for `opencode`) and
//!   `unsupported_thinking` (observed for a thinking field on a pi-shaped
//!   backend) — schema validation alone is never treated here as execution
//!   proof.
//!
//! The authoritative runtime lock (version/revision/digest) lives in
//! `drogon-core` (`crate::mentu::runtime`); this module re-declares nothing
//! authoritative. Callers pass the locked identity in, and any mismatch
//! with the identity this table was derived from blocks translation.

use serde::Serialize;

use crate::HarnessId;
use crate::catalog::HostCatalog;
use crate::selection::{SelectionVerdict, validate_selection};

/// The runtime identity this translation table was source-derived from.
/// Kept in sync with `drogon-core`'s lock by the coordinator; tests pin it
/// against the live locked binary's `--version` output.
pub const CONTRACT_DERIVED_FROM_VERSION: &str = "0.5.0";
pub const CONTRACT_DERIVED_FROM_REVISION: &str = "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3";

/// Runtime identity supplied by the caller (C01-B wiring passes the core
/// lock's values). Translation is refused when it does not match
/// [`CONTRACT_DERIVED_FROM_VERSION`]/[`CONTRACT_DERIVED_FROM_REVISION`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MentuRuntimeIdentity {
    pub version: String,
    pub revision: String,
}

/// One adapter capability record from the runtime's own
/// `adapters --json` output. Only the fields the translation rules consume
/// are typed; unknown fields in the JSON are ignored so a runtime that adds
/// capabilities does not break parsing.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterEvidence {
    pub name: String,
    pub execution_kind: String,
    pub supports_thinking: bool,
    pub supports_reasoning: bool,
    pub supports_tool_allow_list: bool,
    pub supports_tool_deny_list: bool,
    pub supports_max_output_tokens: bool,
    pub requires_credential: bool,
    pub requires_network: bool,
}

/// Parse `mentu-recipes adapters --json` output. Returns `Err` with a
/// bounded reason when the payload is not the expected array of objects.
///
/// This is a small strict JSON reader for the runtime's flat adapter
/// objects: `serde_json` is a dev-dependency of this crate, not a runtime
/// one (the manifest is coordinator-owned), so the production parser is
/// hand-rolled and pinned by tests against the real recorded `adapters
/// --json` bytes of the locked runtime. It implements the full JSON
/// grammar (nested arrays/objects, string escapes, numbers, literals) and
/// only surfaces the accessors the contract needs.
pub fn parse_adapters_json(text: &str) -> Result<Vec<AdapterEvidence>, String> {
    let value = adapters_json::parse(text)?;
    let array = value
        .as_array()
        .ok_or_else(|| "adapters JSON is not an array".to_string())?;
    let mut adapters = Vec::new();
    for item in array {
        let get_bool = |key: &str| item.get(key).and_then(JsonValue::as_bool);
        let get_str = |key: &str| item.get(key).and_then(JsonValue::as_str);
        adapters.push(AdapterEvidence {
            name: get_str("name")
                .ok_or_else(|| "adapter entry has no string name".to_string())?
                .to_string(),
            execution_kind: get_str("execution_kind").unwrap_or_default().to_string(),
            supports_thinking: get_bool("supports_thinking").unwrap_or(false),
            supports_reasoning: get_bool("supports_reasoning").unwrap_or(false),
            supports_tool_allow_list: get_bool("supports_tool_allow_list").unwrap_or(false),
            supports_tool_deny_list: get_bool("supports_tool_deny_list").unwrap_or(false),
            supports_max_output_tokens: get_bool("supports_max_output_tokens").unwrap_or(false),
            requires_credential: get_bool("requires_credential").unwrap_or(false),
            requires_network: get_bool("requires_network").unwrap_or(false),
        });
    }
    Ok(adapters)
}

mod adapters_json {
    use super::JsonValue;

    pub fn parse(text: &str) -> Result<JsonValue, String> {
        let bytes = text.as_bytes();
        let mut cursor = Cursor { bytes, pos: 0 };
        cursor.skip_ws();
        let value = cursor.value()?;
        cursor.skip_ws();
        if cursor.pos != bytes.len() {
            return Err(format!("trailing bytes at offset {}", cursor.pos));
        }
        Ok(value)
    }

    struct Cursor<'a> {
        bytes: &'a [u8],
        pos: usize,
    }

    impl Cursor<'_> {
        fn peek(&self) -> Option<u8> {
            self.bytes.get(self.pos).copied()
        }

        fn skip_ws(&mut self) {
            while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
                self.pos += 1;
            }
        }

        fn expect(&mut self, byte: u8) -> Result<(), String> {
            if self.peek() == Some(byte) {
                self.pos += 1;
                Ok(())
            } else {
                Err(format!(
                    "expected {:?} at offset {}",
                    byte as char, self.pos
                ))
            }
        }

        fn value(&mut self) -> Result<JsonValue, String> {
            self.skip_ws();
            match self.peek() {
                Some(b'{') => self.object(),
                Some(b'[') => self.array(),
                Some(b'"') => Ok(JsonValue::Str(self.string()?)),
                Some(b't') => self.literal("true", JsonValue::Bool(true)),
                Some(b'f') => self.literal("false", JsonValue::Bool(false)),
                Some(b'n') => self.literal("null", JsonValue::Null),
                Some(_) => self.number(),
                None => Err("unexpected end of input".to_string()),
            }
        }

        fn literal(&mut self, word: &str, value: JsonValue) -> Result<JsonValue, String> {
            if self.bytes[self.pos..].starts_with(word.as_bytes()) {
                self.pos += word.len();
                Ok(value)
            } else {
                Err(format!("invalid literal at offset {}", self.pos))
            }
        }

        fn object(&mut self) -> Result<JsonValue, String> {
            self.expect(b'{')?;
            let mut map = std::collections::BTreeMap::new();
            self.skip_ws();
            if self.peek() == Some(b'}') {
                self.pos += 1;
                return Ok(JsonValue::Object(map));
            }
            loop {
                self.skip_ws();
                let key = self.string()?;
                self.skip_ws();
                self.expect(b':')?;
                let value = self.value()?;
                map.insert(key, value);
                self.skip_ws();
                match self.peek() {
                    Some(b',') => self.pos += 1,
                    Some(b'}') => {
                        self.pos += 1;
                        return Ok(JsonValue::Object(map));
                    }
                    _ => return Err(format!("expected ',' or '}}' at offset {}", self.pos)),
                }
            }
        }

        fn array(&mut self) -> Result<JsonValue, String> {
            self.expect(b'[')?;
            let mut items = Vec::new();
            self.skip_ws();
            if self.peek() == Some(b']') {
                self.pos += 1;
                return Ok(JsonValue::Array(items));
            }
            loop {
                items.push(self.value()?);
                self.skip_ws();
                match self.peek() {
                    Some(b',') => self.pos += 1,
                    Some(b']') => {
                        self.pos += 1;
                        return Ok(JsonValue::Array(items));
                    }
                    _ => return Err(format!("expected ',' or ']' at offset {}", self.pos)),
                }
            }
        }

        fn string(&mut self) -> Result<String, String> {
            self.expect(b'"')?;
            let mut out = String::new();
            loop {
                match self.peek() {
                    None => return Err("unterminated string".to_string()),
                    Some(b'"') => {
                        self.pos += 1;
                        return Ok(out);
                    }
                    Some(b'\\') => {
                        self.pos += 1;
                        match self.peek() {
                            Some(b'"') => out.push('"'),
                            Some(b'\\') => out.push('\\'),
                            Some(b'/') => out.push('/'),
                            Some(b'b') => out.push('\u{0008}'),
                            Some(b'f') => out.push('\u{000C}'),
                            Some(b'n') => out.push('\n'),
                            Some(b'r') => out.push('\r'),
                            Some(b't') => out.push('\t'),
                            Some(b'u') => {
                                let hex = self
                                    .bytes
                                    .get(self.pos + 1..self.pos + 5)
                                    .ok_or_else(|| "bad \\u escape".to_string())?;
                                let code = u32::from_str_radix(
                                    std::str::from_utf8(hex)
                                        .map_err(|_| "bad \\u escape".to_string())?,
                                    16,
                                )
                                .map_err(|_| "bad \\u escape".to_string())?;
                                self.pos += 4;
                                out.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
                            }
                            _ => return Err("bad escape".to_string()),
                        }
                        self.pos += 1;
                    }
                    Some(byte) if byte < 0x80 => {
                        out.push(byte as char);
                        self.pos += 1;
                    }
                    Some(_) => {
                        // Multi-byte UTF-8: copy the full scalar through the
                        // original text slice.
                        let start = self.pos;
                        let mut end = start + 1;
                        while matches!(self.bytes.get(end), Some(0x80..=0xBF)) {
                            end += 1;
                        }
                        out.push_str(
                            std::str::from_utf8(&self.bytes[start..end])
                                .map_err(|_| "invalid UTF-8 in string".to_string())?,
                        );
                        self.pos = end;
                    }
                }
            }
        }

        fn number(&mut self) -> Result<JsonValue, String> {
            let start = self.pos;
            while matches!(
                self.peek(),
                Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
            ) {
                self.pos += 1;
            }
            if start == self.pos {
                return Err(format!("unexpected byte at offset {start}"));
            }
            Ok(JsonValue::Number)
        }
    }
}

/// The minimal JSON value surface the adapters reader needs. `pub` so the
/// contract tests can exercise the parser directly; not part of the
/// translation API.
pub enum JsonValue {
    Object(std::collections::BTreeMap<String, JsonValue>),
    Array(Vec<JsonValue>),
    Str(String),
    Bool(bool),
    Number,
    Null,
}

impl JsonValue {
    pub fn as_array(&self) -> Option<&[JsonValue]> {
        match self {
            Self::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(value) => Some(value),
            _ => None,
        }
    }

    fn get(&self, key: &str) -> Option<&JsonValue> {
        match self {
            Self::Object(map) => map.get(key),
            _ => None,
        }
    }
}

/// The provider entry a Pi translation needs in the recipe's `providers`
/// map, shaped per `RecipeModels.swift`'s `ProviderConfig` CodingKeys.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MentuProviderConfig {
    /// `"cli"` (ProviderAPI.cli) — the only api the Pi adapter accepts.
    #[serde(rename = "api")]
    pub api: String,
    /// `"pi"` — selects `PiCLIAdapter` in `AdapterRegistry`.
    #[serde(rename = "agent")]
    pub agent: Option<String>,
    #[serde(rename = "base_url")]
    pub base_url: String,
    #[serde(rename = "model")]
    pub model: Option<String>,
    #[serde(rename = "api_key_env")]
    pub api_key_env: Option<String>,
    #[serde(rename = "api_key_vault")]
    pub api_key_vault: Option<String>,
    #[serde(rename = "context_window")]
    pub context_window: Option<u64>,
}

/// A Pi provider binding supplied by the caller, who owns credential
/// resolution (this crate never reads the user's config or vault).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderBinding {
    /// Name the binding gets in the recipe's `providers` map; the step's
    /// backend is set to this name.
    pub provider_name: String,
    /// HTTP(S) base URL without embedded credentials, query or fragment
    /// (`PiCLIAdapter.execute` guard, source-cited in module docs).
    pub base_url: String,
    /// Exact model ID the runtime drives (`request.model ?? config.model`).
    pub model: String,
    /// Credential source: exactly one of env or vault must be set
    /// (`ProviderCredentialPolicy.validateDestination` applies).
    pub api_key_env: Option<String>,
    pub api_key_vault: Option<String>,
}

impl PiProviderBinding {
    /// Source-backed shape validation. Returns the reason string when
    /// invalid; `None` when the binding is executable-shaped.
    pub fn validate(&self) -> Result<(), String> {
        if self.provider_name.trim().is_empty() {
            return Err("provider name must not be empty".to_string());
        }
        if self.model.trim().is_empty() {
            return Err("Pi requires an exact model ID".to_string());
        }
        if self.api_key_env.is_some() == self.api_key_vault.is_some() {
            return Err(
                "Pi requires exactly one credential source: api_key_env or api_key_vault"
                    .to_string(),
            );
        }
        let url = url_like_parts(&self.base_url)
            .ok_or_else(|| "Pi requires an HTTP(S) base_url".to_string())?;
        if !matches!(url.0, "http" | "https") || url.1.is_empty() {
            return Err("Pi requires an HTTP(S) base_url with a host".to_string());
        }
        if url.2 {
            // Embedded userinfo/query/fragment is refused by the adapter.
            return Err(
                "Pi requires a base_url without embedded credentials, query or fragment"
                    .to_string(),
            );
        }
        Ok(())
    }
}

/// Minimal structural check without a URL crate (none in this crate's
/// dependency budget): returns `(scheme, host, has_userinfo_query_or_fragment)`.
/// A port in the authority is allowed (the adapter guard does not refuse
/// it); embedded userinfo, `?query` or `#fragment` are refused, matching
/// the `URLComponents` validation in `PiCLIAdapter.execute`.
fn url_like_parts(raw: &str) -> Option<(&'static str, String, bool)> {
    let (scheme, rest) = raw.split_once("://")?;
    let scheme = match scheme {
        "http" => "http",
        "https" => "https",
        _ => return None,
    };
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let tail = &rest[authority_end..];
    let has_extras = authority.contains('@') || tail.contains('?') || tail.contains('#');
    let host = authority
        .rsplit('@')
        .next()
        .unwrap_or(authority)
        .to_string();
    Some((scheme, host, has_extras))
}

/// A translated recipe step plus the provider entry to merge into the
/// recipe's `providers` map (Pi only).
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuStepPlan {
    /// Recipe step `backend`. For Pi this is the binding's provider name
    /// (a registered provider-config adapter), never the bare string
    /// `"pi"` — bare pi is the documented false positive.
    pub backend: String,
    pub providers_entry: Option<(String, MentuProviderConfig)>,
    pub model: Option<String>,
    /// Claude/Codex effort mapping (`reasoning` in recipe schema).
    pub reasoning: Option<String>,
    pub thinking: Option<String>,
    /// Source-cited honesty notes for the UI (e.g. execution not proven
    /// without inference; the Claude adapter always appends its default
    /// disallowed-tools list).
    pub notes: Vec<String>,
}

/// The translation outcome. `Blocked` is the honest answer for anything the
/// pinned runtime cannot execute; the reason always cites its evidence.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MentuTranslation {
    // Boxed: MentuStepPlan is much larger than Blocked's two Strings; the
    // enum rides through RPC-adjacent paths where variant size matters.
    Translated(Box<MentuStepPlan>),
    Blocked { reason: String, evidence: String },
}

fn blocked(reason: impl Into<String>, evidence: &'static str) -> MentuTranslation {
    MentuTranslation::Blocked {
        reason: reason.into(),
        evidence: evidence.into(),
    }
}

/// Translate a harness selection into a Mentu recipe step plan for the
/// runtime named by `identity`, using the runtime's own `adapters --json`
/// evidence plus the source-derived rules tagged
/// [`CONTRACT_DERIVED_FROM_VERSION`]@[`CONTRACT_DERIVED_FROM_REVISION`].
///
/// `catalog` is used to re-derive the selection verdict; translation of a
/// selection the host catalog refutes (unknown model/provider, capability
/// mismatch, catalog unavailable) is blocked — translating fiction would
/// just move the failure into the recipe runtime. `ManualUnverified` ids
/// are carried through with a note (the runtime resolves them against its
/// own environment), but only for harnesses with a real adapter.
///
/// `pi_binding` is required for Pi translations and must be supplied by a
/// caller that owns credential resolution.
pub fn translate_selection(
    identity: &MentuRuntimeIdentity,
    adapters: &[AdapterEvidence],
    selection: &crate::selection::HarnessSelection,
    catalog: &HostCatalog,
    pi_binding: Option<&PiProviderBinding>,
) -> MentuTranslation {
    if identity.version != CONTRACT_DERIVED_FROM_VERSION
        || identity.revision != CONTRACT_DERIVED_FROM_REVISION
    {
        return blocked(
            format!(
                "this translation table was source-derived for mentu-recipes \
                 {CONTRACT_DERIVED_FROM_VERSION}@{}; the caller's runtime identity is \
                 {}@{}. Translation across runtime versions is refused rather than \
                 silently re-derived.",
                &CONTRACT_DERIVED_FROM_REVISION[..12],
                identity.version,
                &identity.revision[..identity.revision.len().min(12)]
            ),
            "module contract: version-gated translation (coordinator C01-A requirement 3)",
        );
    }
    let adapter_named = |name: &str| adapters.iter().find(|adapter| adapter.name == name);
    match selection.harness {
        HarnessId::Claude => {
            let Some(_adapter) = adapter_named("claude") else {
                return blocked(
                    "the runtime does not report a 'claude' adapter via adapters --json",
                    "Adapters.swift AdapterRegistry.adapter (registered 'claude')",
                );
            };
            let verdict = validate_selection(selection, catalog);
            match &verdict {
                SelectionVerdict::Enumerated { .. }
                | SelectionVerdict::ProviderDefault { .. }
                | SelectionVerdict::ManualUnverified { .. } => {}
                other => {
                    return blocked(
                        format!("the host catalog refutes this selection: {other:?}"),
                        "coordinator C01-A requirement: no fictitious combinations",
                    );
                }
            }
            let mut notes = Vec::new();
            if matches!(verdict, SelectionVerdict::ManualUnverified { .. }) {
                notes.push(
                    "model id is manual-unverified against this host; claude resolves \
                     aliases itself"
                        .to_string(),
                );
            }
            notes.push(
                "ClaudeCLIAdapter always appends its own default disallowed-tools list \
                 (TodoWrite/TaskCreate/TaskUpdate/TaskList/TaskGet)"
                    .to_string(),
            );
            MentuTranslation::Translated(Box::new(MentuStepPlan {
                backend: "claude".to_string(),
                providers_entry: None,
                model: selection.model.clone(),
                reasoning: selection.effort.clone(),
                thinking: None,
                notes,
            }))
        }
        HarnessId::Codex => {
            let Some(_adapter) = adapter_named("codex") else {
                return blocked(
                    "the runtime does not report a 'codex' adapter via adapters --json",
                    "Adapters.swift AdapterRegistry.adapter (registered 'codex')",
                );
            };
            let verdict = validate_selection(selection, catalog);
            match &verdict {
                SelectionVerdict::Enumerated { .. }
                | SelectionVerdict::ProviderDefault { .. }
                | SelectionVerdict::ManualUnverified { .. } => {}
                other => {
                    return blocked(
                        format!("the host catalog refutes this selection: {other:?}"),
                        "coordinator C01-A requirement: no fictitious combinations",
                    );
                }
            }
            // CodexCLIAdapter.normalizedReasoningEffort maps max -> xhigh.
            let reasoning = selection.effort.as_ref().map(|effort| {
                if effort == "max" {
                    "xhigh".to_string()
                } else {
                    effort.clone()
                }
            });
            MentuTranslation::Translated(Box::new(MentuStepPlan {
                backend: "codex".to_string(),
                providers_entry: None,
                model: selection.model.clone(),
                reasoning,
                thinking: None,
                notes: vec![
                    "effort mapped per CodexCLIAdapter.normalizedReasoningEffort (max -> \
                     xhigh)"
                        .to_string(),
                ],
            }))
        }
        HarnessId::Pi => {
            let Some(_adapter) = adapter_named("pi") else {
                return blocked(
                    "the runtime does not report a 'pi' adapter via adapters --json",
                    "Adapters.swift AdapterRegistry.adapter (registered 'pi')",
                );
            };
            let Some(binding) = pi_binding else {
                return blocked(
                    "the pi backend exists only as a provider-config adapter: a bare \
                     'backend: \"pi\"' step passes mentu-recipes check and doctor \
                     --strict (score 100, verified against the locked 0.5.0 binary) yet \
                     PiCLIAdapter.execute unconditionally throws 'Pi requires an explicit \
                     provider with api pi, base_url, and exact model ID'. Supply a \
                     PiProviderBinding (base_url + exact model + one credential source) \
                     owned by the caller's credential resolution.",
                    "PiCLIAdapter.swift execute guard + live check/doctor evidence",
                );
            };
            if let Err(reason) = binding.validate() {
                return blocked(
                    format!("PiProviderBinding is not executable-shaped: {reason}"),
                    "PiCLIAdapter.swift base_url/credential guards",
                );
            }
            if selection.effort.is_some() {
                return blocked(
                    "PiCLIAdapter rejects reasoning/thinking overrides (only thinking \
                     'off' is tolerated); a Drogon effort selection cannot ride a pi \
                     recipe step. Remove the effort or use the claude/codex backend.",
                    "PiCLIAdapter.swift execute guard on reasoning/thinking",
                );
            }
            // Effective model FIRST: the recipe executes `request.model
            // ?? config.model` with both set to one value, so an explicit
            // selection for model A is refused (never substituted) when
            // the binding carries model B, and an omitted selection model
            // resolves to the binding's exact ID.
            let effective_model = match &selection.model {
                Some(selected) if *selected != binding.model => {
                    return blocked(
                        format!(
                            "the selection names model {selected:?} but the Pi binding carries \
                             exact model ID {:?}; translating would silently substitute one for \
                             the other. Align the selection with the binding.",
                            binding.model
                        ),
                        "PiCLIAdapter.swift request.model ?? config.model mapping",
                    );
                }
                Some(selected) => selected.clone(),
                None => binding.model.clone(),
            };
            // The EFFECTIVE selection is validated against the same
            // catalog, and the verdict/notes rest on it: a binding model
            // the catalog never enumerated (or a shape-invalid one) is
            // refuted here instead of bypassing the checks through an
            // omitted selection model.
            let effective_selection = crate::selection::HarnessSelection {
                model: Some(effective_model.clone()),
                ..selection.clone()
            };
            let verdict = validate_selection(&effective_selection, catalog);
            match &verdict {
                SelectionVerdict::Enumerated { .. } | SelectionVerdict::ManualUnverified { .. } => {
                }
                other => {
                    return blocked(
                        format!("the host catalog refutes this selection: {other:?}"),
                        "coordinator C01-A requirement: no fictitious combinations",
                    );
                }
            }
            let mut notes = vec![
                "pi step executes through a provider-config adapter, not bare 'pi'".to_string(),
                "PiCLIAdapter requires Pi >= 0.84.1 and Node >= 22.19 on the execution \
                 host and restricts tools to read/bash/edit/write/grep/find/ls"
                    .to_string(),
            ];
            if matches!(verdict, SelectionVerdict::ManualUnverified { .. }) {
                notes.push("model id is manual-unverified against this host catalog".to_string());
            }
            if selection.model.is_none() {
                notes.push(
                    "model omitted in the selection; executing the binding's exact model ID, \
                     owned by the caller's credential resolution"
                        .to_string(),
                );
            }
            if selection.provider.is_some() {
                // Explicitly open provider-identity decision (module
                // docs): provider_name is a recipe-map key the runtime
                // resolves to a provider config — possibly an alias —
                // and the adapter never sees a harness provider name, so
                // the selection provider cannot be verified against the
                // binding's base_url here.
                notes.push(
                    "the selection provider is not verified against the binding: provider_name \
                     is a recipe-map key, not a harness provider attestation — the binding's \
                     base_url decides where this runs"
                        .to_string(),
                );
            }
            MentuTranslation::Translated(Box::new(MentuStepPlan {
                backend: binding.provider_name.clone(),
                providers_entry: Some((
                    binding.provider_name.clone(),
                    MentuProviderConfig {
                        api: "cli".to_string(),
                        agent: Some("pi".to_string()),
                        base_url: binding.base_url.clone(),
                        model: Some(effective_model.clone()),
                        api_key_env: binding.api_key_env.clone(),
                        api_key_vault: binding.api_key_vault.clone(),
                        context_window: None,
                    },
                )),
                model: Some(effective_model),
                reasoning: None,
                thinking: None,
                notes,
            }))
        }
        HarnessId::Opencode => blocked(
            "mentu-recipes 0.5.0 registers no opencode adapter (Adapters.swift \
             AdapterRegistry); a fixture recipe with backend 'opencode' fails doctor \
             --strict with error unknown_backend (verified against the locked binary). \
             OpenCode selections cannot be translated to this runtime.",
            "Adapters.swift AdapterRegistry.adapter + live doctor --strict evidence",
        ),
        HarnessId::Antigravity => blocked(
            "mentu-recipes 0.5.0 registers no antigravity adapter (Adapters.swift \
             AdapterRegistry). Antigravity selections cannot be translated to this \
             runtime.",
            "Adapters.swift AdapterRegistry.adapter",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_like_parts_enforces_the_adapter_guard() {
        let (scheme, host, extras) = url_like_parts("http://127.0.0.1:9/v1").unwrap();
        assert_eq!(scheme, "http");
        assert_eq!(host, "127.0.0.1:9");
        assert!(!extras);
        assert!(url_like_parts("ftp://example.com").is_none());
        assert!(url_like_parts("http://user:pw@example.com").unwrap().2);
        assert!(url_like_parts("http://example.com/v1?x=1").unwrap().2);
        assert!(url_like_parts("http://example.com/v1#frag").unwrap().2);
    }

    #[test]
    fn adapters_json_reader_parses_nested_and_escaped_values() {
        let text = r#"[{"name":"shell","supports_thinking":false,"nested":{"a":[1,2.5e3,null]},"label":"a\"b\\c"}]"#;
        let adapters = parse_adapters_json(text).unwrap();
        assert_eq!(adapters.len(), 1);
        assert_eq!(adapters[0].name, "shell");
        assert!(!adapters[0].supports_thinking);
        assert_eq!(adapters[0].execution_kind, "");
        assert!(
            parse_adapters_json("{}").is_err(),
            "object top level must be refused"
        );
        assert!(parse_adapters_json("[{\"name\": 3}]").is_err());
    }

    #[test]
    fn binding_requires_exactly_one_credential_source() {
        let mut binding = PiProviderBinding {
            provider_name: "kimi-coding".to_string(),
            base_url: "https://example.com/v1".to_string(),
            model: "kimi-for-coding".to_string(),
            api_key_env: Some("K".to_string()),
            api_key_vault: None,
        };
        assert!(binding.validate().is_ok());
        binding.api_key_vault = Some("v".to_string());
        assert!(binding.validate().is_err(), "two sources must be refused");
        binding.api_key_vault = None;
        binding.api_key_env = None;
        assert!(binding.validate().is_err(), "zero sources must be refused");
    }
}
