//! Decision gates: coordinator-fenced mutations and run-scoped inspection.
use crate::RpcError;
use crate::orchestration_common::{MAX_TASK_TEXT_BYTES, validate_opaque_token, validate_task_text};
use crate::orchestration_scope::CoordinatorScope;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GateStatus {
    Pending,
    Resolved,
    Timeout,
}
impl GateStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Resolved => "resolved",
            Self::Timeout => "timeout",
        }
    }
}

// The public gate record retains the reference CLI's field names and options JSON string.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct GateRecord {
    pub id: String,
    pub run_id: String,
    pub task_id: String,
    pub question: String,
    pub options: String,
    pub status: GateStatus,
    pub resolution: Option<String>,
    pub created_at: String,
    pub resolved_at: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct GateResult {
    pub gate: GateRecord,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateListResult {
    pub run_id: String,
    pub gates: Vec<GateRecord>,
    pub count: usize,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateCreateParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub task_id: String,
    pub question: String,
    #[serde(default)]
    pub options: Vec<String>,
}
impl GateCreateParams {
    pub fn validate_shape(&self, host: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(host)?;
        validate_opaque_token(&self.task_id, 128, "Invalid task id.")?;
        validate_task_text(
            &self.question,
            MAX_TASK_TEXT_BYTES,
            "Invalid gate question.",
        )?;
        let encoded = serde_json::to_string(&self.options)
            .map_err(|_| RpcError::new("invalid_argument", "Invalid gate options."))?;
        if encoded.len() > MAX_TASK_TEXT_BYTES {
            return Err(RpcError::new(
                "invalid_argument",
                "Gate options are too long.",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateResolveParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub gate_id: String,
    pub resolution: String,
}
impl GateResolveParams {
    pub fn validate_shape(&self, host: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(host)?;
        validate_opaque_token(&self.gate_id, 128, "Invalid gate id.")?;
        validate_task_text(
            &self.resolution,
            MAX_TASK_TEXT_BYTES,
            "Invalid gate resolution.",
        )
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateListParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub task_id: Option<String>,
    pub status: Option<GateStatus>,
}
impl GateListParams {
    pub fn validate_shape(&self, host: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(host)?;
        if let Some(task) = &self.task_id {
            validate_opaque_token(task, 128, "Invalid task id.")?;
        }
        Ok(())
    }
}
