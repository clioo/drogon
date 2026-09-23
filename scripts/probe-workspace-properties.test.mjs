// Pin test for the probe-workspace-properties screenshot budget.
//
// What it pins: the linked-issues evidence screenshot must carry an
// explicit timeout of at least 120s — Playwright's 15s default times out
// on a cold xvfb/software-rendered ubuntu runner even after fonts load
// (CI proof on PR #633). Reverting that hunk must fail this test — that
// is what the discrimination gate checks.
//
// What it does NOT do: exercise the journey itself. The live run
// (`node scripts/accept-desktop.mjs --files`, background window, shell
// fixture) proves the behaviour.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { checkFileBudget } from "./check-screenshot-budget.mjs";

const ROOT = path.join(import.meta.dirname, "..");

test("the linked-issues screenshot carries the cold-runner budget", async () => {
  const result = await checkFileBudget(ROOT, "scripts/probe-workspace-properties.mjs");
  assert.deepEqual(result.problems, []);
});
