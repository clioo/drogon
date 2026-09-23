/* The worktree card's left ring (owner's sidebar guideline, 2026-09-23:
   "AGENT ACTIVITY (left status)"): one solid ring whose colour is the
   card's agent activity — amber while an agent works or waits for the user,
   green when the card has sessions but none is active, neutral when the
   card has no session or its agents are not reporting. Reads the same
   activity class as the sentence under the title, so the ring and the words
   can never disagree. Passive: the card's own select button is the control. */
import type { Session } from "../../../../shared/session-contract";
import {
  worktreeActivityClass,
  type WorktreeActivityClass,
} from "./worktree-card-activity";

export const WORKTREE_ACTIVITY_RING_SIZE = 18;

export type WorktreeActivityTone = "active" | "quiet" | "none";

export function worktreeActivityTone(
  activity: WorktreeActivityClass,
): WorktreeActivityTone {
  if (activity === "working" || activity === "needs-input") return "active";
  if (activity === "no-active-agents" || activity === "terminal-session")
    return "quiet";
  return "none";
}

// Owner's vocabulary for the ring: an agent is working, its work is done,
// or the card is idle (no session / nothing reporting).
const TONE_LABEL: Record<WorktreeActivityTone, string> = {
  active: "Agent activity: working",
  quiet: "Agent activity: done",
  none: "Agent activity: idle",
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function WorktreeActivityRing({
  sessions,
  size = WORKTREE_ACTIVITY_RING_SIZE,
}: {
  sessions: readonly Session[];
  size?: number;
}) {
  const activity = worktreeActivityClass(sessions);
  const tone = worktreeActivityTone(activity);
  const label =
    activity === "needs-input"
      ? "Agent activity: waiting for input"
      : TONE_LABEL[tone];
  return (
    <span
      className="shell-worktree-card-activity-ring"
      data-worktree-activity={tone}
      role="img"
      aria-label={label}
      title={capitalize(label.replace("Agent activity: ", ""))}
      style={{ width: size, height: size }}
    />
  );
}
