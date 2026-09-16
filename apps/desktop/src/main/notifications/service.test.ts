import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentTaskCompletionObserver,
  createNeedsInputWatcher,
  createTerminalBellNotificationHandler,
  type AgentTaskCompletionEvent,
  type NeedsInputWatcherDeps,
} from "./service";
import {
  resetSessionPushListenersForTests,
  resetSessionStatePushForTests,
  startSessionStatePush,
} from "../session-state-bridge";
import type { WatchedSession } from "./watcher";

type FakeWindow = {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
  webContents: { send: (channel: string, event: unknown) => void };
};

function fakeWindow(): FakeWindow & { sent: { channel: string; event: unknown }[] } {
  const sent: { channel: string; event: unknown }[] = [];
  const window = {
    sent,
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send: (channel: string, event: unknown) => {
        sent.push({ channel, event });
      },
    },
  };
  return window;
}

const waiting = (id: string): WatchedSession => ({
  id,
  workspaceId: "ws-1",
  command: "/usr/local/bin/claude",
  harnessId: "claude",
  agentState: "needs_input",
  agentStateAt: "2026-09-07T12:00:00Z",
});

function depsFor(
  window: FakeWindow,
  snapshots: { sessions: WatchedSession[] }[],
  overrides: Partial<NeedsInputWatcherDeps> = {},
): NeedsInputWatcherDeps & {
  shown: { title: string; body: string; onClick: () => void }[];
  logs: string[];
} {
  const shown: { title: string; body: string; onClick: () => void }[] = [];
  const logs: string[] = [];
  let calls = 0;
  return {
    getWindow: () => window as never,
    listSessions: async () => ({
      sessions: snapshots[Math.min(calls++, snapshots.length - 1)].sessions,
      workspaceNames: new Map([["ws-1", "wt-1"]]),
    }),
    isEnabled: () => true,
    show: (title, body, onClick) => {
      shown.push({ title, body, onClick });
    },
    pollIntervalMs: 60_000,
    log: (message) => logs.push(message),
    ...overrides,
    shown,
    logs,
  };
}

const stoppables: { stop: () => void }[] = [];
afterEach(() => {
  while (stoppables.length) stoppables.pop()?.stop();
  resetSessionPushListenersForTests();
  resetSessionStatePushForTests();
});

