// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationsListPanel.tsx.
// Adaptation: local rows only (no external/host catalog); the toolbar,
// filter pills, table header and empty states keep the reference structure.
import { useMemo, useRef } from "react";
import {
  createAutomationListEnterHandler,
  getAutomationListArrowNavigationTarget,
  type AutomationListArrowKey,
} from "./automation-list-keyboard-navigation";
import type {
  AutomationListFilter,
  ProjectedAutomationRow,
} from "./automation-list-projection";
import { isAutomationListFilterActive } from "./automation-list-projection";
import { AutomationListFilterPills } from "./AutomationListFilterMenu";
import { AutomationListLocalRows } from "./AutomationListLocalRows";
import { AutomationListTableHeader } from "./AutomationListTableHeader";
import { AutomationListToolbar } from "./AutomationListToolbar";
import {
  AutomationListEmptyStateView,
  AutomationTemplateEmptyState,
  type AutomationTemplate,
} from "./AutomationListEmptyView";

export type AutomationsListPanelProps = {
  loading: boolean;
  error: string | null;
  totalCount: number;
  rows: ProjectedAutomationRow[];
  searchActive: boolean;
  listSearchQuery: string;
  isListSearchQueryTooLarge: boolean;
  onListSearchQueryChange: (query: string) => void;
  listFilter: AutomationListFilter;
  onListFilterChange: (filter: AutomationListFilter) => void;
  selectedId: string | null;
  relativeNow: number;
  runningId: string | null;
  isRefreshing: boolean;
  onOpenRuns: () => void;
  onSelect: (id: string) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  openCreateDialog: (template?: AutomationTemplate) => void;
};

export function AutomationsListPanel(
  props: AutomationsListPanelProps,
): React.JSX.Element {
  const {
    loading,
    error,
    totalCount,
    rows,
    searchActive,
    listSearchQuery,
    isListSearchQueryTooLarge,
    onListSearchQueryChange,
    listFilter,
    onListFilterChange,
    selectedId,
    relativeNow,
    runningId,
    isRefreshing,
    onOpenRuns,
    onSelect,
    onRunNow,
    onEdit,
    onToggle,
    onDelete,
    onRefresh,
    openCreateDialog,
  } = props;
  const listRef = useRef<HTMLDivElement>(null);
  // The toolbar row is the focus fallback now that hosts live nowhere else.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const pendingKeyboardScrollRef = useRef(false);

  const visibleItems = useMemo(
    () => rows.map((row) => ({ kind: "local" as const, id: row.automation.id })),
    [rows],
  );

  const handleSearchArrowNavigate = (key: AutomationListArrowKey): void => {
    const next = getAutomationListArrowNavigationTarget({
      items: visibleItems,
      selectedId,
      key,
    });
    if (!next) {
      return;
    }
    if (selectedId === next.id) {
      listRef.current
        ?.querySelector('[data-current="true"]')
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    pendingKeyboardScrollRef.current = true;
    onSelect(next.id);
  };

  const handleSearchEnter = createAutomationListEnterHandler({
    items: visibleItems,
    selectedId,
    selectAutomationRow: (id) => {
      if (id !== null) onSelect(id);
    },
    onOpenDetail: () => {},
  });

  const listFilterActive = isAutomationListFilterActive(listFilter);
  const hasFilteredListItems = rows.length > 0;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-4 md:px-5"
      data-contextual-tour-target="automations-list"
    >
      <AutomationListToolbar
        toolbarRef={toolbarRef}
        listSearchQuery={listSearchQuery}
        isListSearchQueryTooLarge={isListSearchQueryTooLarge}
        onListSearchQueryChange={onListSearchQueryChange}
        onSearchArrowNavigate={handleSearchArrowNavigate}
        onSearchEnter={handleSearchEnter}
        listFilter={listFilter}
        onListFilterChange={onListFilterChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onOpenRuns={onOpenRuns}
        openCreateDialog={() => openCreateDialog()}
      />

      {listFilterActive ? (
        <div className="flex flex-wrap items-center gap-1.5 pb-3">
          <AutomationListFilterPills filter={listFilter} onChange={onListFilterChange} />
        </div>
      ) : null}

      <div
        ref={listRef}
        className="automations-table-container min-h-0 flex-1 overflow-auto"
      >
        {hasFilteredListItems ? (
          <div className="min-w-full w-fit">
            <AutomationListTableHeader />
            <div className="divide-y divide-border/50">
              <AutomationListLocalRows
                rows={rows}
                selectedId={selectedId}
                relativeNow={relativeNow}
                runningId={runningId}
                onSelect={onSelect}
                onRunNow={onRunNow}
                onEdit={onEdit}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            </div>
          </div>
        ) : (
          <AutomationListEmptyStateView
            loading={loading}
            error={error}
            totalCount={totalCount}
            visibleCount={rows.length}
            searchActive={searchActive}
            filterActive={listFilterActive}
          />
        )}

        {!loading && totalCount === 0 && error === null ? (
          <AutomationTemplateEmptyState onOpenCreate={openCreateDialog} />
        ) : null}
      </div>
    </section>
  );
}
