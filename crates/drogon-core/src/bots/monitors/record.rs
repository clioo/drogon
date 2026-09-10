//! Monitor record: identity, approval, scope, and durable state.
//!
//! Persists the monitor `id`/`version`, the deterministic rule (or the
//! approved script hash for future rule types), the structured
//! interpreter/argv (always absent in v1 — arbitrary execution is refused),
//! the `(host_id, project_id, resource)` scope, the trigger, secret
//! **references** (never values), the cursor, and the enabled flag plus
//! backoff/rate-limit and last-success/error evidence.
//!
//! Rule edits invalidate approval: [`staged_rule_edit`] bumps `version`
//! and leaves `approved_rule_hash` behind so [`is_approved`] fails until
//! an explicit [`approve_rule`] call. Secret values never appear here.

use serde::{Deserialize, Serialize};

use super::policy::MonitorInferencePolicy;
use super::rule::{MonitorRule, validate_rule};

/// Longest admitted monitor/bot identifier in bytes.
pub const MAX_ID_BYTES: usize = 256;
/// Longest admitted trigger/cron expression in bytes.
pub const MAX_TRIGGER_BYTES: usize = 256;
/// How many secret references a single monitor may carry.
pub const MAX_SECRET_REFS: usize = 16;

/// How this monitor fires. The existing automation scheduler owns actual
/// firing (C08); this is only the monitor's declared intent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MonitorTrigger {
    Manual,
    Scheduled { cron: String },
}

