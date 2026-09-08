// MIT Copyright (c) 2026 Lovecast Inc.
// Shortcut status filter rail (#245): "Find shortcuts" search with a live
// match count and the All/Modified/Unassigned/Conflicts status filter nav.
//
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/ShortcutFilterRail.tsx
//     (ShortcutFilter vocabulary, SHORTCUT_FILTER_LABELS, matchesShortcutFilter,
//      matchesShortcutLocalSearch, the aside/nav DOM, copy and classes)
//   src/renderer/src/components/settings/shortcut-row-visibility.ts
//     (filter counts computed over the search-matched base so the numbers
//      stay stable while a status filter hides rows)
// Adapted: no i18n translate() wrappers, no settings-search keyword index
// (this repo's rows carry no searchKeywords), and the 2 KiB paste-size guard
// (shared/clipboard-text) is omitted — the guard has no Drogon counterpart.
import { Search, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { formatKeybindingList } from "../../../../shared/keybindings/labels";
import type { ShortcutListEntry } from "./shortcut-labels";

export type ShortcutFilter = "all" | "modified" | "unassigned" | "conflicts";

/** One row of the section's list: the entry plus its status annotations. */
export type ShortcutRowModel = ShortcutListEntry & {
  groupTitle: string;
  modified: boolean;
  warnings: readonly string[];
};

export const SHORTCUT_FILTER_LABELS: Record<ShortcutFilter, string> = {
  all: "All",
  modified: "Modified",
  unassigned: "Unassigned",
  conflicts: "Conflicts",
};

export function matchesShortcutFilter(
  row: ShortcutRowModel,
  filter: ShortcutFilter,
): boolean {
  switch (filter) {
    case "modified":
      return row.modified;
    case "unassigned":
      return row.bindings.length === 0;
    case "conflicts":
      return row.warnings.length > 0;
    case "all":
      return true;
  }
}

export function normalizeShortcutLocalSearchQuery(query: string): string | null {
  return query.trim().toLowerCase();
}

export function matchesShortcutLocalSearch(
  row: ShortcutRowModel,
  query: string,
  platform: "darwin" | "other",
): boolean {
  if (!query) {
    return true;
  }
  const kbPlatform = platform === "darwin" ? "darwin" : "linux";
  const searchableText = [
    row.title,
    row.id,
    row.groupTitle,
    formatKeybindingList(row.bindings, kbPlatform),
  ];
  return searchableText.some((value) => value.toLowerCase().includes(query));
}

export function ShortcutFilterRail({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  filterCounts,
  visibleCount,
  totalCount,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  filter: ShortcutFilter;
  onFilterChange: (value: ShortcutFilter) => void;
  filterCounts: Record<ShortcutFilter, number>;
  visibleCount: number;
  totalCount: number;
}): React.JSX.Element {
  const filters = (Object.keys(SHORTCUT_FILTER_LABELS) as ShortcutFilter[]).map(
    (id) => ({
      id,
      label: SHORTCUT_FILTER_LABELS[id],
      count: filterCounts[id],
    }),
  );

  return (
    <aside className="flex min-h-0 flex-col gap-5 xl:h-full">
      <div className="shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="shortcut-filter-search" className="text-xs font-medium">
            Find shortcuts
          </label>
          <span className="text-[11px] text-muted-foreground">
            {visibleCount}/{totalCount}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="shortcut-filter-search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search command or keys"
            className="h-8 pl-8 pr-8 text-sm"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear shortcut search"
              onClick={() => onQueryChange("")}
              className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>

      <nav aria-label="Shortcut status filters" className="shrink-0 space-y-2">
        <p className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          Status
        </p>
        <div className="grid gap-1">
          {filters.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onFilterChange(option.id)}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                filter === option.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <span className="truncate">{option.label}</span>
              <span className="text-[11px] tabular-nums opacity-80">
                {option.count}
              </span>
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );
}
