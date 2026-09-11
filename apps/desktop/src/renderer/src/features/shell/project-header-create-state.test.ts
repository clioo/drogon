/* MIT Copyright (c) 2026 Lovecast Inc.
   Regression tests for the project header's create affordance. Orca's
   src/renderer/src/components/sidebar/repo-header-create-state.test.ts is the
   source for the case list: a git repo, a folder repo, and a repo whose create
   path is blocked all yield a state — the control is never dropped. */
import { describe, expect, test } from "vitest";
import {
  WORKTREES_UNAVAILABLE_REASON,
  getProjectHeaderCreateState,
  isFolderProject,
} from "./project-header-create-state";

describe("project header create state", () => {
  test("a git project creates a worktree", () => {
    expect(
      getProjectHeaderCreateState({
        project: { kind: "git" },
        label: "zillow",
        worktreesAvailable: true,
      }),
    ).toEqual({
      disabled: false,
      tooltip: "Create new worktree for zillow",
      ariaLabel: "Create new worktree for zillow",
    });
  });

  test("a folder project creates a workspace (never omitted)", () => {
    expect(
      getProjectHeaderCreateState({
        project: { kind: "folder" },
        label: "notes",
        worktreesAvailable: true,
      }),
    ).toEqual({
      disabled: false,
      tooltip: "Create workspace for notes",
      ariaLabel: "Create workspace for notes",
    });
  });

  test("a folder project keeps its control even without worktree.v1", () => {
    // Opening a folder project's one implicit workspace needs no worktree RPC,
    // so the missing capability is not a reason to drop the entry point.
    expect(
      getProjectHeaderCreateState({
        project: { kind: "folder" },
        label: "notes",
        worktreesAvailable: false,
      }),
    ).toEqual({
      disabled: false,
      tooltip: "Create workspace for notes",
      ariaLabel: "Create workspace for notes",
    });
  });

  test("a git project without worktree.v1 stays visible and states why", () => {
    expect(
      getProjectHeaderCreateState({
        project: { kind: "git" },
        label: "zillow",
        worktreesAvailable: false,
      }),
    ).toEqual({
      disabled: true,
      tooltip: WORKTREES_UNAVAILABLE_REASON,
      ariaLabel: `${WORKTREES_UNAVAILABLE_REASON} — zillow`,
    });
  });

  test("only an explicit folder kind is a folder project", () => {
    // Orca's getRepoKind: an absent/legacy kind reads as git.
    expect(isFolderProject({ kind: "folder" })).toBe(true);
    expect(isFolderProject({ kind: "git" })).toBe(false);
    expect(isFolderProject({ kind: undefined as unknown as "git" })).toBe(false);
  });
});
