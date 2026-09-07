// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/ProviderFilters.tsx. GitHub-only:
// the Linear/Jira/GitLab arms do not exist in this repo.
import { TaskPageGitHubFilters } from "./github/Filters";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageProviderFilters({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const { taskSource, githubMode } = model;
  return taskSource === "github" && githubMode === "items" ? (
    // Why: top of the joined GitHub list card — pairs with the
    // table shell below (rounded-t-none border-t-0) as one surface.
    <TaskPageGitHubFilters model={model} />
  ) : null;
}
