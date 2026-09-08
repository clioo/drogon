/* MIT Copyright (c) 2026 Lovecast Inc. Tasks initial-source seam (#346):
   the sidebar chips' deep link is parked for the mount, pushed live while
   the page stays mounted, and a request for a not-yet-renderable source
   (Jira before R17-B) falls back to the default source. */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  consumePendingTaskSource,
  requestTaskSourceNavigation,
  resetTaskSourceNavigation,
  resolveRequestedTaskSource,
  subscribeTaskSourceNavigation,
} from "./task-source-navigation";

afterEach(() => {
  resetTaskSourceNavigation();
});

describe("request/consume pending source", () => {
  test("a request before mount is consumed exactly once", () => {
    requestTaskSourceNavigation("jira");
    expect(consumePendingTaskSource()).toBe("jira");
    expect(consumePendingTaskSource()).toBeNull();
  });

  test("no request reads as null", () => {
    expect(consumePendingTaskSource()).toBeNull();
  });
});

describe("subscribeTaskSourceNavigation", () => {
  test("mounted pages hear the request and unsubscribe cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTaskSourceNavigation(listener);
    requestTaskSourceNavigation("github");
    expect(listener).toHaveBeenCalledWith("github");
    unsubscribe();
    requestTaskSourceNavigation("jira");
    expect(listener).toHaveBeenCalledTimes(1);
    // Why: after the live delivery the pending value is still parked for a
    // page that mounts later (the two channels never double-apply: the
    // consumer either reads the pending value on mount or hears it live).
    expect(consumePendingTaskSource()).toBe("jira");
  });
});

describe("resolveRequestedTaskSource", () => {
  test("selects the requested source when the page renders it", () => {
    expect(resolveRequestedTaskSource("github", ["github"])).toBe("github");
    // R17-B shape: once Jira is a renderable option it selects directly.
    expect(resolveRequestedTaskSource("jira", ["github", "jira"])).toBe("jira");
  });

  test("falls back to the default source when the request is not renderable yet", () => {
    expect(resolveRequestedTaskSource("jira", ["github"])).toBe("github");
    expect(resolveRequestedTaskSource("linear", ["github"])).toBe("github");
  });

  test("no request keeps the default source", () => {
    expect(resolveRequestedTaskSource(null, ["github"])).toBe("github");
  });
});
