//! `drogon-cli`: command-line client for the Drogon runtime.
//!
//! Implements the frozen first-slice contract in
//! `docs/migration/protocol-v1.md` §"Rust implementation boundary":
//! newline-delimited JSON RPC over the runtime's local endpoint, one request
//! per connection, bounded frames, strict response validation, exit 0 ok /
//! 1 operation or transport failure / 2 usage errors.

#![forbid(unsafe_code)]

/// Stack provisioned for the thread that runs the real CLI work.
///
/// Why this exists: clap's derive builds the whole command tree recursively
/// at parse time, and the construction depth scales with the total number
/// of flags across every subcommand. A grammar this size needs ~1.75 MiB in
/// a debug build, but Windows grants a console process's entry thread only
/// 1 MiB — so `drogon-cli.exe` died there with
/// `thread 'main' has overflowed its stack` before ever touching the
/// transport (observed as the named-pipe acceptance's `Command failed:`
/// status polls). Running parse + request on an explicitly sized thread
/// removes the dependence on the OS-default main-thread stack everywhere.
pub const CLI_WORK_STACK_SIZE: usize = 8 * 1024 * 1024;

/// Spawns `work` on a thread provisioned with [`CLI_WORK_STACK_SIZE`];
/// binaries should route their entire `main` body through this and join.
pub fn run_on_cli_stack<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> std::thread::JoinHandle<T> {
    std::thread::Builder::new()
        .stack_size(CLI_WORK_STACK_SIZE)
        .spawn(work)
        .expect("spawn the CLI work thread")
}

pub mod agent_context;
pub mod bundled_skill_guides;
pub mod cli;
pub mod client;
pub mod commands;
pub mod credential;
pub mod error;
mod orchestration_binding;
pub mod orchestration_cli;
pub mod orchestration_commands;
mod orchestration_gate_commands;
mod orchestration_output;
mod orchestration_task_dependencies;
mod orchestration_timeout;
pub mod output;
pub mod paths;
pub mod skill_metadata;
pub mod skills;
pub mod skills_agents;
pub mod transport;
pub mod wire;