async function waitForPushRound(flag: { count: number }): Promise<void> {
  const deadline = Date.now() + 5000;
  while (flag.count < 1) {
    if (Date.now() > deadline) throw new Error("timed out waiting for push");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("createTerminalBellNotificationHandler", () => {
  it("gates the bell by master/event settings and focused state", async () => {
    const shown: { title: string; body: string }[] = [];
    const input = { sessionId: "s-1", workspaceId: "ws-1" };
    const base = {
      getPreferences: () => ({
        enabled: true,
        agentTaskComplete: true,
        terminalBell: true,
        suppressWhenFocused: true,
      }),
      isFocused: () => false,
      resolveWorkspaceName: async () => "term-e2e",
      show: (title: string, body: string) => shown.push({ title, body }),
      onClick: vi.fn(),
    };
    const handler = createTerminalBellNotificationHandler(base);
    expect(await handler(input)).toBe(true);
    expect(shown).toEqual([
      { title: "Bell in term-e2e", body: "Attention requested" },
    ]);
    expect(
      await createTerminalBellNotificationHandler({
        ...base,
        getPreferences: () => ({ ...base.getPreferences(), terminalBell: false }),
      })(input),
    ).toBe(false);
    expect(
      await createTerminalBellNotificationHandler({
        ...base,
        isFocused: () => true,
      })(input),
    ).toBe(false);
    expect(await handler({ sessionId: "", workspaceId: "ws-1" })).toBe(false);
  });
});

describe("createAgentTaskCompletionObserver", () => {
  it("notifies only for working to idle/needs_input", async () => {
    const window = fakeWindow();
    const shown: { title: string; body: string }[] = [];
    const observer = createAgentTaskCompletionObserver({
      getWindow: () => window as never,
      isEnabled: () => true,
      resolveContext: async (event) => ({
        session: {
          id: event.sessionId,
          workspaceId: event.workspaceId,
          command: "/usr/local/bin/pi",
          harnessId: "pi",
          agentState: event.agentState,
        },
        workspaceName: "wt-1",
      }),
      show: (title, body) => shown.push({ title, body }),
    });
    const event = (agentState: string): AgentTaskCompletionEvent => ({
      sessionId: "a",
      workspaceId: "ws-1",
      agentState,
      agentStateAt: null,
    });
    observer.observe(event("working"));
    observer.observe(event("idle"));
    await Promise.resolve();
    expect(shown).toEqual([
      { title: "wt-1 - Pi finished", body: "Pi finished." },
    ]);
    observer.observe(event("needs_input"));
    await Promise.resolve();
    expect(shown).toHaveLength(1);
    observer.observe(event("working"));
    observer.observe(event("needs_input"));
    await Promise.resolve();
    expect(shown).toHaveLength(2);
    expect(shown[1]).toEqual({
      title: "wt-1 - Pi needs input",
      body: "Pi needs input.",
    });
  });

  it("gates delivery by the event setting and focused-window rule", async () => {
    const window = fakeWindow();
    const show = vi.fn();
    const observer = createAgentTaskCompletionObserver({
      getWindow: () => window as never,
      isEnabled: () => false,
      suppressWhenFocused: () => false,
      show,
    });
    observer.observe({
      sessionId: "a",
      workspaceId: "ws-1",
      agentState: "working",
      agentStateAt: null,
    });
    observer.observe({
      sessionId: "a",
      workspaceId: "ws-1",
      agentState: "idle",
      agentStateAt: null,
    });
    await Promise.resolve();
    expect(show).not.toHaveBeenCalled();
  });
});

describe("createNeedsInputWatcher", () => {
  it("notifies once per entry into needs_input and logs the firing", async () => {
    const window = fakeWindow();
    const deps = depsFor(window, [
      { sessions: [waiting("a")] },
      { sessions: [waiting("a")] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
    expect(deps.shown[0].title).toBe("wt-1 - Claude Code needs input");
    expect(deps.shown[0].body).toBe("Claude Code needs input.");
    expect(deps.logs).toHaveLength(1);
    expect(deps.logs[0]).toContain("needs_input notification shown");
    const states = window.sent.filter((item) => item.channel === "ui:session-state-changed");
    expect(states).toHaveLength(1);
    expect(states[0].event).toMatchObject({
      sessionId: "a",
      workspaceId: "ws-1",
      agentState: "needs_input",
    });
  });

  it("forwards leaving transitions without notifying", async () => {
    const window = fakeWindow();
    const working: WatchedSession = { ...waiting("a"), agentState: "working" };
    const deps = depsFor(window, [
      { sessions: [waiting("a")] },
      { sessions: [working] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
    const states = window.sent.filter((item) => item.channel === "ui:session-state-changed");
    expect(states).toHaveLength(2);
    expect(states[1].event).toMatchObject({ sessionId: "a", agentState: "working" });
  });

  it("leaves working to needs_input delivery to the push observer", async () => {
    const window = fakeWindow();
    const deps = depsFor(window, [
      { sessions: [{ ...waiting("a"), agentState: "working" }] },
      { sessions: [waiting("a")] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    expect(
      window.sent.filter((item) => item.channel === "ui:session-state-changed"),
    ).toHaveLength(1);
  });

  it("forwards activity transitions without notifying (idle shell leaves working)", async () => {
    const window = fakeWindow();
    const idle: WatchedSession = {
      ...waiting("a"),
      agentState: "idle",
      agentStateAt: "2026-09-07T12:00:00Z",
    };
    const working: WatchedSession = { ...waiting("a"), agentState: "working" };
    const deps = depsFor(window, [
      { sessions: [working] },
      { sessions: [idle] },
      { sessions: [idle] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    await watcher.tick();
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    const states = window.sent.filter((item) => item.channel === "ui:session-state-changed");
    expect(states).toHaveLength(1);
    expect(states[0].event).toMatchObject({ sessionId: "a", agentState: "idle" });
  });

  it("#272: the boot poll is baseline; an out-of-band session forwards on a later tick", async () => {
    const window = fakeWindow();
    const shell = (id: string): WatchedSession => ({
      id,
      workspaceId: "ws-1",
      command: "/bin/sleep",
      harnessId: null,
      agentState: "unknown",
      agentStateAt: null,
    });
    // Tick 1: the pre-existing session list (baseline — quiet). Tick 2: a
    // session created out-of-band by drogon-cli appears in the same
    // workspace; the renderer must hear about it so the strip refetches.
    const deps = depsFor(window, [
      { sessions: [shell("early")] },
      { sessions: [shell("early"), shell("cli-late")] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    const states = window.sent.filter(
      (item) => item.channel === "ui:session-state-changed",
    );
    expect(states).toHaveLength(1);
    expect(states[0].event).toMatchObject({
      sessionId: "cli-late",
      workspaceId: "ws-1",
      agentState: "unknown",
    });
  });

  it("still forwards badge transitions while the toggle is off", async () => {
    const window = fakeWindow();
    const deps = depsFor(window, [{ sessions: [waiting("a")] }], {
      isEnabled: () => false,
    });
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    expect(
      window.sent.filter((item) => item.channel === "ui:session-state-changed"),
    ).toHaveLength(1);
  });

  it("click focuses the window and emits the focus-session event", async () => {
    const window = fakeWindow();
    const deps = depsFor(window, [{ sessions: [waiting("a")] }]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
    deps.shown[0].onClick();
    expect(window.focus).toHaveBeenCalled();
    const focus = window.sent.filter((item) => item.channel === "ui:focus-session");
    expect(focus).toHaveLength(1);
    expect(focus[0].event).toEqual({ sessionId: "a", workspaceId: "ws-1" });
  });

  it("survives a failed poll without losing the transition", async () => {
    const window = fakeWindow();
    let fail = true;
    const deps = depsFor(window, [{ sessions: [waiting("a")] }], {
      listSessions: async () => {
        if (fail) {
          fail = false;
          throw new Error("socket gone");
        }
        return {
          sessions: [waiting("a")],
          workspaceNames: new Map([["ws-1", "wt-1"]]),
        };
      },
    });
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
  });

  it("labels a bundle-path harness session by harnessId (never cli.js)", async () => {
    const window = fakeWindow();
    const bundleWaiting: WatchedSession = {
      ...waiting("a"),
      command: "/bundle/cli.js",
      harnessId: "pi",
    };
    const deps = depsFor(window, [{ sessions: [bundleWaiting] }]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
    expect(deps.shown[0].title).toBe("wt-1 - Pi needs input");
    expect(deps.shown[0].body).toBe("Pi needs input.");
  });
});

describe("needs_input push feed (PERF-05)", () => {
  const idleClaude: WatchedSession = { ...waiting("a"), agentState: "idle" };
  const workingClaude: WatchedSession = {
    ...waiting("a"),
    agentState: "working",
  };
  const push = (agentState: string) => ({
    sessionId: "a",
    workspaceId: "ws-1",
    agentState,
    agentStateAt: "2026-09-07T12:00:01Z",
  });

  it("a push for a known idle session banners at push time; the fallback stays quiet", async () => {
    const window = fakeWindow();
    const deps = depsFor(window, [
      { sessions: [idleClaude] },
      { sessions: [waiting("a")] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    watcher.observePush(push("needs_input"));
    expect(deps.shown).toHaveLength(1);
    expect(deps.shown[0].title).toBe("wt-1 - Claude Code needs input");
    // The bridge already forwarded the badge; the watcher never re-sends.
    expect(window.sent).toHaveLength(0);
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
    expect(window.sent).toHaveLength(0);
  });

  it("a push for a known working session never banners (the completion observer owns it)", async () => {
    const window = fakeWindow();
    const deps = depsFor(window, [
      { sessions: [workingClaude] },
      { sessions: [waiting("a")] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    watcher.observePush(push("needs_input"));
    expect(deps.shown).toHaveLength(0);
    // The baseline still moved: the fallback poll finds nothing new, so it
    // neither banners nor re-forwards.
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    expect(window.sent).toHaveLength(0);
  });

  it("a push for an unknown session stays silent so the fallback poll banners exactly once", async () => {
    const window = fakeWindow();
    const shell: WatchedSession = {
      id: "early",
      workspaceId: "ws-1",
      command: "/bin/sleep",
      harnessId: null,
      agentState: "unknown",
      agentStateAt: null,
    };
    const late: WatchedSession = { ...waiting("cli-late") };
    const deps = depsFor(window, [
      { sessions: [shell] },
      { sessions: [shell, late] },
    ]);
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    expect(deps.shown).toHaveLength(0);
    // No command/harness context yet: silent here, baseline untouched.
    watcher.observePush({
      sessionId: "cli-late",
      workspaceId: "ws-1",
      agentState: "needs_input",
      agentStateAt: "2026-09-07T12:00:01Z",
    });
    expect(deps.shown).toHaveLength(0);
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
    expect(deps.shown[0].title).toBe("wt-1 - Claude Code needs input");
  });

  it("end to end: the push loop drives the watcher with zero polls past seeding", async () => {
    resetSessionStatePushForTests();
    const window = fakeWindow();
    const base = depsFor(window, [{ sessions: [idleClaude] }]);
    let polls = 0;
    const deps: NeedsInputWatcherDeps & {
      shown: { title: string; body: string; onClick: () => void }[];
      logs: string[];
    } = {
      ...base,
      listSessions: async () => {
        polls += 1;
        return base.listSessions();
      },
    };
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    expect(polls).toBe(1);
    expect(deps.shown).toHaveLength(0);
    const rounds = { count: 0 };
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
                workspaceId: "ws-1",
                agentState: "needs_input",
                agentStateAt: "2026-09-07T12:00:01Z",
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
      await waitForPushRound(rounds);
      expect(deps.shown).toHaveLength(1);
      expect(deps.shown[0].title).toBe("wt-1 - Claude Code needs input");
      expect(polls).toBe(1);
    } finally {
      stopLoop();
      resetSessionStatePushForTests();
    }
  });

  it("stop unsubscribes the watcher from the push feed", async () => {
    const window = fakeWindow();
    const deps = depsFor(window, [{ sessions: [idleClaude] }]);
    const watcher = createNeedsInputWatcher(deps);
    await watcher.tick();
    watcher.stop();
    watcher.observePush(push("needs_input"));
    // Direct calls still work (the method is the unit seam); only the live
    // feed subscription is gone, so a loop round reaches nobody.
    expect(deps.shown).toHaveLength(1);
    resetSessionStatePushForTests();
    const rounds = { count: 0 };
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
                workspaceId: "ws-1",
                agentState: "working",
                agentStateAt: "2026-09-07T12:00:02Z",
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
      await waitForPushRound(rounds);
      expect(deps.shown).toHaveLength(1);
    } finally {
      stopLoop();
      resetSessionStatePushForTests();
    }
  });
});
