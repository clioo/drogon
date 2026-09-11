//! Native equivalents of the pinned `src/shared/drogon-bot-contract.ts`
//! (`DrogonBot` and friends) and its normalizer, at source revision
//! `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. See
//! `docs/migration/native-bot-state-contract.md` and
//! `tests/parity/ports/WP-CAP-BOTS/native-state/` for the parity evidence.
//!
//! **This normalizer is deliberately not the strict IPC parser**
//! (`crate::bots::input`): the source's own `normalizeDrogonBot` has
//! legacy-tolerant defaults (e.g. any non-empty `explicitModel` string) so
//! loading a bot record already on disk never discards it just because a
//! newer, stricter admission boundary would have rejected the same shape
//! on write. Absent/null distinctions in the persisted record are
//! preserved the same way as `crate::automations::records` documents.

use crate::automations::records::{Automation, AutomationRun};
use crate::claim_identity::js_trim;
use serde::{Deserialize, Serialize};

/// Mirrors `bot-schemas.ts`/`drogon-bot-contract.ts`'s 18-value
/// `CharacterPreset` union exactly (including `"none"`).
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

/// Source `DEFAULT_DROGON_BOT_HARNESS`.
pub const DEFAULT_DROGON_BOT_HARNESS: &str = "codex";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayIdentity {
    pub display_name: String,
    pub handle: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessModelPolicy {
    pub default_harness: String,
    pub explicit_model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotSession {
    pub session_id: String,
    pub harness: String,
    pub model: Option<String>,
    pub started_at: f64,
    pub rotated_at: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResponsibilityKind {
    Reactive,
    Scheduled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeLink {
    pub recipe_ref: String,
    pub run_id: Option<String>,
    pub evidence_path: Option<String>,
}

/// Source `DrogonBotResponsibilityTrigger` discriminated union: reactive
/// carries a nullable `event`, scheduled carries a required
/// `automationId` and no other reactive-only field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ResponsibilityTrigger {
    Reactive { event: Option<String> },
    Scheduled { automation_id: String },
}

impl ResponsibilityTrigger {
    pub fn kind(&self) -> ResponsibilityKind {
        match self {
            Self::Reactive { .. } => ResponsibilityKind::Reactive,
            Self::Scheduled { .. } => ResponsibilityKind::Scheduled,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Responsibility {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub kind: ResponsibilityKind,
    pub trigger: ResponsibilityTrigger,
    pub enabled: bool,
    pub recipe: Option<RecipeLink>,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub id: String,
    pub character_preset: String,
    pub display_identity: DisplayIdentity,
    pub harness_policy: HarnessModelPolicy,
    pub instructions: String,
    pub memories: Vec<String>,
    pub responsibilities: Vec<Responsibility>,
    pub current_session: Option<BotSession>,
    pub created_at: f64,
    pub updated_at: f64,
}

/// How a [`ResponsibilityRun`] was invoked: a daemon scheduler fire of the
/// responsibility's owned automation, an explicit `bot.run` call (the Run
/// control, a `scheduledDue`/`reactiveEvent` reason included -- an
/// explicit invocation, never a schedule fire), or a monitor event the
/// delegation drain released (a watch fired and the bound responsibility
/// ran — never a human click). Display-only evidence for the history's
/// trigger label; never an automation status or a dispatch authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResponsibilityRunInvocation {
    Scheduled,
    Manual,
    Reactive,
}

/// Source `DrogonBotResponsibilityRun`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponsibilityRun {
    pub id: String,
    pub bot_id: String,
    pub responsibility_id: String,
    pub automation_id: Option<String>,
    pub automation_run_id: Option<String>,
    pub started_at: f64,
    pub ended_at: Option<f64>,
    pub recipe: Option<RecipeLink>,
    pub host_observation: Option<HostObservation>,
    /// `None` for rows written before this field existed. Every such row
    /// was recorded through `bot.run` (the scheduler's direct path never
    /// wrote responsibility runs), so readers treat `None` as manual.
    #[serde(default)]
    pub invocation: Option<ResponsibilityRunInvocation>,
}

/// `live` / `unverifiable` / `exited`: evidence only, never an automation
/// status or a Mentu completion verdict (contract doc, repeated from the
/// claim-identity/session liveness convention elsewhere in this crate).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostObservation {
    Live,
    Exited,
    Unverifiable,
}

/// Source `botResponsibilityHistory` entry: a joined view for display.
/// Orphaned links (a deleted responsibility/automation/automation-run)
/// become `None`, never a synthesized placeholder.
#[derive(Debug, Clone, PartialEq)]
pub struct HistoryEntry {
    pub responsibility_run: ResponsibilityRun,
    pub responsibility: Option<Responsibility>,
    pub automation: Option<Automation>,
    pub automation_run: Option<AutomationRun>,
}

/// A single chat turn: one `bot.run` call carrying a `prompt` instead of a
/// `responsibilityId`. Not a responsibility run (no `Automation` is ever
/// involved) -- stored separately in `bot_messages` (see
/// `bots::storage::record_bot_message_in_tx`). `session_id`/`incarnation`
/// let a conversation view read the actual reply bytes via the existing
/// `session.read` path; this record never carries the reply text itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotMessage {
    pub id: String,
    pub bot_id: String,
    /// The `bot.run` envelope request id that produced this turn -- the
    /// link back to "the run" the contract asks for.
    pub request_id: String,
    pub prompt: String,
    pub session_id: Option<String>,
    pub incarnation: Option<String>,
    /// `None` only when `harness.start` itself failed (no session was ever
    /// admitted); see `host_observation`'s doc above for the 3-state rule.
    pub host_observation: Option<HostObservation>,
    pub error: Option<String>,
    pub started_at: f64,
    pub ended_at: Option<f64>,
}

/// Source `normalizeDrogonBotRecipeLink`: requires a non-empty (after
/// ECMAScript trim) `recipeRef`; `runId`/`evidencePath` default to `None`
/// unless they are non-empty strings. Returns `None` for a non-object
/// value or an empty/whitespace-only `recipeRef`, exactly like the source
/// returning `null`.
pub fn normalize_recipe_link(value: &serde_json::Value) -> Option<RecipeLink> {
    let obj = value.as_object()?;
    let recipe_ref = obj.get("recipeRef").and_then(|v| v.as_str())?;
    let recipe_ref = js_trim(recipe_ref);
    if recipe_ref.is_empty() {
        return None;
    }
    let non_empty_string = |key: &str| -> Option<String> {
        obj.get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Some(RecipeLink {
        recipe_ref: recipe_ref.to_string(),
        run_id: non_empty_string("runId"),
        evidence_path: non_empty_string("evidencePath"),
    })
}

fn is_known_character_preset(value: &str) -> bool {
    KNOWN_CHARACTER_PRESETS.contains(&value)
}

/// Source `normalizeResponsibility(value, now)`. Returns `None` (drop) if
/// `id`/`name`/`kind` are missing/invalid, or if `trigger.kind` disagrees
/// with the declared `kind`, or if a scheduled trigger's `automationId` is
/// not a string -- malformed persisted responsibility evidence is
/// dropped, never trusted partially (contract doc + source test title
/// "rejects malformed persisted responsibility evidence instead of
/// trusting partial rows").
pub fn normalize_responsibility(value: &serde_json::Value, now: f64) -> Option<Responsibility> {
    let obj = value.as_object()?;
    let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return None;
    }
    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .map(js_trim)
        .unwrap_or("");
    if name.is_empty() {
        return None;
    }
    let kind = match obj.get("kind").and_then(|v| v.as_str()) {
        Some("scheduled") => ResponsibilityKind::Scheduled,
        Some("reactive") => ResponsibilityKind::Reactive,
        _ => return None,
    };
    let trigger_obj = obj.get("trigger").and_then(|v| v.as_object());
    let trigger_kind_matches = trigger_obj
        .and_then(|t| t.get("kind"))
        .and_then(|v| v.as_str())
        == Some(match kind {
            ResponsibilityKind::Scheduled => "scheduled",
            ResponsibilityKind::Reactive => "reactive",
        });
    let trigger = match kind {
        ResponsibilityKind::Scheduled => {
            let automation_id = trigger_obj
                .and_then(|t| t.get("automationId"))
                .and_then(|v| v.as_str());
            if !trigger_kind_matches {
                return None;
            }
            let automation_id = automation_id?;
            ResponsibilityTrigger::Scheduled {
                automation_id: automation_id.to_string(),
            }
        }
        ResponsibilityKind::Reactive => {
            if !trigger_kind_matches {
                return None;
            }
            let event = trigger_obj
                .and_then(|t| t.get("event"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            ResponsibilityTrigger::Reactive { event }
        }
    };
    let instructions = obj
        .get("instructions")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let enabled = obj.get("enabled").and_then(|v| v.as_bool()) != Some(false);
    let recipe = obj.get("recipe").and_then(normalize_recipe_link);
    let created_at = obj.get("createdAt").and_then(|v| v.as_f64()).unwrap_or(now);
    let updated_at = obj.get("updatedAt").and_then(|v| v.as_f64()).unwrap_or(now);
    Some(Responsibility {
        id: id.to_string(),
        name: name.to_string(),
        instructions,
        kind,
        trigger,
        enabled,
        recipe,
        created_at,
        updated_at,
    })
}

/// Source `normalizeDrogonBot(value)`. `now` stands in for `Date.now()`:
/// production callers pass a real current timestamp; tests may inject a
/// deterministic one without changing this function's behavior. Returns
/// `None` for a non-object value, a missing/empty `id`, or a missing/
/// empty (post-trim) `displayIdentity.displayName` -- exactly the
/// source's `null` return.
pub fn normalize_bot(
    value: &serde_json::Value,
    is_known_harness: impl Fn(&str) -> bool,
    now: f64,
) -> Option<Bot> {
    let obj = value.as_object()?;
    let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return None;
    }
    let identity = obj.get("displayIdentity").and_then(|v| v.as_object());
    let display_name = identity
        .and_then(|i| i.get("displayName"))
        .and_then(|v| v.as_str())
        .map(js_trim)
        .unwrap_or("");
    if display_name.is_empty() {
        return None;
    }

    let policy = obj.get("harnessPolicy").and_then(|v| v.as_object());
    let default_harness = policy
        .and_then(|p| p.get("defaultHarness"))
        .and_then(|v| v.as_str())
        .filter(|h| is_known_harness(h))
        .unwrap_or(DEFAULT_DROGON_BOT_HARNESS)
        .to_string();
    let explicit_model = policy
        .and_then(|p| p.get("explicitModel"))
        .and_then(|v| v.as_str())
        .map(js_trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let handle = identity
        .and_then(|i| i.get("handle"))
        .and_then(|v| v.as_str())
        .map(|h| js_trim(h).trim_start_matches('@').to_string())
        .filter(|s| !s.is_empty());
    let title = identity
        .and_then(|i| i.get("title"))
        .and_then(|v| v.as_str())
        .map(js_trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let character_preset = obj
        .get("characterPreset")
        .and_then(|v| v.as_str())
        .filter(|p| is_known_character_preset(p))
        .unwrap_or("none")
        .to_string();

    let responsibilities = obj
        .get("responsibilities")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|r| normalize_responsibility(r, now))
                .collect()
        })
        .unwrap_or_default();

    let current_session = obj
        .get("currentSession")
        .and_then(|v| v.as_object())
        .and_then(|s| {
            let session_id = s.get("sessionId").and_then(|v| v.as_str())?.to_string();
            let harness = s.get("harness").and_then(|v| v.as_str())?;
            if !is_known_harness(harness) {
                return None;
            }
            Some(BotSession {
                session_id,
                harness: harness.to_string(),
                model: s.get("model").and_then(|v| v.as_str()).map(str::to_string),
                started_at: s.get("startedAt").and_then(|v| v.as_f64()).unwrap_or(now),
                rotated_at: s.get("rotatedAt").and_then(|v| v.as_f64()),
            })
        });

    let instructions = obj
        .get("instructions")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let memories = obj
        .get("memories")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Some(Bot {
        id: id.to_string(),
        character_preset,
        display_identity: DisplayIdentity {
            display_name: display_name.to_string(),
            handle,
            title,
        },
        harness_policy: HarnessModelPolicy {
            default_harness,
            explicit_model,
        },
        instructions,
        memories,
        responsibilities,
        current_session,
        created_at: obj.get("createdAt").and_then(|v| v.as_f64()).unwrap_or(now),
        updated_at: obj.get("updatedAt").and_then(|v| v.as_f64()).unwrap_or(now),
    })
}

/// Source `linkDrogonBotMentuRun(result, evidencePath)`: links only a
/// real Mentu run record (`"run" in result`); an unavailable/absent
/// result leaves evidence unlinked (`None`), never a synthesized link.
pub fn link_mentu_run(
    result: &serde_json::Value,
    evidence_path: Option<String>,
) -> Option<RecipeLink> {
    let run = result.as_object()?.get("run")?.as_object()?;
    let value = run.get("value")?.as_object()?;
    let recipe_ref = value
        .get("recipe_ref")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("recipe_name").and_then(|v| v.as_str()))?
        .to_string();
    let run_id = value
        .get("run_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Some(RecipeLink {
        recipe_ref,
        run_id,
        evidence_path,
    })
}
