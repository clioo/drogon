// What a send's results are allowed to say. A delivery the daemon could not
// make is the one case the counts alone cannot carry: the prompt may already
// be sitting in a composer waiting for a lone Return (issue #679), so the
// notice has to be an error and has to repeat what the daemon reported.

import { describe, expect, it } from "vitest";
import { deliveryHasFailures, deliveryNotice, deliverySummary } from "./work-format";

describe("delivery notices", () => {
  it("counts every action it was given", () => {
    expect(deliverySummary([{ action: "sent" }, { action: "sent" }, { action: "skipped" }])).toBe(
      "2 sent, 1 skipped",
    );
    expect(deliverySummary([])).toBe("");
  });

  it("reads reached sessions as success and unreached ones as failure", () => {
    expect(deliveryHasFailures([{ action: "sent" }, { action: "skipped" }])).toBe(false);
    expect(deliveryHasFailures([{ action: "sent" }, { action: "failed" }])).toBe(true);
    expect(deliveryHasFailures([{ action: "unverifiable" }])).toBe(true);
  });

  it("reports a delivery that reached every session", () => {
    expect(deliveryNotice("Review", [{ action: "sent" }])).toEqual({
      text: "Delivery to Review: 1 sent",
      kind: "success",
    });
  });

  it("says nothing was delivered rather than leaving the line bare", () => {
    expect(deliveryNotice("Review", [])).toEqual({
      text: "Delivery to Review: nothing",
      kind: "success",
    });
  });

  it("carries the half-delivered prompt's instructions into the error", () => {
    const notice = deliveryNotice("DRG-42", [
      {
        action: "failed",
        error:
          "pty write failed after the body was already delivered, so the message is in the " +
          "composer unsubmitted; send a lone Return rather than the whole message again: " +
          "Broken pipe (os error 32)",
      },
    ]);
    expect(notice.kind).toBe("error");
    expect(notice.text).toContain("send a lone Return");
    expect(notice.text).toContain("1 failed");
  });

  it("is an error even when some sessions were reached", () => {
    const notice = deliveryNotice("Review", [
      { action: "sent" },
      { action: "failed", error: "pty write failed: Broken pipe" },
    ]);
    expect(notice.kind).toBe("error");
    expect(notice.text).toBe("Delivery to Review: 1 sent, 1 failed — pty write failed: Broken pipe");
  });

  it("is an error for an uncertain delivery with nothing to quote", () => {
    expect(deliveryNotice("Review", [{ action: "unverifiable" }])).toEqual({
      text: "Delivery to Review: 1 unverifiable",
      kind: "error",
    });
  });
});
