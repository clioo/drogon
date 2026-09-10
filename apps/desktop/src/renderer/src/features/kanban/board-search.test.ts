// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's src/renderer/src/components/sidebar/
   workspace-kanban-search.test.ts at pinned source c9790628
   (clioo/drogon-orca), adapted to Drogon's KanbanWorktree/Project fixtures.
   The PR/issue/port exclusion case shrinks accordingly: a Drogon row carries
   no linked PR/issue/port evidence at all, so the case pins that only the
   board fields (name/branch/repo/host/comment) can match. */
import { describe, expect, it } from "vitest";
import type { Project } from "../../../../shared/session-contract";
import { WORKTREE_PALETTE_QUERY_MAX_BYTES } from "./worktree-palette-query-bounds";
import { getWorktreeHostIdentity } from "./host-identity";
import {
  buildWorkspaceKanbanLaneViews,
  matchWorkspaceBoardWorktrees,
} from "./board-search";
import { worktree } from "./test-fixtures";

const projectById = new Map<string, Project>([
  [
    "proj-a",
    {
      id: "proj-a",
      hostId: "local",
      path: "/tmp/proj-a",
      name: "orca",
      kind: "git",
      defaultBaseRef: "main",
    },
  ],
  [
    "proj-b",
    {
      id: "proj-b",
      hostId: "local",
      path: "/tmp/proj-b",
      name: "atlas",
      kind: "git",
      defaultBaseRef: "main",
    },
  ],
]);

function match(
  worktrees: ReturnType<typeof worktree>[],
  query: string,
): ReadonlySet<string> | null {
  return matchWorkspaceBoardWorktrees({ worktrees, query, projectById });
}

function identities(...worktrees: ReturnType<typeof worktree>[]): Set<string> {
  return new Set(worktrees.map(getWorktreeHostIdentity));
}

