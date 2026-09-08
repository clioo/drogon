// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/ModeControls.tsx. GitHub-only
// adaptation: the source's Projects sub-mode has no daemon counterpart (no
// Projects board is served), so the kind switch is Issues/PRs with the
// source's labels and button classes; the project selector and the
// open-in-GitHub link keep the source's trigger classes.
import { Tooltip, TooltipTrigger, TooltipContent } from "../../ui/tooltip";
import { Button } from "../../../../components/ui/button";
import { ExternalLink } from "lucide-react";
import { cn } from "../../cn";
import type { TaskPageModelProps } from "../../task-page-model";

export function TaskPageGitHubModeControls({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const { taskSource, taskPickerRepos, repoSelection, setRepoSelection, selectedGitHubRepoExternalLink, githubModeButtons, githubTaskKind, onSelectGithubTaskKind, openExternal } =
    model;
  return taskSource === "github" ? (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 text-xs">
        {githubModeButtons.map((mode) => {
          const active = githubTaskKind === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onSelectGithubTaskKind(mode.id)}
              aria-pressed={active}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition",
                active
                  ? "border-border/50 bg-foreground/90 text-background shadow-xs"
                  : "border-border/60 bg-muted/50 text-foreground shadow-xs hover:bg-muted/70",
              )}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      {/* Why: Project rows are repo-scoped, so the selection must stay visible in both GitHub modes. */}
      <div className="min-w-0 max-w-[220px] shrink-0">
        {/* Why: a native select keeps the picker dependency-free; the trigger
        classes mirror the source combobox (h-8, muted surface, text-xs). */}
        <select
          aria-label="Project"
          value={repoSelection.values().next().value ?? ""}
          onChange={(event) => {
            setRepoSelection(new Set([event.target.value]));
          }}
          className="h-8 w-auto max-w-[220px] cursor-pointer rounded-md border border-border/50 bg-muted/50 px-2 text-xs font-medium shadow-sm transition hover:bg-muted/50 focus:ring-2 focus:ring-ring/20 focus:outline-none"
        >
          {taskPickerRepos.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.name}
            </option>
          ))}
        </select>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => {
              // Why: main denies window.open (setWindowOpenHandler), so the
              // source's shell.openUrl becomes this repo's shell bridge —
              // the repo opens in the system browser, like New GitHub issue.
              if (!selectedGitHubRepoExternalLink?.url) {
                return;
              }
              void openExternal?.(selectedGitHubRepoExternalLink.url);
            }}
            aria-label={
              selectedGitHubRepoExternalLink
                ? `Open ${selectedGitHubRepoExternalLink.label} in GitHub`
                : "Select one GitHub project to open in GitHub"
            }
            className="h-8 w-8 rounded-md border-border/50 bg-muted/50 text-foreground shadow-sm transition hover:bg-muted/50"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {selectedGitHubRepoExternalLink
            ? `Open ${selectedGitHubRepoExternalLink.label} in GitHub`
            : "Select one project to open in GitHub"}
        </TooltipContent>
      </Tooltip>
    </div>
  ) : null;
}
