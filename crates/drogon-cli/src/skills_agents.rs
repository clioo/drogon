//! MIT Copyright (c) 2026 Lovecast Inc.
//! Ported from the Orca reference:
//! - src/shared/skills-cli-agent-keys.ts
//! - src/shared/tui-agent-detection-commands.ts (probe/resolve semantics)
//!
//! Maps the coding agents Drogon can detect on this host onto the community
//! `skills` CLI's own `--agent` keys, so `drogon-cli skills install` targets
//! exactly the agents present — plus the shared universal directory.

/// The skills CLI's own `--agent` key for each agent Drogon detects. Drogon's
/// harness set is the subset of the reference's `TUI_AGENT_CONFIG` that this
/// runtime launches; the mapping values are byte-identical to the reference's
/// `SKILLS_CLI_AGENT_KEY_BY_TUI_AGENT` (claude is `claude-code` there too).
const SKILLS_CLI_AGENT_KEY_BY_HARNESS: &[(&str, Option<&str>)] = &[
    ("claude", Some("claude-code")),
    ("codex", Some("codex")),
    ("opencode", Some("opencode")),
    ("pi", Some("pi")),
    ("antigravity", Some("antigravity")),
];

/// The shared `.agents/skills` target every universal agent reads. Always
/// included so agents Drogon cannot map still receive the skill.
pub const SKILLS_CLI_UNIVERSAL_AGENT_KEY: &str = "universal";

/// Whether a value is shaped like a `skills --agent` key, or its explicit
/// all-agents wildcard.
///
/// Why: the skills CLI silently DROPS a `--agent` value that starts with `-`,
/// which empties its target list and drops it into the same all-agents branch
/// an omitted --agent does. `--agent -y` is enough to trigger it, so shape is
/// checked, not just emptiness. An unknown-but-plausible key is left to the
/// CLI, which rejects it loudly with its own valid list before writing
/// anything.
pub fn is_skills_cli_agent_key_shaped(value: &str) -> bool {
    // Reference regex: /^(?:\*|[a-z0-9][a-z0-9.-]*)$/i
    if value == "*" {
        return true;
    }
    let mut chars = value.chars();
    match (chars.next(), chars.next()) {
        (Some(first), rest) => {
            let plausible = |byte: char| byte.is_ascii_alphanumeric() || byte == '.' || byte == '-';
            first.is_ascii_alphanumeric() && rest.into_iter().all(plausible)
        }
        _ => false,
    }
}

/// Whether `command` resolves on this host's `PATH` (the reference probes the
/// same way its install-dir detector does; a PATH hit is the shared minimum).
fn command_on_path(command: &str) -> bool {
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path).any(|dir| {
        let candidate = dir.join(command);
        candidate.is_file() || {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                candidate
                    .metadata()
                    .map(|meta| meta.permissions().mode() & 0o111 != 0)
                    .unwrap_or(false)
            }
            #[cfg(not(unix))]
            {
                candidate.with_extension("exe").is_file()
            }
        }
    })
}

/// Map detected Drogon harnesses onto `skills --agent` keys, plus the
/// universal target. Sorted, like the reference's `toSkillsCliAgentKeys`.
pub fn to_skills_cli_agent_keys(detected_harnesses: &[&str]) -> Vec<String> {
    let mut keys = vec![SKILLS_CLI_UNIVERSAL_AGENT_KEY.to_string()];
    for (harness, key) in SKILLS_CLI_AGENT_KEY_BY_HARNESS {
        if detected_harnesses.contains(harness)
            && let Some(key) = key
        {
            keys.push(key.to_string());
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

/// Detect the agents Drogon can see on this host, as `skills --agent` keys.
pub fn resolve_detected_install_agent_keys() -> Vec<String> {
    let detected: Vec<&str> = SKILLS_CLI_AGENT_KEY_BY_HARNESS
        .iter()
        .map(|(harness, _)| *harness)
        .filter(|harness| command_on_path(harness))
        .collect();
    to_skills_cli_agent_keys(&detected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_shape_rejects_what_the_skills_cli_would_drop() {
        // Reference `isSkillsCliAgentKeyShaped` cases.
        assert!(is_skills_cli_agent_key_shaped("universal"));
        assert!(is_skills_cli_agent_key_shaped("claude-code"));
        assert!(is_skills_cli_agent_key_shaped("*"));
        assert!(is_skills_cli_agent_key_shaped("Kilo.Code"));
        assert!(!is_skills_cli_agent_key_shaped("-y"));
        assert!(!is_skills_cli_agent_key_shaped(""));
        assert!(!is_skills_cli_agent_key_shaped("a b"));
    }

    #[test]
    fn universal_is_always_included_and_output_is_sorted() {
        let keys = to_skills_cli_agent_keys(&["codex", "claude"]);
        assert_eq!(keys, vec!["claude-code", "codex", "universal"]);
        // Unmappable agents are dropped, like the reference's null entries.
        assert_eq!(to_skills_cli_agent_keys(&[]), vec!["universal"]);
    }

    #[test]
    fn every_mapping_lands_on_a_plausible_skills_key() {
        for (harness, key) in SKILLS_CLI_AGENT_KEY_BY_HARNESS {
            assert!(!harness.is_empty());
            if let Some(key) = key {
                assert!(
                    is_skills_cli_agent_key_shaped(key),
                    "{key} must be a usable --agent value"
                );
            }
        }
    }
}
