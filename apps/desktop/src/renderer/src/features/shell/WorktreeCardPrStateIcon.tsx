/* MIT Copyright (c) 2026 Lovecast Inc.
   The card's right-hand review marker (owner's design, 2026-09-21): one
   merge glyph whose colour alone names the review's state — emerald for a
   merged review, cyan for a confirmed-ready one, blue for a live but
   unconfirmed review, muted for a draft, rose for a branch that
   conflicts. Class-compatible with the reference's MetaIconBadge
   shell (`WorktreeCardMetadataControls.tsx`): `size-3.5`, muted by default,
   label in an sr-only span; here the label is the same accessible string the
   meta row's chip used (`getPrChipAccessibleLabel`), and the title is the
   review's own title. A worktree with no known review draws nothing — never
   a placeholder claiming a state. */
import { GitMerge } from "lucide-react";
import {
  getPrChipAccessibleLabel,
  resolveCardPrState,
  type WorktreeCardPrDisplay,
} from "./worktree-card-pr-display";

/** Tone per state, over the sidebar's own surfaces in both themes. */
const STATE_TONE: Record<string, string> = {
  merged: "text-emerald-500",
  ready: "text-cyan-500 dark:text-cyan-400",
  // Owner: an open review must not read like "no PR" (grey).
  open: "text-blue-500 dark:text-blue-400",
  draft: "text-muted-foreground/70",
  conflicts: "text-rose-500",
  closed: "text-muted-foreground/70",
};

export function WorktreeCardPrStateIcon({
  pr,
  showNone = false,
  unknown = false,
}: {
  pr: WorktreeCardPrDisplay | null;
  /** The project's PR listing could not be fetched yet (e.g. GitHub rate
   *  limit): the grey marker says the state is unknown, not "none". */
  unknown?: boolean;
  /** Card use (owner's guideline): keep the slot with a faint glyph that
   *  says "no pull request", never a state it does not have. */
  showNone?: boolean;
}) {
  const state = resolveCardPrState(pr);
  if (!pr || !state) {
    if (!showNone) return null;
    const label = unknown
      ? "Pull request status unavailable"
      : "No pull request";
    return (
      <span
        className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground/70"
        data-worktree-card-pr-none={unknown ? "unknown" : ""}
        role="img"
        aria-label={label}
        title={label}
      >
        <GitMerge className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-3.5 shrink-0 items-center gap-0.5 ${STATE_TONE[state]}`}
      data-worktree-card-pr-state={state}
      role="img"
      aria-label={getPrChipAccessibleLabel(pr)}
      title={pr.title}
    >
      {/* Owner: the colour alone names the review state (green merged,
          cyan ready, blue open, red conflicts, grey draft/none); no extra
          check badge, which read as an agent status next to the ring. */}
      <GitMerge className="size-3.5 shrink-0" aria-hidden="true" />
    </span>
  );
}
