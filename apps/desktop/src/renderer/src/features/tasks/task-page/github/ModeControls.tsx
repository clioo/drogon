// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/ModeControls.tsx. GitHub-only
// adaptation: the Issues/PRs/Projects sub-mode buttons do not exist here
// (the daemon serves GitHub issues only), so the controls are the project
// selector and the open-in-GitHub link, with the source's trigger classes.
import { Tooltip, TooltipTrigger, TooltipContent } from "../../ui/tooltip";
import { Button } from "../../../../components/ui/button";
import { ExternalLink } from "lucide-react";
import type { TaskPageModelProps } from "../../task-page-model";

export function TaskPageGitHubModeControls({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const { taskSource, taskPickerRepos, repoSelection, setRepoSelection, selectedGitHubRepoExternalLink } =
    model;
  return taskSource === "github" ? (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
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
              if (!selectedGitHubRepoExternalLink?.url) {
                return;
              }
              window.open(selectedGitHubRepoExternalLink.url, "_blank", "noopener");
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
