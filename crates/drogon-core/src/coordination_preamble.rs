//! Deterministic dispatch preamble text for `orchestration.dispatchShow`.
// MIT Copyright (c) 2026 Lovecast Inc.
// Source: src/main/runtime/orchestration/preamble.ts (buildDispatchPreamble),
// adapted: the worker-facing commands name the native CLI binary and scope
// flags; nesting guidance follows the native worker-start surface.

use drogon_protocol::orchestration_scope::CoordinatorScope;

/// The preamble a dispatched worker receives as its first input. Regenerated
/// from the task spec and the (real or preview) dispatch id, so a
/// `dispatch-show --preamble` preview matches what a dispatch would inject.
pub(crate) fn build_dispatch_preamble(
    scope: &CoordinatorScope,
    task_id: &str,
    dispatch_id: Option<&str>,
) -> String {
    build_dispatch_preamble_with_capability(
        scope,
        task_id,
        dispatch_id.unwrap_or("ctx_preview"),
        None,
    )
}

/// Shared builder taking the real dispatch id plus the minted dispatch
/// capability, if any (source `capabilityFlag`). Dry-run preview and real
/// dispatch build through this one function so the text is identical for a
/// given dispatch id and capability.
pub(crate) fn build_dispatch_preamble_with_capability(
    scope: &CoordinatorScope,
    task_id: &str,
    dispatch_id: &str,
    capability: Option<&str>,
) -> String {
    let capability_line = capability.map(|secret| {
        format!(
            "\nYour dispatch credential flag (append to every CLI call above):\n  --dispatch-capability {secret}\n"
        )
    });
    let capability_line = capability_line.as_deref().unwrap_or("");
    let scope_flags = format!(
        "--run {} --coordinator-id {} --consumer-generation {}",
        scope.run_id, scope.coordinator_id, scope.consumer_generation
    );
    format!(
        "You are working inside Drogon, a multi-agent workspace. You are a dispatched worker.
Your task ID is: {task_id}
Your dispatch ID is: {dispatch_id}

You talk to the coordinator only through the CLI commands below. Do not use
any other channel to reach a human during the run.

=== CLI COMMANDS ===

  # Report the terminal task outcome (REQUIRED exactly once).
  #
  # RULE: --body must be a 3-sentence executive summary (what you did,
  # what you found, what's left). Never send an empty body.
  # RULE: send worker_done exactly once. Use --outcome succeeded when the
  # requested work is done, or --outcome failed when it is not.
  drogon-cli orchestration send --type worker_done --subject \"<short status>\" \\
    --body \"<3-sentence summary: what you did, what you found, what's left>\" \\
    --task-id {task_id} --dispatch-id {dispatch_id} --outcome succeeded

  # Send a heartbeat every 5 minutes while actively working. Skip heartbeats
  # only while blocked inside `check --wait` or `ask` — those calls are
  # themselves liveness signals. Include BOTH taskId and dispatchId so a
  # straggler from a previously-failed dispatch cannot mask a hung retry.
  drogon-cli orchestration send --type heartbeat --subject \"alive\" \\
    --task-id {task_id} --dispatch-id {dispatch_id} \\
    --phase \"<short: investigating|implementing|reviewing|waiting>\"

  # Ask the coordinator a question and block until answered. If the call
  # times out or disconnects, resume with the returned message ID instead
  # of creating a duplicate question.
  drogon-cli orchestration ask --question \"<your question>\" --timeout-ms 600000

  # Escalate a blocker or failure (pre-completion):
  drogon-cli orchestration send --type escalation --subject \"Blocked: <reason>\" \\
    --body \"<details>\" --task-id {task_id} --dispatch-id {dispatch_id}

  # Check for messages from the coordinator:
  drogon-cli orchestration check --wait

=== AFTER YOU SEND worker_done ===

worker_done ends your turn for this task. Your dispatched work is complete:
stop and take no further actions — do NOT start new or unrelated work,
do NOT run a sleep/poll loop, and do NOT keep calling
`drogon-cli orchestration check`. The coordinator has already recorded your
completion and expects no further output.

A direct instruction from the user takes precedence over this idle rule.
Treat it as new user-owned work: follow it without coordinator approval or a
fresh Dispatch, and do not send lifecycle messages using the settled task or
Dispatch IDs. Never refuse a direct user request because you were a worker.

Coordinator scope for inspections when you need it: {scope_flags}
{capability_line}"
    )
}
