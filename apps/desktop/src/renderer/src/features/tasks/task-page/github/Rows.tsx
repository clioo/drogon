// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/Rows.tsx. Adaptations: the
// mutation popovers behind the cells (StatusCell writes, AssigneesCell
// writes, ReviewCell requests, MergeCell merges) have no daemon counterpart,
// so the cells render their read-only forms; row selection keeps this page's
// existing behavior (start a worktree for the issue or PR, then open its
// terminal). The PR branch mirrors the source's PR variant: draft-aware id
// pill, state badge, head→base context, Reviewers/Checks/Merge columns and
// the Start/Resume split button.
import {
  CircleDot,
  GitPullRequest,
  GitPullRequestDraft,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  EllipsisVertical,
  Plus,
} from "lucide-react";
import { cn } from "../../cn";
import {
  GITHUB_TASK_STICKY_ID_CELL_CLASS,
  GITHUB_TASK_STICKY_TITLE_CELL_CLASS,
  formatRelativeTime,
} from "../../task-page-source-context";
import {
  getTaskPageGitHubPRIconTone,
  isTaskPageGitHubDraftPR,
} from "../../task-page-github-work-item-status";
import { TaskPageGitHubWorkItemStateBadge } from "../../task-page-github-work-item-status-badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../ui/tooltip";
import RepoBadgeLabel from "../../repo-badge-label";
import { GHAssigneesCell } from "./AssigneesCell";
import { GHStatusCell } from "./StatusCell";
import { PRReviewCell } from "./ReviewCell";
import { PRChecksCell } from "./ChecksCell";
import { PRMergeCell } from "./MergeCell";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu";
import { Button } from "../../../../components/ui/button";
import { ButtonGroup } from "../../../../components/ui/button-group";
import type { TaskPageModelProps, TaskPageWorkItem } from "../../task-page-model";

