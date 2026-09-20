// @vitest-environment jsdom
// Why this exists (#605): the screenshot on the issue — stale transcript rows
// stranded under a live Claude Code input box — is what a real xterm buffer
// holds after a pane resize, even when the pty ends up at exactly the right
// size. The pane used to call `fit.fit()` synchronously and only then send
// `session.resize` over IPC, so every frame the agent emitted in between was
// composed for the old grid and parsed at the new one. Its cursor-up landed
// short, its erase never reached the top of the frame it was replacing, and
// the superseded frame stayed on screen for the rest of the session.
//
// These tests drive a real @xterm/xterm buffer (no renderer, no canvas) over
// a simulated pty byte stream, so they pin the behaviour rather than the
// implementation: one run applies the grid the way the pane used to, the
// other applies it at `gridCursor` the way `planGridCutWrite` does.
import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { planGridCutWrites } from "./terminal-grid-cut";

const ESC = "\x1b";
const PTY_COLS = 100;
const PANE_COLS = 80;
const ROWS = 24;
/** 90 columns: one row at the pty's width, two at the pane's. */
const draft = (n: number) => `> draft ${n} `.padEnd(90, ".");
const frame = (n: number) => [draft(n), `  hint ${n}`];
const TRANSCRIPT = [
  "es el comportamiento esperado del pipeline.",
  "Vale la pena separarlo en su propio MR.",
];

const rowsFor = (line: string, cols: number) =>
  Math.max(1, Math.ceil(line.length / cols));

/**
 * One repaint of an agent's input zone: move up over the rows the previous
 * frame occupies *on the grid the agent was told about*, erase to the end of
 * the screen, reprint.
 *
 * The previous frame's height is measured at the width in force *now*, not
 * at the width it was printed at — that is what a well-behaved TUI does after
 * a SIGWINCH, because its terminal reflowed those rows to the new width. So
 * the arithmetic is correct on any terminal that is actually at `cols`, and
 * wrong on one that is not. That is the whole bug.
 */
function repaint(lines: string[], previous: string[], cols: number): string {
  const previousRows = previous.reduce((rows, line) => rows + rowsFor(line, cols), 0);
  const head = previousRows > 0 ? `${ESC}[${previousRows}A\r${ESC}[J` : "";
  return head + lines.map((line) => `${line}\r\n`).join("");
}

/**
 * The byte stream a pty produces across a resize: `before` frames composed at
 * `PTY_COLS`, then the SIGWINCH cut, then `after` frames composed at
 * `PANE_COLS`. `gridCursor` is the absolute offset the new grid took effect
 * at — exactly what `session::resize` records.
 */
function ptyStream(before: number[], after: number[]) {
  const encoder = new TextEncoder();
  let text = TRANSCRIPT.map((line) => `${line}\r\n`).join("");
  let previous: string[] = [];
  for (const n of before) {
    text += repaint(frame(n), previous, PTY_COLS);
    previous = frame(n);
  }
  const gridCursor = encoder.encode(text).length;
  for (const n of after) {
    text += repaint(frame(n), previous, PANE_COLS);
    previous = frame(n);
  }
  return { bytes: encoder.encode(text), gridCursor };
}

const write = (terminal: Terminal, bytes: Uint8Array) =>
  new Promise<void>((resolve) => terminal.write(bytes, resolve));

function visibleLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < buffer.length; row += 1) {
    lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
  }
  return lines.filter((line) => line.trim().length > 0);
}

/** Frames the agent has already replaced but that are still on screen. */
const strandedDrafts = (lines: string[], live: number) =>
  lines.filter(
    (line) => line.includes("> draft ") && !line.includes(`> draft ${live} `),
  );

/**
 * Feeds `bytes` to a terminal in `pageSize` pages, applying the pty's grid
 * wherever `applyAt` says to. Mirrors the pane's read loop: every page is a
 * `session.read`/`session.output` answer carrying the pty's current grid.
 */
