/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/DeleteWorktreeSkipConfirmOption.tsx
   (verbatim checkbox-button structure, classes and "Don't ask again"
   copy; persistence is this repo's localStorage preference below, the
   analogue of the source's `skipDeleteWorktreeConfirm` setting.) */
import { Check } from "lucide-react";

const SKIP_CONFIRM_STORAGE_KEY = "drogon.skipDeleteWorktreeConfirm";

/** Reads the persisted skip-confirm preference (tests inject storage). */
export function readSkipDeleteWorktreeConfirm(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  try {
    return storage.getItem(SKIP_CONFIRM_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persists the skip-confirm preference (tests inject storage). */
export function writeSkipDeleteWorktreeConfirm(
  skip: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): void {
  try {
    if (skip) storage.setItem(SKIP_CONFIRM_STORAGE_KEY, "1");
    else storage.removeItem(SKIP_CONFIRM_STORAGE_KEY);
  } catch {
    // Best-effort preference write; the dialog still works per-open.
  }
}

export function DeleteWorktreeSkipConfirmOption({
  showDontAskAgain,
  dontAskAgain,
  onToggleDontAskAgain,
}: {
  showDontAskAgain: boolean;
  dontAskAgain: boolean;
  onToggleDontAskAgain: () => void;
}) {
  if (!showDontAskAgain) {
    return null;
  }
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={dontAskAgain}
      onClick={onToggleDontAskAgain}
      className="flex items-center gap-2 rounded-sm px-1 py-1 text-xs text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  );
}
