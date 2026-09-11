/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca:
   - src/renderer/src/components/sidebar/repo-header-create-state.ts (the rule
     that decides the project header's create affordance: a folder repo gets a
     "Create workspace for <label>" control, a git repo gets "Create new
     worktree for <label>", and the control is only *disabled with a stated
     reason* -- never omitted).
   - src/shared/repo-kind.ts (`getRepoKind`/`isGitRepoKind`: an absent/unknown
     `kind` is git, only an explicit "folder" is a folder).
   The source's SSH-reconnect branch has no Drogon equivalent (no SSH
   execution host yet); the blocking input here is the worktree capability the
   create path actually needs. */
import type { Project } from "../../../../shared/session-contract";

/** True exactly for a project the service registered as a plain folder. */
export function isFolderProject(project: Pick<Project, "kind">): boolean {
  return project.kind === "folder";
}

/** The verbatim daemon-facing reason the worktree create path is blocked. */
export const WORKTREES_UNAVAILABLE_REASON =
  "Worktrees unavailable: service does not advertise worktree.v1";

export interface ProjectHeaderCreateState {
  disabled: boolean;
  /** Hover tooltip (`title`) for the header's create control. */
  tooltip: string;
  /** Accessible name, carrying the project label like the source's. */
  ariaLabel: string;
}

/**
 * The project header's create affordance, decided by the project's kind --
 * never by whether a worktree happens to resolve. A folder project has one
 * implicit workspace, so its control opens that workspace; a git project's
 * control creates a worktree. Both are always rendered, because a header that
 * silently drops its only create entry point reads as a broken row (the
 * source's own rule: `getRepoHeaderCreateState` returns an enabled, labelled
 * state for folder repos too).
 *
 * The one genuinely blocked case -- a git project while the service does not
 * advertise `worktree.v1` -- stays visible and states its reason instead of
 * disappearing.
 */
export function getProjectHeaderCreateState(input: {
  project: Pick<Project, "kind">;
  label: string;
  worktreesAvailable: boolean;
}): ProjectHeaderCreateState {
  if (isFolderProject(input.project)) {
    const label = `Create workspace for ${input.label}`;
    return { disabled: false, tooltip: label, ariaLabel: label };
  }

  if (!input.worktreesAvailable) {
    return {
      disabled: true,
      tooltip: WORKTREES_UNAVAILABLE_REASON,
      ariaLabel: `${WORKTREES_UNAVAILABLE_REASON} — ${input.label}`,
    };
  }

  const label = `Create new worktree for ${input.label}`;
  return { disabled: false, tooltip: label, ariaLabel: label };
}
