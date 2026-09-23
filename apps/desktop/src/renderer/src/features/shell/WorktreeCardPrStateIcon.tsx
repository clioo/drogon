/* MIT Copyright (c) 2026 Lovecast Inc.
   The card's right-hand review marker (owner's design, 2026-09-21): one
   merge glyph whose colour names the review's state — emerald with a check
   for a merged review, cyan for a confirmed-ready one, neutral for a live
   but unconfirmed review, muted for a draft, rose for a branch that
   conflicts. Class-compatible with the reference's MetaIconBadge
   shell (`WorktreeCardMetadataControls.tsx`): `size-3.5`, muted by default,
   label in an sr-only span; here the label is the same accessible string the
   meta row's chip used (`getPrChipAccessibleLabel`), and the title is the
   review's own title. A worktree with no known review draws nothing — never
   a placeholder claiming a state. */
import { Check, GitMerge } from "lucide-react";
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
      className={`relative inline-flex size-3.5 shrink-0 items-center justify-center ${STATE_TONE[state]}`}
      data-worktree-card-pr-state={state}
      role="img"
      aria-label={getPrChipAccessibleLabel(pr)}
      title={pr.title}
    >
      <GitMerge className="size-3.5" aria-hidden="true" />
      {state === "merged" ? (
        // The reference's review badge overlays a filled check on the glyph;
        // the ring keeps the check legible against the merge lines.
        <Check
          className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-worktree-sidebar text-emerald-500 ring-1 ring-emerald-500"
          strokeWidth={3.5}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
