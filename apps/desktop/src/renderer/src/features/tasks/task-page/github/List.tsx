// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/github/List.tsx. Adaptations: the
// scroll-position store is replaced by a local ref (page changes reset the
// scroll), and the per-repo partial-failure rows collapse into the single
// repo error banner this daemon can produce.
import { cn } from "../../cn";
import {
  GITHUB_TASK_HEADER_SURFACE_CLASS,
  GITHUB_TASK_STICKY_ID_HEADER_CLASS,
  GITHUB_TASK_STICKY_TITLE_HEADER_CLASS,
} from "../../task-page-source-context";
import { LoaderCircle } from "lucide-react";
import { TaskPageGitHubRows } from "./Rows";
import { PaginationBar } from "../PaginationBar";
import type { TaskPageModelProps } from "../../task-page-model";

export function TaskPageGitHubList({
  model,
}: TaskPageModelProps): React.JSX.Element | null {
  const {
    githubEmptyState,
    tasksLoading,
    tasksError,
    githubUnavailable,
    currentPage,
    totalPages,
    loadingTargetPage,
    taskLinks,
    showGitHubTaskSkeletons,
    showPRManagementColumns,
    githubTaskGridClass,
    filteredWorkItems,
    handleLoadPage,
    githubListScrollRef,
  } = model;
  return (
    // Why: bottom of the joined GitHub list card — flush under the filter
    // chrome (no gap, no top border/radius) so toolbar + table read as one.
    <div className="flex min-h-0 min-w-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
      <div
        ref={githubListScrollRef}
        data-task-list-scroll="github"
        className="min-h-0 flex-initial overflow-auto scrollbar-sleek scrollbar-sleek-lg"
        style={{
          scrollbarGutter: "stable",
        }}
      >
        <div
          // Why: z-40 must beat the rows' sticky left cells (z-20); this stacking context's z sets the whole header's level.
          className={cn(
            "sticky top-0 z-40 grid h-8 gap-3 border-b border-border/50 px-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground [&>span]:flex [&>span]:items-center",
            GITHUB_TASK_HEADER_SURFACE_CLASS,
            githubTaskGridClass,
          )}
        >
          <span className={GITHUB_TASK_STICKY_ID_HEADER_CLASS}>ID</span>
          <span className={GITHUB_TASK_STICKY_TITLE_HEADER_CLASS}>Title / Context</span>
          {showPRManagementColumns ? (
            <>
              <span>Reviewers</span>
              <span>Checks</span>
              <span>Merge</span>
            </>
          ) : (
            <>
              <span>Assignees</span>
              <span>Status</span>
            </>
          )}
          <span>Updated</span>
          <span />
        </div>

        {tasksError ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {tasksError}
          </div>
        ) : null}

        {!tasksError && githubUnavailable ? (
          // Why: name the GitHub outage explicitly so an empty list isn't misread as a Drogon bug; takes priority over the count banner.
          <div
            role="alert"
            className="border-b border-border/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            GitHub data is temporarily unavailable. Its API may be down, rate-limited, or
            unreachable. Please try again shortly.
          </div>
        ) : null}

        {showGitHubTaskSkeletons ? (
          // Why: render enough shimmer rows to fill a typical viewport
          // so the table doesn't visibly grow when results land. A
          // 3-row stub jumps to ~30 real rows; matching the steady-
          // state height keeps layout stable across the load.
          <div className="divide-y divide-border/40">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={cn("grid min-h-12 gap-3 px-3 py-2.5", githubTaskGridClass)}>
                <div className="sticky left-3 z-20 flex items-center before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3 before:bg-inherit bg-background transition-colors">
                  <div className="h-6 w-16 animate-pulse rounded-md bg-muted/70" />
                </div>
                <div className="sticky left-[92px] z-20 flex min-w-0 flex-col justify-center border-r border-border/40 pr-2 before:absolute before:-left-2 before:top-0 before:bottom-0 before:w-2 before:bg-inherit bg-background transition-colors">
                  <div className="h-3.5 w-3/5 animate-pulse rounded bg-muted/70" />
                  <div className="mt-1.5 h-3 w-2/5 animate-pulse rounded bg-muted/60" />
                </div>
                <div className="flex items-center">
                  <div className="h-5 w-14 animate-pulse rounded-full bg-muted/70" />
                </div>
                <div className="flex items-center">
                  <div className="h-3 w-20 animate-pulse rounded bg-muted/60" />
                </div>
                <div className="flex items-center">
                  <div className="h-3 w-20 animate-pulse rounded bg-muted/60" />
                </div>
                <div className="flex items-center justify-start lg:justify-end">
                  <div className="h-7 w-16 animate-pulse rounded-md bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Why: suppress the generic empty state when any error banner is
                    visible. Showing "No matching GitHub work" next to an
                    error is contradictory and misleads the user into thinking
                    they typed the wrong query. */}
        {!showGitHubTaskSkeletons &&
        filteredWorkItems.length === 0 &&
        !tasksError &&
        !githubUnavailable ? (
          <div className="px-4 py-10 text-center">
            <p className="text-base font-medium text-foreground">{githubEmptyState.title}</p>
            <p className="mt-2 text-sm text-muted-foreground">{githubEmptyState.description}</p>
          </div>
        ) : null}

        <TaskPageGitHubRows model={model} />
      </div>

      {/* Why: pagination sits outside the scroll container so it
                  remains pinned at the bottom of the panel rather than
                  hiding below the last row inside the scrolling region. */}
      {filteredWorkItems.length > 0 && !showGitHubTaskSkeletons && totalPages > 1 ? (
        <div className="flex-none border-t border-border/50 bg-background">
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            loadingTarget={loadingTargetPage}
            onPageChange={(page) => {
              // Why: the daemon serves any page directly, so every click
              // dispatches; the scroll container resets to the top like the
              // source's uncached path.
              if (githubListScrollRef.current) {
                githubListScrollRef.current.scrollTop = 0;
              }
              handleLoadPage(page);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
