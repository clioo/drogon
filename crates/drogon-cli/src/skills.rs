//! MIT Copyright (c) 2026 Lovecast Inc.
//! Ported from the Orca reference:
//! - src/cli/handlers/skills.ts (skills list/get/install/update CLI surface)
//! - src/shared/agent-feature-install-commands.ts (npx skills argv builder)
//! - src/shared/skills-cli-agent-keys.ts (skills --agent key mapping)
//! - src/shared/tui-agent-detection-commands.ts (agent detection semantics)
//!
//! `drogon-cli skills`: the version-matched agent skill experience. `list`
//! and `get` serve the embedded guides; `install` and `update` drive the
//! community `skills` CLI through npx so every agent on this host discovers
//! the same Drogon skills, exactly like the reference does.

use crate::bundled_skill_guides::BUNDLED_SKILL_GUIDES;
use crate::cli::SkillsAction;
use crate::commands::RunOutcome;
use crate::error::{CliError, internal_error};
use crate::skills_agents::{is_skills_cli_agent_key_shaped, resolve_detected_install_agent_keys};
use std::process::Command;

/// Drogon's skill repository: where `npx skills add` fetches the
/// `skills/<topic>/SKILL.md` packages from. Reference equivalent:
/// `https://github.com/stablyai/orca`.
pub const DROGON_SKILLS_REPOSITORY_URL: &str = "https://github.com/clioo/drogon";

type BundledGuideRow = crate::bundled_skill_guides::BundledSkillGuide;

/// Canonical (sorted-by-name) guide order, matching the reference's
/// `canonicalGuides`: generated registry order is not a user-facing contract,
/// while stable canonical sorting keeps agent-visible output reproducible.
pub fn canonical_guides() -> Vec<&'static BundledGuideRow> {
    let mut guides: Vec<&'static BundledGuideRow> = BUNDLED_SKILL_GUIDES.iter().collect();
    guides.sort_by(|left, right| left.name.cmp(right.name));
    guides
}

fn guide_row_by_topic(topic: &str) -> Option<&'static BundledGuideRow> {
    BUNDLED_SKILL_GUIDES
        .iter()
        .find(|guide| guide.name == topic || guide.aliases.contains(&topic))
}

fn available_topics() -> String {
    canonical_guides()
        .iter()
        .map(|guide| guide.name)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Reference `requireTopic`: aliases and canonical names share one lookup
/// table because installed stubs may retain an old topic forever.
fn require_topic(topic: &str) -> Result<&'static BundledGuideRow, CliError> {
    if topic.is_empty() {
        return Err(CliError::Usage(format!(
            "Missing skill topic. Available topics: {}",
            available_topics()
        )));
    }
    guide_row_by_topic(topic).ok_or_else(|| {
        CliError::Usage(format!(
            "Unknown skill topic \"{}\". Available topics: {}",
            topic,
            available_topics()
        ))
    })
}

/// Reference `resolveSelectedSkillNames`: `--skill` selection, `--all`, and
/// the exact validation copy for both flags.
fn resolve_selected_skill_names(
    skills: &[String],
    all: bool,
) -> Result<Option<Vec<String>>, CliError> {
    let guides = canonical_guides();
    if skills.is_empty() && !all {
        return Ok(None);
    }
    if all && !skills.is_empty() {
        return Err(CliError::Usage(
            "Use either --all or --skill, not both.".to_string(),
        ));
    }
    if all {
        return Ok(Some(
            guides.iter().map(|guide| guide.name.to_string()).collect(),
        ));
    }
    let available = available_topics();
    let mut canonical_names = Vec::new();
    for requested in skills {
        let guide = guide_row_by_topic(requested).ok_or_else(|| {
            CliError::Usage(format!(
                "Unknown skill \"{}\". Available skills: {}",
                requested, available
            ))
        })?;
        if !canonical_names.iter().any(|name| name == guide.name) {
            canonical_names.push(guide.name.to_string());
        }
    }
    canonical_names.sort();
    Ok(Some(canonical_names))
}

