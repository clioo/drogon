// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/Filters.tsx. Adaptations for
// this repo's daemon: the search-qualifier preset row is literal (Open,
// Assigned to me / Mine); closed/all come from the search text itself
// (`is:closed`, or no state qualifier) exactly like the fork, so the
// daemon `state` needs no second row. The PR filter dropdowns have no
// daemon counterpart, the new-issue button opens the repo's new-issue page
// in the system browser (no create RPC exists), and the search field
// commits through the same 300ms debounce.
import { cn } from "../../cn";
import { Search, X, LoaderCircle, RefreshCw, Plus } from "lucide-react";
import { Input } from "../../../../components/ui/input";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../ui/tooltip";
import { Button } from "../../../../components/ui/button";
import { getGitHubTaskKindPresets } from "../../task-page-localized-options";
import type { TaskPageModelProps } from "../../task-page-model";

export function TaskPageGitHubFilters({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const {
    activeTaskPreset,
    onSelectTaskPreset,
    taskSearchInput,
    setTaskSearchInput,
    appliedTaskSearch,
    handleTaskSearchChange,
    handleResetGithubTaskSearch,
    handleRefreshGithubTasks,
    githubTasksBusy,
    githubTaskKind,
    newGitHubIssueUrl,
    openExternal,
  } = model;
  return (
    // Why: top of the joined GitHub list card — pairs with the
    // table shell below (rounded-t-none border-t-0) as one surface.
    <div
      className="flex min-w-0 flex-col gap-2.5 rounded-md rounded-b-none border border-border/50 bg-muted/35 px-3 py-2.5"
      data-contextual-tour-target="tasks-search-presets"
    >
      <div className="flex flex-wrap gap-1.5">
        {getGitHubTaskKindPresets(githubTaskKind).map((option) => {
          const active = activeTaskPreset === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelectTaskPreset(option.id)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "border-border/50 bg-foreground/90 text-background shadow-xs"
                  : "border-border/60 bg-background text-foreground shadow-xs hover:bg-muted/60",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-github-items-search-input
            value={taskSearchInput}
            onChange={(event) => {
              setTaskSearchInput(event.target.value);
              handleTaskSearchChange(event.target.value);
            }}
            placeholder={
              githubTaskKind === "pulls"
                ? "Search GitHub PRs..."
                : "Search GitHub issues..."
            }
            className="h-8 rounded-md border-border/60 bg-background pl-8 pr-8 text-xs text-foreground shadow-xs"
          />
          {taskSearchInput || appliedTaskSearch ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={handleResetGithubTaskSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2" data-contextual-tour-target="tasks-actions">
          {/* Source copy and placement (Filters.tsx new-issue button): the
          in-app composer has no daemon counterpart (tasks.* serves no
          create RPC), so the button opens the repo's new-issue page in
          the system browser instead — filing stays on GitHub, never a
          local create. Disabled only with no target repo, like the source. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (newGitHubIssueUrl) void openExternal?.(newGitHubIssueUrl);
                }}
                disabled={!newGitHubIssueUrl}
                title={
                  newGitHubIssueUrl
                    ? "New GitHub issue"
                    : "New GitHub issue is unavailable: select a GitHub project first"
                }
                aria-label="New GitHub issue"
                className="size-8 border-border/60 bg-background text-foreground shadow-xs hover:bg-muted/60"
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              New GitHub issue
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefreshGithubTasks}
                disabled={githubTasksBusy}
                aria-busy={githubTasksBusy}
                aria-label={githubTasksBusy ? "Refreshing GitHub work" : "Refresh GitHub work"}
                className="size-8 cursor-pointer border-border/60 bg-background text-foreground shadow-xs hover:bg-muted/60 disabled:pointer-events-auto disabled:cursor-wait"
              >
                {githubTasksBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {githubTasksBusy ? "Refreshing GitHub work…" : "Refresh GitHub work"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
