import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignableIntentNode,
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";

type RunObserver = () => void;
const runObservers = new WeakMap<
  GraphBridge,
  Map<string, Set<RunObserver>>
>();
const latestRunSnapshots = new WeakMap<
  GraphBridge,
  Map<string, OrchestratorRun>
>();
const RUN_STATUS_UNAVAILABLE = "Latest Work Graph status is unavailable.";

function publishRefresh(bridge: GraphBridge, workspaceId: string): void {
  for (const observer of runObservers.get(bridge)?.get(workspaceId) ?? []) {
    observer();
  }
}

function newestRunSnapshot(
  current: OrchestratorRun | null,
  observed: OrchestratorRun | null,
): OrchestratorRun | null {
  if (!observed) return current;
  if (!current) return observed;
  const currentTime = Date.parse(current.updatedAt);
  const observedTime = Date.parse(observed.updatedAt);
  if (Number.isFinite(currentTime) && Number.isFinite(observedTime)) {
    return observedTime >= currentTime ? observed : current;
  }
  return observed.updatedAt >= current.updatedAt ? observed : current;
}

function newestScopedRunSnapshot(
  bridge: GraphBridge,
  workspaceId: string,
  current: OrchestratorRun | null,
  observed: OrchestratorRun | null,
): OrchestratorRun | null {
  const snapshots =
    latestRunSnapshots.get(bridge) ?? new Map<string, OrchestratorRun>();
  const next = newestRunSnapshot(
    newestRunSnapshot(current, snapshots.get(workspaceId) ?? null),
    observed,
  );
  if (next) {
    snapshots.set(workspaceId, next);
    latestRunSnapshots.set(bridge, snapshots);
  }
  return next;
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
  const mounted = useRef(false);
  scope.current = workspaceId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!bridge) return;
    const observe: RunObserver = () => {
      // Invalidate an older in-flight read, then ask the daemon for its latest
      // durable snapshot instead of publishing a possibly stale mutation reply.
      mutation.current++;
      setRefreshEpoch((epoch) => epoch + 1);
    };
    const scopes =
      runObservers.get(bridge) ?? new Map<string, Set<RunObserver>>();
    const observers = scopes.get(workspaceId) ?? new Set<RunObserver>();
    observers.add(observe);
    scopes.set(workspaceId, observers);
    runObservers.set(bridge, scopes);
    return () => {
      observers.delete(observe);
      if (observers.size === 0) {
        scopes.delete(workspaceId);
        const snapshots = latestRunSnapshots.get(bridge);
        snapshots?.delete(workspaceId);
        if (snapshots?.size === 0) latestRunSnapshots.delete(bridge);
      }
      if (scopes.size === 0) runObservers.delete(bridge);
    };
  }, [bridge, workspaceId]);
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
            const next = newestScopedRunSnapshot(
              bridge,
              workspaceId,
              durableRun.current,
              observed,
            );
            durableRun.current = next;
            setRun(next);
            setError(observed || !next ? null : RUN_STATUS_UNAVAILABLE);
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
        if (!mounted.current || scope.current !== workspaceId) return;
        if (result.ok) {
          const next = newestScopedRunSnapshot(
            bridge,
            workspaceId,
            durableRun.current,
            result.result.run,
          );
          durableRun.current = next;
          setRun(next);
          setError(result.result.run ? null : RUN_STATUS_UNAVAILABLE);
          publishRefresh(bridge, workspaceId);
        } else setError(result.error.message);
      } catch (reason) {
        if (mounted.current && scope.current === workspaceId) {
          setError(String(reason));
        }
      } finally {
        mutation.current++;
        mutating.current = false;
        if (mounted.current && scope.current === workspaceId) setBusy(false);
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
      if (!mounted.current || scope.current !== workspaceId) return;
      if (result.ok) {
        const next = newestScopedRunSnapshot(
          bridge,
          workspaceId,
          durableRun.current,
          result.result.run,
        );
        durableRun.current = next;
        setRun(next);
        setError(result.result.run ? null : RUN_STATUS_UNAVAILABLE);
        publishRefresh(bridge, workspaceId);
      } else setError(result.error.message);
    } catch (reason) {
      if (mounted.current && scope.current === workspaceId) {
        setError(String(reason));
      }
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
      if (!mounted.current || scope.current !== workspaceId) return;
      if (result.ok) {
        const next = newestScopedRunSnapshot(
          bridge,
          workspaceId,
          durableRun.current,
          result.result.run,
        );
        durableRun.current = next;
        setRun(next);
        setError(result.result.run ? null : RUN_STATUS_UNAVAILABLE);
        publishRefresh(bridge, workspaceId);
      } else setError(result.error.message);
    } catch (reason) {
      if (mounted.current && scope.current === workspaceId) {
        setError(String(reason));
      }
    } finally {
      mutation.current++;
      mutating.current = false;
      if (mounted.current && scope.current === workspaceId) setBusy(false);
    }
  }, [bridge, workspaceId, run]);
  return { run, error, busy, start, stop, resume };
}
