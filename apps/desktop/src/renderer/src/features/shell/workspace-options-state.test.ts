// @vitest-environment node
// User-feature-closure item 4: Workspace options menu logic. Every case
// here corresponds to a real, persisted control -- no case exercises a
// group-by/filter mode without real backing data (Status/PR grouping and
// automation/CLI-created hiding are deliberately absent: no such data
// exists anywhere in this renderer, so adding those modes here would be
// exactly the inert mock UI the task forbids).
import { describe, expect, it } from "vitest";
import type { Project, Session, Worktree } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import {
  applyWorkspaceGroupBy,
  applyWorkspaceHideFilters,
  DEFAULT_WORKSPACE_OPTIONS_STATE,
  isDefaultBranchWorktree,
  isDetachedHeadWorktree,
  isSleepingWorktree,
  loadWorkspaceOptionsState,
  saveWorkspaceOptionsState,
  sortWorktreesForDisplay,
  type WorkspaceOptionsState,
} from "./workspace-options-state";

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
  it("defaults to Project grouping, manual sort, both properties shown, nothing hidden", () => {
    expect(loadWorkspaceOptionsState(new FakeStorage())).toEqual(
      DEFAULT_WORKSPACE_OPTIONS_STATE,
    );
  });

  it("round-trips a full state through save/load", () => {
    const storage = new FakeStorage();
    const state: WorkspaceOptionsState = {
      groupBy: "none",
      sortBy: "recent",
      cardLayout: "compact",
      showProperties: { branch: false, pr: true },
      hide: { sleeping: true, defaultBranch: true, detachedHead: false },
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
    expect(loadWorkspaceOptionsState(storage).groupBy).toBe("project");
  });
});

describe("applyWorkspaceGroupBy", () => {
  it("leaves Project grouping (the default) untouched", () => {
    const groups: ProjectGroup[] = [
      { project: project({ id: "a" }), worktrees: [worktree({ id: "wt-a" })] },
      { project: project({ id: "b" }), worktrees: [worktree({ id: "wt-b" })] },
    ];
    expect(applyWorkspaceGroupBy(groups, "project")).toBe(groups);
  });

  it("flattens every project's worktrees into one group under None", () => {
    const groups: ProjectGroup[] = [
      { project: project({ id: "a" }), worktrees: [worktree({ id: "wt-a" })] },
      { project: project({ id: "b" }), worktrees: [worktree({ id: "wt-b" })] },
    ];
    const flattened = applyWorkspaceGroupBy(groups, "none");
    expect(flattened.length).toBe(1);
    expect(flattened[0]!.worktrees.map((w) => w.id)).toEqual(["wt-a", "wt-b"]);
  });

  it("is a no-op on an empty group list", () => {
    expect(applyWorkspaceGroupBy([], "none")).toEqual([]);
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
  const awakeWt = worktree({ id: "wt-awake", workspaceId: "ws-awake" });
  const all = [defaultBranchWt, detachedWt, sleepingWt, awakeWt];
  const proj = project({ defaultBaseRef: "main" });
  // Every worktree but wt-sleeping has a live session, so only the
  // sleeping-alone case below is expected to touch the other three.
  const sessions: Session[] = [
    session({ workspaceId: "ws-default", verdict: "live" }),
    session({ workspaceId: "ws-detached", verdict: "live" }),
    session({ workspaceId: "ws-awake", verdict: "live" }),
  ];

  it("hides only default-branch worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      sleeping: false,
      defaultBranch: true,
      detachedHead: false,
    });
    expect(result.map((w) => w.id)).toEqual(["wt-detached", "wt-sleeping", "wt-awake"]);
  });

  it("hides only detached-HEAD worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      sleeping: false,
      defaultBranch: false,
      detachedHead: true,
    });
    expect(result.map((w) => w.id)).toEqual(["wt-default", "wt-sleeping", "wt-awake"]);
  });

  it("hides only sleeping worktrees when that filter alone is on", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      sleeping: true,
      defaultBranch: false,
      detachedHead: false,
    });
    expect(result.map((w) => w.id)).toEqual(["wt-default", "wt-detached", "wt-awake"]);
  });

  it("combines every enabled filter", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      sleeping: true,
      defaultBranch: true,
      detachedHead: true,
    });
    expect(result.map((w) => w.id)).toEqual(["wt-awake"]);
  });

  it("changes nothing with every filter off", () => {
    const result = applyWorkspaceHideFilters(all, proj, sessions, {
      sleeping: false,
      defaultBranch: false,
      detachedHead: false,
    });
    expect(result).toEqual(all);
  });
});

describe("sortWorktreesForDisplay", () => {
  const wa = worktree({ id: "wa", title: "Bravo", path: "/repo/bravo" });
  const wb = worktree({ id: "wb", title: "Alpha", path: "/repo/alpha" });
  const wc = worktree({ id: "wc", title: null, path: "/repo/charlie" });

  it("leaves manual order untouched (a fresh array, not the same reference)", () => {
    const input = [wa, wb, wc];
    const result = sortWorktreesForDisplay(input, "manual", () => null);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("sorts by display title (falling back to the path's base name), case-insensitively stable", () => {
    const result = sortWorktreesForDisplay([wa, wb, wc], "name", () => null);
    expect(result.map((w) => w.id)).toEqual(["wb", "wa", "wc"]);
  });

  it("sorts by most-recent activity first", () => {
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
});
