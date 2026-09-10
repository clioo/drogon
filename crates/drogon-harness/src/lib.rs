//! Host-local harness discovery and argv planning; never starts a harness
//! session.
//!
//! The `catalog`, `selection` and `mentu_contract` modules are the C01-A
//! catalog/selection/translation slice: pure planning over bounded,
//! provenance-recording enumeration probes. Those probes spawn the harness
//! CLIs' own read-only enumeration commands (`--version`,
//! `--list-models`, `models`) inside private isolation — never an
//! interactive or headless harness *session*, and never model inference.
//! The isolation is credential-free unless the caller supplies the user's
//! own config roots ([`ProbeConfigSources`]), which are linked READ-ONLY so
//! the harness binary resolves the providers it would actually run with.

mod catalog;
mod discovery;
mod headless_env;
mod known_tui_agents;
mod launch;
mod mentu_contract;
mod selection;

pub use catalog::{
    CatalogEntry, CatalogProbe, EnumerationStatus, HostCatalog, PI_PROBE_LINK_FILES,
    PROBE_OUTPUT_CAP, PROBE_RESERVED_CLEANUP, PROBE_TIMEOUT_DEFAULT, PendingProbeChild,
    ProbeChildRole, ProbeConfigSources, ProbeProvenance, freshness_token, probe_host_catalog,
    probe_host_catalog_with_budget, probe_host_catalog_with_config,
};
pub use discovery::{HarnessAvailability, HarnessInstallation, discover, resolve_executable};
pub use headless_env::{HeadlessEnvPlan, plan_headless_env};
pub use known_tui_agents::{KNOWN_TUI_AGENT_IDS, is_known_tui_agent};
pub use launch::{
    HarnessLaunchPlan, HarnessLaunchRequest, PermissionMode, harness_resume_is_supported,
    plan_launch, plan_launch_with_args,
};
pub use mentu_contract::{
    AdapterEvidence, CONTRACT_DERIVED_FROM_REVISION, CONTRACT_DERIVED_FROM_VERSION,
    MentuProviderConfig, MentuRuntimeIdentity, MentuStepPlan, MentuTranslation, PiProviderBinding,
    parse_adapters_json, translate_selection,
};
pub use selection::{
    HarnessSelection, SelectionRecord, SelectionVerdict, allowed_efforts, validate_selection,
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
