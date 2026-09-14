import assert from "node:assert/strict";

export function markAcceptanceFailed(report) {
  report.failureLatched = true;
  report.status = "FAILED";
}

export function markAcceptancePassed(report) {
  if (report.failureLatched) throw new Error("Acceptance cannot pass after a recorded failure");
  // A skipped check is never an executed check: an empty run, or a run
  // where every journey skipped, must stay FAILED so a broken release can
  // never ride an all-skipped receipt through the release gate.
  const executed = report.checks?.length ?? 0;
  if (executed === 0)
    throw new Error(
      "Acceptance cannot pass with zero executed checks (skipped-only runs stay FAILED)",
    );
  report.status = "PASSED";
}

// Records an environment-gated journey that did not run. Skips live in
// their own array so they can never be mistaken for passes: only entries
// in `report.checks` count as executed. Both fields are required so a
// skip always says what did not run and why.
export function recordAcceptanceSkip(report, name, reason) {
  assert.ok(typeof name === "string" && name.length > 0, "A skip needs a check name");
  assert.ok(typeof reason === "string" && reason.length > 0, "A skip needs a reason");
  report.skipped ??= [];
  report.skipped.push({ name, reason });
}
