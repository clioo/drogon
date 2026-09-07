import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNeedsInputWatcher,
  type NeedsInputWatcherDeps,
} from "./service";
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
      workspacePaths: new Map([["ws-1", "/repos/shop/wt-1"]]),
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
    expect(deps.shown[0].title).toBe("Claude Code needs your input");
    expect(deps.shown[0].body).toBe("in wt-1");
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
          workspacePaths: new Map([["ws-1", "/repos/shop/wt-1"]]),
        };
      },
    });
    const watcher = createNeedsInputWatcher(deps);
    stoppables.push(watcher);
    await watcher.tick();
    await watcher.tick();
    expect(deps.shown).toHaveLength(1);
  });
});
