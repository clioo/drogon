import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignableIntentNode,
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";

type RunObserver = (workspaceId: string, run: OrchestratorRun | null) => void;
const runObservers = new Set<RunObserver>();

function publishRun(workspaceId: string, run: OrchestratorRun | null): void {
  for (const observer of runObservers) observer(workspaceId, run);
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
  const mutation = useRef(0);
  const mutating = useRef(false);
  scope.current = workspaceId;
  useEffect(() => {
    const observe: RunObserver = (observedWorkspaceId, observed) => {
      if (observedWorkspaceId !== scope.current) return;
      mutation.current++;
      setRun(observed);
      setError(null);
      setRefreshEpoch((epoch) => epoch + 1);
    };
    runObservers.add(observe);
    return () => {
      runObservers.delete(observe);
    };
  }, []);
  useEffect(() => {
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
            setRun((current) => observed ?? current);
            setError(null);
            if (observed?.steps.some((step) => step.status === "dispatching")) {
              nextPollMs = Math.min(pollMs, 100);
            } else if (
              !observed ||
              (observed.status !== "running" && observed.status !== "stopping")
            ) {
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
          setRun(result.result.run);
          setError(null);
          publishRun(workspaceId, result.result.run);
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
        setRun(result.result.run);
        publishRun(workspaceId, result.result.run);
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
        setRun(result.result.run);
        setError(null);
        publishRun(workspaceId, result.result.run);
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
