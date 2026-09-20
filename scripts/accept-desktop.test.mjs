// Structural cover for the desktop acceptance runner's probe wiring. The run
// itself needs a real app, a daemon and a display; what a unit test can hold
// is that a journey someone added is actually reached by the flow.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "accept-desktop.mjs"),
  "utf8",
);

test("the #605 terminal resize-ghost journey is imported and executed", () => {
  assert.match(
    source,
    /import\s*\{[^}]*probeTerminalResizeGhost[^}]*\}\s*from\s*["']\.\/probe-terminal-resize-ghost\.mjs["']/,
    "accept-desktop must import the #605 probe",
  );
  assert.match(
    source,
    /await\s+probeTerminalResizeGhost\(\{[^}]*\}\)/,
    "an imported probe that is never called proves nothing",
  );
});

test("its checks are pushed into the acceptance report", () => {
  assert.match(
    source,
    /report\.checks\.push\(\s*\.\.\.\s*await\s+probeTerminalResizeGhost\(/,
    "the probe's checks must reach the report, not be discarded",
  );
});

test("it runs against the same live shell session as the other terminal probes", () => {
  // `original` is the plain shell session the flow already opened; a probe
  // given anything else would resize a pane no agent is drawing into.
  assert.match(source, /probeTerminalResizeGhost\(\{ page, session: original, output \}\)/);
});
