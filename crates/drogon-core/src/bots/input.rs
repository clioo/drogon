//! Pure native equivalents of the pinned TypeScript Bot IPC input parsers
//! (`src/main/ipc/bot-schemas.ts` at source revision
//! `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; see
//! `docs/migration/native-bot-input-contract.md` and
//! `tests/parity/ports/WP-CAP-BOTS/native-input/` for the parity evidence).
//!
//! Production input validation for the future Rust Bot service. This is
//! not Bot execution, UI completion, a desktop-owned store, model
//! availability inference, or a second (e.g. TypeScript) backend: it is
//! the same five-parser boundary, reimplemented once in Rust on top of
//! `serde`/`serde_json` only. Callers own module registration, wiring,
//! and persistence.
//!
//! ## Errors
//!
//! Every rejection is a [`BotInputError`]: a stable [`InvalidInputCategory`]
//! plus a dotted field `path` (e.g. `"displayIdentity.displayName"`, or
//! `""` for the root value). The error deliberately never echoes the
//! rejected value, an instruction, a memory, a credential, or any other
//! payload content -- only the category and the path that failed. This
//! includes an *unknown* object key: the key string is caller-controlled
//! input too and may itself carry sensitive content, so an `UnknownField`
//! error's `path` names only the enclosing object (never the offending
//! key) -- see `reject_unknown_fields` below.
//!
//! ## Discovered source behavior (parity note, not a candidate deviation)
//!
//! The pinned source's `zod` (`4.5.4`) measures every `.min()`/`.max()`
//! string-length check in **Unicode code points**
//! (`zod/v4/core/util.js::codePointLength`: UTF-16 units minus the count of
//! valid surrogate pairs), not JS's native UTF-16 `String.prototype.length`.
//! Verified directly against the actual pinned parser (see
//! `tests/parity/ports/WP-CAP-BOTS/native-input/README.md`): a string whose
//! UTF-16 length exceeds a declared bound but whose code-point length does
//! not is accepted, not rejected. This module therefore bounds string
//! lengths by `str::chars().count()` (Rust's code-point count, the same
//! quantity), matching the *actual verified* source behavior rather than
//! literal JS UTF-16 `.length` semantics.
//!
//! ## Known Bot harness IDs
//!
//! Harness-ID recognition (36 known IDs) is `drogon_harness::is_known_tui_agent`,
//! a shared, recognition-only catalog -- deliberately not
//! `drogon_harness::HarnessId` (4 launchable harnesses) and not the 14
//! resumable identities. Recognizing an ID here never authorizes or
//! proves a launch.

use crate::claim_identity::js_trim;
use drogon_harness::is_known_tui_agent;
use serde_json::{Map, Value, json};

/// Mirrors `bot-schemas.ts`'s `CharacterPreset` enum exactly (18 entries,
/// including `"none"`). Character IDs are plain identifiers at this
/// boundary; no image/asset resolution happens here.
pub const KNOWN_CHARACTER_PRESETS: &[&str] = &[
    "none",
    "arya",
    "tyrion",
    "jon-snow",
    "daenerys",
    "varys",
    "ned-stark",
    "samwell",
    "cersei",
    "jaime",
    "sansa",
    "bran",
    "brienne",
    "the-hound",
    "melisandre",
    "robb",
    "oberyn",
    "hodor",
];

const RESPONSIBILITY_KINDS: &[&str] = &["reactive", "scheduled"];
const WORKSPACE_MODES: &[&str] = &["existing", "new_per_run"];
const SETUP_DECISIONS: &[&str] = &["inherit", "run", "skip"];

/// A stable, machine-readable rejection reason. Never a full error-message
/// string (no payload content is retained), so it is safe to log or return
/// to a caller across process/service boundaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvalidInputCategory {
    /// The value (or a nested field) was not a JSON object where one was required.
    NotAnObject,
    /// The value (or a nested field) was not a JSON array where one was required.
    NotAnArray,
    /// A strict object boundary saw a key its schema does not declare.
    UnknownField,
    /// A required field was absent (not merely `null`).
    MissingField,
    /// A present value had the wrong JSON type (e.g. a number where a string was required).
    WrongType,
    /// A present value's length/magnitude fell outside its declared bound.
    OutOfRange,
    /// A present string was not one of its schema's declared enum members.
    InvalidEnumValue,
    /// A present harness string is not one of the known Bot harness IDs.
    UnsupportedHarness,
    /// A cross-field rule was violated (e.g. `scheduled` without a `schedule`).
    CrossFieldConflict,
}

