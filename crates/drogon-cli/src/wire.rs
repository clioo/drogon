//! Envelope construction and strict response validation for protocol v1.
//!
//! Pure layer (no I/O) so the bounded-frame and identity rules are unit
//! testable: requests are bounded to `MAX_FRAME_BYTES` before writing,
//! responses must carry protocol 1, echo the caller's request id, and carry
//! exactly one of result/error.

use drogon_protocol::{MAX_FRAME_BYTES, PROTOCOL_VERSION, Request, Response};
use serde_json::Value;

use crate::error::{CliError, invalid_argument};

/// A validated `ok:true` response.
#[derive(Debug)]
pub struct OkResponse {
    pub request_id: String,
    /// The raw response object as received (additive fields preserved).
    pub raw: Value,
    pub result: Value,
}

/// A validated `ok:false` response.
pub struct ErrorResponse {
    pub raw: Value,
    pub error: drogon_protocol::RpcError,
}

pub fn build_frame(
    request_id: &str,
    auth_token: &str,
    method: &str,
    params: &Value,
) -> Result<Vec<u8>, CliError> {
    let request = Request {
        protocol: PROTOCOL_VERSION,
        request_id: request_id.to_string(),
        auth: Some(auth_token.to_string()),
        method: method.to_string(),
        params: params.clone(),
    };
    request
        .validate()
        .map_err(|err| CliError::local(err, request_id))?;
    let mut line = serde_json::to_vec(&request).map_err(|err| {
        CliError::local(
            internal(format!("cannot encode request: {err}")),
            request_id,
        )
    })?;
    line.push(b'\n');
    if line.len() > MAX_FRAME_BYTES {
        return Err(CliError::local(
            invalid_argument(format!(
                "request frame would exceed the {MAX_FRAME_BYTES}-byte protocol limit"
            )),
            request_id,
        ));
    }
    Ok(line)
}

/// Parses and strictly validates one response frame. Any violation is a
/// client-detected protocol failure (`invalid_argument`), never a silent pass.
pub fn parse_response(frame: &[u8], expected_request_id: &str) -> Result<OkResponse, CliError> {
    let raw: Value = serde_json::from_slice(frame).map_err(|err| {
        CliError::local(
            invalid_argument(format!("response frame is not valid JSON: {err}")),
            expected_request_id,
        )
    })?;
    let response: Response = serde_json::from_value(raw.clone()).map_err(|err| {
        CliError::local(
            invalid_argument(format!("response envelope has an invalid shape: {err}")),
            expected_request_id,
        )
    })?;
    response
        .validate(expected_request_id)
        .map_err(|err| CliError::local(err, expected_request_id))?;
    match (response.ok, response.result, response.error) {
        (true, Some(result), None) => Ok(OkResponse {
            request_id: response.request_id,
            raw,
            result,
        }),
        (false, None, Some(error)) => Err(CliError::Server { error, raw }),
        _ => unreachable!("Response::validate enforces exclusive result/error"),
    }
}

fn internal(message: impl Into<String>) -> drogon_protocol::RpcError {
    drogon_protocol::RpcError::new("internal_error", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame_for(request_id: &str, method: &str) -> Vec<u8> {
        build_frame(request_id, "token", method, &json!({})).unwrap()
    }

    #[test]
    fn request_frame_is_single_line_json_with_auth() {
        let frame = frame_for("rid-1", "status");
        assert_eq!(frame.last(), Some(&b'\n'));
        assert_eq!(frame.iter().filter(|b| **b == b'\n').count(), 1);
        let value: Value = serde_json::from_slice(&frame[..frame.len() - 1]).unwrap();
        assert_eq!(value["protocol"], 1);
        assert_eq!(value["requestId"], "rid-1");
        assert_eq!(value["method"], "status");
        assert_eq!(value["auth"], "token");
        assert_eq!(value["params"], json!({}));
    }

    #[test]
    fn oversize_request_is_rejected_before_io() {
        let big = "x".repeat(MAX_FRAME_BYTES);
        let err = build_frame("rid", "token", "rpc", &json!({ "filler": big })).unwrap_err();
        assert!(matches!(err, CliError::Local { .. }));
        assert!(err.to_string().contains("protocol limit"));
    }

    #[test]
    fn ok_response_round_trips_and_keeps_additive_fields() {
        let raw = json!({
            "protocol": 1,
            "requestId": "rid",
            "ok": true,
            "result": { "hostId": "h" },
            "futureField": { "a": 1 }
        });
        let mut bytes = serde_json::to_vec(&raw).unwrap();
        bytes.push(b'\n');
        let ok = parse_response(&bytes, "rid").unwrap();
        assert_eq!(ok.result["hostId"], "h");
        assert_eq!(ok.raw["futureField"], json!({ "a": 1 }));
    }

    #[test]
    fn server_failure_surfaces_the_envelope() {
        let raw = json!({
            "protocol": 1,
            "requestId": "rid",
            "ok": false,
            "error": { "code": "not_found", "message": "missing session", "retryable": false }
        });
        let mut bytes = serde_json::to_vec(&raw).unwrap();
        bytes.push(b'\n');
        match parse_response(&bytes, "rid") {
            Err(CliError::Server { error, raw }) => {
                assert_eq!(error.code, "not_found");
                assert_eq!(raw["error"]["retryable"], false);
            }
            other => panic!("expected server error, got {other:?}"),
        }
    }

    #[test]
    fn rejects_protocol_and_identity_mismatches() {
        let ok_with_wrong_protocol = json!({
            "protocol": 2, "requestId": "rid", "ok": true, "result": {}
        });
        let mut bytes = serde_json::to_vec(&ok_with_wrong_protocol).unwrap();
        bytes.push(b'\n');
        let err = parse_response(&bytes, "rid").unwrap_err();
        assert!(matches!(err, CliError::Local { .. }));
        assert!(err.to_string().contains("mismatch") || err.to_string().contains("Invalid"));

        let ok_with_wrong_id = json!({
            "protocol": 1, "requestId": "other", "ok": true, "result": {}
        });
        let mut bytes = serde_json::to_vec(&ok_with_wrong_id).unwrap();
        bytes.push(b'\n');
        assert!(parse_response(&bytes, "rid").is_err());
    }

    #[test]
    fn rejects_envelopes_without_exclusive_payload() {
        // ok:true but carries an error instead of a result.
        let bad = json!({
            "protocol": 1, "requestId": "rid", "ok": true,
            "error": { "code": "io_error", "message": "x", "retryable": false }
        });
        let mut bytes = serde_json::to_vec(&bad).unwrap();
        bytes.push(b'\n');
        assert!(parse_response(&bytes, "rid").is_err());

        // ok:true with neither payload.
        let empty = json!({ "protocol": 1, "requestId": "rid", "ok": true });
        let mut bytes = serde_json::to_vec(&empty).unwrap();
        bytes.push(b'\n');
        assert!(parse_response(&bytes, "rid").is_err());
    }

    #[test]
    fn rejects_non_json_frames() {
        assert!(parse_response(b"not json\n", "rid").is_err());
    }
}
