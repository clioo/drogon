// MIT Copyright (c) 2026 Lovecast Inc.
// The adversarial-review loop's I/O controller: the ONLY place that turns
// the pure `advanceLoop` reducer's decisions into real daemon calls. Every
// review/fix "cycle" goes through the SAME sanctioned seam the design
// canvas uses to APPEND a node — `graph.write_intent` (one node, never
// touching the human's own nodes or `state`) — then launches it through
// `graph.run_node_failover`: the Subagent policy's approved-runtime order,
// then the fallback, the same seam any other policy-governed subagent uses
// (`crates/drogon-core/src/graph_rpc.rs`), rather than a hardcoded model —
// polled through `graph.read` until the daemon reports a terminal,
// confirmed status. Nothing here estimates a node's outcome.
//
// The node's own stored harness/model (`ADVERSARIAL_HARNESS`/
// `ADVERSARIAL_MODEL` below) are a SAFE DEFAULT for the payload's shape
// validation, not what actually runs: `graph.run_node_failover` overrides
// them per attempt with whichever runtime the workspace's Subagent policy
// says to try — the free local model when nothing is configured yet, so
// this loop costs nothing until someone opens the policy panel.
//
// Lives in `WorkGraphPane` (the parent of both the read-only view and the
// design canvas) specifically so it keeps running across the view↔design
// toggle — clicking "Watch the graph" after launching a run must not kill
// the review that run just asked for.
//
// If the pane itself unmounts (workspace switch, app close), this
// controller simply stops making decisions — exactly like any other
// coordinator process going away: whatever node was already launched keeps
// whatever REAL status the daemon reports for it, never a lie in either
// direction. On remount, the ledger rehydrates from the workflow's
// `lastLoop` and the very next poll re-reads the ACTUAL node status before
// resuming — it never assumes the last thing it remembers is still true.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphBridge } from "../../../../shared/graph-contract";
import type { WorkGraphStatus } from "../../../../shared/work-graph-contract";
import {
  ADVERSARIAL_HARNESS,
  ADVERSARIAL_MODEL,
  advanceLoop,
  dispatchRefusedLedger,
  isTerminalPhase,
  parseLoopLedger,
  startLedger,
  type BaseSessionObservation,
  type LoopLedger,
} from "./adversarial-loop";

const POLL_MS = 2_000;

export type StartLoopInput = {
  workflowId: string;
  baseRunId: string;
  baseNodeIds: string[];
  /** DISHONEST-1: the Main agent's live session this run dispatched its
   *  base work to, when the base work is that session rather than a batch
   *  workflow's graph nodes. */
  baseSessionId?: string | null;
  maxCycles: number;
};

export type StartFailedDispatchInput = {
  workflowId: string;
  baseRunId: string;
  maxCycles: number;
  message: string;
};

function reviewNodePayload(nodeId: string, prompt: string, verifyCommand: string): Record<string, unknown> {
  return {
    id: nodeId,
    title: `Adversarial test (${nodeId})`,
    harness: ADVERSARIAL_HARNESS,
    model: ADVERSARIAL_MODEL,
    dependsOn: [],
    prompt,
    enabled: true,
    verifyCommands: [verifyCommand],
  };
}

function fixNodePayload(nodeId: string, prompt: string): Record<string, unknown> {
  return {
    id: nodeId,
    title: `Code review (${nodeId})`,
    harness: ADVERSARIAL_HARNESS,
    model: ADVERSARIAL_MODEL,
    dependsOn: [],
    prompt,
    enabled: true,
  };
}

