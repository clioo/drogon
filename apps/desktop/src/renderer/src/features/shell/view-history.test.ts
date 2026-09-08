import { describe, expect, test } from "vitest";
import {
  canGoBackView,
  canGoForwardView,
  currentView,
  goBackView,
  goForwardView,
  initialViewHistory,
  pushView,
  rewindViewHistoryPastRoute,
} from "./view-history";

describe("view history", () => {
  test("starts with no back or forward entries", () => {
    const history = initialViewHistory({ route: null, workspaceId: "w1" });
    expect(canGoBackView(history)).toBe(false);
    expect(canGoForwardView(history)).toBe(false);
  });

  test("pushing a new view enables back and drops forward", () => {
    let history = initialViewHistory({ route: null, workspaceId: "w1" });
    history = pushView(history, { route: "tasks", workspaceId: "w1" });
    expect(canGoBackView(history)).toBe(true);
    history = goBackView(history);
    expect(currentView(history)).toEqual({ route: null, workspaceId: "w1" });
    expect(canGoForwardView(history)).toBe(true);
    history = pushView(history, { route: "bots", workspaceId: "w1" });
    expect(canGoForwardView(history)).toBe(false);
    expect(currentView(history)).toEqual({ route: "bots", workspaceId: "w1" });
  });

  test("consecutive duplicates are coalesced", () => {
    let history = initialViewHistory({ route: null, workspaceId: "w1" });
    const next = pushView(history, { route: null, workspaceId: "w1" });
    expect(next).toBe(history);
    history = pushView(history, { route: null, workspaceId: "w2" });
    expect(canGoBackView(history)).toBe(true);
  });

  test("forward walks entries in order", () => {
    let history = initialViewHistory({ route: null, workspaceId: "w1" });
    history = pushView(history, { route: "tasks", workspaceId: "w1" });
    history = pushView(history, { route: "bots", workspaceId: "w2" });
    history = goBackView(history);
    history = goBackView(history);
    expect(currentView(history)).toEqual({ route: null, workspaceId: "w1" });
    history = goForwardView(history);
    expect(currentView(history)).toEqual({ route: "tasks", workspaceId: "w1" });
    history = goForwardView(history);
    expect(currentView(history)).toEqual({ route: "bots", workspaceId: "w2" });
    expect(canGoForwardView(history)).toBe(false);
  });

  test("back and forward at the ends are no-ops", () => {
    const history = initialViewHistory({ route: null, workspaceId: "w1" });
    expect(goBackView(history)).toBe(history);
    expect(goForwardView(history)).toBe(history);
  });

  test("entries for removed workspaces are skipped, not landed on", () => {
    let history = initialViewHistory({ route: null, workspaceId: "" });
    history = pushView(history, { route: null, workspaceId: "w1" });
    history = pushView(history, { route: null, workspaceId: "w2" });
    const scope = new Set(["w2"]);
    // w1 is gone: back jumps over it to the landing entry.
    expect(canGoBackView(history, scope)).toBe(true);
    const back = goBackView(history, scope);
    expect(currentView(back)).toEqual({ route: null, workspaceId: "" });
    // Forward from landing skips the dead w1 entry and lands on w2.
    expect(canGoForwardView(back, scope)).toBe(true);
    expect(currentView(goForwardView(back, scope))).toEqual({
      route: null,
      workspaceId: "w2",
    });
  });

  test("back is disabled when only dead entries precede", () => {
    let history = initialViewHistory({ route: null, workspaceId: "w1" });
    history = pushView(history, { route: null, workspaceId: "w2" });
    // w1 removed and w2 is the present entry: nothing live behind it.
    expect(canGoBackView(history, new Set(["w2"]))).toBe(false);
    expect(goBackView(history, new Set(["w2"]))).toBe(history);
  });
});

describe("rewindViewHistoryPastRoute (fork rewindHistoryIndexPastView)", () => {
  test("parks the index on the previous live entry when parked on the page", () => {
    let history = initialViewHistory({ route: null, workspaceId: "w1" });
    history = pushView(history, { route: "bots", workspaceId: "w1" });
    history = pushView(history, { route: null, workspaceId: "w1" });
    history = pushView(history, { route: "tasks", workspaceId: "w1" });
    const rewound = rewindViewHistoryPastRoute(history, "tasks");
    expect(currentView(rewound)).toEqual({ route: null, workspaceId: "w1" });
    // The entries stay: forward can still reach the page entry.
    expect(canGoForwardView(rewound)).toBe(true);
  });

  test("skips dead-workspace entries while rewinding", () => {
    let history = initialViewHistory({ route: null, workspaceId: "gone" });
    history = pushView(history, { route: null, workspaceId: "w1" });
    history = pushView(history, { route: "tasks", workspaceId: "w1" });
    const rewound = rewindViewHistoryPastRoute(
      history,
      "tasks",
      new Set(["w1"]),
    );
    expect(currentView(rewound)).toEqual({ route: null, workspaceId: "w1" });
  });

  test("is a no-op when the index is not parked on that page", () => {
    let history = initialViewHistory({ route: null, workspaceId: "w1" });
    history = pushView(history, { route: "tasks", workspaceId: "w1" });
    const back = goBackView(history);
    expect(rewindViewHistoryPastRoute(back, "tasks")).toBe(back);
  });

  test("is a no-op when no live entry precedes the page", () => {
    const history = initialViewHistory({ route: "tasks", workspaceId: "w1" });
    expect(rewindViewHistoryPastRoute(history, "tasks")).toBe(history);
  });
});
