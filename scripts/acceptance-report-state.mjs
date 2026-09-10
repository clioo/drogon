export function markAcceptanceFailed(report) {
  report.failureLatched = true;
  report.status = "FAILED";
}

export function markAcceptancePassed(report) {
  if (report.failureLatched) throw new Error("Acceptance cannot pass after a recorded failure");
  report.status = "PASSED";
}
