// @vitest-environment node
// User-feature-closure item 4: Workspace options menu logic. Every case
// here corresponds to a real, persisted control backed by real data
// (worktree metadata from crates/drogon-protocol schema v5, or the
// existing tasks.list pulls provider bridge for PR status) -- see
// workspace-options-state.ts's own header for exactly which source backs
// which field, and WorkspaceOptionsMenuSections.tsx's for which of these
// are wired into ProjectList.tsx's live rendering today.
import { describe, expect, it } from "vitest";
import type { Project, Session, Worktree } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { WorkspaceUIPreferences } from "../../../../shared/workspace-ui-preferences-contract";
import {
  applyWorkspaceGroupBy,
  applyWorkspaceHideFilters,
  DEFAULT_WORKSPACE_OPTIONS_STATE,
  fromSharedUIPreferences,
  groupWorktreesByPrStatus,
  groupWorktreesByWorkspaceStatus,
  isAutomationCreatedWorktree,
  isCliCreatedWorktree,
  isDefaultBranchWorktree,
  isDetachedHeadWorktree,
  isSleepingWorktree,
  loadWorkspaceOptionsState,
  manualOrderBetween,
  manualOrderRanksFromOrderedIds,
  MANUAL_ORDER_STRIDE,
  saveWorkspaceOptionsState,
  sharedUIPreferencesAreUntouched,
  sortWorktreesForDisplay,
  toSharedUIPreferences,
  type WorkspaceOptionsState,
} from "./workspace-options-state";
import { cloneDefaultWorkspaceStatuses } from "../../../../shared/workspace-statuses";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    hostId: "host-1",
    path: "/repo",
    name: "repo",
    kind: "git",
    defaultBaseRef: "main",
    ...overrides,
  };
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    projectId: "proj-1",
    workspaceId: "ws-1",
    path: "/repo/wt-1",
    branch: "feature",
    head: "abc123",
    baseRef: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    workspaceId: "ws-1",
    hostId: "host-1",
    incarnation: "1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-08T10:00:00.000Z",
    ...overrides,
  };
}

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

