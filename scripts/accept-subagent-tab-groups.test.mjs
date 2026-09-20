// Issue #606: the acceptance run's own projections. The live script proves
// the feature; these prove the script is still reading the page for the
// things the feature is made of. A projection that silently stopped reading
// `data-lineage-*` would turn every assertion in the run into a comparison
// of `undefined` against `undefined` — a green run that checked nothing.
import assert from "node:assert/strict";
import test from "node:test";
import {
  projectStripTab,
  promptTabIdFromLabel,
  runSubagentTabGroupsAcceptance,
} from "./accept-subagent-tab-groups.mjs";

test("the strip projection carries every lineage marker the run asserts on", () => {
  assert.deepEqual(
    projectStripTab({
      id: "lead",
      parent: "true",
      child: null,
      collapsed: "true",
      count: "+2",
      active: "false",
    }),
    {
      id: "lead",
      parent: "true",
      child: null,
      collapsed: "true",
      count: "+2",
      active: "false",
    },
  );
});

test("a tab with no markers projects explicit nulls, never undefined", () => {
  // `undefined` would make `assert.equal(tab.collapsed, undefined)` pass for
  // a tab that simply stopped being read.
  const projected = projectStripTab({ id: "solo" });
  assert.deepEqual(projected, {
    id: "solo",
    parent: null,
    child: null,
    collapsed: null,
    count: null,
    active: null,
  });
  for (const value of Object.values(projected)) {
    assert.notEqual(value, undefined);
  }
});

test("the prompt target is the session behind the active panel's label", () => {
  assert.equal(
    promptTabIdFromLabel("session-tab-9d68471d-1f3d-46ce-8876-bc6c4535541a"),
    "9d68471d-1f3d-46ce-8876-bc6c4535541a",
  );
  // Only the leading prefix goes; an id that contains the words survives.
  assert.equal(
    promptTabIdFromLabel("session-tab-session-tab-x"),
    "session-tab-x",
  );
});

test("no label means no prompt target, not an empty-string one", () => {
  assert.equal(promptTabIdFromLabel(null), null);
  assert.equal(promptTabIdFromLabel(undefined), null);
  assert.equal(promptTabIdFromLabel(""), null);
});

test("importing the script does not start the acceptance run", () => {
  // The run launches a daemon, an Electron app and PTYs; it must stay behind
  // its main guard so a test import cannot strand any of them.
  assert.equal(typeof runSubagentTabGroupsAcceptance, "function");
});
