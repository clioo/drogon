use drogon_harness::{HarnessAvailability, HarnessLaunchRequest, discover, plan_launch};
use drogon_protocol::RpcError;
use serde_json::{Value, json};

use crate::{Engine, error, require_str};

impl Engine {
    pub(super) fn harness_list(&self) -> Value {
        let path = std::env::var_os("PATH");
        json!({"hostId": self.host_id, "harnesses": discover(path.as_deref())})
    }

    pub(super) fn do_harness_start(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_id = require_str(params, "workspaceId")?;
        let request: HarnessLaunchRequest = serde_json::from_value(params.clone())
            .map_err(|_| error::invalid_argument("Invalid harness launch preferences"))?;
        let path = std::env::var_os("PATH");
        let installation = discover(path.as_deref())
            .into_iter()
            .find(|item| item.harness_id == request.harness_id)
            .ok_or_else(|| error::not_found("Unknown harness"))?;
        if installation.availability == HarnessAvailability::UnsupportedLauncher {
            return Err(RpcError::new(
                "unsupported_platform",
                "Harness needs a validated Windows launcher",
            ));
        }
        let executable = installation
            .executable
            .ok_or_else(|| error::not_found("Harness is not installed on this execution host"))?;
        let plan = plan_launch(&request, &executable)?;
        let mut session_params =
            json!({"workspaceId":workspace_id, "command":plan.command, "args":plan.args});
        for field in ["cols", "rows"] {
            if let Some(value) = params.get(field) {
                session_params[field] = value.clone();
            }
        }
        // Use the caller's one admission receipt; never create a second idempotency identity.
        self.do_session_start(&session_params)
    }
}
