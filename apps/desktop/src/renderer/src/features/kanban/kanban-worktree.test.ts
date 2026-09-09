// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Tests for the Drogon data-layer adapter (buildKanbanWorktrees) that feeds
   the ported kanban primitives. Pins the required slice behaviors: folder
   projects without Git, host identity from Project/Workspace, retained
   controlled order/status, and same-id rows across hosts. */
import { describe, expect, it } from "vitest";
import type {
  Project,
  Worktree as DrogonWorktree,
  Workspace,
} from "../../../../shared/session-contract";
import { getWorktreeHostIdentity } from "./host-identity";
import {
  buildKanbanWorktrees,
  resolveWorktreeDisplayName,
} from "./kanban-worktree";
import { groupWorkspaceKanbanWorktrees } from "./worktree-groups";
import { drogonWorktree } from "./test-fixtures";

const project: Project = {
  id: "proj",
  hostId: "local",
  path: "/tmp/proj",
  name: "proj",
  kind: "git",
  defaultBaseRef: "main",
};

const folderProject: Project = {
  id: "folder",
  hostId: "local",
  path: "/tmp/plain-folder",
  name: "plain-folder",
  // A folder project has no Git; its implicit worktree is the folder itself.
  kind: "folder",
  defaultBaseRef: null,
};

const workspace: Workspace = {
  id: "ws",
  path: "/tmp/proj",
  name: "proj",
  kind: "git",
  hostId: "local",
};
const folderWorkspace: Workspace = {
  id: "ws-folder",
  path: "/tmp/plain-folder",
  name: "plain-folder",
  kind: "folder",
  hostId: "local",
};

function build(
  worktrees: DrogonWorktree[],
  input: Partial<Parameters<typeof buildKanbanWorktrees>[0]> = {},
) {
  return buildKanbanWorktrees({
    worktrees,
    projectById: new Map([
      ["proj", project],
      ["folder", folderProject],
    ]),
    workspaceById: new Map([
      ["ws", workspace],
      ["ws-folder", folderWorkspace],
    ]),
    ...input,
  });
}

describe("buildKanbanWorktrees", () => {
  it("carries the host from the owning project and keys status/order by host identity", () => {
    const rows = build([drogonWorktree({ id: "w1" })], {
      statusByIdentity: new Map([["local|w1", "todo"]]),
      manualOrderByIdentity: new Map([["local|w1", 500]]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.hostId).toBe("local");
    expect(getWorktreeHostIdentity(rows[0]!)).toBe("local|w1");
    expect(rows[0]?.workspaceStatus).toBe("todo");
    expect(rows[0]?.manualOrder).toBe(500);
    // Display name falls back to the branch basename; note becomes the search comment.
    expect(rows[0]?.displayName).toBe("w1");
    expect(rows[0]?.comment).toBe("");
  });

  it("renders folder projects without Git as board cards", () => {
    const rows = build([
      drogonWorktree({
        id: "folder::/tmp/plain-folder",
        projectId: "folder",
        workspaceId: "ws-folder",
        branch: "",
        head: "",
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe("plain-folder");
    expect(rows[0]?.hostId).toBe("local");
    expect(rows[0]?.workspaceStatus).toBeNull();
  });

  it("uses the renamed title, never the branch, for the card name", () => {
    const rows = build([
      drogonWorktree({ id: "w1", title: "My card", branch: "feat/x" }),
    ]);
    expect(rows[0]?.displayName).toBe("My card");
    // Source fallback order: custom name -> branch label (refs/heads stripped,
    // slashes kept) -> path basename (trailing separators ignored).
    expect(
      resolveWorktreeDisplayName({
        title: "  ",
        branch: "feat/x",
        path: "/tmp/y",
      }),
    ).toBe("feat/x");
    expect(
      resolveWorktreeDisplayName({
        title: null,
        branch: null,
        path: "/tmp/dir/",
      }),
    ).toBe("dir");
  });

  it("keeps the note as the comment evidence field", () => {
    const rows = build([
      drogonWorktree({ id: "w1", note: "blocked on review" }),
    ]);
    expect(rows[0]?.comment).toBe("blocked on review");
  });

  it("keeps same-id rows on two hosts distinct in grouping", () => {
    const localRow = build([drogonWorktree({ id: "shared" })])[0]!;
    const remoteRow = buildKanbanWorktrees({
      worktrees: [drogonWorktree({ id: "shared" })],
      projectById: new Map([
        ["proj", { ...project, hostId: "ssh:box" }],
        ["folder", folderProject],
      ]),
      workspaceById: new Map([["ws", { ...workspace, hostId: "ssh:box" }]]),
    })[0]!;
    expect(getWorktreeHostIdentity(localRow)).toBe("local|shared");
    expect(getWorktreeHostIdentity(remoteRow)).toBe("ssh%3Abox|shared");

    // The controlled status map keys by identity: only the local row is assigned.
    const assigned = buildKanbanWorktrees({
      worktrees: [drogonWorktree({ id: "shared" })],
      projectById: new Map([["proj", project]]),
      workspaceById: new Map([["ws", workspace]]),
      statusByIdentity: new Map([["local|shared", "todo"]]),
    })[0]!;
    expect(assigned.workspaceStatus).toBe("todo");

    const assignedLocal = { ...localRow, workspaceStatus: "todo" as const };
    const all = [assignedLocal, remoteRow];
    const grouped = groupWorkspaceKanbanWorktrees({
      worktrees: all,
      visibleWorktreeIds: new Set(all.map(getWorktreeHostIdentity)),
      workspaceStatuses: [
        { id: "todo", label: "Todo" },
        { id: "in-progress", label: "In progress" },
      ],
      sortBy: "recent",
    });
    // Two distinct cards: the assigned local row in todo, the remote in the default lane.
    expect(
      grouped.get("todo")?.map((row) => getWorktreeHostIdentity(row)),
    ).toEqual(["local|shared"]);
    expect(
      grouped.get("in-progress")?.map((row) => getWorktreeHostIdentity(row)),
    ).toEqual(["ssh%3Abox|shared"]);
  });

  it("retains controlled order across adapter reruns", () => {
    const worktrees = [
      drogonWorktree({ id: "a" }),
      drogonWorktree({ id: "b" }),
      drogonWorktree({ id: "c" }),
    ];
    const orderByIdentity = new Map([
      ["local|a", 100],
      ["local|b", 300],
      ["local|c", 200],
    ]);

    const first = build(worktrees, { manualOrderByIdentity: orderByIdentity });
    const second = build(worktrees, { manualOrderByIdentity: orderByIdentity });

    const groupedFirst = groupWorkspaceKanbanWorktrees({
      worktrees: first,
      visibleWorktreeIds: new Set(first.map(getWorktreeHostIdentity)),
      workspaceStatuses: [{ id: "todo", label: "Todo" }],
      sortBy: "manual",
    });
    expect(groupedFirst.get("todo")?.map((row) => row.id)).toEqual([
      "b",
      "c",
      "a",
    ]);

    // A second adapter run (rerender/new poll) reproduces the same order.
    const groupedSecond = groupWorkspaceKanbanWorktrees({
      worktrees: second,
      visibleWorktreeIds: new Set(second.map(getWorktreeHostIdentity)),
      workspaceStatuses: [{ id: "todo", label: "Todo" }],
      sortBy: "manual",
    });
    expect(groupedSecond.get("todo")?.map((row) => row.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});
