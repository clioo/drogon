//! Host-local harness discovery and argv planning; never starts a process.

mod discovery;
mod headless_env;
mod known_tui_agents;
mod launch;

pub use discovery::{HarnessAvailability, HarnessInstallation, discover, resolve_executable};
pub use headless_env::{HeadlessEnvPlan, plan_headless_env};
pub use known_tui_agents::{KNOWN_TUI_AGENT_IDS, is_known_tui_agent};
pub use launch::{
    HarnessLaunchPlan, HarnessLaunchRequest, PermissionMode, plan_launch, plan_launch_with_args,
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HarnessId {
    Claude,
    Pi,
    Opencode,
    #[serde(alias = "agy")]
    Antigravity,
    Codex,
}

impl HarnessId {
    // Keep the original four entries in their existing order: a few clients
    // use the catalog order for stable rendering. Codex is additive.
    pub const ALL: [Self; 5] = [
        Self::Claude,
        Self::Pi,
        Self::Opencode,
        Self::Antigravity,
        Self::Codex,
    ];

    pub fn executable(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Pi => "pi",
            Self::Opencode => "opencode",
            Self::Antigravity => "agy",
            Self::Codex => "codex",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Pi => "Pi",
            Self::Opencode => "OpenCode",
            Self::Antigravity => "Antigravity",
            Self::Codex => "Codex",
        }
    }
}
