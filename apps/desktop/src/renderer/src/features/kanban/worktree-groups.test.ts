// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's src/renderer/src/components/sidebar/
   workspace-kanban-worktree-groups.test.ts at pinned source c9790628
   (clioo/drogon-orca), adapted to Drogon's KanbanWorktree fixtures. The
   pinned-status and non-manual ordering cases reflect the documented data
   adaptation (no isPinned/lastActivityAt on a Drogon row): non-manual order
   is the source's display-name tie-break. */
import { describe, expect, it } from "vitest";
import { groupWorkspaceKanbanWorktrees } from "./worktree-groups";
import { getWorktreeHostIdentity } from "./host-identity";
import { worktree } from "./test-fixtures";

const statuses = [
  { id: "todo", label: "Todo" },
  { id: "doing", label: "Doing" },
];

function visibleIdentities(
  worktrees: readonly ReturnType<typeof worktree>[],
): Set<string> {
  return new Set(worktrees.map(getWorktreeHostIdentity));
}

describe("groupWorkspaceKanbanWorktrees", () => {
  it("uses manualOrder inside lanes when Manual sort is active", () => {
    const worktrees = [
      worktree("a", { workspaceStatus: "doing", manualOrder: 100 }),
      worktree("b", { workspaceStatus: "doing", manualOrder: 300 }),
      worktree("c", { workspaceStatus: "doing", manualOrder: 200 }),
    ];
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees,
      visibleWorktreeIds: visibleIdentities(worktrees),
      workspaceStatuses: statuses,
      sortBy: "manual",
    });

    expect(grouped.get("doing")?.map((item) => item.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("does not crash when a worktree is missing its displayName under Manual sort", () => {
    const a = {
      ...worktree("a", { workspaceStatus: "doing", manualOrder: 100 }),
    };
    const b = {
      ...worktree("b", { workspaceStatus: "doing", manualOrder: 100 }),
    };
    // Repro for crash 99657ab1: a worktree reached the sidebar with an
    // undefined displayName, so `a.displayName.localeCompare(...)` threw
    // `Cannot read properties of undefined (reading 'localeCompare')`.
    (a as { displayName?: string }).displayName = undefined;
    (b as { displayName?: string }).displayName = undefined;
    const worktrees = [a, b];
    expect(() =>
      groupWorkspaceKanbanWorktrees({
        worktrees,
        visibleWorktreeIds: visibleIdentities(worktrees),
        workspaceStatuses: statuses,
        sortBy: "manual",
      }),
    ).not.toThrow();
  });

  it("buckets unassigned worktrees into the default lane", () => {
    const worktrees = [
      worktree("a"),
      worktree("b", { workspaceStatus: "todo" }),
    ];
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees,
      visibleWorktreeIds: visibleIdentities(worktrees),
      workspaceStatuses: statuses,
      sortBy: "recent",
    });

    // Source getDefaultWorkspaceStatusId: "in-progress" when present, else the
    // first lane. These fixtures have no in-progress, so unassigned lands on todo.
    expect(grouped.get("todo")?.map((item) => item.id)).toEqual(["a", "b"]);
    expect(grouped.get("doing")).toEqual([]);
  });

  it("buckets unassigned worktrees into in-progress when the default lane exists", () => {
    const worktrees = [worktree("a")];
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees,
      visibleWorktreeIds: visibleIdentities(worktrees),
      workspaceStatuses: [
        { id: "todo", label: "Todo" },
        { id: "in-progress", label: "In progress" },
      ],
      sortBy: "recent",
    });

    expect(grouped.get("in-progress")?.map((item) => item.id)).toEqual(["a"]);
    expect(grouped.get("todo")).toEqual([]);
  });

  it("skips worktrees that are not visible", () => {
    const worktrees = [worktree("a", { workspaceStatus: "todo" })];
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees,
      visibleWorktreeIds: new Set(["local|other"]),
      workspaceStatuses: statuses,
      sortBy: "recent",
    });

    expect(grouped.get("todo")).toEqual([]);
  });

  it("groups by host identity: same id on two hosts lands in both lanes", () => {
    const local = worktree("shared", { workspaceStatus: "todo" });
    const remote = worktree("shared", {
      hostId: "ssh:host-b",
      workspaceStatus: "doing",
    });
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees: [local, remote],
      visibleWorktreeIds: new Set([
        getWorktreeHostIdentity(local),
        getWorktreeHostIdentity(remote),
      ]),
      workspaceStatuses: statuses,
      sortBy: "recent",
    });

    expect(grouped.get("todo")?.map((item) => item.id)).toEqual(["shared"]);
    expect(grouped.get("doing")?.map((item) => item.id)).toEqual(["shared"]);
  });

  it("creates an entry for every status even when empty", () => {
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees: [],
      visibleWorktreeIds: new Set(),
      workspaceStatuses: statuses,
      sortBy: "recent",
    });

    expect([...grouped.keys()]).toEqual(["todo", "doing"]);
    expect(grouped.get("todo")).toEqual([]);
  });

  it("falls back to display-name order in the non-manual sort", () => {
    const worktrees = [
      worktree("c", { title: "Charlie", workspaceStatus: "todo" }),
      worktree("a", { title: "Alpha", workspaceStatus: "todo" }),
      worktree("b", { title: "Bravo", workspaceStatus: "todo" }),
    ];
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees,
      visibleWorktreeIds: visibleIdentities(worktrees),
      workspaceStatuses: statuses,
      sortBy: "recent",
    });

    expect(grouped.get("todo")?.map((item) => item.displayName)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });
});
