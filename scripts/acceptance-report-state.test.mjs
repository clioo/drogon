import assert from "node:assert/strict";
import { test } from "node:test";
import { markAcceptanceFailed, markAcceptancePassed } from "./acceptance-report-state.mjs";

test("successful checks can leave the initial fail-closed state", () => {
  const report = { status: "FAILED" };
  markAcceptancePassed(report);
  assert.equal(report.status, "PASSED");
});

test("later successful checks cannot erase an earlier phase cleanup failure", () => {
  const report = { status: "FAILED" };
  markAcceptanceFailed(report);
  assert.throws(() => markAcceptancePassed(report), /recorded failure/);
  assert.equal(report.status, "FAILED");
});

test("final teardown failure invalidates functional success", () => {
  const report = { status: "FAILED" };
  markAcceptancePassed(report);
  markAcceptanceFailed(report);
  assert.equal(report.status, "FAILED");
});
