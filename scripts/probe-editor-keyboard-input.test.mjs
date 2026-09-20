import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { assertConflictSnapshot } from "./probe-editor-keyboard-input.mjs";

const good = () => ({
  banner: true,
  dirty: true,
  model: "typed-by-keyboard journey base\n",
  disk: "external overwrite\n",
  draft: "typed-by-keyboard journey base\n",
});

test("accepts a held conflict: mark stands, draft kept, disk external", () => {
  assert.doesNotThrow(() => assertConflictSnapshot(good()));
});

test("rejects a clobbered model, a silent save, and a missing mark", () => {
  assert.throws(
    () => assertConflictSnapshot({ ...good(), model: "external overwrite\n" }),
    /live model must keep the typed draft/,
  );
  assert.throws(
    () =>
      assertConflictSnapshot({
        ...good(),
        disk: "typed-by-keyboard journey base\n",
      }),
    /Disk must keep the external content/,
  );
  assert.throws(
    () => assertConflictSnapshot({ ...good(), banner: false }),
    /mark must stand/,
  );
  assert.throws(
    () => assertConflictSnapshot({ ...good(), dirty: false }),
    /must stay dirty/,
  );
});

test("the conflict screenshot carries the cold-runner budget", async () => {
  // Same pin as accept-desktop.test.mjs: reverting the timeout must fail.
  const { checkFileBudget } = await import("./check-screenshot-budget.mjs");
  const root = path.join(import.meta.dirname, "..");
  const result = await checkFileBudget(root, "scripts/probe-editor-keyboard-input.mjs");
  assert.deepEqual(result.problems, []);
});
