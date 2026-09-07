// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/discard-dialog.tsx.
// Adapter: local radix-ui Dialog chrome (no ui/dialog primitive in this
// repo) with the source's copy, focus behavior and destructive confirm.
import { useMemo, useRef } from "react";
import { Trash, Undo2 } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "../../components/ui/button";
import type { DiscardAllArea } from "./discard-sequence";
import type { SourceControlEntry } from "./source-control-entry";
import {
  getDiscardAreaConfirmationCopy,
  getDiscardEntryConfirmationCopy,
} from "./discard-confirmation";

export type PendingDiscardConfirmation =
  | { kind: "entry"; entry: SourceControlEntry }
  | { kind: "area"; area: DiscardAllArea; paths: readonly string[] };

export function focusDiscardDialogConfirmButton(
  event: Event,
  confirmButton: HTMLButtonElement | null,
): void {
  if (!confirmButton) {
    return;
  }
  // Why: Radix otherwise focuses Cancel first, making Enter dismiss this destructive confirm.
  event.preventDefault();
  confirmButton.focus();
}

export function SourceControlDiscardDialog({
  pendingDiscard,
  onCancel,
  onConfirm,
}: {
  pendingDiscard: PendingDiscardConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const pendingDiscardCopy = useMemo(() => {
    if (!pendingDiscard) {
      return null;
    }
    if (pendingDiscard.kind === "entry") {
      return getDiscardEntryConfirmationCopy(pendingDiscard.entry);
    }
    return getDiscardAreaConfirmationCopy(pendingDiscard.area, pendingDiscard.paths.length);
  }, [pendingDiscard]);
  const PendingDiscardIcon = pendingDiscardCopy?.confirmLabel.startsWith("Delete") ? Trash : Undo2;

  return (
    <Dialog.Root
      open={pendingDiscard !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg"
          onOpenAutoFocus={(event) =>
            focusDiscardDialogConfirmButton(event, confirmButtonRef.current)
          }
        >
          <Dialog.Title className="text-sm font-medium text-foreground">
            {pendingDiscardCopy?.title ?? "Discard changes?"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            {pendingDiscardCopy?.description ?? "This cannot be undone."}
          </Dialog.Description>
          {pendingDiscard?.kind === "area" ? (
            <div className="mt-3 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
              {pendingDiscard.paths.length}{" "}
              {pendingDiscard.paths.length === 1 ? "file" : "files"}
            </div>
          ) : pendingDiscard?.kind === "entry" ? (
            <div className="mt-3 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
              <div className="break-all font-medium text-foreground">{pendingDiscard.entry.path}</div>
            </div>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            {/* Why variant="default" plus destructive tokens: the shared Button owns its variants and has no destructive one. */}
            <Button
              ref={confirmButtonRef}
              type="button"
              variant="default"
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              autoFocus
              onClick={onConfirm}
            >
              <PendingDiscardIcon className="size-4" />
              {pendingDiscardCopy?.confirmLabel ?? "Discard"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
