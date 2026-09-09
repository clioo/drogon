//! Host-owned run/task coordination domain.
//!
//! Every entry point takes the caller's SQLite transaction. The domain opens no
//! database, owns no mutex, starts no process, performs no file or network I/O
//! and keeps no shadow request ledger: authentication, the `RequestLedger`
//! replay/fingerprint check and lifecycle admission are root's engine
//! responsibilities and happen before a mutator is called. Ids and clock values
//! are likewise supplied by the trusted engine, so nothing here can drift from
//! the host's identity or timeline.

pub mod gates;
pub mod pagination;
pub mod runs;
pub mod schema;
pub mod tasks;
