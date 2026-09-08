// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-checks-pill.ts (and the
// `getProviderChecksLabel` it delegates to in the shared
// provider-check-summary). The pill keys label and tone off the daemon's
// rolled-up `checks` summary so the text can never contradict its colour.
import type { TaskPageWorkItem } from "./task-page-model";

type ChecksPillItem = Pick<TaskPageWorkItem, "checks">;

export function getChecksLabel(item: ChecksPillItem): string {
  const summary = item.checks;
  if (!summary) {
    return "Checks";
  }
  if (summary.total === 0) {
    return "No checks";
  }
  if (summary.failed > 0) {
    return `${summary.failed} failing`;
  }
  if (summary.pending > 0) {
    return `${summary.pending} pending`;
  }
  return summary.state === "neutral"
    ? "Unresolved checks"
    : `${summary.passed}/${summary.total} passed`;
}

export function getChecksPillTone(item: ChecksPillItem): string {
  const state = item.checks?.state;
  if (state === "success") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  }
  if (state === "failure") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200";
  }
  if (state === "pending") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  }
  return "border-border/60 bg-background/70 text-muted-foreground";
}
