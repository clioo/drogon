/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/DeleteWorktreeTargetPreview.tsx
   (adapter: MVP subset — the reference renders batch lists with host
   labels and per-target delete spinners; this repo deletes one worktree
   at a time, so the single-target preview remains: display name, path,
   and the dirty-change hint.) */
import { useId } from "react";
import { DeleteWorktreeDirtyChangeHint } from "./DeleteWorktreeDirtyChangeHint";

export function DeleteWorktreeTargetPreview({
  displayName,
  path,
  dirtyChangeCount,
}: {
  displayName: string;
  path: string;
  dirtyChangeCount: number | undefined;
}) {
  const targetIdPrefix = useId();
  const labelIds = {
    name: `${targetIdPrefix}-name`,
    path: `${targetIdPrefix}-path`,
  };
  return (
    <div
      role="region"
      aria-labelledby={`${labelIds.name} ${labelIds.path}`}
      className="shell-delete-target-preview"
    >
      <div id={labelIds.name} className="break-all font-medium text-foreground">
        {displayName}
      </div>
      <div id={labelIds.path} className="mt-1 break-all text-muted-foreground">
        {path}
      </div>
      <DeleteWorktreeDirtyChangeHint changeCount={dirtyChangeCount} />
    </div>
  );
}
