/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
src/shared/drogon-bot-prompt.ts (`buildDrogonBotOperatingPrompt` and its
`CHARACTER_GUIDANCE` map). Adapter: only the identity/style/instructions/
memories sections and the chat-turn framing are needed for a bot.run chat
turn (no responsibility-coordination section, since a chat turn has no
`Automation`/`Responsibility` behind it); the closing accountability line
is kept verbatim. */

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::memory::{self, BotMemory, MemoryScope};
use super::records::Bot;

/// Source `CHARACTER_GUIDANCE`: one working-style sentence per preset,
/// keyed by the same slug as [`super::records::KNOWN_CHARACTER_PRESETS`]
/// (minus `"none"`, which carries no guidance).
fn character_guidance(preset: &str) -> Option<&'static str> {
    match preset {
        "arya" => Some("Focused, terse, autonomous, and execution-oriented."),
        "tyrion" => Some("Strategic, incisive, pragmatic, and clear about tradeoffs."),
        "jon-snow" => Some("Direct, steady, duty-minded, and willing to escalate uncertainty."),
        "daenerys" => Some("Decisive, ambitious, protective of the mission, and outcome-oriented."),
        "varys" => {
            Some("Observant, discreet, evidence-driven, and attentive to hidden dependencies.")
        }
        "ned-stark" => Some("Principled, candid, reliable, and explicit about commitments."),
        "samwell" => Some("Curious, methodical, well-read, and generous with useful context."),
        "cersei" => {
            Some("Politically astute, protective of her position, and decisive under pressure.")
        }
        "jaime" => {
            Some("Courageous, direct, adaptive, and willing to question inherited assumptions.")
        }
        "sansa" => {
            Some("Composed, observant, patient, and skilled at navigating complex stakeholders.")
        }
        "bran" => Some("Quiet, reflective, pattern-oriented, and attentive to long-range context."),
        "brienne" => Some("Honorable, persistent, precise, and committed to following through."),
        "the-hound" => {
            Some("Blunt, skeptical, practical, and protective of the people in his care.")
        }
        "melisandre" => {
            Some("Intense, visionary, purposeful, and focused on the signal beneath the noise.")
        }
        "robb" => Some("Decisive, loyal, strategic, and accountable for the people he leads."),
        "oberyn" => Some("Perceptive, bold, incisive, and energized by difficult questions."),
        "hodor" => {
            Some("Steady, gentle, dependable, and focused on helping the team move forward.")
        }
        _ => None,
    }
}

fn identity_lines(bot: &Bot) -> String {
    let mut lines = vec![format!(
        "Persistent Drogon Bot identity\nName: {}",
        bot.display_identity.display_name
    )];
    if let Some(title) = &bot.display_identity.title {
        lines.push(format!("Role: {title}"));
    }
    if let Some(handle) = &bot.display_identity.handle {
        lines.push(format!("Handle: @{handle}"));
    }
    lines.join("\n")
}

/// Source `buildDrogonBotOperatingPrompt(bot, responsibility?)`, minus the
/// `responsibility` parameter (a chat turn has none) but with an equivalent
/// closing "Chat message" section carrying the caller's actual text.
pub fn build_operating_prompt(bot: &Bot, message: &str) -> String {
    let mut sections = vec![identity_lines(bot)];
    if let Some(guidance) = character_guidance(&bot.character_preset) {
        sections.push(format!("Suggested working style\n{guidance}"));
    }
    let instructions = bot.instructions.trim();
    sections.push(format!(
        "Standing instructions\n{}",
        if instructions.is_empty() {
            "No standing instructions recorded."
        } else {
            instructions
        }
    ));
    let memories: Vec<&str> = bot
        .memories
        .iter()
        .map(String::as_str)
        .filter(|m| !m.trim().is_empty())
        .collect();
    if !memories.is_empty() {
        let bullets = memories
            .iter()
            .map(|m| format!("- {m}"))
            .collect::<Vec<_>>()
            .join("\n");
        sections.push(format!("Durable memories\n{bullets}"));
    }
    sections.push(format!("Chat message\n{message}"));
    sections.push(
        "Keep the persistent identity separate from this harness session. Report only \
         evidence you actually observe."
            .to_string(),
    );
    sections.join("\n\n")
}

/// One frozen memory contribution to a turn's context: the record's id,
/// the exact version its content was read at, and its explicit scope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenMemoryRef {
    pub id: String,
    pub version: u64,
    pub scope: MemoryScope,
    pub project_id: Option<String>,
}

