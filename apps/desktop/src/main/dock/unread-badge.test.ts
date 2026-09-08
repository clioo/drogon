// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/dock/unread-badge.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

const { setBadgeMock, dockShowMock, setActivationPolicyMock, appFocusMock } =
  vi.hoisted(() => ({
    setBadgeMock: vi.fn(),
    dockShowMock: vi.fn(),
    setActivationPolicyMock: vi.fn(),
    appFocusMock: vi.fn(),
  }));

vi.mock("electron", () => ({
  app: {
    dock: {
      setBadge: setBadgeMock,
      show: dockShowMock,
    },
    setActivationPolicy: setActivationPolicyMock,
    focus: appFocusMock,
  },
}));

describe("unread Dock badge", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    setBadgeMock.mockReset();
    dockShowMock.mockReset();
    setActivationPolicyMock.mockReset();
    appFocusMock.mockReset();
    delete process.env.DROGON_BACKGROUND_WINDOW;
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

  it.each(["1", undefined] as const)(
    "only ever touches app.dock.setBadge, never the activation policy (background flag: %s)",
    async (flag) => {
      if (flag === undefined) delete process.env.DROGON_BACKGROUND_WINDOW;
      else process.env.DROGON_BACKGROUND_WINDOW = flag;
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: "darwin",
      });
      const { setUnreadDockBadgeCount } = await import("./unread-badge");

      setUnreadDockBadgeCount(3);
      setUnreadDockBadgeCount(0);

      expect(setBadgeMock.mock.calls).toEqual([["3"], [""]]);
      expect(dockShowMock).not.toHaveBeenCalled();
      expect(setActivationPolicyMock).not.toHaveBeenCalled();
      expect(appFocusMock).not.toHaveBeenCalled();
    },
  );
});
