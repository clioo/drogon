//! The work graph (`.drogon/graph.json`): the two-halves store, the
//! graph→recipe compiler, and node-level resume/retry. RPC glue lives in
//! `crate::graph_rpc`, registered in `lib.rs`.

pub mod compiler;
pub mod state;
pub mod storage;
pub mod store;
