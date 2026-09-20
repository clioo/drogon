// Issue #605: where a terminal is allowed to change its own grid.
//
// An agent TUI (Claude Code, Pi, OpenCode, Codex, Antigravity — every one of
// them) repaints its input zone relative to the cursor: move up over the rows
// the previous frame occupied *on the grid the pty told it about*, erase to
// the end of the screen, reprint. That arithmetic is only valid if the
// emulator wraps those same bytes at that same width.
//
// Drogon's emulator is not in the process that owns the pty. The pane
// measured a new grid, resized xterm immediately, and only then sent
// `session.resize` over IPC. Every byte the agent emitted in between was
// composed for the OLD grid and parsed at the NEW one: the wrap moves, the
// cursor-up lands a row short, the erase never reaches the top of the old
// frame, and the superseded frame is stranded below the live one — for the
// rest of the session, because the agent will never address those rows again.
// During a divider drag or a window resize the pane refits on every
// ResizeObserver tick while the pty trails a round trip behind, so the
// mismatch holds for the whole gesture and strands a row per frame.
//
// The daemon now reports `gridCursor` with every session: the ring offset its
// current `cols`x`rows` took effect at (crates/drogon-core/src/session.rs
// `resize`). This module turns that into the only rule the pane needs — the
// emulator changes grid at that byte and nowhere else — which also covers a
// resize this pane never asked for (a second surface, `drogon-cli terminal
// resize`, a bot, an orchestration worker).

export type TerminalGrid = { cols: number; rows: number };

/** A read page, as `session.read`/`session.output` answer it. */
export type TerminalOutputPage = {
  startCursor: number;
  nextCursor: number;
  bytes: Uint8Array;
};

/** The pty grid a page reports, with the offsets its grids took effect at. */
export type ReportedPtyGrid = {
  cols: number;
  rows: number;
  /** Absent on a daemon predating the field: "always been this grid". */
  gridCursor?: number;
  /**
   * Every grid this page spans: the one in force at its first byte, then
   * each change inside it. Absent on a daemon that only reports the newest
   * cut, which the planner degrades to.
   */
  gridChanges?: readonly { cursor: number; cols: number; rows: number }[];
};

/**
 * How to feed one page to the emulator. `head` is written at the current
 * grid; `grid`, when present, is applied after it; `tail` is written at the
 * new grid. Either slice may be empty.
 */
/**
 * One step of feeding a page to the emulator: write these bytes, or change
 * to this grid. The pane runs them in order through its write chain.
 */
export type GridCutStep =
  | { kind: "write"; bytes: Uint8Array }
  | { kind: "grid"; grid: TerminalGrid };

const isGrid = (grid: TerminalGrid) =>
  Number.isInteger(grid.cols) &&
  Number.isInteger(grid.rows) &&
  grid.cols > 0 &&
  grid.rows > 0;

const sameGrid = (a: TerminalGrid, b: TerminalGrid) =>
  a.cols === b.cols && a.rows === b.rows;

/**
 * Splits a page into writes and grid changes at the offsets the pty changed
 * grid.
 *
 * `changes` is the daemon's `gridChanges` for this page: the grid in force
 * at its first byte, then every change inside it, in order. More than one is
 * ordinary — two resizes land in the same page whenever a drag outruns the
 * read cadence — and each one has to be applied at its own byte, or the
 * bytes composed at an intermediate grid are parsed at the wrong width and
 * stranded for good (#605).
 *
 * A cut at or before the page's start applies before any byte is written,
 * which is also how a reader carried past a cut by ring truncation still
 * lands on the right grid. Cuts sharing one cursor collapse to the last:
 * no byte was composed between them (a resize storm with no output in
 * between), so only that grid ever governs a byte and the earlier ones
 * would reflow the buffer for nothing. A change to the grid the emulator
 * already holds is dropped for the same reason.
 *
 * Falls back to the single `gridCursor` when a daemon reports no changes
 * array, and to "no change" when it reports neither.
 */
export function planGridCutWrites(
  page: TerminalOutputPage,
  reported: ReportedPtyGrid,
  current: TerminalGrid,
): GridCutStep[] {
  const changes = normalizeChanges(page, reported);
  const steps: GridCutStep[] = [];
  let held = current;
  let written = 0;
  for (const change of changes) {
    const grid = { cols: change.cols, rows: change.rows };
    if (sameGrid(grid, held)) continue;
    const offset = Math.min(
      page.bytes.length,
      Math.max(0, change.cursor - page.startCursor),
    );
    if (offset > written) {
      steps.push({ kind: "write", bytes: page.bytes.subarray(written, offset) });
      written = offset;
    }
    steps.push({ kind: "grid", grid });
    held = grid;
  }
  // The remainder always goes out, even when empty: the pane awaits this
  // last write to know the page has landed.
  steps.push({ kind: "write", bytes: page.bytes.subarray(written) });
  return steps;
}

/**
 * The changes this page carries, in cursor order, dropping anything a
 * reader cannot act on. A cut past the page's own end is not this page's to
 * apply — those bytes predate the resize — except when it sits exactly at
 * the end, which is how an idle session whose resize produced no output
 * still reaches its new grid.
 */
function normalizeChanges(
  page: TerminalOutputPage,
  reported: ReportedPtyGrid,
): { cursor: number; cols: number; rows: number }[] {
  const list = Array.isArray(reported.gridChanges) ? reported.gridChanges : null;
  const source =
    list ??
    // Older daemon: one cut is all it can say.
    [
      {
        cursor: Number.isInteger(reported.gridCursor) ? reported.gridCursor! : 0,
        cols: reported.cols,
        rows: reported.rows,
      },
    ];
  const ordered = source
    .filter(
      (change) =>
        !!change &&
        Number.isInteger(change.cursor) &&
        change.cursor <= page.nextCursor &&
        isGrid(change),
    )
    .sort((a, b) => a.cursor - b.cursor);
  // A resize storm with no output between resizes leaves several cuts at
  // one cursor; only the last governs any byte, so the earlier ones are
  // not this page's to apply.
  return ordered.filter(
    (change, index) =>
      index + 1 >= ordered.length || ordered[index + 1].cursor !== change.cursor,
  );
}
