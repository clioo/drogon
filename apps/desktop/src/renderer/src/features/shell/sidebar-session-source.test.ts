/* MIT Copyright (c) 2026 Lovecast Inc.
   The sidebar's session source: reads host-wide while that works, and keeps
   every card populated from bounded scoped reads when it does not. */
import { describe, expect, test } from "vitest";
import type { Session } from "../../../../shared/session-contract";
import {
  SIDEBAR_SCOPED_READ_BATCH,
  createSidebarSessionCollector,
  pollSidebarSessions,
} from "./sidebar-session-source";
import { observationKeyOf } from "./sidebar-session-observation";

function session(id: string, workspaceId: string): Session {
  return {
    id,
    workspaceId,
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T11:00:00.000Z",
    agentState: "idle",
    agentStateAt: "2026-09-08T11:59:00.000Z",
    harnessId: null,
  };
}

const workspaceIds = ["ws-1", "ws-2", "ws-3"];

describe("sidebar session source", () => {
  test("a healthy host-wide read is the whole view", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWide([session("a", "ws-1"), session("b", "ws-2")]);
    expect(collector.isDegraded()).toBe(false);
    expect(collector.view().sessions.map((row) => row.id).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(collector.view().degraded).toBe(false);
  });

  test("a failed host-wide read degrades instead of blanking", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWide([session("a", "ws-1")]);
    collector.noteHostWideFailure();
    expect(collector.isDegraded()).toBe(true);
    // The last known list still renders until scoped reads land.
    expect(collector.view().sessions.map((row) => row.id)).toEqual(["a"]);
    expect(collector.view().degraded).toBe(true);
  });

  test("scoped reads cover every workspace in rotation, batched", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    const first = collector.planScopedReads(workspaceIds, 2);
    expect(first).toEqual(["ws-1", "ws-2"]);
    collector.noteScoped("ws-1", [session("one", "ws-1")]);
    collector.noteScoped("ws-2", [session("two", "ws-2")]);
    const second = collector.planScopedReads(workspaceIds, 2);
    // The rotation continues where it stopped and wraps to the start.
    expect(second).toEqual(["ws-3", "ws-1"]);
    collector.noteScoped("ws-3", [session("three", "ws-3")]);
    expect(collector.view().sessions.map((row) => row.id).sort()).toEqual([
      "one",
      "three",
      "two",
    ]);
  });

  test("the default batch keeps a degraded poll bounded", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    const many = Array.from({ length: 40 }, (_, index) => `ws-${index}`);
    expect(collector.planScopedReads(many)).toHaveLength(
      SIDEBAR_SCOPED_READ_BATCH,
    );
  });

  test("a workspace that disappeared loses its cached list", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    collector.noteScoped("ws-gone", [session("gone", "ws-gone")]);
    expect(collector.planScopedReads(["ws-1"], 2)).toEqual(["ws-1"]);
    // The deleted workspace's rows must not render under a card that no
    // longer exists.
    expect(collector.view().sessions.map((row) => row.id)).toEqual([]);
  });

  test("recovering the host-wide read drops the scoped cache", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    collector.noteScoped("ws-1", [session("one", "ws-1")]);
    collector.noteHostWide([session("fresh", "ws-2")]);
    expect(collector.isDegraded()).toBe(false);
    expect(collector.view().sessions.map((row) => row.id)).toEqual(["fresh"]);
  });

  test("a later scoped read replaces an earlier one for the same workspace", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    collector.noteScoped("ws-1", [session("old", "ws-1")]);
    collector.noteScoped("ws-1", [session("new", "ws-1")]);
    expect(collector.view().sessions.map((row) => row.id)).toEqual(["new"]);
  });

  test("planning with no workspaces is a no-op, never a modulo crash", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    expect(collector.planScopedReads([], 4)).toEqual([]);
    expect(collector.view().sessions).toEqual([]);
  });
});

