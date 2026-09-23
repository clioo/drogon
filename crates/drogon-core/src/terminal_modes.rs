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
//!
//! The flag is the session's, not a program's, and it says what the last
//! announcement said — exactly like a terminal. So a TUI that is killed
//! before it can emit `ESC [ ? 2004 l` leaves the mode on for whatever
//! runs next in that PTY, and a message-sized send to a plain shell there
//! arrives wrapped in markers the shell shows as text. That is the same
//! state a real terminal would be left in by the same bytes — the
//! desktop's own xterm would be showing a bracketed-paste session too,
//! and `reset`, a new TUI, or any shell that announces its own prompt
//! mode corrects both at once. Tracking an exit here instead would mean
//! guessing which program owns the PTY, which is exactly the guesswork
//! this module exists to remove.
//!
//! The alternate-screen flag is stale in the same way and for the same
//! reason, but it errs the other way: a full-screen program killed
//! before it can emit `ESC [ ? 1049 l` leaves the session looking
//! full-screen, so framing is withheld from whatever runs next and a
//! message gets the paced Return alone. That is the safe direction — a
//! weaker delivery, never corrupted keystrokes — and a session Drogon
//! launched an agent composer into is unaffected, because its launch
//! record outranks the screen.

/// `ESC` — the byte every sequence here starts with.
const ESC: u8 = 0x1b;

/// The DEC private mode number for bracketed paste.
const BRACKETED_PASTE_MODE: u32 = 2004;

/// The DEC private modes that switch to and from the alternate screen:
/// 47 (the original), 1047 (clear on exit) and 1049 (save cursor and
/// clear). Switching to it says a full-screen application is painting —
/// which is NOT the same as saying it is not a composer, because
/// Antigravity is both. It is only the tie-breaker for a session whose
/// far end Drogon did not launch; see [`TerminalModes::paste_is_text`].
const ALTERNATE_SCREEN_MODES: [u32; 3] = [47, 1047, 1049];

/// Longest partial sequence carried across chunk boundaries. A real
/// private-mode set is far shorter than this even when a TUI sets
/// everything at once; anything longer is not a mode sequence and is
/// dropped rather than retained forever. Only a sequence SPLIT across
/// chunks is subject to the bound — one that arrives whole is parsed up
/// to [`MAX_PARAMS`].
const MAX_PENDING: usize = 256;

/// Parameters a private-mode sequence may carry before it stops being
/// one. xterm's parser keeps 32 and discards a sequence with more, and
/// the desktop renders these very bytes with xterm; being more permissive
/// than the terminal beside us would mean framing for a far end the user's
/// own screen says never asked.
const MAX_PARAMS: usize = 32;

/// Opening marker of a bracketed paste, as the terminal sends it.
pub(crate) const BRACKETED_PASTE_START: &[u8] = b"\x1b[200~";
/// Closing marker. Everything before it is paste; what follows is typing.
pub(crate) const BRACKETED_PASTE_END: &[u8] = b"\x1b[201~";

/// Incremental observer of the DEC private modes over a session's output.
///
/// Fed every output chunk in order, it reports what the far end has asked
/// for. Sequences split across chunk boundaries are carried, because an
/// 8 KiB read can end mid-escape.
#[derive(Debug, Default)]
pub(crate) struct BracketedPasteScanner {
    /// Bytes from the tail of an earlier chunk that may still be the start
    /// of a mode sequence.
    pending: Vec<u8>,
    modes: TerminalModes,
}

/// What the far end's announcements add up to.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TerminalModes {
    /// DECSET 2004: the far end can tell a paste from typing.
    pub(crate) bracketed_paste: bool,
    /// DECSET 47/1047/1049: the far end is a full-screen application.
    pub(crate) alternate_screen: bool,
}

