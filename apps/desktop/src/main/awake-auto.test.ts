// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Awake Auto watcher (main/awake-auto.ts): polls the daemon session list,
// reports working/idle transitions only while auto is selected, forgets the
// last verdict while auto is off so re-entry re-arms from a fresh poll, and
// survives failed polls without losing transitions.
import { describe, expect, test, vi } from "vitest";
import {
  anySessionWorking,
  asWatchedSessions,
  createAwakeAutoWatcher,
} from "./awake-auto";

function harness() {
  const reports: boolean[] = [];
  let auto = true;
  let sessions: unknown = { sessions: [] };
  let failNext = false;
  const watcher = createAwakeAutoWatcher({
    listSessions: async () => {
      if (failNext) {
        failNext = false;
        throw new Error("daemon down");
      }
      return asWatchedSessions(sessions);
    },
    isAuto: () => auto,
    setAgentWorking: (working) => reports.push(working),
    pollIntervalMs: 3_600_000, // tests drive tick() directly
  });
  return {
    watcher,
    reports,
    setAuto(next: boolean) {
      auto = next;
    },
    setSessions(next: unknown) {
      sessions = next;
    },
    failNextPoll() {
      failNext = true;
    },
  };
}

describe("awake auto watcher", () => {
  test("session rows parse per-record: malformed rows never fail the list", () => {
    expect(
      asWatchedSessions({
        sessions: [
          { id: "a", agentState: "working" },
          { id: 42 },
          null,
          { agentState: "idle" },
          { id: "b", agentState: "needs_input" },
        ],
      }),
    ).toEqual([
      { id: "a", agentState: "working" },
      { id: "b", agentState: "needs_input" },
    ]);
    expect(asWatchedSessions(null)).toEqual([]);
    expect(asWatchedSessions({})).toEqual([]);
  });

  test("anySessionWorking is exactly the fork predicate", () => {
    expect(anySessionWorking([{ id: "a" }])).toBe(false);
    expect(
      anySessionWorking([
        { id: "a", agentState: "idle" },
        { id: "b", agentState: "working" },
      ]),
    ).toBe(true);
  });

  test("reports transitions only: start, no repeat, release", async () => {
    const h = harness();
    h.setSessions({ sessions: [{ id: "a", agentState: "idle" }] });
    await h.watcher.tick();
    expect(h.reports).toEqual([false]);
    h.setSessions({
      sessions: [
        { id: "a", agentState: "idle" },
        { id: "b", agentState: "working" },
      ],
    });
    await h.watcher.tick();
    expect(h.reports).toEqual([false, true]);
    // Steady working stays quiet.
    await h.watcher.tick();
    expect(h.reports).toEqual([false, true]);
  });

  test("leaving auto reports nothing and forgets; re-entry re-reports fresh", async () => {
    const h = harness();
    h.setSessions({ sessions: [{ id: "a", agentState: "working" }] });
    await h.watcher.tick();
    expect(h.reports).toEqual([true]);
    h.setAuto(false);
    // Agent goes idle while auto is off: no report.
    h.setSessions({ sessions: [{ id: "a", agentState: "idle" }] });
    await h.watcher.tick();
    expect(h.reports).toEqual([true]);
    h.setAuto(true);
    // First auto tick re-reports the fresh (idle) verdict instead of the
    // stale "working", so the assertion releases.
    await h.watcher.tick();
    expect(h.reports).toEqual([true, false]);
  });

  test("a failed poll keeps the previous verdict and the next tick recovers", async () => {
    const h = harness();
    h.setSessions({ sessions: [{ id: "a", agentState: "working" }] });
    await h.watcher.tick();
    expect(h.reports).toEqual([true]);
    h.failNextPoll();
    await h.watcher.tick();
    expect(h.reports).toEqual([true]);
    // Next poll sees idle: exactly one release transition, no double report.
    h.setSessions({ sessions: [{ id: "a", agentState: "idle" }] });
    await h.watcher.tick();
    expect(h.reports).toEqual([true, false]);
  });

  test("stop clears the interval", () => {
    const h = harness();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    h.watcher.stop();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
