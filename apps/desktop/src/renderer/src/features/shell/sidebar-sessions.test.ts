// MIT Copyright (c) 2026 Lovecast Inc.
// Regression test for the round-2 sidebar bug: the sidebar's session view
// must be host-wide, so card order and card rows cannot depend on which
// workspace is selected.
import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import { sidebarSessionView } from "./sidebar-sessions";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "/bin/zsh",
    args: [],
    harnessId: "claude",
    parentSessionId: null,
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("sidebarSessionView", () => {
  test("keeps every host-wide session whatever the selected workspace reports", () => {
    const hostWide = [
      session({ id: "a", workspaceId: "ws-a" }),
      session({ id: "b", workspaceId: "ws-b" }),
    ];
    // The selected workspace's own scoped list, in either selection.
    expect(
      sidebarSessionView(hostWide, [session({ id: "a", workspaceId: "ws-a" })], new Set())
        .map((item) => item.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(
      sidebarSessionView(hostWide, [session({ id: "b", workspaceId: "ws-b" })], new Set())
        .map((item) => item.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  test("the selected workspace's fresher copy wins for a shared id", () => {
    const hostWide = [session({ id: "a", verdict: "unverifiable" })];
    const scoped = [session({ id: "a", verdict: "live" })];
    const view = sidebarSessionView(hostWide, scoped, new Set());
    expect(view).toHaveLength(1);
    expect(view[0]!.verdict).toBe("live");
  });

  test("selected copy carries the admitted observation value", () => {
    const hostWide = [
      session({
        id: "a",
        harnessId: null,
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
        hasForegroundChild: true,
        cols: 80,
      }),
    ];
    const scoped = [
      session({
        id: "a",
        harnessId: null,
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
        hasForegroundChild: true,
        cols: 132,
      }),
    ];
    const view = sidebarSessionView(hostWide, scoped, new Set());
    expect(view).toHaveLength(1);
    expect(view[0]!.observedHarnessId).toBe("pi");
    expect(view[0]!.observedHarnessAt).toBe("2026-01-01T00:01:00Z");
    expect(view[0]!.hasForegroundChild).toBe(true);
    // The selected copy still owns local/session fields.
    expect(view[0]!.cols).toBe(132);
  });

  test("older poll observation proof does not overlay a newer selected clear", () => {
    const hostWide = [
      session({
        id: "a",
        harnessId: null,
        observedHarnessId: "pi",
        observedHarnessAt: "2026-01-01T00:01:00Z",
        hasForegroundChild: true,
      }),
    ];
    const scoped = [
      session({
        id: "a",
        harnessId: null,
        observedHarnessId: null,
        observedHarnessAt: null,
        hasForegroundChild: false,
      }),
    ];
    const view = sidebarSessionView(hostWide, scoped, new Set());
    expect(view).toHaveLength(1);
    expect(view[0]!.observedHarnessId ?? null).toBeNull();
    expect(view[0]!.observedHarnessAt ?? null).toBeNull();
    expect(view[0]!.hasForegroundChild).toBe(false);
  });

  test("retained host-wide observations do not override the selected copy", () => {
    const hostWide = [session({ id: "a", harnessId: null, observedHarnessId: "pi" })];
    const scoped = [session({ id: "a", harnessId: null })];
    const view = sidebarSessionView(hostWide, scoped, new Set());
    expect(view[0]!.observedHarnessId ?? null).toBeNull();
  });

  test("split second panes never become sidebar rows", () => {
    const hostWide = [session({ id: "root" }), session({ id: "second" })];
    const view = sidebarSessionView(hostWide, [session({ id: "second" })], new Set(["second"]));
    expect(view.map((item) => item.id)).toEqual(["root"]);
  });
});
