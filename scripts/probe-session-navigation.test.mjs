// Pin test for the probe-session-navigation workspace-name hunk.
//
// What it pins: the session under test may live in a composer-added named
// workspace (issue #579), not the implicit "folder" card — so the probe
// addresses its card by the workspace's own name (`Select <name>` /
// `<name> sessions`) instead of hardcoding "folder". Reverting that hunk
// must fail this test — that is what the discrimination gate checks.
//
// What it does NOT do: exercise the journey itself. The live run
// (`node scripts/accept-desktop.mjs --files`, background window, shell
// fixture) proves the behaviour.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const probe = readFileSync(
  path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "probe-session-navigation.mjs",
  ),
  "utf8",
);

describe("probe-session-navigation workspace naming", () => {
  it("takes the workspace name as a parameter defaulting to folder", () => {
    assert.ok(
      probe.includes('workspaceName = "folder"'),
      "the probe must accept the card name instead of assuming folder",
    );
  });

  it("derives both accessible names from that parameter", () => {
    assert.ok(
      probe.includes("`Select ${workspaceName}`"),
      "the card filter must use the parameterized select name",
    );
    assert.ok(
      probe.includes("`${workspaceName} sessions`"),
      "the sessions group must use the parameterized group name",
    );
  });

  it("uses the parameterized names at every card touchpoint", () => {
    const selectUses = probe.split("name: selectName").length - 1;
    assert.ok(
      selectUses >= 3,
      `card filter, card select and final select must share selectName (saw ${selectUses})`,
    );
    assert.ok(
      probe.includes("name: sessionsGroupName"),
      "the row path must use sessionsGroupName",
    );
  });

  it("keeps no hardcoded folder card reference", () => {
    assert.equal(
      (probe.match(/Select folder/g) ?? []).length,
      0,
      "no locator may hardcode the implicit card",
    );
    assert.equal(
      (probe.match(/folder sessions/g) ?? []).length,
      0,
      "no locator may hardcode the implicit sessions group",
    );
  });
});
