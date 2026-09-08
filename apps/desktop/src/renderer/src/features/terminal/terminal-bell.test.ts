// MIT Copyright (c) 2026 Lovecast Inc. Tests for terminal-bell.ts: the
// fork's BEL copy and the trigger gates (master switch, focus suppression,
// per-session cooldown).
import { describe, expect, it, vi } from "vitest";
import { installTerminalBell, terminalBellToast } from "./terminal-bell";

describe("terminalBellToast", () => {
  it("uses the fork's bell copy", () => {
    expect(
      terminalBellToast({ worktreeLabel: "term-e2e", repoLabel: "r16ah-term" }),
    ).toEqual({
      title: "Bell in term-e2e",
      body: "r16ah-term · Attention requested",
    });
    expect(terminalBellToast({})).toEqual({
      title: "Bell in workspace",
      body: "Attention requested",
    });
  });
});

function install(sinkOverrides: Record<string, unknown> = {}) {
  const listeners: Array<() => void> = [];
  const notify = vi.fn();
  let at = 1_000;
  const sink = {
    notificationsEnabled: () => true,
    terminalFocused: () => false,
    labels: () => ({ worktreeLabel: "term-e2e", repoLabel: "r16ah-term" }),
    notify,
    ...sinkOverrides,
  };
  const disposable = installTerminalBell(
    { onBell: (listener: () => void) => (listeners.push(listener), { dispose: () => {} }) },
    sink,
    { now: () => at },
  );
  return {
    disposable,
    notify,
    ring: () => listeners.forEach((listener) => listener()),
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe("installTerminalBell", () => {
  it("notifies with the fork copy on BEL", () => {
    const { notify, ring } = install();
    ring();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "Bell in term-e2e",
      "r16ah-term · Attention requested",
    );
  });

  it("stays silent when notifications are disabled or the terminal is focused", () => {
    const disabled = install({ notificationsEnabled: () => false });
    disabled.ring();
    expect(disabled.notify).not.toHaveBeenCalled();

    const focused = install({ terminalFocused: () => true });
    focused.ring();
    expect(focused.notify).not.toHaveBeenCalled();
  });

  it("cools down bursts and re-arms after the cooldown", () => {
    const { notify, ring, advance } = install();
    ring();
    ring();
    advance(1_000);
    ring();
    expect(notify).toHaveBeenCalledTimes(1);
    advance(30_000);
    ring();
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
