// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/StatusCell.tsx — read-only
// adaptation. The source cell opens a mutation popover (close as
// completed/not planned/duplicate, merge, auto-merge) over gh write RPCs
// this repo's daemon does not serve, so the trigger keeps the source's
// button (state pill with ChevronDown) and the popover marks the work
// item's current state instead of offering state transitions.
import { useState } from "react";
import { Check, ChevronDown, CircleDot } from "lucide-react";
import { cn } from "../../cn";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { TaskPageGitHubWorkItemStateBadge } from "../../task-page-github-work-item-status-badge";
import type { TaskPageModelProps, TaskPageWorkItem } from "../../task-page-model";

export function GHStatusCell({
  item,
}: {
  item: TaskPageWorkItem;
  model: TaskPageModelProps["model"];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  if (item.type === "pr") {
    return <TaskPageGitHubWorkItemStateBadge item={item} />;
  }
  const closed = item.state === "closed";
  const current = closed ? ("closed" as const) : ("open" as const);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "group/status inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:brightness-125 hover:ring-1 hover:ring-white/10",
            closed
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
          )}
        >
          {closed ? null : <CircleDot className="size-2.5" />}
          <span>{closed ? "Closed" : "Open"}</span>
          <ChevronDown className="size-2.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-1"
        align="start"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {(["open", "closed"] as const).map((state) => {
          const active = current === state;
          return (
            <div
              key={state}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
              aria-current={active || undefined}
            >
              <span
                className={cn(
                  "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-input",
                )}
              >
                {active ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {state === "closed" ? "Closed" : "Open"}
              </span>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
