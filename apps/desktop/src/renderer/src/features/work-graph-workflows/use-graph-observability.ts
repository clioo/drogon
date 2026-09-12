import { useCallback, useEffect, useState } from "react";
import type {
  GraphBridge,
  GraphObservabilitySnapshot,
} from "../../../../shared/graph-contract";

const EMPTY: GraphObservabilitySnapshot = {
  evidence: [],
  usage: [],
  updatedAt: "",
};

export function useGraphObservability(
  bridge: GraphBridge | null,
  workspaceId: string,
  pollMs = 2_000,
): {
  snapshot: GraphObservabilitySnapshot;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (!bridge?.graphObservabilityStatus) {
      setLoading(false);
      setError("Native Evidence and Usage are unavailable in this build.");
      return;
    }
    try {
      const result = await bridge.graphObservabilityStatus({ workspaceId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSnapshot(result.result.observability);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [bridge, workspaceId]);

  useEffect(() => {
    setSnapshot(EMPTY);
    setLoading(true);
    void read();
    const interval = window.setInterval(() => void read(), pollMs);
    return () => window.clearInterval(interval);
  }, [pollMs, read]);

  return { snapshot, loading, error, refresh: () => void read() };
}
