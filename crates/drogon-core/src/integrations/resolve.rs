//! Tick-time secret resolution: grant-checked, memory-only, redacted.
//!
//! This is the seam between the sealed store, the per-Bot grant table and
//! the future script runner (PR #420 §4.3): at execution time the caller
//! (tick Phase B, no DB lock held) asks this module to resolve a monitor's
//! `secret_refs`. Every call re-reads the grant table inside the caller's
//! transaction — grants are never cached into a long-lived capability —
//! and only then opens the sealed values into memory for env injection.
//!
//! The redaction rule (§4.5): a resolved VALUE lives in memory only. It
//! must never reach `bot_monitors`, `bot_monitor_checks`, `bot_audit`, the
//! `bot_monitor_events` outbox, or a captured transcript. Only the bare
//! REFERENCE is ever persisted. [`scrub_for_persist`] is the gate every
//! transcript/error text must pass through before persistence; the
//! five-surface canary lives in `crates/drogon-core/tests/bot_secrets_redaction.rs`.

use rusqlite::Transaction;

use super::store::SecretStore;
use crate::bot_secrets::has_grant_in_tx;
use crate::bots::monitors::result::MonitorErrorKind;

/// Replacement marker [`scrub_for_persist`] writes over any resolved value
/// occurrence. Shape-matched to the product's redaction vocabulary.
pub const REDACTED: &str = "[redacted]";

/// Why resolution refused. Never carries a secret value; messages name at
/// most the reference (which is already persisted by design).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretResolutionError {
    /// No user grant for (bot, ref) — or a grant whose kind no longer
    /// matches the store. Nothing was read, nothing may spawn.
    Unauthorized { secret_ref: String, message: String },
    /// Granted, but no value is stored under the reference yet.
    NotConfigured { secret_ref: String },
    /// The store itself failed (I/O, key load).
    Store(String),
}

impl SecretResolutionError {
    /// Honest check-in taxonomy mapping for the monitor commit path.
    pub fn monitor_error_kind(&self) -> MonitorErrorKind {
        match self {
            Self::Unauthorized { .. } => MonitorErrorKind::Unauthorized,
            Self::NotConfigured { .. } => MonitorErrorKind::NotFound,
            Self::Store(_) => MonitorErrorKind::IoError,
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::Unauthorized {
                secret_ref,
                message,
            } => format!("{message} (secret ref {secret_ref})"),
            Self::NotConfigured { secret_ref } => format!(
                "secret ref {secret_ref} has no stored value; the owner must set it before checks can run"
            ),
            Self::Store(message) => message.clone(),
        }
    }
}

/// Resolve every named ref for `bot_id` or refuse. Order-preserved with
/// `secret_refs` so callers can map values back to names. Grants are
/// checked inside `tx` — the caller's current tick transaction — so a
/// revoke commits between two calls and the next call refuses.
pub fn resolve_for_bot_in_tx(
    tx: &Transaction,
    store: &SecretStore,
    bot_id: &str,
    bot_secret_refs: &[String],
) -> Result<Vec<(String, String)>, SecretResolutionError> {
    let mut resolved = Vec::with_capacity(bot_secret_refs.len());
    for secret_ref in bot_secret_refs {
        match has_grant_in_tx(tx, bot_id, secret_ref) {
            Ok(Some(grant)) => {
                // Defense in depth: a grant minted for another integration
                // kind never opens this store.
                if grant.kind != store.kind() {
                    return Err(SecretResolutionError::Unauthorized {
                        secret_ref: secret_ref.clone(),
                        message: format!(
                            "grant for secret ref {secret_ref} is for integration kind {}, not {}",
                            grant.kind,
                            store.kind()
                        ),
                    });
                }
            }
            Ok(None) => {
                return Err(SecretResolutionError::Unauthorized {
                    secret_ref: secret_ref.clone(),
                    message: "no grant for this bot; the owner must grant it".to_string(),
                });
            }
            Err(e) => return Err(SecretResolutionError::Store(e.to_string())),
        }
        let value = match store.read_secret(secret_ref) {
            Ok(Some(value)) => value,
            Ok(None) => {
                return Err(SecretResolutionError::NotConfigured {
                    secret_ref: secret_ref.clone(),
                });
            }
            Err(e) => return Err(SecretResolutionError::Store(e.to_string())),
        };
        resolved.push((secret_ref.clone(), value));
    }
    Ok(resolved)
}

/// The ONLY sanctioned execution gate: `execute` runs solely on `Ok`.
/// Callers (the future script runner) must route every spawn through here;
/// an ungranted or unresolvable ref can then provably never reach a child
/// process. `denied` receives the refusal for an honest error check-in.
pub fn with_resolved_secrets<R>(
    tx: &Transaction,
    store: &SecretStore,
    bot_id: &str,
    bot_secret_refs: &[String],
    denied: impl FnOnce(SecretResolutionError) -> R,
    execute: impl FnOnce(&[(String, String)]) -> R,
) -> R {
    match resolve_for_bot_in_tx(tx, store, bot_id, bot_secret_refs) {
        Ok(resolved) => execute(&resolved),
        Err(error) => denied(error),
    }
}

