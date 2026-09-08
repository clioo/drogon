//! Per-harness install of the OpenCode status plugin and the Pi
//! agent-status extension (journey J1 `needs_input`, same job Claude's
//! `--settings` hooks file does for the claude harness — see
//! `crate::hooks`). One submodule per harness; `harness.rs` is the only
//! caller.

pub(crate) mod opencode;
pub(crate) mod pi;
