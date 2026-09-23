// Issue #605 acceptance: an agent TUI must not strand superseded frames in
// the terminal when the pane is resized underneath it.
//
// The reported screenshot shows stale transcript rows sitting under a live
// Claude Code input box. The cause is not the harness and not the GPU
// renderer: it is a pane whose xterm re-wrapped ahead of the pty's SIGWINCH,
// so the agent's cursor-relative erase — computed for the grid the pty told
// it about — landed on the wrong rows and never cleared the frame it was
// replacing.
//
// This probe reproduces that with a shell fixture, never a real model (the
// repo forbids provider inference from inside the app, and the bug has
// nothing to do with which harness is running): a /bin/sh loop that repaints
// its input zone exactly the way Ink-based TUIs do — re-reading the terminal
// width every frame, moving up over the rows its previous frame occupies at
// that width, erasing to the end of the screen, reprinting. That arithmetic
// is correct on any terminal that is actually at the pty's width, and wrong
// on one that is not, which is precisely the property under test.
//
// It then resizes the window repeatedly while the fixture redraws, and
// asserts the buffer holds exactly one frame afterwards.
import assert from "node:assert/strict";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** Frames drawn per width, and how many widths the gesture visits. */
const FRAMES_PER_WIDTH = 4;
// Widths that wrap the fixture's 169-column frame differently, walked
// twice: one resize is a coin flip, a gesture is the real exposure.
const VIEWPORT_WIDTHS = [1200, 780, 1040, 860, 1160, 800, 1100, 900, 1200];
/** Wide enough that every width in the gesture wraps it differently. */
const FRAME_PAD = 150;

/**
 * A TUI repaint loop in `sh`. Each frame:
 *   - re-reads `$COLUMNS` from the kernel (`stty size`), i.e. honours SIGWINCH
 *   - when the width changed since the last frame, clears the screen and
 *     repaints from the top (Ink's SIGWINCH redraw) instead of erasing
 *     with stale-grid arithmetic
 *   - otherwise computes how many rows its PREVIOUS frame occupies at that
 *     width, moves up that many rows, erases to end of screen, prints the
 *     new frame
 *
 * `DROGON605` markers make superseded frames trivially countable in the
 * buffer: a correct terminal shows exactly one.
 */
export const TERMINAL_RESIZE_FIXTURE = [
  `printf 'transcript uno: es el comportamiento esperado del pipeline.\\n';`,
  `printf 'transcript dos: vale la pena separarlo en su propio MR.\\n';`,
  "prev=0;",
  "n=0;",
  "w=0;",
  "while [ $n -lt 9999 ]; do",
  // Re-read the kernel's idea of the width every frame: this is the SIGWINCH
  // the agent acts on, and the reason the arithmetic below is correct on a
  // terminal that matches the pty and wrong on one that does not.
  "  c=`stty size 2>/dev/null | cut -d' ' -f2`;",
  "  [ -n \"$c\" ] || c=80;",
  // Ink redraws from scratch when the size changes instead of erasing with
  // arithmetic computed for the old grid: a frame that read the width
  // before the resize and prints after it erases the wrong rows on ANY
  // terminal (the agent's own math is stale, not the pane), so without
  // this the probe would fail correct terminals whenever a resize lands
  // inside a frame. Clearing and repainting on change keeps the signal on
  // the terminal's own resize handling. Pure POSIX sh: no signal traps.
  "  if [ \"$c\" != \"$w\" ]; then",
  "    printf '\\033[2J\\033[H';",
  "    w=$c;",
  "    prev=0;",
  "  fi;",
  "  if [ $prev -gt 0 ]; then",
  "    r=$(( ($prev + $c - 1) / $c ));",
  "    [ $r -lt 1 ] && r=1;",
  `    printf '\\033[%dA\\r\\033[J' $r;`,
  "  fi;",
  `  b=\`printf 'DROGON605-FRAME-%03d' $n; i=0; while [ $i -lt ${FRAME_PAD} ]; do printf '.'; i=$((i+1)); done\`;`,
  "  printf '%s\\n' \"$b\";",
  "  prev=`printf '%s' \"$b\" | wc -c | tr -d ' '`;",
  "  n=$((n+1));",
  // No sleep: a frame has to be in flight when the resize lands, or the
  // gesture slips between two frames and the probe proves nothing. The
  // subshells above throttle this to a realistic TUI frame rate on their
  // own (four forks per frame).
  "done",
].join(" ");

/**
 * Frames still on screen that the agent already replaced. A correct terminal
 * shows exactly one frame, so anything else here is the reported bug.
 */
export function strandedFrames(frameIds) {
  if (!Array.isArray(frameIds) || frameIds.length === 0) return [];
  const live = Math.max(...frameIds);
  return frameIds.filter((id) => id !== live);
}

