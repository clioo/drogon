//! What the program on the far end of a PTY has told us about itself
//! (issue #625).
//!
//! A TUI that wants to tell a paste apart from typing turns on DECSET 2004
//! (`ESC [ ? 2004 h`) and turns it off again on exit (`... l`). That byte
//! sequence travels in the session's *output*, so the daemon — which
//! already reads every output chunk — can observe it for free and know
//! whether the far end understands bracketed paste.
//!
//! Why it matters here: a paste-detecting TUI (Claude Code is one) that is
//! mid-turn is not blocked in `read()`, so a body and the Return that
//! should submit it queue in the PTY buffer and arrive in ONE read. The
//! heuristic then reads that burst as a paste and swallows the Return —
//! the message sits in the composer, typed and unsubmitted, which is
//! exactly what issue #625 reported. Framing the body between
//! `ESC [ 200 ~` and `ESC [ 201 ~` removes the guesswork: the end marker
//! closes the paste, so the Return after it is unambiguously a keypress
//! even when both writes land in the same read.
//!
//! Framing bytes a program never asked for would be worse than the bug, so
//! [`BracketedPasteScanner`] is the gate: no observed DECSET 2004, no
//! framing.

/// `ESC` — the byte every sequence here starts with.
const ESC: u8 = 0x1b;

/// The DEC private mode number for bracketed paste.
const BRACKETED_PASTE_MODE: u32 = 2004;

/// Longest partial sequence carried across chunk boundaries. xterm caps a
/// CSI at 30 parameters, so a real private-mode set is an order of
/// magnitude shorter than this even when a TUI sets everything at once;
/// anything longer is not a mode sequence and is dropped rather than
/// retained forever. Only a sequence SPLIT across chunks is subject to the
/// bound — one that arrives whole is parsed at any length.
const MAX_PENDING: usize = 256;

/// Opening marker of a bracketed paste, as the terminal sends it.
pub(crate) const BRACKETED_PASTE_START: &[u8] = b"\x1b[200~";
/// Closing marker. Everything before it is paste; what follows is typing.
pub(crate) const BRACKETED_PASTE_END: &[u8] = b"\x1b[201~";

/// Incremental observer of DEC private mode 2004 over a session's output.
///
/// Fed every output chunk in order, it reports whether the far end
/// currently has bracketed paste on. Sequences split across chunk
/// boundaries are carried, because an 8 KiB read can end mid-escape.
#[derive(Debug, Default)]
pub(crate) struct BracketedPasteScanner {
    /// Bytes from the tail of an earlier chunk that may still be the start
    /// of a mode sequence.
    pending: Vec<u8>,
    enabled: bool,
}

/// What [`scan_one`] found at an `ESC`.
enum Scan {
    /// A complete `ESC [ ? … h|l`; `set` is `Some` only when 2004 was one
    /// of its parameters.
    Mode { len: usize, set: Option<bool> },
    /// A complete sequence that is not a private mode change, or a byte
    /// that cannot start one: skip `len` bytes and keep looking.
    Other { len: usize },
    /// The chunk ended inside a candidate sequence.
    Incomplete,
}

/// Classifies the bytes starting at an `ESC`.
///
/// Three things this deliberately does NOT treat as a bracketed-paste mode
/// change, each because a real terminal would not either:
///
/// - `0x9b` as a one-byte CSI. These PTYs are UTF-8, where `0x9b` is a
///   continuation byte inside a multi-byte character; reading it as CSI
///   would let ordinary text flip the mode.
/// - A colon sub-parameter (`ESC [ ? 2004:1 h`). Sub-parameters are not
///   defined for DEC private modes and xterm rejects the sequence.
/// - An intermediate byte before the final (`ESC [ ? 2004 SP h`). An
///   intermediate makes it a different sequence entirely.
///
/// What it DOES follow a terminal on: an `ESC` inside an OSC, DCS, APC or
/// PM string aborts that string and begins a new sequence, so a private
/// mode change written inside one still counts — the same answer xterm's
/// parser gives, and therefore the same answer the desktop's own terminal
/// reaches about the very same bytes.
fn scan_one(bytes: &[u8]) -> Scan {
    debug_assert_eq!(bytes.first(), Some(&ESC));
    let Some(&b'[') = bytes.get(1) else {
        // `ESC` with a non-CSI (or not yet known) successor. One more byte
        // decides it, so an `ESC` at the very end of a chunk is carried.
        return match bytes.len() {
            1 => Scan::Incomplete,
            _ => Scan::Other { len: 1 },
        };
    };
    let Some(&marker) = bytes.get(2) else {
        return Scan::Incomplete;
    };
    if marker != b'?' {
        // A CSI that is not private: skip `ESC [` and rescan from here, so
        // an `ESC` inside its parameters still gets looked at.
        return Scan::Other { len: 2 };
    }
    let params_start = 3;
    let mut index = params_start;
    loop {
        let Some(&byte) = bytes.get(index) else {
            return Scan::Incomplete;
        };
        match byte {
            // Parameter bytes (digits, `;`, and the private markers).
            0x30..=0x3f => index += 1,
            // Intermediate bytes.
            0x20..=0x2f => index += 1,
            // Final byte: the sequence ends here.
            0x40..=0x7e => {
                let set = match byte {
                    b'h' => Some(true),
                    b'l' => Some(false),
                    _ => None,
                };
                let set = set.filter(|_| mentions_bracketed_paste(&bytes[params_start..index]));
                return Scan::Mode {
                    len: index + 1,
                    set,
                };
            }
            // Anything else aborts the sequence where it stands.
            _ => return Scan::Other { len: index.max(1) },
        }
    }
}

