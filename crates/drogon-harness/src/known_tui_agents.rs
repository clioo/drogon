//! Recognition-only catalog of the 36 Bot harness IDs the pinned source
//! knows (`src/shared/tui-agent.ts`'s `TuiAgent` union / `isTuiAgent`,
//! source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
//!
//! Deliberately separate from [`crate::HarnessId`] (`ALL`: the 5 harnesses
//! this rewrite can discover/launch) and from the 14 resumable identities
//! (`drogon-core::claim_identity`): recognizing an ID here proves nothing
//! about install/launch/resume. Matching is exact and case-sensitive, same
//! as the source (no trim, no case-fold).

pub const KNOWN_TUI_AGENT_IDS: &[&str] = &[
    "claude",
    "claude-agent-teams",
    "openclaude",
    "codex",
    "autohand",
    "opencode",
    "mimo-code",
    "pi",
    "omp",
    "gemini",
    "antigravity",
    "aider",
    "goose",
    "amp",
    "kilo",
    "kiro",
    "crush",
    "aug",
    "cline",
    "codebuff",
    "command-code",
    "continue",
    "cursor",
    "droid",
    "kimi",
    "mistral-vibe",
    "qwen-code",
    "rovo",
    "hermes",
    "openclaw",
    "copilot",
    "grok",
    "devin",
    "ante",
    "trae",
    "prime-agent",
];

/// Native `isTuiAgent`. A slice `contains` check has no prototype chain to
/// fall through, unlike a plain-object lookup in JS.
pub fn is_known_tui_agent(value: &str) -> bool {
    KNOWN_TUI_AGENT_IDS.contains(&value)
}
