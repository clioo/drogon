// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// End-to-end wiring test over a FAKE graph bridge: proves the hook really
// drives `graph.write_intent` → `graph.run_node_failover` for each cycle
// (never a second engine, never a hardcoded runtime — the Subagent
// policy's failover seam), appends nodes without ever touching the base
// graph's own nodes, and reaches the exact required outcomes — "passed"
// after a genuine daemon-observed success, and the literal "Stopped after
// N review cycles, still failing." at the cap — driven entirely by
// OBSERVED node status from `graph.read`, never inferred.

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  GraphBridge,
  GraphNodeParams,
  GraphResult,
  GraphWriteIntentParams,
} from "../../../../shared/graph-contract";
import type { WorkGraphStatus } from "../../../../shared/work-graph-contract";
import { fixNodeId, reviewNodeId, runToken } from "./adversarial-loop";
import { useAdversarialLoop } from "./use-adversarial-loop";

const WORKSPACE_ID = "ws1";
const BASE_RUN_ID = "run-xyz";
const TOKEN = runToken(BASE_RUN_ID);

type Recorded = {
  writes: GraphWriteIntentParams[];
  failovers: GraphNodeParams[];
};

function makeBridge(): {
  bridge: GraphBridge;
  recorded: Recorded;
  setStatus: (nodeId: string, status: WorkGraphStatus) => void;
} {
  const recorded: Recorded = { writes: [], failovers: [] };
  let intentNodes: Record<string, unknown>[] = [
    { id: "n1", title: "n1", harness: "shell", model: "", dependsOn: [], prompt: "x", enabled: true },
    { id: "n2", title: "n2", harness: "shell", model: "", dependsOn: [], prompt: "x", enabled: true },
  ];
  const statuses = new Map<string, WorkGraphStatus>([
    ["n1", "succeeded"],
    ["n2", "succeeded"],
  ]);

  const notUsed = async () => ({
    ok: false as const,
    error: { code: "not_implemented", message: "not used in this test", retryable: false },
  });

  const bridge: GraphBridge = {
    graphRead: async () => {
      const graph: GraphResult["graph"] = {
        version: 1,
        intent: { nodes: intentNodes as never },
        state: {
          updatedAt: "now",
          nodes: [...statuses.entries()].map(([id, status]) => ({ id, status })),
        },
      };
      return { ok: true, result: { graph } };
    },
    graphWriteIntent: async (params) => {
      recorded.writes.push(params);
      intentNodes = (params.intent as { nodes: Record<string, unknown>[] }).nodes;
      const newNode = intentNodes[intentNodes.length - 1];
      // Not yet running until `graph.run_node_failover` actually launches
      // it — mirrors the daemon reporting `idle` for a node with no run yet.
      statuses.set(newNode.id as string, "idle");
      return {
        ok: true,
        result: {
          graph: {
            version: 1,
            intent: { nodes: intentNodes as never },
            state: { updatedAt: "now", nodes: [] },
          },
        },
      };
    },
    graphCompile: notUsed,
    graphRun: notUsed,
    graphRunNodeFailover: async (params) => {
      recorded.failovers.push(params);
      statuses.set(params.nodeId, "running");
      return {
        ok: true,
        result: {
          run: { id: `run-${params.nodeId}`, status: "running" },
          runtime: { harness: "pi", model: "qwen3.8-flash-next-nvidia-nvfp4" },
          isFallback: false,
          attemptNumber: 1,
          attempts: [{ harness: "pi", model: "qwen3.8-flash-next-nvidia-nvfp4", outcome: "launched" }],
        },
      };
    },
  };

  return {
    bridge,
    recorded,
    setStatus: (nodeId, status) => statuses.set(nodeId, status),
  };
}