/// A rejection from any parser in this module: a stable category plus the
/// dotted field path that failed. Deliberately carries no payload content.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct BotInputError {
    pub category: InvalidInputCategory,
    pub path: String,
}

impl BotInputError {
    fn new(category: InvalidInputCategory, path: impl Into<String>) -> Self {
        Self {
            category,
            path: path.into(),
        }
    }
}

impl std::fmt::Display for BotInputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let path = if self.path.is_empty() {
            "<root>"
        } else {
            self.path.as_str()
        };
        write!(f, "invalid Bot input ({:?}) at {path}", self.category)
    }
}

impl std::error::Error for BotInputError {}

type PResult<T> = Result<T, BotInputError>;

fn join(base: &str, key: &str) -> String {
    if base.is_empty() {
        key.to_string()
    } else {
        format!("{base}.{key}")
    }
}

fn missing(path: &str) -> BotInputError {
    BotInputError::new(InvalidInputCategory::MissingField, path.to_string())
}

/// The same quantity as zod's `codePointLength`: Unicode code points, not
/// UTF-16 units. See the module-level "Discovered source behavior" note.
fn codepoint_len(s: &str) -> usize {
    s.chars().count()
}

/// Preserves the exact validated finite-nonnegative `f64` as a JSON number,
/// with no cast to an integer type: `n as u64` saturates (and thus
/// silently changes the value) for any `n` at or beyond `u64::MAX`, and
/// JS has no separate integer type to justify inventing that bound in the
/// first place -- a source timestamp like `2**64 + 4096` or
/// `Number.MAX_VALUE` must round-trip unchanged. `serde_json::Number`
/// still distinguishes *how* a number was constructed (int-kind vs.
/// float-kind Number are not `==` for the same value, e.g. `1` vs `1.0`),
/// so callers compare timestamps by numeric value (see `bot_input.rs`'s
/// `json_numerically_eq`), not by this function's storage kind.
fn timestamp_to_json(n: f64) -> Value {
    Value::from(n)
}

fn as_object<'a>(value: &'a Value, path: &str) -> PResult<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| BotInputError::new(InvalidInputCategory::NotAnObject, path.to_string()))
}

fn as_array<'a>(value: &'a Value, path: &str) -> PResult<&'a Vec<Value>> {
    value
        .as_array()
        .ok_or_else(|| BotInputError::new(InvalidInputCategory::NotAnArray, path.to_string()))
}

fn as_string<'a>(value: &'a Value, path: &str) -> PResult<&'a str> {
    value
        .as_str()
        .ok_or_else(|| BotInputError::new(InvalidInputCategory::WrongType, path.to_string()))
}

fn as_bool(value: &Value, path: &str) -> PResult<bool> {
    value
        .as_bool()
        .ok_or_else(|| BotInputError::new(InvalidInputCategory::WrongType, path.to_string()))
}

fn as_f64(value: &Value, path: &str) -> PResult<f64> {
    value
        .as_f64()
        .ok_or_else(|| BotInputError::new(InvalidInputCategory::WrongType, path.to_string()))
}

fn require_null(value: &Value, path: &str) -> PResult<()> {
    if value.is_null() {
        Ok(())
    } else {
        Err(BotInputError::new(
            InvalidInputCategory::WrongType,
            path.to_string(),
        ))
    }
}

/// Rejects any object key not in `known`, at every strict boundary
/// (including nested ones). Reports only the *enclosing* object's own
/// `path` (e.g. `"displayIdentity"`, or `""` at the root) -- never the
/// unknown key itself: an unknown key is still attacker-controlled input,
/// and a key string can carry arbitrary/sensitive content that must not
/// be echoed into a diagnostic.
fn reject_unknown_fields(obj: &Map<String, Value>, known: &[&str], path: &str) -> PResult<()> {
    if obj.keys().any(|key| !known.contains(&key.as_str())) {
        return Err(BotInputError::new(
            InvalidInputCategory::UnknownField,
            path.to_string(),
        ));
    }
    Ok(())
}

