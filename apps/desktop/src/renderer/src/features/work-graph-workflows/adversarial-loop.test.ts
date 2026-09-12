// MIT Copyright (c) 2026 Lovecast Inc.
// The reducer is where the loop can lie, so it is tested exhaustively and
// in isolation from any I/O: passing on the first try, failing then
// passing, hitting the cap while still failing (the EXACT required
// message), loss of contact on a review and on a fix, a blocked review,
// a fix that itself fails to run, and refusing to review a base workflow
// that never cleanly succeeded.

import { describe, expect, it } from "vitest";
import {
  advanceLoop,
  buildFixPrompt,
  buildReviewPrompt,
  failMarkerPath,
  fixNodeId,
  isTerminalPhase,
  passMarkerPath,
  reviewNodeId,
  reviewVerifyCommand,
  runToken,
  startLedger,
  type LoopLedger,
} from "./adversarial-loop";
import type { WorkGraphStatus } from "../../../../shared/work-graph-contract";

const NOW = "2026-09-11T12:00:00.000Z";

function base(overrides: Partial<Parameters<typeof startLedger>[0]> = {}): LoopLedger {
  return startLedger({
    workflowId: "wf_1",
    baseRunId: "run-abc",
    baseNodeIds: ["n1", "n2"],
    maxCycles: 3,
    now: NOW,
    ...overrides,
  });
}

function observed(entries: Record<string, WorkGraphStatus>): Map<string, WorkGraphStatus> {
  return new Map(Object.entries(entries));
}