/** Every DROGON605 frame id currently in the terminal buffer. */
function framesInBuffer({ id }) {
  const terminal = window.__drogonTerminals?.get(id);
  if (!terminal) return null;
  const buffer = terminal.buffer.active;
  const found = [];
  for (let row = 0; row < buffer.length; row += 1) {
    const text = buffer.getLine(row)?.translateToString(true) ?? "";
    const match = text.match(/DROGON605-FRAME-(\d+)/);
    if (match) found.push(Number(match[1]));
  }
  return found;
}
/**
 * Frame ids on the VISIBLE screen only. Scrollback is history: old frames
 * there are correct (a user scrolling up expects them), while the reported
 * bug is stale rows sitting under the live input box IN VIEW. Gating on
 * the whole buffer conflates the two, so the verdict reads the viewport.
 */
function framesInViewport({ id }) {
  const terminal = window.__drogonTerminals?.get(id);
  if (!terminal) return null;
  const buffer = terminal.buffer.active;
  const start = Math.max(
    0,
    typeof buffer.viewportY === "number"
      ? buffer.viewportY
      : buffer.length - terminal.rows,
  );
  const end = Math.min(buffer.length, start + terminal.rows);
  const found = [];
  for (let row = start; row < end; row += 1) {
    const text = buffer.getLine(row)?.translateToString(true) ?? "";
    const match = text.match(/DROGON605-FRAME-(\d+)/);
    if (match) found.push(Number(match[1]));
  }
  return { ids: found, start, end, rows: terminal.rows, length: buffer.length };
}

/** The pane's grid and the grid the daemon says the pty has. */
async function grids({ id, workspaceId }) {
  const terminal = window.__drogonTerminals?.get(id);
  const reply = await window.drogon.sessions(workspaceId);
  const current = reply.ok && reply.result.sessions.find((s) => s.id === id);
  if (!terminal || !current) return null;
  return {
    pane: { cols: terminal.cols, rows: terminal.rows },
    pty: { cols: current.cols, rows: current.rows },
    gridCursor: current.gridCursor ?? null,
  };
}

/**
 * Drives the resize gesture against a live session and returns the acceptance
 * checks. `session` must be the plain shell session `accept-desktop` already
 * opened; the fixture runs inside it and is stopped before returning.
 */
