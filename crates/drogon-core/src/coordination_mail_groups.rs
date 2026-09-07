//! Native `SendTarget::Group` expansion: bounded, transactional fanout to
//! every current, unfenced dispatch attempt in the sender's own host/run
//! matching a group selector. Root wires this into `commit_send`'s Group
//! arm (`coordination_mail_rpc.rs`) in place of the earlier
//! `invalid_argument` stub; this module never opens a connection or
//! transaction of its own and mints no identity beyond message ids.
//!
//! Group name grammar and `@all`/`@idle`/`@<agent>`/`@worktree:<id>`
//! semantics are pinned to the read-only migration reference at revision
//! `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
//! (`src/main/runtime/orchestration/groups.ts`). Differences from that
//! source, all required by the native attempt/attempt-authority model
//! rather than invented:
//!
//! - Membership is drawn from the sender's own host/run's *current,
//!   unfenced* `orchestration_attempts` rows, not from live terminals —
//!   there is no terminal registry in this domain.
//! - `@idle` has no native equivalent (no TUI idle-status signal reaches
//!   this layer) and is refused with `unsupported_feature`, never guessed
//!   from `AssignmentState` or pending-question state.
//! - A recognized selector with zero current matches is `not_found`
//!   (source: `resolveBareOrchestrationRecipient`/`sendGroupMessage`
//!   throwing when no recipient resolves), while a selector name that
//!   matches none of `all`/`idle`/`worktree:<id>`/the nine agent-name
//!   groups is `unsupported_feature` — the two are kept distinct so a
//!   caller can tell "valid group, nobody home" from "no such group".
//!
//! One `append_message_in_tx` call per matched member, all inside the
//! caller's single transaction (never one transaction per member — a
//! partial fanout must never commit), exactly as
//! `coordination_mail_domain`'s "root's fanout responsibility" note
//! requires.

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_mail::*;
use drogon_protocol::orchestration_scope::CoordinatorScope;
use rusqlite::{Transaction, params};
use serde_json::Value;

use crate::coordination_attempts::Attempt;
use crate::coordination_mail::{
    self, Actor as MailActor, NewMessage, Recipient as MailRecipient, questions,
};
use crate::error;

/// Same cap as the delivery-side `MAX_MAIL_BATCH`: a group send is bounded
/// to a small, human-reviewable fanout, never an unbounded broadcast.
const MAX_GROUP_RECIPIENTS: usize = drogon_protocol::orchestration_common::MAX_MAIL_BATCH;

/// Defensive ceiling on one stored attempt's `state_json` read during group
/// scan, well under the mail response budget; a legitimate attempt record
/// is a few hundred bytes, not tens of kilobytes.
const MAX_ATTEMPT_STATE_BYTES: usize = 64 * 1024;

const WORKTREE_PREFIX: &str = "worktree:";

/// Source `AGENT_NAME_GROUPS` -> `GROUP_AGENT_IDS`. Every entry maps to
/// itself except `mimo`, whose published agent id is `mimo-code` (matches
/// `drogon-harness::known_tui_agents::KNOWN_TUI_AGENT_IDS`).
fn agent_group_harness_id(lower_name: &str) -> Option<&'static str> {
    Some(match lower_name {
        "claude" => "claude",
        "openclaude" => "openclaude",
        "codex" => "codex",
        "opencode" => "opencode",
        "mimo" => "mimo-code",
        "gemini" => "gemini",
        "droid" => "droid",
        "grok" => "grok",
        "cursor" => "cursor",
        _ => return None,
    })
}

#[derive(Debug, PartialEq, Eq)]
enum GroupSelector<'a> {
    All,
    Worktree(&'a str),
    Harness(&'static str),
}

/// Accepts a leading `@` or its absence (the CLI's `group:` prefix already
/// strips one layer; the source wire always carried the `@`). Keyword
/// matching (`all`/`idle`/`worktree:`/agent names) case-folds exactly like
/// the source's `to.toLowerCase()`; a `worktree:<id>` id is sliced from the
/// *original*-case string, matching the source's `to.slice(...)` (not the
/// lowercased copy) so the id itself is never case-mangled.
fn resolve_selector(name: &str) -> Result<GroupSelector<'_>, RpcError> {
    let unprefixed = name.strip_prefix('@').unwrap_or(name);
    let lower = unprefixed.to_ascii_lowercase();
    if lower == "all" {
        return Ok(GroupSelector::All);
    }
    if lower == "idle" {
        return Err(RpcError::new(
            "unsupported_feature",
            "Group @idle has no native idle-status signal and is refused rather than guessed.",
        ));
    }
    if let Some(rest) = lower.strip_prefix(WORKTREE_PREFIX) {
        if rest.is_empty() {
            return Err(error::invalid_argument(
                "Group @worktree: requires a workspace id.",
            ));
        }
        // Same byte length as `lower`'s prefix (ASCII-only prefix), so
        // slicing the original preserves the id's exact case.
        return Ok(GroupSelector::Worktree(
            &unprefixed[WORKTREE_PREFIX.len()..],
        ));
    }
    if let Some(harness_id) = agent_group_harness_id(&lower) {
        return Ok(GroupSelector::Harness(harness_id));
    }
    Err(RpcError::new(
        "unsupported_feature",
        format!("Group address '{name}' is not a supported selector."),
    ))
}