export function TaskPageGitHubRows({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const {
    repoMap,
    selectedRepos,
    filteredWorkItems,
    showGitHubTaskSkeletons,
    showPRManagementColumns,
    githubTaskGridClass,
    handleStartWorkItem,
    taskLinks,
    startBusyNumber,
  } = model;
  return (
    <div className="divide-y divide-border/40">
      {!showGitHubTaskSkeletons &&
        filteredWorkItems.map((item: TaskPageWorkItem) => {
          const itemRepo = repoMap.get(item.repoId) ?? null;
          const attachedWorkspace = taskLinks.find(
            (link) => link.issueNumber === item.number,
          );
          const attachedWorkspaceLabel = attachedWorkspace
            ? `#${attachedWorkspace.issueNumber} · ${attachedWorkspace.branch}`
            : null;
          const isPR = item.type === "pr";
          const githubTaskIdPill = (
            <span
              // Why: no fill — a muted wash on the pill stacks on the
              // row's hover:bg-accent and reads as a second hover tint.
              className="inline-flex items-center gap-1 rounded-md border border-border/40 px-1.5 py-0.5 text-muted-foreground"
              aria-label={`${isPR ? (isTaskPageGitHubDraftPR(item) ? "Draft pull request" : "Pull request") : "Issue"} #${item.number}`}
            >
              {isPR ? (
                isTaskPageGitHubDraftPR(item) ? (
                  <GitPullRequestDraft
                    className={cn("size-3", getTaskPageGitHubPRIconTone(item))}
                    aria-hidden="true"
                  />
                ) : (
                  <GitPullRequest
                    className={cn("size-3", getTaskPageGitHubPRIconTone(item))}
                    aria-hidden="true"
                  />
                )
              ) : (
                <CircleDot className="size-3" aria-hidden="true" />
              )}
              <span className="font-mono text-[11px] font-normal">#{item.number}</span>
            </span>
          );
          const startLabel = attachedWorkspace
            ? isPR
              ? "Resume workspace attached to PR"
              : "Open workspace attached to issue"
            : isPR
              ? "Start workspace from PR"
              : "Start workspace from issue";
          return (
            // Why: clickable div not a <button> — it nests buttons, and button-in-button is invalid HTML that breaks hydration.
            <div
              // Why: key on repoId+item.id — repos sharing an upstream reuse item.id, so a bare key collides and React silently drops rows.
              key={`${item.repoId}:${item.id}`}
              role="button"
              tabIndex={0}
              onClick={() => handleStartWorkItem(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleStartWorkItem(item);
                }
              }}
              className={cn(
                // Why: sticky ID/Title paint the same bg-background /
                // hover:bg-accent pair (with transition-colors) so the
                // left columns don't flash a separate hover wash.
                // Grid stretch (default) keeps sticky fills full-height.
                "group/github-task-row grid min-h-12 cursor-pointer gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                githubTaskGridClass,
              )}
            >
              <div className={GITHUB_TASK_STICKY_ID_CELL_CLASS}>
                {isTaskPageGitHubDraftPR(item) ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{githubTaskIdPill}</TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      Draft
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  githubTaskIdPill
                )}
              </div>

              <div className={GITHUB_TASK_STICKY_TITLE_CELL_CLASS}>
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="truncate text-[13px] font-medium text-foreground">{item.title}</h3>
                  {isPR && item.state !== "open" && item.state !== "draft" ? (
                    <TaskPageGitHubWorkItemStateBadge
                      item={item}
                      className="shrink-0 px-1.5 py-0"
                    />
                  ) : null}
                  {selectedRepos.length > 1 && itemRepo ? (
                    // Why: disambiguate rows in the merged multi-repo list; a single-repo view doesn't need it.
                    <RepoBadgeLabel
                      name={itemRepo.displayName}
                      color={itemRepo.badgeColor}
                      badgeClassName="size-1.5"
                      className="shrink-0 text-[11px] text-muted-foreground"
                    />
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted-foreground">
                  <span>{item.author ?? "unknown author"}</span>
                  {selectedRepos.length === 1 && itemRepo ? (
                    <span>{itemRepo.displayName}</span>
                  ) : null}
                  {isPR && item.state === "draft" ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Draft</span>
                    </>
                  ) : null}
                  {isPR && item.headRefName ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="truncate">
                        {item.headRefName}
                        {item.baseRefName ? ` → ${item.baseRefName}` : null}
                      </span>
                    </span>
                  ) : null}
                  {attachedWorkspaceLabel ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <span className="truncate">{attachedWorkspaceLabel}</span>
                    </span>
                  ) : null}
                  {item.labels.slice(0, 3).map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-border/40 bg-muted/30 px-1.5 py-0 text-[10px] text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              {!showPRManagementColumns ? (
                <div className="min-w-0 flex items-center text-xs text-muted-foreground">
                  <GHAssigneesCell item={item} model={model} startBusy={startBusyNumber === item.number} />
                </div>
              ) : null}

              {showPRManagementColumns ? (
                <>
                  <div className="flex min-w-0 items-center">
                    <PRReviewCell item={item} />
                  </div>

                  <div className="flex min-w-0 items-center">
                    <PRChecksCell item={item} />
                  </div>

                  <div className="flex min-w-0 items-center">
                    <PRMergeCell item={item} />
                  </div>
                </>
              ) : (
                <div className="flex items-center">
                  <GHStatusCell item={item} model={model} />
                </div>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center text-[11px] text-muted-foreground">
                    {formatRelativeTime(item.updatedAt)}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {new Date(item.updatedAt).toLocaleString()}
                </TooltipContent>
              </Tooltip>

              <div className="flex items-center justify-start gap-1 lg:justify-end">
                {isPR ? (
                  <DropdownMenu modal={false}>
                    <ButtonGroup>
                      <Button
                        type="button"
                        variant={attachedWorkspace ? "default" : "outline"}
                        size="xs"
                        data-contextual-tour-target="tasks-start-workspace"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleStartWorkItem(item);
                        }}
                        className={cn(
                          "min-w-[72px] gap-1 font-semibold",
                          attachedWorkspace ? "shadow-xs" : "bg-background/80",
                        )}
                        aria-label={startLabel}
                      >
                        {attachedWorkspace ? "Resume" : "Start"}
                        <ArrowRight className="size-3" />
                      </Button>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant={attachedWorkspace ? "default" : "outline"}
                          size="icon-xs"
                          onClick={(event) => event.stopPropagation()}
                          className={cn(attachedWorkspace ? "shadow-xs" : "bg-background/80")}
                          aria-label="More PR actions"
                        >
                          <ChevronDown className="size-3" />
                        </Button>
                      </DropdownMenuTrigger>
                    </ButtonGroup>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      {attachedWorkspace ? (
                        <DropdownMenuItem onSelect={() => handleStartWorkItem(item)}>
                          <Plus className="size-4" />
                          Start new workspace
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => window.open(item.url, "_blank", "noopener")}>
                        <ExternalLink className="size-4" />
                        Open in browser
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    type="button"
                    // Why: Open resumes an existing workspace — solid primary reads stronger than outline Start (new workspace).
                    variant={attachedWorkspace ? "default" : "outline"}
                    size="sm"
                    data-contextual-tour-target="tasks-start-workspace"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleStartWorkItem(item);
                    }}
                    className="min-w-[72px] gap-1 font-semibold bg-background/80 shadow-xs"
                    aria-label={startLabel}
                  >
                    {attachedWorkspace ? "Open" : "Start"}
                    <ArrowRight className="size-3" />
                  </Button>
                )}
                {!isPR ? (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
                        aria-label="More actions"
                      >
                        <EllipsisVertical className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      {attachedWorkspace ? (
                        <DropdownMenuItem onSelect={() => handleStartWorkItem(item)}>
                          <Plus className="size-4" />
                          Start new workspace
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => window.open(item.url, "_blank", "noopener")}>
                        <ExternalLink className="size-4" />
                        Open in browser
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          );
        })}
    </div>
  );
}
