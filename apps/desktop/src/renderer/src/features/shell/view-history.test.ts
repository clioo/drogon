import { describe, expect, test } from "vitest";
import {
  canGoBackView,
  canGoForwardView,
  goBackView,
  goForwardView,
  initialViewHistory,
  pushView,
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
    expect(history.present).toEqual({ route: null, workspaceId: "w1" });
    expect(canGoForwardView(history)).toBe(true);
    history = pushView(history, { route: "bots", workspaceId: "w1" });
    expect(canGoForwardView(history)).toBe(false);
    expect(history.present).toEqual({ route: "bots", workspaceId: "w1" });
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
    expect(history.present).toEqual({ route: null, workspaceId: "w1" });
    history = goForwardView(history);
    expect(history.present).toEqual({ route: "tasks", workspaceId: "w1" });
    history = goForwardView(history);
    expect(history.present).toEqual({ route: "bots", workspaceId: "w2" });
    expect(canGoForwardView(history)).toBe(false);
  });

  test("back and forward at the ends are no-ops", () => {
    const history = initialViewHistory({ route: null, workspaceId: "w1" });
    expect(goBackView(history)).toBe(history);
    expect(goForwardView(history)).toBe(history);
  });
});
