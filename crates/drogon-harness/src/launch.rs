use std::path::Path;

use drogon_protocol::RpcError;
use serde::{Deserialize, Serialize};

use crate::{HarnessId, discovery::is_script_launcher};

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    #[default]
    Inherit,
    Unattended,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchRequest {
    pub harness_id: HarnessId,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub provider: Option<String>,
    pub prompt: Option<String>,
    #[serde(default)]
    pub permission_mode: PermissionMode,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessLaunchPlan {
    pub harness_id: HarnessId,
    pub command: String,
    pub args: Vec<String>,
    pub permission_mode: PermissionMode,
}

/// The service supplies a discovered absolute executable, not a client-provided command override.
pub fn plan_launch(
    request: &HarnessLaunchRequest,
    executable: &Path,
) -> Result<HarnessLaunchPlan, RpcError> {
    if !executable.is_absolute() {
        return Err(invalid("Harness executable must be an absolute host path"));
    }
    if is_script_launcher(executable) {
        return Err(RpcError::new(
            "unsupported_platform",
            "Windows batch launchers require the validated Windows argv adapter",
        ));
    }
    let command = executable
        .to_str()
        .ok_or_else(|| invalid("Harness executable path is not UTF-8"))?
        .to_owned();
    let mut args = Vec::new();
    for (name, value) in [
        ("model", &request.model),
        ("provider", &request.provider),
        ("effort", &request.effort),
    ] {
        if let Some(value) = value
            && (value.is_empty()
                || value.len() > 512
                || value.chars().any(char::is_control)
                || value.starts_with('-'))
        {
            return Err(invalid(format!("Invalid {name}")));
        }
    }
    if let Some(provider) = &request.provider {
        if request.harness_id != HarnessId::Pi {
            return Err(invalid("Provider selection is available only for Pi"));
        }
        args.extend(["--provider".into(), provider.clone()]);
    }
    if let Some(model) = &request.model {
        args.extend(["--model".into(), model.clone()]);
    }
    if let Some(effort) = &request.effort {
        let (flag, allowed): (&str, &[&str]) = match request.harness_id {
            HarnessId::Claude => ("--effort", &["low", "medium", "high", "xhigh", "max"]),
            HarnessId::Pi => (
                "--thinking",
                &["off", "minimal", "low", "medium", "high", "xhigh", "max"],
            ),
            HarnessId::Antigravity => ("--effort", &["low", "medium", "high"]),
            HarnessId::Opencode => {
                return Err(invalid(
                    "OpenCode effort selection is not advertised by this adapter",
                ));
            }
        };
        if !allowed.contains(&effort.as_str()) {
            return Err(invalid("Unsupported effort for this harness"));
        }
        args.extend([flag.into(), effort.clone()]);
    }
    if request.permission_mode == PermissionMode::Unattended {
        match request.harness_id {
            HarnessId::Claude | HarnessId::Antigravity => {
                args.push("--dangerously-skip-permissions".into())
            }
            HarnessId::Opencode => args.push("--auto".into()),
            // Pi has no per-tool approval flag; trust only this invocation's project files.
            HarnessId::Pi => args.push("--approve".into()),
        }
    }
    if let Some(prompt) = &request.prompt {
        if prompt.trim().is_empty() || prompt.len() > 32768 || prompt.contains('\0') {
            return Err(invalid(
                "Prompt must contain 1..32768 UTF-8 bytes without NUL",
            ));
        }
        match request.harness_id {
            HarnessId::Opencode => args.push(format!("--prompt={prompt}")),
            HarnessId::Antigravity => args.extend(["--prompt-interactive".into(), prompt.clone()]),
            HarnessId::Claude => args.extend(["--".into(), prompt.clone()]),
            // Pi interprets @file and command-shaped positional arguments before messages.
            HarnessId::Pi => args.push(format!("Drogon task:\n{prompt}")),
        }
    }
    Ok(HarnessLaunchPlan {
        harness_id: request.harness_id,
        command,
        args,
        permission_mode: request.permission_mode,
    })
}

fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message)
}
