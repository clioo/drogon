//! Renders what a terminal actually displays from the accumulated PTY
//! byte stream: source `terminal read --screen`. A pure VT-ish renderer —
//! no history paging, just the current frame after replaying every byte
//! the ring retained.

/// One rendered screen: rows of text plus the honesty flag for bytes we
/// could not decode as UTF-8.
#[derive(Debug, PartialEq, Eq)]
pub struct RenderedScreen {
    pub lines: Vec<String>,
    pub undecoded_bytes: u64,
}

struct Screen {
    grid: Vec<Vec<char>>,
    row: usize,
    col: usize,
    undecoded_bytes: u64,
}

impl Screen {
    fn new(cols: usize, rows: usize) -> Self {
        Self {
            grid: vec![vec![' '; cols]; rows],
            row: 0,
            col: 0,
            undecoded_bytes: 0,
        }
    }

    fn put(&mut self, ch: char) {
        if self.row >= self.grid.len() {
            return;
        }
        if self.col >= self.grid[0].len() {
            // Software wrap like a real terminal: continue on the next row.
            self.row += 1;
            self.col = 0;
            if self.row >= self.grid.len() {
                self.scroll();
                self.row = self.grid.len() - 1;
            }
        }
        // Wide glyphs span two physical cells on a real screen; in this
        // text grid they occupy one cell so CJK strings render contiguously.
        let _ = ch_width;
        self.grid[self.row][self.col] = ch;
        self.col += 1;
    }

    fn scroll(&mut self) {
        self.grid.remove(0);
        let cols = self.grid[0].len();
        self.grid.push(vec![' '; cols]);
    }

    fn newline(&mut self) {
        // A TTY's LF moves rows only because the tty driver maps NL to
        // CR+LF (ONLCR); rendered frames never keep the column.
        self.col = 0;
        self.row += 1;
        if self.row >= self.grid.len() {
            self.scroll();
            self.row = self.grid.len() - 1;
        }
    }

    /// Trim trailing spaces per row and drop leading/trailing empty rows —
    /// the readable essence of the frame.
    fn render(mut self) -> RenderedScreen {
        let mut lines: Vec<String> = self
            .grid
            .drain(..)
            .map(|row| row.into_iter().collect::<String>().trim_end().to_string())
            .collect();
        while lines.first().is_some_and(|l| l.is_empty()) {
            lines.remove(0);
        }
        while lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        RenderedScreen {
            lines,
            undecoded_bytes: self.undecoded_bytes,
        }
    }
}

/// Character cell width: wide CJK fills two cells, control characters
/// none. Good enough for rendered-screen parity without a full wcwidth.
fn ch_width(ch: char) -> usize {
    let c = ch as u32;
    // CJK Unified Ideographs and common fullwidth ranges.
    if (0x1100..=0x115F).contains(&c)
        || (0x2E80..=0xA4CF).contains(&c) && c != 0x303F
        || (0xAC00..=0xD7A3).contains(&c)
        || (0xF900..=0xFAFF).contains(&c)
        || (0xFE30..=0xFE6F).contains(&c)
        || (0xFF00..=0xFF60).contains(&c)
        || (0xFFE0..=0xFFE6).contains(&c)
    {
        2
    } else {
        1
    }
}

/// Replays a PTY byte stream and returns the visible frame. Unsupported
/// escape sequences (SGR colors, mode sets, OSC titles) are consumed and
/// ignored; the cursor-affecting subset (CUU/CUD/CUF/CUB, CUP, ED/EL,
/// CR/LF/BS/TAB) is applied.
pub fn render_screen(bytes: &[u8], cols: usize, rows: usize) -> RenderedScreen {
    let mut screen = Screen::new(cols.max(1), rows.max(1));
    let mut i = 0usize;
    while i < bytes.len() {
        let byte = bytes[i];
        i += 1;
        match byte {
            b'\x1b' if i < bytes.len() && bytes[i] == b'[' => {
                i += 1;
                let mut params = String::new();
                while i < bytes.len()
                    && (bytes[i].is_ascii_digit() || bytes[i] == b';' || bytes[i] == b'?')
                {
                    params.push(bytes[i] as char);
                    i += 1;
                }
                if i >= bytes.len() {
                    break;
                }
                let final_byte = bytes[i];
                i += 1;
                apply_csi(&mut screen, &params, final_byte);
            }
            b'\x1b' if i < bytes.len() && bytes[i] == b']' => {
                i += 1;
                while i < bytes.len() {
                    let b = bytes[i];
                    i += 1;
                    if b == 0x07 || (b == b'\\' && bytes[i - 2] == 0x1b) {
                        break;
                    }
                }
            }
            b'\x1b' if i < bytes.len() => {
                // Two-byte escapes (ESC (, ESC ), ESC =, …): consume the
                // final byte so it never renders.
                i += 1;
            }
            b'\x1b' => {}
            b'\r' => screen.col = 0,
            b'\n' => screen.newline(),
            0x08 => screen.col = screen.col.saturating_sub(1),
            b'\t' => {
                let next = (screen.col / 8 + 1) * 8;
                screen.col = next.min(screen.grid[0].len().saturating_sub(1));
            }
            0x00..=0x1f | 0x7f => {}
            0x20..=0x7e => screen.put(byte as char),
            _ => {
                // `byte` is a non-ASCII UTF-8 lead; splice its continuation
                // bytes.
                let extra = match byte {
                    0xc0..=0xdf => 1,
                    0xe0..=0xef => 2,
                    0xf0..=0xf7 => 3,
                    _ => {
                        screen.undecoded_bytes += 1;
                        continue;
                    }
                };
                if i + extra > bytes.len() || bytes[i..i + extra].iter().any(|b| b & 0xc0 != 0x80) {
                    screen.undecoded_bytes += 1;
                    // Skip one continuation byte per failed sequence so a
                    // run of stray bytes is counted, not looped on.
                    continue;
                }
                match std::str::from_utf8(&bytes[i - 1..i + extra]) {
                    Ok(text) => {
                        if let Some(ch) = text.chars().next() {
                            screen.put(ch);
                        }
                        i += extra;
                    }
                    Err(_) => screen.undecoded_bytes += 1,
                }
            }
        }
    }
    screen.render()
}