impl MonitorTrigger {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Manual => Ok(()),
            Self::Scheduled { cron } => {
                let trimmed = cron.trim();
                if trimmed.is_empty() {
                    return Err("cron expression must not be empty".to_string());
                }
                if trimmed.len() > MAX_TRIGGER_BYTES {
                    return Err(format!(
                        "cron expression must be at most {MAX_TRIGGER_BYTES} bytes"
                    ));
                }
                if trimmed.bytes().any(|b| b.is_ascii_control()) {
                    return Err("cron expression must not contain control characters".to_string());
                }
                Ok(())
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorRecord {
    pub id: String,
    /// Owning bot when created from the Bot surface; `None` for a
    /// project-level monitor. Never authorizes cross-bot reads by itself.
    pub bot_id: Option<String>,
    pub version: u64,
    pub rule: MonitorRule,
    /// Structured interpreter for future script rules. v1 refuses any
    /// interpreter/argv: the only rule is a content digest, never a shell.
    pub interpreter: Option<String>,
    pub argv: Vec<String>,
    /// Secret **names** only (e.g. `GITHUB_TOKEN_REF`). Values are never
    /// stored or logged. v1 file digests carry none.
    pub secret_refs: Vec<String>,
    /// What a committed change event may trigger. `NotificationOnly` (the
    /// default) stops at the drained outbox row; `ExplicitResponsibility`
    /// lets the delegation drain dispatch that responsibility through the
    /// existing runner seam. Binding is grant-like metadata, not rule
    /// bytes: it never enters `approval_hash`, so (re)binding never
    /// parks or unparks approval — exactly like a secret grant living
    /// outside the hashed rule.
    #[serde(default)]
    pub inference_policy: MonitorInferencePolicy,
    pub trigger: MonitorTrigger,
    /// Last accepted cursor (`v1:<hex>`), or `None` before the first
    /// successful check.
    pub cursor: Option<String>,
    pub enabled: bool,
    /// `sha256` of the canonical rule bytes at approval time (see
    /// [`MonitorRule::approval_hash`]). Mismatch means "needs approval".
    pub approved_rule_hash: String,
    pub created_at_ms: f64,
    pub updated_at_ms: f64,
    /// Evidence retained across disable/delete: never erased by a version
    /// bump or a failed check.
    pub consecutive_errors: u32,
    pub next_eligible_at_ms: Option<f64>,
    pub last_event_id: Option<String>,
    pub last_success_at_ms: Option<f64>,
    pub last_error: Option<String>,
}

fn is_bad_id(value: &str, field: &str) -> Option<String> {
    if value.is_empty() {
        return Some(format!("{field} must not be empty"));
    }
    if value.len() > MAX_ID_BYTES {
        return Some(format!("{field} must be at most {MAX_ID_BYTES} bytes"));
    }
    if value.bytes().any(|b| b == 0 || b.is_ascii_control()) {
        return Some(format!(
            "{field} must not contain NUL or control characters"
        ));
    }
    None
}

fn validate_secret_ref(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 {
        return Err("secret reference must be 1..=128 bytes".to_string());
    }
    if value.bytes().any(|b| b == 0 || b.is_ascii_control()) {
        return Err("secret reference must not contain NUL or control characters".to_string());
    }
    if value.contains('=') || value.contains(':') || value.contains('\n') {
        return Err("secret reference must be a bare name, never a KEY=value pair".to_string());
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
    {
        return Err("secret reference must match [A-Za-z0-9_.-]+".to_string());
    }
    Ok(())
}

impl MonitorRecord {
    /// Validate every bound without touching storage, FS, or network.
    pub fn validate(&self) -> Result<(), String> {
        if let Some(reason) = is_bad_id(&self.id, "id") {
            return Err(reason);
        }
        if let Some(bot_id) = &self.bot_id
            && let Some(reason) = is_bad_id(bot_id, "botId")
        {
            return Err(reason);
        }
        if self.version == 0 {
            return Err("version must start at 1".to_string());
        }
        validate_rule(&self.rule)?;
        // v1 freeze: no interpreter, no argv, no secrets — the digest rule
        // needs none of them, and anything else is arbitrary execution.
        if self.interpreter.is_some() {
            return Err("interpreter is not admitted for local_file_digest.v1".to_string());
        }
        if !self.argv.is_empty() {
            return Err("argv is not admitted for local_file_digest.v1".to_string());
        }
        if self.secret_refs.len() > MAX_SECRET_REFS {
            return Err(format!("at most {MAX_SECRET_REFS} secret references"));
        }
        for secret_ref in &self.secret_refs {
            validate_secret_ref(secret_ref)?;
        }
        if !self.secret_refs.is_empty() {
            return Err("secret references are not admitted for local_file_digest.v1".to_string());
        }
        self.inference_policy.validate()?;
        self.trigger.validate()?;
        if let Some(cursor) = &self.cursor
            && !super::result::is_valid_cursor(cursor)
        {
            return Err("cursor has an invalid shape".to_string());
        }
        if let Some(event_id) = &self.last_event_id
            && !super::result::is_valid_event_id(event_id)
        {
            return Err("lastEventId has an invalid shape".to_string());
        }
        if self.approved_rule_hash.is_empty() {
            return Err(
                "approvedRuleHash must not be empty; approve the rule explicitly".to_string(),
            );
        }
        if !self.created_at_ms.is_finite() || !self.updated_at_ms.is_finite() {
            return Err("timestamps must be finite".to_string());
        }
        Ok(())
    }

    /// True when the stored approval hash matches the current rule.
    pub fn is_approved(&self) -> bool {
        self.rule.approval_hash() == self.approved_rule_hash
    }
}

/// Build a new v1 monitor. Approval is explicit: the caller passes the
/// rule's own [`MonitorRule::approval_hash`] as `approved_rule_hash` only
/// after the user approved that exact rule text.
#[allow(clippy::too_many_arguments)]
pub fn new_monitor(
    id: String,
    bot_id: Option<String>,
    rule: MonitorRule,
    trigger: MonitorTrigger,
    approved_rule_hash: String,
    created_at_ms: f64,
) -> Result<MonitorRecord, String> {
    let record = MonitorRecord {
        id,
        bot_id,
        version: 1,
        rule,
        interpreter: None,
        argv: Vec::new(),
        secret_refs: Vec::new(),
        trigger,
        cursor: None,
        enabled: true,
        inference_policy: MonitorInferencePolicy::default(),
        approved_rule_hash,
        created_at_ms,
        updated_at_ms: created_at_ms,
        consecutive_errors: 0,
        next_eligible_at_ms: None,
        last_event_id: None,
        last_success_at_ms: None,
        last_error: None,
    };
    record.validate()?;
    if !record.is_approved() {
        return Err("new monitor must be approved for its initial rule".to_string());
    }
    Ok(record)
}

/// Stage a rule edit: bumps `version`, swaps the rule, refreshes
/// `updated_at_ms`, and deliberately leaves `approved_rule_hash` behind
/// so [`MonitorRecord::is_approved`] fails until [`approve_rule`] runs.
/// History, cursor, and backoff state are retained, never erased.
pub fn staged_rule_edit(
    mut record: MonitorRecord,
    new_rule: MonitorRule,
    updated_at_ms: f64,
) -> Result<MonitorRecord, String> {
    validate_rule(&new_rule)?;
    record.rule = new_rule;
    record.version = record.version.saturating_add(1).max(1);
    record.updated_at_ms = updated_at_ms;
    record.validate_shape_after_edit()?;
    Ok(record)
}

/// Sentinel approval hash for a parked monitor. It is not hex and can
/// never equal a real [`MonitorRule::approval_hash`], so a parked record
/// fails [`MonitorRecord::is_approved`] until [`approve_rule`] runs.
/// Stored durably (so `needs-approval` survives restarts), never logged
/// as anything but a state label.
pub const UNAPPROVED_SENTINEL: &str = "pending-user-approval";

/// Build a parked (needs-approval) v1 monitor: the Bot stages the watch,
/// the user arms it with an explicit approve call. The record validates
/// but never reports approved — it cannot be constructed approved by
/// accident.
pub fn new_unapproved_monitor(
    id: String,
    bot_id: Option<String>,
    rule: MonitorRule,
    trigger: MonitorTrigger,
    created_at_ms: f64,
) -> Result<MonitorRecord, String> {
    let record = MonitorRecord {
        id,
        bot_id,
        version: 1,
        rule,
        interpreter: None,
        argv: Vec::new(),
        secret_refs: Vec::new(),
        trigger,
        cursor: None,
        enabled: true,
        inference_policy: super::policy::MonitorInferencePolicy::default(),
        approved_rule_hash: UNAPPROVED_SENTINEL.to_string(),
        created_at_ms,
        updated_at_ms: created_at_ms,
        consecutive_errors: 0,
        next_eligible_at_ms: None,
        last_event_id: None,
        last_success_at_ms: None,
        last_error: None,
    };
    record.validate()?;
    debug_assert!(!record.is_approved());
    Ok(record)
}

/// Explicitly approve the record's current rule text.
pub fn approve_rule(mut record: MonitorRecord, updated_at_ms: f64) -> MonitorRecord {
    record.approved_rule_hash = record.rule.approval_hash();
    record.updated_at_ms = updated_at_ms;
    record
}

/// Bind (or re-bind) a committed change event to an enabled reactive
/// responsibility. Binding is outside the approval hash by construction:
/// it changes neither `version` nor `approved_rule_hash`, so binding
/// never parks a running monitor and never unparks a parked one — the
/// user approves *what is watched*, then separately chooses *what runs*.
/// The delegation drain still applies the runner's own enabled/ownership
/// gates afterward; binding alone authorizes nothing.
pub fn bind_responsibility(
    mut record: MonitorRecord,
    responsibility_id: String,
    updated_at_ms: f64,
) -> Result<MonitorRecord, String> {
    let policy = MonitorInferencePolicy::ExplicitResponsibility { responsibility_id };
    policy.validate()?;
    record.inference_policy = policy;
    record.updated_at_ms = updated_at_ms;
    record
        .validate()
        .map_err(|e| format!("binding refused: {e}"))?;
    Ok(record)
}

trait EditShape {
    fn validate_shape_after_edit(&self) -> Result<(), String>;
}

impl EditShape for MonitorRecord {
    fn validate_shape_after_edit(&self) -> Result<(), String> {
        // Approval mismatch is the *expected* post-edit state, so validate
        // everything except the approval equality itself.
        if let Some(reason) = is_bad_id(&self.id, "id") {
            return Err(reason);
        }
        validate_rule(&self.rule)?;
        self.trigger.validate()?;
        if self.approved_rule_hash.is_empty() {
            return Err("approvedRuleHash must not be empty".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::rule::{LocalFileRule, MonitorRule};
    use super::*;

    fn rule(resource: &str) -> MonitorRule {
        MonitorRule::LocalFileDigest(LocalFileRule {
            host_id: "h".to_string(),
            project_id: "p".to_string(),
            resource: resource.to_string(),
            max_bytes: 1024,
        })
    }

    fn approved(rule: &MonitorRule) -> String {
        rule.approval_hash()
    }

    #[test]
    fn new_monitor_requires_matching_approval() {
        let r = rule("a.md");
        assert!(
            new_monitor(
                "m".into(),
                None,
                r.clone(),
                MonitorTrigger::Manual,
                approved(&r),
                1.0
            )
            .is_ok()
        );
        assert!(
            new_monitor(
                "m".into(),
                None,
                r.clone(),
                MonitorTrigger::Manual,
                "stale".into(),
                1.0
            )
            .is_err()
        );
    }

    #[test]
    fn rule_edit_bumps_version_and_invalidates_approval() {
        let r = rule("a.md");
        let record = new_monitor(
            "m".into(),
            None,
            r.clone(),
            MonitorTrigger::Manual,
            approved(&r),
            1.0,
        )
        .unwrap();
        let edited = staged_rule_edit(record, rule("b.md"), 2.0).unwrap();
        assert_eq!(edited.version, 2);
        assert!(!edited.is_approved());
        let approved_record = approve_rule(edited, 3.0);
        assert!(approved_record.is_approved());
    }

    #[test]
    fn rejects_interpreter_argv_and_secret_values() {
        let r = rule("a.md");
        let mut record = new_monitor("m".into(), None, r, MonitorTrigger::Manual, "x".into(), 1.0)
            .unwrap_or_else(|_| {
                let r = rule("a.md");
                MonitorRecord {
                    id: "m".into(),
                    bot_id: None,
                    version: 1,
                    rule: r.clone(),
                    interpreter: None,
                    argv: vec![],
                    secret_refs: vec![],
                    trigger: MonitorTrigger::Manual,
                    cursor: None,
                    enabled: true,
                    inference_policy: super::super::policy::MonitorInferencePolicy::default(),
                    approved_rule_hash: approved(&r),
                    created_at_ms: 1.0,
                    updated_at_ms: 1.0,
                    consecutive_errors: 0,
                    next_eligible_at_ms: None,
                    last_event_id: None,
                    last_success_at_ms: None,
                    last_error: None,
                }
            });
        record.interpreter = Some("sh".into());
        assert!(record.validate().is_err());
        record.interpreter = None;
        record.argv = vec!["-c".into()];
        assert!(record.validate().is_err());
        record.argv.clear();
        record.secret_refs = vec!["TOKEN=abc".into()];
        assert!(record.validate().is_err());
    }
}