/// Reference `resolveInstallAgentKeys`: one comma-separated `--agent` value,
/// shape validation, then host detection.
fn resolve_install_agent_keys(agent: Option<&str>) -> Result<Vec<String>, CliError> {
    if let Some(requested) = agent {
        let keys: Vec<String> = requested
            .split(',')
            .map(|entry| entry.trim().to_string())
            .filter(|entry| !entry.is_empty())
            .collect();
        // Why: a value like "," parses to nothing. Falling through to detection
        // would be surprising, and emitting no --agent would restore the
        // all-agents install.
        if keys.is_empty() {
            return Err(CliError::Usage("Missing required --agent".to_string()));
        }
        if let Some(unusable) = keys.iter().find(|key| !is_skills_cli_agent_key_shaped(key)) {
            // Why: the skills CLI drops a value starting with `-`, which leaves
            // it with no target and installs into every agent it knows.
            return Err(CliError::Usage(format!(
                "Invalid --agent value \"{}\". Pass agent names such as claude-code, codex, or universal.",
                unusable
            )));
        }
        return Ok(keys);
    }
    let detected = resolve_detected_install_agent_keys();
    if !detected.is_empty() {
        return Ok(detected);
    }
    // Why: without --agent, `skills add -y` falls into its own zero-detected
    // branch and installs into every agent it knows (~75), creating config
    // directories for agents this host does not have. Say so instead.
    Err(CliError::Usage(
        "No coding agent detected on this host, so there is no install target. Pass \
         --agent <name>[,<name>...] to choose targets explicitly — --agent universal \
         writes only the shared .agents/skills directory that Drogon reads."
            .to_string(),
    ))
}

/// Reference `buildAgentFeatureSkillInstallArgs`: `npx skills add` argv. The
/// leading `--yes` (reference `buildNpxSkillsArgs`) keeps a cold package cache
/// from prompting before it will fetch `skills`.
fn build_install_args(skill_names: &[String], global: bool, agents: &[String]) -> Vec<String> {
    let mut args = vec![
        "skills".to_string(),
        "add".to_string(),
        DROGON_SKILLS_REPOSITORY_URL.to_string(),
    ];
    for name in skill_names {
        args.push("--skill".to_string());
        args.push(name.clone());
    }
    if global {
        args.push("--global".to_string());
    }
    for agent in agents {
        args.push("--agent".to_string());
        args.push(agent.clone());
    }
    args.push("-y".to_string());
    args
}

/// Reference `buildAgentFeatureSkillUpdateArgs`: install scopes its targets;
/// update only refreshes what is already placed, so it has no `--agent`.
fn build_update_args(skill_names: &[String], global: bool) -> Vec<String> {
    let mut args = vec!["skills".to_string(), "update".to_string()];
    args.extend(skill_names.iter().cloned());
    args.push(if global {
        "--global".to_string()
    } else {
        "--project".to_string()
    });
    args.push("-y".to_string());
    args
}

/// Reference `formatNpxCommand`: render the exact argv a real run spawns, so
/// --dry-run can never drift from it.
fn format_npx_command(args: &[String]) -> String {
    format!("npx {}", args.join(" "))
}

fn mutation_selection_help(verb: &str, skill_names: &[&str]) -> String {
    let mut lines = vec![format!("Choose one or more skills to {}:", verb)];
    for name in skill_names {
        lines.push(format!("  {}", name));
    }
    lines.push(String::new());
    lines.push(format!(
        "Usage: drogon-cli skills {} --skill <name> [--skill <name> ...]",
        verb
    ));
    lines.push(format!("   or: drogon-cli skills {} --all", verb));
    lines.join("\n")
}

/// Reference `runNpxSkills`: stdio is inherited so progress stays visible;
/// exit code propagates. A missing npx/Node on a headless host surfaces as a
/// raw spawn ENOENT, wrapped into an actionable message.
fn run_npx_skills(args: &[String]) -> Result<u8, CliError> {
    let mut child = Command::new("npx")
        .args(args)
        .spawn()
        .map_err(|error| CliError::Local {
            error: internal_error(format!(
                "Could not run npx: {}. Install Node.js and ensure npx is on PATH.",
                error
            )),
            request_id: "skills".to_string(),
        })?;
    let status = child.wait().map_err(|error| CliError::Local {
        error: internal_error(format!("Could not run npx: {}", error)),
        request_id: "skills".to_string(),
    })?;
    Ok(status.code().unwrap_or(1) as u8)
}

/// Shared inputs of `skills install` / `skills update` (reference
/// `createSkillMutationHandler`'s parsed flag set).
struct MutationRequest<'a> {
    skills: &'a [String],
    all: bool,
    agent: Option<&'a str>,
    local: bool,
    dry_run: bool,
}

