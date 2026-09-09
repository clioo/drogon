// MIT Copyright (c) 2026 Lovecast Inc. Ported verbatim from Orca's
// src/renderer/src/components/task-page-jira-status-tone.ts.
export function getJiraStatusTone(categoryKey: string): string {
  if (categoryKey === "done") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  }
  if (categoryKey === "indeterminate") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200";
  }
  return "border-border/50 bg-muted/40 text-muted-foreground";
}
