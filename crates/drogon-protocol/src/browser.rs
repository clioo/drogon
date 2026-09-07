//! Wire types for the daemon-mediated desktop command relay
//! (`browser.relay.v1`, journeys J3/J4). An agent in a Drogon terminal runs
//! `drogon-cli browser …`; `drogond` enqueues one relay command and blocks
//! (bounded) until the connected desktop executes it against the embedded
//! browser host and reports back. Nothing here touches disk.

use crate::RpcError;
use crate::orchestration_common::validate_opaque_token;

/// Capability advertised by `status` when the relay RPCs are served.
pub const BROWSER_RELAY_CAPABILITY: &str = "browser.relay.v1";

/// Bounded wait a `browser.*` call holds for desktop completion.
pub const DEFAULT_RELAY_TIMEOUT_MS: u64 = 15_000;
pub const MAX_RELAY_TIMEOUT_MS: u64 = 30_000;

/// Bounded wait a `desktop.commands.poll` long-poll holds for new commands.
pub const MAX_RELAY_POLL_WAIT_MS: u64 = 30_000;

/// Snapshot DOM text cap, mirroring the desktop browser host budget.
pub const MAX_RELAY_SNAPSHOT_CHARS: usize = 32_768;

/// Selector/fill budgets: keep the guest `executeJavaScript` frame small.
pub const MAX_SELECTOR_CHARS: usize = 1_024;
pub const MAX_FILL_TEXT_CHARS: usize = 8_192;
pub const MAX_URL_CHARS: usize = 2_048;

/// Relay command kinds; the daemon enqueues these, the desktop executes them.
pub const BROWSER_OPEN_KIND: &str = "browser.open";
pub const BROWSER_NAVIGATE_KIND: &str = "browser.navigate";
pub const BROWSER_SNAPSHOT_KIND: &str = "browser.snapshot";
pub const BROWSER_CLICK_KIND: &str = "browser.click";
pub const BROWSER_FILL_KIND: &str = "browser.fill";
pub const BROWSER_TABS_KIND: &str = "browser.tabs";

/// Typed `desktop_not_connected` failure when no desktop completes the
/// command inside the caller's timeout.
pub fn desktop_not_connected(timeout_ms: u64) -> RpcError {
    let mut error = RpcError::new(
        "desktop_not_connected",
        format!(
            "No connected Drogon desktop completed the browser command within {timeout_ms}ms. \
             Open the Drogon desktop against this data directory and retry."
        ),
    );
    error.retryable = true;
    error
}

pub fn validate_timeout_ms(timeout_ms: Option<u64>) -> Result<u64, RpcError> {
    let timeout = timeout_ms.unwrap_or(DEFAULT_RELAY_TIMEOUT_MS);
    if timeout == 0 || timeout > MAX_RELAY_TIMEOUT_MS {
        return Err(RpcError::new(
            "invalid_argument",
            format!("timeoutMs must be within 1..={MAX_RELAY_TIMEOUT_MS}."),
        ));
    }
    Ok(timeout)
}

pub fn validate_poll_wait_ms(wait_ms: Option<u64>) -> Result<u64, RpcError> {
    let wait = wait_ms.unwrap_or(10_000);
    if wait > MAX_RELAY_POLL_WAIT_MS {
        return Err(RpcError::new(
            "invalid_argument",
            format!("waitMs must be within 0..={MAX_RELAY_POLL_WAIT_MS}."),
        ));
    }
    Ok(wait)
}

pub fn validate_id(value: &str, what: &str) -> Result<(), RpcError> {
    validate_opaque_token(value, 128, &format!("Invalid browser {what}."))?;
    Ok(())
}

pub fn validate_url(url: &str) -> Result<(), RpcError> {
    if url.is_empty() || url.len() > MAX_URL_CHARS || url.contains('\0') {
        return Err(RpcError::new(
            "invalid_argument",
            "Invalid browser URL: must be 1..=2048 characters without NUL.",
        ));
    }
    Ok(())
}

pub fn validate_selector(selector: &str) -> Result<(), RpcError> {
    if selector.is_empty() || selector.len() > MAX_SELECTOR_CHARS || selector.contains('\0') {
        return Err(RpcError::new(
            "invalid_argument",
            "Invalid CSS selector: must be 1..=1024 characters without NUL.",
        ));
    }
    Ok(())
}