/// Shared body of `skills install` / `skills update` (reference
/// `createSkillMutationHandler`).
fn run_mutation(
    request_id: &str,
    json: bool,
    verb: &str,
    request: &MutationRequest<'_>,
) -> Result<RunOutcome, CliError> {
    let MutationRequest {
        skills,
        all,
        agent,
        local,
        dry_run,
    } = request;
    let skill_names = match resolve_selected_skill_names(skills, *all)? {
        Some(names) => names,
        None => {
            let names: Vec<&str> = canonical_guides().iter().map(|guide| guide.name).collect();
            let names_json: Vec<serde_json::Value> =
                names.iter().map(|name| serde_json::json!(name)).collect();
            let stdout = if json {
                serde_json::to_string_pretty(&serde_json::json!({ "availableSkills": names_json }))
                    .map_err(|err| {
                        CliError::local(
                            internal_error(format!("cannot encode response: {err}")),
                            request_id,
                        )
                    })?
            } else {
                mutation_selection_help(verb, &names)
            };
            return Ok(RunOutcome {
                stdout,
                exit_code: 0,
                stderr_note: None,
            });
        }
    };

    // Reference check for remote-forwarded shells has no Drogon equivalent:
    // `drogon-cli` always runs where the user invoked it (no ORCA_CLI_CWD-style
    // forwarding exists), so that branch is intentionally absent.

    let global = !local;
    // Install scopes its targets; update only refreshes what is already placed.
    let agents = if verb == "install" {
        resolve_install_agent_keys(*agent)?
    } else {
        Vec::new()
    };
    let mut npx_args = vec!["--yes".to_string()];
    if verb == "install" {
        npx_args.extend(build_install_args(&skill_names, global, &agents));
    } else {
        npx_args.extend(build_update_args(&skill_names, global));
    }
    let command = format_npx_command(&npx_args);

    if *dry_run {
        let stdout = if json {
            serde_json::to_string_pretty(&serde_json::json!({
                "command": command,
                "skills": skill_names,
                "global": global,
                "executed": false,
            }))
            .map_err(|err| {
                CliError::local(
                    internal_error(format!("cannot encode response: {err}")),
                    request_id,
                )
            })?
        } else {
            format!("{}\n\nRerun without --dry-run to {} now.", command, verb)
        };
        return Ok(RunOutcome {
            stdout,
            exit_code: 0,
            stderr_note: None,
        });
    }

    if json {
        // A real run inherits npx's own stdout so progress stays visible live;
        // that stream is not JSON, so --json can't be honored here.
        return Err(CliError::Usage(format!(
            "drogon-cli skills {} --json only supports --dry-run. Real {}s stream npx's own output, which isn't JSON.",
            verb, verb
        )));
    }

    // stdio is inherited for the child, so this status line must go to stderr —
    // stdout is npx's own output, not this command's JSON channel.
    Ok(RunOutcome {
        stdout: String::new(),
        exit_code: run_npx_skills(&npx_args)?,
        stderr_note: Some(format!("Running: {}", command)),
    })
}

