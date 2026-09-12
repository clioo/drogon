//! The main session's Subagent Policy brief (DISHONEST-3): the same seam
//! `bots::context_files` uses for a Bot's identity -- a file every harness
//! (Claude Code, Codex, Pi, OpenCode, Antigravity) already reads on its own
//! at the start of a session in its cwd -- generalized so the Work Graph's
//! Subagent policy (delegate / adversarial) actually reaches the session it
//! describes, instead of living only in `drogon-cli skills get`'s prose,
//! which nothing prompts a session to go read.
//!
//! Unlike a Bot's home (a directory Drogon provisions and owns outright), an
//! ordinary workspace is very often a real project the owner already has an
//! `AGENTS.md`/`CLAUDE.md` in: overwriting either wholesale, the way
//! `bots::context_files` does for a Bot home, would destroy it. Instead this
//! module owns exactly one clearly delimited MANAGED BLOCK inside each file:
//! everything outside the markers is the owner's, read and left untouched;
//! everything inside is regenerated (the whole block is replaced, never
//! appended alongside a stale copy of itself) on every `harness.start`, so a
//! policy can never outlive the toggle that produced it and a repeated
//! launch in the same workspace is idempotent (same policy in, byte-identical
//! file out -- no mtime churn for opening a second tab).
//!
//! A toggle flip is picked up the moment the NEXT session in this workspace
//! opens (this is written before the harness process spawns, at
//! `harness.start`); a session already running keeps whatever brief it
//! already received -- this module is never called again for it.

use std::io;
use std::path::Path;

use drogon_protocol::RpcError;
use drogon_protocol::graph::GraphPolicy;

use crate::error;

use super::store;

pub const AGENTS_FILE_NAME: &str = "AGENTS.md";
pub const CLAUDE_FILE_NAME: &str = "CLAUDE.md";

const BLOCK_BEGIN: &str =
    "<!-- BEGIN DROGON SUBAGENT POLICY (generated at every session start; do not edit by hand) -->";
const BLOCK_END: &str = "<!-- END DROGON SUBAGENT POLICY -->";
const BLOCK_SEPARATOR: &str = "<!-- DROGON SUBAGENT POLICY BLOCK (managed) -->";
const CREATED_FILE_HEADER: &str =
    "<!-- DROGON CREATED THIS FILE BECAUSE A SUBAGENT POLICY IS CONFIGURED FOR THIS WORKSPACE. -->";

/// A policy is configured only when it changes the zero-cost, single-node
/// default. `max_iterations` is deliberately not part of this predicate:
/// changing the bound while adversarial testing is off does not configure a
/// policy, and an absent `intent.policy` therefore remains indistinguishable
/// from an explicit default policy.
fn policy_is_configured(policy: &GraphPolicy) -> bool {
    policy.delegate
        || policy.adversarial.enabled
        || !policy.approved_runtimes.is_empty()
        || policy.fallback_runtime.is_some()
}

/// Reads `workspace_root`'s `.drogon/graph.json`. A workspace with no
/// configured policy is left alone, except that a managed block from an
/// earlier configured policy is removed. A configured policy is written into
/// a managed block inside `AGENTS.md`/`CLAUDE.md` at the workspace root;
/// missing files are created with a header explaining why Drogon created
/// them. Returns whether either file actually changed.
pub fn write_session_policy_brief(
    workspace_root: &Path,
    workspace_id: &str,
) -> Result<bool, RpcError> {
    let graph = store::read_graph(workspace_root)?;
    if policy_is_configured(&graph.intent.policy) {
        let section = render_policy_section(workspace_id, &graph.intent.policy);
        let agents_changed = upsert_file(&workspace_root.join(AGENTS_FILE_NAME), &section)
            .map_err(|e| error::io_error(format!("cannot write {AGENTS_FILE_NAME}: {e}")))?;
        let claude_changed = upsert_file(&workspace_root.join(CLAUDE_FILE_NAME), &section)
            .map_err(|e| error::io_error(format!("cannot write {CLAUDE_FILE_NAME}: {e}")))?;
        Ok(agents_changed || claude_changed)
    } else {
        let agents_changed = remove_file_brief(&workspace_root.join(AGENTS_FILE_NAME))
            .map_err(|e| error::io_error(format!("cannot clean {AGENTS_FILE_NAME}: {e}")))?;
        let claude_changed = remove_file_brief(&workspace_root.join(CLAUDE_FILE_NAME))
            .map_err(|e| error::io_error(format!("cannot clean {CLAUDE_FILE_NAME}: {e}")))?;
        Ok(agents_changed || claude_changed)
    }
}

