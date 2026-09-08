// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/AutomationRunsDashboardSurface.tsx.
// Adaptation: local automations only — no authority/host identity to
// resolve, so opening a run names only its ids; the pageView switching
// (run page + detail open + row selection) mirrors the reference.
import type {
  AutomationRunsDashboardEntry,
} from "./automation-runs-dashboard-model";
import { AutomationRunsDashboard } from "./AutomationRunsDashboard";

export function AutomationRunsDashboardSurface({
  entries,
  loading,
  hasMore,
  onLoadMore,
  now,
  error,
  onRefresh,
  onOpenRun,
}: {
  entries: readonly AutomationRunsDashboardEntry[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  now: number;
  error: string | null;
  onRefresh: () => void;
  onOpenRun: (entry: AutomationRunsDashboardEntry) => void;
}): React.JSX.Element {
  return (
    <AutomationRunsDashboard
      entries={entries}
      loading={loading}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      now={now}
      error={error}
      onRefresh={onRefresh}
      onOpenRun={onOpenRun}
    />
  );
}
