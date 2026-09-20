// Unit tests for the background-window source guard. No Electron, no
// browser, no child process: every case runs the guard's pure checks
// against the real sources or small broken variants of them.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  checkCreateWindow,
  checkNoBareActivation,
  checkRevealGuard,
  checkSecondInstance,
  MAIN_INDEX_REL,
  parseArgs,
  runJourney,
  WINDOW_STATE_REL,
} from "./check-background-window-guard.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const realMain = await readFile(path.join(ROOT, MAIN_INDEX_REL), "utf8");
const realState = await readFile(path.join(ROOT, WINDOW_STATE_REL), "utf8");

test("real product sources pass every check", async () => {
  const verdict = await runJourney({ root: ROOT });
  assert.equal(verdict.status, "PASSED");
  assert.deepEqual(verdict.problems, []);
  assert.ok(verdict.checks.length === 4);
});

test("a removed background guard fails the check", () => {
  const broken = realState.replace("if (backgroundWindow) return;", "if (false) return;");
  assert.notEqual(broken, realState);
  const result = checkRevealGuard(broken);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("early-return guard")));
});

test("activation before the guard fails the check", () => {
  const broken = realState.replace(
    "if (backgroundWindow) return;",
    "window.show();\n  if (backgroundWindow) return;",
  );
  const result = checkRevealGuard(broken);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("before the background guard")));
});

test("a stray show outside the reveal helper fails the check", () => {
  const broken = `${realMain}\n// regression probe\nwindow.show();\n`;
  const result = checkNoBareActivation(broken, realState);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("reveal only through revealRestoredWindow")));
});

test("a forbidden activation API fails the check", () => {
  const broken = `${realMain}\nwindow.bringToFront();\n`;
  const result = checkNoBareActivation(broken, realState);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes("bringToFront")));
});

test("an unguarded second-instance focus fails the check", () => {
  const broken = realMain.replace("if (window && !backgroundWindow) {", "if (window) {");
  assert.notEqual(broken, realMain);
  const result = checkSecondInstance(broken);
  assert.equal(result.ok, false);
});

test("a visible-by-default window fails the check", () => {
  const broken = realMain.replace("show: false,", "show: true,");
  assert.notEqual(broken, realMain);
  const result = checkCreateWindow(broken);
  assert.equal(result.ok, false);
});

test("unreadable sources fail closed, never pass", async () => {
  const verdict = await runJourney({
    root: ROOT,
    read: async () => {
      throw new Error("denied");
    },
  });
  assert.equal(verdict.status, "FAILED");
  assert.ok(verdict.problems.length > 0);
});

test("unknown flags are rejected", () => {
  assert.throws(() => parseArgs(["--bundle", "x"]), /Unknown argument/);
});