/// `z.string().trim().min(min).max(max)`: trims first with the exact
/// ECMAScript `WhiteSpace`/`LineTerminator` set (`Rust::str::trim` differs:
/// it strips Unicode `White_Space` such as U+0085, and never strips
/// non-`White_Space` code points such as U+FEFF -- backwards from what JS
/// `.trim()` does), then bounds the *code-point* length of the trimmed
/// value. The returned string is the trimmed value -- the same
/// normalization zod's `.trim()` transform performs.
fn parse_id_like(value: &Value, path: &str, min: usize, max: usize) -> PResult<String> {
    let raw = as_string(value, path)?;
    let trimmed = js_trim(raw).to_string();
    let len = codepoint_len(&trimmed);
    if len < min || len > max {
        return Err(BotInputError::new(
            InvalidInputCategory::OutOfRange,
            path.to_string(),
        ));
    }
    Ok(trimmed)
}

/// `z.string().max(max)`: no trim, no minimum length.
fn parse_text(value: &Value, path: &str, max: usize) -> PResult<String> {
    let raw = as_string(value, path)?;
    if codepoint_len(raw) > max {
        return Err(BotInputError::new(
            InvalidInputCategory::OutOfRange,
            path.to_string(),
        ));
    }
    Ok(raw.to_string())
}

/// `z.string().max(max).nullable()`: a *required* field whose value is
/// either `null` or a bounded string (never absent -- `.optional()` is
/// applied separately by callers where the source chains it).
fn parse_optional_text_nullable(value: &Value, path: &str, max: usize) -> PResult<Value> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    Ok(Value::String(parse_text(value, path, max)?))
}

/// `z.number().finite().nonnegative()`.
fn parse_timestamp(value: &Value, path: &str) -> PResult<f64> {
    let n = as_f64(value, path)?;
    if !n.is_finite() || n < 0.0 {
        return Err(BotInputError::new(
            InvalidInputCategory::OutOfRange,
            path.to_string(),
        ));
    }
    Ok(n)
}

/// `z.string().refine(isTuiAgent)`.
fn parse_harness(value: &Value, path: &str) -> PResult<String> {
    let s = as_string(value, path)?;
    if !is_known_tui_agent(s) {
        return Err(BotInputError::new(
            InvalidInputCategory::UnsupportedHarness,
            path.to_string(),
        ));
    }
    Ok(s.to_string())
}

fn parse_enum<'a>(value: &Value, path: &str, allowed: &[&'a str]) -> PResult<&'a str> {
    let s = as_string(value, path)?;
    allowed
        .iter()
        .find(|candidate| **candidate == s)
        .copied()
        .ok_or_else(|| BotInputError::new(InvalidInputCategory::InvalidEnumValue, path.to_string()))
}

const DISPLAY_IDENTITY_FIELDS: &[&str] = &["displayName", "handle", "title"];

/// `DisplayIdentity`: `{ displayName, handle, title }.strict()`.
fn parse_display_identity(value: &Value, path: &str) -> PResult<Value> {
    let obj = as_object(value, path)?;
    reject_unknown_fields(obj, DISPLAY_IDENTITY_FIELDS, path)?;

    let display_name_path = join(path, "displayName");
    let display_name = obj
        .get("displayName")
        .ok_or_else(|| missing(&display_name_path))
        .and_then(|v| parse_id_like(v, &display_name_path, 1, 1024))?;

    let handle_path = join(path, "handle");
    let handle = obj
        .get("handle")
        .ok_or_else(|| missing(&handle_path))
        .and_then(|v| parse_optional_text_nullable(v, &handle_path, 16_384))?;

    let title_path = join(path, "title");
    let title = obj
        .get("title")
        .ok_or_else(|| missing(&title_path))
        .and_then(|v| parse_optional_text_nullable(v, &title_path, 16_384))?;

    Ok(json!({ "displayName": display_name, "handle": handle, "title": title }))
}

/// Bound on a stored `explicitModel`: `drogon_harness::plan_launch` refuses a
/// `--model` value longer than 512 bytes, so anything longer could be stored
/// but never launched -- reject it at this boundary instead. Measured in
/// code points like every other string bound in this module (exact for the
/// ASCII model-id charset; a non-ASCII value at the bound can still be
/// refused later by the byte-based launch check).
const MAX_EXPLICIT_MODEL_LEN: usize = 512;

const HARNESS_POLICY_FIELDS: &[&str] = &["defaultHarness", "explicitModel"];

