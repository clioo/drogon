// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  REPRO_TOUR_EVENT,
  onReproTour,
  requestReproTour,
  takePendingReproView,
  type ReproTourRequest,
} from "./repro-demo-tour";

const unsubscribes: (() => void)[] = [];
afterEach(() => {
  while (unsubscribes.length) unsubscribes.pop()?.();
});

function collect(): ReproTourRequest[] {
  const seen: ReproTourRequest[] = [];
  unsubscribes.push(onReproTour((request) => seen.push(request)));
  return seen;
}

describe("the demo's guided tour", () => {
  test("carries a request from the panel to whoever can navigate", () => {
    const seen = collect();
    requestReproTour({ kind: "open-bots", workspaceId: "ws-1" });
    requestReproTour({ kind: "open-sessions", workspaceId: "ws-1" });
    requestReproTour({ kind: "open-work-graph", workspaceId: "ws-1" });
    requestReproTour({ kind: "focus-view", view: "usage" });
    expect(seen).toEqual([
      { kind: "open-bots", workspaceId: "ws-1" },
      { kind: "open-sessions", workspaceId: "ws-1" },
      { kind: "open-work-graph", workspaceId: "ws-1" },
      { kind: "focus-view", view: "usage" },
    ]);
  });

  test("reaches every listener, and stops at unsubscribe", () => {
    const first = collect();
    const second: ReproTourRequest[] = [];
    const off = onReproTour((request) => second.push(request));
    requestReproTour({ kind: "focus-view", view: "graph" });
    off();
    requestReproTour({ kind: "focus-view", view: "evidence" });
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
  });

  test("a view asked for before the pane exists waits for it, once", () => {
    takePendingReproView();
    requestReproTour({ kind: "open-work-graph", workspaceId: "ws-1" });
    requestReproTour({ kind: "focus-view", view: "evidence" });
    expect(takePendingReproView()).toBe("evidence");
    expect(takePendingReproView()).toBeNull();
    // The newest request wins; a mounted pane taking it clears it as well.
    requestReproTour({ kind: "focus-view", view: "evidence" });
    requestReproTour({ kind: "focus-view", view: "usage" });
    expect(takePendingReproView()).toBe("usage");
  });

  test("a half-formed or foreign payload never drives navigation", () => {
    const handler = vi.fn();
    unsubscribes.push(onReproTour(handler));
    for (const detail of [
      null,
      "open-work-graph",
      { kind: "open-work-graph" },
      { kind: "open-work-graph", workspaceId: "" },
      { kind: "open-sessions" },
      { kind: "open-sessions", workspaceId: 7 },
      { kind: "focus-view" },
      { kind: "focus-view", view: "console" },
      { kind: "shutdown" },
      { kind: "open-bots" },
    ]) {
      window.dispatchEvent(new CustomEvent(REPRO_TOUR_EVENT, { detail }));
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