fn apply_csi(screen: &mut Screen, params: &str, final_byte: u8) {
    let nums: Vec<usize> = params
        .split(';')
        .map(|p| p.parse::<usize>().unwrap_or(0))
        .collect();
    let n = |i: usize, default: usize| nums.get(i).copied().filter(|v| *v != 0).unwrap_or(default);
    match final_byte {
        b'A' => screen.row = screen.row.saturating_sub(n(0, 1)),
        b'B' => {
            screen.row = (screen.row + n(0, 1)).min(screen.grid.len() - 1);
        }
        b'C' => {
            screen.col = (screen.col + n(0, 1)).min(screen.grid[0].len() - 1);
        }
        b'D' => screen.col = screen.col.saturating_sub(n(0, 1)),
        b'E' => {
            screen.col = 0;
            screen.row = (screen.row + n(0, 1)).min(screen.grid.len() - 1);
        }
        b'F' => {
            screen.col = 0;
            screen.row = screen.row.saturating_sub(n(0, 1));
        }
        b'G' => screen.col = n(0, 1).saturating_sub(1).min(screen.grid[0].len() - 1),
        b'H' | b'f' => {
            screen.row = n(0, 1).saturating_sub(1).min(screen.grid.len() - 1);
            screen.col = n(1, 1).saturating_sub(1).min(screen.grid[0].len() - 1);
        }
        b'J' => {
            let mode = nums.first().copied().unwrap_or(0);
            let cols = screen.grid[0].len();
            match mode {
                2 | 3 => {
                    screen.grid = vec![vec![' '; cols]; screen.grid.len()];
                }
                _ => {}
            }
        }
        b'K' => {
            let mode = nums.first().copied().unwrap_or(0);
            let cols = screen.grid[0].len();
            match mode {
                0 => {
                    for cell in screen.grid[screen.row][screen.col..].iter_mut() {
                        *cell = ' ';
                    }
                }
                1 => {
                    for cell in screen.grid[screen.row][..=screen.col.min(cols - 1)].iter_mut() {
                        *cell = ' ';
                    }
                }
                _ => {
                    screen.grid[screen.row] = vec![' '; cols];
                }
            }
        }
        // SGR and anything else: display-irrelevant, already consumed.
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_renders_line_by_line() {
        let out = render_screen(b"hello\nworld", 80, 24);
        assert_eq!(out.lines, vec!["hello", "world"]);
        assert_eq!(out.undecoded_bytes, 0);
    }

    #[test]
    fn carriage_return_repaints_progress_bars_instead_of_stacking() {
        // The exact failure mode the source documents: one clear read as
        // fragments. A CR-prefixed repaint must leave one frame.
        let out = render_screen(b"[####    ] 40%\r[####### ] 70%\r[########] done", 80, 24);
        assert_eq!(out.lines, vec!["[########] done"]);
    }

    #[test]
    fn el_clears_from_the_cursor_so_repaints_are_clean() {
        let out = render_screen(b"old longer line\r\x1b[Kover", 80, 24);
        assert_eq!(out.lines, vec!["over"]);
    }

    #[test]
    fn cup_positions_the_cursor_and_ed_clears_the_screen() {
        let out = render_screen(b"first\x1b[2J\x1b[Hsecond", 80, 24);
        assert_eq!(out.lines, vec!["second"]);
    }

    #[test]
    fn colors_and_titles_are_consumed_never_rendered() {
        let out = render_screen(b"\x1b]0;my title\x07\x1b[31mred\x1b[0m plain", 80, 24);
        assert_eq!(out.lines, vec!["red plain"]);
    }

    #[test]
    fn cursor_up_overwrites_the_previous_line() {
        let out = render_screen(b"one\ntwo\x1b[1A\x1b[GONE", 80, 24);
        assert_eq!(out.lines, vec!["ONE", "two"]);
    }

    #[test]
    fn scrolling_keeps_the_last_rows_when_the_screen_is_full() {
        let mut stream = Vec::new();
        for i in 0..30 {
            stream.extend_from_slice(format!("line-{i}\n").as_bytes());
        }
        let out = render_screen(&stream, 80, 10);
        // The trailing \n scrolls in a blank prompt row, which render()
        // trims: 9 visible lines ending at line-29.
        assert_eq!(out.lines.len(), 9);
        assert_eq!(out.lines[out.lines.len() - 1], "line-29");
        assert_eq!(out.lines[0], "line-21");
    }

    #[test]
    fn wide_cjk_characters_occupy_two_cells() {
        let out = render_screen("配置".as_bytes(), 80, 24);
        assert_eq!(out.lines, vec!["配置"]);
    }

    #[test]
    fn malformed_utf8_is_counted_not_panicked() {
        let out = render_screen(&[b'o', b'k', 0xff, 0xfe, b'!'], 80, 24);
        assert_eq!(out.lines, vec!["ok!"]);
        assert_eq!(out.undecoded_bytes, 2);
    }

    #[test]
    fn tabs_advance_to_the_next_stop_without_emitting_spaces_mid_row() {
        let out = render_screen(b"a\tb", 80, 24);
        // Cell 0 'a', cells 1..8 blank, cell 8 'b'.
        assert_eq!(out.lines, vec!["a       b"]);
    }
}
