/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/DeleteWorktreeWarningPanels.tsx
   (adapter: MVP subset — the reference also panels lineage and delete
   errors; this repo keeps the folder/implicit-workspace panel: those
   rows remove only the Drogon registration and must never look like a
   git worktree delete.) */
import { AlertTriangle } from "lucide-react";

export function DeleteWorktreeWarningPanels({
  isFolderWorkspaceDelete,
}: {
  isFolderWorkspaceDelete: boolean;
}) {
  if (!isFolderWorkspaceDelete) {
    return null;
  }
  return (
    <div className="shell-delete-warning-panel">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          This is the folder workspace (the project directory itself).{" "}
          Removing it only drops the Drogon registration; files on disk are
          untouched.
        </div>
      </div>
    </div>
  );
}
