//! Mail RPC surface: `orchestration.send`/`orchestration.check` for the
//! admin coordinator actor and the authenticated worker (dispatch) actor,
//! including a real bounded server-side wait for `check`'s unread mode.
//! `orchestration.ask`/`orchestration.reply` are dispatched from `lib.rs`
//! straight to root's `Engine::dispatch_coordination_question`; see the doc.

use drogon_orchestration::{runs, tasks};
use drogon_protocol::orchestration_common::{ActorScope, OpaqueCursor};
use drogon_protocol::orchestration_mail::*;
use drogon_protocol::orchestration_scope::{CoordinatorScope, HostScope};
use drogon_protocol::orchestration_task::TaskStatus;
use drogon_protocol::{Request, RpcError};
use rusqlite::Transaction;
use serde_json::Value;
use std::sync::atomic::Ordering;

use crate::coordination_access::{self, WorkerBinding};
use crate::coordination_attempts::{self as attempts, Settlement};
use crate::coordination_mail::{
    self, Actor as MailActor, NewMessage, Recipient as MailRecipient, delivery, questions,
};
use crate::coordination_receipts::worker_actor;
use crate::coordination_runs::{coordinator_actor, decode, encode};
use crate::{Engine, error};

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4())
}

/// What the lock-free pre-check loop observed before the one real,
/// ledger-atomic delivery attempt. Never itself the delivered answer --
/// only a hint for whether an empty result there means "timed out",
/// "shutdown interrupted" or "wait was never requested".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WaitObservation {
    NotRequested,
    Found,
    TimedOut,
    Cancelled,
}

/// `coordination_attempts`/`tasks` only read `host_id`/`run_id` off a
/// `CoordinatorScope` for the functions used here; a reporting dispatch has
/// no coordinator identity of its own, so this is host/run identity only.
fn attempt_scope_for_dispatch(binding: &WorkerBinding) -> CoordinatorScope {
    CoordinatorScope {
        host: HostScope {
            contract_version: drogon_protocol::orchestration_scope::COORDINATION_CONTRACT_VERSION,
            host_id: binding.host_id.clone(),
        },
        run_id: binding.run_id.clone(),
        coordinator_id: String::new(),
        consumer_generation: 1,
    }
}

impl Engine {
    pub(crate) fn dispatch_admin_mail(&self, request: &Request) -> Result<Value, RpcError> {
        match request.method.as_str() {
            "orchestration.send" => {
                let params: SendParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let ActorScope::Coordinator(scope) = params.scope.clone() else {
                    return Err(error::invalid_argument(
                        "The admin credential sends only as the coordinator.",
                    ));
                };
                let actor = coordinator_actor(&scope);
                self.coordination_mutation(
                    request,
                    actor,
                    |tx| runs::require_coordinator(tx, &scope),
                    |tx| {
                        let sender = MailActor::Coordinator(scope.coordinator_id.clone());
                        self.commit_send(tx, &scope, &sender, &params, &request.request_id)
                    },
                )
            }
            "orchestration.check" => {
                let params: CheckParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let ActorScope::Coordinator(scope) = params.scope.clone() else {
                    return Err(error::invalid_argument(
                        "The admin credential checks only as the coordinator.",
                    ));
                };
                self.dispatch_check_coordinator(request, scope, &params)
            }
            other => Err(error::method_not_found(other)),
        }
    }

    pub(crate) fn dispatch_worker_mail(
        &self,
        binding: &WorkerBinding,
        request: &Request,
    ) -> Result<Value, RpcError> {
        match request.method.as_str() {
            "orchestration.send" => {
                let params: SendParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let scope = attempt_scope_for_dispatch(binding);
                let actor = worker_actor(binding);
                let binding = binding.clone();
                self.coordination_mutation(
                    request,
                    actor,
                    |tx| {
                        coordination_access::recheck_in_tx(tx, &binding, &request.method)
                            .map(|_| ())
                    },
                    |tx| {
                        // Recheck inside the work transaction too: a settled-report
                        // credential (revoked) may only resend its own final report,
                        // never any other message kind.
                        let rechecked =
                            coordination_access::recheck_in_tx(tx, &binding, &request.method)?;
                        if rechecked.revoked && params.kind != MessageKind::FinalReport {
                            return Err(error::invalid_argument(
                                "A settled-report credential may only resend its own final report.",
                            ));
                        }
                        let sender = MailActor::Dispatch(binding.dispatch_id.clone());
                        self.commit_send(tx, &scope, &sender, &params, &request.request_id)
                    },
                )
            }
            "orchestration.check" => {
                let params: CheckParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.dispatch_check_worker(request, binding, &params)
            }
            other => Err(error::method_not_found(other)),
        }
    }

