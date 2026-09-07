// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/panel/branch-line-total-chip.tsx.
// Adapter: the test/generated breakdown hover panel has no MVP data (it
// needs per-path heuristics the daemon does not compute), so the chip
// renders the plain total with the source's accessible label.
import React, { useMemo } from "react";

function buildAccessibleLabel(added: number, removed: number): string {
  if (added > 0 && removed > 0) {
    return `${added} lines added, ${removed} lines deleted`;
  }
  if (added > 0) {
    return `${added} lines added`;
  }
  return `${removed} lines deleted`;
}

// Genuinely-empty (`+0 -0`) renders as nothing: no reserved width, no
// placeholder.
export const SourceControlBranchLineTotalChip = React.memo(
  function SourceControlBranchLineTotalChip({
    added,
    removed,
  }: {
    added: number;
    removed: number;
  }): React.JSX.Element | null {
    const hasAdded = added > 0;
    const hasRemoved = removed > 0;
    const locale = typeof navigator !== "undefined" ? navigator.language : "en-US";
    const addedText = useMemo(() => added.toLocaleString(locale), [added, locale]);
    const removedText = useMemo(() => removed.toLocaleString(locale), [removed, locale]);
    const accessibleLabel = useMemo(
      () => buildAccessibleLabel(added, removed),
      [added, removed],
    );

    if (!hasAdded && !hasRemoved) {
      return null;
    }

    // Why: no fixed `ch` width — that clips at 5+ digits; `tabular-nums` alone
    // keeps digits from jittering between refreshes.
    return (
      <span
        role="group"
        aria-label={accessibleLabel}
        data-testid="source-control-branch-line-total"
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap tabular-nums"
      >
        {hasAdded ? (
          <span aria-hidden="true" className="text-[color:var(--git-decoration-added)]">
            +{addedText}
          </span>
        ) : null}
        {hasRemoved ? (
          <span aria-hidden="true" className="text-[color:var(--git-decoration-deleted)]">
            -{removedText}
          </span>
        ) : null}
      </span>
    );
  },
);
