//! Task wire types: `orchestration.taskCreate/taskList/taskShow`.
//! Bound-coordinator authority; specs are immutable after creation and
//! existing same-run dependencies are immutable. Shape validation only.

use crate::RpcError;
use crate::orchestration_common::{
    AttemptSummary, MAX_TASK_TEXT_BYTES, OpaqueCursor, validate_opaque_token, validate_page_limit,
    validate_task_text,
};
use crate::orchestration_scope::CoordinatorScope;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Immutable task specification. `instructions` is task-authored data, never
/// shell code; `metadata` is the explicitly allowed task-authored JSON blob.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub instructions: String,
    /// Same-run prerequisites; the domain deduplicates IDs before persistence.
    /// Self/cross-run/missing dependencies are engine state checks.
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

impl TaskSpec {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        if let Some(title) = &self.title {
            validate_task_text(title, 512, "Invalid task title.")?;
        }
        validate_task_text(
            &self.instructions,
            MAX_TASK_TEXT_BYTES,
            "Invalid task instructions.",
        )?;
        for id in &self.depends_on {
            validate_opaque_token(id, 128, "Invalid task dependency id.")?;
        }
        if let Some(parent) = &self.parent {
            validate_opaque_token(parent, 128, "Invalid task parent id.")?;
        }
        if let Some(display_name) = &self.display_name {
            validate_task_text(display_name, 512, "Invalid task display name.")?;
        }
        Ok(())
    }
}

/// Task status vocabulary, exact per root decision: `pending` (prerequisites
/// unsatisfied), `ready` (all prerequisites have successful final reports),
/// `dispatched` (attempt active), `completed`, `failed`, and `blocked`
/// (cancellation/release and similar engine-fenced hold states).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Pending,
    Ready,
    Dispatched,
    Completed,
    Failed,
    Blocked,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub task_id: String,
    pub run_id: String,
    pub status: TaskStatus,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    /// Source label order is display_name ?? title ?? spec; the record carries
    /// both so the CLI can build the label. Optional for old-record reads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// Creates a task in an existing run. Source anchor: `taskCreate` carried
/// `spec`, `taskTitle`, `deps` (a JSON-encoded string), `parent`, `run` and a
/// caller terminal handle; the terminal handle is replaced by the coordinator
/// scope and `deps` becomes a typed array.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub spec: TaskSpec,
}

impl TaskCreateParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        self.spec.validate_shape()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateResult {
    pub task: TaskRecord,
}

/// Coordinator status transition. The engine checks active attempt ownership
/// atomically; a caller cannot forge a dispatched task or settle a live worker.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub task_id: String,
    pub status: TaskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

impl TaskUpdateParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.task_id, 128, "Invalid task id.")?;
        if self
            .result
            .as_ref()
            .is_some_and(|text| text.len() > MAX_TASK_TEXT_BYTES)
        {
            return Err(RpcError::new(
                "invalid_argument",
                "Task result is too long.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateResult {
    pub task: TaskRecord,
}

/// Listing summary. Root decision: the listing must actually convey the
/// instructions, so `spec` (possibly elided) and `specTruncated` are required.
/// `brief` selects the server-side elision; full text stays on taskShow.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub task_id: String,
    pub status: TaskStatus,
    /// Instructions text; possibly elided when `specTruncated` is true.
    pub spec: String,
    pub spec_truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<String>>,
    /// Current attempt's assignee session id, when a current attempt exists.
    /// The CLI renders it only for `dispatched` rows (source condition).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee_handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatch_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    /// Server-side brief rendering (source: brief with client fallback).
    #[serde(default)]
    pub brief: bool,
    /// Shorthand filter for dispatch-ready tasks (status == ready).
    #[serde(default)]
    pub ready: bool,
    /// Optional exact status filter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<TaskStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<OpaqueCursor>,
}

impl TaskListParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        // Why: `ready` is a shorthand for status == ready, so combining it
        // with any other status would be a contradictory request.
        if self.ready && matches!(self.status, Some(status) if status != TaskStatus::Ready) {
            return Err(RpcError::new(
                "invalid_argument",
                "The ready filter conflicts with the requested status.",
            ));
        }
        validate_page_limit(self.limit)?;
        if let Some(cursor) = &self.cursor {
            cursor.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResult {
    pub tasks: Vec<TaskSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<OpaqueCursor>,
}

/// Read-only task detail keeping the full spec and preserved attempt history.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskShowParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub task_id: String,
}

impl TaskShowParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.task_id, 128, "Invalid task id.")
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskShowResult {
    pub task: TaskRecord,
    pub spec: TaskSpec,
    /// Every attempt's history is preserved, including replacements.
    #[serde(default)]
    pub attempts: Vec<AttemptSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_dispatch_id: Option<String>,
}
