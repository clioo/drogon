// Pin test for the probe-rendered-mentu-tab viewport-restore hunk.
//
// What it pins: the probe's width loop ends at 760px and must hand a wide
// viewport back — later probes (Tasks, theme relaunch) assume a full-width
// canvas, and a stuck 760px clips their click targets (the Tasks
// "Start workspace from issue" button is unreachable at 760). Reverting
// that hunk must fail this test — that is what the discrimination gate
// checks.
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
    "probe-rendered-mentu-tab.mjs",
  ),
  "utf8",
);

describe("mentu tab viewport hygiene", () => {
  it("restores a wide viewport after the narrow-width loop", () => {
    const pushed = probe.indexOf(
      "mentu-tab-no-horizontal-overflow-1440-1100-900-760",
    );
    assert.ok(pushed !== -1, "the overflow check must exist");
    const restore = probe.indexOf("Leave the viewport wide again");
    assert.ok(restore !== -1, "the viewport restore must exist");
    assert.ok(
      restore > pushed,
      "the restore must come after the width loop finishes",
    );
    const resized = probe.indexOf(
      "setViewportSize({ width: 1440, height: 900 })",
      restore,
    );
    assert.ok(
      resized !== -1,
      "the restore must set the viewport back to 1440x900",
    );
  });
});
