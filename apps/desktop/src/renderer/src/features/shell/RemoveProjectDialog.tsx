/* MIT Copyright (c) 2026 Lovecast Inc.
   Ported from Orca's src/renderer/src/components/sidebar/RemoveFolderDialog.tsx
   (adapter: props instead of the modal store; local projects only, so the
   SSH/VM description branches are gone — see remove-project-dialog-copy.ts.
   DOM, Tailwind classes, copy, icons and ARIA are the source's; the submit
   contract — resolves a verbatim daemon error or null — is this repo's
   sidebar-dialog convention from DeleteWorktreeDialog. Rendered through
   the ported ui primitives exactly as the source imports them.) */
import { useState } from "react";
import type { Project } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { getRemoveProjectDialogCopy } from "./remove-project-dialog-copy";
import { isProvenLivePtyRemovalError } from "./delete-worktree-toast";

export function RemoveProjectDialog({
  project,
  disabled,
  onSubmit,
  onClose,
}: {
  project: Project;
  disabled: boolean;
  /** Removes the registration (never files); resolves an error to show verbatim, or null. */
  onSubmit: (project: Project, force: boolean) => Promise<string | null>;
  onClose: () => void;
}): React.JSX.Element {
  const [force, setForce] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = disabled || sending;
  const copy = getRemoveProjectDialogCopy(project.name, project.quickSession);
  // A Chat's own copy already promises it stops its sessions, and the daemon
  // settles those for a quick session; the checkbox is for everything else.
  const offersForce = !project.quickSession;
  // Issue #621 shape: a removal whose terminals are still live is refused
  // with `session_live`. The refusal is the one case a second, stronger
  // attempt can clear, so the dialog offers exactly that instead of leaving
  // the user with an error and no way forward.
  const canForceRetry = !force && isProvenLivePtyRemovalError(error);

  // `forced` is passed explicitly rather than read from the checkbox: the
  // retry below is a statement the user already made, and the box it never
  // touched must not decide it.
  const submit = async (forced: boolean = force) => {
    setSending(true);
    setError("");
    try {
      const failure = await onSubmit(project, forced);
      if (failure) setError(failure);
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
      <DialogContent className="max-w-sm sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">{copy.title}</DialogTitle>
          <DialogDescription className="text-xs">
            {copy.descriptionBeforeName}
            <span className={copy.targetClassName}>{copy.targetLabel}</span>
            {copy.descriptionAfterName}
          </DialogDescription>
        </DialogHeader>
        {offersForce ? (
          <label className="shell-check-row" htmlFor="shell-remove-project-force">
            <input
              id="shell-remove-project-force"
              type="checkbox"
              checked={force}
              disabled={busy}
              onChange={(event) => setForce(event.target.checked)}
            />
            Also stop terminals running in this project
          </label>
        ) : null}
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {canForceRetry ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void submit(true)}
          >
            Stop terminals and remove
          </Button>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onClose()}
          >
            {copy.cancelLabel}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
