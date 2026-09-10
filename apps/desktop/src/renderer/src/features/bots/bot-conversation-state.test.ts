import { describe, expect, it } from "vitest";
import {
  deliveryCanRetry,
  deliveryCanSend,
  deliveryNeedsReconciliation,
  deliveryStatusLabel,
  describeNativeLiveness,
  formatContextLabel,
  formatRuntimeLabel,
  isFifoAppend,
  isSameConversation,
  resolveConversationId,
  validateConversationTarget,
} from "./bot-conversation-state";

describe("bot-conversation-state", () => {
  it("resolves one id per bot/project and separates projects", () => {
    const a = resolveConversationId({
      botId: "bot-1",
      projectId: "proj-a",
      hostId: "host-1",
    });
    const again = resolveConversationId({
      botId: "bot-1",
      projectId: "proj-a",
      hostId: "host-1",
    });
    const other = resolveConversationId({
      botId: "bot-1",
      projectId: "proj-b",
      hostId: "host-1",
    });
    expect(again).toBe(a);
    expect(other).not.toBe(a);
  });

  it("rejects empty scope ids", () => {
    expect(() =>
      resolveConversationId({ botId: " ", projectId: "p", hostId: "h" }),
    ).toThrow();
    expect(() =>
      resolveConversationId({ botId: "b", projectId: "", hostId: "h" }),
    ).toThrow();
  });

  it("validates wrong-scope targets", () => {
    const conversation = { botId: "bot-1", projectId: "p1", hostId: "h1" };
    expect(
      validateConversationTarget(conversation, {
        botId: "bot-1",
        projectId: "p1",
        hostId: "h1",
      }),
    ).toBeNull();
    expect(
      validateConversationTarget(conversation, {
        botId: "bot-2",
        projectId: "p1",
        hostId: "h1",
      }),
    ).toMatch(/bot/);
    expect(
      validateConversationTarget(conversation, {
        botId: "bot-1",
        projectId: "p2",
        hostId: "h1",
      }),
    ).toMatch(/project/);
    expect(
      validateConversationTarget(conversation, {
        botId: "bot-1",
        projectId: "p1",
        hostId: "h2",
      }),
    ).toMatch(/host/);
  });

  it("compares conversation scopes", () => {
    expect(
      isSameConversation(
        { botId: "b", projectId: "p", hostId: "h" },
        { botId: "b", projectId: "p", hostId: "h" },
      ),
    ).toBe(true);
    expect(
      isSameConversation(
        { botId: "b", projectId: "p", hostId: "h" },
        { botId: "b", projectId: "q", hostId: "h" },
      ),
    ).toBe(false);
  });

  it("classifies native liveness honestly", () => {
    expect(
      describeNativeLiveness({ sessionId: null, observedVerdict: "live" }),
    ).toBeNull();
    expect(
      describeNativeLiveness({ sessionId: "s1", observedVerdict: "live" }),
    ).toBe("live");
    expect(
      describeNativeLiveness({ sessionId: "s1", observedVerdict: "exited" }),
    ).toBe("exited");
    expect(
      describeNativeLiveness({ sessionId: "s1", observedVerdict: null }),
    ).toBe("unverifiable");
    expect(
      describeNativeLiveness({ sessionId: "s1", observedVerdict: "bogus" }),
    ).toBe("unverifiable");
  });

  it("labels delivery states without overstating uncertain", () => {
    expect(deliveryStatusLabel("pending")).toBe("Pending");
    expect(deliveryStatusLabel("delivered")).toBe("Delivered");
    expect(deliveryStatusLabel("failed")).toBe("Failed");
    expect(deliveryStatusLabel("uncertain")).toMatch(/Uncertain/);
    expect(
      deliveryNeedsReconciliation({
        id: "d1",
        conversationId: "c1",
        runId: "r1",
        state: "uncertain",
        attempts: 1,
        updatedAt: 1,
      }),
    ).toBe(true);
    expect(
      deliveryNeedsReconciliation({
        id: "d1",
        conversationId: "c1",
        runId: "r1",
        state: "delivered",
        attempts: 1,
        updatedAt: 1,
      }),
    ).toBe(false);
    expect(
      deliveryCanRetry({
        id: "d1",
        conversationId: "c1",
        runId: "r1",
        state: "failed",
        attempts: 1,
        updatedAt: 1,
      }),
    ).toBe(true);
    expect(
      deliveryCanRetry({
        id: "d1",
        conversationId: "c1",
        runId: "r1",
        state: "uncertain",
        attempts: 1,
        updatedAt: 1,
      }),
    ).toBe(false);
    expect(
      deliveryCanSend({
        id: "d1",
        conversationId: "c1",
        runId: "r1",
        state: "pending",
        attempts: 0,
        updatedAt: 1,
      }),
    ).toBe(true);
  });

  it("checks FIFO appends", () => {
    expect(isFifoAppend(["a"], ["a", "b"], ["b"])).toBe(true);
    expect(isFifoAppend(["a"], ["b", "a"], ["b"])).toBe(false);
    expect(isFifoAppend(["a"], ["a"], ["b"])).toBe(false);
  });

  it("formats context and runtime labels", () => {
    expect(
      formatContextLabel({
        identityVersion: 3,
        contextVersion: 5,
        contextHash: "a1b2c3d4e5",
      }),
    ).toBe("identity v3 · context v5 · a1b2c3d4");
    expect(
      formatRuntimeLabel({
        effectiveHarness: "pi",
        effectiveProvider: "dgx-spark",
        effectiveModel: "qwen",
      }),
    ).toBe("pi · dgx-spark · qwen");
  });
});
