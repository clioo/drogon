// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-list-search-query.ts,
// automation-list-search.ts, automation-list-view.ts (filter/sort shapes) and
// automation-list-empty-state.ts. Adaptation: the indexed fields are this
// repo's AutomationSummary shape (name, cron, harness, workspace name,
// prompt); host/agent catalog filters are out of MVP scope, so the filter is
// status + last-run only.
import type { AutomationSummary } from "../../../../shared/automation-contract";
import { describeAutomationSchedule } from "./automation-schedule-label";

export const AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES = 256;

export function clampAutomationListSearchQueryInput(query: string): string {
  if (query.length <= AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES) return query;
  return query.slice(0, AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES);
}

export function isAutomationListSearchQueryTooLarge(query: string): boolean {
  return query.length > AUTOMATION_LIST_SEARCH_QUERY_MAX_BYTES;
}

function activeQuery(rawQuery: string): string | null {
  const trimmed = rawQuery.trim().toLowerCase();
  if (trimmed === "") return null;
  if (isAutomationListSearchQueryTooLarge(rawQuery)) return null;
  return trimmed;
}

export type AutomationListStatusFilter = "all" | "enabled" | "paused";
export type AutomationListLastRunFilter =
  | "all"
  | "failed"
  | "succeeded"
  | "never";

export type AutomationListFilter = {
  status: AutomationListStatusFilter;
  lastRun: AutomationListLastRunFilter;
};

export const EMPTY_AUTOMATION_LIST_FILTER: AutomationListFilter = {
  status: "all",
  lastRun: "all",
};

export function isAutomationListFilterActive(filter: AutomationListFilter): boolean {
  return filter.status !== "all" || filter.lastRun !== "all";
}

export function countAutomationListFilters(filter: AutomationListFilter): number {
  let count = 0;
  if (filter.status !== "all") count += 1;
  if (filter.lastRun !== "all") count += 1;
  return count;
}

export type AutomationLastRunTone =
  | "failed"
  | "succeeded"
  | "running"
  | "skipped"
  | "never"
  | "unknown";

export type AutomationLastRunSnapshot = {
  at: number | null;
  tone: AutomationLastRunTone;
  statusLabel: string;
};

const FAILED_STATUSES = new Set(["dispatch_failed", "failed", "error"]);

/** Last-run picture from the list projection (no history fetch). */
export function getAutomationSummaryLastRunSnapshot(
  automation: AutomationSummary,
): AutomationLastRunSnapshot {
  const lastRun = automation.lastRun;
  if (lastRun) {
    const status = lastRun.status.toLowerCase();
    return {
      at: lastRun.scheduledFor,
      tone: toneForStatus(status),
      statusLabel: lastRunStatusLabel(lastRun.status),
    };
  }
  if (automation.lastRunAt !== null) {
    return { at: automation.lastRunAt, tone: "unknown", statusLabel: "" };
  }
  return { at: null, tone: "never", statusLabel: "" };
}

export function toneForStatus(status: string): AutomationLastRunTone {
  const normalized = status.toLowerCase();
  if (FAILED_STATUSES.has(normalized)) return "failed";
  if (normalized === "completed") return "succeeded";
  if (
    normalized === "pending" ||
    normalized === "dispatching" ||
    normalized === "dispatched"
  ) {
    return "running";
  }
  if (normalized.startsWith("skipped")) return "skipped";
  return "unknown";
}

export function lastRunStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "pending":
      return "Queued";
    case "dispatching":
      return "Starting";
    case "dispatched":
      return "Launched";
    case "completed":
      return "Done";
    case "skipped_precheck":
      return "Precheck skipped";
    case "skipped_missed":
      return "Skipped";
    case "skipped_unavailable":
      return "Unavailable";
    case "skipped_needs_interactive_auth":
      return "Needs credentials";
    case "dispatch_failed":
      return "Failed";
    default:
      return status;
  }
}

export type ProjectedAutomationRow = {
  automation: AutomationSummary;
  workspaceName: string;
  scheduleKind: ReturnType<typeof describeAutomationSchedule>["kind"];
  lastRun: AutomationLastRunSnapshot;
};

