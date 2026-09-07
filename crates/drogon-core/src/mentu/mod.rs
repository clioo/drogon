//! Mentu (journey J9): a workspace's `.mentu/recipes`, an explicit
//! content-bound approval, execution through the pinned `mentu-recipes`
//! runtime, run evidence and retry. RPC glue lives in `crate::mentu_rpc`,
//! registered in `lib.rs`.

pub mod execution;
pub mod recipe;
pub mod run_record;
pub mod runtime;
pub mod storage;
