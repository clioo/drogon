// MIT Copyright (c) 2026 Lovecast Inc. Adapted from
// src/renderer/src/assets/terminal-scrollbar-style.test.ts.
// Deviation (explicit): the source asserts main.css carries the canonical
// `.scrollbar-editor, .xterm .xterm-viewport` scrollbar rules. Those rules
// live outside this task's owned paths (only the terminal.css import line
// may touch main.css), so this test pins what the port itself guarantees —
// the verbatim scrollbar geometry in terminal.css plus the import wiring —
// and the main.css unification stays an explicit remainder for the App-shell
// owner.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const terminalCss = fs.readFileSync(
  new URL("./terminal.css", import.meta.url),
  "utf8",
);
const mainCss = fs.readFileSync(
  new URL("./main.css", import.meta.url),
  "utf8",
);

describe("terminal scrollbar styling", () => {
  it("keeps the scrollbar gutter stable with a transparent viewport", () => {
    // Stable gutter: `auto` lets scrollbars appear/disappear, feeding
    // resize/reflow jitter on Linux DOM scrollbars.
    expect(terminalCss).toMatch(
      /\.pane-manager-root \.xterm-viewport\s*{[^}]*overflow-y:\s*scroll;/s,
    );
    expect(terminalCss).toMatch(
      /\.xterm:not\(\.allow-transparency\) \.xterm-viewport\s*{[^}]*background-color:\s*transparent;/s,
    );
    expect(terminalCss).toMatch(
      /\.xterm \.xterm-scrollable-element > \.xterm-scrollbar > \.xterm-slider\s*{[^}]*border-radius:\s*4px;/s,
    );
    expect(terminalCss).not.toContain("--xterm-scrollbar-thumb");
  });

  it("is wired into the renderer through main.css", () => {
    expect(mainCss).toMatch(/@import\s*"\.\/terminal\.css"/);
  });
});
