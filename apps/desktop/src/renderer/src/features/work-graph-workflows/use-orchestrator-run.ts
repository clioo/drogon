import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignableIntentNode,
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";

export function useOrchestratorRun(
  bridge: GraphBridge | null,
  workspaceId: string,
  pollMs = 1000,
) {
  const [run, setRun] = useState<OrchestratorRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = useRef(workspaceId);
  const mutation = useRef(0);
  const mutating = useRef(false);
  scope.current = workspaceId;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setRun(null);
    setError(null);
    setBusy(false);
    const poll = async () => {
      const version = mutation.current;
      try {
        const result = await bridge?.graphOrchestratorStatus?.({ workspaceId });
        if (
          !cancelled &&
          result &&
          !mutating.current &&
          version === mutation.current
        ) {
          if (result.ok) {
            setRun(result.result.run);
            setError(null);
          } else setError(result.error.message);
        }
      } catch (reason) {
        if (!cancelled) setError(String(reason));
      }
      if (!cancelled) timer = setTimeout(() => void poll(), pollMs);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bridge, workspaceId, pollMs]);
  const start = useCallback(
    async (main: DesignableIntentNode) => {
      if (!bridge?.graphOrchestratorStart) return;
      mutation.current++;
      mutating.current = true;
      setBusy(true);
      try {
        const result = await bridge.graphOrchestratorStart({
          workspaceId,
          main,
        });
        if (scope.current !== workspaceId) return;
        if (result.ok) {
          setRun(result.result.run);
          setError(null);
        } else setError(result.error.message);
      } catch (reason) {
        if (scope.current === workspaceId) setError(String(reason));
      } finally {
        mutation.current++;
        mutating.current = false;
        if (scope.current === workspaceId) setBusy(false);
      }
    },
    [bridge, workspaceId],
  );
  const stop = useCallback(async () => {
    if (!run || !bridge?.graphOrchestratorStop) return;
    mutation.current++;
    mutating.current = true;
    try {
      const result = await bridge.graphOrchestratorStop({
        workspaceId,
        runId: run.id,
      });
      if (scope.current !== workspaceId) return;
      if (result.ok) setRun(result.result.run);
      else setError(result.error.message);
    } catch (reason) {
      if (scope.current === workspaceId) setError(String(reason));
    } finally {
      mutation.current++;
      mutating.current = false;
    }
  }, [bridge, workspaceId, run]);
  const resume = useCallback(async () => {
    if (!run || !bridge?.graphOrchestratorResume) return;
    mutation.current++;
    mutating.current = true;
    setBusy(true);
    try {
      const result = await bridge.graphOrchestratorResume({
        workspaceId,
        runId: run.id,
      });
      if (scope.current !== workspaceId) return;
      if (result.ok) {
        setRun(result.result.run);
        setError(null);
      } else setError(result.error.message);
    } catch (reason) {
      if (scope.current === workspaceId) setError(String(reason));
    } finally {
      mutation.current++;
      mutating.current = false;
      if (scope.current === workspaceId) setBusy(false);
    }
  }, [bridge, workspaceId, run]);
  return { run, error, busy, start, stop, resume };
}