class FakeStorage implements Pick<Storage, "getItem" | "setItem"> {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("workspace options persistence", () => {
  it("defaults to Repo grouping, recent sort, both properties shown, nothing hidden", () => {
    expect(loadWorkspaceOptionsState(new FakeStorage())).toEqual(
      DEFAULT_WORKSPACE_OPTIONS_STATE,
    );
    expect(DEFAULT_WORKSPACE_OPTIONS_STATE.groupBy).toBe("repo");
    expect(DEFAULT_WORKSPACE_OPTIONS_STATE.sortBy).toBe("recent");
  });

  it("round-trips a full state through save/load", () => {
    const storage = new FakeStorage();
    const state: WorkspaceOptionsState = {
      groupBy: "none",
      sortBy: "smart",
      projectOrderBy: "recent",
      cardLayout: "compact",
      showProperties: { branch: false, pr: true },
      hide: {
        sleeping: true,
        defaultBranch: true,
        detachedHead: false,
        automationCreated: true,
        cliCreated: true,
      },
    };
    saveWorkspaceOptionsState(storage, state);
    expect(loadWorkspaceOptionsState(storage)).toEqual(state);
  });

  it("falls back to defaults for corrupted storage instead of throwing", () => {
    const storage = new FakeStorage();
    storage.setItem("drogon:shell:workspace-options", "{not json");
    expect(loadWorkspaceOptionsState(storage)).toEqual(
      DEFAULT_WORKSPACE_OPTIONS_STATE,
    );
  });

  it("merges a partial/stale envelope field by field onto the defaults", () => {
    const storage = new FakeStorage();
    storage.setItem(
      "drogon:shell:workspace-options",
      JSON.stringify({ groupBy: "none" }),
    );
    const loaded = loadWorkspaceOptionsState(storage);
    expect(loaded.groupBy).toBe("none");
    expect(loaded.sortBy).toBe(DEFAULT_WORKSPACE_OPTIONS_STATE.sortBy);
    expect(loaded.showProperties).toEqual(
      DEFAULT_WORKSPACE_OPTIONS_STATE.showProperties,
    );
  });

  it("rejects an unknown enum value rather than trusting untyped storage", () => {
    const storage = new FakeStorage();
    storage.setItem(
      "drogon:shell:workspace-options",
      JSON.stringify({ groupBy: "status" }),
    );
    expect(loadWorkspaceOptionsState(storage).groupBy).toBe("repo");
  });

  it("preserves a stale/missing hide field as its own default independently", () => {
    const storage = new FakeStorage();
    storage.setItem(
      "drogon:shell:workspace-options",
      JSON.stringify({ hide: { cliCreated: true } }),
    );
    const loaded = loadWorkspaceOptionsState(storage);
    expect(loaded.hide.cliCreated).toBe(true);
    expect(loaded.hide.automationCreated).toBe(false);
    expect(loaded.hide.sleeping).toBe(false);
  });
});

describe("applyWorkspaceGroupBy", () => {
  it("never reassigns a worktree's real project identity for any groupBy value -- returns the input groups unchanged", () => {
    const groups: ProjectGroup[] = [
      { project: project({ id: "a" }), worktrees: [worktree({ id: "wt-a", projectId: "a" })] },
      { project: project({ id: "b" }), worktrees: [worktree({ id: "wt-b", projectId: "b" })] },
    ];
    for (const groupBy of ["repo", "none", "workspace-status", "pr-status"] as const) {
      const result = applyWorkspaceGroupBy(groups, groupBy);
      expect(result).toBe(groups);
      expect(result[1]!.project.id).toBe("b");
      expect(result[1]!.worktrees[0]!.projectId).toBe("b");
    }
  });

  it("is a no-op on an empty group list", () => {
    expect(applyWorkspaceGroupBy([], "none")).toEqual([]);
  });
});

describe("groupWorktreesByWorkspaceStatus", () => {
  const statuses = cloneDefaultWorkspaceStatuses();

  it("buckets worktrees across projects by their real workspaceStatus, each entry keeping its own real project", () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a" }),
        worktrees: [worktree({ id: "wt-a", projectId: "a", workspaceStatus: "in-review" })],
      },
      {
        project: project({ id: "b" }),
        worktrees: [worktree({ id: "wt-b", projectId: "b", workspaceStatus: "in-review" })],
      },
    ];
    const result = groupWorktreesByWorkspaceStatus(groups, statuses);
    const inReview = result.find((bucket) => bucket.key === "in-review")!;
    expect(inReview.entries.map((e) => e.worktree.id)).toEqual(["wt-a", "wt-b"]);
    expect(inReview.entries.map((e) => e.project.id)).toEqual(["a", "b"]);
  });

  it("falls back to the default status bucket for an absent/unknown status", () => {
    const groups: ProjectGroup[] = [
      { project: project(), worktrees: [worktree({ workspaceStatus: null })] },
      { project: project(), worktrees: [worktree({ id: "wt-2", workspaceStatus: "not-a-real-status" })] },
    ];
    const result = groupWorktreesByWorkspaceStatus(groups, statuses);
    const defaultBucket = result.find((bucket) => bucket.key === "in-progress")!;
    expect(defaultBucket.entries.map((e) => e.worktree.id)).toEqual(["wt-1", "wt-2"]);
  });

  it("omits an empty bucket entirely", () => {
    const groups: ProjectGroup[] = [
      { project: project(), worktrees: [worktree({ workspaceStatus: "todo" })] },
    ];
    const result = groupWorktreesByWorkspaceStatus(groups, statuses);
    expect(result.map((b) => b.key)).toEqual(["todo"]);
  });
});