/// True when `2004` is one of the `;`-separated parameters.
fn mentions_bracketed_paste(params: &[u8]) -> bool {
    params.split(|byte| *byte == b';').any(|param| {
        std::str::from_utf8(param)
            .ok()
            .and_then(|param| param.parse::<u32>().ok())
            == Some(BRACKETED_PASTE_MODE)
    })
}

impl BracketedPasteScanner {
    /// Feeds one output chunk, in stream order.
    pub(crate) fn feed(&mut self, chunk: &[u8]) {
        let mut buf = std::mem::take(&mut self.pending);
        if buf.is_empty() {
            // Overwhelmingly the common case: no partial sequence pending,
            // and no output chunk contains an `ESC` at all. Scanning the
            // borrowed chunk avoids a copy per read.
            if !chunk.contains(&ESC) {
                return;
            }
            buf.extend_from_slice(chunk);
        } else {
            buf.extend_from_slice(chunk);
        }
        let mut cursor = 0usize;
        let carry_from = loop {
            let Some(offset) = buf[cursor..].iter().position(|byte| *byte == ESC) else {
                break buf.len();
            };
            let start = cursor + offset;
            match scan_one(&buf[start..]) {
                Scan::Mode { len, set } => {
                    if let Some(enabled) = set {
                        self.enabled = enabled;
                    }
                    cursor = start + len;
                }
                Scan::Other { len } => cursor = start + len,
                Scan::Incomplete => break start,
            }
        };
        self.pending = buf[carry_from..].to_vec();
        // A "sequence" this long is not one; dropping it keeps the carry
        // bounded no matter what a program writes.
        if self.pending.len() > MAX_PENDING {
            self.pending.clear();
        }
    }