impl TerminalModes {
    /// Whether a framed body would be read as TEXT by this far end,
    /// given whether Drogon launched an agent composer in the PTY.
    ///
    /// Bracketed paste alone is not enough, and an adversarial pass is
    /// why. vim announces 2004 like any modern application, but `:wq`
    /// pasted into vim is text typed into a buffer, not an Ex command —
    /// the send reported success while vim sat in INSERT mode with
    /// `:wqhello` on screen. What separates the two is not the length of
    /// the body (that was tried, and it only moved the failure) but what
    /// kind of program is on the far end.
    ///
    /// Two things answer that, in order. If `harness.start` launched the
    /// far end, Drogon KNOWS it is an agent composer — every harness it
    /// can launch is one — and that fact beats any guess. Otherwise the
    /// guess is the alternate screen, which a full-screen keystroke
    /// application switches to and announces: vim, `less`, `nano` and a
    /// full-height `fzf` all do.
    ///
    /// The launch record has to come first because the screen is a poor
    /// proxy: a later pass caught Antigravity (`agy`) painting
    /// `ESC [ ? 1049 h` before its own `ESC [ ? 2004 h`, so the screen
    /// alone would have quietly left every agy session with the bug this
    /// module exists to fix. Claude Code, Codex and Pi stay on the normal
    /// screen; agy does not; both are agent composers.
    ///
    /// A far end that is neither — an unlaunched session running a
    /// full-screen program — loses framing and keeps the paced Return,
    /// which is the safe direction: a weaker delivery, never corrupted
    /// keystrokes.
    ///
    /// The converse is the standing limit, and it is irreducible rather
    /// than unnoticed: a full-screen program the AGENT opens inside a
    /// launched session (vim, a pager) is still framed for, because the
    /// session's record says agent composer. There is no announcement
    /// that separates the two — real vim emits `ESC [ ? 1049 h` and then
    /// `ESC [ ? 2004 h`, byte for byte the order Antigravity uses, so
    /// even the order of the two cannot tell them apart. The damage is
    /// bounded: a message sent while a full-screen program holds the
    /// session's foreground never reaches the agent either way, framed
    /// or not, and `--literal` is the byte-exact path for a caller that
    /// really means keystrokes.
    pub(crate) fn paste_is_text(self, launched_agent_composer: bool) -> bool {
        self.bracketed_paste && (launched_agent_composer || !self.alternate_screen)
    }
}

/// A private-mode change this module cares about.
#[derive(Debug, Clone, Copy)]
struct ModeChange {
    /// `h` (set) rather than `l` (reset).
    on: bool,
    bracketed_paste: bool,
    alternate_screen: bool,
}

/// What [`scan_one`] found at an `ESC`.
enum Scan {
    /// A complete `ESC [ ? … h|l`; `set` is `Some` only when one of the
    /// modes this module tracks was among its parameters.
    Mode { len: usize, set: Option<ModeChange> },
    /// A complete sequence that is not a private mode change, or a byte
    /// that cannot start one: skip `len` bytes and keep looking.
    Other { len: usize },
    /// The chunk ended inside a candidate sequence.
    Incomplete,
}

/// Classifies the bytes starting at an `ESC`.
///
/// The reference for what counts is xterm's parser, because the desktop
/// renders these same bytes with xterm: if the two disagreed, the daemon
/// could frame a message for a far end the user's own screen says never
/// asked for paste. Checked against `@xterm/headless` 6.0.0, this follows
/// it on colon sub-parameters (`ESC [ ? 2004:1 h` sets the mode), on the
/// 32-parameter cap, and on an `ESC` inside an OSC, DCS, APC or PM string
/// aborting that string so a mode change written there still counts.
///
/// It deliberately differs on exactly one point. `0x9b` as a one-byte CSI
/// is honoured by xterm but ignored here: these PTYs are UTF-8, where
/// `0x9b` is a continuation byte inside an ordinary multi-byte character,
/// and honouring it would let plain text flip the mode. The divergence is
/// in the safe direction — it can only withhold framing, never add it.
///
/// An intermediate byte before the final (`ESC [ ? 2004 SP h`) is not a
/// mode change for either parser: an intermediate makes it a different
/// sequence entirely.
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
                let on = match byte {
                    b'h' => true,
                    b'l' => false,
                    _ => {
                        return Scan::Mode {
                            len: index + 1,
                            set: None,
                        };
                    }
                };
                let set =
                    tracked_modes(&bytes[params_start..index]).map(|(paste, alt)| ModeChange {
                        on,
                        bracketed_paste: paste,
                        alternate_screen: alt,
                    });
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

