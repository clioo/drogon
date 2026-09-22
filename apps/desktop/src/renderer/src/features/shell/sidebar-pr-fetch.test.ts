import { describe, expect, test } from "vitest";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { ProjectGroup } from "./project-adapter";
import {
  mergeSidebarLinkedPrResults,
  mergeSidebarPrResults,
  pruneSidebarPrCache,
  selectSidebarLinkedPrLookups,
  selectSidebarPrFetchIds,
  SIDEBAR_PULLS_PER_PAGE,
  sidebarPrFetchSignature,
  sidebarPrProjectIds,
  sortSidebarPullsBestFirst,
} from "./sidebar-pr-fetch";

function pull(overrides: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    number: 1,
    title: "Add the thing",
    state: "open",
    labels: [],
    assignees: [],
    isDraft: false,
    headRefName: "feature",
    updatedAt: "2026-09-09T00:00:00Z",
    url: "https://github.com/example/repo/pull/1",
    ...overrides,
  };
}

function group(
  projectId: string,
  kind: "git" | "folder",
  branches: string[],
): ProjectGroup {
  return {
    project: {
      id: projectId,
      hostId: "host-1",
      path: `/repo/${projectId}`,
      name: projectId,
      kind,
      defaultBaseRef: null,
    },
    worktrees: branches.map((branch, index) => ({
      id: `wt-${projectId}-${index}`,
      projectId,
      workspaceId: `ws-${projectId}-${index}`,
      path: `/repo/${projectId}/wt-${index}`,
      branch,
      head: "abc",
      baseRef: null,
      createdAt: "2026-09-09T00:00:00Z",
    })),
  };
}

describe("sidebar PR fetch planning", () => {
  test("the bounded page covers more than the provider default window", () => {
    expect(SIDEBAR_PULLS_PER_PAGE).toBeGreaterThan(36);
  });

  test("splits git projects (queried) from folder projects (seeded, never queried)", () => {
    const ids = sidebarPrProjectIds([group("a", "git", ["x"]), group("b", "folder", [""])]);
    expect(ids).toEqual({ git: ["a"], folder: ["b"] });
  });

  test("fetches never-attempted projects once, never refetching a recorded entry for the same set", () => {
    const cache = new Map([["a", [pull()]], ["b", null]]);
    // Same project set: nothing to do — the failure waits for a set change.
    expect(selectSidebarPrFetchIds(cache, ["a", "b"], false)).toEqual([]);
    // A new project joins: it is fetched, and the old failure gets one retry.
    expect(selectSidebarPrFetchIds(cache, ["a", "b", "c"], true)).toEqual(["b", "c"]);
  });

  test("a changed set signature is stable regardless of group order", () => {
    expect(sidebarPrFetchSignature(["b", "a"])).toBe(sidebarPrFetchSignature(["a", "b"]));
    expect(sidebarPrFetchSignature(["a"])).not.toBe(sidebarPrFetchSignature(["a", "b"]));
  });
});

describe("sidebar PR result merging", () => {
  test("success stores best-first: live before concluded, newest first", () => {
    const merged = mergeSidebarPrResults(
      new Map(),
      [
        [
          "a",
          [
            pull({ number: 641, state: "merged" }),
            pull({ number: 640, state: "closed" }),
            pull({ number: 642, state: "open" }),
          ],
        ],
      ],
    );
    expect(merged.get("a")?.map((item) => item.number)).toEqual([642, 641, 640]);
  });

  test("best-first storage agrees with the card picker on the first match", () => {
    const stored = sortSidebarPullsBestFirst([
      pull({ number: 641, state: "merged", headRefName: "w" }),
      pull({ number: 642, state: "open", headRefName: "w" }),
    ]);
    // The shared grouping helper takes the first headRefName match; the
    // card takes the deterministic best pick. Both must name #642.
    expect(stored.find((item) => item.headRefName === "w")?.number).toBe(642);
  });

  test("a later failure keeps the last good listing; a first failure records null", () => {
    const good = new Map([["a", [pull()]]]);
    expect(mergeSidebarPrResults(good, [["a", null]]).get("a")).toEqual([pull()]);
    const failed = mergeSidebarPrResults(new Map(), [["a", null]]);
    expect(failed.get("a")).toBeNull();
  });

  test("prunes removed projects and returns the same reference when nothing leaves", () => {
    const cache = new Map<string, readonly TaskPullRequest[] | null>([
      ["a", []],
      ["gone", []],
    ]);
    const pruned = pruneSidebarPrCache(cache, new Set(["a"]));
    expect([...pruned.keys()]).toEqual(["a"]);
    expect(pruneSidebarPrCache(cache, new Set(["a", "gone"]))).toBe(cache);
  });
});

describe("sidebar linked-PR fallback", () => {
  test("a stored link with no branch match queues one targeted lookup", () => {
    const groups: ProjectGroup[] = [
      {
        ...group("a", "git", ["feature"]),
        worktrees: [
          {
            id: "wt-1",
            projectId: "a",
            workspaceId: "ws-1",
            path: "/repo/a/wt-1",
            branch: "feature",
            head: "abc",
            baseRef: null,
            createdAt: "2026-09-09T00:00:00Z",
            linkedPr: 99,
          },
        ],
      },
    ];
    const cache = new Map([["a", [pull({ headRefName: "other" })]]]);
    expect(selectSidebarLinkedPrLookups(groups, cache, new Set())).toEqual([
      { projectId: "a", number: 99 },
    ]);
  });

  test("skips lookups already attempted, already listed, branch-matched, or on failed listings", () => {
    const linked = {
      id: "wt-1",
      projectId: "a",
      workspaceId: "ws-1",
      path: "/repo/a/wt-1",
      branch: "feature",
      head: "abc",
      baseRef: null,
      createdAt: "2026-09-09T00:00:00Z",
      linkedPr: 7,
    };
    const groups: ProjectGroup[] = [
      { ...group("a", "git", []), worktrees: [linked] },
    ];
    const listed = new Map([["a", [pull({ number: 7, headRefName: "elsewhere" })]]]);
    // Number present: no lookup (the card's number fallback already applies).
    expect(selectSidebarLinkedPrLookups(groups, listed, new Set())).toEqual([]);
    // Number attempted before: never guessed twice.
    const unlisted = new Map([["a", [pull({ headRefName: "elsewhere" })]]]);
    expect(selectSidebarLinkedPrLookups(groups, unlisted, new Set([7]))).toEqual([]);
    // Branch matched: the branch correlation already names a review.
    const matched = new Map([["a", [pull({ headRefName: "feature" })]]]);
    expect(selectSidebarLinkedPrLookups(groups, matched, new Set())).toEqual([]);
    // Listing failed or never fetched: nothing to call a miss.
    expect(selectSidebarLinkedPrLookups(groups, new Map([["a", null]]), new Set())).toEqual([]);
    expect(selectSidebarLinkedPrLookups(groups, new Map(), new Set())).toEqual([]);
  });

  test("merges a looked-up review into its project without inventing others", () => {
    const cache = new Map<string, readonly TaskPullRequest[] | null>([
      ["a", [pull({ number: 1, headRefName: "feature" })]],
    ]);
    const merged = mergeSidebarLinkedPrResults(cache, [
      { projectId: "a", pull: pull({ number: 99, state: "open", headRefName: "renamed" }) },
      { projectId: "missing", pull: pull({ number: 100 }) },
      { projectId: "a", pull: null },
    ]);
    expect(merged.get("a")?.map((item) => item.number).sort()).toEqual([1, 99]);
    expect(merged.has("missing")).toBe(false);
  });
});
