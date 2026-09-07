//! Bounded reads pinned to the attempt's retained host-owned PTY stream.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use drogon_orchestration::runs;
use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::{OpaqueCursor, ProcessVerdict};
use drogon_protocol::orchestration_worker::{
    OutputEntry, OutputSource, WorkerReadParams, WorkerReadResult,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::coordination_attempts;
use crate::coordination_runs::encode;
use crate::{Engine, error, session};

#[derive(Deserialize, Serialize)]
struct TerminalCursor {
    version: u8,
    stream: String,
    position: u64,
}

impl Engine {
    pub(crate) fn read_coordination_worker(
        &self,
        params: &WorkerReadParams,
    ) -> Result<Value, RpcError> {
        let attempt = self.coordination_read(|tx| {
            runs::require_coordinator(tx, &params.scope)?;
            coordination_attempts::show(tx, &params.scope, &params.dispatch_id)
        })?;
        let identity = attempt
            .result
            .session_identity
            .as_ref()
            .ok_or_else(|| error::unverifiable("Attempt has no retained output identity."))?;
        let stream = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&json!([
                    "drogon.worker.terminal.v1",
                    self.host_id,
                    params.scope.run_id,
                    params.dispatch_id,
                    identity.session_id,
                    identity.incarnation,
                ]))
                .map_err(|_| error::internal_error("Invalid output identity."))?
            )
        );
        let cursor = parse_cursor(params.cursor.as_ref(), &stream)?;
        if params.source == OutputSource::Transcript {
            return Err(RpcError::new(
                if params.cursor.is_some() {
                    "source_changed"
                } else {
                    "unsupported_feature"
                },
                "This attempt has no verified transcript source; request terminal output without a cursor.",
            ));
        }
        let (handle, _) = self.require_session_with_incarnation(&json!({
            "sessionId":identity.session_id,"incarnation":identity.incarnation,
        }))?;
        let output = session::read(&handle, cursor, 65_536)?;
        if output["session"]["hostId"] != self.host_id
            || output["session"]["workspaceId"] != attempt.result.workspace_id
        {
            return Err(error::unverifiable(
                "Attempt output does not match its execution identity.",
            ));
        }
        let verdict = match output["session"]["verdict"].as_str() {
            Some("live") => ProcessVerdict::Live,
            Some("exited") => ProcessVerdict::Exited,
            _ => ProcessVerdict::Unverifiable,
        };
        let data = output["dataBase64"]
            .as_str()
            .ok_or_else(|| error::internal_error("Invalid terminal output."))?;
        let position = output["nextCursor"]
            .as_u64()
            .ok_or_else(|| error::internal_error("Invalid terminal output cursor."))?;
        let start = output["startCursor"]
            .as_u64()
            .ok_or_else(|| error::internal_error("Invalid terminal output cursor."))?;
        let entries = if data.is_empty() {
            Vec::new()
        } else {
            vec![OutputEntry {
                sequence: start,
                source_identity: stream.clone(),
                fallback_reason: (params.source == OutputSource::Auto)
                    .then(|| "transcript_unavailable".into()),
                content: json!({"dataBase64":data,"startCursor":start,
                    "nextCursor":position,"truncated":output["truncated"]}),
            }]
        };
        // A live empty stream keeps its cursor so later bytes can be tailed.
        let next_cursor = if !entries.is_empty() || verdict != ProcessVerdict::Exited {
            Some(encode_cursor(&stream, position)?)
        } else {
            None
        };
        encode(WorkerReadResult {
            dispatch_id: params.dispatch_id.clone(),
            source: OutputSource::Terminal,
            process_verdict: verdict,
            entries,
            next_cursor,
        })
    }
}

fn parse_cursor(cursor: Option<&OpaqueCursor>, stream: &str) -> Result<u64, RpcError> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    let invalid = || error::invalid_argument("Invalid or mismatched worker output cursor.");
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor.0.strip_prefix("dwo1_").ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    let value: TerminalCursor = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if value.version != 1 || value.stream != stream {
        return Err(invalid());
    }
    Ok(value.position)
}

fn encode_cursor(stream: &str, position: u64) -> Result<OpaqueCursor, RpcError> {
    let bytes = serde_json::to_vec(&TerminalCursor {
        version: 1,
        stream: stream.into(),
        position,
    })
    .map_err(|_| error::internal_error("Invalid worker output cursor."))?;
    Ok(OpaqueCursor(format!(
        "dwo1_{}",
        URL_SAFE_NO_PAD.encode(bytes)
    )))
}
