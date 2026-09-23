import { describe, expect, test } from "vitest";
import {
  applyHostAction,
  initialHostSnapshot,
  publicTabStates,
} from "./browser-state";

function opened(tabId = "t1", url = "https://example.test/") {
  return applyHostAction(initialHostSnapshot(), {
    type: "tab-opened",
    tabId,
    workspaceId: "w1",
    url,
  });
}

describe("browser host state transitions", () => {
  test("reopening an existing tab id is ignored, never duplicated", () => {
    const first = opened();
    const second = applyHostAction(first, {
      type: "tab-opened",
      tabId: "t1",
      workspaceId: "w1",
      url: "https://other.test/",
    });
    expect(second).toBe(first);
    expect(second.tabs).toHaveLength(1);
  });
  test("closing an unknown tab keeps the snapshot untouched", () => {
    const first = opened();
    expect(applyHostAction(first, { type: "tab-closed", tabId: "ghost" })).toBe(first);
  });
  test("closing a background tab keeps the active tab", () => {
    let snapshot = opened("t1");
    snapshot = applyHostAction(snapshot, {
      type: "tab-opened",
      tabId: "t2",
      workspaceId: "w1",
      url: "https://example.test/",
    });
    snapshot = applyHostAction(snapshot, { type: "tab-closed", tabId: "t1" });
    expect(snapshot.activeTabId).toBe("t2");
  });
  test("activating an unknown tab is ignored; null clears the active tab", () => {
    const first = opened();
    expect(applyHostAction(first, { type: "active-changed", tabId: "ghost" })).toBe(first);
    const cleared = applyHostAction(first, { type: "active-changed", tabId: null });
    expect(cleared.activeTabId).toBeNull();
    expect(cleared.tabs).toHaveLength(1);
  });
  test("a commit marks ready and committed and clears the error", () => {
    let snapshot = opened();
    snapshot = applyHostAction(snapshot, {
      type: "load-failed",
      tabId: "t1",
      message: "Could not reach it.",
    });
    snapshot = applyHostAction(snapshot, {
      type: "navigation-committed",
      tabId: "t1",
      url: "https://example.test/next",
    });
    const [tab] = publicTabStates(snapshot);
    expect(tab).toMatchObject({
      url: "https://example.test/next",
      loading: false,
      error: null,
      loadError: null,
      committed: true,
    });
  });
  test("an abort with no URL keeps the current address bar", () => {
    let snapshot = opened("t1", "https://example.test/a");
    snapshot = applyHostAction(snapshot, {
      type: "navigation-aborted",
      tabId: "t1",
      url: "",
    });
    const [tab] = publicTabStates(snapshot);
    expect(tab.url).toBe("https://example.test/a");
    expect(tab.loading).toBe(false);
  });
  test("a stop for a loading first navigation becomes ready but uncommitted", () => {
    let snapshot = opened();
    snapshot = applyHostAction(snapshot, {
      type: "load-stopped",
      tabId: "t1",
      url: "https://example.test/",
    });
    const [tab] = publicTabStates(snapshot);
    expect(tab.loading).toBe(false);
    expect(tab.committed).toBe(false);
    expect(tab.error).toBeNull();
  });
  test("a stop landing on an error tab keeps the honest error", () => {
    let snapshot = opened();
    snapshot = applyHostAction(snapshot, {
      type: "load-failed",
      tabId: "t1",
      message: "Could not reach it.",
    });
    const failed = snapshot;
    snapshot = applyHostAction(snapshot, {
      type: "load-stopped",
      tabId: "t1",
      url: "https://example.test/",
    });
    expect(snapshot).toBe(failed);
    expect(publicTabStates(snapshot)[0].error).toBe("Could not reach it.");
  });
  test("a failure without detail keeps the previous load error", () => {
    let snapshot = opened();
    const detail = {
      kind: "failed" as const,
      code: -105,
      description: "name lookup failed",
      url: "https://missing.test/",
    };
    snapshot = applyHostAction(snapshot, {
      type: "load-failed",
      tabId: "t1",
      message: "Could not reach it.",
      loadError: detail,
    });
    snapshot = applyHostAction(snapshot, {
      type: "load-failed",
      tabId: "t1",
      message: "Still failing.",
    });
    const [tab] = publicTabStates(snapshot);
    expect(tab.error).toBe("Still failing.");
    expect(tab.loadError).toEqual(detail);
  });
  test("titles longer than 256 chars are cut", () => {
    let snapshot = opened();
    snapshot = applyHostAction(snapshot, {
      type: "title-changed",
      tabId: "t1",
      title: `T${"x".repeat(400)}`,
    });
    expect(publicTabStates(snapshot)[0].title).toHaveLength(256);
  });
  test("a zoom change projects to the strip", () => {
    let snapshot = opened();
    snapshot = applyHostAction(snapshot, {
      type: "zoom-changed",
      tabId: "t1",
      zoomPercent: 120,
    });
    expect(publicTabStates(snapshot)[0].zoomPercent).toBe(120);
  });
  test("a blocked tab exposes its error and detail; ready tabs expose none", () => {
    let snapshot = opened();
    snapshot = applyHostAction(snapshot, {
      type: "load-blocked",
      tabId: "t1",
      url: "file:///etc/passwd",
      reason: 'Blocked: "file:" URLs cannot load in the pane.',
    });
    const [blocked] = publicTabStates(snapshot);
    expect(blocked.loading).toBe(false);
    expect(blocked.error).toContain("file:");
    expect(blocked.loadError).toMatchObject({ kind: "blocked", code: null });
    const committed = applyHostAction(snapshot, {
      type: "navigation-committed",
      tabId: "t1",
      url: "https://example.test/",
    });
    const [ready] = publicTabStates(committed);
    expect(ready.error).toBeNull();
    expect(ready.loadError).toBeNull();
  });
});
