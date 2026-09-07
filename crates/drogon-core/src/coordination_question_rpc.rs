//! Durable question admission followed by lock-free, authority-fenced waiting.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use drogon_orchestration::runs;
use drogon_protocol::orchestration_common::ActorScope;
use drogon_protocol::orchestration_mail::{MessageReceipt, ReplyParams, ReplyResult, SendTarget};
use drogon_protocol::orchestration_question::{AskIntent, AskParams, AskResult, AskWaitOutcome};
use drogon_protocol::orchestration_scope::{CoordinatorScope, HostScope};
use drogon_protocol::{Request, Response, RpcError};
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::Value;

use crate::coordination_access::{self, WorkerBinding};
use crate::coordination_attempts;
use crate::coordination_identity;
use crate::coordination_mail::{self, Actor, Recipient, questions};
use crate::coordination_receipts::worker_actor;
use crate::coordination_runs::{coordinator_actor, decode, encode};
use crate::{Engine, error};

struct QuestionActor<'a> {
    scope: CoordinatorScope,
    sender: Actor,
    worker: Option<&'a WorkerBinding>,
}

impl<'a> QuestionActor<'a> {
    fn new(scope: &ActorScope, worker: Option<&'a WorkerBinding>) -> Result<Self, RpcError> {
        match (scope, worker) {
            (ActorScope::Coordinator(scope), None) => Ok(Self {
                scope: scope.clone(),
                sender: Actor::Coordinator(scope.coordinator_id.clone()),
                worker: None,
            }),
            (ActorScope::Dispatch(scope), Some(binding))
                if scope.host.host_id == binding.host_id
                    && scope.run_id == binding.run_id
                    && scope.task_id == binding.task_id
                    && scope.dispatch_id == binding.dispatch_id =>
            {
                Ok(Self {
                    scope: CoordinatorScope {
                        host: HostScope {
                            contract_version: scope.host.contract_version,
                            host_id: binding.host_id.clone(),
                        },
                        run_id: binding.run_id.clone(),
                        coordinator_id: String::new(),
                        consumer_generation: 1,
                    },
                    sender: Actor::Dispatch(binding.dispatch_id.clone()),
                    worker,
                })
            }
            _ => Err(coordination_access::unauthorized()),
        }
    }

    fn authorize(&self, tx: &Transaction<'_>, method: &str) -> Result<(), RpcError> {
        match self.worker {
            Some(binding) => coordination_access::recheck_in_tx(tx, binding, method).map(|_| ()),
            None => runs::require_coordinator(tx, &self.scope),
        }
    }

    fn receipt(&self) -> coordination_identity::Actor {
        match self.worker {
            Some(binding) => worker_actor(binding),
            None => coordinator_actor(&self.scope),
        }
    }

    fn read_question(
        &self,
        tx: &Transaction<'_>,
        id: &str,
    ) -> Result<questions::QuestionRecord, RpcError> {
        bound_question(tx, &self.scope, id)?;
        let message = coordination_mail::get_message_in_tx(
            tx,
            &self.scope.host.host_id,
            &self.scope.run_id,
            id,
        )?
        .ok_or_else(|| error::not_found("Question does not exist in this run."))?;
        let owns = match (&self.sender, &message.from) {
            (Actor::Coordinator(_), Actor::Coordinator(_)) => true,
            (Actor::Dispatch(left), Actor::Dispatch(right)) => left == right,
            _ => false,
        };
        if !owns {
            return Err(coordination_access::unauthorized());
        }
        questions::ask_resume_in_tx(tx, &self.scope.host.host_id, &self.scope.run_id, id)
    }
}

impl Engine {
    pub(crate) fn dispatch_coordination_question(
        &self,
        request: &Request,
        worker: Option<&WorkerBinding>,
    ) -> Result<Value, RpcError> {
        let value = match request.method.as_str() {
            "orchestration.ask" => self.ask_question(request, worker)?,
            "orchestration.reply" => self.reply_question(request, worker)?,
            other => return Err(error::method_not_found(other)),
        };
        if serde_json::to_vec(&Response::success(
            request.request_id.clone(),
            value.clone(),
        ))
        .map_err(|_| error::internal_error("Invalid question response."))?
        .len()
            > coordination_mail::RESPONSE_BUDGET_BYTES
        {
            return Err(error::internal_error(
                "Question response exceeds its byte budget.",
            ));
        }
        Ok(value)
    }

