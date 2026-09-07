//! Wire context only. Shape validation does not authenticate an actor or verify a database fence.

use crate::RpcError;
use serde::{Deserialize, Serialize};

pub const COORDINATION_CONTRACT_VERSION: u32 = 1;
pub const MAX_CONSUMER_GENERATION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostScope {
    pub contract_version: u32,
    pub host_id: String,
}

impl HostScope {
    pub fn validate_target(&self, execution_host_id: &str) -> Result<(), RpcError> {
        if self.contract_version != COORDINATION_CONTRACT_VERSION {
            return Err(RpcError::new(
                "unsupported_orchestration_contract",
                "Unsupported orchestration contract version.",
            ));
        }
        validate_id(&self.host_id)?;
        if self.host_id != execution_host_id {
            return Err(RpcError::new(
                "unsupported_host",
                "The requested execution host is not served by this endpoint.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoordinatorScope {
    #[serde(flatten)]
    pub host: HostScope,
    pub run_id: String,
    pub coordinator_id: String,
    pub consumer_generation: u64,
}

impl CoordinatorScope {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        validate_id(&self.run_id)?;
        validate_id(&self.coordinator_id)?;
        if !(1..=MAX_CONSUMER_GENERATION).contains(&self.consumer_generation) {
            return Err(invalid_scope());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchScope {
    #[serde(flatten)]
    pub host: HostScope,
    pub run_id: String,
    pub task_id: String,
    pub dispatch_id: String,
}

impl DispatchScope {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        for id in [&self.run_id, &self.task_id, &self.dispatch_id] {
            validate_id(id)?;
        }
        Ok(())
    }
}

fn validate_id(id: &str) -> Result<(), RpcError> {
    if id.is_empty()
        || id.len() > 128
        || id
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(invalid_scope());
    }
    Ok(())
}

fn invalid_scope() -> RpcError {
    RpcError::new("invalid_argument", "Invalid orchestration context.")
}
