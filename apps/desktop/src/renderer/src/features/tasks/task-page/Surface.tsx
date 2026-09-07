// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/Surface.tsx. GitHub-only: the
// provider dialogs (Issue/Project/Connect) have no counterpart in this
// repo, so the surface is the frame alone.
import { TaskPageFrame } from "./Frame";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageSurface({
  model,
}: TaskPageModelProps): React.JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <TaskPageFrame model={model} />
    </div>
  );
}
