//! Preserve wire bytes in JSON and decode verified terminal chunks for humans.

use drogon_protocol::orchestration_mail::{InboxResult, MessageSummary};
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

/// Source `formatMessageReadOnlyTag`: marks legacy inspect-only rows. Native
/// mail has no legacy contract, so no retained row ever carries the tag; the
/// helper exists so the inbox head format stays byte-aligned with source.
pub(crate) fn format_inbox_read_only_tag(_message: &MessageSummary) -> &'static str {
    ""
}

/// Source `formatOrchestrationCheckText` rendering for human output: an
/// optional server `formatted` block wins verbatim; otherwise one compact
/// line per message (`<id>[tag] [<type>] from=<from> "<subject>"`), an
/// optional `Delivery <id>` first line, exact source wait texts, and an
/// empty `No messages.` Local `--format` expansion applies only when the
/// host did not already provide `formatted`.
pub(crate) fn format_check(
    result: &drogon_protocol::orchestration_mail::CheckResult,
    format_requested: bool,
) -> String {
    if let Some(formatted) = &result.formatted {
        return formatted.clone();
    }
    if format_requested && !result.messages.is_empty() {
        return format_check_expanded(&result.messages);
    }
    if result.messages.is_empty() {
        if result.timed_out {
            return "Wait timed out; no messages were consumed.".to_string();
        }
        if result.cancelled {
            return if result.connection_lost {
                "Wait cancelled because the connection closed; no messages were consumed."
                    .to_string()
            } else {
                "Wait cancelled; no messages were consumed.".to_string()
            };
        }
        return "No messages.".to_string();
    }
    let mut lines = Vec::new();
    if let Some(delivery) = &result.delivery {
        lines.push(format!("Delivery {}", delivery.delivery_id));
    }
    for message in &result.messages {
        lines.push(format!(
            "{}{} [{}] from={} \"{}\"",
            message.message_id,
            message.priority.tag(),
            message.kind.display_name(),
            message.from_actor,
            message.subject,
        ));
    }
    if let Some(cursor) = &result.next_cursor {
        lines.push(format!("More: --cursor {}", cursor.0));
    }
    lines.join("\n")
}

/// Source `formatLegacyAwareCheckMessages` structure with native addressing:
/// `[subject]`/`[body]`/`[payload]` blocks plus a reply hint naming this
/// binary. Used when `--format` was requested but the host provided no
/// server-side `formatted` block (older daemon).
pub(crate) fn format_check_expanded(messages: &[MessageSummary]) -> String {
    messages
        .iter()
        .map(|message| {
            let mut lines = vec![
                format!(
                    "{}{} [{}] from={}",
                    message.message_id,
                    message.priority.tag(),
                    message.kind.display_name(),
                    message.from_actor,
                ),
                quoted_block("subject", &message.subject),
            ];
            if let Some(body) = &message.body {
                lines.push(quoted_block("body", body));
            }
            if let Some(payload) = &message.payload {
                let rendered =
                    serde_json::to_string(payload).unwrap_or_else(|_| payload.to_string());
                lines.push(quoted_block("payload", &rendered));
            }
            lines.push(format!(
                "[Reply: drogon-cli orchestration reply --id {} --body \"...\"]",
                message.message_id,
            ));
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Source `escapeTerminalControlCharacters`: printable ASCII, `\n` and
/// non-control Unicode pass through, other codes become `\xNN`.
fn escape_control(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        let code = ch as u32;
        if ch == '\n' || (0x20..0x7f).contains(&code) || code > 0x9f {
            out.push(ch);
        } else {
            out.push_str(&format!("\\x{code:02x}"));
        }
    }
    out
}

fn quoted_block(label: &str, value: &str) -> String {
    let indented: Vec<String> = escape_control(value)
        .split('\n')
        .map(|line| format!("  {line}"))
        .collect();
    format!("[{label}]\n{}", indented.join("\n"))
}

/// Source inbox sweep rendering: one head line per message, `--full` appends
/// the body and a `[payload]` line, messages joined blank-line separated.
/// Empty sweeps read `No messages.`
pub(crate) fn format_inbox(result: &InboxResult, full: bool) -> String {
    if result.count == 0 {
        return "No messages.".to_string();
    }
    // Why: default output omits body/payload for at-a-glance sweeps; --full
    // prints them for auditing.
    result
        .messages
        .iter()
        .map(|message| {
            let head = format!(
                "{}{} {} -> {}: \"{}\"",
                message.message_id,
                format_inbox_read_only_tag(message),
                message.from_actor,
                message.to_actor.as_deref().unwrap_or("?"),
                message.subject
            );
            if !full {
                return head;
            }
            let mut parts = vec![head];
            if let Some(body) = &message.body
                && !body.is_empty()
            {
                parts.push(body.clone());
            }
            if let Some(payload) = &message.payload {
                parts.push(format!("[payload] {payload}"));
            }
            parts.join("\n")
        })
        .collect::<Vec<_>>()
        .join(if full { "\n\n" } else { "\n" })
}
