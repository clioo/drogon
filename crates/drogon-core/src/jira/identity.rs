//! Jira site identity helpers (R17-A), ported from the fork's
//! `src/main/jira/site-identity.ts`.
//! MIT Copyright (c) 2026 Lovecast Inc.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use drogon_protocol::jira::JiraViewer;
use sha2::Digest as _;

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
}
