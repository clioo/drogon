// Unit tests for the screenshot-budget source guard. No Electron, no
// browser, no child process: every case runs the guard's pure checks
// against the real sources or small broken variants of them.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BUDGET_FILES,
  checkScreenshotBudget,
  parseArgs,
  runJourney,
  SCREENSHOT_BUDGET_MS,
} from "./check-screenshot-budget.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

test("real journey sources carry the cold-runner budget on every shot", async () => {
  const verdict = await runJourney({ root: ROOT });
  assert.equal(verdict.status, "PASSED");
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.checks.length, BUDGET_FILES.length);
});

test("a budget-less screenshot fails the check", () => {
  const broken = `await page.screenshot({ path: "shot.png", animations: "disabled" });`;
  const result = checkScreenshotBudget(broken, "synthetic.mjs");
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
});

test("a default 15s budget still fails the check", () => {
  const broken = `await page.screenshot({ path: "shot.png", timeout: 15000 });`;
  const result = checkScreenshotBudget(broken, "synthetic.mjs");
  assert.equal(result.ok, false);
});

test("the honest budget passes, including across lines", () => {
  const fixed = [
    "await page.screenshot({",
    '  path: "shot.png",',
    "  animations: \"disabled\",",
    `  timeout: ${SCREENSHOT_BUDGET_MS},`,
    "});",
  ].join("\n");
  const result = checkScreenshotBudget(fixed, "synthetic.mjs");
  assert.equal(result.ok, true);
});

test("locator screenshots are held to the same budget", () => {
  const broken = `await panel.screenshot({ path: "panel.png" });`;
  assert.equal(checkScreenshotBudget(broken, "synthetic.mjs").ok, false);
  const fixed = `await panel.screenshot({ path: "panel.png", timeout: ${SCREENSHOT_BUDGET_MS} });`;
  assert.equal(checkScreenshotBudget(fixed, "synthetic.mjs").ok, true);
});

test("catch-guarded failure evidence stays exempt", () => {
  const evidence = `await page.screenshot({ path: "failure.png" }).catch(() => {});`;
  assert.equal(checkScreenshotBudget(evidence, "synthetic.mjs").ok, true);
});

test("removing a real budget fails the check", async () => {
  const rel = BUDGET_FILES[0];
  const real = await readFile(path.join(ROOT, rel), "utf8");
  const broken = real.replace("timeout: 120_000", "timeout: 15000");
  assert.notEqual(broken, real);
  assert.equal(checkScreenshotBudget(broken, rel).ok, false);
});

test("a broken file fails runJourney from disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "drogon-shot-budget-"));
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  for (const [index, rel] of BUDGET_FILES.entries()) {
    let source = await readFile(path.join(ROOT, rel), "utf8");
    if (index === 0) {
      source = source.replace("timeout: 120_000", "timeout: 15000");
      assert.notEqual(source, await readFile(path.join(ROOT, rel), "utf8"));
    }
    await writeFile(path.join(dir, rel), source);
  }
  const verdict = await runJourney({ root: dir });
  assert.equal(verdict.status, "FAILED");
  assert.ok(verdict.problems.some((problem) => problem.startsWith(BUDGET_FILES[0])));
});

test("parseArgs defaults to the repo root", () => {
  assert.equal(parseArgs([]).root, ROOT);
});
