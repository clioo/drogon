// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-github-work-item-status-badge.tsx.
import type { ReactNode } from "react";
import { cn } from "./cn";
import {
  getTaskPageGitHubWorkItemStateLabel,
  getTaskPageGitHubWorkItemStateTone,
  type GitHubWorkItemStatusItem,
} from "./task-page-github-work-item-status";

export function TaskPageGitHubWorkItemStateBadge({
  item,
  className,
}: {
  item: GitHubWorkItemStatusItem;
  className?: string;
}): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none",
        getTaskPageGitHubWorkItemStateTone(item),
        className,
      )}
    >
      {getTaskPageGitHubWorkItemStateLabel(item)}
    </span>
  );
}
