/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-presentation.tsx
   (`showBranch` / `showBranchIdentityHover`): the meta row carries the real
   branch, but never a line that only repeats the card's own title.
   Adapter: the fork writes worktrees with a generated branch name, so it
   only meets the duplicate case under `compactCards`
   (`!compactCards || branch !== worktree.displayName`); Drogon creates
   worktrees with `git worktree add -b <name>`, so `worktree.branch` is
   routinely identical to the card title and the reference's rule has to
   hold for every card layout. */

/** The branch text the card's meta row may show: the real `worktree.branch`,
 *  or "" when there is nothing independent to say (empty branch, or a branch
 *  that is just the card title again). Callers render no branch slot at all
 *  for "". */
export function worktreeCardBranchLabel(
  branch: string | null | undefined,
  displayName: string,
): string {
  const trimmed = (branch ?? "").trim();
  if (trimmed === "") return "";
  return trimmed === displayName.trim() ? "" : trimmed;
}
