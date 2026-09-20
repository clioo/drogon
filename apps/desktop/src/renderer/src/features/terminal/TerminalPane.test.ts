// #605 invariant, held at the source level because jsdom cannot observe it:
// xterm reports zero-sized cells there, so every fit path is a no-op and a
// rendered test cannot tell `fit.fit()` from a measurement that is only sent
// to the pty. The rule itself is simple and worth a guard — nothing in the
// pane may apply a measured grid to xterm directly.
//
// The behaviour this protects is covered against a real buffer in
// terminal-pane-grid.test.tsx and terminal-resize-ghost-rows.test.ts.
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const paneSource = fs.readFileSync(
  new URL("./TerminalPane.tsx", import.meta.url),
  "utf8",
);

describe("TerminalPane grid ownership (#605)", () => {
  it("never applies a measurement to xterm itself", () => {
    // `fit.fit()` resizes xterm the instant the pane measures, ahead of the
    // pty's SIGWINCH. An agent's next frame is then wrapped at a width it was
    // never told about, its cursor-relative erase lands short, and the frame
    // it meant to replace is stranded on screen for good.
    expect(paneSource).not.toMatch(/\bfit\s*\.\s*fit\s*\(/);
    expect(paneSource).toMatch(/fit\.proposeDimensions\(\)/);
  });

  it("keeps a single writer for the grid", () => {
    // Every change has to go through the one helper that applies it at the
    // pty's cut; a second `terminal.resize` call site is a second way for the
    // emulator to get ahead of the pty.
    expect(paneSource.match(/terminal\.resize\(/g) ?? []).toHaveLength(1);
    expect(paneSource).toMatch(/const applyTerminalGrid = /);
  });

  it("splits each read page at every grid cut the daemon reports", () => {
    // Plural: a page can span more than one resize, and applying only the
    // newest strands the frame composed at the middle grid (finding F1).
    expect(paneSource).toMatch(/planGridCutWrites\(/);
    expect(paneSource).toMatch(/gridChanges: value\.gridChanges/);
    // Queued on the write chain, not called loose: the pane arms its next
    // read before the previous write settles.
    expect(paneSource).toMatch(/orderedWrite\.run\(\(\) => applyTerminalGrid\(/);
  });
});
