/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorerNameFilter.tsx
   (filter input) and FileExplorerQueryStrip.tsx (strip container).
   Adapted: the local Button has no `icon-xs` size, so the clear button uses
   the icon size with tighter padding; the strip renders only the names
   filter (the Contents search view is out of MVP scope, so there is no
   view switch to sit under it). */

import { ListFilter, Loader2, X } from "lucide-react";
import { Button } from "../../components/ui/button";

export function FileExplorerNameFilter({
  query,
  loading = false,
  onQueryChange,
  onClear,
}: {
  query: string;
  loading?: boolean;
  onQueryChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      className="flex h-7 items-center gap-1 rounded-sm border border-border bg-input/50 px-1.5 focus-within:border-ring"
      data-ignore-file-explorer-keys="true"
    >
      <ListFilter className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        type="text"
        className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
        aria-label="Find files"
        placeholder="Find files"
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        spellCheck={false}
      />
      {loading ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
      ) : null}
      {query ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-auto w-auto rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear file filter"
          onClick={onClear}
        >
          <X className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

export function FileExplorerQueryStrip({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-2 py-1.5">
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