describe("runToken / node ids", () => {
  it("is deterministic, id-safe and short", () => {
    const token = runToken("run-abc-123");
    expect(runToken("run-abc-123")).toBe(token);
    expect(token).toMatch(/^[0-9a-f]{8}$/);
    const nodeId = reviewNodeId(token, 2);
    expect(nodeId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
    expect(nodeId.length).toBeLessThanOrEqual(64);
    expect(fixNodeId(token, 2)).not.toBe(nodeId);
  });

  it("different run ids produce different tokens (no accidental sharing of marker paths)", () => {
    expect(runToken("run-a")).not.toBe(runToken("run-b"));
  });
});

describe("prompts and verify command", () => {
  it("the review's verify command checks exactly the pass marker for that cycle", () => {
    const token = "deadbeef";
    expect(reviewVerifyCommand(token, 2)).toBe(`test -f ${passMarkerPath(token, 2)}`);
  });

  it("the review prompt is explicitly adversarial and names both markers", () => {
    const prompt = buildReviewPrompt({ token: "deadbeef", cycle: 1, maxCycles: 3 });
    expect(prompt).toMatch(/ADVERSARIAL/);
    expect(prompt).toMatch(/try to BREAK it/);
    expect(prompt).toContain(passMarkerPath("deadbeef", 1));
    expect(prompt).toContain(failMarkerPath("deadbeef", 1));
    expect(prompt).toContain("cycle 1 of at most 3");
  });

  it("the code-review prompt points at the exact prior fail marker, reviews independently, and verifies", () => {
    const prompt = buildFixPrompt({ token: "deadbeef", cycle: 2 });
    expect(prompt).toContain(failMarkerPath("deadbeef", 2));
    expect(prompt).toMatch(/CODE REVIEWER/);
    expect(prompt).toMatch(/Fix every real problem/);
    expect(prompt).toMatch(/VERIFY each fix/);
    // Genuinely a different brief from the adversarial-test role, not the
    // same instructions under a new label.
    expect(prompt).not.toMatch(/ADVERSARIAL/);
    expect(prompt).not.toMatch(/try to BREAK it/);
  });

  it("the two roles' briefs are never textually identical", () => {
    const testBrief = buildReviewPrompt({ token: "deadbeef", cycle: 1, maxCycles: 3 });
    const reviewBrief = buildFixPrompt({ token: "deadbeef", cycle: 1 });
    expect(testBrief).not.toBe(reviewBrief);
  });
});

describe("advanceLoop: awaiting the base workflow", () => {
  it("does nothing while base nodes are still idle or running", () => {
    const ledger = base();
    const { ledger: next, action } = advanceLoop(
      ledger,
      observed({ n1: "succeeded", n2: "running" }),
      NOW,
    );
    expect(next.phase).toBe("awaiting_base");
    expect(action).toEqual({ kind: "none" });
  });

  it("does nothing when a base node has not been read yet", () => {
    const ledger = base();
    const { ledger: next, action } = advanceLoop(ledger, observed({ n1: "succeeded" }), NOW);
    expect(next.phase).toBe("awaiting_base");
    expect(action).toEqual({ kind: "none" });
  });

  it("refuses to review a workflow whose base run did not fully succeed", () => {
    const ledger = base();
    const { ledger: next, action } = advanceLoop(
      ledger,
      observed({ n1: "succeeded", n2: "failed" }),
      NOW,
    );
    expect(next.phase).toBe("base_failed");
    expect(isTerminalPhase(next.phase)).toBe(true);
    expect(next.message).toContain("n2");
    expect(next.message).toContain("failed");
    expect(action).toEqual({ kind: "none" });
  });

  it("treats an unverifiable base node as a refusal to review, never a pass-through", () => {
    const ledger = base();
    const { ledger: next } = advanceLoop(
      ledger,
      observed({ n1: "succeeded", n2: "unverifiable" }),
      NOW,
    );
    expect(next.phase).toBe("base_failed");
    expect(next.message).toContain("unverifiable");
  });

  it("launches the first review once every base node has genuinely succeeded", () => {
    const ledger = base();
    const { ledger: next, action } = advanceLoop(
      ledger,
      observed({ n1: "succeeded", n2: "succeeded" }),
      NOW,
    );
    expect(next.phase).toBe("reviewing");
    expect(next.cycle).toBe(1);
    expect(next.message).toBe("Reviewing… cycle 1 of 3.");
    expect(action.kind).toBe("launch_review");
    if (action.kind === "launch_review") {
      expect(action.cycle).toBe(1);
      expect(action.nodeId).toBe(next.activeNodeId);
      expect(action.verifyCommand).toContain("cycle-1.pass");
    }
  });
});

describe("advanceLoop: the full pass-first-try path", () => {
  it("passes on cycle 1 and stops (no fix is ever launched)", () => {
    let ledger = base();
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    expect(ledger.phase).toBe("reviewing");
    const reviewId = ledger.activeNodeId as string;

    const { ledger: after, action } = advanceLoop(
      ledger,
      observed({ n1: "succeeded", n2: "succeeded", [reviewId]: "succeeded" }),
      "2026-09-11T12:05:00.000Z",
    );
    expect(after.phase).toBe("passed");
    expect(isTerminalPhase(after.phase)).toBe(true);
    expect(after.message).toBe("Adversarial review passed on cycle 1.");
    expect(action).toEqual({ kind: "none" });
    // A further advance on a terminal ledger is a genuine no-op.
    const { ledger: still, action: stillAction } = advanceLoop(after, observed({}), NOW);
    expect(still).toEqual(after);
    expect(stillAction).toEqual({ kind: "none" });
  });
});

describe("advanceLoop: fail then pass", () => {
  it("fails cycle 1, launches a fix, then passes cycle 2", () => {
    let ledger = base({ maxCycles: 3 });
    let action;
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    const review1 = ledger.activeNodeId as string;
    expect(review1).toContain("review-1");

    ({ ledger, action } = advanceLoop(ledger, observed({ [review1]: "failed" }), NOW));
    expect(ledger.phase).toBe("fixing");
    expect(action.kind).toBe("launch_fix");
    const fix1 = ledger.activeNodeId as string;
    expect(fix1).toContain("fix-1");
    if (action.kind === "launch_fix") expect(action.nodeId).toBe(fix1);

    ({ ledger, action } = advanceLoop(ledger, observed({ [fix1]: "succeeded" }), NOW));
    expect(ledger.phase).toBe("reviewing");
    expect(ledger.cycle).toBe(2);
    expect(action.kind).toBe("launch_review");
    const review2 = ledger.activeNodeId as string;
    expect(review2).toContain("review-2");
    if (action.kind === "launch_review") expect(action.verifyCommand).toContain("cycle-2.pass");

    ({ ledger, action } = advanceLoop(ledger, observed({ [review2]: "succeeded" }), NOW));
    expect(ledger.phase).toBe("passed");
    expect(ledger.message).toBe("Adversarial review passed on cycle 2.");
    expect(action).toEqual({ kind: "none" });
    expect(ledger.reviewNodeIds).toEqual([review1, review2]);
    expect(ledger.fixNodeIds).toEqual([fix1]);
  });
});

describe("advanceLoop: the cap, still failing", () => {
  it("stops after maxCycles with the exact required message, never a quiet success", () => {
    let ledger = base({ maxCycles: 2 });
    let action;
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    const review1 = ledger.activeNodeId as string;
    ({ ledger, action } = advanceLoop(ledger, observed({ [review1]: "failed" }), NOW));
    expect(action.kind).toBe("launch_fix");
    const fix1 = ledger.activeNodeId as string;
    ({ ledger, action } = advanceLoop(ledger, observed({ [fix1]: "succeeded" }), NOW));
    expect(action.kind).toBe("launch_review");
    const review2 = ledger.activeNodeId as string;
    expect(ledger.cycle).toBe(2);

    ({ ledger, action } = advanceLoop(ledger, observed({ [review2]: "failed" }), NOW));
    expect(ledger.phase).toBe("stopped_failing");
    expect(isTerminalPhase(ledger.phase)).toBe(true);
    expect(ledger.message).toBe("Stopped after 2 review cycles, still failing.");
    expect(action).toEqual({ kind: "none" });
    // No third review or fix was ever created.
    expect(ledger.reviewNodeIds).toHaveLength(2);
    expect(ledger.fixNodeIds).toHaveLength(1);
  });

  it("singular phrasing for a single cycle", () => {
    let ledger = base({ maxCycles: 1 });
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    const review1 = ledger.activeNodeId as string;
    ({ ledger } = advanceLoop(ledger, observed({ [review1]: "failed" }), NOW));
    expect(ledger.phase).toBe("stopped_failing");
    expect(ledger.message).toBe("Stopped after 1 review cycle, still failing.");
  });
});

describe("advanceLoop: loss of contact and blocking are their own outcomes", () => {
  it("a review that loses contact is unverifiable, never passed or failed", () => {
    let ledger = base();
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    const review1 = ledger.activeNodeId as string;
    const { ledger: after, action } = advanceLoop(
      ledger,
      observed({ [review1]: "unverifiable" }),
      NOW,
    );
    expect(after.phase).toBe("unverifiable");
    expect(after.message).toContain("unverifiable");
    expect(after.message).not.toMatch(/passed|failed/);
    expect(action).toEqual({ kind: "none" });
  });

  it("a blocked review stops the loop honestly instead of guessing", () => {
    let ledger = base();
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    const review1 = ledger.activeNodeId as string;
    const { ledger: after } = advanceLoop(ledger, observed({ [review1]: "blocked" }), NOW);
    expect(after.phase).toBe("blocked");
  });

  it("a fix that fails to run stops the loop as fix_failed, distinct from stopped_failing", () => {
    let ledger = base();
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    const review1 = ledger.activeNodeId as string;
    ({ ledger } = advanceLoop(ledger, observed({ [review1]: "failed" }), NOW));
    const fix1 = ledger.activeNodeId as string;
    const { ledger: after, action } = advanceLoop(ledger, observed({ [fix1]: "failed" }), NOW);
    expect(after.phase).toBe("fix_failed");
    expect(after.message).toContain("fix attempt for cycle 1 failed");
    expect(action).toEqual({ kind: "none" });
  });

  it("a fix that loses contact is unverifiable", () => {
    let ledger = base();
    ({ ledger } = advanceLoop(ledger, observed({ n1: "succeeded", n2: "succeeded" }), NOW));
    const review1 = ledger.activeNodeId as string;
    ({ ledger } = advanceLoop(ledger, observed({ [review1]: "failed" }), NOW));
    const fix1 = ledger.activeNodeId as string;
    const { ledger: after } = advanceLoop(ledger, observed({ [fix1]: "unverifiable" }), NOW);
    expect(after.phase).toBe("unverifiable");
  });
});
