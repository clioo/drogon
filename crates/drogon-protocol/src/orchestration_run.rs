//! Run lifecycle wire types: `orchestration.runCreate/runList/runShow/runUse`.
//! Shape validation only; the engine enforces ownership, generation fences and
//! authorization inside its transactions.

use crate::RpcError;
use crate::orchestration_common::{
    MAX_SUBJECT_TEXT_BYTES, OpaqueCursor, SessionIdentity, validate_consumer_generation,
    validate_opaque_token, validate_page_limit, validate_short_label, validate_task_text,
};
use crate::orchestration_scope::HostScope;
use serde::{Deserialize, Serialize};

/// Admin creates a Run and binds its first coordinator. Source anchor:
/// `run-create` sends `{objective, from}`; the coordinator identity here is a
/// durable opaque binding id, not an authentication claim. The initial
/// consumer generation is always 1 and server-owned: no client field exists.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCreateParams {
    #[serde(flatten)]
    pub host: HostScope,
    pub objective: String,
    pub coordinator_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller: Option<SessionIdentity>,
}

impl RunCreateParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_task_text(
            &self.objective,
            MAX_SUBJECT_TEXT_BYTES,
            "Invalid run objective.",
        )?;
        validate_short_label(&self.coordinator_id)?;
        if let Some(caller) = &self.caller {
            caller.validate_shape()?;
        }
        Ok(())
    }
}

/// The durable run summary shared by every run method. It carries the full
/// binding (coordinator + generation) and creation time so inspection and
/// recovery do not depend on the creating call's response.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub objective: String,
    pub coordinator_id: String,
    /// Current consumer generation. Takeover is the only writer that advances
    /// it; creation always starts at 1 (server-owned).
    pub consumer_generation: u64,
    /// Server clock at creation, epoch milliseconds.
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCreateResult {
    pub run: RunSummary,
}

/// Inspect the explicit persisted binding for one coordinator identity.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCurrentParams {
    #[serde(flatten)]
    pub host: HostScope,
    pub coordinator_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller: Option<SessionIdentity>,
}
impl RunCurrentParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_short_label(&self.coordinator_id)?;
        if let Some(caller) = &self.caller {
            caller.validate_shape()?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct RunCurrentResult {
    pub run: Option<RunSummary>,
}

/// Binds a coordinator to an existing run. Every coordinator mutation supplies
/// the caller's known generation; the store checks the fence in the changing
/// transaction. `takeover` is the explicit admin-only generation advance —
/// never a silent default to the latest run (source: `takeoverLegacy`).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunUseParams {
    #[serde(flatten)]
    pub host: HostScope,
    pub run_id: String,
    pub coordinator_id: String,
    pub consumer_generation: u64,
    #[serde(default)]
    pub takeover: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caller: Option<SessionIdentity>,
}

impl RunUseParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_short_label(&self.run_id)?;
        validate_short_label(&self.coordinator_id)?;
        validate_consumer_generation(self.consumer_generation)?;
        if let Some(caller) = &self.caller {
            caller.validate_shape()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunUseResult {
    /// Summary carrying the resulting generation (advanced on takeover).
    pub run: RunSummary,
}

/// Terminal binding intent whose fence is resolved atomically by the daemon.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunBindParams {
    #[serde(flatten)]
    pub host: HostScope,
    pub run_id: String,
    pub coordinator_id: String,
    pub caller: SessionIdentity,
    #[serde(default)]
    pub takeover: bool,
}
impl RunBindParams {
    pub fn validate_shape(&self, expected_host: &str) -> Result<(), RpcError> {
        self.host.validate_target(expected_host)?;
        validate_short_label(&self.run_id)?;
        validate_short_label(&self.coordinator_id)?;
        self.caller.validate_shape()
    }
}

use crate::orchestration_scope::CoordinatorScope;

/// Inspect a task's current dispatch (read-only; preamble is deterministic).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchShowParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub task_id: String,
    #[serde(default)]
    pub preamble: bool,
}

impl DispatchShowParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_short_label(&self.task_id)
    }
}

/// Coordinator dispatches a ready task to an existing live terminal.
/// `to` names a session id observed by this host and is required unless
/// `dry_run` previews the preamble without touching state. `inject` writes
/// the preamble into the target session; a minted dispatch capability is
/// embedded in the preamble only in that case (source: `dispatchCapability`).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub task_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default)]
    pub inject: bool,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub return_preamble: bool,
}

impl DispatchParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_short_label(&self.task_id)?;
        if let Some(to) = &self.to {
            validate_opaque_token(to, 128, "Invalid target session id.")?;
        } else if !self.dry_run {
            return Err(RpcError::new(
                "invalid_argument",
                "Missing --to: a live target terminal is required unless --dry-run.",
            ));
        }
        Ok(())
    }
}

/// Dispatch outcome. `dispatch` is null for a dry run; `preamble` is present
/// for a dry run and when `return_preamble` was requested.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatch: Option<crate::orchestration_worker::WorkerShowResult>,
    pub injected: bool,
    pub dry_run: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preamble: Option<String>,
}

/// Current dispatch row plus, when requested, the regenerated preamble.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchShowResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatch: Option<crate::orchestration_worker::WorkerShowResult>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preamble: Option<String>,
}

/// Bounded, cursor-paginated run listing (inspection, no state allocation).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListParams {
    #[serde(flatten)]
    pub host: HostScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<OpaqueCursor>,
}

impl RunListParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_page_limit(self.limit)?;
        if let Some(cursor) = &self.cursor {
            cursor.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListResult {
    pub runs: Vec<RunSummary>,
    /// Absent/None means end of results; clients must not parse cursor contents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<OpaqueCursor>,
}

/// Host-scoped reset scope: exactly one variant per request. Mirrors the
/// source `orchestration.reset` flags (`--all`/`--tasks`/`--messages`).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetScope {
    All,
    Tasks,
    Messages,
}

/// Host-scoped orchestration reset. No coordinator binding: the scope selects
/// which domain tables are cleared on the addressed host. The requests ledger
/// is always preserved so a lost reset response stays replayable.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetParams {
    #[serde(flatten)]
    pub host: HostScope,
    pub scope: ResetScope,
}

impl ResetParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)
    }

    pub fn scope_name(&self) -> &'static str {
        match self.scope {
            ResetScope::All => "all",
            ResetScope::Tasks => "tasks",
            ResetScope::Messages => "messages",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetResult {
    pub reset: String,
}

/// Read-only run inspection.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunShowParams {
    #[serde(flatten)]
    pub host: HostScope,
    pub run_id: String,
}

impl RunShowParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_short_label(&self.run_id)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunShowResult {
    pub run: RunSummary,
    /// Optional task accounting; allowed by root but the engine may omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_count: Option<u32>,
}
