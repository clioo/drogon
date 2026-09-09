// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/Content.tsx (R17-B: the Jira arm
// joins the GitHub list — the fork's Content switches the body per source,
// so this one does too; Linear/GitLab stay unported).
import { TaskPageGitHubList } from "./github/List";
import { TaskPageJiraContent } from "../jira/jira-content";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageContent({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  if (model.taskSource === "jira") {
    return <TaskPageJiraContent model={model} />;
  }
  // Why: bottom of the joined GitHub list card — flush under the filter
  // chrome (no gap, no top border/radius) so toolbar + table read as one.
  return <TaskPageGitHubList model={model} />;
}
