// @vitest-environment jsdom
// Why this exists (#598): the screenshot on the issue is not a GPU artifact.
// It is what a real xterm buffer holds when the pty's grid and the pane's
// grid disagree. An agent TUI repaints its input zone by moving the cursor up
// over the rows its previous frame occupied *on the grid it believes it has*,
// erasing to the end of the screen, and reprinting. Wrap a frame line at a
// narrower width than the agent assumed and the cursor-up lands one row too
// low, the erase never reaches the top of the old frame, and the new frame is
// printed below rows that were never cleared — transcript text stranded in
// the input zone, exactly as reported.
//
// These tests drive a real @xterm/xterm buffer (no renderer, no canvas), so
// they pin the mechanism the geometry reconciliation in
// terminal-geometry-sync.ts is there to prevent.
import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";

const ESC = "\x1b";

/** Rows a printed line occupies on a `cols`-wide grid (xterm defers the wrap
 * at exactly `cols`, so a full-width line still occupies one row). */
function rowsFor(line: string, cols: number): number {
  return Math.max(1, Math.ceil(line.length / cols));
}

/**
 * Bytes an agent TUI emits for a transcript followed by `frames` repaints of
 * its input zone, with every cursor-up count computed for `agentCols` — the
 * width the pty told it about.
 */
function agentOutput(agentCols: number, transcript: string[], frames: string[][]): string {
  let out = transcript.map((line) => `${line}\r\n`).join("");
  let previousRows = 0;
  for (const frame of frames) {
    if (previousRows > 0) out += `${ESC}[${previousRows}A\r${ESC}[J`;
    out += frame.map((line) => `${line}\r\n`).join("");
    previousRows = frame.reduce((rows, line) => rows + rowsFor(line, agentCols), 0);
  }
  return out;
}

async function bufferLines(cols: number, rows: number, data: string): Promise<string[]> {
  const terminal = new Terminal({ cols, rows, scrollback: 200, allowProposedApi: true });
  try {
    await new Promise<void>((resolve) => terminal.write(data, resolve));
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
    return lines.filter((line) => line.trim().length > 0);
  } finally {
    terminal.dispose();
  }
}

const PTY_COLS = 100;
const PANE_COLS = 80;
const TRANSCRIPT = [
  "es el comportamiento esperado del pipeline.",
  "Vale la pena separarlo en su propio MR.",
];
// 90 columns: one row at the pty's width, two at the pane's.
const draft = (n: number) => `> draft ${n} `.padEnd(90, ".");
const FRAMES = [0, 1, 2, 3].map((n) => [draft(n), `  hint ${n}`]);
const output = agentOutput(PTY_COLS, TRANSCRIPT, FRAMES);

describe("an agent's input-zone repaint against a mismatched pty grid", () => {
  it("leaves every superseded frame stranded above the input zone", async () => {
    const lines = await bufferLines(PANE_COLS, 24, output);
    // Only the newest draft should exist; each earlier one survived because
    // the erase started a row too low.
    for (const n of [0, 1, 2]) {
      expect(lines.some((line) => line.includes(`> draft ${n} `))).toBe(true);
    }
    expect(lines.some((line) => line.includes("> draft 3 "))).toBe(true);
    // The transcript is intact; the damage is confined to the input zone.
    expect(lines[0]).toContain(TRANSCRIPT[0]);
  });

  it("strands the stale rows between the transcript and the live input zone", async () => {
    const lines = await bufferLines(PANE_COLS, 24, output);
    const liveDraft = lines.findIndex((line) => line.includes("> draft 3 "));
    const lastTranscript = lines.findIndex((line) => line.includes(TRANSCRIPT[1]));
    expect(lastTranscript).toBeGreaterThanOrEqual(0);
    expect(liveDraft).toBeGreaterThan(lastTranscript + 1);
    // Rows the agent believes it erased are still on screen, and the only
    // hint line that belongs to the live frame is the last one.
    expect(lines.filter((line) => line.startsWith("  hint ")).length).toBe(1);
  });
});

describe("the same output on a grid that matches the pty", () => {
  it("repaints the input zone cleanly, leaving no superseded frame behind", async () => {
    const lines = await bufferLines(PTY_COLS, 24, output);
    for (const n of [0, 1, 2]) {
      expect(lines.some((line) => line.includes(`> draft ${n} `))).toBe(false);
    }
    expect(lines.some((line) => line.includes("> draft 3 "))).toBe(true);
    expect(lines.filter((line) => line.startsWith("  hint ")).length).toBe(1);
    // Transcript, live draft, live hint — nothing stranded in between.
    expect(lines).toHaveLength(TRANSCRIPT.length + FRAMES[0].length);
  });

  it("is clean at every width the agent was actually told about", async () => {
    for (const cols of [60, 80, 100, 132]) {
      const lines = await bufferLines(cols, 24, agentOutput(cols, TRANSCRIPT, FRAMES));
      expect(lines.some((line) => line.includes("> draft 0 "))).toBe(false);
      expect(lines.some((line) => line.includes("> draft 3 "))).toBe(true);
    }
  });
});
