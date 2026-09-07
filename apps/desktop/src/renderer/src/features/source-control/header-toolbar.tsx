// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/panel/header-toolbar.tsx
// (filter toggle + expanded filter input + overflow menu + branch context
// row). Adapter: the Create-PR/hosted-review toolbar slots have no MVP
// backend here — Create PR lives in the sync row — so the collapsed toolbar
// is refresh + filter + overflow; the branch row below keeps the source's
// placement and spacing.
import React, { useCallback, useEffect, useRef } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";
import { cn } from "./panel-class-names";
import { SourceControlBranchContextRow } from "./branch-context-row";
import { SourceControlHeaderOverflowMenu } from "./header-overflow-menu";
import type { SourceControlViewMode } from "./section-file-list";

export function SourceControlHeaderToolbar({
  filterQuery,
  filterExpanded,
  onFilterQueryChange,
  onFilterExpandedChange,
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
}: {
  filterQuery: string;
  filterExpanded: boolean;
  onFilterQueryChange: (value: string) => void;
  onFilterExpandedChange: (expanded: boolean) => void;
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
            {/* Why: keep filter/overflow pinned right without stretching the refresh action. */}
            <span className="min-w-0 flex-1" aria-hidden="true" />
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className="inline-flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                    disabled={refreshDisabled}
                    onClick={onRefresh}
                    aria-label="Refresh source control status"
                  >
                    <RefreshCw className={cn("size-3.5", refreshDisabled && "animate-spin")} />
                  </Button>
                </span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="bottom" sideOffset={6} className="tooltip">
                  Refresh source control status
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
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
        />
      </div>
    </div>
  );
}