/// Scrub every resolved VALUE occurrence out of `text` before the text may
/// touch any durable surface (check row, `last_error`, audit detail, outbox
/// payload, captured transcript). Values that are empty are skipped (they
/// would replace everything); names are NOT scrubbed — references are the
/// sanctioned persisted shape.
pub fn scrub_for_persist(text: &str, resolved: &[(String, String)]) -> String {
    let mut scrubbed = text.to_string();
    for (_, value) in resolved {
        if value.is_empty() {
            continue;
        }
        scrubbed = scrubbed.replace(value.as_str(), REDACTED);
    }
    scrubbed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bot_secrets::{grant_in_tx, revoke_in_tx};

    const CANARY: &str = "canary-DROGON-P0-e2e1b7";

    fn tx() -> rusqlite::Transaction<'static> {
        // A real schema'd connection keeps grant reads honest.
        let conn: &'static mut rusqlite::Connection =
            Box::leak(Box::new(rusqlite::Connection::open_in_memory().unwrap()));
        let tx = conn.unchecked_transaction().unwrap();
        crate::bot_secrets::create_tables(&tx).unwrap();
        tx
    }

    #[test]
    fn ungranted_ref_is_unauthorized_and_execution_never_runs() {
        let tx = tx();
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::new(dir.path(), "github").unwrap();
        store.save_secret("TOKEN_REF", CANARY).unwrap();

        let spawned = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let spawned_for_closure = spawned.clone();
        // R = Result<usize, SecretResolutionError>: execute only runs on Ok.
        let outcome: Result<usize, SecretResolutionError> = with_resolved_secrets(
            &tx,
            &store,
            "bot-1",
            &["TOKEN_REF".to_string()],
            Err,
            |resolved| {
                spawned_for_closure.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(resolved.len())
            },
        );
        let error = outcome.expect_err("ungranted ref must be refused");
        assert_eq!(
            error,
            SecretResolutionError::Unauthorized {
                secret_ref: "TOKEN_REF".to_string(),
                message: "no grant for this bot; the owner must grant it".to_string(),
            }
        );
        assert!(
            !spawned.load(std::sync::atomic::Ordering::SeqCst),
            "an ungranted ref must never reach the execution closure"
        );
        assert_eq!(error.monitor_error_kind(), MonitorErrorKind::Unauthorized);
    }

    #[test]
    fn grant_then_revoke_changes_the_next_resolution() {
        let tx = tx();
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::new(dir.path(), "github").unwrap();
        store.save_secret("TOKEN_REF", CANARY).unwrap();

        grant_in_tx(&tx, "bot-1", "TOKEN_REF", "github", "owner", 1.0).unwrap();
        let resolved =
            resolve_for_bot_in_tx(&tx, &store, "bot-1", &["TOKEN_REF".to_string()]).unwrap();
        assert_eq!(
            resolved,
            vec![("TOKEN_REF".to_string(), CANARY.to_string())]
        );

        // Revoke: the SAME transaction view one "tick" later refuses, and
        // the store holds no cached value to fall back to.
        assert!(revoke_in_tx(&tx, "bot-1", "TOKEN_REF").unwrap());
        let error =
            resolve_for_bot_in_tx(&tx, &store, "bot-1", &["TOKEN_REF".to_string()]).unwrap_err();
        assert_eq!(error.monitor_error_kind(), MonitorErrorKind::Unauthorized);
    }

    #[test]
    fn grant_kind_mismatch_is_unauthorized() {
        let tx = tx();
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::new(dir.path(), "granola").unwrap();
        store.save_secret("TOKEN_REF", CANARY).unwrap();
        grant_in_tx(&tx, "bot-1", "TOKEN_REF", "github", "owner", 1.0).unwrap();
        let error =
            resolve_for_bot_in_tx(&tx, &store, "bot-1", &["TOKEN_REF".to_string()]).unwrap_err();
        assert_eq!(error.monitor_error_kind(), MonitorErrorKind::Unauthorized);
        assert!(error.message().contains("kind"));
    }

    #[test]
    fn granted_but_unconfigured_is_not_found_not_unauthorized() {
        let tx = tx();
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::new(dir.path(), "github").unwrap();
        grant_in_tx(&tx, "bot-1", "TOKEN_REF", "github", "owner", 1.0).unwrap();
        let error =
            resolve_for_bot_in_tx(&tx, &store, "bot-1", &["TOKEN_REF".to_string()]).unwrap_err();
        assert_eq!(error.monitor_error_kind(), MonitorErrorKind::NotFound);
    }

    #[test]
    fn scrub_removes_every_value_occurrence_but_keeps_names() {
        let resolved = vec![
            ("TOKEN_REF".to_string(), CANARY.to_string()),
            ("OTHER_REF".to_string(), "second-secret".to_string()),
        ];
        let raw = format!(
            "remote: error fetching TOKEN_REF with {CANARY} and second-secret, retried {CANARY}"
        );
        let scrubbed = scrub_for_persist(&raw, &resolved);
        assert!(!scrubbed.contains(CANARY));
        assert!(!scrubbed.contains("second-secret"));
        assert!(scrubbed.contains("TOKEN_REF"), "names persist by design");
        assert_eq!(scrubbed.matches(REDACTED).count(), 3);
    }

    #[test]
    fn scrub_ignores_empty_values_and_clean_text() {
        let resolved = vec![("EMPTY_REF".to_string(), String::new())];
        assert_eq!(scrub_for_persist("clean text", &resolved), "clean text");
        assert!(!scrub_for_persist("partially clean", &[]).contains(REDACTED));
    }
}
