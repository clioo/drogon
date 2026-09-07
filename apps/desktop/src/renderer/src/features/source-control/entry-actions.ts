// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/entry-actions.ts.
// Adapter: submodule/conflict fields do not exist in the MVP entry model,
// so those gates are trivially satisfied and kept as documentation.

import type { SourceControlEntry } from "./source-control-entry";
import { isStageableStatusEntry } from "./discard-sequence";

/**
 * Per-row Source Control action eligibility, centralized so the stage/unstage/
 * discard gates stay consistent between the row UI, bulk selection, and tests.
 */
export function canStageStatusEntry(entry: SourceControlEntry): boolean {
  return isStageableStatusEntry(entry);
}

export function canUnstageStatusEntry(entry: SourceControlEntry): boolean {
  return entry.area === "staged";
}

export function canDiscardStatusEntry(entry: SourceControlEntry): boolean {
  return entry.area === "unstaged" || entry.area === "untracked";
}
