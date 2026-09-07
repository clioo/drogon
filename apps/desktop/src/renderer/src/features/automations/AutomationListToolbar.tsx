// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationListToolbar.tsx.
// Adaptation: no host entries or runs-dashboard entry in the MVP (local
// automations only); search, filter menu, refresh and New Automation stay.
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "./automation-class-names";
import type { AutomationListArrowKey } from "./automation-list-keyboard-navigation";
import { clampAutomationListSearchQueryInput } from "./automation-list-projection";
import type { AutomationListFilter } from "./automation-list-projection";
import { AutomationListFilterMenu } from "./AutomationListFilterMenu";
import { AutomationListSearchField } from "./AutomationListSearchField";

type AutomationListToolbarProps = {
  /** Focus fallback for the list: the controls that produced the rows. */
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  listSearchQuery: string;
  isListSearchQueryTooLarge: boolean;
  onListSearchQueryChange: (query: string) => void;
  onSearchArrowNavigate: (key: AutomationListArrowKey) => void;
  onSearchEnter: () => void;
  listFilter: AutomationListFilter;
  onListFilterChange: (filter: AutomationListFilter) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  openCreateDialog: () => void;
};

export function AutomationListToolbar({
  toolbarRef,
  listSearchQuery,
  isListSearchQueryTooLarge,
  onListSearchQueryChange,
  onSearchArrowNavigate,
  onSearchEnter,
  listFilter,
  onListFilterChange,
  onRefresh,
  isRefreshing,
  openCreateDialog,
}: AutomationListToolbarProps): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-end justify-between gap-3 pb-4">
      <div ref={toolbarRef} className="flex min-w-0 flex-1 items-end gap-2">
        <AutomationListSearchField
          className="w-full max-w-xs"
          query={listSearchQuery}
          isTooLarge={isListSearchQueryTooLarge}
          onQueryChange={(query) =>
            onListSearchQueryChange(clampAutomationListSearchQueryInput(query))
          }
          onClear={() => onListSearchQueryChange("")}
          onArrowNavigate={onSearchArrowNavigate}
          onEnter={onSearchEnter}
        />
        <AutomationListFilterMenu filter={listFilter} onChange={onListFilterChange} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh automations"
          title="Refresh automations"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="size-8 shrink-0 border border-border bg-background shadow-none hover:bg-muted/50 [&_svg]:size-4"
        >
          <RefreshCw className={cn(isRefreshing && "animate-spin")} />
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => openCreateDialog()}
          data-testid="automations-new"
          data-contextual-tour-target="automations-create"
        >
          <Plus className="size-4" />
          New Automation
        </Button>
      </div>
    </div>
  );
}
