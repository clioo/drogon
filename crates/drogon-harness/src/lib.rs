//! Host-local harness discovery and argv planning; never starts a process.

mod discovery;
mod known_tui_agents;
mod launch;

pub use discovery::{HarnessAvailability, HarnessInstallation, discover};
pub use known_tui_agents::{KNOWN_TUI_AGENT_IDS, is_known_tui_agent};
pub use launch::{HarnessLaunchPlan, HarnessLaunchRequest, PermissionMode, plan_launch};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HarnessId {
    Claude,
    Pi,
    Opencode,
    #[serde(alias = "agy")]
    Antigravity,
}

impl HarnessId {
    pub const ALL: [Self; 4] = [Self::Claude, Self::Pi, Self::Opencode, Self::Antigravity];

    pub fn executable(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Pi => "pi",
            Self::Opencode => "opencode",
            Self::Antigravity => "agy",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Pi => "Pi",
            Self::Opencode => "OpenCode",
            Self::Antigravity => "Antigravity",
        }
    }
}