/// The per-turn frozen memory context (C04): captured at composition time
/// and persisted by the turn so a later memory/identity edit can never
/// rewrite what an active turn was built from. `identity_version` is the
/// bot identity version the caller read for this turn; `context_hash` is
/// the SHA-256 of the canonical fingerprint of exactly the scoped memory
/// entries (ids, versions, scopes, contents) that entered the prompt.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrozenPromptContext {
    pub bot_id: String,
    pub identity_version: u64,
    pub frozen_at: f64,
    pub memories: Vec<FrozenMemoryRef>,
    pub context_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopedPromptError {
    /// A memory record failed its shape check. Incompatible data refuses
    /// the composition safely -- it is never silently dropped from the
    /// turn's context.
    InvalidMemoryRecord(String),
    /// Identity version 0 is never valid (see `bots::identity`).
    InvalidIdentityVersion(u64),
}

impl std::fmt::Display for ScopedPromptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidMemoryRecord(detail) => {
                write!(f, "invalid memory record in prompt context: {detail}")
            }
            Self::InvalidIdentityVersion(version) => {
                write!(f, "identity version {version} is not a valid version")
            }
        }
    }
}

impl std::error::Error for ScopedPromptError {}

#[derive(Serialize)]
struct ContextFingerprint<'a> {
    identity_version: u64,
    memories: Vec<FingerprintMemory<'a>>,
}

#[derive(Serialize)]
struct FingerprintMemory<'a> {
    id: &'a str,
    version: u64,
    scope: MemoryScope,
    project_id: &'a Option<String>,
    content: &'a str,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// C04 scoped composition entrypoint: the operating prompt for a chat
