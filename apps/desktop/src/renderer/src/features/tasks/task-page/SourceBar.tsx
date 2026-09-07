// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/SourceBar.tsx. GitHub-only: the
// Linear scope selector and Jira site select do not exist here; the source
// icon row renders the single GitHub option, active.
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { Button } from "../../../components/ui/button";
import { X } from "lucide-react";
import { cn } from "../cn";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageSourceBar({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const {
    closeTaskPage,
    visibleSourceOptions,
    taskSource,
    taskSourceAvailabilityNoticeByProvider,
    taskSourceContextSummary,
  } = model;
  return (
    <div className="flex items-center justify-between gap-2">
      <div
        className="flex min-w-0 flex-wrap items-center gap-2"
        data-contextual-tour-target="tasks-source-filters"
      >
        {/* Why: Close is anchored left with the source icons for one compact band, clear of the app sidebar on the right. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full"
              onClick={closeTaskPage}
              aria-label="Close tasks"
            >
              <X className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            Close · Esc
          </TooltipContent>
        </Tooltip>
        <div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
        {visibleSourceOptions.map((source) => {
          const active = taskSource === source.id;
          const sourceAvailabilityNotice =
            taskSourceAvailabilityNoticeByProvider[source.id] ?? null;
          const sourceDisabled = source.disabled;
          return (
            <Tooltip key={source.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={sourceDisabled}
                  data-task-source={source.id}
                  aria-label={sourceAvailabilityNotice?.label ?? source.label}
                  aria-pressed={active}
                  className={cn(
                    "group flex h-8 w-8 items-center justify-center rounded-md border transition",
                    active
                      ? "border-foreground/40 bg-muted/70 text-foreground shadow-sm"
                      : "border-border/40 bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    sourceDisabled && "cursor-not-allowed opacity-55",
                  )}
                >
                  <source.Icon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {sourceAvailabilityNotice?.label ?? source.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
        <div
          className="hidden min-w-0 max-w-[min(420px,40vw)] items-center rounded-md border border-border/50 bg-muted/35 px-2 py-1 text-xs text-muted-foreground sm:flex"
          title={taskSourceContextSummary.title}
        >
          <span className="truncate">{taskSourceContextSummary.label}</span>
        </div>
      </div>
    </div>
  );
}
