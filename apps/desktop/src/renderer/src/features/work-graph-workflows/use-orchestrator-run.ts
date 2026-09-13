import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignableIntentNode,
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";

type RunObserver = (workspaceId: string) => void;
const runObservers = new WeakMap<GraphBridge, Set<RunObserver>>();

function publishRefresh(bridge: GraphBridge, workspaceId: string): void {
  for (const observer of runObservers.get(bridge) ?? []) observer(workspaceId);
}

export function useOrchestratorRun(
  bridge: GraphBridge | null,
  workspaceId: string,
  pollMs = 1000,
  inactivePollMs = pollMs,
) {
  const [run, setRun] = useState<OrchestratorRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const scope = useRef(workspaceId);
  const durableRun = useRef<OrchestratorRun | null>(null);
  const mutation = useRef(0);
  const mutating = useRef(false);
  scope.current = workspaceId;
  useEffect(() => {
    if (!bridge) return;
    const observe: RunObserver = (observedWorkspaceId) => {
      if (observedWorkspaceId !== scope.current) return;
      // Invalidate an older in-flight read, then ask the daemon for its latest
      // durable snapshot instead of publishing a possibly stale mutation reply.
      mutation.current++;
      setRefreshEpoch((epoch) => epoch + 1);
    };
    const observers = runObservers.get(bridge) ?? new Set<RunObserver>();
    observers.add(observe);
    runObservers.set(bridge, observers);
    return () => {
      observers.delete(observe);
      if (observers.size === 0) runObservers.delete(bridge);
    };
  }, [bridge]);
  useEffect(() => {
    durableRun.current = null;
    setRun(null);
    setError(null);
    setBusy(false);
  }, [bridge, workspaceId]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    if (!bridge?.graphOrchestratorStatus) return;
    const poll = async () => {
      const version = mutation.current;
      let nextPollMs = pollMs;
      try {
        const result = await bridge?.graphOrchestratorStatus?.({ workspaceId });
        if (
          !cancelled &&
          result &&
          !mutating.current &&
          version === mutation.current
        ) {
          if (result.ok) {
            const observed = result.result.run;
            // Orchestrator runs are durable. A later empty observation cannot
            // erase already-seen evidence; workspace/bridge changes reset it.
            const next = observed ?? durableRun.current;
            durableRun.current = next;
            setRun(next);
            setError(null);
            const active =
              next?.status === "running" || next?.status === "stopping";
            if (
              active &&
              next.steps.some((step) => step.status === "dispatching")
            ) {
              nextPollMs = Math.min(pollMs, 100);
            } else if (!active) {
              nextPollMs = inactivePollMs;
            }
          } else setError(result.error.message);
        }
      } catch (reason) {
        if (!cancelled) setError(String(reason));
      }
      if (!cancelled) timer = setTimeout(() => void poll(), nextPollMs);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bridge, workspaceId, pollMs, inactivePollMs, refreshEpoch]);
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
          const next = result.result.run ?? durableRun.current;
          durableRun.current = next;
          setRun(next);
          setError(null);
          publishRefresh(bridge, workspaceId);
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
      if (result.ok) {
        const next = result.result.run ?? durableRun.current;
        durableRun.current = next;
        setRun(next);
        publishRefresh(bridge, workspaceId);
      } else setError(result.error.message);
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
        const next = result.result.run ?? durableRun.current;
        durableRun.current = next;
        setRun(next);
        setError(null);
        publishRefresh(bridge, workspaceId);
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
