// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/AssigneesCell.tsx. The source
// cell opens a popover that adds/removes assignees over gh write RPCs this
// repo's daemon does not serve, so the cell renders the same avatar stack
// (three visible, +n overflow, `-` when unassigned) read-only.
import { LoaderCircle } from "lucide-react";
import { cn } from "../../cn";
import type { TaskPageModelProps, TaskPageWorkItem } from "../../task-page-model";
import { GitHubAssigneeAvatar } from "./Avatars";

export function GHAssigneesCell({
  item,
  startBusy,
}: {
  item: TaskPageWorkItem;
  model: TaskPageModelProps["model"];
  startBusy: boolean;
}): React.JSX.Element {
  const assignees = item.assignees ?? [];
  const triggerContent =
    assignees.length > 0 ? (
      <>
        <div className="flex min-w-0 -space-x-1 overflow-hidden">
          {assignees.slice(0, 3).map((assignee) => (
            <GitHubAssigneeAvatar key={assignee.login} assignee={assignee} />
          ))}
        </div>
        {assignees.length > 3 ? (
          <span className="ml-1 shrink-0 text-[10px] font-medium text-muted-foreground">
            +{assignees.length - 3}
          </span>
        ) : null}
      </>
    ) : (
      <span className="text-xs text-muted-foreground/60">-</span>
    );
  return (
    <span
      aria-label={
        assignees.length ? `Assigned to ${assignees.map((a) => a.login).join(", ")}` : "Assign issue"
      }
      aria-busy={startBusy}
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 text-left transition",
        assignees.length > 0
          ? "rounded-full border border-border/40 bg-background/70 px-1.5 hover:bg-muted/60"
          : "w-full rounded-sm border border-transparent bg-transparent px-1 hover:bg-muted/40",
      )}
    >
      {triggerContent}
      {startBusy ? (
        <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
      ) : assignees.length > 0 ? (
        <span className="size-3 shrink-0" />
      ) : null}
    </span>
  );
}
