// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/Content.tsx. GitHub-only: the
// work-item detail dialogs and the Projects board are not served by this
// repo's daemon, so the GitHub list is the whole content area.
import { TaskPageGitHubList } from "./github/List";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageContent({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  return taskSourceOnly(model);
}

function taskSourceOnly(model: TaskPageModelProps["model"]): React.JSX.Element | null {
  if (model.taskSource !== "github") {
    return null;
  }
  // Why: bottom of the joined GitHub list card — flush under the filter
  // chrome (no gap, no top border/radius) so toolbar + table read as one.
  return <TaskPageGitHubList model={model} />;
}
