//! Structured context delivered to harnesses launched by Drogon.
//!
//! This is deliberately prompt text, not a context file: #491 says a workspace
//! with no configured Work Graph policy must not acquire a new `AGENTS.md` or
//! `CLAUDE.md`. Keeping the renderer pure also gives worker-start and ordinary
//! harness-start one contract to test without launching a model.

use std::path::Path;

use drogon_protocol::graph::GraphPolicy;
use serde_json::Value;

use crate::error;

pub(crate) const WORKER_BRIEF_MARKER: &str = "=== DROGON WORKER BRIEF ===";
pub(crate) const HARNESS_CONTEXT_MARKER: &str = "=== DROGON RUNTIME CONTEXT ===";

/// Renders the exact first-turn contract for a native orchestration worker.
///
/// `instructions` is inserted verbatim. The labels around it are intentionally
/// stable so a harness can distinguish task-authored text from the service's
/// authority and reporting instructions.
#[allow(clippy::too_many_arguments)]
pub(crate) fn compose_worker_brief(
    objective: &str,
    scope_paths: &str,
    instructions: &str,
    workspace_path: &Path,
    run_id: &str,
    task_id: &str,
    dispatch_id: &str,
    cli_command: &str,
    policy: &GraphPolicy,
) -> String {
    let policy_text = render_policy(policy);
    format!(
        "{WORKER_BRIEF_MARKER}\n\
Objective: {objective}\n\
Scope / paths:\n{scope_paths}\n\
Exact instructions (verbatim):\n{instructions}\n\
Drogon orchestration context:\n\
- Workspace path: {}\n\
- Run ID: {run_id}\n\
- Task ID: {task_id}\n\
- Dispatch ID: {dispatch_id}\n\
- Coordinator CLI: {cli_command}\n\
- Worker authority is limited to this dispatch; do not impersonate a coordinator or start an internal/invisible subagent.\n\
Runtime policy for any child dispatch (approved order, then fallback):\n{policy_text}\n\
Reporting contract (mandatory):\n\
- Use the Drogon CLI on PATH (`DROGON_CLI_COMMAND` when set), never a harness-internal Agent/delegation tool.\n\
- Send progress with `drogon-cli orchestration send --kind status --subject <TEXT> --body <TEXT>`.\n\
- If blocked, ask the coordinator with `drogon-cli orchestration ask --question <TEXT>` and resume the same question after a timeout; do not silently poll a PTY.\n\
- When the task is finished, send exactly one `drogon-cli orchestration send --kind worker_done --outcome succeeded|failed --subject <TEXT> --body <TEXT>`. Keep `--body` last; the CLI joins all remaining shell words, so a long report needs no Python argv wrapper. The `worker_done` alias is Drogon's `final-report`; the dispatch environment supplies run/task/dispatch scope and the private credential.\n\
- Include the outcome, concise result, modified files, and any artifact path in that final report. Do not send a second final report.\n\
Work only inside the assigned workspace and end this turn after the final report.\n",
        workspace_path.display()
    )
}

/// Renders context for an ordinary `harness.start`, including an empty-policy
/// default. This is injected through the launch request rather than a managed
/// workspace file, so it is present on turn one without violating #491.
pub(crate) fn compose_harness_context(
    workspace_id: &str,
    workspace_path: &Path,
    policy: &GraphPolicy,
) -> String {
    format!(
        "{HARNESS_CONTEXT_MARKER}\n\
You are running inside Drogon, workspace {workspace_id}, at {}.\n\
Drogon is the source of truth for delegation and orchestration. For any subagent or worker, use the `drogon-cli` executable supplied by this session, not an internal Agent tool and not a raw harness session.\n\
Before delegating, read the version-matched guide with `drogon-cli skills get --topic orchestration`; use its existing `run-create`, `task-create`, `worker-start`, `send`, `ask`, `check`, and `reply` verbs. A child must report through `drogon-cli orchestration send --kind worker_done` (the `final-report` alias), not only in a terminal buffer. Wait for a child in the foreground — `drogon-cli orchestration check --wait --timeout-ms <ms>`, repeated until its worker_done arrives — never in a background task and never by ending your turn: this session ends when your turn ends, and a backgrounded wait dies with it.\n\
The Work Graph policy for child runtimes is:\n{}\n\
Use approved runtimes in order and the configured fallback only after them. Provider and model are an inseparable pair from that policy; never guess a provider for an ambiguous model id. With no configured policy, Drogon does not choose a model for the user: an explicitly requested child must name its harness and model (and provider when applicable). Do not create or modify `AGENTS.md` or `CLAUDE.md` merely to deliver this context.\n",
        workspace_path.display(),
        render_policy(policy)
    )
}

/// Prefixes a user prompt for harnesses without a portable system-prompt flag.
pub(crate) fn prefix_user_prompt(context: &str, prompt: Option<&str>) -> String {
    match prompt {
        Some(prompt) => format!("{context}\nUser task:\n{prompt}"),
        None => context.to_string(),
    }
}