pub fn run(request_id: &str, json: bool, action: &SkillsAction) -> Result<RunOutcome, CliError> {
    match action {
        SkillsAction::List => {
            // Stable canonical sorting keeps agent-visible output reproducible
            // across builds; descriptions collapse whitespace like the reference.
            let topics: Vec<serde_json::Value> = canonical_guides()
                .iter()
                .map(|guide| {
                    serde_json::json!({
                        "name": guide.name,
                        "description": guide.description.split_whitespace().collect::<Vec<_>>().join(" "),
                    })
                })
                .collect();
            if json {
                let stdout = serde_json::to_string_pretty(&serde_json::json!({ "topics": topics }))
                    .map_err(|err| {
                        CliError::local(
                            internal_error(format!("cannot encode response: {err}")),
                            request_id,
                        )
                    })?;
                Ok(RunOutcome {
                    stdout,
                    exit_code: 0,
                    stderr_note: None,
                })
            } else {
                let stdout = topics
                    .iter()
                    .map(|topic| {
                        format!(
                            "{}: {}",
                            topic["name"].as_str().unwrap_or_default(),
                            topic["description"].as_str().unwrap_or_default()
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                Ok(RunOutcome {
                    stdout,
                    exit_code: 0,
                    stderr_note: None,
                })
            }
        }
        SkillsAction::Get { topic, full } => {
            let guide = require_topic(topic)?;
            let markdown = if *full {
                guide.full_markdown
            } else {
                guide.markdown
            };
            if json {
                let stdout = serde_json::to_string_pretty(&serde_json::json!({
                    "name": guide.name,
                    "full": full,
                    "markdown": markdown,
                }))
                .map_err(|err| {
                    CliError::local(
                        internal_error(format!("cannot encode response: {err}")),
                        request_id,
                    )
                })?;
                Ok(RunOutcome {
                    stdout,
                    exit_code: 0,
                    stderr_note: None,
                })
            } else {
                Ok(RunOutcome {
                    stdout: markdown.to_string(),
                    exit_code: 0,
                    stderr_note: None,
                })
            }
        }
        SkillsAction::Install {
            skills,
            all,
            agent,
            local,
            dry_run,
        } => run_mutation(
            request_id,
            json,
            "install",
            &MutationRequest {
                skills,
                all: *all,
                agent: agent.as_deref(),
                local: *local,
                dry_run: *dry_run,
            },
        ),
        SkillsAction::Update {
            skills,
            all,
            local,
            dry_run,
        } => run_mutation(
            request_id,
            json,
            "update",
            &MutationRequest {
                skills,
                all: *all,
                agent: None,
                local: *local,
                dry_run: *dry_run,
            },
        ),
    }
}

// The generated table itself is pinned by scripts/generate-bundled-skill-guides.mjs
// --check and the guide-validation tests in tests/skill_guides.rs.

#[cfg(test)]
mod tests {
    use super::*;

    fn run_ok(action: &SkillsAction) -> (String, u8) {
        let outcome = run("req-skills", false, action).expect("skills command succeeds");
        (outcome.stdout, outcome.exit_code)
    }

    fn usage_of<T>(result: Result<T, CliError>) -> String {
        match result {
            Err(CliError::Usage(message)) => message,
            other => panic!("expected usage error, got {:?}", other.map(|_| ())),
        }
    }

    #[test]
    fn list_matches_reference_text_and_json_shape() {
        let (text, code) = run_ok(&SkillsAction::List);
        assert_eq!(code, 0);
        let mut lines: Vec<String> = text.lines().map(|line| line.to_string()).collect();
        lines.sort();
        assert_eq!(
            lines[0],
            "drogon-cli: Drive Drogon through the public `drogon-cli`: resolve the executable, check status and capabilities, manage workspaces, projects and worktrees, and operate terminals (create, list, send, read, wait, close), the embedded browser pane (open, navigate, snapshot, click, fill, tabs) plus harness launch. Use for terminal control, lightweight prompts and shell commands. Use the orchestration guide for supervised multi-agent coordination."
        );
        assert!(lines[1].starts_with("orchestration: Use Drogon native orchestration"));

        let outcome = run("req-skills", true, &SkillsAction::List).expect("json list");
        let parsed: serde_json::Value = serde_json::from_str(&outcome.stdout).expect("json parses");
        let topics = parsed["topics"].as_array().expect("topics array");
        assert_eq!(topics.len(), 2);
        assert_eq!(topics[0]["name"], "drogon-cli");
        assert!(topics[0]["description"].is_string());
    }

    #[test]
    fn get_requires_topic_and_reports_unknown_like_reference() {
        assert_eq!(
            usage_of(run(
                "req",
                false,
                &SkillsAction::Get {
                    topic: String::new(),
                    full: false
                }
            )),
            "Missing skill topic. Available topics: drogon-cli, orchestration"
        );
        assert_eq!(
            usage_of(run(
                "req",
                false,
                &SkillsAction::Get {
                    topic: "nope".into(),
                    full: false
                }
            )),
            "Unknown skill topic \"nope\". Available topics: drogon-cli, orchestration"
        );
    }

    #[test]
    fn get_prints_markdown_and_json_contract() {
        let (markdown, code) = run_ok(&SkillsAction::Get {
            topic: "drogon-cli".into(),
            full: false,
        });
        assert_eq!(code, 0);
        assert!(markdown.starts_with("---\nname: drogon-cli"));

        let outcome = run(
            "req",
            true,
            &SkillsAction::Get {
                topic: "orchestration".into(),
                full: true,
            },
        )
        .expect("json get");
        let parsed: serde_json::Value = serde_json::from_str(&outcome.stdout).expect("json parses");
        assert_eq!(parsed["name"], "orchestration");
        assert_eq!(parsed["full"], true);
        assert!(
            parsed["markdown"]
                .as_str()
                .expect("markdown")
                .contains("# Drogon Native Orchestration")
        );
    }

    #[test]
    fn mutation_without_selection_lists_available_skills_like_reference() {
        let (text, _) = run_ok(&SkillsAction::Install {
            skills: vec![],
            all: false,
            agent: None,
            local: false,
            dry_run: false,
        });
        assert_eq!(
            text,
            "Choose one or more skills to install:\n  drogon-cli\n  orchestration\n\nUsage: drogon-cli skills install --skill <name> [--skill <name> ...]\n   or: drogon-cli skills install --all"
        );
        let outcome = run(
            "req",
            true,
            &SkillsAction::Update {
                skills: vec![],
                all: false,
                local: false,
                dry_run: false,
            },
        )
        .expect("json update");
        let parsed: serde_json::Value = serde_json::from_str(&outcome.stdout).expect("json parses");
        assert_eq!(
            parsed["availableSkills"],
            serde_json::json!(["drogon-cli", "orchestration"])
        );
    }

    #[test]
    fn mutation_selection_validation_copy_matches_reference() {
        assert_eq!(
            usage_of(run(
                "req",
                false,
                &SkillsAction::Install {
                    skills: vec!["nope".into()],
                    all: false,
                    agent: None,
                    local: false,
                    dry_run: true,
                }
            )),
            "Unknown skill \"nope\". Available skills: drogon-cli, orchestration"
        );
        assert_eq!(
            usage_of(run(
                "req",
                false,
                &SkillsAction::Install {
                    skills: vec!["orchestration".into()],
                    all: true,
                    agent: None,
                    local: false,
                    dry_run: true,
                }
            )),
            "Use either --all or --skill, not both."
        );
    }

    #[test]
    fn dry_run_renders_exact_argv() {
        let (text, _) = run_ok(&SkillsAction::Install {
            skills: vec!["drogon-cli".into()],
            all: false,
            agent: Some("universal,claude-code".into()),
            local: false,
            dry_run: true,
        });
        assert_eq!(
            text,
            "npx --yes skills add https://github.com/clioo/drogon --skill drogon-cli --global --agent universal --agent claude-code -y\n\nRerun without --dry-run to install now."
        );

        let (text, _) = run_ok(&SkillsAction::Update {
            skills: vec!["drogon-cli".into(), "orchestration".into()],
            all: false,
            local: true,
            dry_run: true,
        });
        assert_eq!(
            text,
            "npx --yes skills update drogon-cli orchestration --project -y\n\nRerun without --dry-run to update now."
        );

        let outcome = run(
            "req",
            true,
            &SkillsAction::Install {
                skills: vec![],
                all: true,
                agent: Some("universal".into()),
                local: false,
                dry_run: true,
            },
        )
        .expect("json dry run");
        let parsed: serde_json::Value = serde_json::from_str(&outcome.stdout).expect("json parses");
        assert_eq!(parsed["executed"], false);
        assert_eq!(parsed["global"], true);
        assert_eq!(
            parsed["command"],
            "npx --yes skills add https://github.com/clioo/drogon --skill drogon-cli --skill orchestration --global --agent universal -y"
        );
    }

    #[test]
    fn real_json_runs_are_rejected_like_reference() {
        assert_eq!(
            usage_of(run(
                "req",
                true,
                &SkillsAction::Install {
                    skills: vec!["drogon-cli".into()],
                    all: false,
                    agent: Some("universal".into()),
                    local: false,
                    dry_run: false,
                }
            )),
            "drogon-cli skills install --json only supports --dry-run. Real installs stream npx's own output, which isn't JSON."
        );
    }

    #[test]
    fn install_agent_validation_copy_matches_reference() {
        assert_eq!(
            usage_of(crate::skills::resolve_install_agent_keys(Some(","))),
            "Missing required --agent"
        );
        assert_eq!(
            usage_of(crate::skills::resolve_install_agent_keys(Some("-y"))),
            "Invalid --agent value \"-y\". Pass agent names such as claude-code, codex, or universal."
        );
    }
}
