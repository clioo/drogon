// MIT Copyright (c) 2026 Lovecast Inc.
import { describe, expect, it } from "vitest";
import { unreadDockBadgeCount } from "./unread-badge-count";

describe("unreadDockBadgeCount", () => {
  it("counts needs_input sessions", () => {
    expect(
      unreadDockBadgeCount(
        [
          { id: "a", agentState: "needs_input" },
          { id: "b", agentState: "working" },
          { id: "c", agentState: "needs_input" },
        ],
        null,
      ),
    ).toBe(2);
  });

  it("clears the viewed session without waiting for a state exit", () => {
    const sessions = [
      { id: "a", agentState: "needs_input" },
      { id: "b", agentState: "needs_input" },
    ];
    expect(unreadDockBadgeCount(sessions, "a")).toBe(1);
    expect(unreadDockBadgeCount(sessions, "b")).toBe(1);
  });

  it("reaches zero when every waiting session is viewed or exits", () => {
    expect(unreadDockBadgeCount([{ id: "a", agentState: "needs_input" }], "a")).toBe(0);
    expect(unreadDockBadgeCount([{ id: "a", agentState: "idle" }], null)).toBe(0);
    expect(unreadDockBadgeCount([], null)).toBe(0);
  });
});