export async function probeTerminalResizeGhost({ page, session, output }) {
  const checks = [];
  const evidence = { widths: [], frames: null, grids: null };
  const restoreViewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  try {
    // The previous probe can leave the pane transiently behind the pty
    // (its closing resize settles asynchronously). The fixture's first
    // frame must be drawn on a converged grid: a frame wrapped at stale
    // dimensions strands its first repaint through no fault of the resize
    // handshake this probe exercises, and scrollback never lets that
    // startup remnant go. Settle before drawing, not only after.
    await page.waitForFunction(
      async ({ id, workspaceId }) => {
        const terminal = window.__drogonTerminals?.get(id);
        const reply = await window.drogon.sessions(workspaceId);
        const current = reply.ok && reply.result.sessions.find((s) => s.id === id);
        return !!terminal && !!current && terminal.cols === current.cols && terminal.rows === current.rows;
      },
      { id: session.id, workspaceId: session.workspaceId },
      { timeout: 20_000 },
    );
    // Through the pty write bridge, not 600 keystrokes: the fixture is
    // setup, and the input path has its own probe.
    const started = await page.evaluate(
      ({ sessionId, incarnation, text }) =>
        window.drogon.write({ sessionId, incarnation, text }),
      { sessionId: session.id, incarnation: session.incarnation, text: `${TERMINAL_RESIZE_FIXTURE}\n` },
    );
    assert.ok(started.ok, `fixture write rejected: ${JSON.stringify(started)}`);
    // The loop must be drawing before the gesture starts, or the probe would
    // resize an idle pane and prove nothing.
    await page.waitForFunction(
      (id) => {
        const buffer = window.__drogonTerminals?.get(id)?.buffer.active;
        if (!buffer) return false;
        for (let row = 0; row < buffer.length; row += 1) {
          if ((buffer.getLine(row)?.translateToString(true) ?? "").includes("DROGON605-FRAME-")) return true;
        }
        return false;
      },
      session.id,
      { timeout: 20_000 },
    );
    checks.push("resize-ghost-fixture-drawing");

    for (const width of VIEWPORT_WIDTHS) {
      const framesBefore = await page.evaluate(framesInBuffer, { id: session.id });
      await page.setViewportSize({ width, height: 600 });
      // Sample while the gesture is settling, not only after: a pane that
      // re-wraps ahead of the pty disagrees with it only for as long as the
      // resize is in flight, and that window is the whole bug.
      const samples = [];
      for (let tick = 0; tick < FRAMES_PER_WIDTH; tick += 1) {
        await delay(60);
        samples.push(
          await page.evaluate(grids, { id: session.id, workspaceId: session.workspaceId }),
        );
      }
      const framesAfter = await page.evaluate(framesInBuffer, { id: session.id });
      evidence.widths.push({
        width,
        // Frames the terminal was showing before and after this step: a step
        // that strands one is the step that broke.
        strandedBefore: strandedFrames(framesBefore),
        strandedAfter: strandedFrames(framesAfter),
        disagreed: samples.filter(
          (s) => s && (s.pane.cols !== s.pty.cols || s.pane.rows !== s.pty.rows),
        ).length,
        samples,
      });
    }

    // Let the pty and the pane converge, then stop the loop and read what is
    // actually on screen.
    await page.waitForFunction(
      async ({ id, workspaceId }) => {
        const terminal = window.__drogonTerminals?.get(id);
        const reply = await window.drogon.sessions(workspaceId);
        const current = reply.ok && reply.result.sessions.find((s) => s.id === id);
        return !!terminal && !!current && terminal.cols === current.cols && terminal.rows === current.rows;
      },
      { id: session.id, workspaceId: session.workspaceId },
      { timeout: 20_000 },
    );
    checks.push("resize-ghost-pane-matches-pty");

    await page.evaluate(
      ({ sessionId, incarnation }) =>
        window.drogon.write({ sessionId, incarnation, text: "\u0003" }),
      { sessionId: session.id, incarnation: session.incarnation },
    );
    await delay(500);

    const frames = await page.evaluate(framesInBuffer, { id: session.id });
    evidence.frames = frames;
    evidence.grids = await page.evaluate(grids, {
      id: session.id,
      workspaceId: session.workspaceId,
    });
    // Written before the assertions: a failure here is a rendering fault
    // worth reading, and an evidence file that only exists on success is
    // evidence of nothing.
    if (output) {
      await writeFile(
        path.join(output, "terminal-resize-ghost.json"),
        JSON.stringify(evidence, null, 2),
      );
      await page.screenshot({
        path: path.join(output, "terminal-resize-ghost.png"),
        animations: "disabled",
      });
    }
    assert.ok(evidence.widths.length > 0, "the gesture must have taken at least one step");
    // Per-step samples are evidence, not the verdict: a remnant caught
    // mid-gesture can be a sub-second transient the next repaint erases
    // (invisible under a live TUI), while the reported bug is frames that
    // SURVIVE once the agent goes idle and sit under its static input box
    // indefinitely. The fixture repaints every row it touches, so any
    // remnant inside the repaint zone heals on its own; what is still on
    // screen after the loop is stopped and the pane has settled is real
    // damage. (Mid-gesture scrollback strands cannot occur here: the
    // gesture holds the height constant, so rows never reflow into
    // scrollback; the startup transient is excluded by the settle wait
    // above.)
    evidence.strandedPerStep = evidence.widths.map((step) => ({
      width: step.width,
      stranded: step.strandedAfter,
    }));
    // The verdict reads the viewport, not the whole buffer: with the
    // clear-on-width-change fixture every resize is followed by stable
    // full repaints, so on a correct terminal the visible screen
    // deterministically converges to exactly the live frame. Whatever is
    // still visible beside it once the loop is stopped is a stale row
    // sitting under the prompt — the reported bug — while old ids above
    // the viewport are scrollback history, recorded above for diagnosis.
    const idleViewport = await page.evaluate(framesInViewport, { id: session.id });
    evidence.idleViewport = idleViewport;
    const idleStranded = strandedFrames(idleViewport?.ids ?? null);
    // A null viewport read means the terminal is gone: fail closed, never
    // mistake a missing pane for a clean one.
    assert.ok(idleViewport, "the terminal must still exist to read the idle viewport");
    assert.deepEqual(
      idleStranded,
      [],
      `stranded frames visible after the loop stopped and the pane settled: ${JSON.stringify(idleStranded)} (viewport ${JSON.stringify(idleViewport)} per-step ${JSON.stringify(evidence.strandedPerStep)} grids ${JSON.stringify(evidence.grids)})`,
    );
    checks.push("resize-ghost-no-stranded-frames");

    // The fix rests on the daemon reporting where each grid took effect; an
    // absent cursor would silently degrade the pane to the old behaviour.
    assert.equal(
      typeof evidence.grids.gridCursor,
      "number",
      "the daemon must report gridCursor so the pane can cut the stream at it",
    );
    checks.push("resize-ghost-grid-cursor-reported");
    return checks;
  } finally {
    // The fixture is a loop inside the session under test: leaving it running
    // would poison every later probe on the same pane.
    await page
      .evaluate(
        ({ sessionId, incarnation }) =>
          window.drogon.write({ sessionId, incarnation, text: "\u0003" }),
        { sessionId: session.id, incarnation: session.incarnation },
      )
      .catch(() => {});
    await page.setViewportSize(restoreViewport).catch(() => {});
  }
}
