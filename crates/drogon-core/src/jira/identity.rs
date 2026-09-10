//! Jira site identity helpers (R17-A), ported from the fork's
//! `src/main/jira/site-identity.ts`, plus C06's stable task/instance
//! identity: an account-independent instance id and the immutable issue
//! id that survive reconnects with another account, issue key/title
//! renames and daemon restarts.
//! MIT Copyright (c) 2026 Lovecast Inc.

// C06: stable issue→session links. Declared here with `#[path]` because
// `jira/mod.rs` is root-held; the file itself lives at
// `jira/session_links.rs` and moves to `pub mod session_links;` in mod.rs
// verbatim at handover (public path `drogon_core::jira::session_links`).
#[path = "session_links.rs"]
pub mod session_links;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use drogon_protocol::jira::JiraViewer;
use sha2::Digest as _;

/// Domain separation for [`jira_instance_id`], so an instance id can never
/// collide with a legacy [`get_site_id`] connection id or any other hash
/// built from the same URL alphabet.
const INSTANCE_ID_DOMAIN: &[u8] = b"drogon-jira-instance-v1";

/// Trim, default to `https://`, keep origin + path without trailing slash,
/// and drop query/fragment — the fork's `normalizeJiraSiteUrl`.
pub fn normalize_jira_site_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter a valid Jira site URL.".to_string());
    }
    let with_protocol = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    // Split scheme from the rest.
    let (scheme, rest) = match with_protocol.split_once("://") {
        Some((scheme, rest))
            if scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
                && !scheme.is_empty() =>
        {
            (scheme.to_ascii_lowercase(), rest)
        }
        _ => return Err("Enter a valid Jira site URL.".to_string()),
    };
    if rest.is_empty() {
        return Err("Enter a valid Jira site URL.".to_string());
    }
    // Authority + path, without query/fragment.
    let authority_and_path = rest.split(['?', '#']).next().unwrap_or("");
    let (authority, path) = match authority_and_path.find('/') {
        Some(index) => (&authority_and_path[..index], &authority_and_path[index..]),
        None => (authority_and_path, ""),
    };
    let host = authority.rsplit('@').next().unwrap_or(authority);
    if host.is_empty() {
        return Err("Enter a valid Jira site URL.".to_string());
    }
    let path = path.trim_end_matches('/');
    Ok(format!("{scheme}://{host}{path}"))
}

/// Stable per-(site, account) id: sha256, base64url, first 24 chars — the
/// fork's `getSiteId`.
///
/// C06: this is a CONNECTION id (credential pair), not an instance id — it
/// changes when the same Jira site reconnects with another account. Never
/// use it as proof of which Jira instance an issue belongs to; use
/// [`jira_instance_id`] for that.
pub fn get_site_id(site_url: &str, email: &str) -> String {
    let mut hash = sha2::Sha256::new();
    hash.update(site_url.as_bytes());
    hash.update(b"\n");
    hash.update(email.to_lowercase().as_bytes());
    let digest = hash.finalize();
    URL_SAFE_NO_PAD.encode(digest)[..24].to_string()
}

/// Map a `/myself` response to a viewer. Server/DC has no accountId; its
/// stable identifiers are name/key (the fork's `toViewer`).
pub fn to_viewer(data: &serde_json::Value, fallback_email: &str) -> JiraViewer {
    let avatar_urls = data.get("avatarUrls");
    let pick_avatar = |key: &str| {
        avatar_urls
            .and_then(|urls| urls.get(key))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    };
    let account_id = data
        .get("accountId")
        .and_then(serde_json::Value::as_str)
        .or_else(|| data.get("name").and_then(serde_json::Value::as_str))
        .or_else(|| data.get("key").and_then(serde_json::Value::as_str))
        .unwrap_or_default()
        .to_string();
    JiraViewer {
        account_id,
        display_name: data
            .get("displayName")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(fallback_email)
            .to_string(),
        email: Some(
            data.get("emailAddress")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(fallback_email)
                .to_string(),
        ),
        avatar_url: pick_avatar("48x48").or_else(|| pick_avatar("32x32")),
    }
}

