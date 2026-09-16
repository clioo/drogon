// Issue #333: busy-tab close gating — foreground-child signal, harness
// turns, idle passthrough, and the persisted don't-ask-again preference.
import { describe, expect, it } from "vitest";
import {
  isAgentTerminalSession,
  isBusyTerminalSession,
  readSkipCloseBusyTerminalConfirm,
  writeSkipCloseBusyTerminalConfirm,
  type BusyTerminalSignal,
} from "./close-busy-terminal";

const idleShell: BusyTerminalSignal = {
  verdict: "live",
  agentState: "idle",
  harnessId: null,
};

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as Storage;
}

describe("isBusyTerminalSession", () => {
  it("is busy while the daemon reports a live foreground child", () => {
    expect(
      isBusyTerminalSession({ ...idleShell, hasForegroundChild: true }),
    ).toBe(true);
  });

  it("is idle without the signal, including when the field is absent", () => {
    expect(isBusyTerminalSession(idleShell)).toBe(false);
    expect(
      isBusyTerminalSession({ ...idleShell, hasForegroundChild: false }),
    ).toBe(false);
  });

  it("is busy for a harness turn in flight even with no foreground child", () => {
    expect(
      isBusyTerminalSession({
        verdict: "live",
        agentState: "working",
        harnessId: "claude",
        hasForegroundChild: false,
      }),
    ).toBe(true);
    expect(
      isBusyTerminalSession({
        verdict: "live",
        agentState: "needs_input",
        harnessId: "pi",
      }),
    ).toBe(true);
  });

  it("ignores hook-less activity states on plain shells", () => {
    // A plain shell's activity-based `working` flickers on any output burst
    // (a paste echo, a fast command) — only the daemon signal may gate it.
    expect(
      isBusyTerminalSession({
        verdict: "live",
        agentState: "working",
        harnessId: null,
      }),
    ).toBe(false);
  });

  it("is never busy once the session is not live", () => {
    expect(
      isBusyTerminalSession({
        ...idleShell,
        verdict: "exited",
        hasForegroundChild: true,
      }),
    ).toBe(false);
    expect(
      isBusyTerminalSession({
        verdict: "exited",
        agentState: "working",
        harnessId: "claude",
      }),
    ).toBe(false);
  });
});

describe("isAgentTerminalSession", () => {
  it("picks the agent copy from the launch record", () => {
    expect(isAgentTerminalSession({ harnessId: "claude" })).toBe(true);
    expect(isAgentTerminalSession({ harnessId: null })).toBe(false);
  });
});

describe("close-busy-terminal skip preference", () => {
  it("round-trips through injected storage, defaulting to ask", () => {
    const storage = memoryStorage();
    expect(readSkipCloseBusyTerminalConfirm(storage)).toBe(false);
    writeSkipCloseBusyTerminalConfirm(true, storage);
    expect(readSkipCloseBusyTerminalConfirm(storage)).toBe(true);
    writeSkipCloseBusyTerminalConfirm(false, storage);
    expect(readSkipCloseBusyTerminalConfirm(storage)).toBe(false);
  });
});