describe("groupWorktreesByPrStatus", () => {
  it("buckets by real PR state, correlated by branch, across projects", () => {
    const groups: ProjectGroup[] = [
      {
        project: project({ id: "a" }),
        worktrees: [worktree({ id: "wt-a", projectId: "a", branch: "feature" })],
      },
      {
        project: project({ id: "b" }),
        worktrees: [worktree({ id: "wt-b", projectId: "b", branch: "other" })],
      },
    ];
    const pulls = new Map([
      ["a", [pull({ headRefName: "feature", state: "open" })]],
      ["b", [pull({ headRefName: "other", state: "merged" })]],
    ]);
    const result = groupWorktreesByPrStatus(groups, pulls);
    expect(result.find((b) => b.key === "open")!.entries[0]!.worktree.id).toBe("wt-a");
    expect(result.find((b) => b.key === "merged")!.entries[0]!.worktree.id).toBe("wt-b");
  });

  it("buckets a project's worktrees under 'unavailable' when its pulls fetch is missing, distinct from 'none'", () => {
    const groups: ProjectGroup[] = [
      { project: project({ id: "a" }), worktrees: [worktree({ id: "wt-a", branch: "feature" })] },
      { project: project({ id: "b" }), worktrees: [worktree({ id: "wt-b", branch: "other" })] },
    ];
    // "a" fetched real pulls (none matching); "b" was never in the map at
    // all (its fetch failed) -- these must land in different buckets.
    const pulls = new Map([["a", [] as TaskPullRequest[]]]);
    const result = groupWorktreesByPrStatus(groups, pulls);
    expect(result.find((b) => b.key === "none")!.entries.map((e) => e.worktree.id)).toEqual([
      "wt-a",
    ]);
    expect(
      result.find((b) => b.key === "unavailable")!.entries.map((e) => e.worktree.id),
    ).toEqual(["wt-b"]);
  });
});

describe("isDefaultBranchWorktree", () => {
  it("matches a worktree checked out to the project's recorded default branch", () => {
    expect(
      isDefaultBranchWorktree(worktree({ branch: "main" }), project({ defaultBaseRef: "main" })),
    ).toBe(true);
  });

  it("does not match a feature branch", () => {
    expect(
      isDefaultBranchWorktree(worktree({ branch: "feature" }), project({ defaultBaseRef: "main" })),
    ).toBe(false);
  });

  it("never matches when the project records no default branch", () => {
    expect(
      isDefaultBranchWorktree(worktree({ branch: "main" }), project({ defaultBaseRef: null })),
    ).toBe(false);
  });

  it("never matches a folder project (no branch concept)", () => {
    expect(
      isDefaultBranchWorktree(
        worktree({ branch: "" }),
        project({ kind: "folder", defaultBaseRef: null }),
      ),
    ).toBe(false);
  });
});

describe("isDetachedHeadWorktree", () => {
  it("matches a git worktree with an empty branch", () => {
    expect(isDetachedHeadWorktree(worktree({ branch: "" }), project())).toBe(true);
  });

  it("does not match a worktree on a real branch", () => {
    expect(isDetachedHeadWorktree(worktree({ branch: "main" }), project())).toBe(false);
  });

  it("never flags a folder project's implicit worktree (also branch: '') as detached", () => {
    expect(
      isDetachedHeadWorktree(worktree({ branch: "" }), project({ kind: "folder" })),
    ).toBe(false);
  });
});

describe("isSleepingWorktree", () => {
  it("is asleep with zero attached sessions", () => {
    expect(isSleepingWorktree(worktree(), [])).toBe(true);
  });

  it("is asleep when every attached session has exited", () => {
    expect(
      isSleepingWorktree(worktree(), [session({ verdict: "exited" })]),
    ).toBe(true);
  });

  it("is awake with a live attached session", () => {
    expect(
      isSleepingWorktree(worktree(), [session({ verdict: "live" })]),
    ).toBe(false);
  });

  it("ignores a live session attached to a different workspace", () => {
    expect(
      isSleepingWorktree(worktree({ workspaceId: "ws-1" }), [
        session({ workspaceId: "ws-2", verdict: "live" }),
      ]),
    ).toBe(true);
  });
});

describe("isAutomationCreatedWorktree / isCliCreatedWorktree", () => {
  it("reads the real creator field", () => {
    expect(isCliCreatedWorktree(worktree({ creator: "cli" }))).toBe(true);
    expect(isCliCreatedWorktree(worktree({ creator: "automation" }))).toBe(false);
    expect(isCliCreatedWorktree(worktree({ creator: null }))).toBe(false);
    expect(isAutomationCreatedWorktree(worktree({ creator: "automation" }))).toBe(true);
    expect(isAutomationCreatedWorktree(worktree({ creator: "cli" }))).toBe(false);
  });
});

