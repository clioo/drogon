//! Run lifecycle wire types: `orchestration.runCreate/runList/runShow/runUse`.
//! Shape validation only; the engine enforces ownership, generation fences and
//! authorization inside its transactions.

use crate::RpcError;
use crate::orchestration_common::{
    MAX_SUBJECT_TEXT_BYTES, OpaqueCursor, validate_consumer_generation, validate_page_limit,
    validate_short_label, validate_task_text,
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
}

impl RunCreateParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_task_text(
            &self.objective,
            MAX_SUBJECT_TEXT_BYTES,
            "Invalid run objective.",
        )?;
        validate_short_label(&self.coordinator_id)
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
}

impl RunUseParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_short_label(&self.run_id)?;
        validate_short_label(&self.coordinator_id)?;
        validate_consumer_generation(self.consumer_generation)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunUseResult {
    /// Summary carrying the resulting generation (advanced on takeover).
    pub run: RunSummary,
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
