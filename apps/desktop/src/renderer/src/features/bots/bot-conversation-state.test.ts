import { describe, expect, it } from "vitest";
import {
  deliveryCanRetry,
  deliveryCanSend,
  deliveryNeedsReconciliation,
  deliveryStatusLabel,
  describeNativeLiveness,
  formatContextLabel,
  formatRuntimeLabel,
  isConversationIdFor,
  isFifoAppend,
  isSameConversation,
  parseConversationId,
  validateConversationTarget,
} from "./bot-conversation-state";

describe("bot-conversation-state", () => {
  it("parses native-minted ids and separates hosts", () => {
    // Fixture ids below were minted by native `conversation_id` (the
    // renderer never mints); parsing must recover the exact triple.
    const scope = parseConversationId("v1:bot-1:proj-a:host-1");
    expect(scope).toEqual({
      botId: "bot-1",
      projectId: "proj-a",
      hostId: "host-1",
    });
    expect(
      isConversationIdFor("v1:bot-1:proj-a:host-1", {
        botId: "bot-1",
        projectId: "proj-a",
        hostId: "host-1",
      }),
    ).toBe(true);
    // Same Bot/project on another host is a different conversation.
    expect(
      isConversationIdFor("v1:bot-1:proj-a:host-2", {
        botId: "bot-1",
        projectId: "proj-a",
        hostId: "host-1",
      }),
    ).toBe(false);
    // Delimiter collisions stay distinct and round-trip.
    expect(parseConversationId("v1:a%3Ab:c:h")).toEqual({
      botId: "a:b",
      projectId: "c",
      hostId: "h",
    });
    expect(parseConversationId("v1:a:b%3Ac:h")).toEqual({
      botId: "a",
      projectId: "b:c",
      hostId: "h",
    });
  });

  it("refuses ids it did not mint", () => {
    for (const bad of [
      "bot-1:proj-a",
      "v1:bot-1:proj-a",
      "v2:bot-1:proj-a:host-1",
      "v1:bot-1:proj-a:host-1:extra",
      "v1:%:proj-a:host-1",
      "v1::proj-a:host-1",
      "",
    ]) {
      expect(() => parseConversationId(bad)).toThrow();
      expect(
        isConversationIdFor(bad, {
          botId: "bot-1",
          projectId: "proj-a",
          hostId: "host-1",
        }),
      ).toBe(false);
    }
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
        memories: [{ id: "m-1", version: 2 }],
        contextHash: "a1b2c3d4e5",
      }),
    ).toBe("identity v3 · 1 memory · a1b2c3d4");
    expect(
      formatRuntimeLabel({
        effectiveHarness: "pi",
        effectiveProvider: "dgx-spark",
        effectiveModel: "qwen",
        effectiveSource: "actualDispatch",
      }),
    ).toBe("pi · dgx-spark · qwen");
    // A proposed runtime is labeled as proposed, never as dispatched truth.
    expect(
      formatRuntimeLabel({
        effectiveHarness: "codex",
        effectiveProvider: null,
        effectiveModel: null,
        effectiveSource: "proposedFromPolicy",
      }),
    ).toBe("codex (proposed)");
  });
});
