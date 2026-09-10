/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/WorktreeCardMetadataControls.tsx
   (MetaIconBadge: the small passive glyph shell the reference's card uses
   for its metadata markers — `size-3.5`, muted-foreground/70, the label in
   an sr-only span) and src/renderer/src/components/sidebar/
   WorktreeCardStatusSlot.tsx (`branchStatusIcon`: the GitBranch glyph that
   stands for the workspace's branch identity).
   Adapter: Orca renders a SquareTerminal badge for CLI-created provenance
   and a GitBranch glyph in the new-card status lane; Drogon's card shows
   neither, so this module draws the two right-hand affordances the owner's
   reference screenshots carry — a terminal marker for a workspace that owns
   sessions, and the branch marker — as passive markers over real data
   (`sessions.length`, `worktree.branch`). Both are plain spans with an
   sr-only label, exactly like the source's MetaIconBadge: no new action is
   invented, so nothing here can drift from what the card actually does. */
import { GitBranch, SquareTerminal } from "lucide-react";

const AFFORDANCE_CLASS_NAME =
  "inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70 [&>svg]:size-3.5";

export function WorktreeCardAffordances({
  branch,
  sessionCount,
}: {
  /** The worktree's real branch; "" hides the branch marker. */
  branch: string;
  /** Sessions attached to this worktree; 0 hides the terminal marker. */
  sessionCount: number;
}) {
  if (sessionCount === 0 && branch.trim() === "") return null;
  return (
    <span
      className="shell-worktree-card-affordances"
      data-worktree-card-affordances=""
    >
      {sessionCount > 0 ? (
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
      ) : null}
      {branch.trim() !== "" ? (
        <span
          className={`${AFFORDANCE_CLASS_NAME} shell-worktree-card-affordance-branch`}
          role="img"
          aria-label={`Branch ${branch}`}
          title={branch}
        >
          <GitBranch aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}
