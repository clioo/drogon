// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-github-work-item-status.ts.
// Drogon rows are GitHub issues only, so the PR states stay typed but the
// issue arms are the ones the list serves today.

export type GitHubWorkItemStatusItem = Pick<
  GitHubWorkItemLike,
  "type" | "state"
>;

/** Structural subset of the source's GitHubWorkItem the status helpers read. */
export type GitHubWorkItemLike = {
  type: "issue" | "pr";
  state: "open" | "closed" | "merged" | "draft";
};

export function getTaskPageGitHubWorkItemStateLabel(
  item: GitHubWorkItemStatusItem,
): string {
  if (item.type === "pr") {
    if (item.state === "merged") {
      return "Merged";
    }
    if (item.state === "draft") {
      return "Draft";
    }
    if (item.state === "closed") {
      return "Closed";
    }
    return "Open";
  }

  return item.state === "closed" ? "Closed" : "Open";
}

// Why: use the same muted pill tones as merge/check badges — light washes with
// readable foreground text in both themes. Draft stays neutral gray because
// it's a non-actionable meta state.
export function getTaskPageGitHubWorkItemStateTone(
  item: GitHubWorkItemStatusItem,
): string {
  if (item.type === "pr") {
    if (item.state === "merged") {
      return "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300";
    }
    if (item.state === "draft") {
      return "border-border/60 bg-muted-foreground/70 text-background dark:bg-muted-foreground/60 dark:text-foreground";
    }
    if (item.state === "closed") {
      return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200";
    }
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  }

  if (item.state === "closed") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
}

export function isTaskPageGitHubDraftPR(item: GitHubWorkItemStatusItem): boolean {
  return item.type === "pr" && item.state === "draft";
}

export function getTaskPageGitHubPRIconTone(
  item: GitHubWorkItemStatusItem,
): string {
  if (item.type !== "pr") {
    return "text-muted-foreground";
  }

  switch (item.state) {
    case "draft":
      return "text-muted-foreground";
    case "open":
      return "text-emerald-600 dark:text-emerald-400";
    case "merged":
      return "text-purple-600 dark:text-purple-300";
    case "closed":
      return "text-rose-600 dark:text-rose-300";
  }
}