// --- C06: stable task/instance identity -----------------------------------

/// Stable, account-independent Jira instance id: sha256 over a domain-
/// separated normalized site URL, base64url, first 24 chars. The SAME
/// instance connected with a different account yields the SAME id, which
/// is exactly what a reconnect must not break; two different instances
/// (different hosts) can never share one id, so equal displayed issue
/// keys stay isolated.
///
/// Errs exactly when [`normalize_jira_site_url`] errs.
pub fn jira_instance_id(site_url: &str) -> Result<String, String> {
    let normalized = normalize_jira_site_url(site_url)?;
    // DNS host case is not significant and the fork's normalizer keeps the
    // entered case, so the hash folds the authority to lowercase — the same
    // instance typed as ACME.atlassian.net and acme.atlassian.net resolves
    // to ONE id across accounts.
    let (scheme, rest) = normalized
        .split_once("://")
        .unwrap_or(("", normalized.as_str()));
    let (host, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };
    let mut hash = sha2::Sha256::new();
    hash.update(INSTANCE_ID_DOMAIN);
    hash.update(b"\n");
    hash.update(scheme.as_bytes());
    hash.update(b"://");
    hash.update(host.to_ascii_lowercase().as_bytes());
    hash.update(path.as_bytes());
    let digest = hash.finalize();
    Ok(URL_SAFE_NO_PAD.encode(digest)[..24].to_string())
}

/// Fold the authority segment of a normalized URL to lowercase (scheme is
/// already lowercase). Path case is significant and preserved.
fn fold_authority_case(normalized: &str) -> String {
    let Some((scheme, rest)) = normalized.split_once("://") else {
        return normalized.to_string();
    };
    match rest.find('/') {
        Some(index) => format!(
            "{scheme}://{}{}",
            rest[..index].to_ascii_lowercase(),
            &rest[index..]
        ),
        None => format!("{scheme}://{}", rest.to_ascii_lowercase()),
    }
}

/// The stable external identity of a Jira task (C06): provider plus the
/// ACTUAL instance (derived from the normalized site URL, never from the
/// credential email or the legacy per-account site id) plus the immutable
/// REST issue id. `key` is display-only and may drift; `title` never
/// participates at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JiraTaskIdentity {
    pub instance_id: String,
    pub instance_url: String,
    /// Immutable Jira REST id (`issues[].id`) — survives key renames and
    /// project moves within the instance.
    pub issue_id: String,
    /// Display key (`DROG-42`), refreshed on every successful bind.
    pub key: String,
}

impl JiraTaskIdentity {
    /// Resolves the identity from the instance site URL and the issue's
    /// immutable id. Anything missing (no site URL, no issue id — e.g. an
    /// issue read from a legacy list before C06) stays unresolved: this
    /// constructor is the single gate, so no caller can silently fall back
    /// to the account email or the display key.
    pub fn resolve(site_url: &str, issue_id: &str, key: &str) -> Result<Self, String> {
        let normalized = normalize_jira_site_url(site_url)?;
        let instance_id = jira_instance_id(&normalized)?;
        // Canonical display/canonical form: same folding as the id (scheme
        // lowercase via normalize, authority case-folded here so both
        // accounts' spellings agree). The legacy normalizer is untouched.
        let instance_url = fold_authority_case(&normalized);
        let issue_id = issue_id.trim();
        if issue_id.is_empty() || issue_id.len() > 64 || issue_id.contains('\0') {
            return Err("Jira issue id is required for a stable task identity".to_string());
        }
        let key = key.trim();
        if key.is_empty() || key.chars().any(|c| c.is_control()) || key.len() > 64 {
            return Err("Jira issue key is required for a stable task identity".to_string());
        }
        Ok(Self {
            instance_id,
            instance_url,
            issue_id: issue_id.to_string(),
            key: key.to_string(),
        })
    }

