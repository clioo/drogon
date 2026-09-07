//! Bundled agent skill guides: version-matched Markdown embedded at compile
//! time, served locally by `skills list` / `skills get` without contacting
//! any runtime. The `.md` sources under `crates/drogon-cli/guides/` are the
//! single source of truth; name and description come from their frontmatter.

use crate::cli::SkillsAction;
use crate::commands::RunOutcome;
use crate::error::{CliError, internal_error};

const DROGON_CLI_MARKDOWN: &str = include_str!("../guides/drogon-cli.md");
const ORCHESTRATION_MARKDOWN: &str = include_str!("../guides/orchestration.md");

/// Raw embedded sources in canonical (sorted-by-name) order.
const SOURCES: [&str; 2] = [DROGON_CLI_MARKDOWN, ORCHESTRATION_MARKDOWN];

#[derive(Debug, Clone)]
pub struct SkillGuide {
    pub name: String,
    pub description: String,
    pub markdown: &'static str,
}

/// All bundled guides, sorted by name. Fails only when an embedded source's
/// own frontmatter is malformed, which the guide-validation test pins.
pub fn all_guides() -> Result<Vec<SkillGuide>, String> {
    let mut guides = Vec::with_capacity(SOURCES.len());
    for source in SOURCES {
        let (name, description) = parse_frontmatter(source)
            .ok_or_else(|| "bundled guide is missing valid frontmatter".to_string())?;
        guides.push(SkillGuide {
            name: name.to_string(),
            description,
            markdown: source,
        });
    }
    guides.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(guides)
}

pub fn get_guide(name: &str) -> Result<SkillGuide, String> {
    let guides = all_guides()?;
    guides
        .into_iter()
        .find(|guide| guide.name == name)
        .ok_or_else(|| {
            let available = all_guides()
                .map(|guides| {
                    guides
                        .iter()
                        .map(|guide| guide.name.clone())
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            format!("Unknown skill topic {name:?}. Available topics: {available}")
        })
}

/// Minimal frontmatter reader for the exact shape the bundled guides use:
/// `---`, `name: <value>`, `description: >-` plus two-space-indented folded
/// lines, `---`. Anything else is not a bundled guide.
fn parse_frontmatter(markdown: &'static str) -> Option<(&'static str, String)> {
    let body = markdown.strip_prefix("---\n")?;
    let end = body.find("\n---\n")?;
    let (front, _) = body.split_at(end);
    let mut lines = front.lines();
    let name = lines.next()?.strip_prefix("name:")?.trim();
    if name.is_empty() {
        return None;
    }
    let description_first = lines
        .next()?
        .strip_prefix("description:")?
        .trim()
        .to_string();
    let description = if description_first == ">-" || description_first == ">" {
        let mut folded = String::new();
        for line in lines {
            let Some(stripped) = line.strip_prefix("  ") else {
                break;
            };
            if !folded.is_empty() {
                folded.push(' ');
            }
            folded.push_str(stripped.trim());
        }
        folded
    } else {
        description_first
    };
    if description.is_empty() {
        return None;
    }
    Some((name, description))
}

pub fn run(request_id: &str, json: bool, action: &SkillsAction) -> Result<RunOutcome, CliError> {
    match action {
        SkillsAction::List => {
            let guides =
                all_guides().map_err(|err| CliError::local(internal_error(err), request_id))?;
            if json {
                let payload = serde_json::json!({
                    "guides": guides
                        .iter()
                        .map(|guide| serde_json::json!({
                            "name": guide.name,
                            "description": guide.description,
                        }))
                        .collect::<Vec<_>>(),
                });
                let stdout = serde_json::to_string_pretty(&payload).map_err(|err| {
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
                let stdout = guides
                    .iter()
                    .map(|guide| format!("{}\n  {}", guide.name, guide.description))
                    .collect::<Vec<_>>()
                    .join("\n");
                Ok(RunOutcome {
                    stdout,
                    exit_code: 0,
                    stderr_note: None,
                })
            }
        }
        SkillsAction::Get { name } => match get_guide(name) {
            Ok(guide) => {
                if json {
                    let payload = serde_json::json!({
                        "name": guide.name,
                        "description": guide.description,
                        "markdown": guide.markdown,
                    });
                    let stdout = serde_json::to_string_pretty(&payload).map_err(|err| {
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
                        stdout: guide.markdown.to_string(),
                        exit_code: 0,
                        stderr_note: None,
                    })
                }
            }
            // A bad topic is a bad invocation, like an unknown subcommand.
            Err(message) => Err(CliError::Usage(message)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_guides_parse_and_stay_sorted() {
        let guides = all_guides().expect("embedded guides parse");
        assert_eq!(guides.len(), 2);
        assert_eq!(guides[0].name, "drogon-cli");
        assert_eq!(guides[1].name, "orchestration");
        assert!(!guides[0].description.is_empty());
        assert!(get_guide("drogon-cli").is_ok());
        assert!(get_guide("orchestration").is_ok());
        assert!(get_guide("nope").is_err());
    }

    #[test]
    fn frontmatter_rejects_nonconforming_sources() {
        assert!(parse_frontmatter("no frontmatter").is_none());
        assert!(parse_frontmatter("---\nname: \ndescription: >-\n  x\n---\n").is_none());
        let (name, description) =
            parse_frontmatter("---\nname: demo\ndescription: >-\n  one\n  two\n---\nbody\n")
                .expect("valid frontmatter parses");
        assert_eq!(name, "demo");
        assert_eq!(description, "one two");
    }
}
