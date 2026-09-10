//! Frozen initial monitor rule set (C10 checkpoint 1).
//!
//! Exactly one rule type exists: `local_file_digest.v1` — an approved,
//! scoped local-file content digest with bounded bytes and an explicit
//! `(host_id, project_id, resource)` scope. No shell, no interpreter, no
//! network, no generic plugin or supervisor.
//!
//! The caller reads the file bytes (bounded, with its own timeout) outside
//! any DB lock and hands them to `super::eval`; this module only validates
//! the rule shape and derives the approval hash. Cooperative byte limits
//! are not proof of cancellable I/O — see `super` for the honesty note.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The only admitted rule kind string.
pub const RULE_KIND_LOCAL_FILE_DIGEST: &str = "local_file_digest.v1";
/// Schema version of the rule shape itself.
pub const RULE_SCHEMA_VERSION: u32 = 1;
/// Longest admitted scope/path string in bytes (host, project, resource).
pub const MAX_SCOPE_STRING_BYTES: usize = 1024;
/// Hard ceiling for any monitored file read in bytes (256 KiB).
pub const MAX_FILE_BYTES: u64 = 256 * 1024;

/// A single watched file, project-relative. `max_bytes` is the monitor
/// author's own bound and must never exceed [`MAX_FILE_BYTES`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileRule {
    pub host_id: String,
    pub project_id: String,
    /// Project-relative POSIX path (e.g. `notes/status.md`). Never
    /// absolute, never containing `..`.
    pub resource: String,
    pub max_bytes: u64,
}

/// The frozen rule enum. One variant today; new variants require a new
/// checkpoint and a schema version bump, never a silent extension.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MonitorRule {
    #[serde(rename = "local_file_digest.v1")]
    LocalFileDigest(LocalFileRule),
}

impl MonitorRule {
    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::LocalFileDigest(_) => RULE_KIND_LOCAL_FILE_DIGEST,
        }
    }

    pub fn local_file(&self) -> &LocalFileRule {
        match self {
            Self::LocalFileDigest(inner) => inner,
        }
    }

    /// Canonical bytes for approval hashing (field order is stable).
    pub fn canonical_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// Approval hash: `sha256` hex of the canonical rule bytes. Any rule
    /// edit changes this value and invalidates prior approval.
    pub fn approval_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.canonical_bytes());
        format!("{:x}", hasher.finalize())
    }
}

fn is_bad_scope_string(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some("must not be empty".to_string());
    }
    if value.len() > MAX_SCOPE_STRING_BYTES {
        return Some(format!("must be at most {MAX_SCOPE_STRING_BYTES} bytes"));
    }
    if value.bytes().any(|b| b == 0 || b.is_ascii_control()) {
        return Some("must not contain NUL or control characters".to_string());
    }
    None
}

fn validate_resource(resource: &str) -> Result<(), String> {
    if let Some(reason) = is_bad_scope_string(resource) {
        return Err(format!("resource {reason}"));
    }
    if resource.starts_with('/') {
        return Err("resource must be project-relative, not absolute".to_string());
    }
    if resource.ends_with('/') {
        return Err("resource must name a file, not a directory".to_string());
    }
    for segment in resource.split('/') {
        if segment.is_empty() {
            return Err("resource must not contain empty path segments".to_string());
        }
        if segment == "." || segment == ".." {
            return Err("resource must not contain '.' or '..' segments".to_string());
        }
        if segment.bytes().any(|b| b == b'\\') {
            return Err("resource must use '/' separators only".to_string());
        }
    }
    Ok(())
}

/// Validate the rule shape. Returns the canonical rule on success.
pub fn validate_rule(rule: &MonitorRule) -> Result<(), String> {
    match rule {
        MonitorRule::LocalFileDigest(inner) => {
            if let Some(reason) = is_bad_scope_string(&inner.host_id) {
                return Err(format!("hostId {reason}"));
            }
            if let Some(reason) = is_bad_scope_string(&inner.project_id) {
                return Err(format!("projectId {reason}"));
            }
            validate_resource(&inner.resource)?;
            if inner.max_bytes == 0 || inner.max_bytes > MAX_FILE_BYTES {
                return Err(format!(
                    "maxBytes must be 1..={MAX_FILE_BYTES}, got {}",
                    inner.max_bytes
                ));
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_rule() -> MonitorRule {
        MonitorRule::LocalFileDigest(LocalFileRule {
            host_id: "host-1".to_string(),
            project_id: "proj-1".to_string(),
            resource: "notes/status.md".to_string(),
            max_bytes: 64 * 1024,
        })
    }

    #[test]
    fn accepts_a_scoped_relative_file() {
        let rule = good_rule();
        assert_eq!(rule.kind_str(), RULE_KIND_LOCAL_FILE_DIGEST);
        assert_eq!(RULE_SCHEMA_VERSION, 1);
        assert!(validate_rule(&rule).is_ok());
    }

    #[test]
    fn rejects_absolute_and_dotdot_resources() {
        for bad in [
            "/etc/passwd",
            "../secret",
            "a/../../b",
            "dir/",
            "a//b",
            "a\\.md",
        ] {
            let mut rule = good_rule();
            let MonitorRule::LocalFileDigest(inner) = &mut rule;
            inner.resource = bad.to_string();
            assert!(validate_rule(&rule).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn rejects_oversized_and_zero_bounds() {
        let mut rule = good_rule();
        let MonitorRule::LocalFileDigest(inner) = &mut rule;
        inner.max_bytes = MAX_FILE_BYTES + 1;
        assert!(validate_rule(&rule).is_err());
        let mut rule = good_rule();
        let MonitorRule::LocalFileDigest(inner) = &mut rule;
        inner.max_bytes = 0;
        assert!(validate_rule(&rule).is_err());
    }

    #[test]
    fn approval_hash_changes_on_any_edit() {
        let a = good_rule();
        let mut b = a.clone();
        let MonitorRule::LocalFileDigest(inner) = &mut b;
        inner.resource = "notes/other.md".to_string();
        assert_ne!(a.approval_hash(), b.approval_hash());
    }
}
