// MIT Copyright (c) 2026 Lovecast Inc.
// The adversarial-review loop's I/O controller: the ONLY place that turns
// the pure `advanceLoop` reducer's decisions into real daemon calls. Every
// review/fix "cycle" goes through the SAME sanctioned seam the design
// canvas uses — `graph.write_intent` (append one node, never touch the
// human's own nodes or `state`), `graph.compile` (the runtime's own
// findings, checked before anything launches), `graph.run` (the one
// execution path) — polled through `graph.read` until the daemon reports a
// terminal, confirmed status. Nothing here estimates a node's outcome.
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
  isTerminalPhase,
  parseLoopLedger,
  startLedger,
  type LoopLedger,
} from "./adversarial-loop";

const POLL_MS = 2_000;

export type StartLoopInput = {
  workflowId: string;
  baseRunId: string;
  baseNodeIds: string[];
  maxCycles: number;
};

function reviewNodePayload(nodeId: string, prompt: string, verifyCommand: string): Record<string, unknown> {
  return {
    id: nodeId,
    title: `Adversarial review (${nodeId})`,
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
    title: `Adversarial fix (${nodeId})`,
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

  const setAndPersist = useCallback((next: LoopLedger | null) => {
    ledgerRef.current = next;
    setLedger(next);
    if (next && persistRef.current) persistRef.current(next);
  }, []);

  const startForRun = useCallback(
    (input: StartLoopInput) => {
      if (ledgerRef.current && !isTerminalPhase(ledgerRef.current.phase)) return;
      setAndPersist(
        startLedger({
          workflowId: input.workflowId,
          baseRunId: input.baseRunId,
          baseNodeIds: input.baseNodeIds,
          maxCycles: input.maxCycles,
          now: new Date().toISOString(),
        }),
      );
    },
    [setAndPersist],
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
        const { ledger: advanced, action } = advanceLoop(current, observed, now);
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
        const compiled = await graphBridge.graphCompile({ workspaceId, nodeId: action.nodeId });
        if (cancelled || ledgerRef.current !== current) return;
        const errors = compiled.ok
          ? compiled.result.findings.filter((finding) => finding.severity === "error")
          : null;
        if (!compiled.ok || (errors && errors.length > 0)) {
          const reason = !compiled.ok
            ? compiled.error.message
            : (errors ?? []).map((finding) => `${finding.code}: ${finding.message}`).join("; ");
          setAndPersist({
            ...advanced,
            phase: "launch_refused",
            activeNodeId: null,
            updatedAt: now,
            message: `Cycle ${action.cycle} would not compile, so it was never run: ${reason}`,
          });
          return;
        }
        const run = await graphBridge.graphRun({ workspaceId, nodeId: action.nodeId });
        if (cancelled || ledgerRef.current !== current) return;
        if (!run.ok) {
          setAndPersist({
            ...advanced,
            phase: "launch_refused",
            activeNodeId: null,
            updatedAt: now,
            message: `Cycle ${action.cycle} could not be launched: ${run.error.message}`,
          });
          return;
        }
        setAndPersist(advanced);
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

  return { ledger, startForRun, hydrate, setPersist };
}
