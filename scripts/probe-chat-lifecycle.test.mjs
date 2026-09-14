import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_LIFECYCLE_PI_SKIP,
  chatLifecyclePiSkip,
} from "./probe-chat-lifecycle.mjs";
import { recordAcceptanceSkip } from "./acceptance-report-state.mjs";

// rc.4 clean-runner lane: the chat lifecycle creates its sessions through
// the New-session dialog's Pi radio, which never renders without a genuine
// `pi` binary. A host without one skips the journey by name with a reason
// instead of timing out on the missing radio.
describe("chatLifecyclePiSkip", () => {
  it("runs the journey when pi is available", () => {
    assert.equal(chatLifecyclePiSkip({ piAvailable: true }), null);
  });

  it("names the skipped journey with a reason when pi is missing", () => {
    const previous = process.env.DROGON_SKIP_MODEL_JOURNEYS;
    delete process.env.DROGON_SKIP_MODEL_JOURNEYS;
    let skip;
    try {
      skip = chatLifecyclePiSkip({ piAvailable: false });
    } finally {
      if (previous === undefined) delete process.env.DROGON_SKIP_MODEL_JOURNEYS;
      else process.env.DROGON_SKIP_MODEL_JOURNEYS = previous;
    }
    assert.equal(skip.name, CHAT_LIFECYCLE_PI_SKIP);
    assert.ok(skip.name.length > 0);
    assert.ok(skip.reason.length > 0);
    assert.match(skip.reason, /pi/);
    // The entry satisfies the report contract: recorded as a skip, never
    // mistaken for an executed check.
    const report = {
      status: "FAILED",
      checks: ["packaged-app-starts-bundled-runtime-with-minimal-path-and-reports-revision"],
      skipped: [],
    };
    recordAcceptanceSkip(report, skip.name, skip.reason);
    assert.deepEqual(report.skipped, [skip]);
    assert.equal(report.checks.length, 1);
  });
});
