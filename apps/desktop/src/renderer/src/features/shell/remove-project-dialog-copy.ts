/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported copy from Orca's
   src/renderer/src/components/sidebar/RemoveFolderDialog.tsx (adapter:
   local projects only — the MVP has no SSH/VM hosts, so only the local
   description survives, with the product name adapted per this repo's
   "from Drogon" precedent. The source reports no worktree/session counts
   and refuses nothing, so the daemon's `project.remove` — registration
   only, never files — already matches the dialog exactly. Pure,
   unit-tested.) */

export function getRemoveProjectDialogCopy(displayName: string): {
  title: string;
  targetLabel: string;
  targetClassName: string;
  descriptionBeforeName: string;
  descriptionAfterName: string;
  cancelLabel: string;
  confirmLabel: string;
} {
  return {
    title: "Remove Project",
    targetLabel: displayName,
    targetClassName: "break-all font-medium text-foreground",
    descriptionBeforeName: "This only removes ",
    descriptionAfterName: " from Drogon. It is still on your disk.",
    cancelLabel: "Cancel",
    confirmLabel: "Remove",
  };
}