/// Renders the Subagent Policy section body (no markers): the same
/// discovery-shaped, real-verb prose `skill-guides/drogon-cli.md`'s
/// "Subagent Policy And The Adversarial Loop" section teaches, addressed
/// directly to the session about to open rather than to an agent that has to
/// go find the guide first. Every `drogon-cli ...` verb named here is one
/// that guide documents (checked by this module's own drift tripwire below).
pub fn render_policy_section(workspace_id: &str, policy: &GraphPolicy) -> String {
    let mut out = String::new();
    out.push_str("## Subagent Policy And The Adversarial Loop\n\n");
    out.push_str(&format!(
        "Generated by Drogon fresh at the start of EVERY session in this workspace, from \
         `intent.policy` in `.drogon/graph.json` (`drogon-cli graph read --workspace \
         {workspace_id} --json`). A policy change here takes effect for the NEXT session \
         opened in this workspace; it never rewrites a session already running.\n\n"
    ));
    if policy.delegate {
        out.push_str(&format!(
            "- **Delegate: ON.** Plan and delegate instead of doing the work yourself: write \
             intent nodes for the subtasks with `drogon-cli graph write-intent --workspace \
             {workspace_id} --file graph-intent.json` and let the graph's own execution path \
             run them, rather than doing the work directly in this session.\n"
        ));
    } else {
        out.push_str("- **Delegate: OFF.** Single node: do the work directly in this session.\n");
    }
    if policy.adversarial.enabled {
        out.push_str(&format!(
            "- **Adversarial testing: ON, up to {} cycle(s).** The daemon runs a bounded \
             Adversarial-test / Code-review loop against a finished workflow: an \
             adversarial-test pass that tries to break the work, then an independent \
             code-review pass that fixes confirmed problems and verifies each fix. That loop \
             persists independently of open windows. Run starts it through \
             `graph.orchestrator_start`; legacy graph node runs do not implicitly start it. \
             Both roles execute before a cycle can pass. Findings trigger another cycle, \
             while runtime failures try the next approved runtime and then the fallback. \
             Leave real, runnable checks for replay. Subagent depth is one.\n",
            policy.adversarial.max_iterations
        ));
    } else {
        out.push_str(
            "- **Adversarial testing: OFF.** No automatic adversarial-test / code-review loop \
             runs after this session's work.\n",
        );
    }
    let listed = policy
        .approved_runtimes
        .iter()
        .map(|runtime| format!("{}/{}", runtime.harness, runtime.model))
        .collect::<Vec<_>>()
        .join(", ");
    match (
        &policy.approved_runtimes.is_empty(),
        &policy.fallback_runtime,
    ) {
        (true, None) => out.push_str(
            "- **Approved runtimes:** none configured -- subagent nodes run under the free \
             local `pi` model by default, so this never costs anything.\n",
        ),
        (true, Some(fallback)) => out.push_str(&format!(
            "- **Approved runtimes:** none configured, so the free local `pi` model is tried \
             first. **Fallback runtime:** {}/{} is tried after that attempt fails.\n",
            fallback.harness, fallback.model
        )),
        (false, fallback) => {
            let fallback_text = fallback
                .as_ref()
                .map(|runtime| {
                    format!(
                        " The configured fallback is {}/{} and is tried only after every \
                         approved runtime fails.",
                        runtime.harness, runtime.model
                    )
                })
                .unwrap_or_default();
            out.push_str(&format!(
                "- **Approved runtimes, in failover order:** {listed}. Launch a subagent node \
                 through that exact order with `drogon-cli graph run-node-failover --workspace \
                 {workspace_id} --node <NODE_ID> --follow`; it tries each approved runtime and \
                 only reaches the fallback once every approved runtime has failed. The result \
                 names the runtime that actually ran, never a guess.{fallback_text}\n"
            ));
        }
    }
    out
}

