use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

pub mod automation;
pub mod git;
pub mod orchestration_common;
pub mod orchestration_mail;
pub mod orchestration_question;
pub mod orchestration_run;
pub mod orchestration_scope;
pub mod orchestration_task;
pub mod orchestration_worker;
pub mod project;
pub mod workspace_files;
pub mod worktree;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub protocol: u32,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<String>,
    pub method: String,
    pub params: Value,
}

impl fmt::Debug for Request {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Request")
            .field("protocol", &self.protocol)
            .field("request_id", &self.request_id)
            .field("method", &self.method)
            .finish_non_exhaustive()
    }
}

impl Request {
    pub fn validate(&self) -> Result<(), RpcError> {
        if self.protocol != PROTOCOL_VERSION {
            return Err(RpcError::new(
                "unsupported_protocol",
                "Unsupported protocol version.",
            ));
        }
        if self.request_id.is_empty()
            || self.request_id.len() > 128
            || self.request_id.chars().any(char::is_control)
            || self.method.is_empty()
            || self.method.len() > 128
            || self.method.chars().any(char::is_control)
            || !self.params.is_object()
        {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid request envelope.",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RpcError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl RpcError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable: false,
        }
    }
}

impl fmt::Display for RpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub protocol: u32,
    pub request_id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn success(request_id: impl Into<String>, result: Value) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            request_id: request_id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(request_id: impl Into<String>, error: RpcError) -> Self {
        Self {
            protocol: PROTOCOL_VERSION,
            request_id: request_id.into(),
            ok: false,
            result: None,
            error: Some(error),
        }
    }

    pub fn validate(&self, expected_request_id: &str) -> Result<(), RpcError> {
        if self.protocol != PROTOCOL_VERSION || self.request_id != expected_request_id {
            return Err(RpcError::new(
                "invalid_argument",
                "Response identity or protocol mismatch.",
            ));
        }
        if (self.ok && (self.result.is_none() || self.error.is_some()))
            || (!self.ok && (self.error.is_none() || self.result.is_some()))
        {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid response envelope.",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_additive_fields_without_losing_identity() {
        let request: Request = serde_json::from_value(json!({
            "protocol": 1, "requestId": "abc", "method": "status", "params": {}, "future": true
        }))
        .unwrap();
        assert!(request.validate().is_ok());
        assert_eq!(request.request_id, "abc");
    }

    #[test]
    fn refuses_unsupported_protocol_and_invalid_params() {
        for (protocol, params) in [(2, json!({})), (1, json!([]))] {
            let request = Request {
                protocol,
                request_id: "a".into(),
                auth: None,
                method: "status".into(),
                params,
            };
            assert!(request.validate().is_err());
        }
    }

    #[test]
    fn request_debug_does_not_disclose_auth_or_terminal_input() {
        let request = Request {
            protocol: 1,
            request_id: "a".into(),
            auth: Some("secret-token".into()),
            method: "session.write".into(),
            params: json!({"dataBase64":"secret-data"}),
        };
        let output = format!("{request:?}");
        assert!(!output.contains("secret-token"));
        assert!(!output.contains("secret-data"));
    }

    #[test]
    fn response_requires_exclusive_payload_and_matching_id() {
        let mut response = Response::success("a", json!({"protocol":1}));
        assert!(response.validate("a").is_ok());
        assert!(response.validate("b").is_err());
        response.error = Some(RpcError::new("io_error", "failure"));
        assert!(response.validate("a").is_err());
        let error = Response::failure("a", RpcError::new("not_found", "Missing session."));
        assert!(error.validate("a").is_ok());
        assert!(serde_json::to_value(error).unwrap().get("result").is_none());
    }
}
