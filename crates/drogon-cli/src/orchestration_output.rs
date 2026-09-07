//! Preserve wire bytes in JSON and decode verified terminal chunks for humans.

use drogon_protocol::orchestration_worker::{OutputEntry, OutputSource};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalChunk {
    data_base64: String,
    start_cursor: u64,
    next_cursor: u64,
    truncated: bool,
}

pub(crate) fn terminal_bytes(
    source: OutputSource,
    entry: &OutputEntry,
) -> Result<Option<Vec<u8>>, String> {
    if source != OutputSource::Terminal || entry.content.get("dataBase64").is_none() {
        return Ok(None);
    }
    let chunk: TerminalChunk = serde_json::from_value(entry.content.clone())
        .map_err(|_| "Invalid terminal output chunk".to_string())?;
    if chunk.start_cursor != entry.sequence {
        return Err("Terminal entry sequence differs from its byte cursor".into());
    }
    crate::client::decode_terminal_bytes(&chunk.data_base64, chunk.start_cursor, chunk.next_cursor)
        .map(Some)
}

pub(crate) fn render(source: OutputSource, entry: &OutputEntry) -> String {
    if let Ok(Some(bytes)) = terminal_bytes(source, entry) {
        let text = String::from_utf8_lossy(&bytes);
        let truncated = serde_json::from_value::<TerminalChunk>(entry.content.clone())
            .is_ok_and(|chunk| chunk.truncated);
        return if truncated {
            format!("[earlier terminal output was truncated]\n{text}")
        } else {
            text.into_owned()
        };
    }
    match &entry.content {
        Value::String(text) => text.clone(),
        content => content.to_string(),
    }
}
