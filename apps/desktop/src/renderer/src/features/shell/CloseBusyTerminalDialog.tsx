// Issue #333: confirm dialog before closing a tab/pane whose session still
// has work in flight. Shape follows the sibling RemoveProjectDialog (Dialog
// primitives, autofocused destructive confirm, Cancel/confirm footer); the
// Don't-ask-again row is the shared DeleteWorktreeSkipConfirmOption — the
// persistence approach the issue names — not a second checkbox.
import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { DeleteWorktreeSkipConfirmOption } from "./DeleteWorktreeSkipConfirmOption";
import { getCloseBusyTerminalDialogCopy } from "./close-busy-terminal-dialog-copy";

export function CloseBusyTerminalDialog({
  agent,
  onConfirm,
  onClose,
}: {
  /** True picks the "Stop this agent?" copy, false "Stop running command?". */
  agent: boolean;
  /** The dialog reports whether Don't-ask-again was checked; the caller
   *  persists it, so an unmounted-early dialog can never write prefs. */
  onConfirm: (dontAskAgain: boolean) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const copy = getCloseBusyTerminalDialogCopy(agent);

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
          // Same guard rationale as DeleteWorktreeDialog: the confirm
          // exists to gate a destructive action the user already chose, so
          // the destructive button — not Cancel — takes Enter.
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{copy.title}</DialogTitle>
          <DialogDescription className="text-xs">
            {copy.description}
          </DialogDescription>
        </DialogHeader>
        <DeleteWorktreeSkipConfirmOption
          showDontAskAgain
          dontAskAgain={dontAskAgain}
          onToggleDontAskAgain={() => setDontAskAgain((prev) => !prev)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose()}>
            {copy.cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant="destructive"
            onClick={() => onConfirm(dontAskAgain)}
          >
            {copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