describe("one sidebar poll", () => {
  test("a healthy host-wide read never asks a workspace", async () => {
    const collector = createSidebarSessionCollector();
    const scoped: string[] = [];
    const view = await pollSidebarSessions({
      collector,
      workspaceIds,
      fetchHostWide: async () => ({ ok: true, sessions: [session("a", "ws-1")] }),
      fetchScoped: async (id) => {
        scoped.push(id);
        return { ok: true, sessions: [] };
      },
    });
    expect(scoped).toEqual([]);
    expect(view.sessions.map((row) => row.id)).toEqual(["a"]);
    expect(view.degraded).toBe(false);
  });

  test("a failed host-wide read fills in the workspaces the sidebar shows", async () => {
    const collector = createSidebarSessionCollector();
    const view = await pollSidebarSessions({
      collector,
      workspaceIds: ["ws-1", "ws-2"],
      fetchHostWide: async () => ({ ok: false }),
      fetchScoped: async (id) => ({
        ok: true,
        sessions: [session(`${id}-session`, id)],
      }),
    });
    expect(view.degraded).toBe(true);
    expect(view.sessions.map((row) => row.id).sort()).toEqual([
      "ws-1-session",
      "ws-2-session",
    ]);
    // The next poll answers host-wide again the moment the daemon can.
    const recovered = await pollSidebarSessions({
      collector,
      workspaceIds: ["ws-1", "ws-2"],
      fetchHostWide: async () => ({ ok: true, sessions: [session("fresh", "ws-1")] }),
      fetchScoped: async () => ({ ok: false }),
    });
    expect(recovered.degraded).toBe(false);
    expect(recovered.sessions.map((row) => row.id)).toEqual(["fresh"]);
  });

});

describe("observation freshness provenance (R3)", () => {
  test("a host-wide success marks every delivered row fresh", () => {
    const collector = createSidebarSessionCollector();
    const rows = [session("a", "ws-1"), session("b", "ws-2")];
    collector.noteHostWide(rows);
    const view = collector.view();
    expect(view.degraded).toBe(false);
    expect(view.freshKeys).toEqual(new Set(rows.map(observationKeyOf)));
  });

  test("a degraded poll marks only the workspaces it actually read fresh", async () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWide([session("target", "ws-1"), session("other", "ws-2")]);
    const view = await pollSidebarSessions({
      collector,
      workspaceIds: ["ws-1", "ws-2"],
      fetchHostWide: async () => ({ ok: false }),
      // The target's read fails; the other workspace progresses.
      fetchScoped: async (id) =>
        id === "ws-2"
          ? { ok: true, sessions: [session("other", "ws-2"), session("other-new", "ws-2")] }
          : { ok: false },
    });
    expect(view.degraded).toBe(true);
    // The retained target row still renders (no blanking) but is NOT fresh.
    expect(view.sessions.map((row) => row.id).sort()).toEqual([
      "other",
      "other-new",
      "target",
    ]);
    expect(view.freshKeys.has(observationKeyOf(session("other-new", "ws-2")))).toBe(true);
    expect(view.freshKeys.has(observationKeyOf(session("target", "ws-1")))).toBe(false);
  });

  test("the next degraded poll resets freshness to what it read", async () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    collector.noteScoped("ws-1", [session("one", "ws-1")]);
    expect(collector.view().freshKeys.has(observationKeyOf(session("one", "ws-1")))).toBe(
      true,
    );
    collector.noteHostWideFailure();
    collector.noteScoped("ws-2", [session("two", "ws-2")]);
    const fresh = collector.view().freshKeys;
    expect(fresh.has(observationKeyOf(session("two", "ws-2")))).toBe(true);
    expect(fresh.has(observationKeyOf(session("one", "ws-1")))).toBe(false);
  });

  test("recovering host-wide replaces the fresh set with the full truth", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWideFailure();
    collector.noteScoped("ws-1", [session("one", "ws-1")]);
    collector.noteHostWide([session("fresh", "ws-2")]);
    expect(collector.view().freshKeys).toEqual(
      new Set([observationKeyOf(session("fresh", "ws-2"))]),
    );
  });

  test("fresh keys are exact host+id+incarnation matches", () => {
    const collector = createSidebarSessionCollector();
    collector.noteHostWide([session("a", "ws-1")]);
    const staleIncarnation = { ...session("a", "ws-1"), incarnation: "2" };
    expect(collector.view().freshKeys.has(observationKeyOf(staleIncarnation))).toBe(false);
  });
});

describe("one sidebar poll", () => {
  test("one workspace's failure keeps its own last list, not a blank card", async () => {
    const collector = createSidebarSessionCollector();
    let wsTwoFails = false;
    const poll = () =>
      pollSidebarSessions({
        collector,
        workspaceIds: ["ws-1", "ws-2"],
        fetchHostWide: async () => ({ ok: false }),
        fetchScoped: async (id) => {
          if (id === "ws-2" && wsTwoFails) return { ok: false };
          return { ok: true, sessions: [session(`${id}-session`, id)] };
        },
      });
    await poll();
    wsTwoFails = true;
    const view = await poll();
    expect(view.sessions.map((row) => row.id).sort()).toEqual([
      "ws-1-session",
      "ws-2-session",
    ]);
  });
});
