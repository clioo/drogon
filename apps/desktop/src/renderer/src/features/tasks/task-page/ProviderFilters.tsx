// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/ProviderFilters.tsx (R17-B: the
// Jira arm joins the GitHub filters — the fork switches the filter row per
// source; the Linear source carries its own filter row inside its content).
import { TaskPageGitHubFilters } from "./github/Filters";
import { TaskPageJiraFilters } from "../jira/jira-filters";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageProviderFilters({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const { taskSource, githubMode } = model;
  if (taskSource === "jira") {
    // Why: top of the joined Jira list card — pairs with the list shell
    // below (rounded-b-none) as one surface, like the fork.
    return <TaskPageJiraFilters model={model} />;
  }
  return taskSource === "github" && githubMode === "items" ? (
    // Why: top of the joined GitHub list card — pairs with the
    // table shell below (rounded-t-none border-t-0) as one surface.
    <TaskPageGitHubFilters model={model} />
  ) : null;
}
