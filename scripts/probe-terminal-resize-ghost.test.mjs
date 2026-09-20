// Unit cover for the #605 acceptance probe's pure parts: the shell fixture it
// runs as a stand-in agent TUI, and the projection that decides what counts as
// a stranded frame.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
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
