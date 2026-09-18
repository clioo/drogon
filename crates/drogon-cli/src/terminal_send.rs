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
//!    discipline maps input CR to NL (`ICRNL`) for us.
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
//! Only the *trailing* terminator is translated. Interior bytes reach the
//! PTY exactly as given, which is what makes a multi-line message work: the
//! embedded line feeds land in the composer as line feeds and the single
//! Return at the end submits the whole thing as one turn. Rewriting them all
//! to Return would instead submit each line as its own turn, and would
//! fragment exactly the multi-line correction this command exists to send.
//!
//! `--literal` opts out of both rules: the bytes go to the PTY exactly as
//! given, in one write, which is what a caller piping data (rather than
//! typing a message) wants.

use std::time::Duration;

use sha2::{Digest, Sha256};

/// The byte a terminal emits for Return.
pub const ENTER: &str = "\r";

/// Gap between the body write and the Return write. Small enough to be
/// imperceptible on a command that already costs a socket round trip, large
/// enough that a reader blocked in `read()` wakes on the body first.
pub const ENTER_PACE: Duration = Duration::from_millis(40);

/// Suffix that derives the Return write's ledger id from the body write's.
/// Deterministic on purpose: `--retry-request` replays both writes onto the
/// same two ledger rows instead of duplicating the keystroke.
///
/// The CLI refuses a caller-supplied request id that ends with it
/// (`cli::validate_request_id`), so this half of the id namespace belongs to
/// this module alone and a caller can never collide with a derived id.
pub const ENTER_REQUEST_SUFFIX: &str = ".drogon-enter";

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
    /// Bytes this plan puts on the PTY, Return included. This is what
    /// `acceptedBytes` reports, and it equals the `--text` byte length except
    /// when a trailing CRLF collapses into the one byte Return really is.
    pub fn byte_len(&self) -> u64 {
        self.writes.iter().map(TerminalSendWrite::byte_len).sum()
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

/// Derives the Return write's ledger id.
///
/// Suffixing is enough while the result fits the envelope's 128-character
/// cap. Past that the base is replaced by its SHA-256 digest rather than
/// truncated: truncation would map two distinct caller ids that merely share
/// a long prefix onto the same derived id, and the ledger would then answer
/// the second send's Return with the first one's receipt — reporting a
/// keystroke that never reached the PTY.
fn enter_request_id(base: &str) -> String {
    let suffixed = format!("{base}{ENTER_REQUEST_SUFFIX}");
    if suffixed.len() <= MAX_REQUEST_ID_LEN {
        return suffixed;
    }
    let digest = Sha256::digest(base.as_bytes());
    format!("{digest:x}{ENTER_REQUEST_SUFFIX}")
}

/// Plans the writes for one `terminal send`.
///
/// `literal` delivers `text` verbatim in a single write — no Return
/// translation, no separate keystroke.
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
    let (body, submitted_enter) = split_trailing_terminator(text);
    let mut writes = Vec::with_capacity(2);
    // An empty body still gets a write when there is no Return to carry the
    // request: `--text ""` must keep reaching the service (which refuses it)
    // rather than silently succeeding here.
    if !body.is_empty() || !submitted_enter {
        writes.push(TerminalSendWrite {
            request_id: request_id.to_string(),
            text: body.to_string(),
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
            // Return is one byte, so a CRLF input delivers one byte fewer
            // than it was given. `acceptedBytes` counts what reached the PTY.
            assert_eq!(plan.byte_len(), 3, "text: {text:?}");
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

    /// The multi-line case the whole command exists for: one turn, not one
    /// turn per line. Interior line feeds are the composer's, and only the
    /// final Return submits.
    #[test]
    fn interior_newlines_stay_interior_and_only_the_last_one_submits() {
        let unix = plan("one\ntwo\n");
        assert_eq!(texts(&unix), vec!["one\ntwo", "\r"]);
        assert_eq!(unix.byte_len(), 8);
        let windows = plan("one\r\ntwo\r\n");
        assert_eq!(texts(&windows), vec!["one\r\ntwo", "\r"]);
    }

    #[test]
    fn a_blank_trailing_line_submits_exactly_once() {
        let plan = plan("hi\n\n");
        assert_eq!(texts(&plan), vec!["hi\n", "\r"]);
        assert!(plan.submitted_enter);
        assert_eq!(plan.byte_len(), 4);
    }

    #[test]
    fn empty_text_still_produces_one_write_for_the_service_to_refuse() {
        for literal in [false, true] {
            let plan = plan_terminal_send("", literal, "req-1");
            assert_eq!(texts(&plan), vec![""], "literal: {literal}");
            assert!(!plan.submitted_enter);
            assert_eq!(plan.byte_len(), 0);
        }
    }

    #[test]
    fn literal_sends_the_bytes_untouched() {
        for text in ["one\ntwo\n", "hi\r\n", "\n"] {
            let plan = plan_terminal_send(text, true, "req-1");
            assert_eq!(texts(&plan), vec![text], "text: {text:?}");
            assert!(!plan.submitted_enter);
            assert_eq!(plan.byte_len(), text.len() as u64);
            assert_eq!(plan.writes[0].request_id, "req-1");
        }
    }

    #[test]
    fn non_ascii_text_is_measured_in_bytes_not_characters() {
        let plan = plan("héllo → wörld ✓\n");
        assert_eq!(texts(&plan), vec!["héllo → wörld ✓", "\r"]);
        assert_eq!(plan.byte_len(), "héllo → wörld ✓".len() as u64 + 1);
    }

    #[test]
    fn control_bytes_other_than_the_trailing_newline_survive() {
        let plan = plan("\u{0003}\u{0016}o\tk\n");
        assert_eq!(texts(&plan), vec!["\u{0003}\u{0016}o\tk", "\r"]);
    }

    #[test]
    fn whitespace_only_text_keeps_its_spaces_and_submits() {
        let plan = plan("   \n");
        assert_eq!(texts(&plan), vec!["   ", "\r"]);
        assert!(plan.submitted_enter);
    }

    #[test]
    fn enter_write_derives_a_distinct_ledger_id() {
        let plan = plan("hi\n");
        assert_eq!(plan.writes[0].request_id, "req-1");
        assert_eq!(plan.writes[1].request_id, "req-1.drogon-enter");
    }

    /// Truncation would map these two onto one derived id and let the ledger
    /// answer the second send's Return with the first's receipt.
    #[test]
    fn long_ids_that_share_a_prefix_derive_different_return_ids() {
        let shared = "x".repeat(MAX_REQUEST_ID_LEN - 4);
        let left = enter_request_id(&format!("{shared}ABCD"));
        let right = enter_request_id(&format!("{shared}WXYZ"));
        assert_ne!(left, right);
        for derived in [&left, &right] {
            assert!(derived.len() <= MAX_REQUEST_ID_LEN, "len {}", derived.len());
            assert!(derived.ends_with(ENTER_REQUEST_SUFFIX));
            assert!(!derived.chars().any(char::is_control));
        }
    }

    #[test]
    fn derived_ids_are_deterministic_so_a_replay_lands_on_the_same_row() {
        for base in ["req-1", &"y".repeat(MAX_REQUEST_ID_LEN)] {
            assert_eq!(enter_request_id(base), enter_request_id(base));
        }
        // A multi-byte id is digested whole, never cut inside a character.
        let wide = "é".repeat(MAX_REQUEST_ID_LEN);
        let derived = enter_request_id(&wide);
        assert!(derived.len() <= MAX_REQUEST_ID_LEN, "len {}", derived.len());
        assert!(derived.ends_with(ENTER_REQUEST_SUFFIX));
    }

    /// The reserved suffix is what makes the derived id unreachable by a
    /// caller; `cli::validate_request_id` enforces the other half.
    #[test]
    fn a_derived_id_is_itself_a_reserved_id() {
        let derived = enter_request_id("req-1");
        assert!(derived.ends_with(ENTER_REQUEST_SUFFIX));
        assert_eq!(
            enter_request_id(&"z".repeat(200)).len(),
            64 + ENTER_REQUEST_SUFFIX.len()
        );
    }
}
