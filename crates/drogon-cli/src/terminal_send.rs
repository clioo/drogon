//! How `terminal send` turns `--text` into PTY input (issue #599).
//!
//! Two facts about terminals decide everything here.
//!
//! 1. **Return is a carriage return, not a line feed.** When a human presses
//!    Enter, the terminal puts `\r` (0x0D) on the wire. A TUI in raw mode
//!    (`ICRNL` off — every agent harness Drogon launches) therefore reads
//!    `\r` and nothing else as "submit"; a bare `\n` is just another
//!    character and lands in the input box as a literal newline. That is
//!    exactly the reported symptom: the follow-up text appeared in the
//!    session's composer but was never submitted as a turn. A shell in
//!    canonical mode is unaffected by the distinction, because its line
//!    discipline maps input CR to NL (`ICRNL`) for us. This is the same
//!    normalization the desktop's paste path already applies before the PTY
//!    sees a payload (`normalizeTerminalPasteLineEndings`, "xterm's native
//!    paste path converts every clipboard newline to CR"), so the CLI and
//!    the app now deliver identical bytes for identical text.
//!
//! 2. **A keystroke is its own read.** TUIs distinguish typing from pasting
//!    by how input arrives; a body and its Return delivered in one PTY write
//!    can be read as a single pasted blob, in which case the trailing `\r`
//!    is inserted as text instead of submitting. A human never produces that
//!    shape, so neither do we: the body is written first, then — after
//!    [`ENTER_PACE`], long enough for the reader to have drained the body —
//!    the Return is written on its own. This is what `tmux send-keys <text>
//!    Enter` does, and it makes the outcome independent of any particular
//!    TUI's paste heuristics.
//!
//! `--literal` opts out of both: the bytes go to the PTY exactly as given,
//! which is what a caller piping data (rather than typing a message) wants.

use std::time::Duration;

/// The byte a terminal emits for Return.
pub const ENTER: &str = "\r";

/// Gap between the body write and the Return write. Small enough to be
/// imperceptible on a command that already costs a socket round trip, large
/// enough that a reader blocked in `read()` wakes on the body first.
pub const ENTER_PACE: Duration = Duration::from_millis(40);

/// Suffix that derives the Return write's ledger id from the body write's.
/// Deterministic on purpose: `--retry-request` replays both writes onto the
/// same two ledger rows instead of duplicating the keystroke.
const ENTER_REQUEST_SUFFIX: &str = ".enter";

/// Envelope cap from `drogon_protocol::Request::validate`.
const MAX_REQUEST_ID_LEN: usize = 128;

/// One PTY write: the exact bytes, and the ledger id they are sent under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSendWrite {
    pub request_id: String,
    pub text: String,
}

impl TerminalSendWrite {
    pub fn byte_len(&self) -> u64 {
        self.text.len() as u64
    }
}

/// The full delivery for one `terminal send`: the writes in order, plus
/// whether the last of them is a Return keystroke.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSendPlan {
    pub writes: Vec<TerminalSendWrite>,
    pub submitted_enter: bool,
}

impl TerminalSendPlan {
    /// Bytes this plan puts on the PTY, Return included.
    pub fn byte_len(&self) -> u64 {
        self.writes.iter().map(TerminalSendWrite::byte_len).sum()
    }
}

/// Rewrites every `\r\n` and `\n` to `\r`.
///
/// Whole-text, not just the tail: a terminal has no other way to express a
/// newline in *input*, so two lines of `--text` mean two Returns, exactly as
/// they would if the same text were pasted into the pane. An existing `\r`
/// is already Return and passes through unchanged.
fn normalize_line_endings(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find(['\r', '\n']) {
        out.push_str(&rest[..index]);
        out.push('\r');
        let after = &rest[index..];
        rest = if let Some(tail) = after.strip_prefix("\r\n") {
            tail
        } else {
            &after[1..]
        };
    }
    out.push_str(rest);
    out
}

/// Derives the Return write's ledger id, keeping it inside the envelope's
/// 128-character cap. Truncation happens on a character boundary; ids long
/// enough to need it are minted by callers, not by this CLI (which uses
/// UUIDs), so the derived id stays unique in practice.
fn enter_request_id(base: &str) -> String {
    let budget = MAX_REQUEST_ID_LEN - ENTER_REQUEST_SUFFIX.len();
    if base.len() <= budget {
        return format!("{base}{ENTER_REQUEST_SUFFIX}");
    }
    let mut cut = budget;
    while cut > 0 && !base.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}{ENTER_REQUEST_SUFFIX}", &base[..cut])
}

