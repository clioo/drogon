// Unit cover for the #605 acceptance probe's pure parts: the shell fixture it
// runs as a stand-in agent TUI, and the projection that decides what counts as
// a stranded frame.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it, test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { strandedFrames, TERMINAL_RESIZE_FIXTURE } from "./probe-terminal-resize-ghost.mjs";

test("the fixture is valid POSIX sh", () => {
  const checked = spawnSync("/bin/sh", ["-n"], { input: TERMINAL_RESIZE_FIXTURE });
  assert.equal(checked.status, 0, `sh -n rejected the fixture: ${checked.stderr}`);
});

test("the fixture re-reads the terminal width on every frame", () => {
  // A fixture that captured the width once would repaint against a width the
  // pty no longer has, which is the agent bug this probe must NOT simulate:
  // the terminal, not the agent, is what the probe is testing.
  const loopBody = TERMINAL_RESIZE_FIXTURE.slice(TERMINAL_RESIZE_FIXTURE.indexOf("do"));
  assert.match(loopBody, /stty size/, "the width must be read inside the loop");
  assert.match(loopBody, /\\033\[%dA/, "each frame must move the cursor up over the previous one");
  assert.match(loopBody, /\\033\[J/, "each frame must erase to the end of the screen");
});

test("the fixture sizes its cursor-up from the previous frame at the current width", () => {
  // ceil(prev / cols): the rows the previous frame occupies *now*, after the
  // terminal reflowed it. Any other arithmetic would strand rows on a correct
  // terminal too, and the probe would assert nothing.
  assert.match(TERMINAL_RESIZE_FIXTURE, /r=\$\(\(\s*\(\$prev \+ \$c - 1\) \/ \$c\s*\)\)/);
});

test("the fixture marks every frame so superseded ones are countable", () => {
  assert.match(TERMINAL_RESIZE_FIXTURE, /DROGON605-FRAME-%03d/);
});

test("stranded frames are every frame but the newest", () => {
  assert.deepEqual(strandedFrames([0, 1, 2, 5]), [0, 1, 2]);
  assert.deepEqual(strandedFrames([7]), []);
  assert.deepEqual(strandedFrames([]), []);
  assert.deepEqual(strandedFrames(null), []);
  // Frame ids arrive in buffer order, which is not necessarily sorted.
  assert.deepEqual(strandedFrames([9, 3, 4]), [3, 4]);
});

// Lane 1 second-pass pins: the determinism hunks. Reverting any of them
// must fail these tests — that is what the discrimination gate checks.
// The live run (`node scripts/accept-desktop.mjs --files`, background
// window, shell fixture) proves the behaviour itself.
const ghostProbeSource = readFileSync(
  path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "probe-terminal-resize-ghost.mjs",
  ),
  "utf8",
);

describe("resize-ghost determinism", () => {
  it("documents the Ink-style redraw in the fixture contract", () => {
    assert.ok(
      ghostProbeSource.includes("repaints from the top"),
      "the fixture docstring must describe the width-change repaint",
    );
  });

  it("reads only the visible viewport for the verdict", () => {
    assert.ok(
      ghostProbeSource.includes("Scrollback is history"),
      "the viewport reader must document why scrollback is excluded",
    );
  });

  it("settles the pane to the pty grid before writing the fixture", () => {
    const settle = ghostProbeSource.indexOf("Settle before drawing, not only after");
    assert.ok(settle !== -1, "the pre-fixture settle must exist");
    const write = ghostProbeSource.indexOf("fixture write rejected");
    assert.ok(write !== -1, "the fixture write must exist");
    assert.ok(
      settle < write,
      "the settle must come before the fixture starts drawing",
    );
  });

  it("repaints from scratch when the kernel width changes", () => {
    assert.ok(
      TERMINAL_RESIZE_FIXTURE.includes("\\033[2J\\033[H"),
      "the fixture must clear and home on a width change",
    );
    assert.ok(
      TERMINAL_RESIZE_FIXTURE.includes("w=$c"),
      "the fixture must track the width it last painted at",
    );
  });

  it("judges the idle viewport, never whole-buffer history", () => {
    assert.ok(
      ghostProbeSource.includes("framesInViewport"),
      "the verdict must read the viewport",
    );
    assert.ok(
      ghostProbeSource.includes("stranded frames visible after the loop stopped"),
      "the assertion must target settled visible strands",
    );
    assert.ok(
      !ghostProbeSource.includes("resize steps that stranded a superseded frame"),
      "the per-step whole-buffer assertion must be gone",
    );
  });
});