describe("useAdversarialLoop (real wiring over a fake graph bridge)", () => {
  afterEach(cleanup);

  it("fails cycle 1, fixes, then passes on cycle 2 — via real graph.write_intent/compile/run calls", async () => {
    const { bridge, recorded, setStatus } = makeBridge();
    const view = renderHook(() =>
      useAdversarialLoop({ graphBridge: bridge, workspaceId: WORKSPACE_ID, pollMs: 15 }),
    );

    act(() => {
      view.result.current.startForRun({
        workflowId: "wf1",
        baseRunId: BASE_RUN_ID,
        baseNodeIds: ["n1", "n2"],
        maxCycles: 3,
      });
    });

    const review1 = reviewNodeId(TOKEN, 1);
    await waitFor(() => expect(recorded.failovers.map((r) => r.nodeId)).toContain(review1));
    expect(view.result.current.ledger?.phase).toBe("reviewing");

    // The base graph's own nodes must never be rewritten away.
    expect(recorded.writes[0].intent.nodes.map((n) => (n as { id: string }).id)).toEqual([
      "n1",
      "n2",
      review1,
    ]);

    // The reviewer "finishes" and found problems.
    setStatus(review1, "failed");
    const fix1 = fixNodeId(TOKEN, 1);
    await waitFor(() => expect(recorded.failovers.map((r) => r.nodeId)).toContain(fix1));
    expect(view.result.current.ledger?.phase).toBe("fixing");

    setStatus(fix1, "succeeded");
    const review2 = reviewNodeId(TOKEN, 2);
    await waitFor(() => expect(recorded.failovers.map((r) => r.nodeId)).toContain(review2));
    expect(view.result.current.ledger?.cycle).toBe(2);

    setStatus(review2, "succeeded");
    await waitFor(() => expect(view.result.current.ledger?.phase).toBe("passed"));
    expect(view.result.current.ledger?.message).toBe("Adversarial review passed on cycle 2.");

    // Passing never launches a third cycle.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(recorded.failovers).toHaveLength(3);
  });

  it("stops at the cap with the exact required message when it never passes", async () => {
    const { bridge, recorded, setStatus } = makeBridge();
    const view = renderHook(() =>
      useAdversarialLoop({ graphBridge: bridge, workspaceId: WORKSPACE_ID, pollMs: 15 }),
    );

    act(() => {
      view.result.current.startForRun({
        workflowId: "wf1",
        baseRunId: BASE_RUN_ID,
        baseNodeIds: ["n1", "n2"],
        maxCycles: 2,
      });
    });

    const review1 = reviewNodeId(TOKEN, 1);
    await waitFor(() => expect(recorded.failovers.map((r) => r.nodeId)).toContain(review1));
    setStatus(review1, "failed");

    const fix1 = fixNodeId(TOKEN, 1);
    await waitFor(() => expect(recorded.failovers.map((r) => r.nodeId)).toContain(fix1));
    setStatus(fix1, "succeeded");

    const review2 = reviewNodeId(TOKEN, 2);
    await waitFor(() => expect(recorded.failovers.map((r) => r.nodeId)).toContain(review2));
    setStatus(review2, "failed");

    await waitFor(() => expect(view.result.current.ledger?.phase).toBe("stopped_failing"));
    expect(view.result.current.ledger?.message).toBe(
      "Stopped after 2 review cycles, still failing.",
    );
    // No fix for cycle 2 was ever attempted — the cap stops it cold.
    expect(recorded.failovers.map((r) => r.nodeId)).not.toContain(fixNodeId(TOKEN, 2));
  });

  it("never starts a review when the base workflow itself did not fully succeed", async () => {
    const { bridge, recorded, setStatus } = makeBridge();
    setStatus("n2", "failed");
    const view = renderHook(() =>
      useAdversarialLoop({ graphBridge: bridge, workspaceId: WORKSPACE_ID, pollMs: 15 }),
    );

    act(() => {
      view.result.current.startForRun({
        workflowId: "wf1",
        baseRunId: BASE_RUN_ID,
        baseNodeIds: ["n1", "n2"],
        maxCycles: 3,
      });
    });

    await waitFor(() => expect(view.result.current.ledger?.phase).toBe("base_failed"));
    expect(recorded.writes).toHaveLength(0);
    expect(recorded.failovers).toHaveLength(0);
  });

  it("persists the ledger through setPersist on every transition", async () => {
    const { bridge, recorded, setStatus } = makeBridge();
    const persisted: unknown[] = [];
    const view = renderHook(() =>
      useAdversarialLoop({ graphBridge: bridge, workspaceId: WORKSPACE_ID, pollMs: 15 }),
    );
    act(() => {
      view.result.current.setPersist((ledger) => persisted.push(ledger));
      view.result.current.startForRun({
        workflowId: "wf1",
        baseRunId: BASE_RUN_ID,
        baseNodeIds: ["n1", "n2"],
        maxCycles: 1,
      });
    });
    const review1 = reviewNodeId(TOKEN, 1);
    // Wait until the review node has genuinely been launched (not just the
    // ledger's initial "awaiting_base" persist) before flipping its status.
    await waitFor(() => expect(recorded.failovers.map((r) => r.nodeId)).toContain(review1));
    const afterLaunch = persisted.length;
    setStatus(review1, "succeeded");
    await waitFor(() => expect(view.result.current.ledger?.phase).toBe("passed"), { timeout: 3000 });
    expect(persisted.length).toBeGreaterThan(afterLaunch);
  });
});
