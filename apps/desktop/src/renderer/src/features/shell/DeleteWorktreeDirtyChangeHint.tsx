/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/DeleteWorktreeDirtyChangeHint.tsx
   (verbatim structure, classes and tooltip copy; the count text comes
   from this repo's delete-worktree-dirty-change-counts helper.) */
import { AlertTriangle } from "lucide-react";
import { formatDirtyChangeLabel } from "./delete-worktree-dirty-change-counts";

export function DeleteWorktreeDirtyChangeHint({
  changeCount,
}: {
  changeCount: number | undefined;
}) {
  if (changeCount === undefined) {
    return null;
  }
  return (
    <div
      className="shell-delete-dirty-hint"
      title="Deleting this workspace permanently removes these changes from disk."
    >
      <AlertTriangle className="size-3 shrink-0" />
      <span className="min-w-0 truncate font-medium">
        {formatDirtyChangeLabel(changeCount)}
      </span>
    </div>
  );
}
