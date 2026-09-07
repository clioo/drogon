// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/Frame.tsx.
import { TaskPageListChrome } from "./ListChrome";
import { TaskPageContent } from "./Content";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageFrame({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  return (
    // Why: pt-1.5 (6px) aligns this 32px icon cluster's center with the sidebar Tasks row, 22px below the titlebar.
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          model.closeTaskPage();
        }
      }}
    >
      <div className="mx-auto flex min-h-0 min-w-0 w-full flex-1 flex-col px-5 pt-1.5 pb-4 md:px-8 md:pt-1.5 md:pb-5">
        <TaskPageListChrome model={model} />

        <TaskPageContent model={model} />
      </div>
    </div>
  );
}