/// Reads `path`, replaces or appends the managed block, and writes back only
/// when the content actually changed. Missing files are created only for a
/// configured policy and carry [`CREATED_FILE_HEADER`] so a later reset can
/// remove an otherwise empty Drogon-owned file. Atomic per file (temp file +
/// rename), matching `bots::context_files::write_if_changed`, so a reader
/// starting up never observes a half-written file.
fn upsert_file(path: &Path, section: &str) -> io::Result<bool> {
    let Some(existing) = read_existing(path)? else {
        let updated = format!("{CREATED_FILE_HEADER}\n\n{}", file_block(section));
        write_contents(path, &updated)?;
        return Ok(true);
    };
    let updated = upsert_file_managed_block(&existing, section);
    if existing == updated {
        return Ok(false);
    }
    write_contents(path, &updated)?;
    Ok(true)
}

/// Returns the existing UTF-8 text, distinguishing a missing file from an
/// empty owner file. Other read failures are reported instead of being
/// mistaken for an absent file and overwritten.
fn read_existing(path: &Path) -> io::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn write_contents(path: &Path, contents: &str) -> io::Result<()> {
    let temporary = path.with_extension("md.drogon-tmp");
    std::fs::write(&temporary, contents)?;
    std::fs::rename(&temporary, path)?;
    Ok(())
}

/// Removes only the managed block. If the file was created by Drogon and the
/// block was its only content, the file itself is removed; an owner file (or
/// a Drogon-created file that gained owner content) stays in place.
fn remove_file_brief(path: &Path) -> io::Result<bool> {
    let Some(existing) = read_existing(path)? else {
        return Ok(false);
    };
    let Some((start, end, _has_separator)) = find_file_block(&existing) else {
        return Ok(false);
    };
    let mut updated = String::with_capacity(existing.len());
    updated.push_str(&existing[..start]);
    updated.push_str(&existing[end..]);
    if updated
        .strip_prefix(CREATED_FILE_HEADER)
        .is_some_and(|rest| rest.trim().is_empty())
    {
        std::fs::remove_file(path)?;
    } else {
        write_contents(path, &updated)?;
    }
    Ok(true)
}

/// The on-disk block carries a managed separator inside its begin/end range
/// so removing it can restore the owner's exact trailing bytes, including
/// whether the owner ended with zero, one, or several newlines.
fn file_block(section: &str) -> String {
    format!("{BLOCK_BEGIN}\n{BLOCK_SEPARATOR}\n{section}\n{BLOCK_END}\n")
}

fn upsert_file_managed_block(existing: &str, section: &str) -> String {
    let block = file_block(section);
    match find_file_block(existing) {
        Some((start, end, has_separator)) => {
            let mut result = String::with_capacity(existing.len() + block.len());
            result.push_str(&existing[..start]);
            if has_separator && start > 0 {
                // `find_file_block` includes the one newline inserted before
                // the separator in `start`; put it back during replacement so
                // a configured second launch is byte-identical.
                result.push('\n');
            }
            result.push_str(&block);
            result.push_str(&existing[end..]);
            result
        }
        None => {
            let mut result = existing.to_string();
            if !result.is_empty() {
                result.push('\n');
            }
            result.push_str(&block);
            result
        }
    }
}

/// Replaces an existing managed block in place, or appends a new one
/// separated from any existing content by exactly one blank line. Content
/// outside the markers is never touched.
#[cfg(test)]
fn upsert_managed_block(existing: &str, section: &str) -> String {
    let block = format!("{BLOCK_BEGIN}\n{section}\n{BLOCK_END}\n");
    match find_block(existing) {
        Some((start, end)) => {
            let mut result = String::with_capacity(existing.len() + block.len());
            result.push_str(&existing[..start]);
            result.push_str(&block);
            result.push_str(&existing[end..]);
            result
        }
        None => {
            let mut result = existing.to_string();
            if !result.is_empty() {
                while !result.ends_with("\n\n") {
                    result.push('\n');
                }
            }
            result.push_str(&block);
            result
        }
    }
}

/// The byte range `[start, end)` of an existing managed block, `end`
/// extended past one trailing newline right after [`BLOCK_END`] when present
/// so a replace-in-place never accumulates blank lines across repeated
/// launches. `None` when no block exists yet in this file.
fn find_block(existing: &str) -> Option<(usize, usize)> {
    let start = existing.find(BLOCK_BEGIN)?;
    let after_begin = start + BLOCK_BEGIN.len();
    let end_marker = existing[after_begin..].find(BLOCK_END)? + after_begin;
    let mut end = end_marker + BLOCK_END.len();
    if existing[end..].starts_with('\n') {
        end += 1;
    }
    Some((start, end))
}

