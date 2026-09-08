// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/review/primary-create-pr-intent-action.ts
// (the toolbar Create-PR action: label `Create {{shortLabel}}`, disabled
// with a per-reason title, enabled only when the branch can propose).
// Adapter: hosted-review probes, base refs and conflict state have no MVP
// backend here, so the rule is expressed over the daemon's upstream status
// (gitStatus branch + the git.pr_create RPC) with the fork's titles.

import { NO_REMOTE_SYNC_TITLE } from "./sync-row";

export type CreatePrToolbarAction = {
  label: "Create PR";
  title: string;
  disabled: boolean;
};

/**
 * Fork rule, adapted: the toolbar always offers Create PR (the fork renders
 * it disabled rather than hiding it); it enables only when a push-backed
 * branch has commits the upstream lacks.
 */
export function resolveCreatePrToolbarAction({
  busy,
  upstream,
  ahead,
  hasUncommitted,
  hasRemote = null,
}: {
  /** A commit or remote operation is in flight. */
  busy: boolean;
  upstream: string | null;
  ahead: number | null;
  /** The worktree has staged, unstaged or untracked changes. */
  hasUncommitted: boolean;
  /**
   * Whether the repo has any remote configured (#176). Null means unknown
   * (older daemon): the rule falls back to the upstream-only reasons and
   * never claims "no remote" it cannot prove. False disables first, before
   * every other reason — without a remote `gh` cannot run at all.
   */
  hasRemote?: boolean | null;
}): CreatePrToolbarAction {
  if (busy) {
    return {
      label: "Create PR",
      title: "Wait for the remote operation to finish.",
      disabled: true,
    };
  }
  if (hasRemote === false) {
    return {
      label: "Create PR",
      title: NO_REMOTE_SYNC_TITLE,
      disabled: true,
    };
  }
  if (!upstream) {
    return {
      label: "Create PR",
      title: "Publish commits before creating a pull request.",
      disabled: true,
    };
  }
  if (hasUncommitted) {
    return {
      label: "Create PR",
      title: "Commit changes before creating a pull request.",
      disabled: true,
    };
  }
  if (ahead === null || ahead <= 0) {
    return {
      label: "Create PR",
      title: "Push commits before creating a pull request.",
      disabled: true,
    };
  }
  return {
    label: "Create PR",
    title: "Create a pull request for this branch",
    disabled: false,
  };
}
