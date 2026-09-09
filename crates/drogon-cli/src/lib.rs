//! `drogon-cli`: command-line client for the Drogon runtime.
//!
//! Implements the frozen first-slice contract in
//! `docs/migration/protocol-v1.md` §"Rust implementation boundary":
//! newline-delimited JSON RPC over the runtime's local endpoint, one request
//! per connection, bounded frames, strict response validation, exit 0 ok /
//! 1 operation or transport failure / 2 usage errors.

#![forbid(unsafe_code)]

pub mod agent_context;
pub mod cli;
pub mod client;
pub mod commands;
pub mod credential;
pub mod error;
pub mod orchestration_cli;
pub mod orchestration_commands;
mod orchestration_gate_commands;
mod orchestration_output;
mod orchestration_task_dependencies;
mod orchestration_timeout;
pub mod output;
pub mod paths;
pub mod skills;
pub mod transport;
pub mod wire;