    /// Whether the far end last asked for bracketed paste.
    pub(crate) fn enabled(&self) -> bool {
        self.enabled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_after(chunks: &[&[u8]]) -> bool {
        let mut scanner = BracketedPasteScanner::default();
        for chunk in chunks {
            scanner.feed(chunk);
        }
        scanner.enabled()
    }

    #[test]
    fn a_session_that_said_nothing_has_no_bracketed_paste() {
        assert!(!enabled_after(&[]));
        assert!(!enabled_after(&[b"plain shell output\n$ "]));
    }

    #[test]
    fn decset_2004_turns_it_on_and_decrst_turns_it_off() {
        assert!(enabled_after(&[b"\x1b[?2004h"]));
        assert!(!enabled_after(&[b"\x1b[?2004h", b"\x1b[?2004l"]));
        // Last one wins, in stream order, even within one chunk.
        assert!(enabled_after(&[b"\x1b[?2004l\x1b[?2004h"]));
        assert!(!enabled_after(&[b"\x1b[?2004h\x1b[?2004l"]));
    }

    /// Real TUIs set several private modes at once on the way into the
    /// alternate screen.
    #[test]
    fn the_mode_is_found_among_other_parameters() {
        assert!(enabled_after(&[b"\x1b[?1049;1000;2004h"]));
        assert!(enabled_after(&[b"\x1b[?2004;1006h"]));
        assert!(!enabled_after(&[b"\x1b[?1049;2004h", b"\x1b[?1000;2004l"]));
    }

    #[test]
    fn other_private_modes_leave_it_alone() {
        assert!(!enabled_after(&[b"\x1b[?1049h\x1b[?25l\x1b[?1000h"]));
        assert!(enabled_after(&[b"\x1b[?2004h", b"\x1b[?1049l\x1b[?25h"]));
        // 2004 as part of a longer number is a different mode entirely.
        assert!(!enabled_after(&[b"\x1b[?20040h"]));
        assert!(!enabled_after(&[b"\x1b[?12004h"]));
    }

    /// An 8 KiB read can end anywhere, including the middle of the one
    /// sequence that matters.
    #[test]
    fn a_sequence_split_across_chunks_is_still_found() {
        for split in 1..b"\x1b[?2004h".len() {
            let (head, tail) = b"\x1b[?2004h".split_at(split);
            assert!(enabled_after(&[head, tail]), "split at {split}");
        }
        assert!(enabled_after(&[b"out\x1b", b"[?20", b"04", b"h more"]));
        assert!(!enabled_after(&[b"\x1b[?2004h", b"bye\x1b[?2", b"004l"]));
    }

    /// Only `h`/`l` change a mode; a query (`ESC [ ? 2004 $ p`) must not.
    #[test]
    fn a_mode_query_is_not_a_mode_change() {
        assert!(!enabled_after(&[b"\x1b[?2004$p"]));
        assert!(enabled_after(&[b"\x1b[?2004h", b"\x1b[?2004$p"]));
    }

    /// A stream of `ESC`s that never completes a sequence must not grow
    /// the carry without bound.
    #[test]
    fn an_endless_partial_sequence_does_not_grow_forever() {
        let mut scanner = BracketedPasteScanner::default();
        for _ in 0..1000 {
            scanner.feed(b"\x1b[?1;2;3;4;5;6;7;8;9;10;11;12;13;14;15;16;17;18;19;20");
        }
        assert!(scanner.pending.len() <= MAX_PENDING);
        assert!(!scanner.enabled());
        // And the scanner still works afterwards.
        scanner.feed(b"\x1b[?2004h");
        assert!(scanner.enabled());
    }

    /// The paste markers a session emits in its own output (a TUI echoing
    /// them back, say) are not mode changes.
    #[test]
    fn paste_markers_in_output_are_not_mode_changes() {
        assert!(!enabled_after(&[
            BRACKETED_PASTE_START,
            BRACKETED_PASTE_END
        ]));
    }

    /// `0x9b` is a UTF-8 continuation byte here, never a one-byte CSI:
    /// reading it as one would let any accented character start a mode
    /// sequence.
    #[test]
    fn a_c1_csi_byte_is_text_not_a_control_in_a_utf8_stream() {
        assert!(!enabled_after(&[b"\x9b[?2004h"]));
        assert!(!enabled_after(&[b"\x9b?2004h"]));
        // The byte really does occur in ordinary output: U+F6DB is
        // e0 9b 9b in UTF-8.
        assert!(!enabled_after(&["\u{f6db}?2004h".as_bytes()]));
    }

    /// Forms xterm itself rejects must not be honoured here either.
    #[test]
    fn malformed_private_mode_sets_are_not_honoured() {
        // A colon sub-parameter is not defined for DEC private modes.
        assert!(!enabled_after(&[b"\x1b[?2004:1h"]));
        // An intermediate byte before the final makes it another sequence.
        assert!(!enabled_after(&[b"\x1b[?2004 h"]));
        // Neither may knock a real announcement back off.
        assert!(enabled_after(&[
            b"\x1b[?2004h",
            b"\x1b[?2004:1l",
            b"\x1b[?2004 l"
        ]));
    }

    /// A long private-mode set still resolves when a chunk boundary lands
    /// in the middle of it — the carry bound is for runaway input, not for
    /// a real sequence.
    #[test]
    fn a_long_sequence_split_across_chunks_still_resolves() {
        let mut sequence = b"\x1b[?".to_vec();
        for mode in 1..60u32 {
            sequence.extend_from_slice(format!("{mode};").as_bytes());
        }
        sequence.extend_from_slice(b"2004h");
        assert!(
            sequence.len() > 128,
            "the case is only interesting when long"
        );
        for split in [1, 50, 129, 150, sequence.len() - 1] {
            let (head, tail) = sequence.split_at(split);
            assert!(enabled_after(&[head, tail]), "split at {split}");
        }
        let mut byte_at_a_time = BracketedPasteScanner::default();
        for byte in &sequence {
            byte_at_a_time.feed(&[*byte]);
        }
        assert!(byte_at_a_time.enabled());
    }

    /// A mode change written inside a string sequence still counts,
    /// because the `ESC` aborts the string — which is what a terminal
    /// does with the same bytes, so the daemon and the desktop's own
    /// terminal never disagree about whether paste is on.
    #[test]
    fn an_escape_inside_a_string_sequence_aborts_it_the_way_a_terminal_does() {
        assert!(enabled_after(&[b"\x1b]0;title \x1b[?2004h\x07"]));
        assert!(!enabled_after(&[
            b"\x1b[?2004h",
            b"\x1b]0;log \x1b[?2004l\x07"
        ]));
        // A string with no escape inside it is just a string.
        assert!(!enabled_after(&[b"\x1b]0;my title\x07"]));
        assert!(!enabled_after(&[
            b"\x1b]8;;https://example.invalid/2004h\x07"
        ]));
    }

    #[test]
    fn a_bare_escape_at_the_end_of_a_chunk_is_carried_not_dropped() {
        // `ESC` then a non-CSI byte is nothing; the scan must resume after
        // it rather than stalling.
        assert!(enabled_after(&[b"\x1bX\x1b[?2004h"]));
        assert!(enabled_after(&[b"\x1b", b"\x1b[?2004h"]));
    }
}