fn matches_selector(attempt: &Attempt, selector: &GroupSelector<'_>) -> bool {
    match selector {
        GroupSelector::All => true,
        GroupSelector::Worktree(id) => attempt.result.workspace_id == *id,
        GroupSelector::Harness(harness_id) => attempt.launch.harness_id == *harness_id,
    }
}

/// Bounded, ordered (by admission sequence) scan of the run's current,
/// unfenced attempts. Fails closed -- before decoding anything further --
/// if there are more than `MAX_GROUP_RECIPIENTS`, exactly like
/// `coordination_attempts::history`'s 500-row bound.
fn scan_current_unfenced_attempts_in_tx(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
) -> Result<Vec<Attempt>, RpcError> {
    let mut statement = tx
        .prepare(
            "SELECT dispatch_id, task_id,
               CASE WHEN length(CAST(state_json AS BLOB)) <= ?4 THEN state_json END
             FROM orchestration_attempts
             WHERE host_id = ?1 AND run_id = ?2 AND is_current = 1 AND fenced = 0
             ORDER BY sequence LIMIT ?3",
        )
        .map_err(error::from_sqlite)?;
    let rows = statement
        .query_map(
            params![
                scope.host.host_id,
                scope.run_id,
                (MAX_GROUP_RECIPIENTS + 1) as i64,
                MAX_ATTEMPT_STATE_BYTES as i64
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .map_err(error::from_sqlite)?;
    let mut attempts = Vec::new();
    for row in rows {
        if attempts.len() == MAX_GROUP_RECIPIENTS {
            return Err(RpcError::new(
                "result_too_large",
                "Too many current attempts to safely expand a group address.",
            ));
        }
        let (dispatch_id, task_id, state_json) = row.map_err(error::from_sqlite)?;
        let state_json = state_json.ok_or_else(|| {
            RpcError::new(
                "result_too_large",
                "Stored attempt state exceeds the bounded group-scan read size.",
            )
        })?;
        let attempt: Attempt = serde_json::from_str(&state_json)
            .map_err(|_| error::internal_error("Invalid stored attempt state."))?;
        if attempt.result.dispatch_id != dispatch_id
            || attempt.result.run_id != scope.run_id
            || attempt.result.task_id != task_id
        {
            return Err(error::internal_error(
                "Stored attempt identity is inconsistent.",
            ));
        }
        attempts.push(attempt);
    }
    Ok(attempts)
}

/// Matching members, sender excluded, in scan (admission) order -- a
/// stable, reproducible fanout order for the same underlying state.
fn expand_members(
    attempts: &[Attempt],
    selector: &GroupSelector<'_>,
    sender_dispatch_id: Option<&str>,
) -> Vec<String> {
    attempts
        .iter()
        .filter(|attempt| attempt.outcome.is_none())
        .filter(|attempt| matches_selector(attempt, selector))
        .map(|attempt| attempt.result.dispatch_id.clone())
        .filter(|dispatch_id| Some(dispatch_id.as_str()) != sender_dispatch_id)
        .collect()
}

fn new_message_id() -> String {
    format!("msg_{}", uuid::Uuid::new_v4())
}

/// Full `orchestration.send` handling for a `SendTarget::Group` params
/// value: resolve the selector, expand membership, append one message per
/// member (correlating `question`-kind messages exactly like the
/// single-recipient path), and return the encoded batch `SendResult` --
/// all inside the caller's transaction. Root's `commit_send` calls this in
/// place of refusing `SendTarget::Group` outright.
pub(crate) fn send_group_in_tx(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    sender: &MailActor,
    params: &SendParams,
    origin_request_id: &str,
) -> Result<Value, RpcError> {
    let Some(SendTarget::Group { name }) = &params.to else {
        return Err(error::internal_error(
            "send_group_in_tx requires a group send target.",
        ));
    };
    // Already refused by `SendParams::validate_shape` before this is ever
    // reached (lifecycle kinds may only target the run home); kept here as
    // a defensive invariant, never as business logic of its own.
    if matches!(
        params.kind,
        MessageKind::Heartbeat | MessageKind::FinalReport
    ) {
        return Err(error::internal_error(
            "Lifecycle messages must never reach group fanout.",
        ));
    }
    let selector = resolve_selector(name)?;
    let sender_dispatch_id = match sender {
        MailActor::Dispatch(id) => Some(id.as_str()),
        MailActor::Coordinator(_) => None,
    };
    let attempts = scan_current_unfenced_attempts_in_tx(tx, scope)?;
    let members = expand_members(&attempts, &selector, sender_dispatch_id);
    if members.is_empty() {
        return Err(error::not_found(format!(
            "No current recipient matched group address '{name}'."
        )));
    }
    let created_at = crate::now_rfc3339();
    let mut receipts = Vec::with_capacity(members.len());
    for dispatch_id in &members {
        let message_id = new_message_id();
        let recipient = MailRecipient::Dispatch(dispatch_id.clone());
        let summary = coordination_mail::append_message_in_tx(
            tx,
            NewMessage {
                message_id: &message_id,
                host_id: &scope.host.host_id,
                run_id: &scope.run_id,
                kind: params.kind,
                from: sender,
                to: &recipient,
                subject: &params.subject,
                body: params.body.as_deref(),
                payload: params.payload.as_ref(),
                thread_id: params.thread_id.as_deref(),
                origin_request_id,
                created_at: &created_at,
            },
        )?;
        if params.kind == MessageKind::Question {
            // A generic `send` of a question must correlate atomically with
            // its own message insert, exactly like the single-recipient
            // path and the dedicated `ask` path, or a later `reply`/resume
            // finds the message but no correlation row.
            let thread_id = summary.thread_id.clone().ok_or_else(|| {
                error::internal_error("A question message must carry a thread id.")
            })?;
            questions::correlate_question_in_tx(
                tx,
                &scope.host.host_id,
                &scope.run_id,
                &message_id,
                &thread_id,
            )?;
        }
        receipts.push(MessageReceipt {
            message_id: summary.message_id.clone(),
            sequence: Some(summary.sequence),
            run_id: Some(scope.run_id.clone()),
        });
    }
    let batch = SendBatchResult {
        recipients: receipts.len() as u32,
        messages: receipts,
    };
    let result = SendResult {
        message: None,
        batch: Some(batch),
        lifecycle: None,
        duplicate: None,
        warnings: vec![],
    };
    // Belt-and-suspenders: with <= 50 small receipts this never fires, but
    // the result is still checked against the same budget every other mail
    // response honors, rather than assumed safe by construction.
    let wire_bytes = serde_json::to_vec(&result)
        .map_err(|_| error::internal_error("Group send result is not serializable."))?
        .len();
    if wire_bytes > coordination_mail::RESPONSE_BUDGET_BYTES {
        return Err(RpcError::new(
            "result_too_large",
            "Group send result exceeds the response budget.",
        ));
    }
    crate::coordination_runs::encode(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coordination_attempts;
    use drogon_protocol::orchestration_common::{
        AssignmentState, LaunchPermissionMode, LaunchPreferences, ProcessVerdict,
        ReadinessObservation,
    };
    use drogon_protocol::orchestration_scope::HostScope;
    use drogon_protocol::orchestration_worker::WorkerStartResult;
    use rusqlite::{Connection, OptionalExtension};

    fn scope() -> CoordinatorScope {
        CoordinatorScope {
            host: HostScope {
                contract_version: 1,
                host_id: "host-a".into(),
            },
            run_id: "run-a".into(),
            coordinator_id: "owner".into(),
            consumer_generation: 1,
        }
    }

    fn attempt(dispatch_id: &str, task_id: &str, harness_id: &str, workspace_id: &str) -> Attempt {
        Attempt {
            result: WorkerStartResult {
                run_id: "run-a".into(),
                task_id: task_id.into(),
                dispatch_id: dispatch_id.into(),
                consumer_generation: 1,
                workspace_id: workspace_id.into(),
                assignment_state: AssignmentState::Admitting,
                readiness: ReadinessObservation::NotObserved,
                process_verdict: ProcessVerdict::Unverifiable,
                session_identity: None,
                effects: vec![],
                residual_resources: vec![],
                failure: None,
                warning: None,
            },
            launch: LaunchPreferences {
                harness_id: harness_id.into(),
                model: None,
                effort: None,
                provider: None,
                permission_mode: LaunchPermissionMode::Inherit,
            },
            outcome: None,
            report_message_id: None,
            report_result: None,
            cleanup_owned: true,
        }
    }

    fn database() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        coordination_mail::migrate_in_tx(&tx).unwrap();
        coordination_attempts::migrate(&tx).unwrap();
        tx.commit().unwrap();
        conn
    }

    fn admit(
        tx: &Transaction<'_>,
        dispatch_id: &str,
        task_id: &str,
        harness_id: &str,
        workspace_id: &str,
    ) {
        coordination_attempts::admit(
            tx,
            &scope(),
            &attempt(dispatch_id, task_id, harness_id, workspace_id),
            None,
        )
        .unwrap();
    }

    fn send_params(kind: MessageKind, to: &str) -> SendParams {
        SendParams {
            scope: drogon_protocol::orchestration_common::ActorScope::Coordinator(scope()),
            kind,
            to: Some(SendTarget::Group { name: to.into() }),
            subject: "s".into(),
            body: Some("b".into()),
            payload: None,
            thread_id: None,
            final_report: None,
        }
    }

    #[test]
    fn selector_accepts_at_prefix_or_its_absence_and_lowercases_keywords() {
        assert_eq!(resolve_selector("all").unwrap(), GroupSelector::All);
        assert_eq!(resolve_selector("@ALL").unwrap(), GroupSelector::All);
        assert_eq!(
            resolve_selector("@Codex").unwrap(),
            GroupSelector::Harness("codex")
        );
        assert_eq!(
            resolve_selector("MIMO").unwrap(),
            GroupSelector::Harness("mimo-code")
        );
    }

    #[test]
    fn idle_is_always_unsupported_never_inferred() {
        for name in ["idle", "@idle", "@IDLE"] {
            assert_eq!(
                resolve_selector(name).unwrap_err().code,
                "unsupported_feature"
            );
        }
    }

    #[test]
    fn worktree_prefix_matches_case_insensitively_but_preserves_id_case() {
        assert_eq!(
            resolve_selector("@WORKTREE:AbC-123").unwrap(),
            GroupSelector::Worktree("AbC-123")
        );
        assert_eq!(
            resolve_selector("worktree:").unwrap_err().code,
            "invalid_argument"
        );
    }

    #[test]
    fn unknown_selector_is_unsupported_feature_not_silent_empty() {
        assert_eq!(
            resolve_selector("kimi").unwrap_err().code,
            "unsupported_feature"
        );
    }

    #[test]
    fn group_send_fans_out_to_all_current_unfenced_attempts_excluding_sender() {
        let mut conn = database();
        let tx = conn.transaction().unwrap();
        admit(&tx, "sender", "task-sender", "codex", "ws-a");
        admit(&tx, "member-1", "task-1", "codex", "ws-a");
        admit(&tx, "member-2", "task-2", "claude", "ws-b");
        coordination_attempts::fence(&tx, &scope(), "member-2", AssignmentState::Stopped).unwrap();
        admit(&tx, "member-3", "task-3", "opencode", "ws-c");

        let sender = MailActor::Dispatch("sender".into());
        let params = send_params(MessageKind::Status, "all");
        let result = send_group_in_tx(&tx, &scope(), &sender, &params, "req-1").unwrap();
        assert_eq!(result["batch"]["recipients"], 2);
        let ids: Vec<String> = result["batch"]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["messageId"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids.len(), 2);
        // member-2 was fenced (stopped) and must not receive the broadcast.
        let delivered_to_fenced: Option<String> = tx
            .query_row(
                "SELECT message_id FROM orchestration_mail_messages WHERE to_dispatch_id='member-2'",
                [],
                |r| r.get(0),
            )
            .optional()
            .unwrap();
        assert!(delivered_to_fenced.is_none());
    }

    #[test]
    fn group_send_selects_by_harness_and_by_worktree() {
        let mut conn = database();
        let tx = conn.transaction().unwrap();
        admit(&tx, "sender", "task-sender", "codex", "ws-a");
        admit(&tx, "codex-1", "task-1", "codex", "ws-a");
        admit(&tx, "claude-1", "task-2", "claude", "ws-b");
        admit(&tx, "codex-2", "task-3", "codex", "ws-b");

        // A coordinator sender is never itself a dispatch attempt, so
        // nothing is excluded from its own broadcast: all three "codex"
        // attempts (including the one named "sender") match.
        let sender = MailActor::Coordinator("owner".into());
        let harness_params = send_params(MessageKind::Status, "@codex");
        let harness_result =
            send_group_in_tx(&tx, &scope(), &sender, &harness_params, "req-h").unwrap();
        assert_eq!(harness_result["batch"]["recipients"], 3);

        let worktree_params = send_params(MessageKind::Status, "worktree:ws-b");
        let worktree_result =
            send_group_in_tx(&tx, &scope(), &sender, &worktree_params, "req-w").unwrap();
        assert_eq!(worktree_result["batch"]["recipients"], 2);
    }

    #[test]
    fn group_send_refuses_unsupported_and_empty_selectors() {
        let mut conn = database();
        let tx = conn.transaction().unwrap();
        admit(&tx, "sender", "task-sender", "codex", "ws-a");

        let sender = MailActor::Dispatch("sender".into());
        let unsupported = send_params(MessageKind::Status, "kimi");
        assert_eq!(
            send_group_in_tx(&tx, &scope(), &sender, &unsupported, "req-u")
                .unwrap_err()
                .code,
            "unsupported_feature"
        );

        // Only the sender itself matches "all"; excluding it leaves nobody.
        let empty = send_params(MessageKind::Status, "all");
        assert_eq!(
            send_group_in_tx(&tx, &scope(), &sender, &empty, "req-e")
                .unwrap_err()
                .code,
            "not_found"
        );
    }

    #[test]
    fn group_send_is_scoped_to_its_own_host_and_run() {
        let mut conn = database();
        let tx = conn.transaction().unwrap();
        admit(&tx, "sender", "task-sender", "codex", "ws-a");
        admit(&tx, "same-run-member", "task-1", "codex", "ws-a");
        // A different run's own attempt table row (different host_id/run_id
        // pair) never counts toward this scope's group, even sharing a
        // dispatch id namespace collision is irrelevant here since inserts
        // are scoped by host/run already.
        let other_scope = CoordinatorScope {
            host: HostScope {
                contract_version: 1,
                host_id: "host-b".into(),
            },
            run_id: "run-b".into(),
            coordinator_id: "owner".into(),
            consumer_generation: 1,
        };
        let mut other_attempt = attempt("other-run-member", "task-x", "codex", "ws-a");
        other_attempt.result.run_id = "run-b".into();
        coordination_attempts::admit(&tx, &other_scope, &other_attempt, None).unwrap();

        let sender = MailActor::Dispatch("sender".into());
        let params = send_params(MessageKind::Status, "all");
        let result = send_group_in_tx(&tx, &scope(), &sender, &params, "req-iso").unwrap();
        assert_eq!(result["batch"]["recipients"], 1);
    }

    #[test]
    fn group_send_caps_recipients_and_correlates_questions() {
        let mut conn = database();
        let tx = conn.transaction().unwrap();
        admit(&tx, "sender", "task-sender", "codex", "ws-a");
        for index in 0..MAX_GROUP_RECIPIENTS {
            admit(
                &tx,
                &format!("member-{index}"),
                &format!("task-{index}"),
                "codex",
                "ws-a",
            );
        }
        let sender = MailActor::Dispatch("sender".into());
        let over_cap = send_params(MessageKind::Status, "all");
        assert_eq!(
            send_group_in_tx(&tx, &scope(), &sender, &over_cap, "req-cap")
                .unwrap_err()
                .code,
            "result_too_large"
        );

        // Trim to exactly the cap and confirm a question fans out with a
        // correlation row per recipient.
        coordination_attempts::fence(
            &tx,
            &scope(),
            &format!("member-{}", MAX_GROUP_RECIPIENTS - 1),
            AssignmentState::Stopped,
        )
        .unwrap();
        let question = send_params(MessageKind::Question, "all");
        let result = send_group_in_tx(&tx, &scope(), &sender, &question, "req-q").unwrap();
        assert_eq!(result["batch"]["recipients"], MAX_GROUP_RECIPIENTS - 1);
        let correlated: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM orchestration_mail_questions",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(correlated as usize, MAX_GROUP_RECIPIENTS - 1);
    }
}
