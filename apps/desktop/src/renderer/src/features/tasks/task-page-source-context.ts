// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page-source-context.tsx — the GitHub
// grid/sticky surface classes and relative-time formatting only; the
// provider/source-context plumbing has no counterpart in this repo.

// Why: relative times are language words; Drogon renders en-US, so the
// formatter is fixed instead of read from the source's i18n locale.
let cached: Intl.RelativeTimeFormat | null = null;
function getUiRelativeTimeFormatter(): Intl.RelativeTimeFormat {
  cached ??= new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  return cached;
}

/** Format a signed millisecond delta (future positive, past negative) at minute/hour/day granularity. */
export function formatUiRelativeTime(diffMs: number): string {
  const formatter = getUiRelativeTimeFormatter();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }
  return formatter.format(Math.round(diffHours / 24), "day");
}

/** Parse a date string and format it relative to now; returns `fallback` when the input is invalid. */
export function formatUiRelativeTimeFromDate(
  input: string,
  fallback = "recently",
): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return formatUiRelativeTime(date.getTime() - Date.now());
}

export function formatRelativeTime(input: string): string {
  return formatUiRelativeTimeFromDate(input);
}

export const TASK_SEARCH_DEBOUNCE_MS = 300;
import { cn } from "./cn";
export const GITHUB_TASK_GRID_CLASS =
  "min-w-[790px] grid-cols-[72px_minmax(320px,1fr)_84px_100px_92px_122px]";
// Why: sticky cells need the row's opaque, animated surface to prevent bleed and hover flashes.
export const GITHUB_TASK_ROW_SURFACE_CLASS = "bg-background transition-colors";
export const GITHUB_TASK_ROW_HOVER_SURFACE_CLASS =
  "group-hover/github-task-row:bg-accent";
export const GITHUB_TASK_HEADER_SURFACE_CLASS =
  "[background:color-mix(in_srgb,var(--muted)_25%,var(--background))]";
// Why: opaque sticky headers and a padding-gap cover prevent vertical and horizontal bleed.
export const GITHUB_TASK_STICKY_ID_HEADER_CLASS = cn(
  // Why: full-height flex keeps the sticky fill from shrinking around its label.
  "sticky left-3 z-30 flex items-center before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3 before:bg-inherit",
  GITHUB_TASK_HEADER_SURFACE_CLASS,
);
export const GITHUB_TASK_STICKY_TITLE_HEADER_CLASS = cn(
  "sticky left-[92px] z-30 flex items-center border-r border-border/40 before:absolute before:-left-2 before:top-0 before:bottom-0 before:w-2 before:bg-inherit",
  GITHUB_TASK_HEADER_SURFACE_CLASS,
);
export const GITHUB_TASK_STICKY_ID_CELL_CLASS = cn(
  "sticky left-3 z-20 flex items-center before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3 before:bg-inherit",
  GITHUB_TASK_ROW_SURFACE_CLASS,
  GITHUB_TASK_ROW_HOVER_SURFACE_CLASS,
);
export const GITHUB_TASK_STICKY_TITLE_CELL_CLASS = cn(
  "sticky left-[92px] z-20 flex min-w-0 flex-col justify-center border-r border-border/40 pr-2 before:absolute before:-left-2 before:top-0 before:bottom-0 before:w-2 before:bg-inherit",
  GITHUB_TASK_ROW_SURFACE_CLASS,
  GITHUB_TASK_ROW_HOVER_SURFACE_CLASS,
);
