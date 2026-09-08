// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/StatusCell.tsx. The source
// cell opens a mutation popover (close as completed/not planned/duplicate,
// merge, auto-merge) over gh write RPCs this repo's daemon does not serve,
// so the cell renders the same state pill in its read-only badge form: the
// issue Open/Closed pill, and for PRs the source's Open/Draft/Closed/Merged
// badge (see task-page-github-work-item-status-badge).
import { CircleDot } from "lucide-react";
import { cn } from "../../cn";
import { TaskPageGitHubWorkItemStateBadge } from "../../task-page-github-work-item-status-badge";
import type { TaskPageModelProps, TaskPageWorkItem } from "../../task-page-model";

export function GHStatusCell({
  item,
}: {
  item: TaskPageWorkItem;
  model: TaskPageModelProps["model"];
}): React.JSX.Element {
  if (item.type === "pr") {
    return <TaskPageGitHubWorkItemStateBadge item={item} />;
  }
  const closed = item.state === "closed";
  return (
    <span
      className={cn(
        "group/status inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
        closed
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
      )}
    >
      {closed ? null : <CircleDot className="size-2.5" />}
      <span>{closed ? "Closed" : "Open"}</span>
    </span>
  );
}
