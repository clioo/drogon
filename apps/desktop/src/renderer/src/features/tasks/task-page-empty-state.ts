// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-empty-state.ts — GitHub-only
// adaptation: the GitLab views do not exist in this repo, so only the
// repo-backed GitHub arms and the no-sources arm survive.

export type RepoBackedTaskEmptyState = {
  title: string;
  description: string;
};

export function getRepoBackedTaskEmptyState(args: {
  provider: "github";
  selectedRepoCount: number;
}): RepoBackedTaskEmptyState {
  if (args.selectedRepoCount === 0) {
    return {
      title: "No project sources selected",
      description:
        "Select at least one project source so Drogon knows which host/account to fetch tasks from.",
    };
  }
  return {
    title: "No matching GitHub work",
    description: "Change the query or clear it.",
  };
}
