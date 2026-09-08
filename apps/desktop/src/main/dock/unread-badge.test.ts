// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/dock/unread-badge.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

const { setBadgeMock } = vi.hoisted(() => ({
  setBadgeMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    dock: {
      setBadge: setBadgeMock,
    },
  },
}));

describe("unread Dock badge", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    setBadgeMock.mockReset();
    vi.resetModules();
  });

  it("clears the native badge when unread count is zero", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    const { setUnreadDockBadgeCount } = await import("./unread-badge");

    setUnreadDockBadgeCount(5);
    expect(setBadgeMock).toHaveBeenLastCalledWith("5");

    setUnreadDockBadgeCount(0);
    expect(setBadgeMock).toHaveBeenLastCalledWith("");
  });

  it("caps unread counts", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    const { setUnreadDockBadgeCount } = await import("./unread-badge");

    setUnreadDockBadgeCount(104);
    expect(setBadgeMock).toHaveBeenLastCalledWith("99+");
  });

  it("ignores non-darwin platforms", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "linux",
    });
    const { setUnreadDockBadgeCount } = await import("./unread-badge");

    setUnreadDockBadgeCount(7);
    expect(setBadgeMock).not.toHaveBeenCalled();
  });

  it("coerces non-finite and fractional counts like the source", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    const { setUnreadDockBadgeCount } = await import("./unread-badge");

    setUnreadDockBadgeCount(Number.NaN);
    expect(setBadgeMock).toHaveBeenLastCalledWith("");
    setUnreadDockBadgeCount(2.8);
    expect(setBadgeMock).toHaveBeenLastCalledWith("2");
    setUnreadDockBadgeCount(-3);
    expect(setBadgeMock).toHaveBeenLastCalledWith("");
  });
});
