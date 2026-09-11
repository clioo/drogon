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

describe("graph bridge admission", () => {
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
    dispatchGraphRequest("graphCompile", {
      workspaceId: "ws1",
      nodeId: "n1",
    }, async () => ({ ok: true, result: compileResult }));
    expect(resultSchemas["graph.read"]).toBeDefined();
    expect(resultSchemas["graph.write_intent"]).toBeDefined();
    expect(resultSchemas["graph.compile"]).toBeDefined();
    expect(resultSchemas["graph.run"]).toBeDefined();
    expect(
      resultSchemas["graph.write_intent"].safeParse(graphResult).success,
    ).toBe(true);
    expect(
      resultSchemas["graph.compile"].safeParse(compileResult).success,
    ).toBe(true);
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
