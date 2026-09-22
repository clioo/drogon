/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/WorktreeCardMetadataControls.tsx
   (MetaIconBadge: the small passive glyph shell the reference's card uses
   for its metadata markers — `size-3.5`, muted-foreground/70, the label in
   an sr-only span) and src/renderer/src/components/sidebar/
   WorktreeCardStatusSlot.tsx (`branchStatusIcon`: the GitBranch glyph that
   stands for the workspace's branch identity).
   Adapter: Orca renders a SquareTerminal badge for CLI-created provenance
   and a GitBranch glyph in the new-card status lane; Drogon's card shows
   neither, so this module draws the one right-hand affordance the owner's
   guide keeps beside the review marker — a terminal marker for a workspace
   that owns sessions — as a passive marker over the real session count.
   Owner's guide (2026-09-21): the generic branch glyph is gone from this
   slot — the branch identity already reads as text in the meta row, and the
   right slot is reserved for the real review-state icon, so a gray branch
   glyph must never pose as the PR indicator. The `branch` prop stays so
   callers keep compiling; the branch action itself lives in the card menu.
   The marker is a plain span with an sr-only label, exactly like the
   source's MetaIconBadge: no new action is invented, so nothing here can
   drift from what the card actually does. */
import { SquareTerminal } from "lucide-react";

const AFFORDANCE_CLASS_NAME =
  "inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70 [&>svg]:size-3.5";

export function WorktreeCardAffordances({
  sessionCount,
}: {
  /**
   * The worktree's real branch. Retained for caller compatibility; the
   * branch reads as text in the card's meta row, not as a glyph here.
   */
  branch: string;
  /** Sessions attached to this worktree; 0 hides the terminal marker. */
  sessionCount: number;
}) {
  if (sessionCount === 0) return null;
  return (
    <span
      className="shell-worktree-card-affordances"
      data-worktree-card-affordances=""
    >
      <span
        className={AFFORDANCE_CLASS_NAME}
        role="img"
        aria-label={
          sessionCount === 1
            ? "1 terminal session"
            : `${sessionCount} terminal sessions`
        }
      >
        <SquareTerminal aria-hidden="true" />
      </span>
    </span>
  );
}
