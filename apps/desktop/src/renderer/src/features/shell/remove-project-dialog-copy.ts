/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported copy from Orca's
   src/renderer/src/components/sidebar/RemoveFolderDialog.tsx (adapter:
   local projects only — the MVP has no SSH/VM hosts, so only the local
   description survives, with the product name adapted per this repo's
   "from Drogon" precedent. The source reports no worktree/session counts
   and refuses nothing, so the daemon's `project.remove` — registration
   only, never files — already matches the dialog exactly. Pure,
   unit-tested.

   User-feature-closure item 3: a standalone quick session ("Chat") is the
   one project.remove target where that "still on your disk" claim is
   false — cleanup_quick_session_scratch (project.rs) deletes its
   app-owned scratch folder as part of the same removal. The confirmation
   copy must say so, not repeat the registration-only claim that applies
   to every other project kind. */

export function getRemoveProjectDialogCopy(
  displayName: string,
  isQuickSession = false,
): {
  title: string;
  targetLabel: string;
  targetClassName: string;
  descriptionBeforeName: string;
  descriptionAfterName: string;
  cancelLabel: string;
  confirmLabel: string;
} {
  if (isQuickSession) {
    return {
      title: "Delete Chat",
      targetLabel: displayName,
      targetClassName: "break-all font-medium text-foreground",
      descriptionBeforeName: "This permanently deletes ",
      descriptionAfterName:
        ", including its files, and stops its running sessions. This cannot be undone. Other chats and projects are never affected.",
      cancelLabel: "Cancel",
      confirmLabel: "Delete",
    };
  }
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