async function replay(options: {
  bytes: Uint8Array;
  gridCursor: number;
  pageSize: number;
  /** Cursor at which the terminal actually adopts `PANE_COLS`. */
  applyAt: "cut" | number;
}): Promise<string[]> {
  const terminal = new Terminal({
    cols: PTY_COLS,
    rows: ROWS,
    scrollback: 200,
    allowProposedApi: true,
  });
  try {
    for (let start = 0; start < options.bytes.length; start += options.pageSize) {
      const bytes = options.bytes.subarray(start, start + options.pageSize);
      const nextCursor = start + bytes.length;
      // What the daemon reports for this page: the grid in force at the
      // moment it answered, plus the offset that grid took effect at.
      const reported =
        nextCursor > options.gridCursor
          ? { cols: PANE_COLS, rows: ROWS, gridCursor: options.gridCursor }
          : { cols: PTY_COLS, rows: ROWS, gridCursor: 0 };
      if (options.applyAt === "cut") {
        for (const step of planGridCutWrites(
          { startCursor: start, nextCursor, bytes },
          reported,
          { cols: terminal.cols, rows: terminal.rows },
        )) {
          if (step.kind === "grid") terminal.resize(step.grid.cols, step.grid.rows);
          else if (step.bytes.length > 0) await write(terminal, step.bytes);
        }
      } else {
        // The old pane: xterm took the new grid the moment the pane measured
        // it, which is somewhere ahead of the byte the pty changed at.
        if (start <= options.applyAt && options.applyAt < nextCursor) {
          terminal.resize(PANE_COLS, ROWS);
        }
        await write(terminal, bytes);
      }
    }
    return visibleLines(terminal);
  } finally {
    terminal.dispose();
  }
}

describe("a pane resize while an agent is repainting its input zone", () => {
  const stream = ptyStream([0, 1, 2], [3, 4, 5]);

  it("strands every frame in flight when the terminal re-wraps ahead of the pty", async () => {
    // The pane resized xterm as soon as it measured, well before the pty's
    // SIGWINCH: this is the reported bug.
    const lines = await replay({
      ...stream,
      pageSize: 4096,
      applyAt: Math.floor(stream.gridCursor / 2),
    });
    expect(strandedDrafts(lines, 5).length).toBeGreaterThan(0);
  });

  it("strands nothing when the grid changes at the byte the pty changed at", async () => {
    const lines = await replay({ ...stream, pageSize: 4096, applyAt: "cut" });
    expect(strandedDrafts(lines, 5)).toEqual([]);
    expect(lines.some((line) => line.includes("> draft 5 "))).toBe(true);
    // One hint line, one draft, and the transcript above them — the agent's
    // input zone holds exactly its live frame.
    expect(lines.filter((line) => line.trim().startsWith("hint "))).toHaveLength(1);
    expect(lines[0]).toContain(TRANSCRIPT[0]);
    expect(lines[1]).toContain(TRANSCRIPT[1]);
  });

  it("stays clean when the cut falls inside a page, at any page size", async () => {
    // The cut almost never lands on a page boundary: 64 KiB pages, an 8 KiB
    // hold answer and a byte-at-a-time drip must all split it the same way.
    for (const pageSize of [1, 7, 64, 512, 65_536]) {
      const lines = await replay({ ...stream, pageSize, applyAt: "cut" });
      expect(strandedDrafts(lines, 5)).toEqual([]);
    }
  });

  it("stays clean when the agent emits nothing after the SIGWINCH", async () => {
    // The cut sits at the live edge and no byte ever follows it; the pane
    // must still reach the new grid.
    const quiet = ptyStream([0, 1, 2], []);
    const lines = await replay({ ...quiet, pageSize: 4096, applyAt: "cut" });
    expect(strandedDrafts(lines, 2)).toEqual([]);
  });

  it("stays clean across a gesture that resizes many times", async () => {
    // A divider drag is dozens of resizes, each one a chance to strand a
    // frame. Widths alternate so every step re-wraps the frame in flight.
    const encoder = new TextEncoder();
    const terminal = new Terminal({
      cols: PTY_COLS,
      rows: ROWS,
      scrollback: 400,
      allowProposedApi: true,
    });
    try {
      const header = encoder.encode(TRANSCRIPT.map((l) => `${l}\r\n`).join(""));
      await write(terminal, header);
      let cursor = header.length;
      let previous: string[] = [];
      let ptyCols = PTY_COLS;
      let live = -1;
      for (let step = 0; step < 24; step += 1) {
        const nextCols = 70 + ((step * 13) % 45);
        // The pty takes the new grid here; everything before this byte was
        // composed at `ptyCols`.
        const gridCursor = cursor;
        live = step;
        const bytes = encoder.encode(repaint(frame(step), previous, nextCols));
        previous = frame(step);
        for (const step of planGridCutWrites(
          { startCursor: cursor, nextCursor: cursor + bytes.length, bytes },
          { cols: nextCols, rows: ROWS, gridCursor },
          { cols: terminal.cols, rows: terminal.rows },
        )) {
          if (step.kind === "grid") terminal.resize(step.grid.cols, step.grid.rows);
          else if (step.bytes.length > 0) await write(terminal, step.bytes);
        }
        cursor += bytes.length;
        ptyCols = nextCols;
      }
      expect(ptyCols).toBe(terminal.cols);
      expect(strandedDrafts(visibleLines(terminal), live)).toEqual([]);
    } finally {
      terminal.dispose();
    }
  });
});