/// Plans the writes for one `terminal send`.
///
/// `literal` delivers `text` verbatim in a single write — no line-ending
/// translation, no separate Return.
pub fn plan_terminal_send(text: &str, literal: bool, request_id: &str) -> TerminalSendPlan {
    if literal {
        return TerminalSendPlan {
            writes: vec![TerminalSendWrite {
                request_id: request_id.to_string(),
                text: text.to_string(),
            }],
            submitted_enter: false,
        };
    }
    let normalized = normalize_line_endings(text);
    let (body, submitted_enter) = match normalized.strip_suffix('\r') {
        Some(body) => (body.to_string(), true),
        None => (normalized, false),
    };
    let mut writes = Vec::with_capacity(2);
    // An empty body still gets a write when there is no Return to carry the
    // request: `--text ""` must keep reaching the service (which refuses it)
    // rather than silently succeeding here.
    if !body.is_empty() || !submitted_enter {
        writes.push(TerminalSendWrite {
            request_id: request_id.to_string(),
            text: body,
        });
    }
    if submitted_enter {
        let id = if writes.is_empty() {
            // Nothing but Enter: one write, under the caller's own id.
            request_id.to_string()
        } else {
            enter_request_id(request_id)
        };
        writes.push(TerminalSendWrite {
            request_id: id,
            text: ENTER.to_string(),
        });
    }
    TerminalSendPlan {
        writes,
        submitted_enter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(text: &str) -> TerminalSendPlan {
        plan_terminal_send(text, false, "req-1")
    }

    fn texts(plan: &TerminalSendPlan) -> Vec<&str> {
        plan.writes.iter().map(|w| w.text.as_str()).collect()
    }

    #[test]
    fn trailing_newline_becomes_a_separate_return_keystroke() {
        let plan = plan("Correction: please also do X.\n");
        assert_eq!(texts(&plan), vec!["Correction: please also do X.", "\r"]);
        assert!(plan.submitted_enter);
        assert_eq!(plan.byte_len(), 30);
    }

    #[test]
    fn trailing_crlf_and_bare_cr_are_the_same_return() {
        for text in ["hi\r\n", "hi\r", "hi\n"] {
            let plan = plan(text);
            assert_eq!(texts(&plan), vec!["hi", "\r"], "text: {text:?}");
            assert!(plan.submitted_enter);
            assert_eq!(plan.byte_len(), 3);
        }
    }

    #[test]
    fn text_without_a_trailing_newline_is_one_verbatim_write() {
        let plan = plan("echo hi");
        assert_eq!(texts(&plan), vec!["echo hi"]);
        assert!(!plan.submitted_enter);
        assert_eq!(plan.writes[0].request_id, "req-1");
    }

    #[test]
    fn a_lone_newline_is_just_enter_under_the_callers_own_id() {
        for text in ["\n", "\r", "\r\n"] {
            let plan = plan(text);
            assert_eq!(texts(&plan), vec!["\r"], "text: {text:?}");
            assert_eq!(plan.writes.len(), 1);
            assert_eq!(plan.writes[0].request_id, "req-1");
            assert!(plan.submitted_enter);
        }
    }

    #[test]
    fn interior_newlines_become_returns_in_the_body() {
        let plan = plan("one\ntwo\n");
        assert_eq!(texts(&plan), vec!["one\rtwo", "\r"]);
        assert_eq!(plan.byte_len(), 8);
    }

    #[test]
    fn a_blank_trailing_line_keeps_both_returns() {
        let plan = plan("hi\n\n");
        assert_eq!(texts(&plan), vec!["hi\r", "\r"]);
        assert!(plan.submitted_enter);
    }

    #[test]
    fn empty_text_still_produces_one_write_for_the_service_to_refuse() {
        let plan = plan("");
        assert_eq!(texts(&plan), vec![""]);
        assert!(!plan.submitted_enter);
    }

    #[test]
    fn literal_sends_the_bytes_untouched() {
        let plan = plan_terminal_send("one\ntwo\n", true, "req-1");
        assert_eq!(texts(&plan), vec!["one\ntwo\n"]);
        assert!(!plan.submitted_enter);
        assert_eq!(plan.byte_len(), 8);
    }

    #[test]
    fn non_ascii_text_is_measured_in_bytes_not_characters() {
        let plan = plan("héllo → wörld ✓\n");
        assert_eq!(texts(&plan), vec!["héllo → wörld ✓", "\r"]);
        assert_eq!(plan.byte_len(), "héllo → wörld ✓".len() as u64 + 1);
    }

    #[test]
    fn control_bytes_other_than_newlines_survive() {
        let plan = plan("\u{0003}\u{0016}ok\n");
        assert_eq!(texts(&plan), vec!["\u{0003}\u{0016}ok", "\r"]);
    }

    #[test]
    fn enter_write_derives_a_distinct_ledger_id() {
        let plan = plan("hi\n");
        assert_eq!(plan.writes[0].request_id, "req-1");
        assert_eq!(plan.writes[1].request_id, "req-1.enter");
    }

    #[test]
    fn derived_ledger_id_stays_inside_the_envelope_cap() {
        let base = "x".repeat(MAX_REQUEST_ID_LEN);
        let derived = enter_request_id(&base);
        assert!(derived.len() <= MAX_REQUEST_ID_LEN, "len {}", derived.len());
        assert!(derived.ends_with(ENTER_REQUEST_SUFFIX));
        // And a multi-byte id is cut on a character boundary, never inside one.
        let wide = "é".repeat(MAX_REQUEST_ID_LEN);
        let derived = enter_request_id(&wide);
        assert!(derived.len() <= MAX_REQUEST_ID_LEN, "len {}", derived.len());
        assert!(derived.ends_with(ENTER_REQUEST_SUFFIX));
    }

    #[test]
    fn normalization_is_idempotent() {
        let once = normalize_line_endings("a\r\nb\nc\rd");
        assert_eq!(once, "a\rb\rc\rd");
        assert_eq!(normalize_line_endings(&once), once);
    }
}
