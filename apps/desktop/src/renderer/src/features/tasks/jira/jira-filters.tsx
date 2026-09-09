// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/jira/Filters.tsx — the preset pill
// row, the New Jira issue / Refresh icon buttons with tooltips, and the JQL
// search box (Enter commits, the composing guard is the fork's
// shouldSuppressEnterSubmit(..., false)) are the fork's; the fork's
// setTaskResumeState persistence rides this repo's jira resume storage and
// the dismissed-draft restore has no Drogon counterpart (R17-C declared).
import { cn } from "../cn";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "../ui/tooltip";
import { Button } from "../../../components/ui/button";
import { LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { Input } from "../../../components/ui/input";
import type { TaskPageModelProps } from "../task-page-model";

export function TaskPageJiraFilters({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const {
    jiraPresets,
    jiraLoading,
    jiraSearchInput,
    setJiraSearchInput,
    setAppliedJiraSearch,
    activeJiraPreset,
    onSelectJiraPreset,
    handleRefreshJiraIssues,
    jiraProjectsLoading,
    onOpenNewJiraIssue,
  } = model;
  return (
    <div className="rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {jiraPresets.map((preset) => {
            const active = !jiraSearchInput && activeJiraPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectJiraPreset(preset.id)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition",
                  active
                    ? "border-border/50 bg-foreground/90 text-background backdrop-blur-md"
                    : "border-border/50 bg-transparent text-foreground hover:bg-muted/50",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={onOpenNewJiraIssue}
                disabled={model.sortedAvailableJiraProjects.length === 0 || jiraProjectsLoading}
                aria-label="New Jira issue"
                className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
              >
                {jiraProjectsLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              New Jira issue
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefreshJiraIssues}
                disabled={jiraLoading}
                aria-label="Refresh Jira issues"
                className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
              >
                {jiraLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              Refresh Jira issues
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="relative min-w-[320px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={jiraSearchInput}
            onChange={(e) => setJiraSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Why: the fork's shouldSuppressEnterSubmit(..., false) — an
                // IME composition must never commit a half-composed query.
                if (e.nativeEvent.isComposing) {
                  return;
                }
                e.preventDefault();
                const trimmed = jiraSearchInput.trim();
                setJiraSearchInput(trimmed);
                setAppliedJiraSearch(trimmed);
                handleRefreshJiraIssues();
              }
            }}
            placeholder="Jira JQL, e.g. project = ABC AND statusCategory != Done"
            className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
          />
          {jiraSearchInput ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setJiraSearchInput("");
                setAppliedJiraSearch("");
                handleRefreshJiraIssues();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
