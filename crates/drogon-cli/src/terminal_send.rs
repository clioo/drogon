//! How `terminal send` turns `--text` into PTY input (issue #599).
//!
//! **Return is a carriage return, not a line feed.** When a human presses
//! Enter, the terminal puts `\r` (0x0D) on the wire. A TUI in raw mode
//! (`ICRNL` off — every agent harness Drogon launches) therefore reads `\r`
//! and nothing else as "submit"; a bare `\n` is just another character and
//! lands in the input box as a literal newline. That is exactly the reported
//! symptom: a follow-up sent to a live Claude Code session appeared in the
//! composer and was never submitted as a turn. A shell in canonical mode is
//! unaffected by the distinction, because its line discipline maps input CR
//! to NL (`ICRNL`) for us.
//!
//! So `--text`'s trailing line terminator — `\n`, `\r\n` or `\r` — is
//! delivered as one `\r`. That is the whole fix. It is the same byte the
//! desktop's paste path puts on the PTY for a newline
//! (`normalizeTerminalPasteLineEndings`) and the same byte the Work Graph's
//! prompt delivery appends (`mentu-run-dispatch.ts`), so all three surfaces
//! now agree on what Enter is.
//!
//! **Everything else is delivered unchanged, in one write.** Two things
//! follow from that, both deliberate:
//!
//! - Interior bytes are the caller's. A multi-line message keeps its line
//!   feeds, lands in the composer whole, and is submitted once by the
//!   trailing Return. An interior *carriage* return is not rewritten either
//!   — and, being Return, a raw-mode TUI will submit on it, so a CRLF-ended
//!   payload has to be converted to LF by the caller before it is sent as
//!   one message. The guide says so rather than the code guessing.
//! - One write, not two. An earlier cut split the Return into a second,
//!   paced write so a TUI would see a discrete keystroke rather than a
//!   pasted blob. It cannot deliver that: bytes queue in the PTY's input
//!   buffer, so a reader that is not already blocked in `read()` gets both
//!   writes in one read anyway. What the split did reliably produce was a
//!   window in which two concurrent sends to one session interleaved into a
//!   single fused line. Serializing a multi-write send is the daemon's job —
//!   it owns the PTY writer lock — not something a CLI process can promise,
//!   so this one stays atomic.
//!
//! `--literal` opts out: the bytes go to the PTY exactly as given, with no
//! Return translation, which is what a caller piping data (rather than
//! typing a message) wants.

/// The byte a terminal emits for Return.
pub const ENTER: &str = "\r";

/// What one `terminal send` writes to the PTY.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSendPlan {
    /// The exact bytes of the single `session.write`.
    pub text: String,
    /// Whether those bytes end with the Return that submits them.
    pub submitted_enter: bool,
}

impl TerminalSendPlan {
    /// Bytes this plan puts on the PTY, Return included. This is what
    /// `acceptedBytes` reports, and it equals the `--text` byte length except
    /// when a trailing CRLF collapses into the one byte Return really is.
    pub fn byte_len(&self) -> u64 {
        self.text.len() as u64
    }
}

/// Splits `text` into the body and whether it ended with a line terminator.
/// `\r\n`, `\n` and `\r` all spell the same single Return.
fn split_trailing_terminator(text: &str) -> (&str, bool) {
    if let Some(body) = text.strip_suffix("\r\n") {
        return (body, true);
    }
    if let Some(body) = text.strip_suffix('\n').or_else(|| text.strip_suffix('\r')) {
        return (body, true);
    }
    (text, false)
}