    /// The provider half of the composite identity; matches the fork's
    /// provider strings so card-property payloads agree.
    pub fn provider() -> &'static str {
        "jira"
    }

    /// Deterministic composite link id, stable across restarts and safe to
    /// log (no URL secrets): `{instance_id}:{issue_id}`.
    pub fn link_id(&self) -> String {
        format!("{}:{}", self.instance_id, self.issue_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_bare_host() {
        assert_eq!(
            normalize_jira_site_url("example.atlassian.net").unwrap(),
            "https://example.atlassian.net"
        );
    }

    #[test]
    fn keeps_path_and_strips_trailing_slash_query_and_fragment() {
        assert_eq!(
            normalize_jira_site_url("https://jira.example.com/jira/?x=1#y").unwrap(),
            "https://jira.example.com/jira"
        );
        assert_eq!(
            normalize_jira_site_url("http://localhost:2990/jira/").unwrap(),
            "http://localhost:2990/jira"
        );
    }

    #[test]
    fn rejects_empty_and_scheme_only_input() {
        assert!(normalize_jira_site_url("   ").is_err());
        assert!(normalize_jira_site_url("https://").is_err());
        assert!(normalize_jira_site_url("://bad").is_err());
    }

    #[test]
    fn site_id_is_stable_case_insensitive_on_email() {
        assert_eq!(
            get_site_id("https://a", "me@example.com"),
            get_site_id("https://a", "ME@EXAMPLE.COM")
        );
        assert_ne!(
            get_site_id("https://a", "me@example.com"),
            get_site_id("https://a", "other@example.com")
        );
        assert_eq!(get_site_id("https://a", "me@example.com").len(), 24);
    }

    #[test]
    fn viewer_falls_back_to_name_and_email() {
        let viewer = to_viewer(
            &serde_json::json!({"name": "jsmith", "displayName": "J Smith"}),
            "fallback@example.com",
        );
        assert_eq!(viewer.account_id, "jsmith");
        assert_eq!(viewer.display_name, "J Smith");
        assert_eq!(viewer.email.as_deref(), Some("fallback@example.com"));
    }

    #[test]
    fn instance_id_is_account_independent_and_distinct_from_connection_id() {
        // Same instance, another account: the stable instance id survives.
        assert_eq!(
            jira_instance_id("https://acme.atlassian.net").unwrap(),
            jira_instance_id("https://acme.atlassian.net").unwrap()
        );
        let identity_a =
            JiraTaskIdentity::resolve("https://acme.atlassian.net", "10001", "DROG-42").unwrap();
        let identity_b =
            JiraTaskIdentity::resolve("https://ACME.atlassian.net/", "10001", "DROG-42").unwrap();
        assert_eq!(identity_a, identity_b);
        // A different instance never shares the identity.
        let other =
            JiraTaskIdentity::resolve("https://globex.atlassian.net", "10001", "DROG-42").unwrap();
        assert_ne!(identity_a.instance_id, other.instance_id);
        assert_ne!(identity_a.link_id(), other.link_id());
        // Connection id stays email-tainted (legacy semantics preserved).
        assert_ne!(
            get_site_id("https://acme.atlassian.net", "a@x.com"),
            get_site_id("https://acme.atlassian.net", "b@x.com")
        );
        assert_ne!(
            identity_a.instance_id,
            get_site_id("https://acme.atlassian.net", "a@x.com")
        );
    }

    #[test]
    fn identity_is_unresolved_without_instance_or_immutable_id() {
        assert!(JiraTaskIdentity::resolve("https://acme.atlassian.net", "", "DROG-42").is_err());
        assert!(JiraTaskIdentity::resolve("https://acme.atlassian.net", "  ", "DROG-42").is_err());
        assert!(JiraTaskIdentity::resolve("", "10001", "DROG-42").is_err());
        assert!(JiraTaskIdentity::resolve("https://", "10001", "DROG-42").is_err());
        assert!(JiraTaskIdentity::resolve("https://acme.atlassian.net", "10001", "").is_err());
        // The display key is NOT an identity input: same instance + id but a
        // renamed key still resolves to the same link id.
        let before =
            JiraTaskIdentity::resolve("https://acme.atlassian.net", "10001", "DROG-42").unwrap();
        let renamed =
            JiraTaskIdentity::resolve("https://acme.atlassian.net", "10001", "OPS-9").unwrap();
        assert_eq!(before.link_id(), renamed.link_id());
    }
}
