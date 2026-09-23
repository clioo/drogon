// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Awake Auto watcher (main/awake-auto.ts): polls the daemon session list,
// reports working/idle transitions only while auto is selected, forgets the
// last verdict while auto is off so re-entry re-arms from a fresh poll, and
// survives failed polls without losing transitions.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  anySessionWorking,
  asWatchedSessions,
  createAwakeAutoWatcher,
} from "./awake-auto";
import {
  resetSessionPushListenersForTests,
  resetSessionStatePushForTests,
  startSessionStatePush,
  subscribeSessionPush,
} from "./session-state-bridge";

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

describe("awake auto push feed (PERF-05)", () => {
  afterEach(() => {
    resetSessionPushListenersForTests();
    resetSessionStatePushForTests();
  });

  function pushHarness() {
    const reports: boolean[] = [];
    let auto = true;
    let pollCalls = 0;
    const watcher = createAwakeAutoWatcher({
      listSessions: async () => {
        pollCalls += 1;
        return [];
      },
      isAuto: () => auto,
      setAgentWorking: (working) => reports.push(working),
      pollIntervalMs: 3_600_000,
    });
    return {
      watcher,
      reports,
      pollCalls: () => pollCalls,
      setAuto(next: boolean) {
        auto = next;
      },
    };
  }

  test("push reports working/idle transitions with zero polls", async () => {
    const h = pushHarness();
    try {
      h.watcher.observePush({ sessionId: "a", agentState: "working" });
      expect(h.reports).toEqual([true]);
      expect(h.pollCalls()).toBe(0);
      h.watcher.observePush({ sessionId: "a", agentState: "working" });
      expect(h.reports).toEqual([true]);
      h.watcher.observePush({ sessionId: "a", agentState: "idle" });
      expect(h.reports).toEqual([true, false]);
      expect(h.pollCalls()).toBe(0);
    } finally {
      h.watcher.stop();
    }
  });

  test("the fallback tick reconciles sessions the push never saw, and notices vanished ones", async () => {
    const reports: boolean[] = [];
    let snapshot: unknown = { sessions: [] };
    let gate: Promise<void> | null = null;
    const watcher = createAwakeAutoWatcher({
      listSessions: async () => {
        if (gate) await gate;
        return asWatchedSessions(snapshot);
      },
      isAuto: () => true,
      setAgentWorking: (working) => reports.push(working),
      pollIntervalMs: 3_600_000,
    });
    try {
      // A session the push never mentioned still arms awake via the poll.
      snapshot = { sessions: [{ id: "quiet", agentState: "working" }] };
      await watcher.tick();
      expect(reports).toEqual([true]);
      // A push that lands mid-poll is fresher than the snapshot: `quiet`
      // goes idle in the poll but `fresh` still works — no release blip.
      snapshot = { sessions: [{ id: "quiet", agentState: "idle" }] };
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ticking = watcher.tick();
      watcher.observePush({ sessionId: "fresh", agentState: "working" });
      release();
      await ticking;
      gate = null;
      expect(reports).toEqual([true]);
      // A later poll that lists nothing, with no fresh push behind it,
      // means everything went quiet: exactly one release.
      snapshot = { sessions: [] };
      await watcher.tick();
      expect(reports).toEqual([true, false]);
    } finally {
      watcher.stop();
    }
  });

  test("pushes while auto is off report nothing and forget, like the tick", async () => {
    const h = pushHarness();
    try {
      h.watcher.observePush({ sessionId: "a", agentState: "working" });
      expect(h.reports).toEqual([true]);
      h.setAuto(false);
      h.watcher.observePush({ sessionId: "a", agentState: "idle" });
      expect(h.reports).toEqual([true]);
      h.setAuto(true);
      h.watcher.observePush({ sessionId: "a", agentState: "idle" });
      expect(h.reports).toEqual([true, false]);
    } finally {
      h.watcher.stop();
    }
  });

  test("the live push feed drives the watcher; stop unsubscribes", async () => {
    const h = pushHarness();
    const rounds = { count: 0 };
    resetSessionStatePushForTests();
    const stopLoop = startSessionStatePush({
      getWindow: () => null,
      call: async () => {
        rounds.count += 1;
        return {
          ok: true as const,
          result: {
            bootId: "boot-1",
            events: [
              {
                seq: rounds.count,
                sessionId: "a",
                workspaceId: "w-1",
                agentState: "working",
                agentStateAt: "2026-09-08T07:00:00Z",
              },
            ],
            nextSeq: rounds.count,
          },
        };
      },
      maxRounds: 1,
      log: () => {},
    });
    try {
      const deadline = Date.now() + 5000;
      while (rounds.count < 1) {
        if (Date.now() > deadline) throw new Error("timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
      // Zero polls: the push alone armed awake.
      expect(h.reports).toEqual([true]);
      expect(h.pollCalls()).toBe(0);
    } finally {
      stopLoop();
      resetSessionStatePushForTests();
    }
    h.watcher.stop();
    // After stop, the feed reaches nobody.
    const heard: string[] = [];
    const stopProbe = subscribeSessionPush((event) =>
      heard.push(event.sessionId),
    );
    try {
      resetSessionStatePushForTests();
      const rounds2 = { count: 0 };
      const stopLoop2 = startSessionStatePush({
        getWindow: () => null,
        call: async () => {
          rounds2.count += 1;
          return {
            ok: true as const,
            result: {
              bootId: "boot-1",
              events: [
                {
                  seq: rounds2.count,
                  sessionId: "a",
                  workspaceId: "w-1",
                  agentState: "idle",
                  agentStateAt: "2026-09-08T07:00:01Z",
                },
              ],
              nextSeq: rounds2.count,
            },
          };
        },
        maxRounds: 1,
        log: () => {},
      });
      try {
        const deadline = Date.now() + 5000;
        while (rounds2.count < 1) {
          if (Date.now() > deadline) throw new Error("timed out");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(heard).toEqual(["a"]);
        // The stopped watcher never released: still exactly one report.
        expect(h.reports).toEqual([true]);
      } finally {
        stopLoop2();
        resetSessionStatePushForTests();
      }
    } finally {
      stopProbe();
    }
  });
});