/// Finds the on-disk form used by `write_session_policy_brief`, including
/// the separator and its one synthetic leading newline. The fallback to the
/// raw marker keeps files written by the earlier brief implementation
/// cleanable.
fn find_file_block(existing: &str) -> Option<(usize, usize, bool)> {
    let (begin, end) = find_block(existing)?;
    let separator = format!("\n{BLOCK_SEPARATOR}\n");
    let after_begin = begin + BLOCK_BEGIN.len();
    if existing[after_begin..].starts_with(&separator) {
        let start = if begin > 0 && existing.as_bytes()[begin - 1] == b'\n' {
            begin - 1
        } else {
            begin
        };
        Some((start, end, true))
    } else {
        Some((begin, end, false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use drogon_protocol::graph::{GraphAdversarialPolicy, GraphRuntimeRef};
    use serde_json::json;

    fn policy_off() -> GraphPolicy {
        GraphPolicy::default()
    }

    fn policy_delegate_on() -> GraphPolicy {
        GraphPolicy {
            delegate: true,
            ..GraphPolicy::default()
        }
    }

    #[test]
    fn delegate_on_names_the_real_write_intent_verb() {
        let rendered = render_policy_section("ws-1", &policy_delegate_on());
        assert!(rendered.contains("Delegate: ON"));
        assert!(
            rendered.contains(
                "drogon-cli graph write-intent --workspace ws-1 --file graph-intent.json"
            )
        );
    }

    #[test]
    fn delegate_off_says_single_node() {
        let rendered = render_policy_section("ws-1", &policy_off());
        assert!(rendered.contains("Delegate: OFF"));
        assert!(rendered.contains("Single node: do the work directly in this session."));
        assert!(!rendered.contains("Delegate: ON"));
    }

    #[test]
    fn adversarial_on_names_the_iteration_count() {
        let policy = GraphPolicy {
            adversarial: GraphAdversarialPolicy {
                enabled: true,
                max_iterations: 4,
            },
            ..GraphPolicy::default()
        };
        let rendered = render_policy_section("ws-1", &policy);
        assert!(rendered.contains("Adversarial testing: ON, up to 4 cycle(s)"));
    }

    #[test]
    fn approved_runtimes_are_listed_in_configured_order() {
        let policy = GraphPolicy {
            approved_runtimes: vec![
                GraphRuntimeRef {
                    harness: "codex".to_string(),
                    model: "gpt-5.3-codex".to_string(),
                },
                GraphRuntimeRef {
                    harness: "opencode".to_string(),
                    model: "claude-sonnet-4".to_string(),
                },
            ],
            ..GraphPolicy::default()
        };
        let rendered = render_policy_section("ws-1", &policy);
        assert!(rendered.contains("codex/gpt-5.3-codex, opencode/claude-sonnet-4"));
        assert!(rendered.contains("drogon-cli graph run-node-failover --workspace ws-1"));
    }

    /// The property this whole module exists to guarantee: every
    /// `drogon-cli ...` verb the generated brief names is one the bundled
    /// guide actually documents, mirroring
    /// `bots::context_files`'s own drift tripwire (#457) so this brief can
    /// never promise a command the binary does not have.
    #[test]
    fn names_only_verbs_the_bundled_guide_documents() {
        let policy = GraphPolicy {
            delegate: true,
            approved_runtimes: vec![GraphRuntimeRef {
                harness: "codex".to_string(),
                model: "gpt-5.3-codex".to_string(),
            }],
            ..GraphPolicy::default()
        };
        let rendered = render_policy_section("ws-1", &policy);
        let guide = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../skill-guides/drogon-cli.md"
        ))
        .expect("bundled drogon-cli guide source beside the crate");
        let collapse =
            |text: &str| -> String { text.split_whitespace().collect::<Vec<_>>().join(" ") };
        let guide_corpus = collapse(&guide);
        let mut checked = 0;
        for span in backticked_spans(&rendered) {
            if !span.starts_with("drogon-cli ") {
                continue;
            }
            let verb_prefix: String = span
                .split_whitespace()
                .take_while(|token| !token.starts_with('-') && !token.starts_with('<'))
                .collect::<Vec<_>>()
                .join(" ");
            assert!(
                guide_corpus.contains(&collapse(&span)) || guide_corpus.contains(&verb_prefix),
                "generated brief names a command the bundled guide does not document: {span:?}"
            );
            checked += 1;
        }
        assert!(
            checked >= 3,
            "expected the real invocation spans to be checked, got {checked}"
        );
    }

    /// Whitespace-collapsed single-backtick spans, mirroring
    /// `bots::context_files`'s own extractor.
    fn backticked_spans(markdown: &str) -> Vec<String> {
        let mut spans = Vec::new();
        let mut rest = markdown;
        while let Some(open) = rest.find('`') {
            let after_open = &rest[open + 1..];
            let Some(close) = after_open.find('`') else {
                break;
            };
            spans.push(
                after_open[..close]
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            rest = &after_open[close + 1..];
        }
        spans
    }

    #[test]
    fn upsert_creates_file_with_only_the_managed_block() {
        let rendered = upsert_managed_block("", "BODY");
        assert_eq!(rendered, format!("{BLOCK_BEGIN}\nBODY\n{BLOCK_END}\n"));
    }

    #[test]
    fn upsert_preserves_owner_content_outside_the_block() {
        let existing = "# My Project\n\nReal instructions the owner wrote.\n";
        let first = upsert_managed_block(existing, "BODY V1");
        assert!(first.starts_with(existing));
        assert!(first.contains("BODY V1"));

        // Re-running with different content replaces ONLY the block, never
        // duplicating it and never touching the owner's text above it.
        let second = upsert_managed_block(&first, "BODY V2");
        assert!(second.starts_with(existing));
        assert!(second.contains("BODY V2"));
        assert!(!second.contains("BODY V1"));
        assert_eq!(second.matches(BLOCK_BEGIN).count(), 1);
    }

    #[test]
    fn upsert_with_identical_content_is_byte_identical() {
        let existing = "# My Project\n\nReal instructions.\n";
        let once = upsert_managed_block(existing, "BODY");
        let twice = upsert_managed_block(&once, "BODY");
        assert_eq!(
            once, twice,
            "an identical re-render must not churn the file"
        );
    }

    fn configure_policy(root: &Path, policy: &GraphPolicy) {
        store::write_intent(
            root,
            &json!({
                "nodes": [],
                "policy": serde_json::to_value(policy).unwrap(),
            }),
        )
        .unwrap();
    }

    fn reset_policy(root: &Path) {
        configure_policy(root, &GraphPolicy::default());
    }

    #[test]
    fn only_non_default_policy_is_configured() {
        assert!(!policy_is_configured(&GraphPolicy::default()));
        assert!(policy_is_configured(&GraphPolicy {
            delegate: true,
            ..GraphPolicy::default()
        }));
        assert!(policy_is_configured(&GraphPolicy {
            adversarial: GraphAdversarialPolicy {
                enabled: true,
                ..GraphAdversarialPolicy::default()
            },
            ..GraphPolicy::default()
        }));
        assert!(policy_is_configured(&GraphPolicy {
            approved_runtimes: vec![GraphRuntimeRef {
                harness: "pi".into(),
                model: "local".into(),
            }],
            ..GraphPolicy::default()
        }));
        assert!(policy_is_configured(&GraphPolicy {
            fallback_runtime: Some(GraphRuntimeRef {
                harness: "pi".into(),
                model: "local".into(),
            }),
            ..GraphPolicy::default()
        }));
    }

    #[test]
    fn fallback_only_policy_is_rendered_as_configured() {
        let rendered = render_policy_section(
            "ws-1",
            &GraphPolicy {
                fallback_runtime: Some(GraphRuntimeRef {
                    harness: "custom".into(),
                    model: "qwen3-coder".into(),
                }),
                ..GraphPolicy::default()
            },
        );
        assert!(rendered.contains("**Fallback runtime:** custom/qwen3-coder"));
        assert!(!rendered.contains("none configured -- subagent nodes run under"));
    }

    #[test]
    fn no_graph_or_default_policy_touches_no_files() {
        let root = tempfile::tempdir().unwrap();
        let before = std::fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert!(!write_session_policy_brief(root.path(), "ws-1").unwrap());
        let after = std::fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert_eq!(before, after);
        assert!(!root.path().join(AGENTS_FILE_NAME).exists());
        assert!(!root.path().join(CLAUDE_FILE_NAME).exists());

        // An explicit default policy is equally unconfigured.
        reset_policy(root.path());
        let graph_before = std::fs::read(root.path().join(".drogon/graph.json")).unwrap();
        assert!(!write_session_policy_brief(root.path(), "ws-1").unwrap());
        assert_eq!(
            graph_before,
            std::fs::read(root.path().join(".drogon/graph.json")).unwrap()
        );
    }

    #[test]
    fn existing_owner_files_are_byte_identical_without_a_configured_policy() {
        let root = tempfile::tempdir().unwrap();
        let agents_before = b"# Real Project\n\nDo not break the build.\n";
        let claude_before = b"# Claude instructions\nkeep this exact.\n";
        std::fs::write(root.path().join(AGENTS_FILE_NAME), agents_before).unwrap();
        std::fs::write(root.path().join(CLAUDE_FILE_NAME), claude_before).unwrap();
        assert!(!write_session_policy_brief(root.path(), "ws-1").unwrap());
        assert_eq!(
            std::fs::read(root.path().join(AGENTS_FILE_NAME)).unwrap(),
            agents_before
        );
        assert_eq!(
            std::fs::read(root.path().join(CLAUDE_FILE_NAME)).unwrap(),
            claude_before
        );
    }

    #[test]
    fn configured_policy_creates_marked_files_and_preserves_owner_content() {
        let root = tempfile::tempdir().unwrap();
        let owner = b"# Real Project\n\nDo not break the build.\n";
        std::fs::write(root.path().join(AGENTS_FILE_NAME), owner).unwrap();
        configure_policy(
            root.path(),
            &GraphPolicy {
                delegate: true,
                ..GraphPolicy::default()
            },
        );

        assert!(write_session_policy_brief(root.path(), "ws-1").unwrap());
        let agents = std::fs::read_to_string(root.path().join(AGENTS_FILE_NAME)).unwrap();
        assert_eq!(&agents.as_bytes()[..owner.len()], owner);
        assert!(agents.contains("Delegate: ON"));
        let claude = std::fs::read_to_string(root.path().join(CLAUDE_FILE_NAME)).unwrap();
        assert!(claude.starts_with(CREATED_FILE_HEADER));
        assert!(claude.contains("Delegate: ON"));

        let agents_after = std::fs::read(root.path().join(AGENTS_FILE_NAME)).unwrap();
        let claude_after = std::fs::read(root.path().join(CLAUDE_FILE_NAME)).unwrap();
        assert!(!write_session_policy_brief(root.path(), "ws-1").unwrap());
        assert_eq!(
            agents_after,
            std::fs::read(root.path().join(AGENTS_FILE_NAME)).unwrap()
        );
        assert_eq!(
            claude_after,
            std::fs::read(root.path().join(CLAUDE_FILE_NAME)).unwrap()
        );
    }

    #[test]
    fn resetting_policy_removes_blocks_and_only_deletes_empty_drogon_files() {
        let root = tempfile::tempdir().unwrap();
        let owner = b"# Owner content survives\n";
        std::fs::write(root.path().join(AGENTS_FILE_NAME), owner).unwrap();
        configure_policy(
            root.path(),
            &GraphPolicy {
                delegate: true,
                ..GraphPolicy::default()
            },
        );
        write_session_policy_brief(root.path(), "ws-1").unwrap();
        assert!(root.path().join(CLAUDE_FILE_NAME).exists());

        reset_policy(root.path());
        assert!(write_session_policy_brief(root.path(), "ws-1").unwrap());
        assert_eq!(
            std::fs::read(root.path().join(AGENTS_FILE_NAME)).unwrap(),
            owner
        );
        assert!(!root.path().join(CLAUDE_FILE_NAME).exists());

        let agents_after = std::fs::read(root.path().join(AGENTS_FILE_NAME)).unwrap();
        assert!(!write_session_policy_brief(root.path(), "ws-1").unwrap());
        assert_eq!(
            agents_after,
            std::fs::read(root.path().join(AGENTS_FILE_NAME)).unwrap()
        );
    }

    #[test]
    fn resetting_policy_preserves_owner_trailing_bytes() {
        for owner in ["owner", "owner\n", "owner\n\n"] {
            let root = tempfile::tempdir().unwrap();
            std::fs::write(root.path().join(AGENTS_FILE_NAME), owner).unwrap();
            configure_policy(
                root.path(),
                &GraphPolicy {
                    delegate: true,
                    ..GraphPolicy::default()
                },
            );
            write_session_policy_brief(root.path(), "ws-1").unwrap();
            reset_policy(root.path());
            write_session_policy_brief(root.path(), "ws-1").unwrap();
            assert_eq!(
                std::fs::read_to_string(root.path().join(AGENTS_FILE_NAME)).unwrap(),
                owner
            );
        }
    }
}