/// `HarnessPolicy`: `{ defaultHarness: Harness, explicitModel: string | null }.strict()`.
///
/// DELIBERATE deviation from the pinned source (whose `HarnessPolicy` is
/// `explicitModel: z.null()`): the fork's own renderer sends
/// `explicitModel: model.trim() || null`, its stored contract keeps
/// `string | null`, and its launch helper consumes the string as the Pi
/// `--model` arg -- only the create boundary rejected it, stranding the
/// form's Model field. Accepting the string here (trimmed, empty-to-null,
/// code-point-bounded against the harness adapter's model length bound) is
/// what lets a Bot created for Pi carry its provider/model selection
/// through to `bot.run`. See the re-baselined
/// `bot_create/explicit_model_string_rejected` parity fixture.
fn parse_harness_policy(value: &Value, path: &str) -> PResult<Value> {
    let obj = as_object(value, path)?;
    reject_unknown_fields(obj, HARNESS_POLICY_FIELDS, path)?;

    let default_harness_path = join(path, "defaultHarness");
    let default_harness = obj
        .get("defaultHarness")
        .ok_or_else(|| missing(&default_harness_path))
        .and_then(|v| parse_harness(v, &default_harness_path))?;

    let explicit_model_path = join(path, "explicitModel");
    let explicit_model = obj
        .get("explicitModel")
        .ok_or_else(|| missing(&explicit_model_path))?;
    // Nullable model string (see the `HarnessPolicy` doc above): `null` stays
    // `null`; a string is JS-trimmed, folds empty-to-null like the fork's
    // stored normalize (`trim() || null`), and is bounded in code points by
    // the harness adapter's own model length bound.
    let explicit_model = match explicit_model {
        Value::Null => Value::Null,
        value => {
            let raw = as_string(value, &explicit_model_path)?;
            let trimmed = js_trim(raw);
            if trimmed.is_empty() {
                Value::Null
            } else {
                if codepoint_len(trimmed) > MAX_EXPLICIT_MODEL_LEN {
                    return Err(BotInputError::new(
                        InvalidInputCategory::OutOfRange,
                        explicit_model_path,
                    ));
                }
                Value::String(trimmed.to_string())
            }
        }
    };

    Ok(json!({ "defaultHarness": default_harness, "explicitModel": explicit_model }))
}

fn parse_memories(value: &Value, path: &str) -> PResult<Vec<Value>> {
    let arr = as_array(value, path)?;
    if arr.len() > 1000 {
        return Err(BotInputError::new(
            InvalidInputCategory::OutOfRange,
            path.to_string(),
        ));
    }
    arr.iter()
        .enumerate()
        .map(|(i, v)| {
            let item_path = format!("{path}[{i}]");
            parse_text(v, &item_path, 262_144).map(Value::String)
        })
        .collect()
}

const BOT_CREATE_FIELDS: &[&str] = &[
    "characterPreset",
    "displayIdentity",
    "harnessPolicy",
    "instructions",
    "memories",
    "responsibilities",
    "currentSession",
];

/// Native equivalent of `parseBotCreate` (`BotCreate.strict().parse`).
///
/// `responsibilities`, if present, must be an empty array (the source's
/// `z.array(z.never()).max(0).optional()`: any element -- of any shape --
/// fails, so only `[]` or absence is ever valid). `currentSession`, if
/// present, must be exactly `null`. Both are omitted from the returned
/// object when absent from `value`, matching zod's own omit-if-absent
/// output for optional fields.
pub fn parse_bot_create(value: &Value) -> PResult<Value> {
    let obj = as_object(value, "")?;
    reject_unknown_fields(obj, BOT_CREATE_FIELDS, "")?;

    let character_preset = obj
        .get("characterPreset")
        .ok_or_else(|| missing("characterPreset"))
        .and_then(|v| parse_enum(v, "characterPreset", KNOWN_CHARACTER_PRESETS))?;

    let display_identity = obj
        .get("displayIdentity")
        .ok_or_else(|| missing("displayIdentity"))
        .and_then(|v| parse_display_identity(v, "displayIdentity"))?;

    let harness_policy = obj
        .get("harnessPolicy")
        .ok_or_else(|| missing("harnessPolicy"))
        .and_then(|v| parse_harness_policy(v, "harnessPolicy"))?;

    let instructions = obj
        .get("instructions")
        .ok_or_else(|| missing("instructions"))
        .and_then(|v| parse_text(v, "instructions", 262_144))?;

    let memories = obj
        .get("memories")
        .ok_or_else(|| missing("memories"))
        .and_then(|v| parse_memories(v, "memories"))?;

    let mut output = Map::new();
    output.insert(
        "characterPreset".into(),
        Value::String(character_preset.to_string()),
    );
    output.insert("displayIdentity".into(), display_identity);
    output.insert("harnessPolicy".into(), harness_policy);
    output.insert("instructions".into(), Value::String(instructions));
    output.insert("memories".into(), Value::Array(memories));

    if let Some(responsibilities) = obj.get("responsibilities") {
        let arr = as_array(responsibilities, "responsibilities")?;
        if !arr.is_empty() {
            return Err(BotInputError::new(
                InvalidInputCategory::OutOfRange,
                "responsibilities".to_string(),
            ));
        }
        output.insert("responsibilities".into(), Value::Array(Vec::new()));
    }

    if let Some(current_session) = obj.get("currentSession") {
        require_null(current_session, "currentSession")?;
        output.insert("currentSession".into(), Value::Null);
    }

    Ok(Value::Object(output))
}