    fn ask_question(
        &self,
        request: &Request,
        worker: Option<&WorkerBinding>,
    ) -> Result<Value, RpcError> {
        let params: AskParams = decode(&request.params)?;
        params.validate_shape(&self.host_id)?;
        let actor = QuestionActor::new(&params.scope, worker)?;
        let id = match &params.intent {
            AskIntent::New { question, options } => {
                let recipient = match &params.to {
                    None | Some(SendTarget::RunHome) => Recipient::RunHome,
                    Some(SendTarget::Dispatch { dispatch_id }) => {
                        Recipient::Dispatch(dispatch_id.clone())
                    }
                    Some(SendTarget::Group { .. }) => {
                        return Err(error::invalid_argument(
                            "A question requires one addressee.",
                        ));
                    }
                };
                let committed = self.coordination_mutation(
                    request,
                    actor.receipt(),
                    |tx| actor.authorize(tx, &request.method),
                    |tx| {
                        if let Recipient::Dispatch(id) = &recipient {
                            coordination_attempts::require_mail_recipient(tx, &actor.scope, id)?;
                        }
                        let id = format!("msg_{}", uuid::Uuid::new_v4());
                        let row = questions::ask_new_in_tx(
                            tx,
                            &actor.scope.host.host_id,
                            &actor.scope.run_id,
                            &id,
                            &actor.sender,
                            &recipient,
                            question,
                            options,
                            None,
                            &request.request_id,
                            &crate::now_rfc3339(),
                        )?;
                        encode(question_result(row, params.wait.timeout_ms, false))
                    },
                )?;
                decode::<AskResult>(&committed)?.question_message_id
            }
            AskIntent::Resume {
                question_message_id,
            } => question_message_id.clone(),
        };
        let budget = Duration::from_millis(params.wait.timeout_ms.into());
        let started = Instant::now();
        loop {
            let result = self.coordination_read(|tx| {
                actor.authorize(tx, &request.method)?;
                let row = actor.read_question(tx, &id)?;
                Ok(question_result(
                    row,
                    params.wait.timeout_ms,
                    self.quiescent.load(Ordering::Acquire),
                ))
            })?;
            if result.wait != AskWaitOutcome::Pending || started.elapsed() >= budget {
                result.validate_shape()?;
                return encode(result);
            }
            std::thread::sleep(
                Duration::from_millis(20).min(budget.saturating_sub(started.elapsed())),
            );
        }
    }

    fn reply_question(
        &self,
        request: &Request,
        worker: Option<&WorkerBinding>,
    ) -> Result<Value, RpcError> {
        let params: ReplyParams = decode(&request.params)?;
        params.validate_shape(&self.host_id)?;
        let actor = QuestionActor::new(&params.scope, worker)?;
        self.coordination_mutation(
            request,
            actor.receipt(),
            |tx| actor.authorize(tx, &request.method),
            |tx| {
                bound_question(tx, &actor.scope, &params.question_message_id)?;
                let row = questions::reply_in_tx(
                    tx,
                    &actor.scope.host.host_id,
                    &actor.scope.run_id,
                    &params.question_message_id,
                    &actor.sender,
                    &format!("msg_{}", uuid::Uuid::new_v4()),
                    &params.body,
                    params.thread_id.as_deref(),
                    &request.request_id,
                    &crate::now_rfc3339(),
                )?;
                let answer_id = row
                    .answer
                    .and_then(|answer| answer.answer_message_id)
                    .ok_or_else(|| error::internal_error("Reply has no answer identity."))?;
                let sequence: i64 = tx.query_row(
                    "SELECT sequence FROM orchestration_mail_messages WHERE host_id=?1 AND run_id=?2 AND message_id=?3",
                    params![actor.scope.host.host_id, actor.scope.run_id, answer_id], |row| row.get(0),
                ).map_err(error::from_sqlite)?;
                let sequence = u64::try_from(sequence).ok().filter(|value| *value > 0)
                    .ok_or_else(|| error::internal_error("Reply message has invalid sequence."))?;
                encode(ReplyResult {
                    message: MessageReceipt {
                        message_id: answer_id,
                        sequence: Some(sequence),
                        run_id: Some(actor.scope.run_id.clone()),
                    },
                    question_message_id: row.question_message_id,
                })
            },
        )
    }
}

fn question_result(row: questions::QuestionRecord, timeout: u32, interrupted: bool) -> AskResult {
    let wait = if row.answer.is_some() {
        AskWaitOutcome::Answered
    } else if row.closed || interrupted {
        AskWaitOutcome::Cancelled
    } else {
        AskWaitOutcome::Pending
    };
    AskResult {
        question_message_id: row.question_message_id,
        thread_id: row.thread_id,
        wait,
        answer: row.answer,
        effective_timeout_ms: Some(timeout),
        connection_lost: false,
    }
}

// Check SQLite byte lengths before materializing potentially corrupt persisted text.
fn bound_question(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    id: &str,
) -> Result<(), RpcError> {
    let bytes: Option<i64> = tx.query_row(
        "SELECT CASE WHEN (q.answer_body IS NULL) != (q.answer_message_id IS NULL) THEN -1 ELSE
            length(CAST(m.subject AS BLOB)) + COALESCE(length(CAST(m.body AS BLOB)),0)
            + length(CAST(m.kind AS BLOB))
            + COALESCE(length(CAST(m.payload_json AS BLOB)),0) + length(CAST(m.thread_id AS BLOB))
            + length(CAST(m.origin_request_id AS BLOB)) + COALESCE(length(CAST(m.from_coordinator_id AS BLOB)),0)
            + COALESCE(length(CAST(m.from_dispatch_id AS BLOB)),0) + length(CAST(m.to_dispatch_id AS BLOB))
            + COALESCE(length(CAST(q.answer_body AS BLOB)),0) + length(CAST(q.thread_id AS BLOB))
            + COALESCE(length(CAST(q.answer_message_id AS BLOB)),0) END
         FROM orchestration_mail_messages m JOIN orchestration_mail_questions q
           ON q.question_message_id=m.message_id AND q.host_id=m.host_id AND q.run_id=m.run_id
         WHERE m.host_id=?1 AND m.run_id=?2 AND m.message_id=?3",
        params![scope.host.host_id, scope.run_id, id], |row| row.get(0),
    ).optional().map_err(error::from_sqlite)?;
    match bytes {
        Some(n) if n >= 0 && n <= coordination_mail::RESPONSE_BUDGET_BYTES as i64 => Ok(()),
        Some(_) => Err(error::internal_error(
            "Stored question exceeds its byte budget.",
        )),
        None => Err(error::not_found("Question does not exist in this run.")),
    }
}
