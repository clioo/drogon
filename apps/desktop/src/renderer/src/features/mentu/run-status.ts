// MIT Copyright (c) 2026 Lovecast Inc.
// Run-status projection for the Mentu surface: every view spells a run or
// step status exactly one way (label) and one tone (Tailwind classes).
// Extracted so the panel, tab and metrics rows share one projection with
// one test, mirroring the reference's single `statusLabel` convention in
// `src/renderer/src/components/mentu/recipe-pane-views.tsx`.

import type { MentuRunStatus } from "../../../../shared/mentu-contract";

export function statusLabel(status: MentuRunStatus | undefined): string {
  switch (status) {
    case "running":
      return "Running…";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "unavailable":
      return "Unavailable";
    default:
      return "";
  }
}

export function statusToneClass(status: MentuRunStatus | undefined): string {
  switch (status) {
    case "succeeded":
      return "text-emerald-600 dark:text-emerald-400";
    case "failed":
    case "unavailable":
      return "text-destructive";
    case "cancelled":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}