/// Plans the write for one `terminal send`.
///
/// `literal` delivers `text` verbatim — no Return translation.
pub fn plan_terminal_send(text: &str, literal: bool) -> TerminalSendPlan {
    if literal {
        return TerminalSendPlan {
            text: text.to_string(),
            submitted_enter: false,
        };
    }
    let (body, submitted_enter) = split_trailing_terminator(text);
    let mut out = body.to_string();
    if submitted_enter {
        out.push_str(ENTER);
    }
    TerminalSendPlan {
        text: out,
        submitted_enter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(text: &str) -> TerminalSendPlan {
        plan_terminal_send(text, false)
    }

    #[test]
    fn trailing_newline_becomes_the_return_that_submits() {
        let sent = plan("Correction: please also do X.\n");
        assert_eq!(sent.text, "Correction: please also do X.\r");
        assert!(sent.submitted_enter);
        assert_eq!(sent.byte_len(), 30);
        assert!(
            !sent.text.contains('\n'),
            "LF is not Enter: {:?}",
            sent.text
        );
    }

    #[test]
    fn trailing_crlf_and_bare_cr_are_the_same_return() {
        for text in ["hi\r\n", "hi\r", "hi\n"] {
            let sent = plan(text);
            assert_eq!(sent.text, "hi\r", "text: {text:?}");
            assert!(sent.submitted_enter);
            // Return is one byte, so a CRLF input delivers one byte fewer
            // than it was given. `acceptedBytes` counts what reached the PTY.
            assert_eq!(sent.byte_len(), 3, "text: {text:?}");
        }
    }

    #[test]
    fn text_without_a_trailing_newline_is_delivered_verbatim() {
        let sent = plan("echo hi");
        assert_eq!(sent.text, "echo hi");
        assert!(!sent.submitted_enter);
    }

    #[test]
    fn a_lone_newline_is_just_enter() {
        for text in ["\n", "\r", "\r\n"] {
            let sent = plan(text);
            assert_eq!(sent.text, "\r", "text: {text:?}");
            assert_eq!(sent.byte_len(), 1);
            assert!(sent.submitted_enter);
        }
    }

    /// The multi-line case the command exists for: one turn, not one turn
    /// per line. Interior line feeds are the composer's; only the final
    /// Return submits.
    #[test]
    fn interior_line_feeds_stay_line_feeds_and_only_the_last_one_submits() {
        let sent = plan("one\ntwo\n");
        assert_eq!(sent.text, "one\ntwo\r");
        assert_eq!(sent.byte_len(), 8);
        assert_eq!(sent.text.matches('\r').count(), 1);
    }

    /// An interior carriage return IS Return, and is passed through rather
    /// than guessed at. A caller with CRLF line endings has to convert them,
    /// which is what the guide tells them to do.
    #[test]
    fn an_interior_carriage_return_is_delivered_unchanged() {
        let sent = plan("one\r\ntwo\n");
        assert_eq!(sent.text, "one\r\ntwo\r");
        assert_eq!(sent.text.matches('\r').count(), 2);
        let lone = plan("one\rtwo\n");
        assert_eq!(lone.text, "one\rtwo\r");
    }

    #[test]
    fn a_blank_trailing_line_submits_exactly_once() {
        let sent = plan("hi\n\n");
        assert_eq!(sent.text, "hi\n\r");
        assert!(sent.submitted_enter);
        assert_eq!(sent.byte_len(), 4);
    }

    /// Only the LAST terminator is Return; a preceding one is body.
    #[test]
    fn only_the_final_terminator_is_translated() {
        assert_eq!(plan("hi\r\r").text, "hi\r\r");
        assert_eq!(plan("hi\n\r").text, "hi\n\r");
        assert_eq!(plan("hi\r\n\n").text, "hi\r\n\r");
        for text in ["hi\r\r", "hi\n\r", "hi\r\n\n"] {
            assert!(plan(text).submitted_enter, "text: {text:?}");
        }
    }

    #[test]
    fn empty_text_stays_empty_for_the_service_to_refuse() {
        for literal in [false, true] {
            let sent = plan_terminal_send("", literal);
            assert_eq!(sent.text, "", "literal: {literal}");
            assert!(!sent.submitted_enter);
            assert_eq!(sent.byte_len(), 0);
        }
    }

    #[test]
    fn literal_sends_the_bytes_untouched() {
        for text in ["one\ntwo\n", "hi\r\n", "\n", ""] {
            let sent = plan_terminal_send(text, true);
            assert_eq!(sent.text, text, "text: {text:?}");
            assert!(!sent.submitted_enter);
            assert_eq!(sent.byte_len(), text.len() as u64);
        }
    }

    #[test]
    fn non_ascii_text_is_measured_in_bytes_not_characters() {
        let sent = plan("héllo → wörld ✓\n");
        assert_eq!(sent.text, "héllo → wörld ✓\r");
        assert_eq!(sent.byte_len(), "héllo → wörld ✓".len() as u64 + 1);
    }

    #[test]
    fn control_bytes_other_than_the_trailing_newline_survive() {
        let sent = plan("\u{0003}\u{0016}o\tk\n");
        assert_eq!(sent.text, "\u{0003}\u{0016}o\tk\r");
    }

    #[test]
    fn whitespace_only_text_keeps_its_spaces_and_submits() {
        let sent = plan("   \n");
        assert_eq!(sent.text, "   \r");
        assert!(sent.submitted_enter);
    }
}
