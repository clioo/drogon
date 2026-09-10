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

export function RemoveProjectDialog({
  project,
  disabled,
  onSubmit,
  onClose,
}: {
  project: Project;
  disabled: boolean;
  /** Removes the registration (never files); resolves an error to show verbatim, or null. */
  onSubmit: (project: Project) => Promise<string | null>;
  onClose: () => void;
}): React.JSX.Element {
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = disabled || sending;
  const copy = getRemoveProjectDialogCopy(project.name, project.quickSession);

  const submit = async () => {
    setSending(true);
    setError("");
    try {
      const failure = await onSubmit(project);
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
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
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
