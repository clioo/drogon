//! Per-harness install of the Codex disposable home, OpenCode status plugin,
//! and Pi agent-status extension (journey J1 `needs_input`, same job Claude's
//! `--settings` hooks file does for the claude harness — see
//! `crate::hooks`). One submodule per harness; `harness.rs` is the only
//! caller.

pub(crate) mod codex;
pub(crate) mod opencode;
pub(crate) mod pi;