describe("applyWorkspaceHideFilters", () => {
  const defaultBranchWt = worktree({
    id: "wt-default",
    branch: "main",
    workspaceId: "ws-default",
  });
  const detachedWt = worktree({
    id: "wt-detached",
    branch: "",
    workspaceId: "ws-detached",
  });
  const sleepingWt = worktree({ id: "wt-sleeping", workspaceId: "ws-sleep" });
  const automationWt = worktree({
    id: "wt-automation",
    workspaceId: "ws-automation",
    creator: "automation",
  });
  const cliWt = worktree({ id: "wt-cli", workspaceId: "ws-cli", creator: "cli" });
  const awakeWt = worktree({ id: "wt-awake", workspaceId: "ws-awake" });
  const all = [defaultBranchWt, detachedWt, sleepingWt, automationWt, cliWt, awakeWt];
  const proj = project({ defaultBaseRef: "main" });
  const sessions: Session[] = [
    session({ workspaceId: "ws-default", verdict: "live" }),
    session({ workspaceId: "ws-detached", verdict: "live" }),
    session({ workspaceId: "ws-automation", verdict: "live" }),
    session({ workspaceId: "ws-cli", verdict: "live" }),
    session({ workspaceId: "ws-awake", verdict: "live" }),
  ];
  const noHide = {
    sleeping: false,
    defaultBranch: false,
    detachedHead: false,
    automationCreated: false,
    cliCreated: false,
  };

  it("hides only default-branch worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      ...noHide,
      defaultBranch: true,
    });
    expect(result.map((w) => w.id)).toEqual([
      "wt-detached",
      "wt-sleeping",
      "wt-automation",
      "wt-cli",
      "wt-awake",
    ]);
  });

  it("hides only detached-HEAD worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      ...noHide,
      detachedHead: true,
    });
    expect(result.map((w) => w.id)).toEqual([
      "wt-default",
      "wt-sleeping",
      "wt-automation",
      "wt-cli",
      "wt-awake",
    ]);
  });

  it("hides only sleeping worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      ...noHide,
      sleeping: true,
    });
    expect(result.map((w) => w.id)).toEqual([
      "wt-default",
      "wt-detached",
      "wt-automation",
      "wt-cli",
      "wt-awake",
    ]);
  });

  it("hides only automation-created worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      ...noHide,
      automationCreated: true,
    });
    expect(result.map((w) => w.id)).toEqual([
      "wt-default",
      "wt-detached",
      "wt-sleeping",
      "wt-cli",
      "wt-awake",
    ]);
  });

  it("hides only CLI-created worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      ...noHide,
      cliCreated: true,
    });
    expect(result.map((w) => w.id)).toEqual([
      "wt-default",
      "wt-detached",
      "wt-sleeping",
      "wt-automation",
      "wt-awake",
    ]);
  });

  it("combines every enabled filter", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      sleeping: true,
      defaultBranch: true,
      detachedHead: true,
      automationCreated: true,
      cliCreated: true,
    });
    expect(result.map((w) => w.id)).toEqual(["wt-awake"]);
  });

  it("changes nothing with every filter off", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, noHide);
    expect(result).toEqual(all);
  });
});

