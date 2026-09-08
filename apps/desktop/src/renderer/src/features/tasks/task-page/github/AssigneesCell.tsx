// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/AssigneesCell.tsx —
// read-only adaptation. The source popover adds/removes assignees over gh
// write RPCs this repo's daemon does not serve, so the trigger keeps the
// source's button (avatar stack, `-` when unassigned, ChevronDown) and the
// popover lists the work item's current assignees instead of offering the
// assignable-user search.
import { useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { cn } from "../../cn";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { GitHubUserAvatar } from "../../github-user-avatar";
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
  const [open, setOpen] = useState(false);
  const assignees = item.assignees ?? [];
  const emptyLabel = item.type === "pr" ? "Assign pull request" : "Assign issue";
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            assignees.length ? `Assigned to ${assignees.map((a) => a.login).join(", ")}` : emptyLabel
          }
          aria-busy={startBusy}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
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
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="popover-scroll-content scrollbar-sleek w-64 p-1"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {assignees.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">No assignees.</div>
        ) : (
          assignees.map((assignee) => (
            <div
              key={assignee.login}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
            >
              <GitHubUserAvatar
                login={assignee.login}
                name={assignee.name}
                avatarUrl={assignee.avatarUrl}
                className="size-5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{assignee.login}</span>
                {assignee.name ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {assignee.name}
                  </span>
                ) : null}
              </span>
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
