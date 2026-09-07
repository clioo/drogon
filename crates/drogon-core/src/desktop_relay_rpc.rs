//! Daemon-mediated desktop command relay for `browser.relay.v1` (journeys
//! J3/J4). The daemon owns an in-memory queue of desktop-executed commands:
//! `browser.*` calls enqueue one command and block (bounded) until the
//! connected desktop long-polls it via `desktop.commands.poll`, executes it
//! against the embedded browser host, and reports back via
//! `desktop.commands.complete`. Inside a Drogon terminal the `drogon-cli`
//! shim (and the `drogon` alias) is already on `PATH`, so agents drive the
//! relay with no `--data-dir` flag.
//!
//! Persist nothing: the queue lives in [`RelayState`] on the `Engine` and is
//! cleared on daemon restart. These RPCs bypass the request ledger and the
//! quiescence gate on purpose — they touch no database rows and no sessions,
//! so there is nothing durable to dedupe or fence.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use drogon_protocol::browser::{
    self, BROWSER_CLICK_KIND, BROWSER_FILL_KIND, BROWSER_NAVIGATE_KIND, BROWSER_OPEN_KIND,
    BROWSER_SNAPSHOT_KIND, BROWSER_TABS_KIND, MAX_RELAY_SNAPSHOT_CHARS, RelayCompleteParams,
    RelayPollParams,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::{Engine, error};

/// One desktop-executed command waiting for (or holding) a completion.
struct RelayCommand {
    kind: &'static str,
    params: Value,
    enqueued_at: Instant,
    delivered: bool,
    completion: Option<RelayCompletion>,
}

struct RelayCompletion {
    ok: bool,
    result: Option<Value>,
    error: Option<RelayError>,
}

struct RelayError {
    code: String,
    message: String,
    retryable: bool,
}

#[derive(Default)]
pub(crate) struct RelayState {
    sequence: u64,
    commands: HashMap<String, RelayCommand>,
    order: VecDeque<String>,
    last_poll_ms: u64,
}

impl RelayState {
    fn mint_id(&mut self) -> String {
        self.sequence += 1;
        format!("relay-{}", self.sequence)
    }

    /// Drop commands no waiter can still observe: timed-out waiters remove
    /// their own command, so anything left older than the maximum relay
    /// timeout is an orphan (e.g. a desktop that polled but never completed).
    fn purge_orphans(&mut self) {
        let max_age = Duration::from_millis(browser::MAX_RELAY_TIMEOUT_MS + 5_000);
        while let Some(front) = self.order.front() {
            let stale = self
                .commands
                .get(front)
                .is_none_or(|command| command.enqueued_at.elapsed() > max_age);
            if !stale {
                break;
            }
            if let Some(front) = self.order.pop_front() {
                self.commands.remove(&front);
            }
        }
    }
}

fn decode<T: DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone())
        .map_err(|_| error::invalid_argument("Invalid browser relay parameters."))
}

/// Cap a desktop-reported snapshot result the way the files budgets cap
/// reads: DOM text beyond the budget is truncated in place and flagged,
/// never rejected, so a large page still yields a bounded usable result.
fn cap_snapshot_result(mut result: Value) -> Value {
    if let Some(text) = result.get("text").and_then(Value::as_str) {
        let chars = text.chars().count();
        if chars > MAX_RELAY_SNAPSHOT_CHARS {
            let truncated: String = text.chars().take(MAX_RELAY_SNAPSHOT_CHARS).collect();
            if let Some(map) = result.as_object_mut() {
                map.insert("text".to_string(), Value::String(truncated));
                map.insert("truncated".to_string(), Value::Bool(true));
            }
        }
    }
    result
}

