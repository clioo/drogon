// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationDeleteDialogs.tsx
// (AutomationDeleteDialog) and automation-delete-confirm-preference.ts.
// Adaptation: local automations only; the "don't ask again" preference
// persists in localStorage. Dialog copy and layout stay literal.
import { useEffect, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { AutomationSummary } from "../../../../shared/automation-contract";

const DELETE_CONFIRM_KEY = "drogon.automations.deleteConfirm";

export function shouldConfirmAutomationDelete(): boolean {
  try {
    return window.localStorage.getItem(DELETE_CONFIRM_KEY) !== "skip";
  } catch {
    return true;
  }
}

export function setConfirmAutomationDelete(confirm: boolean): void {
  try {
    if (confirm) {
      window.localStorage.removeItem(DELETE_CONFIRM_KEY);
    } else {
      window.localStorage.setItem(DELETE_CONFIRM_KEY, "skip");
    }
  } catch {
    // Preference persistence is best-effort; the dialog still works.
  }
}

export function AutomationDeleteDialog({
  deleteTarget,
  onOpenChange,
  onConfirm,
}: {
  deleteTarget: AutomationSummary | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (dontAskAgain: boolean) => void;
}): React.JSX.Element | null {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    if (deleteTarget === null) {
      setDontAskAgain(false);
      return;
    }
    confirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [deleteTarget, onOpenChange]);

  if (deleteTarget === null) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-delete-title"
        aria-describedby="automation-delete-description"
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg"
      >
        <div className="flex flex-col gap-1.5 text-left">
          <h2 id="automation-delete-title" className="text-sm font-medium">
            Delete Automation
          </h2>
          <p id="automation-delete-description" className="text-xs text-muted-foreground">
            Delete <span className="break-all font-medium text-foreground">{deleteTarget.name}</span>{" "}
            and its run history.
          </p>
        </div>
        <div className="mt-3 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
          <div className="break-all font-medium text-foreground">{deleteTarget.name}</div>
          <div className="mt-1 font-mono text-muted-foreground">{deleteTarget.cron}</div>
        </div>
        <button
          type="button"
          role="checkbox"
          aria-checked={dontAskAgain}
          onClick={() => setDontAskAgain((value) => !value)}
          className="mt-3 flex items-center gap-2 rounded-sm px-1 py-1 text-xs text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={`flex size-4 items-center justify-center rounded-sm border transition-colors ${
              dontAskAgain
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground bg-transparent"
            }`}
          >
            {dontAskAgain ? <Check className="size-3" strokeWidth={3} /> : null}
          </span>
          Don&apos;t ask again
        </button>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            ref={confirmButtonRef}
            variant="default"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onConfirm(dontAskAgain)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Reads the checkbox state for tests: mirrors the DOM toggle above. */
export function readDeleteConfirmCheckbox(button: HTMLButtonElement): boolean {
  return button.getAttribute("aria-checked") === "true";
}
