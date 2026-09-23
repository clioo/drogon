/* MIT Copyright (c) 2026 Lovecast Inc.
   Confirm for a sidebar multi-selection delete. Shares the single-card
   DeleteWorktreeDialog's modal shell, destructive footer shape and force
   option, but names every target it is about to remove and reports a
   per-workspace failure list instead of one error line: a run that
   deletes four of five workspaces has to say which one refused and why,
   and the four that went already cannot be undone. */
import { useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";
import type { Worktree } from "../../../../shared/session-contract";
import {
  deletableTargets,
  getBulkDeleteDialogCopy,
  runBulkWorktreeDelete,
  type BulkDeleteFailure,
  type BulkWorktreeTarget,
} from "./worktree-bulk-actions";

export function BulkDeleteWorktreesDialog({
  targets,
  disabled,
  onSubmit,
  onDeleted,
  onClose,
}: {
  targets: readonly BulkWorktreeTarget[];
  disabled: boolean;
  /** The same per-worktree submit the single-card dialog uses. */
  onSubmit: (worktree: Worktree, force: boolean) => Promise<string | null>;
  /** Reports the ids that really went, so the selection can drop them. */
  onDeleted: (deletedIds: readonly string[]) => void;
  onClose: () => void;
}) {
  const [force, setForce] = useState(false);
  const [sending, setSending] = useState(false);
  const [failures, setFailures] = useState<readonly BulkDeleteFailure[]>([]);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const busy = disabled || sending;
  const copy = getBulkDeleteDialogCopy(targets);
  const deletable = deletableTargets(targets);
  // A retry after a partial failure only re-attempts what actually failed:
  // the successful deletes are gone, and re-submitting them would surface
  // "no such worktree" noise the user cannot act on.
  const pending =
    failures.length === 0
      ? deletable
      : deletable.filter((target) =>
          failures.some((failure) => failure.worktreeId === target.worktree.id),
        );

  const submit = async () => {
    setSending(true);
    try {
      const outcome = await runBulkWorktreeDelete({
        targets: pending,
        force,
        remove: onSubmit,
      });
      if (outcome.deletedIds.length > 0) onDeleted(outcome.deletedIds);
      setFailures(outcome.failures);
      if (outcome.failures.length === 0) onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-sm sm:max-w-sm"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Same rule as the single-card confirm: the user already chose
          // the destructive action, so Enter must confirm it rather than
          // land on Cancel.
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{copy.title}</DialogTitle>
        <form
          className="shell-dialog shell-delete-dialog shell-dialog-in-modal"
          aria-label={copy.title}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="shell-dialog-title">{copy.title}</p>
          <p className="shell-delete-dialog-description">{copy.description}</p>
          <div
            role="region"
            aria-label="Workspaces to delete"
            className="shell-delete-target-preview shell-bulk-delete-target-list"
          >
            <ul>
              {deletable.map((target) => (
                <li key={target.worktree.id}>
                  <span className="block break-all font-medium text-foreground">
                    {target.name}
                  </span>
                  <span className="block break-all text-muted-foreground">
                    {target.worktree.path}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {copy.protectedHint && (
            <p className="shell-delete-dialog-description text-muted-foreground">
              {copy.protectedHint}
            </p>
          )}
          <label className="shell-check-row" htmlFor="shell-bulk-delete-force">
            <input
              id="shell-bulk-delete-force"
              type="checkbox"
              checked={force}
              disabled={busy}
              onChange={(event) => setForce(event.target.checked)}
            />
            Force: remove even with uncommitted changes or running terminals
          </label>
          {failures.length > 0 && (
            <div className="shell-form-error shell-bulk-delete-failures" role="alert">
              <p>
                {failures.length === deletable.length
                  ? "No workspace was deleted."
                  : "Some workspaces were not deleted."}
              </p>
              <ul>
                {failures.map((failure) => (
                  <li key={failure.worktreeId}>
                    {failure.name}: {failure.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-actions">
            <Button variant="outline" onClick={onClose} disabled={sending}>
              {failures.length > 0 ? "Close" : "Cancel"}
            </Button>
            <Button
              ref={confirmButtonRef}
              variant="destructive"
              type="submit"
              disabled={busy || pending.length === 0}
            >
              {sending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 />
              )}
              {sending
                ? "Deleting..."
                : failures.length > 0
                  ? `Retry ${pending.length}`
                  : copy.confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
