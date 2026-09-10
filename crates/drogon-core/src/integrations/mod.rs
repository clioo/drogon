//! Integration credentials (P0 secrets store): the sealed at-rest store
//! generalized from the Jira token store, plus the tick-time grant-checked
//! resolution seam.
//!
//! - [`seal`] — the file-sealed envelope (`v1.` HMAC-SHA256, 0600 key),
//!   moved unchanged from `crate::jira::seal` and generalized over the
//!   integration kind. No new cryptography.
//! - [`store`] — [`store::SecretStore`], one sealed value per
//!   `(kind, name)` under `<data-dir>/integrations/<kind>/<name>.enc`.
//!   Values in, sealed bytes out; nothing else ever persists a value.
//! - [`resolve`] — the only sanctioned execution seam: grant check in the
//!   caller's transaction, then in-memory value resolution, then
//!   [`resolve::scrub_for_persist`] before any text may touch a durable
//!   surface.
//!
//! The five-surface redaction canary lives in
//! `crates/drogon-core/tests/bot_secrets_redaction.rs`.
//! MIT Copyright (c) 2026 Lovecast Inc.

pub mod resolve;
pub mod seal;
pub mod store;