pub fn validate_fill_text(text: &str) -> Result<(), RpcError> {
    if text.len() > MAX_FILL_TEXT_CHARS || text.contains('\0') {
        return Err(RpcError::new(
            "invalid_argument",
            "Invalid fill text: must be at most 8192 UTF-8 bytes without NUL.",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserOpenParams {
    pub workspace_id: String,
    pub url: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavigateParams {
    pub tab_id: String,
    pub url: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSnapshotParams {
    pub tab_id: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserClickParams {
    pub tab_id: String,
    pub selector: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFillParams {
    pub tab_id: String,
    pub selector: String,
    pub text: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabsParams {
    pub workspace_id: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPollParams {
    pub client_id: String,
    pub wait_ms: Option<u64>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayCompleteParams {
    pub command_id: String,
    pub ok: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<RelayErrorBody>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayErrorBody {
    pub code: String,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn capability_and_kinds_are_exact_wire_strings() {
        assert_eq!(BROWSER_RELAY_CAPABILITY, "browser.relay.v1");
        assert_eq!(BROWSER_OPEN_KIND, "browser.open");
        assert_eq!(BROWSER_NAVIGATE_KIND, "browser.navigate");
        assert_eq!(BROWSER_SNAPSHOT_KIND, "browser.snapshot");
        assert_eq!(BROWSER_CLICK_KIND, "browser.click");
        assert_eq!(BROWSER_FILL_KIND, "browser.fill");
        assert_eq!(BROWSER_TABS_KIND, "browser.tabs");
    }

    #[test]
    fn timeout_defaults_and_bounds() {
        assert_eq!(validate_timeout_ms(None).unwrap(), DEFAULT_RELAY_TIMEOUT_MS);
        assert_eq!(validate_timeout_ms(Some(1)).unwrap(), 1);
        assert_eq!(
            validate_timeout_ms(Some(MAX_RELAY_TIMEOUT_MS)).unwrap(),
            MAX_RELAY_TIMEOUT_MS
        );
        assert!(validate_timeout_ms(Some(0)).is_err());
        assert!(validate_timeout_ms(Some(MAX_RELAY_TIMEOUT_MS + 1)).is_err());
    }

    #[test]
    fn poll_wait_defaults_and_bounds() {
        assert_eq!(validate_poll_wait_ms(None).unwrap(), 10_000);
        assert_eq!(validate_poll_wait_ms(Some(0)).unwrap(), 0);
        assert!(validate_poll_wait_ms(Some(MAX_RELAY_POLL_WAIT_MS + 1)).is_err());
    }

    #[test]
    fn selector_and_fill_text_reject_nul_and_oversize() {
        assert!(validate_selector("#ok").is_ok());
        assert!(validate_selector("").is_err());
        assert!(validate_selector(&"x".repeat(MAX_SELECTOR_CHARS + 1)).is_err());
        assert!(validate_selector("a\0b").is_err());
        assert!(validate_fill_text("hello").is_ok());
        assert!(validate_fill_text(&"x".repeat(MAX_FILL_TEXT_CHARS + 1)).is_err());
        assert!(validate_fill_text("a\0b").is_err());
    }

    #[test]
    fn url_rejects_empty_oversize_and_nul() {
        assert!(validate_url("https://example.test/").is_ok());
        assert!(validate_url("").is_err());
        assert!(validate_url(&"x".repeat(MAX_URL_CHARS + 1)).is_err());
        assert!(validate_url("a\0b").is_err());
    }

    #[test]
    fn open_params_accept_additive_fields_and_optional_url() {
        let params: BrowserOpenParams = serde_json::from_value(json!({
            "workspaceId": "w1", "future": true
        }))
        .unwrap();
        assert_eq!(params.workspace_id, "w1");
        assert_eq!(params.url, None);
        let with_url: BrowserOpenParams = serde_json::from_value(json!({
            "workspaceId": "w1", "url": "https://example.test/"
        }))
        .unwrap();
        assert_eq!(with_url.url.as_deref(), Some("https://example.test/"));
    }

    #[test]
    fn complete_params_carry_result_or_error_shapes() {
        let ok: RelayCompleteParams = serde_json::from_value(json!({
            "commandId": "c1", "ok": true, "result": {"tabId": "t1"}
        }))
        .unwrap();
        assert!(ok.ok);
        assert!(ok.error.is_none());
        let failed: RelayCompleteParams = serde_json::from_value(json!({
            "commandId": "c1", "ok": false,
            "error": {"code": "browser_no_tab", "message": "Tab is not open."}
        }))
        .unwrap();
        assert!(!failed.ok);
        assert_eq!(failed.error.unwrap().code, "browser_no_tab");
    }

    #[test]
    fn desktop_not_connected_is_typed_and_retryable() {
        let error = desktop_not_connected(15000);
        assert_eq!(error.code, "desktop_not_connected");
        assert!(error.retryable);
        assert!(error.message.contains("15000"));
    }
}