/// turn whose memories are versioned [`BotMemory`] records, restricted to
/// `project_id`'s visible set (`bots::memory::visible_memories`: global
/// plus exactly that project).
///
/// This is NOT a second composer: every section (identity, style,
/// instructions, memory bullets, chat framing) is still rendered by the
/// existing [`build_operating_prompt`], fed a bot view whose `memories`
/// field carries exactly the visible records' contents -- so a scoped
/// turn is byte-identical in shape to the legacy composition, with the
/// memory inputs chosen by scope instead of taken wholesale. Each input
/// record is shape-checked first ([`BotMemory::validate`]); a malformed
/// record refuses the whole composition rather than quietly vanishing
/// from the context.
///
/// Returns the prompt plus the [`FrozenPromptContext`] to persist on the
/// turn, freezing identity version, per-memory versions and the context
/// hash so later edits apply only to subsequent turns. The hash pins the
/// EXACT selected contents (ids, versions, scopes, contents): persisting
/// the context JSON beside the turn is what makes the freeze auditable
/// after restarts, since memory rows themselves keep moving.
pub fn build_scoped_operating_prompt(
    bot: &Bot,
    message: &str,
    memories: &[BotMemory],
    project_id: Option<&str>,
    identity_version: u64,
    frozen_at: f64,
) -> Result<(String, FrozenPromptContext), ScopedPromptError> {
    if identity_version == 0 {
        return Err(ScopedPromptError::InvalidIdentityVersion(identity_version));
    }
    for record in memories {
        record
            .validate()
            .map_err(|e| ScopedPromptError::InvalidMemoryRecord(e.to_string()))?;
    }
    let visible = memory::visible_memories(memories, project_id);
    let mut scoped_bot = bot.clone();
    scoped_bot.memories = visible.iter().map(|m| m.content.clone()).collect();
    let prompt = build_operating_prompt(&scoped_bot, message);
    let fingerprint = ContextFingerprint {
        identity_version,
        memories: visible
            .iter()
            .map(|m| FingerprintMemory {
                id: m.id.as_str(),
                version: m.version,
                scope: m.scope,
                project_id: &m.project_id,
                content: m.content.as_str(),
            })
            .collect(),
    };
    let context_hash = sha256_hex(
        &serde_json::to_vec(&fingerprint)
            .map_err(|e| ScopedPromptError::InvalidMemoryRecord(e.to_string()))?,
    );
    Ok((
        prompt,
        FrozenPromptContext {
            bot_id: bot.id.clone(),
            identity_version,
            frozen_at,
            memories: visible
                .iter()
                .map(|m| FrozenMemoryRef {
                    id: m.id.clone(),
                    version: m.version,
                    scope: m.scope,
                    project_id: m.project_id.clone(),
                })
                .collect(),
            context_hash,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bots::records::{DisplayIdentity, HarnessModelPolicy};

    fn bot(character_preset: &str, instructions: &str, memories: Vec<&str>) -> Bot {
        Bot {
            id: "bot-1".to_string(),
            character_preset: character_preset.to_string(),
            display_identity: DisplayIdentity {
                display_name: "Arya".to_string(),
                handle: Some("arya".to_string()),
                title: Some("Scout".to_string()),
            },
            harness_policy: HarnessModelPolicy {
                default_harness: "codex".to_string(),
                explicit_model: None,
            },
            instructions: instructions.to_string(),
            memories: memories.into_iter().map(str::to_string).collect(),
            responsibilities: Vec::new(),
            current_session: None,
            created_at: 0.0,
            updated_at: 0.0,
        }
    }

    #[test]
    fn composes_identity_style_instructions_memories_and_message() {
        let subject = bot(
            "arya",
            "Review incoming PRs.",
            vec!["Prefers terse replies."],
        );
        let prompt = build_operating_prompt(&subject, "What is the status of PR 42?");
        assert!(prompt.contains("Name: Arya"));
        assert!(prompt.contains("Role: Scout"));
        assert!(prompt.contains("Handle: @arya"));
        assert!(prompt.contains("Focused, terse, autonomous, and execution-oriented."));
        assert!(prompt.contains("Review incoming PRs."));
        assert!(prompt.contains("- Prefers terse replies."));
        assert!(prompt.contains("Chat message\nWhat is the status of PR 42?"));
        assert!(prompt.contains("Report only evidence you actually observe."));
    }

    #[test]
    fn omits_style_and_memories_sections_when_absent() {
        let subject = bot("none", "", vec![]);
        let prompt = build_operating_prompt(&subject, "Hello");
        assert!(!prompt.contains("Suggested working style"));
        assert!(!prompt.contains("Durable memories"));
        assert!(prompt.contains("No standing instructions recorded."));
    }

    fn memory_record(
        id: &str,
        scope: crate::bots::memory::MemoryScope,
        project_id: Option<&str>,
        content: &str,
    ) -> BotMemory {
        BotMemory {
            id: id.to_string(),
            bot_id: "bot-1".to_string(),
            scope,
            project_id: project_id.map(str::to_string),
            content: content.to_string(),
            version: 1,
            provenance: crate::bots::identity::EditProvenance::user(None),
            created_at: 1.0,
            updated_at: 1.0,
        }
    }

    #[test]
    fn scoped_prompt_has_global_and_own_project_memory_never_other_project() {
        let subject = bot("arya", "Review incoming PRs.", vec![]);
        let memories = vec![
            memory_record("m-g", MemoryScope::Global, None, "Global fact."),
            memory_record(
                "m-a",
                MemoryScope::Project,
                Some("proj-a"),
                "Project A fact.",
            ),
            memory_record(
                "m-b",
                MemoryScope::Project,
                Some("proj-b"),
                "Project B fact.",
            ),
        ];
        let (prompt_a, context_a) =
            build_scoped_operating_prompt(&subject, "Status?", &memories, Some("proj-a"), 1, 5.0)
                .expect("composes");
        assert!(prompt_a.contains("- Global fact."));
        assert!(prompt_a.contains("- Project A fact."));
        assert!(!prompt_a.contains("Project B fact."));
        assert!(context_a.memories.iter().all(|m| m.id != "m-b"));
        let (prompt_b, _) =
            build_scoped_operating_prompt(&subject, "Status?", &memories, Some("proj-b"), 1, 5.0)
                .expect("composes");
        assert!(prompt_b.contains("- Project B fact."));
        assert!(!prompt_b.contains("Project A fact."));
        // Section shape stays the legacy composer's: scoped turns only
        // change WHICH memories enter the same "Durable memories" block.
        assert!(prompt_a.contains("Durable memories\n- Global fact.\n- Project A fact."));
    }

    #[test]
    fn frozen_context_and_hash_survive_later_record_edits() {
        let subject = bot("arya", "", vec![]);
        let memories = vec![memory_record("m-1", MemoryScope::Global, None, "v1 text")];
        let (_, context_v1) =
            build_scoped_operating_prompt(&subject, "Hi", &memories, None, 1, 5.0)
                .expect("composes");
        let edited =
            crate::bots::memory::edit_memory(&memories[0], 1, "v2 text", 9.0).expect("edits");
        let next = vec![edited];
        let (prompt_v2, context_v2) =
            build_scoped_operating_prompt(&subject, "Hi", &next, None, 1, 10.0).expect("composes");
        assert!(prompt_v2.contains("- v2 text"));
        assert_ne!(context_v1.context_hash, context_v2.context_hash);
        assert_eq!(context_v1.memories[0].version, 1);
        assert_eq!(context_v2.memories[0].version, 2);
    }

    #[test]
    fn scoped_composition_refuses_invalid_records_safely() {
        let subject = bot("arya", "", vec![]);
        // Project scope without a project id is an invalid record.
        let memories = vec![memory_record(
            "m-x",
            MemoryScope::Project,
            None,
            "no project",
        )];
        assert!(matches!(
            build_scoped_operating_prompt(&subject, "Hi", &memories, Some("p"), 1, 5.0),
            Err(ScopedPromptError::InvalidMemoryRecord(_))
        ));
        let memories = vec![memory_record("m-x", MemoryScope::Global, None, "ok")];
        assert!(matches!(
            build_scoped_operating_prompt(&subject, "Hi", &memories, Some("p"), 0, 5.0),
            Err(ScopedPromptError::InvalidIdentityVersion(0))
        ));
    }
}