const BOT_UPDATE_FIELDS: &[&str] = &[
    "characterPreset",
    "displayIdentity",
    "harnessPolicy",
    "instructions",
    "memories",
];

/// Native equivalent of `parseBotUpdate` (`BotUpdate.strict().parse`).
///
/// All five fields are optional; the output includes only the keys
/// actually present in `value` (a genuine partial update). Note the
/// source's `BotUpdate` zod object does **not** declare `responsibilities`
/// or `currentSession` at all (unlike the wider `DrogonBotUpdateInput` TS
/// type) -- `.strict()` rejects either key as unknown here, and this
/// parser preserves that narrower runtime contract exactly.
pub fn parse_bot_update(value: &Value) -> PResult<Value> {
    let obj = as_object(value, "")?;
    reject_unknown_fields(obj, BOT_UPDATE_FIELDS, "")?;

    let mut output = Map::new();
    if let Some(v) = obj.get("characterPreset") {
        output.insert(
            "characterPreset".into(),
            Value::String(parse_enum(v, "characterPreset", KNOWN_CHARACTER_PRESETS)?.to_string()),
        );
    }
    if let Some(v) = obj.get("displayIdentity") {
        output.insert(
            "displayIdentity".into(),
            parse_display_identity(v, "displayIdentity")?,
        );
    }
    if let Some(v) = obj.get("harnessPolicy") {
        output.insert(
            "harnessPolicy".into(),
            parse_harness_policy(v, "harnessPolicy")?,
        );
    }
    if let Some(v) = obj.get("instructions") {
        output.insert(
            "instructions".into(),
            Value::String(parse_text(v, "instructions", 262_144)?),
        );
    }
    if let Some(v) = obj.get("memories") {
        output.insert(
            "memories".into(),
            Value::Array(parse_memories(v, "memories")?),
        );
    }
    Ok(Value::Object(output))
}

const SESSION_FIELDS: &[&str] = &["sessionId", "harness", "model", "startedAt"];

/// Native equivalent of `parseBotSession`
/// (`Session.omit({ rotatedAt: true }).parse`): the session-admission
/// boundary omits `rotatedAt` entirely from its declared shape, so a
/// payload that includes a `rotatedAt` key (even `null`) is rejected as an
/// unknown field, not silently accepted or dropped.
pub fn parse_bot_session(value: &Value) -> PResult<Value> {
    let obj = as_object(value, "")?;
    reject_unknown_fields(obj, SESSION_FIELDS, "")?;

    let session_id = obj
        .get("sessionId")
        .ok_or_else(|| missing("sessionId"))
        .and_then(|v| parse_id_like(v, "sessionId", 1, 16_384))?;

    let harness = obj
        .get("harness")
        .ok_or_else(|| missing("harness"))
        .and_then(|v| parse_harness(v, "harness"))?;

    let model = obj.get("model").ok_or_else(|| missing("model"))?;
    require_null(model, "model")?;

    let started_at = obj
        .get("startedAt")
        .ok_or_else(|| missing("startedAt"))
        .and_then(|v| parse_timestamp(v, "startedAt"))?;

    Ok(json!({
        "sessionId": session_id,
        "harness": harness,
        "model": Value::Null,
        "startedAt": timestamp_to_json(started_at),
    }))
}

