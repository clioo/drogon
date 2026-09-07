/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
src/shared/drogon-bot-prompt.ts (`buildDrogonBotOperatingPrompt` and its
`CHARACTER_GUIDANCE` map). Adapter: only the identity/style/instructions/
memories sections and the chat-turn framing are needed for a bot.run chat
turn (no responsibility-coordination section, since a chat turn has no
`Automation`/`Responsibility` behind it); the closing accountability line
is kept verbatim. */

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
}