/// Which tracked modes the `;`-separated parameters name, as
/// `(bracketed paste, alternate screen)`, or `None` when they name
/// neither or the sequence is not one xterm would keep.
///
/// A parameter's colon sub-parameters are not part of its value, so
/// `2004:1` is mode 2004 — what xterm does with it. Beyond [`MAX_PARAMS`]
/// the sequence is not a mode change at all, which is also what xterm
/// does, so a far end whose announcement xterm drops is not framed for.
fn tracked_modes(params: &[u8]) -> Option<(bool, bool)> {
    let mut paste = false;
    let mut alternate = false;
    for (index, param) in params.split(|byte| *byte == b';').enumerate() {
        if index >= MAX_PARAMS {
            return None;
        }
        let value = param.split(|byte| *byte == b':').next().unwrap_or_default();
        let Some(mode) = std::str::from_utf8(value)
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        if mode == BRACKETED_PASTE_MODE {
            paste = true;
        }
        if ALTERNATE_SCREEN_MODES.contains(&mode) {
            alternate = true;
        }
    }
    (paste || alternate).then_some((paste, alternate))
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
                    if let Some(change) = set {
                        if change.bracketed_paste {
                            self.modes.bracketed_paste = change.on;
                        }
                        if change.alternate_screen {
                            self.modes.alternate_screen = change.on;
                        }
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

    /// What the far end has asked for, as of the last chunk.
    pub(crate) fn modes(&self) -> TerminalModes {
        self.modes
    }

    /// The scanner's whole state, for a service handoff: the modes it has
    /// seen and any partial sequence split across the next read.
    pub(crate) fn parts(&self) -> (TerminalModes, Vec<u8>) {
        (self.modes, self.pending.clone())
    }

    pub(crate) fn from_parts(modes: TerminalModes, pending: Vec<u8>) -> Self {
        Self { pending, modes }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modes_after(chunks: &[&[u8]]) -> TerminalModes {
        let mut scanner = BracketedPasteScanner::default();
        for chunk in chunks {
            scanner.feed(chunk);
        }
        scanner.modes()
    }

    /// Whether the far end announced bracketed paste, ignoring what kind
    /// of screen it is on. Most cases here are about the announcement
    /// itself; `paste_is_text` has its own tests.
    fn enabled_after(chunks: &[&[u8]]) -> bool {
        modes_after(chunks).bracketed_paste
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
        assert!(!scanner.modes().bracketed_paste);
        // And the scanner still works afterwards.
        scanner.feed(b"\x1b[?2004h");
        assert!(scanner.modes().bracketed_paste);
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

    /// The discriminator an adversarial pass forced: vim announces
    /// bracketed paste exactly like a composer does, and pasting `:wq`
    /// into it types text instead of quitting. A full-screen keystroke
    /// application says what it is by switching to the alternate screen.
    #[test]
    fn a_full_screen_application_does_not_read_a_paste_as_text() {
        const UNLAUNCHED: bool = false;

        // A composer: paste on, normal screen.
        let composer = modes_after(&[b"\x1b[?2004h"]);
        assert!(composer.bracketed_paste);
        assert!(!composer.alternate_screen);
        assert!(composer.paste_is_text(UNLAUNCHED));

        // vim's shape: alternate screen and paste, in either order and
        // in either one or two sequences.
        for announcement in [
            &[&b"\x1b[?1049h"[..], &b"\x1b[?2004h"[..]][..],
            &[&b"\x1b[?2004h"[..], &b"\x1b[?1049h"[..]][..],
            &[&b"\x1b[?1049;2004h"[..]][..],
        ] {
            let modes = modes_after(announcement);
            assert!(modes.bracketed_paste, "{announcement:?}");
            assert!(modes.alternate_screen, "{announcement:?}");
            assert!(!modes.paste_is_text(UNLAUNCHED), "{announcement:?}");
        }

        // The older spellings count too.
        for mode in [b"47".as_slice(), b"1047", b"1049"] {
            let mut on = b"\x1b[?".to_vec();
            on.extend_from_slice(mode);
            on.extend_from_slice(b"h");
            assert!(
                !modes_after(&[b"\x1b[?2004h", &on]).paste_is_text(UNLAUNCHED),
                "mode {}",
                String::from_utf8_lossy(mode)
            );
        }

        // Leaving the alternate screen gives the paste its meaning back,
        // which is what happens when a pager exits back to the composer.
        assert!(
            modes_after(&[b"\x1b[?2004h\x1b[?1049h", b"\x1b[?1049l"]).paste_is_text(UNLAUNCHED)
        );
        // And an alternate screen with no paste announcement is still
        // not something to frame for.
        assert!(!modes_after(&[b"\x1b[?1049h"]).paste_is_text(UNLAUNCHED));
    }

    /// What Drogon launched beats what the screen suggests. Antigravity
    /// paints `ESC [ ? 1049 h` before its own `ESC [ ? 2004 h`, so the
    /// screen alone would leave every `agy` session with issue #625 —
    /// and it is an agent composer, which the launch record already
    /// says.
    #[test]
    fn a_launched_agent_composer_reads_a_paste_as_text_on_either_screen() {
        const LAUNCHED: bool = true;

        // agy's observed shape.
        let agy = modes_after(&[b"\x1b[?1049h", b"\x1b[?25l", b"\x1b[?2004h"]);
        assert!(agy.alternate_screen);
        assert!(agy.paste_is_text(LAUNCHED), "agy must still be framed for");
        assert!(
            !agy.paste_is_text(false),
            "...and the screen alone is exactly what would have missed it"
        );

        // Claude Code's and Codex's observed shape: normal screen.
        for composer in [
            &[&b"\x1b[?25l"[..], &b"\x1b[?2004h"[..], &b"\x1b[?2031h"[..]][..],
            &[
                &b"\x1b[?2004h"[..],
                &b"\x1b[?1004h"[..],
                &b"\x1b[?2026h"[..],
            ][..],
        ] {
            assert!(
                modes_after(composer).paste_is_text(LAUNCHED),
                "{composer:?}"
            );
            assert!(modes_after(composer).paste_is_text(false), "{composer:?}");
        }

        // The launch record never invents an announcement: a far end
        // that never asked for bracketed paste is never framed for,
        // whoever started it.
        assert!(!modes_after(&[b"plain output"]).paste_is_text(LAUNCHED));
        assert!(!modes_after(&[b"\x1b[?2004h", b"\x1b[?2004l"]).paste_is_text(LAUNCHED));
    }

    /// xterm ignores a NUL inside a CSI    /// xterm ignores a NUL inside a CSI and keeps parsing; this aborts
    /// the sequence. The divergence can only withhold framing, never add
    /// it, so it stays — but it is pinned rather than accidental.
    #[test]
    fn a_nul_inside_a_sequence_aborts_it_here_though_xterm_ignores_it() {
        assert!(!enabled_after(&[b"\x1b[?20\x0004h"]));
        // It cannot turn a real announcement off either.
        assert!(enabled_after(&[b"\x1b[?2004h", b"\x1b[?20\x0004l"]));
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

    /// Sub-parameters belong to the parameter, not to the mode number:
    /// xterm sets 2004 for `2004:1`, so this must too, or the daemon and
    /// the desktop's terminal would disagree about the same bytes.
    #[test]
    fn a_colon_sub_parameter_is_the_same_mode() {
        assert!(enabled_after(&[b"\x1b[?2004:1h"]));
        assert!(!enabled_after(&[b"\x1b[?2004h", b"\x1b[?2004:1l"]));
        assert!(enabled_after(&[b"\x1b[?1049;2004:1:2h"]));
        // The sub-parameter is not the mode: `1:2004` is mode 1.
        assert!(!enabled_after(&[b"\x1b[?1:2004h"]));
    }

    /// An intermediate byte makes it a different sequence for either
    /// parser, so it is not a bracketed-paste change.
    #[test]
    fn an_intermediate_byte_is_a_different_sequence() {
        assert!(!enabled_after(&[b"\x1b[?2004 h"]));
        assert!(enabled_after(&[b"\x1b[?2004h", b"\x1b[?2004 l"]));
    }

    /// Past xterm's parameter cap the sequence is dropped there, so it is
    /// dropped here: being more permissive than the terminal beside us
    /// would mean framing for a far end the user's screen says never
    /// asked.
    #[test]
    fn a_sequence_past_the_parameter_cap_is_not_a_mode_change() {
        let mut over = b"\x1b[?".to_vec();
        for _ in 0..MAX_PARAMS {
            over.extend_from_slice(b"1000;");
        }
        over.extend_from_slice(b"2004h");
        assert!(!enabled_after(&[&over]));
        // Exactly at the cap it still counts.
        let mut at_cap = b"\x1b[?".to_vec();
        for _ in 0..(MAX_PARAMS - 1) {
            at_cap.extend_from_slice(b"1000;");
        }
        at_cap.extend_from_slice(b"2004h");
        assert!(enabled_after(&[&at_cap]));
    }

    /// A long private-mode set still resolves when a chunk boundary lands
    /// in the middle of it — the carry bound is for runaway input, not for
    /// a real sequence.
    #[test]
    fn a_long_sequence_split_across_chunks_still_resolves() {
        let mut sequence = b"\x1b[?".to_vec();
        for _ in 0..(MAX_PARAMS - 1) {
            sequence.extend_from_slice(b"1000;");
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
        assert!(byte_at_a_time.modes().bracketed_paste);
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
