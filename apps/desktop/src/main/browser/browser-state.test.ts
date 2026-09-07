import { describe, expect, test } from "vitest";
import {
  applyHostAction,
  initialHostSnapshot,
  publicTabStates,
} from "./browser-state";

describe("browser host state", () => {
  test("opened tab becomes active and loading", () => {
    const snapshot = applyHostAction(initialHostSnapshot(), {
      type: "tab-opened",
      tabId: "t1",
      workspaceId: "w1",
      url: "https://example.test/",
    });
    expect(snapshot.activeTabId).toBe("t1");
    expect(publicTabStates(snapshot)).toEqual([
      {
        tabId: "t1",
        workspaceId: "w1",
        url: "https://example.test/",
        title: "",
        loading: true,
        canGoBack: false,
        canGoForward: false,
        error: null,
      },
    ]);
  });
  test("blocked navigation keeps an honest error, never ready", () => {
    let snapshot = applyHostAction(initialHostSnapshot(), {
      type: "tab-opened",
      tabId: "t1",
      workspaceId: "w1",
      url: "https://example.test/",
    });
    snapshot = applyHostAction(snapshot, {
      type: "load-blocked",
      tabId: "t1",
      url: "file:///etc/passwd",
      reason: 'Blocked: "file:" URLs cannot load in the pane.',
    });
    snapshot = applyHostAction(snapshot, {
      type: "load-stopped",
      tabId: "t1",
      url: "file:///etc/passwd",
    });
    const [tab] = publicTabStates(snapshot);
    expect(tab.loading).toBe(false);
    expect(tab.error).toMatch(/Blocked/);
  });
  test("failed load surfaces the mapped message", () => {
    let snapshot = applyHostAction(initialHostSnapshot(), {
      type: "tab-opened",
      tabId: "t1",
      workspaceId: "w1",
      url: "https://missing.test/",
    });
    snapshot = applyHostAction(snapshot, {
      type: "load-failed",
      tabId: "t1",
      message: "Could not reach https://missing.test/.",
    });
    const [tab] = publicTabStates(snapshot);
    expect(tab.loading).toBe(false);
    expect(tab.error).toContain("Could not reach");
  });
  test("closing the active tab falls back to the last tab", () => {
    let snapshot = initialHostSnapshot();
    for (const tabId of ["t1", "t2"]) {
      snapshot = applyHostAction(snapshot, {
        type: "tab-opened",
        tabId,
        workspaceId: "w1",
        url: "https://example.test/",
      });
    }
    snapshot = applyHostAction(snapshot, { type: "tab-closed", tabId: "t2" });
    expect(snapshot.activeTabId).toBe("t1");
    expect(snapshot.tabs).toHaveLength(1);
  });
  test("late events for closed tabs are dropped", () => {
    let snapshot = applyHostAction(initialHostSnapshot(), {
      type: "tab-opened",
      tabId: "t1",
      workspaceId: "w1",
      url: "https://example.test/",
    });
    snapshot = applyHostAction(snapshot, { type: "tab-closed", tabId: "t1" });
    const closed = snapshot;
    snapshot = applyHostAction(snapshot, {
      type: "load-stopped",
      tabId: "t1",
      url: "https://example.test/",
    });
    expect(snapshot).toBe(closed);
  });
  test("history and title updates project to the strip", () => {
    let snapshot = applyHostAction(initialHostSnapshot(), {
      type: "tab-opened",
      tabId: "t1",
      workspaceId: "w1",
      url: "https://example.test/",
    });
    snapshot = applyHostAction(snapshot, {
      type: "title-changed",
      tabId: "t1",
      title: "Example",
    });
    snapshot = applyHostAction(snapshot, {
      type: "history-changed",
      tabId: "t1",
      canGoBack: true,
      canGoForward: false,
    });
    const [tab] = publicTabStates(snapshot);
    expect(tab.title).toBe("Example");
    expect(tab.canGoBack).toBe(true);
  });
});
