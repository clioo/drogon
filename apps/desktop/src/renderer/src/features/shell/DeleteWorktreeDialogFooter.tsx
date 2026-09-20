/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/DeleteWorktreeDialogFooter.tsx
   (adapter: MVP subset — no batch, lineage-delete-all or force-recovery
   paths; the footer keeps the source's Cancel/Delete shape, autofocused
   destructive confirm, and deleting labels. Uses this repo's Button.) */
import type { Ref } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";

export function DeleteWorktreeDialogFooter({
  isDeleting,
  onCancel,
  onDelete,
  confirmButtonRef,
}: {
  isDeleting: boolean;
  onCancel: () => void;
  onDelete: () => void;
  confirmButtonRef: Ref<HTMLButtonElement>;
}) {
  // Both rows are explicitly `type="button"`. A bare <button> inside the
  // dialog's <form> defaults to `type="submit"`, so every click ran its own
  // onClick *and* the form's onSubmit: Delete sent two `worktree.remove`
  // calls (the second answering `not_found` over the first one's success),
  // and Cancel submitted the delete it exists to decline. The form keeps its
  // onSubmit for the keyboard path.
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={isDeleting}
      >
        Cancel
      </Button>
      <Button
        ref={confirmButtonRef}
        type="button"
        variant="destructive"
        onClick={onDelete}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Trash2 />
        )}
        {isDeleting ? "Deleting..." : "Delete Workspace"}
      </Button>
    </>
  );
}