export function projectAutomationRows(
  automations: readonly AutomationSummary[],
  workspaceNameFor: (workspaceId: string | null) => string,
): ProjectedAutomationRow[] {
  return automations.map((automation) => ({
    automation,
    workspaceName: workspaceNameFor(automation.workspaceId),
    scheduleKind: describeAutomationSchedule(automation.cron).kind,
    lastRun: getAutomationSummaryLastRunSnapshot(automation),
  }));
}

function rowMatchesQuery(row: ProjectedAutomationRow, query: string): boolean {
  const haystacks = [
    row.automation.name,
    row.automation.cron,
    row.automation.harness,
    row.workspaceName,
    row.automation.prompt.slice(0, 2048),
  ];
  return haystacks.some((field) => field.toLowerCase().includes(query));
}

function rowMatchesFilter(row: ProjectedAutomationRow, filter: AutomationListFilter): boolean {
  if (filter.status === "enabled" && !row.automation.enabled) return false;
  if (filter.status === "paused" && row.automation.enabled) return false;
  if (filter.lastRun === "failed" && row.lastRun.tone !== "failed") return false;
  if (filter.lastRun === "succeeded" && row.lastRun.tone !== "succeeded") {
    return false;
  }
  if (filter.lastRun === "never" && row.lastRun.tone !== "never") return false;
  return true;
}

export type AutomationListProjection = {
  rows: ProjectedAutomationRow[];
  totalCount: number;
  searchActive: boolean;
  filterActive: boolean;
};

/** Search, then attribute filter, then stable name sort. */
export function projectAutomationList(
  automations: readonly AutomationSummary[],
  workspaceNameFor: (workspaceId: string | null) => string,
  rawQuery: string,
  filter: AutomationListFilter,
): AutomationListProjection {
  const query = activeQuery(rawQuery);
  const filterActive = isAutomationListFilterActive(filter);
  let rows = projectAutomationRows(automations, workspaceNameFor);
  const totalCount = rows.length;
  if (query !== null) {
    rows = rows.filter((row) => rowMatchesQuery(row, query));
  }
  if (filterActive) {
    rows = rows.filter((row) => rowMatchesFilter(row, filter));
  }
  rows = [...rows].sort((a, b) =>
    a.automation.name.localeCompare(b.automation.name, undefined, {
      sensitivity: "base",
    }),
  );
  return { rows, totalCount, searchActive: query !== null, filterActive };
}

export type AutomationListEmptyStateKind =
  | "rows"
  | "loading"
  | "error"
  | "empty"
  | "search-no-match"
  | "filter-no-match";

export type AutomationListEmptyState = {
  kind: AutomationListEmptyStateKind;
  title: string;
  detail: string | null;
};

export function resolveAutomationListEmptyState(args: {
  loading: boolean;
  error: string | null;
  totalCount: number;
  visibleCount: number;
  searchActive: boolean;
  filterActive: boolean;
}): AutomationListEmptyState {
  if (args.visibleCount > 0) return { kind: "rows", title: "", detail: null };
  if (args.loading) {
    return { kind: "loading", title: "Loading automations…", detail: null };
  }
  if (args.error !== null) {
    return { kind: "error", title: "Automations could not be loaded.", detail: args.error };
  }
  if (args.searchActive || args.filterActive) {
    if (args.searchActive) {
      return {
        kind: "search-no-match",
        title: "No automations match your search.",
        detail: "Try a different search term.",
      };
    }
    return {
      kind: "filter-no-match",
      title: "No automations match these filters.",
      detail: "Clear the filters to see every automation.",
    };
  }
  if (args.totalCount === 0) {
    // Source copy (automation-list-empty-state.ts, all-hosts-empty): the
    // empty title names the loaded-hosts scope, with no detail line.
    return {
      kind: "empty",
      title: "No automations across loaded hosts",
      detail: null,
    };
  }
  return { kind: "rows", title: "", detail: null };
}
