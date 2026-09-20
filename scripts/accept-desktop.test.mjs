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

test("the workspace under test is the composer's added row, never workspaces[0]", () => {
  // Issue #579: the folder composer creates an additional named workspace,
  // so workspaces[0] is the older implicit row with an honestly empty
  // session list. The journey snapshots ids first and takes the set
  // difference; reverting to workspaces[0] must fail this test.
  assert.ok(
    source.includes("workspaceIdsBefore"),
    "the composer run must snapshot workspace ids first",
  );
  assert.ok(
    source.includes("the composer must add exactly one workspace"),
    "exactly one added workspace must be required",
  );
  assert.equal(
    (source.match(/return response\.result\.workspaces\[0\];/g) ?? []).length,
    0,
    "no session lookup may address workspaces[0]",
  );
});

test("the session navigation drives the composer's workspace by name", () => {
  assert.ok(
    source.includes("workspaceName: registered.name"),
    "navigation must address the composer's card, not the implicit one",
  );
});

test("the orchestrator status query addresses the tab's own workspace", () => {
  // The run is filed under the Work Graph tab's workspace id: the tab
  // opens in the implicit workspace (selected first), and the status
  // query must use that same id — never the composer's added workspace,
  // which shares the folder path but owns no run.
  assert.ok(
    source.includes("workspaceId: implicitWorkspaceId"),
    "orchestrator status must query the implicit workspace",
  );
});

test("the restart probes select the composer's workspace first", () => {
  // The probes create terminals in the SELECTED workspace but assert on
  // registered.id; whichever card an earlier probe left selected would
  // otherwise receive the post-restart terminal.
  assert.ok(
    source.includes("Select ${registered.name}"),
    "the composer's card must be selected before the restart probes",
  );
});
