import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkScreenshotBudget, SCREENSHOT_BUDGET_MS } from "./check-screenshot-budget.mjs";

const sourcePath = fileURLToPath(new URL("./accept-bot-graph-sidebar.mjs", import.meta.url));

test("bot graph sidebar screenshots keep the cold-runner budget and timing evidence", async () => {
  const source = await readFile(sourcePath, "utf8");
  const budget = checkScreenshotBudget(source, "scripts/accept-bot-graph-sidebar.mjs");
  assert.deepEqual(budget.problems, []);
  assert.match(source, /screenshotTimings:\s*\[\]/);
  assert.match(source, /timeout:\s*120_000/);
  assert.match(source, new RegExp(`COLD_SCREENSHOT_TIMEOUT_MS\\s*=\\s*${SCREENSHOT_BUDGET_MS.toLocaleString("en-US").replace(/,/g, "_")}`));
});
