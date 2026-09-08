// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-runs-dashboard-model.ts.
// Adaptation: local automations only — the host/authority identity of the
// source collapses to a single "desktop:self" host key and every entry is
// scope "local"; runs arrive already aggregated by the daemon
// (`automation.runs_all`) instead of being grouped per listed row.
import type { AutomationRunListItem } from "../../../../shared/automation-contract";

export type AutomationRunsScope = "local" | "remote";
export type AutomationRunsStatusFilter =
  | "all"
  | "successful"
  | "failed"
  | "active"
  | "skipped";

export type AutomationRunsDashboardEntry = {
  key: string;
  hostKey: string;
  searchText: string;
  run: AutomationRunListItem;
  scope: AutomationRunsScope;
};

/** The one host this build reads runs from: the local daemon. */
export const AUTOMATION_RUNS_LOCAL_HOST_KEY = "desktop:self";

export const AUTOMATION_RUNS_LOCAL_HOST_LABEL = "Local";

export function getAutomationRunsHostKey(): string {
  return AUTOMATION_RUNS_LOCAL_HOST_KEY;
}

export function getAutomationRunsScope(): AutomationRunsScope {
  return "local";
}

export function buildAutomationRunsDashboardEntries(
  runs: readonly AutomationRunListItem[],
): AutomationRunsDashboardEntry[] {
  return runs
    .map((run) => ({
      key: `${run.automationId}:${run.id}`,
      hostKey: getAutomationRunsHostKey(),
      searchText: [
        run.automationName,
        run.title,
        AUTOMATION_RUNS_LOCAL_HOST_LABEL,
      ]
        .join("\n")
        .toLocaleLowerCase(),
      run,
      scope: getAutomationRunsScope(),
    }))
    // Newest scheduled run first, like the source's dashboard ordering.
    .sort(
      (left, right) => right.run.scheduledFor - left.run.scheduledFor,
    );
}

function matchesStatus(
  status: string,
  filter: AutomationRunsStatusFilter,
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "successful") {
    return status === "completed";
  }
  if (filter === "failed") {
    return status === "dispatch_failed";
  }
  if (filter === "skipped") {
    return status.startsWith("skipped");
  }
  return status === "pending" || status === "dispatching" || status === "dispatched";
}

export function filterAutomationRunsDashboardEntries({
  entries,
  status,
  query,
  hostKeys,
}: {
  entries: readonly AutomationRunsDashboardEntry[];
  status: AutomationRunsStatusFilter;
  query: string;
  hostKeys: readonly string[];
}): AutomationRunsDashboardEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedHosts = new Set(hostKeys);
  return entries.filter((entry) => {
    if (
      !matchesStatus(entry.run.status, status) ||
      (selectedHosts.size > 0 && !selectedHosts.has(entry.hostKey))
    ) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return entry.searchText.includes(normalizedQuery);
  });
}

export function countAutomationRunOutcomes(
  entries: readonly AutomationRunsDashboardEntry[],
  now: number,
): { successful24h: number; failed24h: number; successful7d: number; failed7d: number } {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const counts = { successful24h: 0, failed24h: 0, successful7d: 0, failed7d: 0 };
  for (const entry of entries) {
    // A clock-skewed or future-dated run has not happened inside either window yet.
    if (entry.run.scheduledFor > now) {
      continue;
    }
    const successful = entry.run.status === "completed";
    const failed = entry.run.status === "dispatch_failed";
    if (entry.run.scheduledFor >= weekAgo) {
      counts.successful7d += successful ? 1 : 0;
      counts.failed7d += failed ? 1 : 0;
    }
    if (entry.run.scheduledFor >= dayAgo) {
      counts.successful24h += successful ? 1 : 0;
      counts.failed24h += failed ? 1 : 0;
    }
  }
  return counts;
}
