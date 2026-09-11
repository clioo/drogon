// MIT Copyright (c) 2026 Lovecast Inc.
// Work-graph status projection: every node status the daemon may observe
// is spelled exactly one way (label) and one tone (Tailwind classes),
// mirroring the single-projection convention of
// `features/mentu/run-status.ts`. The liveness rules are non-negotiable:
// `running` renders only because the daemon confirmed a live process, and
// `unverifiable` renders as ITS OWN outcome — never folded into failed or
// succeeded, never retried behind the user's back. A status this build
// does not know renders raw and neutral: the graph never lies by mapping
// an unknown onto a familiar word.

import type { WorkGraphStatus } from "../../../../shared/work-graph-contract";

export function workGraphStatusLabel(
  status: WorkGraphStatus | string | undefined | null,
): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "running":
      return "Running…";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "blocked":
      return "Blocked";
    case "unverifiable":
      return "Unverifiable";
    default:
      // Unknown status: render exactly what the daemon wrote.
      return typeof status === "string" && status.length > 0 ? status : "";
  }
}

export function workGraphStatusToneClass(
  status: WorkGraphStatus | string | undefined | null,
): string {
  switch (status) {
    case "succeeded":
      return "text-emerald-600 dark:text-emerald-400";
    case "failed":
      return "text-destructive";
    case "running":
      return "text-foreground";
    case "unverifiable":
      // Loss of contact is its own caution tone — not an error red, not a
      // success green: the run's outcome is simply not known.
      return "text-amber-600 dark:text-amber-400";
    case "blocked":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

/** Whether the badge for this status is a hard error the user must see. */
export function workGraphStatusIsFailure(
  status: WorkGraphStatus | string | undefined | null,
): boolean {
  return status === "failed";
}
