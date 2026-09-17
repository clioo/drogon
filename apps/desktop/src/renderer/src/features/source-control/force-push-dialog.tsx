// MIT Copyright (c) 2026 Lovecast Inc.
// #332 confirm for the chevron menu's "Force Push" row. Same radix-ui
// Dialog chrome as the discard dialog (see discard-dialog.tsx) so every
// destructive confirm reads as one surface; the copy names the lease
// check that makes this push safe to offer from the panel.
import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "../../components/ui/button";

export function ForcePushDialog({
  open,
  upstream,
  onCancel,
  onConfirm,
}: {
  /** The chevron menu requested a lease-checked force push. */
  open: boolean;
  /** Upstream ref about to be rewritten (null when unknown). */
  upstream: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg"
          onOpenAutoFocus={(event) => {
            // Why: Radix otherwise focuses Cancel first, making Enter
            // dismiss this destructive confirm (mirrors discard-dialog).
            event.preventDefault();
            confirmButtonRef.current?.focus();
          }}
        >
          <Dialog.Title className="text-sm font-medium text-foreground">
            Force push with lease?
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            This rewrites the upstream branch with your local history. It
            refuses when someone else updated the remote first — fetch and
            review before retrying. This cannot be undone.
          </Dialog.Description>
          {upstream ? (
            <div className="mt-3 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
              <div className="break-all font-medium text-foreground">{upstream}</div>
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
              <AlertTriangle className="size-4" />
              Force Push
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
