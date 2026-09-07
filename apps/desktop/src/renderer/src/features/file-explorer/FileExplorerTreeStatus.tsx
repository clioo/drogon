/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorerTreeStatus.tsx.
   Copy kept verbatim; the filter-empty message comes from the tree pane's
   filtered projection (source: FileExplorerFilesTreePane). */

import { Loader2 } from "lucide-react";

export function FileExplorerTreeStatus({
  isLoading,
  error,
  isEmpty,
  emptyMessage,
}: {
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyMessage?: string;
}) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <p className="sidebar-empty">Loading workspace files…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
        Could not load files for this workspace: {error}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
        {emptyMessage ?? "No files in this workspace"}
      </div>
    );
  }

  return null;
}
