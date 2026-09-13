import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignableIntentNode,
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";

type RunObserver = (unavailable?: boolean) => void;
const runObservers = new WeakMap<
  GraphBridge,
  Map<string, Set<RunObserver>>
>();
const latestRunSnapshots = new WeakMap<
  GraphBridge,
  Map<string, OrchestratorRun>
>();
const unavailableRunScopes = new WeakMap<GraphBridge, Set<string>>();
const RUN_STATUS_UNAVAILABLE = "Latest Work Graph status is unavailable.";
const MAX_CACHED_WORKSPACES = 256;

function publishRefresh(bridge: GraphBridge, workspaceId: string): void {
  for (const observer of runObservers.get(bridge)?.get(workspaceId) ?? []) {
    observer();
  }
}

function publishAvailability(
  bridge: GraphBridge,
  workspaceId: string,
  unavailable: boolean,
): void {
  if (!latestRunSnapshots.get(bridge)?.has(workspaceId)) return;
  const scopes = unavailableRunScopes.get(bridge) ?? new Set<string>();
  if (scopes.has(workspaceId) === unavailable) return;
  if (unavailable) scopes.add(workspaceId);
  else scopes.delete(workspaceId);
  if (scopes.size > 0) unavailableRunScopes.set(bridge, scopes);
  else unavailableRunScopes.delete(bridge);
  for (const observer of runObservers.get(bridge)?.get(workspaceId) ?? []) {
    observer(unavailable);
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
    snapshots.delete(workspaceId);
    snapshots.set(workspaceId, next);
    if (snapshots.size > MAX_CACHED_WORKSPACES) {
      const oldest = snapshots.keys().next().value;
      if (oldest !== undefined) {
        snapshots.delete(oldest);
        const unavailable = unavailableRunScopes.get(bridge);
        unavailable?.delete(oldest);
        if (unavailable?.size === 0) unavailableRunScopes.delete(bridge);
      }
    }
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
  const pollVersions = useRef(new Map<string, number>());
  const mutatingScopes = useRef(new Map<string, number>());
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
    const observe: RunObserver = (unavailable) => {
      if (unavailable !== undefined) {
        setError(unavailable ? RUN_STATUS_UNAVAILABLE : null);
        return;
      }
      // Invalidate an older in-flight read, then ask the daemon for its latest
      // durable snapshot instead of publishing a possibly stale mutation reply.
      pollVersions.current.set(
        workspaceId,
        (pollVersions.current.get(workspaceId) ?? 0) + 1,
      );
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
      if (observers.size === 0) scopes.delete(workspaceId);
      if (!mutatingScopes.current.has(workspaceId)) {
        pollVersions.current.delete(workspaceId);
      }
      if (scopes.size === 0) runObservers.delete(bridge);
    };
  }, [bridge, workspaceId]);
  useEffect(() => {
    durableRun.current = null;
    setRun(null);
    setError(
      bridge && unavailableRunScopes.get(bridge)?.has(workspaceId)
        ? RUN_STATUS_UNAVAILABLE
        : null,
    );
    setBusy(false);
  }, [bridge, workspaceId]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    if (!bridge?.graphOrchestratorStatus) return;
    const poll = async () => {
      const version = pollVersions.current.get(workspaceId) ?? 0;
      let nextPollMs = pollMs;
      try {
        const result = await bridge?.graphOrchestratorStatus?.({ workspaceId });
        if (
          !cancelled &&
          result &&
          !mutatingScopes.current.has(workspaceId) &&
          version === (pollVersions.current.get(workspaceId) ?? 0)
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
            publishAvailability(bridge, workspaceId, !observed && !!next);
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
          } else {
            setError(result.error.message);
            publishAvailability(bridge, workspaceId, true);
          }
        }
      } catch (reason) {
        if (!cancelled) {
          setError(String(reason));
          publishAvailability(bridge, workspaceId, true);
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), nextPollMs);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bridge, workspaceId, pollMs, inactivePollMs, refreshEpoch]);
  const beginMutation = () => {
    pollVersions.current.set(
      workspaceId,
      (pollVersions.current.get(workspaceId) ?? 0) + 1,
    );
    mutatingScopes.current.set(
      workspaceId,
      (mutatingScopes.current.get(workspaceId) ?? 0) + 1,
    );
  };
  const endMutation = () => {
    pollVersions.current.set(
      workspaceId,
      (pollVersions.current.get(workspaceId) ?? 0) + 1,
    );
    const remaining = (mutatingScopes.current.get(workspaceId) ?? 1) - 1;
    if (remaining > 0) mutatingScopes.current.set(workspaceId, remaining);
    else {
      mutatingScopes.current.delete(workspaceId);
      if (scope.current !== workspaceId) {
        pollVersions.current.delete(workspaceId);
      }
    }
  };
  const applyMutationResult = (observed: OrchestratorRun | null) => {
    const next = newestScopedRunSnapshot(
      bridge as GraphBridge,
      workspaceId,
      scope.current === workspaceId ? durableRun.current : null,
      observed,
    );
    publishAvailability(bridge as GraphBridge, workspaceId, !observed);
    publishRefresh(bridge as GraphBridge, workspaceId);
    if (!mounted.current || scope.current !== workspaceId) return;
    durableRun.current = next;
    setRun(next);
    setError(observed ? null : RUN_STATUS_UNAVAILABLE);
  };
  const start = useCallback(
    async (main: DesignableIntentNode) => {
      if (!bridge?.graphOrchestratorStart) return;
      beginMutation();
      setBusy(true);
      try {
        const result = await bridge.graphOrchestratorStart({ workspaceId, main });
        if (result.ok) applyMutationResult(result.result.run);
        else if (mounted.current && scope.current === workspaceId) {
          setError(result.error.message);
        }
      } catch (reason) {
        if (mounted.current && scope.current === workspaceId) {
          setError(String(reason));
        }
      } finally {
        endMutation();
        if (mounted.current && scope.current === workspaceId) setBusy(false);
      }
    },
    [bridge, workspaceId],
  );
  const stop = useCallback(async () => {
    if (!run || !bridge?.graphOrchestratorStop) return;
    beginMutation();
    setBusy(true);
    try {
      const result = await bridge.graphOrchestratorStop({
        workspaceId,
        runId: run.id,
      });
      if (result.ok) applyMutationResult(result.result.run);
      else if (mounted.current && scope.current === workspaceId) {
        setError(result.error.message);
      }
    } catch (reason) {
      if (mounted.current && scope.current === workspaceId) {
        setError(String(reason));
      }
    } finally {
      endMutation();
      if (mounted.current && scope.current === workspaceId) setBusy(false);
    }
  }, [bridge, workspaceId, run]);
  const resume = useCallback(async () => {
    if (!run || !bridge?.graphOrchestratorResume) return;
    beginMutation();
    setBusy(true);
    try {
      const result = await bridge.graphOrchestratorResume({
        workspaceId,
        runId: run.id,
      });
      if (result.ok) applyMutationResult(result.result.run);
      else if (mounted.current && scope.current === workspaceId) {
        setError(result.error.message);
      }
    } catch (reason) {
      if (mounted.current && scope.current === workspaceId) {
        setError(String(reason));
      }
    } finally {
      endMutation();
      if (mounted.current && scope.current === workspaceId) setBusy(false);
    }
  }, [bridge, workspaceId, run]);
  return { run, error, busy, start, stop, resume };
}
