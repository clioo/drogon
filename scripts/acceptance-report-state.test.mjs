import assert from "node:assert/strict";
import { test } from "node:test";
import {
  markAcceptanceFailed,
  markAcceptancePassed,
  recordAcceptanceSkip,
} from "./acceptance-report-state.mjs";

test("successful checks can leave the initial fail-closed state", () => {
  const report = { status: "FAILED", checks: ["terminal-echo"] };
  markAcceptancePassed(report);
  assert.equal(report.status, "PASSED");
});

test("later successful checks cannot erase an earlier phase cleanup failure", () => {
  const report = { status: "FAILED", checks: ["terminal-echo"] };
  markAcceptanceFailed(report);
  assert.throws(() => markAcceptancePassed(report), /recorded failure/);
  assert.equal(report.status, "FAILED");
});

test("final teardown failure invalidates functional success", () => {
  const report = { status: "FAILED", checks: ["terminal-echo"] };
  markAcceptancePassed(report);
  markAcceptanceFailed(report);
  assert.equal(report.status, "FAILED");
});

test("a report with zero executed checks cannot pass", () => {
  const report = { status: "FAILED", checks: [] };
  assert.throws(() => markAcceptancePassed(report), /zero executed checks/);
  assert.equal(report.status, "FAILED");
});

test("a report with only skipped checks cannot pass", () => {
  const report = { status: "FAILED", checks: [], skipped: [] };
  recordAcceptanceSkip(report, "pi-agent-state", "no `pi` binary on this host");
  assert.equal(report.skipped.length, 1);
  assert.throws(() => markAcceptancePassed(report), /zero executed checks/);
  assert.equal(report.status, "FAILED");
});

test("executed checks plus visible skips can still pass", () => {
  const report = { status: "FAILED", checks: ["terminal-echo"], skipped: [] };
  recordAcceptanceSkip(report, "pi-agent-state", "no `pi` binary on this host");
  markAcceptancePassed(report);
  assert.equal(report.status, "PASSED");
});

test("a skip always names the journey and the reason", () => {
  const report = {};
  assert.throws(() => recordAcceptanceSkip(report, "", "reason"), /check name/);
  assert.throws(() => recordAcceptanceSkip(report, "journey", ""), /reason/);
  recordAcceptanceSkip(report, "journey", "reason");
  assert.deepEqual(report.skipped, [{ name: "journey", reason: "reason" }]);
});
