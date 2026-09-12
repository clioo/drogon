import { afterEach, describe, expect, it } from "vitest";
import { dispatchGraphRequest } from "./graph-bridge";
import { resultSchemas } from "../shared/result-validation";

const graphResult = {
  graph: {
    version: 1,
    intent: {
      nodes: [
        {
          id: "n1",
          title: "N one",
          harness: "shell",
          model: "",
          dependsOn: [],
          prompt: "p",
          enabled: true,
        },
      ],
    },
    state: { updatedAt: "2026-09-11T12:00:00.000Z", nodes: [] },
  },
};

const compileResult = {
  recipeId: "drogon-graph-n1",
  recipe: {},
  contentHash: "a".repeat(64),
  nodeIds: ["n1"],
  findings: [],
};

const failoverResult = {
  run: { id: "run-1", status: "running" },
  runtime: { harness: "pi", model: "qwen3.8-flash-next-nvidia-nvfp4" },
  isFallback: false,
  attemptNumber: 1,
  attempts: [
    {
      harness: "pi",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      outcome: "launched",
    },
  ],
};

describe("graph bridge admission", () => {
  it("routes native observability reads without Mentu", async () => {
    const result = await dispatchGraphRequest(
      "graphObservabilityStatus",
      { workspaceId: "ws1" },
      async (method) => {
        expect(method).toBe("graph.observability_status");
        return {
          ok: true,
          result: {
            observability: { evidence: [], usage: [], updatedAt: "" },
          },
        };
      },
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an empty usage measurement before IPC", async () => {
    let called = false;
    const result = await dispatchGraphRequest(
      "graphUsageAppend",
      { workspaceId: "ws1", agentId: "leader" },
      async () => {
        called = true;
        throw new Error("Must not call daemon");
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("routes policy-only autosave without a nodes replacement", async () => {
    const input = {
      workspaceId: "ws1",
      policy: {
        approvedRuntimes: [],
        fallbackRuntime: null,
        adversarial: { enabled: false, maxIterations: 3 },
        delegate: false,
      },
    };
    const calls: unknown[] = [];
    const result = await dispatchGraphRequest(
      "graphWritePolicy",
      input,
      async (method, params) => {
        calls.push({ method, params });
        return { ok: true, result: graphResult };
      },
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ method: "graph.write_policy", params: input }]);
  });

  it("refuses daemon state in policy autosave", async () => {
    const result = await dispatchGraphRequest(
      "graphWritePolicy",
      { workspaceId: "ws1", state: {} },
      async () => {
        throw new Error("Must not call daemon");
      },
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a missing durable run when polling a new workspace", async () => {
    const result = await dispatchGraphRequest(
      "graphOrchestratorStatus",
      { workspaceId: "ws1" },
      async (method) => {
        expect(method).toBe("graph.orchestrator_status");
        return { ok: true, result: { run: null } };
      },
    );
    expect(result).toEqual({ ok: true, result: { run: null } });
  });

  it.each(["stopped", "dispatching"])(
    "accepts daemon step status %s during stop and resume",
    async (status) => {
      const run = {
        id: "run-1",
        workspaceId: "ws1",
        main: graphResult.graph.intent.nodes[0],
        policy: {
          approvedRuntimes: [],
          fallbackRuntime: null,
          adversarial: { enabled: true, maxIterations: 3 },
          delegate: false,
        },
        status: status === "stopped" ? "stopped" : "running",
        phase: "main",
        iteration: 1,
        steps: [
          {
            nodeId: "main-1",
            phase: "main",
            iteration: 1,
            status,
            isFallback: false,
            attempts: [],
          },
        ],
        startedAt: "now",
        updatedAt: "now",
      };
      const result = await dispatchGraphRequest(
        status === "stopped"
          ? "graphOrchestratorStop"
          : "graphOrchestratorResume",
        { workspaceId: "ws1", runId: "run-1" },
        async () => ({ ok: true, result: { run } }),
      );
      expect(result.ok).toBe(true);
    },
  );
  it("refuses a payload that carries the daemon-owned state half before any IPC", async () => {
    let called = false;
    const result = await dispatchGraphRequest(
      "graphWriteIntent",
      {
        workspaceId: "ws1",
        intent: { nodes: [] },
        state: { nodes: [] },
      },
      async () => {
        called = true;
        return { ok: true, result: graphResult };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("refuses an intent object that carries state inside it", async () => {
    let called = false;
    const result = await dispatchGraphRequest(
      "graphWriteIntent",
      {
        workspaceId: "ws1",
        intent: { nodes: [], state: { nodes: [] } },
      },
      async () => {
        called = true;
        return { ok: true, result: graphResult };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("refuses graph.compile params with both nodeId and nodeIds", async () => {
    let called = false;
    const result = await dispatchGraphRequest(
      "graphCompile",
      { workspaceId: "ws1", nodeId: "n1", nodeIds: ["n1"] },
      async () => {
        called = true;
        return { ok: true, result: compileResult };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("registers every graph method in native-client's shared result-schema map", () => {
    // native-client.ts validates EVERY daemon response through the shared
    // map; an unregistered method fails the call with a false "does not
    // match the expected contract" no matter what the daemon answered.
    // (This exact gap shipped once: the save wrote nothing and the canvas
    // reported the daemon's honest answer as a contract mismatch.)
    dispatchGraphRequest(
      "graphCompile",
      {
        workspaceId: "ws1",
        nodeId: "n1",
      },
      async () => ({ ok: true, result: compileResult }),
    );
    expect(resultSchemas["graph.read"]).toBeDefined();
    expect(resultSchemas["graph.write_intent"]).toBeDefined();
    expect(resultSchemas["graph.compile"]).toBeDefined();
    expect(resultSchemas["graph.run"]).toBeDefined();
    expect(resultSchemas["graph.run_node_failover"]).toBeDefined();
    expect(
      resultSchemas["graph.write_intent"].safeParse(graphResult).success,
    ).toBe(true);
    expect(
      resultSchemas["graph.compile"].safeParse(compileResult).success,
    ).toBe(true);
    expect(
      resultSchemas["graph.run_node_failover"].safeParse(failoverResult)
        .success,
    ).toBe(true);
  });

  it("forwards a valid graph.run_node_failover request and validates the response", async () => {
    let seen: { method: string; params: unknown } | null = null;
    const result = await dispatchGraphRequest(
      "graphRunNodeFailover",
      { workspaceId: "ws1", nodeId: "n1" },
      async (method, params) => {
        seen = { method, params };
        return { ok: true as const, result: failoverResult };
      },
    );
    expect(result.ok).toBe(true);
    expect(seen).toEqual({
      method: "graph.run_node_failover",
      params: { workspaceId: "ws1", nodeId: "n1" },
    });
    if (result.ok) expect(result.result).toEqual(failoverResult);
  });

  it("refuses a graph.run_node_failover request missing nodeId", async () => {
    let called = false;
    const result = await dispatchGraphRequest(
      "graphRunNodeFailover",
      { workspaceId: "ws1" },
      async () => {
        called = true;
        return { ok: true, result: failoverResult };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("refuses a daemon response that does not match the graph contract", async () => {
    const result = await dispatchGraphRequest(
      "graphRun",
      { workspaceId: "ws1", nodeIds: ["n1"] },
      async () => ({ ok: true, result: { unexpected: true } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal_error");
  });

  it("forwards a valid write to the daemon's graph.write_intent", async () => {
    let seen: { method: string; params: unknown } | null = null;
    const result = await dispatchGraphRequest(
      "graphWriteIntent",
      { workspaceId: "ws1", intent: { nodes: [] } },
      async (method, params) => {
        seen = { method, params };
        return { ok: true as const, result: graphResult };
      },
    );
    expect(result.ok).toBe(true);
    expect(seen).toEqual({
      method: "graph.write_intent",
      params: { workspaceId: "ws1", intent: { nodes: [] } },
    });
  });
});

export {};