const PRECHECK_FIELDS: &[&str] = &["command", "timeoutSeconds"];

/// `{ command: Text, timeoutSeconds: z.number().int().positive().max(86_400) }.strict()`.
fn parse_precheck(value: &Value, path: &str) -> PResult<Value> {
    let obj = as_object(value, path)?;
    reject_unknown_fields(obj, PRECHECK_FIELDS, path)?;

    let command_path = join(path, "command");
    let command = obj
        .get("command")
        .ok_or_else(|| missing(&command_path))
        .and_then(|v| parse_text(v, &command_path, 262_144))?;

    let timeout_path = join(path, "timeoutSeconds");
    let timeout_seconds = obj
        .get("timeoutSeconds")
        .ok_or_else(|| missing(&timeout_path))
        .and_then(|v| parse_precheck_timeout(v, &timeout_path))?;

    Ok(json!({ "command": command, "timeoutSeconds": timeout_seconds }))
}

/// `z.number().int().positive().max(86_400)`.
fn parse_precheck_timeout(value: &Value, path: &str) -> PResult<i64> {
    let n = as_f64(value, path)?;
    if !n.is_finite() || n.fract() != 0.0 {
        return Err(BotInputError::new(
            InvalidInputCategory::WrongType,
            path.to_string(),
        ));
    }
    let i = n as i64;
    if i <= 0 || i > 86_400 {
        return Err(BotInputError::new(
            InvalidInputCategory::OutOfRange,
            path.to_string(),
        ));
    }
    Ok(i)
}

const SCHEDULE_FIELDS: &[&str] = &[
    "projectId",
    "workspaceMode",
    "workspaceId",
    "baseBranch",
    "timezone",
    "rrule",
    "dtstart",
    "precheck",
    "setupDecision",
    "reuseSession",
];

/// The `schedule` object nested in `ResponsibilityCreate`.
fn parse_schedule(value: &Value, path: &str) -> PResult<Value> {
    let obj = as_object(value, path)?;
    reject_unknown_fields(obj, SCHEDULE_FIELDS, path)?;

    let project_id_path = join(path, "projectId");
    let project_id = obj
        .get("projectId")
        .ok_or_else(|| missing(&project_id_path))
        .and_then(|v| parse_id_like(v, &project_id_path, 1, 16_384))?;

    let workspace_mode_path = join(path, "workspaceMode");
    let workspace_mode = obj
        .get("workspaceMode")
        .ok_or_else(|| missing(&workspace_mode_path))
        .and_then(|v| parse_enum(v, &workspace_mode_path, WORKSPACE_MODES))?;

    let timezone_path = join(path, "timezone");
    let timezone = obj
        .get("timezone")
        .ok_or_else(|| missing(&timezone_path))
        .and_then(|v| parse_id_like(v, &timezone_path, 1, 1024))?;

    let rrule_path = join(path, "rrule");
    let rrule = obj
        .get("rrule")
        .ok_or_else(|| missing(&rrule_path))
        .and_then(|v| parse_id_like(v, &rrule_path, 1, 4_096))?;

    let dtstart_path = join(path, "dtstart");
    let dtstart = obj
        .get("dtstart")
        .ok_or_else(|| missing(&dtstart_path))
        .and_then(|v| parse_timestamp(v, &dtstart_path))?;

    let mut output = Map::new();
    output.insert("projectId".into(), Value::String(project_id));
    output.insert(
        "workspaceMode".into(),
        Value::String(workspace_mode.to_string()),
    );

    if let Some(v) = obj.get("workspaceId") {
        let workspace_id_path = join(path, "workspaceId");
        if v.is_null() {
            output.insert("workspaceId".into(), Value::Null);
        } else {
            output.insert(
                "workspaceId".into(),
                Value::String(parse_id_like(v, &workspace_id_path, 1, 16_384)?),
            );
        }
    }
    if let Some(v) = obj.get("baseBranch") {
        let base_branch_path = join(path, "baseBranch");
        output.insert(
            "baseBranch".into(),
            parse_optional_text_nullable(v, &base_branch_path, 16_384)?,
        );
    }

    output.insert("timezone".into(), Value::String(timezone));
    output.insert("rrule".into(), Value::String(rrule));
    output.insert("dtstart".into(), timestamp_to_json(dtstart));

    if let Some(v) = obj.get("precheck") {
        let precheck_path = join(path, "precheck");
        if v.is_null() {
            output.insert("precheck".into(), Value::Null);
        } else {
            output.insert("precheck".into(), parse_precheck(v, &precheck_path)?);
        }
    }
    if let Some(v) = obj.get("setupDecision") {
        let setup_decision_path = join(path, "setupDecision");
        output.insert(
            "setupDecision".into(),
            Value::String(parse_enum(v, &setup_decision_path, SETUP_DECISIONS)?.to_string()),
        );
    }
    if let Some(v) = obj.get("reuseSession") {
        let reuse_session_path = join(path, "reuseSession");
        output.insert(
            "reuseSession".into(),
            Value::Bool(as_bool(v, &reuse_session_path)?),
        );
    }

    Ok(Value::Object(output))
}