export function useAdversarialLoop({
  graphBridge,
  workspaceId,
  pollMs = POLL_MS,
}: {
  graphBridge: GraphBridge | null;
  workspaceId: string;
  /** Poll cadence, in ms. Defaults to the real product cadence; tests
   *  override it to exercise multiple cycles without real wall-clock
   *  waits — production behavior is unaffected. */
  pollMs?: number;
}): {
  ledger: LoopLedger | null;
  /** Begins a loop for a just-launched run. A no-op while another loop for
   *  the same or a different workflow is still in flight — one loop at a
   *  time, same as the daemon allowing only one live run per node. */
  startForRun: (input: StartLoopInput) => void;
  /** DISHONEST-1: records a loop that never started because the base work
   *  could not even be dispatched to the Main agent's session — a
   *  terminal, honest `launch_refused` ledger from the first tick. Same
   *  in-flight guard as `startForRun`. */
  startFailedDispatch: (input: StartFailedDispatchInput) => void;
  /** DISHONEST-1: the caller's latest READ of the dispatched base
   *  session's own state (never guessed here) — consulted only while the
   *  ledger's `baseSessionId` is set and its phase is `awaiting_base`. Feed
   *  this every time the caller observes the session, even unchanged; a
   *  stale/mismatched `sessionId` (not the one this ledger is waiting on)
   *  is ignored. */
  setBaseSessionObservation: (sessionId: string, observation: BaseSessionObservation) => void;
  /** Rehydrates the ledger for the currently-selected workflow from its
   *  persisted `lastLoop` (or clears it when the workflow has none / the
   *  library belongs to a different workflow). Call when the selected
   *  workflow changes. */
  hydrate: (workflowId: string, lastLoop: unknown) => void;
  /** Registers where every ledger change gets persisted (the workflow
   *  library's `lastLoop`). Kept separate from the hook's constructor
   *  props so this controller and `useWorkflowLibrary` stay independently
   *  testable. */
  setPersist: (fn: ((ledger: LoopLedger) => void) | null) => void;
} {
  const [ledger, setLedger] = useState<LoopLedger | null>(null);
  const ledgerRef = useRef<LoopLedger | null>(null);
  const actionInFlight = useRef(false);
  const persistRef = useRef<((ledger: LoopLedger) => void) | null>(null);
  const baseSessionObservationRef = useRef<{
    sessionId: string;
    observation: BaseSessionObservation;
  } | null>(null);

  const setAndPersist = useCallback((next: LoopLedger | null) => {
    ledgerRef.current = next;
    setLedger(next);
    if (next && persistRef.current) persistRef.current(next);
  }, []);

  const startForRun = useCallback(
    (input: StartLoopInput) => {
      if (ledgerRef.current && !isTerminalPhase(ledgerRef.current.phase)) return;
      baseSessionObservationRef.current = null;
      setAndPersist(
        startLedger({
          workflowId: input.workflowId,
          baseRunId: input.baseRunId,
          baseNodeIds: input.baseNodeIds,
          baseSessionId: input.baseSessionId ?? null,
          maxCycles: input.maxCycles,
          now: new Date().toISOString(),
        }),
      );
    },
    [setAndPersist],
  );

  const startFailedDispatch = useCallback(
    (input: StartFailedDispatchInput) => {
      if (ledgerRef.current && !isTerminalPhase(ledgerRef.current.phase)) return;
      baseSessionObservationRef.current = null;
      setAndPersist(
        dispatchRefusedLedger({
          workflowId: input.workflowId,
          baseRunId: input.baseRunId,
          maxCycles: input.maxCycles,
          message: input.message,
          now: new Date().toISOString(),
        }),
      );
    },
    [setAndPersist],
  );

  const setBaseSessionObservation = useCallback(
    (sessionId: string, observation: BaseSessionObservation) => {
      baseSessionObservationRef.current = { sessionId, observation };
    },
    [],
  );

  const hydrate = useCallback((workflowId: string, lastLoop: unknown) => {
    const resumed = parseLoopLedger(lastLoop, workflowId);
    ledgerRef.current = resumed;
    setLedger(resumed);
  }, []);

  useEffect(() => {
    if (!graphBridge) return undefined;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const current = ledgerRef.current;
      if (!current || isTerminalPhase(current.phase) || actionInFlight.current) return;
      actionInFlight.current = true;
      try {
        const read = await graphBridge.graphRead({ workspaceId });
        if (cancelled || ledgerRef.current !== current) return;
        if (!read.ok) return; // a transient read failure just waits for the next tick.
        const observed = new Map<string, WorkGraphStatus>(
          read.result.graph.state.nodes.map((node) => [node.id, node.status]),
        );
        const now = new Date().toISOString();

        // BROKEN-2: a node's own recipe step failing is not automatically
        // "the review found problems" or "the fix attempt failed" — the
        // Subagent policy's approved-runtime list promises every runtime is
        // tried before that verdict is final. Retry failover on the SAME
        // node first; only once `graph.run_node_failover` itself refuses
        // (every approved runtime, then the fallback, genuinely exhausted)
        // does the reducer ever see this cycle's `failed` status. A runtime
        // that merely launches keeps the ledger exactly where it is — the
        // next tick re-reads the new attempt's real, settled status.
        if (current.activeNodeId && observed.get(current.activeNodeId) === "failed") {
          const retried = await graphBridge.graphRunNodeFailover({
            workspaceId,
            nodeId: current.activeNodeId,
          });
          if (cancelled || ledgerRef.current !== current) return;
          if (retried.ok) return;
        }

        // DISHONEST-1: the reducer never guesses the Main agent session's
        // state itself — the caller (`WorkGraphPane`, which already
        // receives that session reactively) reports what it observed via
        // `setBaseSessionObservation`. A mismatched/stale sessionId (a
        // report for a session this ledger isn't waiting on) is ignored.
        const baseObservation =
          current.baseSessionId && baseSessionObservationRef.current?.sessionId === current.baseSessionId
            ? baseSessionObservationRef.current.observation
            : undefined;
        const { ledger: advanced, action } = advanceLoop(current, observed, now, baseObservation);
        if (action.kind === "none") {
          if (advanced !== current) setAndPersist(advanced);
          return;
        }
        // A node must be launched: append it to the CURRENT full intent
        // (never replace) so every other node — the human's own graph, and
        // every earlier cycle's nodes — survives untouched.
        const currentNodes = read.result.graph.intent.nodes as unknown[];
        const payload =
          action.kind === "launch_review"
            ? reviewNodePayload(action.nodeId, action.prompt, action.verifyCommand)
            : fixNodePayload(action.nodeId, action.prompt);
        const written = await graphBridge.graphWriteIntent({
          workspaceId,
          intent: { nodes: [...currentNodes, payload] },
        });
        if (cancelled || ledgerRef.current !== current) return;
        if (!written.ok) {
          setAndPersist({
            ...advanced,
            phase: "launch_refused",
            activeNodeId: null,
            updatedAt: now,
            message: `Cycle ${action.cycle} could not be saved to the graph: ${written.error.message}`,
          });
          return;
        }
        const launched = await graphBridge.graphRunNodeFailover({ workspaceId, nodeId: action.nodeId });
        if (cancelled || ledgerRef.current !== current) return;
        if (!launched.ok) {
          setAndPersist({
            ...advanced,
            phase: "launch_refused",
            activeNodeId: null,
            updatedAt: now,
            message: `Cycle ${action.cycle} could not be launched: ${launched.error.message}`,
          });
          return;
        }
        // F0: attribute which runtime actually ran this cycle instead of
        // discarding the RPC's own answer — the one thing that made the
        // loop's paid/external spawns unattributable anywhere.
        setAndPersist({
          ...advanced,
          lastRuntime: launched.result.runtime,
          lastRuntimeIsFallback: launched.result.isFallback,
        });
      } finally {
        actionInFlight.current = false;
      }
    };
    const interval = window.setInterval(() => void tick(), pollMs);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [graphBridge, workspaceId, setAndPersist, pollMs]);

  const setPersist = useCallback((fn: ((ledger: LoopLedger) => void) | null) => {
    persistRef.current = fn;
  }, []);

  return {
    ledger,
    startForRun,
    startFailedDispatch,
    setBaseSessionObservation,
    hydrate,
    setPersist,
  };
}
