//! MIT Copyright (c) 2026 Lovecast Inc.
//! Ported from the Orca reference: src/shared/skill-metadata.ts and
//! src/shared/skill-metadata.test.ts.
//!
//! `summarize_skill_markdown`: reads a SKILL.md's routing surface — the
//! `name`/`description` frontmatter, with heading/first-paragraph fallbacks —
//! byte-for-byte the same contract the reference uses for skill discovery.

/// A SKILL.md summary: `None` fields mean "absent", matching the reference's
/// `name: string | null` / `description: string | null`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillFrontmatterSummary {
    pub name: Option<String>,
    pub description: Option<String>,
}

fn strip_quote_pair(value: &str) -> &str {
    let trimmed = value.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2)
        || (trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2)
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

/// The reference's minimal YAML subset: `key: value`, block scalars
/// (`|`, `|-`, `>`, `>-`) over two-space-indented lines, and `- item` lists.
/// Values collapse whitespace like the reference's `.replace(/\s+/g, ' ')`.
fn parse_yaml_frontmatter(raw: &str) -> Vec<(String, String)> {
    let normalized_lines = raw.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized_lines.split('\n').collect();
    let mut data: Vec<(String, String)> = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = &lines[index];
        let Some((key, value)) = line.split_once(':') else {
            index += 1;
            continue;
        };
        if !key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            || key.is_empty()
        {
            index += 1;
            continue;
        }
        let key = key.to_string();
        let value = value.trim().to_string();
        if matches!(value.as_str(), "|" | "|-" | ">" | ">-") {
            let mut block: Vec<String> = Vec::new();
            index += 1;
            while index < lines.len()
                && (lines[index].starts_with("  ") || lines[index].trim().is_empty())
            {
                block.push(
                    lines[index]
                        .strip_prefix("  ")
                        .unwrap_or(lines[index])
                        .to_string(),
                );
                index += 1;
            }
            let joined = if value.starts_with('>') {
                block.join(" ")
            } else {
                block.join("\n")
            };
            data.push((key, collapse_whitespace(&joined)));
            continue;
        }
        if value.is_empty() {
            let mut items: Vec<String> = Vec::new();
            index += 1;
            while index < lines.len() {
                match lines[index].trim_start().strip_prefix("- ") {
                    Some(item) if lines[index].starts_with([' ', '\t']) => {
                        items.push(strip_quote_pair(item).to_string());
                        index += 1;
                    }
                    _ => break,
                }
            }
            if !items.is_empty() {
                data.push((key, items.join(", ")));
            } else {
                data.push((key, String::new()));
            }
            continue;
        }
        data.push((key, strip_quote_pair(&value).to_string()));
        index += 1;
    }
    data
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_heading(body: &str) -> Option<String> {
    for line in body.lines() {
        if let Some(heading) = line.strip_prefix("# ") {
            let trimmed = heading.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn first_paragraph(body: &str) -> Option<String> {
    let mut paragraph: Vec<String> = Vec::new();
    for line in body.replace("\r\n", "\n").split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("```") {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        paragraph.push(trimmed.to_string());
        if paragraph.join(" ").len() > 240 {
            break;
        }
    }
    if paragraph.is_empty() {
        None
    } else {
        Some(paragraph.join(" "))
    }
}

/// Reference `summarizeSkillMarkdown`: frontmatter wins; otherwise the first
/// `# ` heading names the skill and the first non-heading, non-fence paragraph
/// describes it.
pub fn summarize_skill_markdown(markdown: &str) -> SkillFrontmatterSummary {
    // Reference: BOM strip plus CRLF/CR normalization (same shape as the
    // generator's normalizeMarkdown).
    let normalized = markdown
        .replace('\u{feff}', "")
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let frontmatter = normalized
        .strip_prefix("---\n")
        .and_then(|rest| {
            rest.find("\n---")
                .map(|end| (&rest[..end], &rest[end + 5..]))
        })
        .or_else(|| {
            // `---\s*\n` also allows trailing spaces on the opening fence.
            normalized.strip_prefix("--- \n").and_then(|rest| {
                rest.find("\n---")
                    .map(|end| (&rest[..end], &rest[end + 5..]))
            })
        });
    let (frontmatter_keys, body) = match frontmatter {
        Some((front, body)) => (parse_yaml_frontmatter(front), body),
        None => (Vec::new(), normalized.as_str()),
    };
    let lookup = |key: &str| {
        frontmatter_keys
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .filter(|v| !v.trim().is_empty())
    };
    let name = lookup("name")
        .or_else(|| first_heading(body))
        .filter(|value| !value.trim().is_empty());
    let description = lookup("description")
        .or_else(|| first_paragraph(body))
        .filter(|value| !value.trim().is_empty());
    SkillFrontmatterSummary { name, description }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reference fixture: reads name and folded description from frontmatter.
    #[test]
    fn reads_name_and_folded_description_from_frontmatter() {
        let summary = summarize_skill_markdown(
            "---\nname: orca-cli\ndescription: >-\n  Use the orca CLI to drive a running editor;\n  keep worktree comments current.\n---\n\n# Orca CLI\n",
        );
        assert_eq!(
            summary,
            SkillFrontmatterSummary {
                name: Some("orca-cli".to_string()),
                description: Some(
                    "Use the orca CLI to drive a running editor; keep worktree comments current."
                        .to_string()
                ),
            }
        );
    }

    /// Reference fixture: heading and first paragraph fallback when
    /// frontmatter is absent.
    #[test]
    fn falls_back_to_heading_and_first_paragraph() {
        let summary = summarize_skill_markdown(
            "# Design Review\n\nUse when reviewing UI implementation quality.\n",
        );
        assert_eq!(
            summary,
            SkillFrontmatterSummary {
                name: Some("Design Review".to_string()),
                description: Some("Use when reviewing UI implementation quality.".to_string()),
            }
        );
    }

    /// Reference parser behaviors worth pinning for the projection contract:
    /// quoted scalars, CRLF inputs, and list values.
    #[test]
    fn handles_quoted_scalars_lists_and_crlf() {
        let summary = summarize_skill_markdown(
            "---\r\nname: \"quoted-name\"\r\ntags:\r\n  - one\r\n  - two\r\ndescription: folded >- is not a scalar here\r\n---\r\n\r\n# Body\r\n",
        );
        assert_eq!(summary.name.as_deref(), Some("quoted-name"));

        let with_bom = summarize_skill_markdown("\u{feff}---\nname: bom\n---\n");
        assert_eq!(with_bom.name.as_deref(), Some("bom"));

        let list = summarize_skill_markdown(
            "---\nname: listy\n disagreement:\n  - alpha\n  - beta\n---\n",
        );
        // An unknown list key must not disturb name/description resolution.
        assert_eq!(list.name.as_deref(), Some("listy"));
    }
}
