import { describe, expect, test } from "vitest";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { ProjectGroup } from "./project-adapter";
import {
  mergeSidebarLinkedPrResults,
  mergeSidebarPrPageResults,
  mergeSidebarPrResults,
  mergeSidebarPrRevalidation,
  pruneSidebarLinkedPrAttempts,
  pruneSidebarPrCache,
  pruneSidebarPrFreshness,
  recordSidebarPrFetchOutcome,
  selectSidebarLinkedPrLookups,
  selectSidebarPrDueIds,
  selectSidebarPrFetchIds,
  selectStaleSidebarPrProjects,
  SIDEBAR_PULLS_FULL_WALK_MS,
  SIDEBAR_PULLS_MAX_PAGES,
  SIDEBAR_PULLS_PER_PAGE,
  SIDEBAR_PULLS_REFRESH_MS,
  sidebarLinkedPrAttemptKey,
  sidebarPrBranchCoverage,
  sidebarPrFetchSignature,
  sidebarPrNextWakeDelayMs,
  sidebarProjectHasUnresolvedBranches,
  sidebarProjectHasUnresolvedLiveBranches,
  sidebarPrProjectIds,
  sidebarPullsRefreshIsShallow,
  sidebarPullsRetryDelayMs,
  sidebarPullsWalkErrorOutcome,
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

  test("the same number in two projects queues two lookups (per-project attempts)", () => {
    const linked = (projectId: string) => ({
      id: `wt-${projectId}`,
      projectId,
      workspaceId: `ws-${projectId}`,
      path: `/repo/${projectId}/wt`,
      branch: "feature",
      head: "abc",
      baseRef: null,
      createdAt: "2026-09-09T00:00:00Z",
      linkedPr: 1,
    });
    const groups: ProjectGroup[] = [
      { ...group("repo-a", "git", []), worktrees: [linked("repo-a")] },
      { ...group("repo-b", "git", []), worktrees: [linked("repo-b")] },
    ];
    const cache = new Map([
      ["repo-a", [pull({ number: 2, headRefName: "elsewhere" })]],
      ["repo-b", [pull({ number: 2, headRefName: "elsewhere" })]],
    ]);
    // An attempt for PR #1 in repo A must not suppress PR #1 in repo B.
    const attempted = new Set([sidebarLinkedPrAttemptKey("repo-a", 1)]);
    expect(selectSidebarLinkedPrLookups(groups, cache, attempted)).toEqual([
      { projectId: "repo-b", number: 1 },
    ]);
    // With neither attempted, both queue (dedupe is per project + number).
    expect(selectSidebarLinkedPrLookups(groups, cache, new Set())).toEqual([
      { projectId: "repo-a", number: 1 },
      { projectId: "repo-b", number: 1 },
    ]);
  });

  test("removing a worktree releases its attempt key so a re-add retries", () => {
    const attempted = new Set([
      sidebarLinkedPrAttemptKey("a", 7),
      sidebarLinkedPrAttemptKey("a", 8),
    ]);
    const groups: ProjectGroup[] = [
      {
        ...group("a", "git", []),
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
            linkedPr: 7,
          },
        ],
      },
    ];
    // Only the still-named link survives; the removed worktree's key drops.
    expect(pruneSidebarLinkedPrAttempts(attempted, groups)).toEqual(
      new Set([sidebarLinkedPrAttemptKey("a", 7)]),
    );
    // Nothing leaves: the same reference comes back.
    const all = new Set([sidebarLinkedPrAttemptKey("a", 7)]);
    expect(pruneSidebarLinkedPrAttempts(all, groups)).toBe(all);
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
    // Number attempted before for this project: never guessed twice.
    const unlisted = new Map([["a", [pull({ headRefName: "elsewhere" })]]]);
    expect(
      selectSidebarLinkedPrLookups(groups, unlisted, new Set([sidebarLinkedPrAttemptKey("a", 7)])),
    ).toEqual([]);
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

describe("sidebar PR refresh policy", () => {
  const NOW = 1_000_000;

  function due(
    cache: Map<string, readonly TaskPullRequest[] | null>,
    gitIds: string[],
    freshness: Map<string, { fetchedAt: number | null; failures: number; failedAt: number | null }>,
    nowMs: number,
    signatureChanged = false,
  ) {
    return selectSidebarPrDueIds({ cache, gitIds, freshness, nowMs, signatureChanged });
  }

  test("backoff doubles per consecutive failure, capped", () => {
    expect(sidebarPullsRetryDelayMs(1)).toBe(15_000);
    expect(sidebarPullsRetryDelayMs(2)).toBe(30_000);
    expect(sidebarPullsRetryDelayMs(3)).toBe(60_000);
    expect(sidebarPullsRetryDelayMs(100)).toBe(300_000);
  });

  test("success confirms and clears the streak; failure extends it", () => {
    const confirmed = recordSidebarPrFetchOutcome(undefined, true, NOW);
    expect(confirmed).toEqual({ fetchedAt: NOW, failures: 0, failedAt: null });
    const failed = recordSidebarPrFetchOutcome(confirmed, false, NOW + 1);
    expect(failed).toEqual({ fetchedAt: NOW, failures: 1, failedAt: NOW + 1 });
    const recovered = recordSidebarPrFetchOutcome(failed, true, NOW + 2);
    expect(recovered).toEqual({ fetchedAt: NOW + 2, failures: 0, failedAt: null });
  });

  test("stable set: fresh listings are not due, stale ones are", () => {
    const cache = new Map<string, readonly TaskPullRequest[] | null>([["a", [pull()]]]);
    const fresh = new Map([["a", { fetchedAt: NOW, failures: 0, failedAt: null }]]);
    expect(due(cache, ["a"], fresh, NOW + 1_000)).toEqual([]);
    // A listing confirmed long ago revalidates without any set change.
    expect(due(cache, ["a"], fresh, NOW + SIDEBAR_PULLS_REFRESH_MS)).toEqual(["a"]);
    // Never-attempted projects are always due.
    expect(due(cache, ["a", "b"], fresh, NOW + 1_000)).toEqual(["b"]);
  });

  test("stable set: a failed refresh retries on backoff, not per render", () => {
    const cache = new Map<string, readonly TaskPullRequest[] | null>([["a", [pull()]]]);
    const failed = new Map([["a", { fetchedAt: NOW, failures: 1, failedAt: NOW }]]);
    // Immediately after the failure: no retry (never per render).
    expect(due(cache, ["a"], failed, NOW + 1_000)).toEqual([]);
    // After the first backoff (15s): due again on the same set.
    expect(due(cache, ["a"], failed, NOW + 15_000)).toEqual(["a"]);
  });

  test("a failed refresh of a stale listing backs off instead of looping", () => {
    // The confirmation predates the failure: without the streak gate the
    // listing would read stale forever and every run would refetch it.
    const cache = new Map<string, readonly TaskPullRequest[] | null>([["a", [pull()]]]);
    const failedStale = new Map([
      ["a", { fetchedAt: NOW - SIDEBAR_PULLS_REFRESH_MS, failures: 1, failedAt: NOW }],
    ]);
    expect(due(cache, ["a"], failedStale, NOW + 1_000)).toEqual([]);
    expect(due(cache, ["a"], failedStale, NOW + 15_000)).toEqual(["a"]);
    // A second consecutive failure doubles the wait.
    const failedTwice = new Map([
      ["a", { fetchedAt: NOW - SIDEBAR_PULLS_REFRESH_MS, failures: 2, failedAt: NOW }],
    ]);
    expect(due(cache, ["a"], failedTwice, NOW + 15_000)).toEqual([]);
    expect(due(cache, ["a"], failedTwice, NOW + 30_000)).toEqual(["a"]);
  });

  test("a failed project with nothing to show retries on set change or backoff", () => {
    const cache = new Map<string, readonly TaskPullRequest[] | null>([["a", null]]);
    const failed = new Map([["a", { fetchedAt: null, failures: 1, failedAt: NOW }]]);
    expect(due(cache, ["a"], failed, NOW + 1_000, false)).toEqual([]);
    expect(due(cache, ["a"], failed, NOW + 1_000, true)).toEqual(["a"]);
    expect(due(cache, ["a"], failed, NOW + 15_000, false)).toEqual(["a"]);
  });

  test("next wake sleeps until the nearest due moment", () => {
    const cache = new Map<string, readonly TaskPullRequest[] | null>([["a", [pull()]]]);
    const fresh = new Map([["a", { fetchedAt: NOW, failures: 0, failedAt: null }]]);
    const input = { cache, gitIds: ["a"], freshness: fresh, nowMs: NOW };
    expect(sidebarPrNextWakeDelayMs(input)).toBe(SIDEBAR_PULLS_REFRESH_MS);
    // In-flight projects never pull the wake earlier.
    expect(
      sidebarPrNextWakeDelayMs({ ...input, exclude: new Set(["a"]) }),
    ).toBe(SIDEBAR_PULLS_REFRESH_MS);
    // A failed refresh wakes on its backoff instead.
    const failed = new Map([["a", { fetchedAt: NOW - 50_000, failures: 1, failedAt: NOW }]]);
    expect(
      sidebarPrNextWakeDelayMs({ cache, gitIds: ["a"], freshness: failed, nowMs: NOW }),
    ).toBe(15_000);
  });

  test("only last-good listings behind a failed refresh read as stale", () => {
    const cache = new Map<string, readonly TaskPullRequest[] | null>([
      ["good-stale", [pull()]],
      ["good-fresh", [pull()]],
      ["failed", null],
    ]);
    const freshness = new Map([
      ["good-stale", { fetchedAt: NOW, failures: 1, failedAt: NOW + 1 }],
      ["good-fresh", { fetchedAt: NOW, failures: 0, failedAt: null }],
      ["failed", { fetchedAt: null, failures: 2, failedAt: NOW + 1 }],
    ]);
    // The failed entry shows nothing (unavailable), so only the project
    // still showing markers behind a failure is stale.
    expect(selectStaleSidebarPrProjects(cache, freshness)).toEqual(new Set(["good-stale"]));
  });

  test("health records prune with their projects", () => {
    const freshness = new Map([
      ["a", { fetchedAt: NOW, failures: 0, failedAt: null }],
      ["gone", { fetchedAt: NOW, failures: 0, failedAt: null }],
    ]);
    const pruned = pruneSidebarPrFreshness(freshness, new Set(["a"]));
    expect([...pruned.keys()]).toEqual(["a"]);
    expect(pruneSidebarPrFreshness(freshness, new Set(["a", "gone"]))).toBe(freshness);
  });
});

describe("sidebar PR pagination", () => {
  test("page walks stay within an explicit budget", () => {
    expect(SIDEBAR_PULLS_MAX_PAGES).toBeLessThanOrEqual(10);
    expect(SIDEBAR_PULLS_MAX_PAGES).toBeGreaterThan(1);
  });

  test("a walk continues only while visible branches stay unmatched", () => {
    const groups = [group("a", "git", ["late-branch", "done-branch"])];
    const page1 = [pull({ number: 1, headRefName: "done-branch" })];
    expect(sidebarProjectHasUnresolvedBranches(groups[0], page1)).toBe(true);
    const page2 = [...page1, pull({ number: 2, headRefName: "late-branch" })];
    expect(sidebarProjectHasUnresolvedBranches(groups[0], page2)).toBe(false);
    // A stored link never holds a walk open: its own show lookup covers it.
    const linked = {
      ...groups[0],
      worktrees: [
        {
          id: "wt-x",
          projectId: "a",
          workspaceId: "ws-x",
          path: "/repo/a/x",
          branch: "renamed",
          head: "abc",
          baseRef: null,
          createdAt: "2026-09-09T00:00:00Z",
          linkedPr: 99,
        },
      ],
    };
    expect(sidebarProjectHasUnresolvedBranches(linked, page1)).toBe(false);
  });

  test("the live-aware walk keeps going past a concluded-only match", () => {
    // The reported defect: page 1 names a MERGED review for branch X and
    // the walk stops, so a still-live review for X on page 2 is never
    // discovered and live-first selection is defeated. A concluded-only
    // match must hold the walk open; a live match resolves it.
    const groups = [group("a", "git", ["x"])];
    const concludedOnly = [pull({ number: 10, state: "closed", headRefName: "x" })];
    // The old any-match predicate stops here — that is the bug this
    // replaces in the walk.
    expect(sidebarProjectHasUnresolvedBranches(groups[0], concludedOnly)).toBe(false);
    expect(sidebarProjectHasUnresolvedLiveBranches(groups[0], concludedOnly)).toBe(true);
    const withLive = [
      ...concludedOnly,
      pull({ number: 9, state: "open", headRefName: "x" }),
    ];
    expect(sidebarProjectHasUnresolvedLiveBranches(groups[0], withLive)).toBe(false);
    // Unmatched branches still hold the walk open; live matches resolve.
    expect(
      sidebarProjectHasUnresolvedLiveBranches(groups[0], [pull({ headRefName: "other" })]),
    ).toBe(true);
    // A stored link never holds a walk open, even unmatched.
    const linked = {
      ...groups[0],
      worktrees: [
        {
          id: "wt-x",
          projectId: "a",
          workspaceId: "ws-x",
          path: "/repo/a/x",
          branch: "renamed",
          head: "abc",
          baseRef: null,
          createdAt: "2026-09-09T00:00:00Z",
          linkedPr: 99,
        },
      ],
    };
    expect(sidebarProjectHasUnresolvedLiveBranches(linked, concludedOnly)).toBe(false);
    // Branch-less worktrees (folder implicits, detached HEAD) never hold it open either.
    const branchless = [group("a", "git", [""])];
    expect(sidebarProjectHasUnresolvedLiveBranches(branchless[0], concludedOnly)).toBe(false);
    // Drafts are live: a draft match resolves the walk.
    expect(
      sidebarProjectHasUnresolvedLiveBranches(
        groups[0],
        [pull({ number: 4, state: "draft", headRefName: "x" })],
      ),
    ).toBe(false);
  });

  test("a mid-walk failure keeps the fetched pages, marked incomplete and failed", () => {
    const page1 = mergeSidebarPrPageResults(
      new Map(),
      "a",
      [pull({ number: 5, state: "open", headRefName: "feature" })],
      1,
    );
    // Thrown OR typed page-2 failure: page 1 survives with honest metadata.
    const outcome = sidebarPullsWalkErrorOutcome(page1, "a");
    expect(outcome).toEqual({
      projectId: "a",
      pulls: page1.get("a"),
      incomplete: true,
      failed: true,
    });
    expect(outcome.pulls).not.toBeNull();
    // Merging the partial keeps the page-1 marker visible (facts stay);
    // recording the failure drives the backoff retry and the stale
    // projection (so the ready-claim lapses until a clean walk).
    const merged = mergeSidebarPrResults(new Map(), [[outcome.projectId, outcome.pulls]]);
    expect(merged.get("a")?.map((item) => item.number)).toEqual([5]);
    const health = recordSidebarPrFetchOutcome(undefined, !outcome.failed, 1_000_000);
    expect(health.failures).toBe(1);
    expect(selectStaleSidebarPrProjects(merged, new Map([["a", health]]))).toEqual(
      new Set(["a"]),
    );
  });

  test("a page-1 failure keeps the last good listing and records null only when nothing was fetched", () => {
    const outcome = sidebarPullsWalkErrorOutcome(new Map(), "a");
    expect(outcome).toEqual({ projectId: "a", pulls: null, incomplete: false, failed: true });
    const good = new Map([["a", [pull({ number: 5 })]]]);
    expect(mergeSidebarPrResults(good, [["a", outcome.pulls]]).get("a")?.length).toBe(1);
    expect(mergeSidebarPrResults(new Map(), [["a", outcome.pulls]]).get("a")).toBeNull();
  });

  test("page 1 replaces, later pages append without duplicating numbers", () => {
    const first = mergeSidebarPrPageResults(
      new Map(),
      "a",
      [pull({ number: 2, state: "merged", headRefName: "old" })],
      1,
    );
    const second = mergeSidebarPrPageResults(
      first,
      "a",
      [
        pull({ number: 2, state: "merged", headRefName: "old" }),
        pull({ number: 1, state: "open", headRefName: "late-branch" }),
      ],
      2,
    );
    // Best-first: the live review sorts ahead of concluded history.
    expect(second.get("a")?.map((item) => item.number)).toEqual([1, 2]);
  });

  test("coverage tells matched, none, incomplete and unavailable apart", () => {
    const groups: ProjectGroup[] = [
      {
        ...group("a", "git", []),
        worktrees: [
          {
            id: "wt-hit",
            projectId: "a",
            workspaceId: "ws-hit",
            path: "/repo/a/hit",
            branch: "early",
            head: "abc",
            baseRef: null,
            createdAt: "2026-09-09T00:00:00Z",
          },
          {
            id: "wt-miss",
            projectId: "a",
            workspaceId: "ws-miss",
            path: "/repo/a/miss",
            branch: "lonely",
            head: "abc",
            baseRef: null,
            createdAt: "2026-09-09T00:00:00Z",
            linkedPr: null,
          },
        ],
      },
      {
        ...group("b", "git", ["ghost"]),
        worktrees: [
          {
            id: "wt-ghost",
            projectId: "b",
            workspaceId: "ws-ghost",
            path: "/repo/b/ghost",
            branch: "ghost",
            head: "abc",
            baseRef: null,
            createdAt: "2026-09-09T00:00:00Z",
          },
        ],
      },
    ];
    const cache = new Map<string, readonly TaskPullRequest[] | null>([
      ["a", [pull({ headRefName: "early" })]],
      ["b", null],
    ]);
    const byId = new Map(
      sidebarPrBranchCoverage(groups, cache, new Set()).map((entry) => [entry.worktreeId, entry.coverage]),
    );
    expect(byId.get("wt-hit")).toBe("matched");
    // Exhausted windows prove the branch review-less: genuinely none.
    expect(byId.get("wt-miss")).toBe("none");
    // A failed listing is unavailable, never none.
    expect(byId.get("wt-ghost")).toBe("unavailable");
    // The same miss behind an exhausted page budget is incomplete.
    const incomplete = new Map(
      sidebarPrBranchCoverage(groups, cache, new Set(["a"])).map((entry) => [entry.worktreeId, entry.coverage]),
    );
    expect(incomplete.get("wt-miss")).toBe("incomplete");
    expect(incomplete.get("wt-hit")).toBe("matched");
  });
});

describe("quota-bounded refresh (page 1 between full walks)", () => {
  const pull = (number: number, state = "open") =>
    ({ number, title: `#${number}`, state, headRefName: `b${number}` }) as never;

  test("a refresh is shallow only with a cached listing and a recent full walk", () => {
    const now = 1_000_000_000;
    expect(sidebarPullsRefreshIsShallow(undefined, now - 1000, now)).toBe(false);
    expect(sidebarPullsRefreshIsShallow(null, now - 1000, now)).toBe(false);
    expect(sidebarPullsRefreshIsShallow([], undefined, now)).toBe(false);
    expect(sidebarPullsRefreshIsShallow([], now - 1000, now)).toBe(true);
    expect(
      sidebarPullsRefreshIsShallow([], now - SIDEBAR_PULLS_FULL_WALK_MS, now),
    ).toBe(false);
  });

  test("page 1 wins for the reviews it lists and older cached reviews are kept", () => {
    const merged = mergeSidebarPrRevalidation(
      [pull(1, "open"), pull(2, "open")],
      [pull(2, "merged"), pull(3, "open")],
    );
    const byNumber = new Map(merged.map((item: { number: number; state: string }) => [item.number, item.state]));
    expect([...byNumber.keys()].sort()).toEqual([1, 2, 3]);
    expect(byNumber.get(2)).toBe("merged");
    expect(byNumber.get(1)).toBe("open");
  });
});
