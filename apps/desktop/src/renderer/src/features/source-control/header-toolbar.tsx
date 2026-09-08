// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/panel/header-toolbar.tsx
// (Create-PR toolbar button + filter toggle + expanded filter input +
// overflow menu + branch context row). Adapter: hosted-review probes,
// base refs and conflict state have no MVP backend, so the Create-PR rule
// is expressed over the daemon's upstream status (see create-pr-action.ts);
// manual refresh lives in the overflow menu, like the fork's Refresh
// branch compare entry — the collapsed toolbar keeps exactly the fork's
// slots: Create PR, filter, overflow.
import React, { useCallback, useEffect, useRef } from "react";
import { GitPullRequestArrow, Loader2, Search, X } from "lucide-react";
import { Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";
import { cn } from "./panel-class-names";
import { SourceControlBranchContextRow } from "./branch-context-row";
import { SourceControlHeaderOverflowMenu } from "./header-overflow-menu";
import type { CreatePrToolbarAction } from "./create-pr-action";
import type { SourceControlViewMode } from "./section-file-list";

function CreatePrHeaderButton({
  action,
  isCreatingPr,
  onClick,
}: {
  action: CreatePrToolbarAction;
  isCreatingPr: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className="inline-flex shrink-0">
          <Button
            type="button"
            size="xs"
            disabled={action.disabled || isCreatingPr}
            onClick={onClick}
            className="h-6 shrink-0 px-2 text-[11px]"
            title={action.title}
            aria-label={action.label}
          >
            {isCreatingPr ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitPullRequestArrow className="size-3.5" aria-hidden="true" />
            )}
            {action.label}
          </Button>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="bottom" sideOffset={6} className="tooltip max-w-72">
          {action.title}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function SourceControlHeaderToolbar({
  filterQuery,
  filterExpanded,
  onFilterQueryChange,
  onFilterExpandedChange,
  createPrAction,
  isCreatingPr,
  onCreatePr,
  sourceControlViewMode,
  onToggleViewMode,
  onRefresh,
  refreshDisabled,
  branchHead,
  upstream,
  ahead,
  behind,
  lineTotalAdded,
  lineTotalRemoved,
  reviewUrl,
  onOpenReviewPage,
}: {
  filterQuery: string;
  filterExpanded: boolean;
  onFilterQueryChange: (value: string) => void;
  onFilterExpandedChange: (expanded: boolean) => void;
  createPrAction: CreatePrToolbarAction | null;
  isCreatingPr: boolean;
  onCreatePr: () => void;
  sourceControlViewMode: SourceControlViewMode;
  onToggleViewMode: () => void;
  onRefresh: () => void;
  refreshDisabled: boolean;
  branchHead: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  lineTotalAdded: number;
  lineTotalRemoved: number;
  reviewUrl: string | null;
  onOpenReviewPage: () => void;
}): React.JSX.Element {
  const filterInputRef = useRef<HTMLInputElement>(null);
  const normalizedFilter = filterQuery.trim();
  const showCollapsedToolbar = !filterExpanded;

  const expandFilter = useCallback(() => {
    onFilterExpandedChange(true);
  }, [onFilterExpandedChange]);

  const collapseFilter = useCallback(() => {
    onFilterExpandedChange(false);
  }, [onFilterExpandedChange]);

  const clearAndCollapseFilter = useCallback(() => {
    onFilterQueryChange("");
    onFilterExpandedChange(false);
  }, [onFilterExpandedChange, onFilterQueryChange]);

  useEffect(() => {
    if (!filterExpanded) {
      return;
    }
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, [filterExpanded]);

  const filterToggleTitle = normalizedFilter ? `Filter: ${filterQuery}` : "Filter files by name";

  return (
    <div className="border-b border-border px-3 pt-1.5 pb-1">
      <div
        className={cn("flex min-w-0 items-center gap-1", filterExpanded && "w-full gap-1.5")}
        data-filter-expanded={filterExpanded ? "true" : "false"}
      >
        {showCollapsedToolbar ? (
          <>
            {createPrAction ? (
              <CreatePrHeaderButton
                action={createPrAction}
                isCreatingPr={isCreatingPr}
                onClick={onCreatePr}
              />
            ) : (
              <span className="min-w-0 flex-1" aria-hidden="true" />
            )}
            {createPrAction ? (
              // Why: keep filter/overflow pinned right without stretching Create PR.
              <span className="min-w-0 flex-1" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              data-testid="source-control-filter-toggle"
              className={cn(
                "relative inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                normalizedFilter && "bg-muted text-foreground",
              )}
              onClick={expandFilter}
              aria-label={filterToggleTitle}
              title={filterToggleTitle}
              aria-expanded={false}
            >
              <Search className="size-3.5" />
              {normalizedFilter ? (
                <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" />
              ) : null}
            </button>
            <SourceControlHeaderOverflowMenu
              sourceControlViewMode={sourceControlViewMode}
              onToggleViewMode={onToggleViewMode}
              onRefresh={onRefresh}
              refreshDisabled={refreshDisabled}
            />
          </>
        ) : (
          <>
            {/* Why: expanded filter owns the toolbar row so typing isn't squeezed
                beside overflow actions — collapse to reach those. */}
            <div className="flex min-w-0 w-full flex-1 items-center gap-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={filterInputRef}
                data-testid="source-control-filter-input"
                type="text"
                value={filterQuery}
                onChange={(event) => onFilterQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    collapseFilter();
                  }
                }}
                placeholder="Filter files…"
                className="min-w-0 w-full flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
                aria-label="Filter files…"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Clear and close filter"
              title="Clear and close filter"
              onClick={clearAndCollapseFilter}
            >
              <X className="size-3.5" />
            </Button>
          </>
        )}
      </div>

      <div className="mt-1">
        <SourceControlBranchContextRow
          branchHead={branchHead}
          upstream={upstream}
          ahead={ahead}
          behind={behind}
          lineTotalAdded={lineTotalAdded}
          lineTotalRemoved={lineTotalRemoved}
          onRefresh={onRefresh}
          reviewUrl={reviewUrl}
          onOpenReviewPage={onOpenReviewPage}
        />
      </div>
    </div>
  );
}