/// Extracts optional author-provided scope/path metadata without making the
/// metadata shape part of the orchestration wire contract. Unknown metadata is
/// ignored; the registered workspace remains the safe, honest default.
pub(crate) fn task_scope_paths(metadata: Option<&Value>, workspace_path: &Path) -> String {
    let Some(object) = metadata.and_then(Value::as_object) else {
        return workspace_path.display().to_string();
    };
    for key in ["scope", "paths"] {
        if let Some(value) = object.get(key) {
            let rendered = match value {
                Value::String(text) if !text.trim().is_empty() => text.clone(),
                Value::Array(values) => values
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                    .map(|text| format!("- {text}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                _ => String::new(),
            };
            if !rendered.is_empty() {
                return rendered;
            }
        }
    }
    workspace_path.display().to_string()
}

fn render_policy(policy: &GraphPolicy) -> String {
    let approved = policy
        .approved_runtimes
        .iter()
        .enumerate()
        .map(|(index, runtime)| format!("- approved {}: {}", index + 1, runtime_label(runtime)))
        .collect::<Vec<_>>();
    let mut lines = if approved.is_empty() {
        vec!["- approved: none configured".into()]
    } else {
        approved
    };
    if let Some(fallback) = &policy.fallback_runtime {
        lines.push(format!("- fallback: {}", runtime_label(fallback)));
    } else {
        lines.push("- fallback: none".into());
    }
    lines.push(format!(
        "- mode: {}",
        if policy.delegate {
            "delegate"
        } else if policy.adversarial.enabled {
            "adversarial"
        } else {
            "direct"
        }
    ));
    lines.join("\n")
}

fn runtime_label(runtime: &drogon_protocol::graph::GraphRuntimeRef) -> String {
    let provider = runtime
        .provider
        .as_deref()
        .map(|value| format!(" provider={value}"))
        .unwrap_or_default();
    let model = if runtime.model.is_empty() {
        "<harness default>"
    } else {
        runtime.model.as_str()
    };
    format!("harness={} model={model}{provider}", runtime.harness)
}

/// Builds a service error with the same bounded-text vocabulary as the launch
/// path. Kept here so callers cannot accidentally accept a NUL-bearing prompt
/// while composing context.
pub(crate) fn validate_context_text(text: &str) -> Result<(), drogon_protocol::RpcError> {
    if text.is_empty() || text.len() > 32_768 || text.contains('\0') {
        return Err(error::invalid_argument(
            "Drogon launch context is empty, too long, or contains NUL.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use drogon_protocol::graph::{GraphPolicy, GraphRuntimeRef};
    use serde_json::json;

    #[test]
    fn worker_brief_has_contract_fields_and_verbatim_task_text() {
        let instructions = "Keep the exact markers \u{2713}\nand inspect src/lib.rs.";
        let policy = GraphPolicy {
            approved_runtimes: vec![GraphRuntimeRef {
                harness: "pi".into(),
                model: "gpt-5.6-luna".into(),
                provider: Some("openai-codex".into()),
            }],
            fallback_runtime: Some(GraphRuntimeRef {
                harness: "pi".into(),
                model: "qwen3.8-flash-next-nvidia-nvfp4".into(),
                provider: None,
            }),
            ..GraphPolicy::default()
        };
        let brief = compose_worker_brief(
            "Ship the feature",
            "- crates/drogon-core\n- crates/drogon-cli",
            instructions,
            Path::new("/tmp/workspace"),
            "run-1",
            "task-1",
            "dispatch-1",
            "/tmp/drogon-cli",
            &policy,
        );
        for field in [
            "Objective: Ship the feature",
            "Scope / paths:",
            "Exact instructions (verbatim):",
            "Run ID: run-1",
            "Task ID: task-1",
            "Dispatch ID: dispatch-1",
            "worker_done",
            "orchestration ask",
            "provider=openai-codex",
        ] {
            assert!(brief.contains(field), "brief missing {field:?}: {brief}");
        }
        assert!(brief.contains(instructions));
        assert_eq!(brief.matches("worker_done").count(), 2);
    }

    #[test]
    fn scope_metadata_is_optional_and_paths_are_bounded_to_known_shapes() {
        assert_eq!(
            task_scope_paths(
                Some(&json!({"paths": ["src/a.rs", "src/b.rs"]})),
                Path::new("/workspace")
            ),
            "- src/a.rs\n- src/b.rs"
        );
        assert_eq!(
            task_scope_paths(Some(&json!({"other": true})), Path::new("/workspace")),
            "/workspace"
        );
    }

    #[test]
    fn context_is_prompt_delivered_without_touching_workspace_files() {
        let context =
            compose_harness_context("ws-1", Path::new("/workspace"), &GraphPolicy::default());
        let prompt = prefix_user_prompt(&context, Some("delega un subagente"));
        assert!(prompt.starts_with(HARNESS_CONTEXT_MARKER));
        assert!(prompt.contains("drogon-cli"));
        assert!(prompt.contains("delega un subagente"));
        assert!(prompt.contains("Wait for a child in the foreground"));
        assert!(prompt.contains("approved: none configured"));
        assert!(prompt.contains("does not choose a model for the user"));
        assert!(!prompt.to_lowercase().contains("qwen"));
        assert!(prompt.contains("check --wait --timeout-ms <ms>"));
    }
}
