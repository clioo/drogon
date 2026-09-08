// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/use-automation-runs-dashboard.ts.
// Adaptation: the daemon aggregates runs across automations
// (`automation.runs_all` with page/perPage), so the source's bounded
// per-row fan-out, cursors and host-authority keying collapse into one
// paged query; append dedupes by run id exactly like the source's merge.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AutomationBridge,
  AutomationRunListItem,
} from "../../../../shared/automation-contract";

const RUNS_PAGE_SIZE = 50;

type DashboardState = {
  items: AutomationRunListItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
};

const EMPTY: Omit<DashboardState, "loadMore"> = {
  items: [],
  loading: false,
  error: null,
  hasMore: false,
};

export function useAutomationRunsDashboard({
  enabled,
  bridge,
  reloadToken,
}: {
  enabled: boolean;
  bridge: AutomationBridge;
  reloadToken: number;
}): DashboardState {
  const [items, setItems] = useState<AutomationRunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // Null while disabled: a fresh re-entry never resumes from the previous
  // session's paging state, however many times load-more fired before it.
  const pageRef = useRef<number | null>(null);
  const [loadMoreToken, setLoadMoreToken] = useState(0);
  const loadMore = useCallback(() => setLoadMoreToken((token) => token + 1), []);

  useEffect(() => {
    if (!enabled) {
      pageRef.current = null;
      setItems([]);
      setError(null);
      setHasMore(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const fetchingMore = pageRef.current !== null && loadMoreToken > 0;
    const page = fetchingMore ? (pageRef.current ?? 0) + 1 : 1;
    pageRef.current = page;
    setLoading(true);
    setError(null);
    void bridge.runsAll({ page, perPage: RUNS_PAGE_SIZE }).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        // A failed read keeps the already-shown page; only a successful
        // terminal page retires the load-more affordance.
        setError(result.error.message);
        setHasMore(true);
        pageRef.current = fetchingMore ? (pageRef.current ?? 1) - 1 : null;
        setLoading(false);
        return;
      }
      const runs = result.result.runs;
      setItems((current) => {
        if (!fetchingMore) {
          return runs;
        }
        const seen = new Set(current.map((run) => run.id));
        return [...current, ...runs.filter((run) => !seen.has(run.id))];
      });
      setHasMore(page * RUNS_PAGE_SIZE < result.result.total);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, enabled, loadMoreToken, reloadToken]);

  return { items, loading, error, hasMore, loadMore };
}