describe("matchWorkspaceBoardWorktrees", () => {
  it("treats blank and whitespace-only queries as no filtering", () => {
    const worktrees = [worktree("a")];
    expect(match(worktrees, "")).toBeNull();
    expect(match(worktrees, "   ")).toBeNull();
  });

  it("matches display name, branch, and project name", () => {
    const worktrees = [
      worktree("name", { displayName: "Search field" }),
      worktree("branch", {
        displayName: "Other",
        branch: "refs/heads/feat/search-lane",
      }),
      worktree("repo", { displayName: "Other", projectId: "proj-b" }),
      worktree("miss", { displayName: "Other" }),
    ];

    expect(match(worktrees, "search")).toEqual(
      identities(worktrees[0]!, worktrees[1]!),
    );
    expect(match(worktrees, "atlas")).toEqual(identities(worktrees[2]!));
  });

  it("matches the workspace comment", () => {
    const worktrees = [
      worktree("commented", {
        displayName: "Other",
        comment: "blocked on review",
      }),
      worktree("miss", { displayName: "Other" }),
    ];

    expect(match(worktrees, "blocked")).toEqual(identities(worktrees[0]!));
  });

  it("only reads board-printed fields (board evidence policy)", () => {
    // Why the board policy (#15170): a card may only be hidden by text printed
    // on it. A Drogon row carries no PR/issue/port evidence, and its id/path
    // internals must not widen the match either.
    const worktrees = [
      worktree("internal", {
        displayName: "Other",
        branch: "main",
      }),
    ];

    expect(match(worktrees, "internal")).toEqual(new Set());
    expect(match(worktrees, "tmp")).toEqual(new Set());
  });

  it("matches composite repo/branch queries", () => {
    const worktrees = [
      worktree("hit", {
        displayName: "Other",
        projectId: "proj-a",
        branch: "main",
      }),
      worktree("wrong-repo", {
        displayName: "Other",
        projectId: "proj-b",
        branch: "main",
      }),
    ];

    expect(match(worktrees, "orca/main")).toEqual(identities(worktrees[0]!));
  });

  it("is case-insensitive", () => {
    const worktrees = [worktree("a", { displayName: "Search Field" })];

    expect(match(worktrees, "SEARCH")).toEqual(identities(worktrees[0]!));
  });

  it("treats regex metacharacters as literal text", () => {
    // Why: matching is indexOf, never RegExp. This pins that, so swapping in a
    // regex later fails here instead of silently changing what users can search.
    const worktrees = [
      worktree("literal", { displayName: "feat.*fix" }),
      worktree("would-match-as-regex", { displayName: "featANYfix" }),
    ];

    expect(match(worktrees, "feat.*fix")).toEqual(identities(worktrees[0]!));
    expect(match(worktrees, "(")).toEqual(new Set());
  });

  it("matches non-ASCII display names and comments", () => {
    const worktrees = [
      worktree("cjk", { displayName: "検索フィールド" }),
      worktree("accent", { displayName: "Other", comment: "Añadir búsqueda" }),
      worktree("miss", { displayName: "Other" }),
    ];

    expect(match(worktrees, "フィールド")).toEqual(identities(worktrees[0]!));
    expect(match(worktrees, "BÚSQUEDA")).toEqual(identities(worktrees[1]!));
  });

  it("treats an over-bound query as no filtering rather than zero matches", () => {
    const worktrees = [worktree("a", { displayName: "Search field" })];

    expect(
      match(worktrees, "x".repeat(WORKTREE_PALETTE_QUERY_MAX_BYTES + 1)),
    ).toBeNull();
  });

  // STA-4343 closed: the documents map is keyed by host identity, so two workspaces sharing
  // an id across hosts each keep their own searchable document.
  it("separates two same-id host rows", () => {
    const local = worktree("shared", { branch: "refs/heads/local-only" });
    const remote = worktree("shared", {
      hostId: "ssh:box",
      branch: "refs/heads/remote-only",
    });

    // Each row matches on its OWN branch, and neither match leaks to the other host.
    expect(match([local, remote], "local-only")).toEqual(identities(local));
    expect(match([local, remote], "remote-only")).toEqual(identities(remote));
    expect(match([local], "local-only")).toEqual(identities(local));
  });

  it("does not match an empty display name on the host segment for local rows", () => {
    // Why conditional (source): the host chip only renders for remote hosts, so a
    // local row must not become findable by typing its host id.
    const worktrees = [worktree("a", { hostId: "local" })];

    expect(match(worktrees, "local")).toEqual(new Set());
  });
});

describe("buildWorkspaceKanbanLaneViews", () => {
  const todo = [
    worktree("todo-a", { displayName: "Alpha" }),
    worktree("todo-b"),
  ];
  const doing = [worktree("doing-a", { displayName: "Alpha" })];
  const worktreesByStatus = new Map([
    ["todo", todo],
    ["doing", doing],
  ]);

  it("reuses the input arrays when no query is active", () => {
    const views = buildWorkspaceKanbanLaneViews({
      worktreesByStatus,
      matchingWorktreeIds: null,
    });

    expect(views.get("todo")?.items).toBe(todo);
    expect(views.get("doing")?.items).toBe(doing);
    expect(views.get("todo")?.totalCount).toBe(2);
  });

  it("preserves lane order and per-lane sort order", () => {
    const views = buildWorkspaceKanbanLaneViews({
      worktreesByStatus,
      matchingWorktreeIds: identities(...todo, ...doing),
    });

    expect(Array.from(views.keys())).toEqual(["todo", "doing"]);
    expect(views.get("todo")?.items.map((item) => item.id)).toEqual([
      "todo-a",
      "todo-b",
    ]);
  });

  it("keeps a fully filtered lane with an empty item list and its real total", () => {
    const views = buildWorkspaceKanbanLaneViews({
      worktreesByStatus,
      matchingWorktreeIds: identities(doing[0]!),
    });

    expect(views.get("todo")).toEqual({ items: [], totalCount: 2 });
    expect(views.get("doing")?.items.map((item) => item.id)).toEqual([
      "doing-a",
    ]);
  });
});