impl Engine {
    /// Enqueue one relay command and block (bounded) for the desktop's
    /// completion. No desktop, no completion: the caller gets the typed
    /// `desktop_not_connected` error within its own timeout.
    fn relay_roundtrip(
        &self,
        kind: &'static str,
        params: Value,
        timeout_ms: u64,
    ) -> Result<Value, RpcError> {
        let command_id = {
            let mut relay = self.desktop_relay.lock().unwrap();
            relay.purge_orphans();
            let command_id = relay.mint_id();
            relay.order.push_back(command_id.clone());
            relay.commands.insert(
                command_id.clone(),
                RelayCommand {
                    kind,
                    params,
                    enqueued_at: Instant::now(),
                    delivered: false,
                    completion: None,
                },
            );
            command_id
        };
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            let completion = {
                let relay = self.desktop_relay.lock().unwrap();
                relay.commands.get(&command_id).and_then(|command| {
                    command.completion.as_ref().map(|completion| {
                        (
                            completion.ok,
                            completion.result.clone(),
                            completion.error.as_ref().map(|error| {
                                (error.code.clone(), error.message.clone(), error.retryable)
                            }),
                        )
                    })
                })
            };
            if let Some((ok, result, error)) = completion {
                let mut relay = self.desktop_relay.lock().unwrap();
                relay.commands.remove(&command_id);
                relay.order.retain(|id| id != &command_id);
                if ok {
                    return Ok(result.unwrap_or(Value::Null));
                }
                let (code, message, retryable) = error.unwrap_or_else(|| {
                    (
                        "internal_error".to_string(),
                        "Desktop reported failure without detail.".to_string(),
                        false,
                    )
                });
                let mut failure = RpcError::new(code, message);
                failure.retryable = retryable;
                return Err(failure);
            }
            if Instant::now() >= deadline {
                let mut relay = self.desktop_relay.lock().unwrap();
                relay.commands.remove(&command_id);
                relay.order.retain(|id| id != &command_id);
                return Err(browser::desktop_not_connected(timeout_ms));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub(super) fn desktop_commands_poll(&self, value: &Value) -> Result<Value, RpcError> {
        let params: RelayPollParams = decode(value)?;
        browser::validate_id(&params.client_id, "client id")?;
        let wait_ms = browser::validate_poll_wait_ms(params.wait_ms)?;
        {
            let mut relay = self.desktop_relay.lock().unwrap();
            relay.last_poll_ms = crate::now_unix_ms();
        }
        let deadline = Instant::now() + Duration::from_millis(wait_ms);
        loop {
            let drained = {
                let mut relay = self.desktop_relay.lock().unwrap();
                let ids: Vec<String> = relay.order.iter().cloned().collect();
                let mut drained = Vec::new();
                for id in &ids {
                    if let Some(command) = relay.commands.get_mut(id)
                        && !command.delivered
                        && command.completion.is_none()
                    {
                        command.delivered = true;
                        drained.push(json!({
                            "commandId": id,
                            "kind": command.kind,
                            "params": command.params,
                        }));
                    }
                }
                drained
            };
            if !drained.is_empty() || Instant::now() >= deadline {
                return Ok(json!({ "commands": drained }));
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    pub(super) fn desktop_commands_complete(&self, value: &Value) -> Result<Value, RpcError> {
        let params: RelayCompleteParams = decode(value)?;
        browser::validate_id(&params.command_id, "command id")?;
        let completion = match (params.ok, params.result, params.error) {
            (true, Some(result), None) => RelayCompletion {
                ok: true,
                result: Some(cap_snapshot_result(result)),
                error: None,
            },
            (false, None, Some(error)) => {
                browser::validate_id(&error.code, "error code")?;
                if error.message.is_empty()
                    || error.message.len() > 2_048
                    || error.message.contains('\0')
                {
                    return Err(error::invalid_argument(
                        "Desktop error message must be 1..=2048 characters without NUL.",
                    ));
                }
                RelayCompletion {
                    ok: false,
                    result: None,
                    error: Some(RelayError {
                        code: error.code,
                        message: error.message,
                        retryable: false,
                    }),
                }
            }
            _ => {
                return Err(error::invalid_argument(
                    "Completion needs ok:true with a result or ok:false with an error.",
                ));
            }
        };
        let mut relay = self.desktop_relay.lock().unwrap();
        match relay.commands.get_mut(&params.command_id) {
            Some(command) => {
                command.completion = Some(completion);
                Ok(json!({ "commandId": params.command_id }))
            }
            None => Err(error::not_found(
                "Unknown relay command; it may have timed out.",
            )),
        }
    }

    pub(super) fn do_browser_open(&self, value: &Value) -> Result<Value, RpcError> {
        let params: browser::BrowserOpenParams = decode(value)?;
        browser::validate_id(&params.workspace_id, "workspace id")?;
        if let Some(url) = &params.url {
            browser::validate_url(url)?;
        }
        let timeout_ms = browser::validate_timeout_ms(params.timeout_ms)?;
        let mut wire = json!({ "workspaceId": params.workspace_id });
        if let Some(url) = params.url {
            wire["url"] = json!(url);
        }
        self.relay_roundtrip(BROWSER_OPEN_KIND, wire, timeout_ms)
    }

    pub(super) fn do_browser_navigate(&self, value: &Value) -> Result<Value, RpcError> {
        let params: browser::BrowserNavigateParams = decode(value)?;
        browser::validate_id(&params.tab_id, "tab id")?;
        browser::validate_url(&params.url)?;
        let timeout_ms = browser::validate_timeout_ms(params.timeout_ms)?;
        self.relay_roundtrip(
            BROWSER_NAVIGATE_KIND,
            json!({ "tabId": params.tab_id, "url": params.url }),
            timeout_ms,
        )
    }

    pub(super) fn do_browser_snapshot(&self, value: &Value) -> Result<Value, RpcError> {
        let params: browser::BrowserSnapshotParams = decode(value)?;
        browser::validate_id(&params.tab_id, "tab id")?;
        let timeout_ms = browser::validate_timeout_ms(params.timeout_ms)?;
        self.relay_roundtrip(
            BROWSER_SNAPSHOT_KIND,
            json!({ "tabId": params.tab_id }),
            timeout_ms,
        )
    }

    pub(super) fn do_browser_click(&self, value: &Value) -> Result<Value, RpcError> {
        let params: browser::BrowserClickParams = decode(value)?;
        browser::validate_id(&params.tab_id, "tab id")?;
        browser::validate_selector(&params.selector)?;
        let timeout_ms = browser::validate_timeout_ms(params.timeout_ms)?;
        self.relay_roundtrip(
            BROWSER_CLICK_KIND,
            json!({ "tabId": params.tab_id, "selector": params.selector }),
            timeout_ms,
        )
    }

    pub(super) fn do_browser_fill(&self, value: &Value) -> Result<Value, RpcError> {
        let params: browser::BrowserFillParams = decode(value)?;
        browser::validate_id(&params.tab_id, "tab id")?;
        browser::validate_selector(&params.selector)?;
        browser::validate_fill_text(&params.text)?;
        let timeout_ms = browser::validate_timeout_ms(params.timeout_ms)?;
        self.relay_roundtrip(
            BROWSER_FILL_KIND,
            json!({ "tabId": params.tab_id, "selector": params.selector, "text": params.text }),
            timeout_ms,
        )
    }

    pub(super) fn do_browser_tabs(&self, value: &Value) -> Result<Value, RpcError> {
        let params: browser::BrowserTabsParams = decode(value)?;
        browser::validate_id(&params.workspace_id, "workspace id")?;
        let timeout_ms = browser::validate_timeout_ms(params.timeout_ms)?;
        self.relay_roundtrip(
            BROWSER_TABS_KIND,
            json!({ "workspaceId": params.workspace_id }),
            timeout_ms,
        )
    }
}