    /// Appends the message and, for a final report, settles the attempt,
    /// transitions the task, closes its pending questions and revokes its
    /// credential -- all in the caller's one transaction.
    fn commit_send(
        &self,
        tx: &Transaction<'_>,
        scope: &CoordinatorScope,
        sender: &MailActor,
        params: &SendParams,
        origin_request_id: &str,
    ) -> Result<Value, RpcError> {
        if self.quiescent.load(Ordering::Acquire) {
            return Err(error::runtime_busy(
                "service admission is frozen for shutdown",
            ));
        }
        let recipient = match &params.to {
            None | Some(SendTarget::RunHome) => MailRecipient::RunHome,
            Some(SendTarget::Dispatch { dispatch_id }) => {
                MailRecipient::Dispatch(dispatch_id.clone())
            }
            Some(SendTarget::Group { .. }) => {
                return crate::coordination_mail_groups::send_group_in_tx(
                    tx,
                    scope,
                    sender,
                    params,
                    origin_request_id,
                );
            }
        };
        if let MailRecipient::Dispatch(id) = &recipient {
            attempts::require_mail_recipient(tx, scope, id)?;
        }
        if params.kind != MessageKind::FinalReport {
            let message_id = new_id("msg");
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
                    created_at: &crate::now_rfc3339(),
                },
            )?;
            if params.kind == MessageKind::Question {
                // A generic `send` of a question must correlate atomically
                // with its own message insert, exactly like the dedicated
                // `ask` path, or a later `reply`/resume finds the message
                // but no correlation row and wrongly refuses it.
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
            return encode(SendResult {
                message: Some(MessageReceipt {
                    message_id: summary.message_id.clone(),
                    sequence: Some(summary.sequence),
                    run_id: Some(scope.run_id.clone()),
                }),
                batch: None,
                lifecycle: None,
                duplicate: None,
                warnings: vec![],
            });
        }
        let MailActor::Dispatch(dispatch_id) = sender else {
            return Err(error::invalid_argument(
                "Only the reporting dispatch may submit its final report.",
            ));
        };
        let final_report = params
            .final_report
            .as_ref()
            .ok_or_else(|| error::invalid_argument("Missing final report payload."))?;
        // Peek before writing anything: a new-request-id resend of an already
        // settled outcome must classify against the original message, never
        // append a new one; a conflicting outcome must be refused with no effect.
        let existing_attempt = attempts::show(tx, scope, dispatch_id)?;
        if let Some(prior_outcome) = existing_attempt.outcome {
            if prior_outcome != final_report.outcome {
                return Err(RpcError::new(
                    "report_conflict",
                    "Attempt already reported a different outcome.",
                ));
            }
            let original_message_id = existing_attempt.report_message_id.ok_or_else(|| {
                error::internal_error("Reported attempt has no message identity.")
            })?;
            let original = coordination_mail::get_message_in_tx(
                tx,
                &scope.host.host_id,
                &scope.run_id,
                &original_message_id,
            )?
            .ok_or_else(|| error::internal_error("Original report message is missing."))?;
            return encode(SendResult {
                message: Some(MessageReceipt {
                    message_id: original_message_id.clone(),
                    sequence: Some(original.summary.sequence),
                    run_id: Some(scope.run_id.clone()),
                }),
                batch: None,
                lifecycle: Some(LifecycleVerdict::Settled {
                    outcome: prior_outcome,
                    duplicate: true,
                }),
                duplicate: Some(DuplicateReportReceipt {
                    original_request_id: original.origin_request_id,
                    original_message_id: Some(original_message_id),
                }),
                warnings: vec![],
            });
        }
        // Fail before any write if the attempt was fenced (stopped/abandoned)
        // without ever reporting: settle() would reject it anyway, but only
        // after this call already wrote the message.
        attempts::require_current_unfenced(tx, scope, dispatch_id)?;
        let message_id = new_id("msg");
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
                created_at: &crate::now_rfc3339(),
            },
        )?;
        let message_receipt = MessageReceipt {
            message_id: summary.message_id.clone(),
            sequence: Some(summary.sequence),
            run_id: Some(scope.run_id.clone()),
        };
        match attempts::settle_with_result(
            tx,
            scope,
            dispatch_id,
            final_report.outcome,
            &message_id,
            final_report.result.as_ref(),
        )? {
            Settlement::New(attempt) => {
                let task_status = match final_report.outcome {
                    drogon_protocol::orchestration_common::ReportOutcome::Succeeded => {
                        TaskStatus::Completed
                    }
                    drogon_protocol::orchestration_common::ReportOutcome::Failed => {
                        TaskStatus::Failed
                    }
                };
                tasks::set_status_in_tx(
                    tx,
                    &scope.host.host_id,
                    &scope.run_id,
                    &attempt.result.task_id,
                    task_status,
                )?;
                coordination_access::revoke_in_tx(tx, dispatch_id, "reported")?;
                questions::close_dispatch_questions_in_tx(
                    tx,
                    &scope.host.host_id,
                    &scope.run_id,
                    dispatch_id,
                    "attempt reported",
                )?;
                encode(SendResult {
                    message: Some(message_receipt),
                    batch: None,
                    lifecycle: Some(LifecycleVerdict::Settled {
                        outcome: final_report.outcome,
                        duplicate: false,
                    }),
                    duplicate: None,
                    warnings: vec![],
                })
            }
            // Our peek above already handled the settled case; a fresh
            // settlement (outcome was None) cannot return Duplicate.
            Settlement::Duplicate { message_id } => Err(error::internal_error(format!(
                "Unexpected duplicate (message {message_id}) after fresh settlement."
            ))),
        }
    }

    fn dispatch_check_coordinator(
        &self,
        request: &Request,
        scope: CoordinatorScope,
        params: &CheckParams,
    ) -> Result<Value, RpcError> {
        let consumer = delivery::Consumer::Coordinator {
            coordinator_id: scope.coordinator_id.clone(),
            generation: scope.consumer_generation,
        };
        match &params.mode {
            CheckMode::Peek | CheckMode::All => self.coordination_read(|tx| {
                runs::require_coordinator(tx, &scope)?;
                self.commit_check_inspect(
                    tx,
                    &scope.host.host_id,
                    &scope.run_id,
                    &MailRecipient::RunHome,
                    params,
                )
            }),
            CheckMode::Unread { acknowledge } => {
                let actor = coordinator_actor(&scope);
                let key = actor.receipt_key(&request.request_id)?;
                if self.ledger_receipt_exists(&key, request, |tx| {
                    runs::require_coordinator(tx, &scope)
                })? {
                    // An exact replay (or conflict) is already decided by
                    // the ledger fingerprint check inside `run_atomic`;
                    // never re-run the wait loop for it.
                    return self.coordination_mutation(
                        request,
                        actor,
                        |tx| runs::require_coordinator(tx, &scope),
                        |tx| {
                            self.commit_check_unread(
                                tx,
                                &scope.host.host_id,
                                &scope.run_id,
                                &MailRecipient::RunHome,
                                &consumer,
                                params,
                                WaitObservation::NotRequested,
                            )
                        },
                    );
                }
                let observation = self.wait_for_unread_candidate(
                    &scope.host.host_id,
                    &scope.run_id,
                    &MailRecipient::RunHome,
                    &consumer,
                    acknowledge.as_deref(),
                    &params.kinds,
                    params.wait.as_ref(),
                    |tx| runs::require_coordinator(tx, &scope),
                )?;
                if observation == WaitObservation::Cancelled {
                    // Shutdown interrupted an in-progress wait: a graceful,
                    // un-ledgered `cancelled` response, never a hard error
                    // and never a fabricated delivery.
                    return self.coordination_read(|tx| {
                        runs::require_coordinator(tx, &scope)?;
                        encode(CheckResult {
                            delivery: None,
                            acknowledged: None,
                            messages: vec![],
                            next_cursor: None,
                            timed_out: false,
                            cancelled: true,
                            connection_lost: false,
                        })
                    });
                }
                self.coordination_mutation(
                    request,
                    actor,
                    |tx| runs::require_coordinator(tx, &scope),
                    |tx| {
                        self.commit_check_unread(
                            tx,
                            &scope.host.host_id,
                            &scope.run_id,
                            &MailRecipient::RunHome,
                            &consumer,
                            params,
                            observation,
                        )
                    },
                )
            }
        }
    }

    fn dispatch_check_worker(
        &self,
        request: &Request,
        binding: &WorkerBinding,
        params: &CheckParams,
    ) -> Result<Value, RpcError> {
        let recipient = MailRecipient::Dispatch(binding.dispatch_id.clone());
        match &params.mode {
            CheckMode::Peek | CheckMode::All => self.coordination_read(|tx| {
                coordination_access::recheck_in_tx(tx, binding, &request.method)?;
                self.commit_check_inspect(
                    tx,
                    &binding.host_id,
                    &binding.run_id,
                    &MailRecipient::Dispatch(binding.dispatch_id.clone()),
                    params,
                )
            }),
            CheckMode::Unread { acknowledge } => {
                let binding_owned = binding.clone();
                let actor = worker_actor(binding);
                let key = actor.receipt_key(&request.request_id)?;
                if self.ledger_receipt_exists(&key, request, |tx| {
                    coordination_access::recheck_in_tx(tx, &binding_owned, &request.method)
                        .map(|_| ())
                })? {
                    // An exact replay (or conflict) is already decided by
                    // the ledger fingerprint check inside `run_atomic`;
                    // never re-run the wait loop for it.
                    return self.coordination_mutation(
                        request,
                        actor,
                        |tx| {
                            coordination_access::recheck_in_tx(tx, &binding_owned, &request.method)
                                .map(|_| ())
                        },
                        |tx| {
                            self.commit_check_unread(
                                tx,
                                &binding_owned.host_id,
                                &binding_owned.run_id,
                                &recipient,
                                &delivery::Consumer::Dispatch,
                                params,
                                WaitObservation::NotRequested,
                            )
                        },
                    );
                }
                let observation = self.wait_for_unread_candidate(
                    &binding_owned.host_id,
                    &binding_owned.run_id,
                    &recipient,
                    &delivery::Consumer::Dispatch,
                    acknowledge.as_deref(),
                    &params.kinds,
                    params.wait.as_ref(),
                    |tx| {
                        coordination_access::recheck_in_tx(tx, &binding_owned, &request.method)
                            .map(|_| ())
                    },
                )?;
                if observation == WaitObservation::Cancelled {
                    // Shutdown interrupted an in-progress wait: a graceful,
                    // un-ledgered `cancelled` response, never a hard error
                    // and never a fabricated delivery.
                    return self.coordination_read(|tx| {
                        coordination_access::recheck_in_tx(tx, &binding_owned, &request.method)?;
                        encode(CheckResult {
                            delivery: None,
                            acknowledged: None,
                            messages: vec![],
                            next_cursor: None,
                            timed_out: false,
                            cancelled: true,
                            connection_lost: false,
                        })
                    });
                }
                self.coordination_mutation(
                    request,
                    actor,
                    |tx| {
                        coordination_access::recheck_in_tx(tx, &binding_owned, &request.method)
                            .map(|_| ())
                    },
                    |tx| {
                        self.commit_check_unread(
                            tx,
                            &binding_owned.host_id,
                            &binding_owned.run_id,
                            &recipient,
                            &delivery::Consumer::Dispatch,
                            params,
                            observation,
                        )
                    },
                )
            }
        }
    }

    /// Cheap pre-check keyed exactly like `coordination_mutation`'s ledger
    /// entry: if a receipt already exists for this request id, the
    /// wait loop must never run -- `run_atomic` will replay (or conflict)
    /// without invoking the work closure at all.
    fn ledger_receipt_exists(
        &self,
        key: &str,
        request: &Request,
        authorize: impl Fn(&Transaction<'_>) -> Result<(), RpcError>,
    ) -> Result<bool, RpcError> {
        self.coordination_read(|tx| {
            authorize(tx)?;
            Ok(
                crate::coordination_receipts::inspect_in_tx(tx, key, &request.request_id)?.state
                    != drogon_protocol::orchestration_question::RequestLedgerState::Absent,
            )
        })
    }

    /// Polls for a matching unread message with no lock held between
    /// observations; the actual delivery still happens exactly once, inside
    /// the caller's single ledger-atomic `commit_check_unread` call, so a
    /// pending or lost race here never fabricates or skips a real delivery.
    #[allow(clippy::too_many_arguments)]
    fn wait_for_unread_candidate(
        &self,
        host_id: &str,
        run_id: &str,
        recipient: &MailRecipient,
        consumer: &delivery::Consumer,
        pending_acknowledge: Option<&str>,
        kinds: &[MessageKind],
        wait: Option<&drogon_protocol::orchestration_common::WaitPolicy>,
        authorize: impl Fn(&Transaction<'_>) -> Result<(), RpcError>,
    ) -> Result<WaitObservation, RpcError> {
        let Some(wait) = wait else {
            return Ok(WaitObservation::NotRequested);
        };
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(wait.timeout_ms as u64);
        loop {
            if self.quiescent.load(Ordering::Acquire) {
                return Ok(WaitObservation::Cancelled);
            }
            let found = self.coordination_read(|tx| {
                authorize(tx)?;
                // A batch this same call is about to acknowledge must not
                // count as "unread" here: otherwise a wait that both acks an
                // outstanding batch and asks to wait for the *next* one wakes
                // immediately on the old batch, then the commit acks it and
                // returns whatever (possibly nothing) is left instead of
                // actually waiting for new mail.
                let floor = delivery::wait_floor_in_tx(
                    tx,
                    host_id,
                    run_id,
                    recipient,
                    consumer,
                    pending_acknowledge,
                )?;
                delivery::unread_exists_after_in_tx(tx, host_id, run_id, recipient, floor, kinds)
            })?;
            if found {
                return Ok(WaitObservation::Found);
            }
            let now = std::time::Instant::now();
            if now >= deadline {
                return Ok(WaitObservation::TimedOut);
            }
            std::thread::sleep(std::cmp::min(
                std::time::Duration::from_millis(50),
                deadline - now,
            ));
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn commit_check_unread(
        &self,
        tx: &Transaction<'_>,
        host_id: &str,
        run_id: &str,
        recipient: &MailRecipient,
        consumer: &delivery::Consumer,
        params: &CheckParams,
        observation: WaitObservation,
    ) -> Result<Value, RpcError> {
        if self.quiescent.load(Ordering::Acquire) {
            return Err(error::runtime_busy(
                "service admission is frozen for shutdown",
            ));
        }
        let CheckMode::Unread { acknowledge } = &params.mode else {
            return Err(error::internal_error(
                "commit_check_unread requires unread mode",
            ));
        };
        let candidate_delivery_id = new_id("delivery");
        let outcome = delivery::check_unread_in_tx(
            tx,
            host_id,
            run_id,
            recipient,
            consumer,
            acknowledge.as_deref(),
            &params.kinds,
            &candidate_delivery_id,
        )?;
        // The wait loop only decided *when* to make this one committed
        // attempt; if it actually found something now, that wins outright.
        let (timed_out, cancelled) = if outcome.delivery.is_some() {
            (false, false)
        } else {
            match observation {
                WaitObservation::TimedOut => (true, false),
                WaitObservation::Cancelled => (false, true),
                WaitObservation::Found | WaitObservation::NotRequested => (false, false),
            }
        };
        encode(CheckResult {
            delivery: outcome.delivery,
            acknowledged: outcome.acknowledged,
            messages: outcome.messages,
            next_cursor: None,
            timed_out,
            cancelled,
            connection_lost: false,
        })
    }

    fn commit_check_inspect(
        &self,
        tx: &Transaction<'_>,
        host_id: &str,
        run_id: &str,
        recipient: &MailRecipient,
        params: &CheckParams,
    ) -> Result<Value, RpcError> {
        let unread_only = matches!(params.mode, CheckMode::Peek);
        let limit = params
            .limit
            .unwrap_or(drogon_protocol::orchestration_common::DEFAULT_RUN_PAGE_LIMIT);
        let cursor = params.cursor.as_ref().map(|c| c.0.as_str());
        let (messages, next_cursor) = delivery::inspect_in_tx(
            tx,
            host_id,
            run_id,
            recipient,
            unread_only,
            &params.kinds,
            cursor,
            limit,
        )?;
        encode(CheckResult {
            delivery: None,
            acknowledged: None,
            messages,
            next_cursor: next_cursor.map(OpaqueCursor),
            timed_out: false,
            cancelled: false,
            connection_lost: false,
        })
    }
}