const RESPONSIBILITY_CREATE_FIELDS: &[&str] = &[
    "name",
    "instructions",
    "kind",
    "event",
    "enabled",
    "schedule",
];

/// Native equivalent of `parseResponsibilityCreate`
/// (`ResponsibilityCreate.strict().superRefine(...)`.parse`).
///
/// Cross-field trigger semantics, checked only after every present field
/// has already parsed successfully (matching zod's `superRefine`, which
/// only runs once the base object shape is valid):
/// - `kind: "scheduled"` without a `schedule` -> rejected.
/// - `kind: "reactive"` with a `schedule` present -> rejected.
/// - `kind: "scheduled"` with a JS-*truthy* `event` -> rejected. Per the
///   source's own `value.event` truthiness check, an absent, `null`, or
///   **empty-string** `event` is falsy and does not trigger this rule --
///   only a non-empty string does.
pub fn parse_responsibility_create(value: &Value) -> PResult<Value> {
    let obj = as_object(value, "")?;
    reject_unknown_fields(obj, RESPONSIBILITY_CREATE_FIELDS, "")?;

    let name = obj
        .get("name")
        .ok_or_else(|| missing("name"))
        .and_then(|v| parse_id_like(v, "name", 1, 1024))?;
    let instructions = obj
        .get("instructions")
        .ok_or_else(|| missing("instructions"))
        .and_then(|v| parse_text(v, "instructions", 262_144))?;
    let kind = obj
        .get("kind")
        .ok_or_else(|| missing("kind"))
        .and_then(|v| parse_enum(v, "kind", RESPONSIBILITY_KINDS))?;

    let mut output = Map::new();
    output.insert("name".into(), Value::String(name));
    output.insert("instructions".into(), Value::String(instructions));
    output.insert("kind".into(), Value::String(kind.to_string()));

    let mut event_is_js_truthy = false;
    if let Some(v) = obj.get("event") {
        let normalized = parse_optional_text_nullable(v, "event", 16_384)?;
        event_is_js_truthy = matches!(&normalized, Value::String(s) if !s.is_empty());
        output.insert("event".into(), normalized);
    }

    if let Some(v) = obj.get("enabled") {
        output.insert("enabled".into(), Value::Bool(as_bool(v, "enabled")?));
    }

    let schedule_present = obj.contains_key("schedule");
    if let Some(v) = obj.get("schedule") {
        output.insert("schedule".into(), parse_schedule(v, "schedule")?);
    }

    if kind == "scheduled" && !schedule_present {
        return Err(BotInputError::new(
            InvalidInputCategory::CrossFieldConflict,
            "schedule".to_string(),
        ));
    }
    if kind == "reactive" && schedule_present {
        return Err(BotInputError::new(
            InvalidInputCategory::CrossFieldConflict,
            "schedule".to_string(),
        ));
    }
    if kind == "scheduled" && event_is_js_truthy {
        return Err(BotInputError::new(
            InvalidInputCategory::CrossFieldConflict,
            "event".to_string(),
        ));
    }

    Ok(Value::Object(output))
}

/// Native equivalent of `parseBotId` (`Id.parse`): trims, then bounds the
/// code-point length to `1..=16_384`. Returns the trimmed string.
pub fn parse_bot_id(value: &Value) -> PResult<Value> {
    Ok(Value::String(parse_id_like(value, "", 1, 16_384)?))
}
