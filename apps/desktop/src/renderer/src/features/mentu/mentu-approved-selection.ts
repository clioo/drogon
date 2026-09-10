// MIT Copyright (c) 2026 Lovecast Inc.
// C03 selection/binding helpers for the Mentu surface: the approved
// execution selection (harness backend + exact model id), its display
// verdict, the approval binding over exact recipe bytes, and the
// save-conflict shape. Original to this repo; the verdict vocabulary
// mirrors the daemon's `crates/drogon-core/src/mentu/execution.rs`
// (unavailable / stale / unsupported / manual-unverified), which stays
// the enforcement authority — this module never invents executability.

/** The four selection states the selector renders distinctly. */
export type ApprovedSelectionVerdictKind =
  | "unavailable"
  | "stale"
  | "unsupported"
  | "unverified";

export type ApprovedSelectionVerdict = {
  kind: ApprovedSelectionVerdictKind;
  /** One-line reason shown next to the selector; never a bare label. */
  reason: string;
};

export type ApprovedSelection = {
  /** Recipe step backend (for Pi: the providers-map binding name). */
  backend: string;
  /** Exact model id the recipe step carries, if any. */
  model: string | null;
  /** Catalog freshness token at validation time, when a catalog exists. */
  catalogFreshness: string | null;
};

/** Approval binds exact recipe bytes plus the execution selection. */
export type ApprovalBinding = {
  contentHash: string;
  selection: ApprovedSelection;
  /** Adapter/runtime context the daemon recorded (backend, notes). */
  adapterContext: string;
  boundAt: string;
};

export type SaveConflict = {
  /** Hash the draft started from. */
  expectedHash: string;
  /** Hash currently on disk. */
  currentHash: string;
};

function isHex64(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

/**
 * Classifies a selection for display from data the renderer already has:
 * runtime availability, the loaded vs current content hash, and an optional
 * daemon refusal. No catalog, no inference — anything the daemon has not
 * confirmed renders manual-unverified with its scope note.
 */
export function classifySelection(input: {
  runtimeAvailable: boolean;
  runtimeMessage?: string | null;
  loadedHash: string | null;
  currentHash: string | null;
  daemonRefusal?: string | null;
  scopeNote?: string | null;
}): ApprovedSelectionVerdict {
  if (!input.runtimeAvailable) {
    return {
      kind: "unavailable",
      reason:
        input.runtimeMessage ??
        "Mentu Recipes is unavailable on the execution host.",
    };
  }
  if (input.daemonRefusal) {
    return { kind: "unsupported", reason: input.daemonRefusal };
  }
  if (
    input.loadedHash &&
    input.currentHash &&
    input.loadedHash !== input.currentHash
  ) {
    return {
      kind: "stale",
      reason:
        "The recipe changed on disk since it was loaded. Reload before approving.",
    };
  }
  return {
    kind: "unverified",
    reason:
      input.scopeNote ??
      "Manual entry: carried unverified against this host until catalog wiring lands.",
  };
}

/** True when the approval still binds the current bytes and selection. */
export function isBindingValid(
  binding: ApprovalBinding,
  currentHash: string,
  currentSelection: ApprovedSelection,
): boolean {
  return (
    binding.contentHash === currentHash &&
    binding.selection.backend === currentSelection.backend &&
    (binding.selection.model ?? null) === (currentSelection.model ?? null)
  );
}

/** Binds an approval to exact bytes plus the execution selection. */
export function bindApproval(input: {
  contentHash: string;
  selection: ApprovedSelection;
  adapterContext: string;
}): ApprovalBinding | { error: string } {
  if (!isHex64(input.contentHash)) {
    return { error: "Approval needs the recipe's 64-character content hash." };
  }
  if (!input.selection.backend) {
    return { error: "Approval needs the selected step's backend." };
  }
  return {
    contentHash: input.contentHash,
    selection: { ...input.selection },
    adapterContext: input.adapterContext,
    boundAt: new Date().toISOString(),
  };
}

/** Detects a stale save base: two editors, one hash, one winner. */
export function detectSaveConflict(
  loadedHash: string,
  currentHash: string,
): SaveConflict | null {
  if (!loadedHash || !currentHash || loadedHash === currentHash) return null;
  return { expectedHash: loadedHash, currentHash };
}

/** Copy for the conflict panel: the draft is preserved, never merged. */
export function conflictMessage(conflict: SaveConflict): string {
  return (
    `Another editor saved this recipe (now ${conflict.currentHash.slice(0, 12)}…). ` +
    "Your draft is preserved below — reload and reapply your edits, or review the current source first."
  );
}