// Adversarial finding F1, against a real buffer: two resizes inside ONE read
// page. Reported as a single newest grid, the frame composed at the middle
// width is parsed at the wrong one and stranded permanently — the reported
// bug, reached by a route the single-cut planner could not see. A fast
// divider drag against a chatty TUI is how two cuts land in one page.
describe("two resizes inside one read page", () => {
  // Widths chosen so the middle grid makes the agent UNDER-erase: it composes
  // its cursor-up for a 170-column terminal, where its frame is one row, while
  // the emulator is still at 100, where it is two. Over-erasing would eat the
  // transcript instead of stranding a row, and prove nothing about this bug.
  const START = 100;
  const MID = 170;
  const END = 72;
  const wideDraft = (n: number) => `> draft ${n} `.padEnd(150, ".");
  const wideFrame = (n: number) => [wideDraft(n), `  hint ${n}`];

  function twoCutStream() {
    const encoder = new TextEncoder();
    let text = TRANSCRIPT.map((line) => `${line}\r\n`).join("");
    let previous: string[] = [];
    const span = (ids: number[], cols: number) => {
      for (const n of ids) {
        text += repaint(wideFrame(n), previous, cols);
        previous = wideFrame(n);
      }
    };
    span([0, 1], START);
    const firstCut = encoder.encode(text).length;
    span([2, 3], MID);
    const secondCut = encoder.encode(text).length;
    span([4, 5], END);
    return { bytes: encoder.encode(text), firstCut, secondCut };
  }

  async function render(changes: { cursor: number; cols: number; rows: number }[]) {
    const stream = twoCutStream();
    const terminal = new Terminal({
      cols: START,
      rows: ROWS,
      scrollback: 200,
      allowProposedApi: true,
    });
    try {
      // One page carrying the whole stream: both resizes landed inside it.
      for (const step of planGridCutWrites(
        { startCursor: 0, nextCursor: stream.bytes.length, bytes: stream.bytes },
        { cols: END, rows: ROWS, gridCursor: stream.secondCut, gridChanges: changes },
        { cols: START, rows: ROWS },
      )) {
        if (step.kind === "grid") terminal.resize(step.grid.cols, step.grid.rows);
        else if (step.bytes.length > 0) await write(terminal, step.bytes);
      }
      return visibleLines(terminal);
    } finally {
      terminal.dispose();
    }
  }

  it("strands the middle frame when only the newest grid is reported", async () => {
    // What one cut per page can express — and why it is not enough.
    const stream = twoCutStream();
    const lines = await render([
      { cursor: 0, cols: START, rows: ROWS },
      { cursor: stream.secondCut, cols: END, rows: ROWS },
    ]);
    expect(strandedDrafts(lines, 5).length).toBeGreaterThan(0);
  });

  it("strands nothing when the page carries both cuts", async () => {
    const stream = twoCutStream();
    const lines = await render([
      { cursor: 0, cols: START, rows: ROWS },
      { cursor: stream.firstCut, cols: MID, rows: ROWS },
      { cursor: stream.secondCut, cols: END, rows: ROWS },
    ]);
    expect(strandedDrafts(lines, 5)).toEqual([]);
    expect(lines.some((line) => line.includes("> draft 5 "))).toBe(true);
  });
});