describe("sortWorktreesForDisplay", () => {
  const wa = worktree({ id: "wa", title: "Bravo", path: "/repo/bravo" });
  const wb = worktree({ id: "wb", title: "Alpha", path: "/repo/alpha" });
  const wc = worktree({ id: "wc", title: null, path: "/repo/charlie" });

  it("leaves manual order untouched (a fresh array, not the same reference)", () => {
    const input = [wa, wb, wc];
    const result = sortWorktreesForDisplay(input, "manual");
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("sorts by display title (falling back to the path's base name), case-insensitively stable", () => {
    const result = sortWorktreesForDisplay([wa, wb, wc], "name");
    expect(result.map((w) => w.id)).toEqual(["wb", "wa", "wc"]);
  });

  it("sorts by most-recent activity first, using an injected activity callback", () => {
    const activity: Record<string, string | null> = {
      wa: "2026-09-08T10:00:00.000Z",
      wb: "2026-09-08T12:00:00.000Z",
      wc: null,
    };
    const result = sortWorktreesForDisplay(
      [wa, wb, wc],
      "recent",
      (w) => activity[w.id] ?? null,
    );
    expect(result.map((w) => w.id)).toEqual(["wb", "wa", "wc"]);
  });

  it("sorts by real lastActivityAt when no callback is injected", () => {
    const x = worktree({ id: "x", lastActivityAt: "2026-09-08T10:00:00.000Z" });
    const y = worktree({ id: "y", lastActivityAt: "2026-09-08T12:00:00.000Z" });
    const result = sortWorktreesForDisplay([x, y], "recent");
    expect(result.map((w) => w.id)).toEqual(["y", "x"]);
  });

  it("falls back to createdAt when lastActivityAt is absent", () => {
    const x = worktree({ id: "x", createdAt: "2026-09-08T09:00:00.000Z", lastActivityAt: null });
    const y = worktree({ id: "y", createdAt: "2026-09-08T11:00:00.000Z", lastActivityAt: null });
    const result = sortWorktreesForDisplay([x, y], "recent");
    expect(result.map((w) => w.id)).toEqual(["y", "x"]);
  });

  it("keeps activity-less worktrees in their relative order, always last", () => {
    const wd = worktree({ id: "wd", path: "/repo/delta" });
    const activity: Record<string, string | null> = { wa: "2026-09-08T10:00:00.000Z" };
    const result = sortWorktreesForDisplay(
      [wb, wc, wa, wd],
      "recent",
      (w) => activity[w.id] ?? null,
    );
    expect(result.map((w) => w.id)).toEqual(["wa", "wb", "wc", "wd"]);
  });

  it("'smart' puts pinned worktrees first, each side still ordered by recency", () => {
    const pinnedOld = worktree({
      id: "pinned-old",
      isPinned: true,
      lastActivityAt: "2026-09-08T08:00:00.000Z",
    });
    const pinnedNew = worktree({
      id: "pinned-new",
      isPinned: true,
      lastActivityAt: "2026-09-08T10:00:00.000Z",
    });
    const unpinnedNewest = worktree({
      id: "unpinned-newest",
      isPinned: false,
      lastActivityAt: "2026-09-08T12:00:00.000Z",
    });
    const result = sortWorktreesForDisplay(
      [unpinnedNewest, pinnedOld, pinnedNew],
      "smart",
    );
    expect(result.map((w) => w.id)).toEqual(["pinned-new", "pinned-old", "unpinned-newest"]);
  });

  it("'repo' sorts by the owning project's name via the injected resolver", () => {
    const wx = worktree({ id: "wx", title: "Z", projectId: "p-zebra" });
    const wy = worktree({ id: "wy", title: "A", projectId: "p-alpha" });
    const names: Record<string, string> = { "p-zebra": "Zebra", "p-alpha": "Alpha" };
    const result = sortWorktreesForDisplay(
      [wx, wy],
      "repo",
      undefined,
      (w) => names[w.projectId] ?? "",
    );
    expect(result.map((w) => w.id)).toEqual(["wy", "wx"]);
  });
});

describe("manualOrderBetween", () => {
  it("returns the canonical first stride value for an empty list", () => {
    expect(manualOrderBetween(null, null)).toBe(MANUAL_ORDER_STRIDE);
  });

  it("steps a full stride above the sole neighbor when dropped at the top", () => {
    expect(manualOrderBetween(null, 3000)).toBe(3000 + MANUAL_ORDER_STRIDE);
  });

  it("steps a full stride below the sole neighbor when dropped at the bottom", () => {
    expect(manualOrderBetween(3000, null)).toBe(3000 - MANUAL_ORDER_STRIDE);
  });

  it("lands on the midpoint between two real neighbors", () => {
    expect(manualOrderBetween(2000, 3000)).toBe(2500);
  });

  it("never collides with the lower neighbor when there is no room left", () => {
    const result = manualOrderBetween(1000, 1001);
    expect(result).not.toBe(1000);
    expect(result).not.toBe(1001);
    expect(result).toBeGreaterThan(1000);
  });
});

describe("manualOrderRanksFromOrderedIds", () => {
  it("assigns strictly decreasing stride ranks, first id highest", () => {
    const ranks = manualOrderRanksFromOrderedIds(["a", "b", "c"]);
    expect(ranks.get("a")).toBe(3 * MANUAL_ORDER_STRIDE);
    expect(ranks.get("b")).toBe(2 * MANUAL_ORDER_STRIDE);
    expect(ranks.get("c")).toBe(1 * MANUAL_ORDER_STRIDE);
  });

  it("is a real total order usable directly by sortWorktreesForDisplay('manual')", () => {
    const ranks = manualOrderRanksFromOrderedIds(["wc", "wa", "wb"]);
    const worktrees = [
      worktree({ id: "wa", manualOrder: ranks.get("wa") }),
      worktree({ id: "wb", manualOrder: ranks.get("wb") }),
      worktree({ id: "wc", manualOrder: ranks.get("wc") }),
    ];
    const sorted = sortWorktreesForDisplay(worktrees, "manual");
    expect(sorted.map((w) => w.id)).toEqual(["wc", "wa", "wb"]);
  });

  it("is a no-op on an empty list", () => {
    expect(manualOrderRanksFromOrderedIds([]).size).toBe(0);
  });
});

function sharedPrefs(overrides: Partial<WorkspaceUIPreferences> = {}): WorkspaceUIPreferences {
  return {
    groupBy: "repo",
    sortBy: "recent",
    projectOrderBy: "manual",
    cardLayout: "comfortable",
    hideSleepingWorkspaces: false,
    hideDefaultBranchWorkspace: false,
    hideDetachedHeadWorkspaces: false,
    hideAutomationGeneratedWorkspaces: false,
    hideCliCreatedWorkspaces: false,
    worktreeCardProperties: ["branch", "pr"],
    workspaceStatuses: [],
    workspaceBoardOpacity: 1,
    workspaceBoardColumnWidth: 308,
    syncTaskStatusFromWorkspaceBoard: false,
    _workspaceStatusesDefaultOrderMigrated: true,
    _workspaceStatusesReorderedDefaultRepaired: true,
    _workspaceStatusesDefaultWorkflowMigrated: true,
    _workspaceStatusesDefaultVisualsMigrated: true,
    ...overrides,
  };
}

describe("toSharedUIPreferences / fromSharedUIPreferences", () => {
  it("round-trips every field through the shared shape", () => {
    const state: WorkspaceOptionsState = {
      groupBy: "workspace-status",
      sortBy: "smart",
      projectOrderBy: "recent",
      cardLayout: "compact",
      showProperties: { branch: false, pr: true },
      hide: {
        sleeping: true,
        defaultBranch: false,
        detachedHead: true,
        automationCreated: false,
        cliCreated: true,
      },
    };
    const shared = toSharedUIPreferences(state);
    expect(shared.groupBy).toBe("workspace-status");
    expect(shared.sortBy).toBe("smart");
    expect(shared.projectOrderBy).toBe("recent");
    expect(shared.cardLayout).toBe("compact");
    expect(shared.worktreeCardProperties).toEqual(["pr"]);
    expect(shared.hideSleepingWorkspaces).toBe(true);
    expect(shared.hideDetachedHeadWorkspaces).toBe(true);
    expect(shared.hideCliCreatedWorkspaces).toBe(true);
    expect(shared.hideDefaultBranchWorkspace).toBe(false);
    expect(shared.hideAutomationGeneratedWorkspaces).toBe(false);

    const back = fromSharedUIPreferences(sharedPrefs(shared));
    expect(back).toEqual(state);
  });

  it("showProperties maps onto worktreeCardProperties without clobbering an unrelated property already in the array", () => {
    const state: WorkspaceOptionsState = {
      ...DEFAULT_WORKSPACE_OPTIONS_STATE,
      showProperties: { branch: true, pr: false },
    };
    const shared = toSharedUIPreferences(state, ["branch", "pr", "issue"]);
    expect(shared.worktreeCardProperties).toEqual(["issue", "branch"]);
  });

  it("sharedUIPreferencesAreUntouched is true only for the exact defaults", () => {
    expect(sharedUIPreferencesAreUntouched(sharedPrefs())).toBe(true);
    expect(
      sharedUIPreferencesAreUntouched(sharedPrefs({ groupBy: "none" })),
    ).toBe(false);
    expect(
      sharedUIPreferencesAreUntouched(
        sharedPrefs({ hideCliCreatedWorkspaces: true }),
      ),
    ).toBe(false);
  });
});
