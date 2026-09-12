// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Proves: the resolved policy defaults honestly when the document carries
// none; a save resends the CURRENT nodes unchanged alongside the new
// policy (never a payload that could wipe the human's own graph); a failed
// save reports the error and the panel is told it failed, never rendered
// as saved; a stale (superseded) save settling late never clobbers a
// newer one's outcome.

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  GraphBridge,
  GraphPolicy,
  GraphWritePolicyParams,
} from "../../../../shared/graph-contract";
import type { WorkGraphDocument } from "../../../../shared/work-graph-contract";
import { useSubagentPolicy } from "./use-subagent-policy";

function doc(
  nodes: Record<string, unknown>[],
  policy?: GraphPolicy,
): WorkGraphDocument {
  return {
    version: 1,
    intent: { nodes: nodes as never, ...(policy ? { policy } : {}) },
    state: { updatedAt: "now", nodes: [] },
  } as unknown as WorkGraphDocument;
}

function makeBridge(
  respond: (
    params: GraphWritePolicyParams,
  ) => { ok: true } | { ok: false; message: string },
): { bridge: GraphBridge; writes: GraphWritePolicyParams[] } {
  const writes: GraphWritePolicyParams[] = [];
  const bridge: GraphBridge = {
    graphRead: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphWriteIntent: async () => {
      throw new Error("Policy edits must not replace nodes");
    },
    graphWritePolicy: async (params) => {
      writes.push(params);
      const outcome = respond(params);
      if (!outcome.ok)
        return {
          ok: false,
          error: {
            code: "invalid_argument",
            message: outcome.message,
            retryable: false,
          },
        };
      return {
        ok: true,
        result: {
          graph: {
            version: 1,
            intent: { nodes: [], policy: params.policy },
            state: { updatedAt: "now", nodes: [] },
          },
        },
      };
    },
    graphCompile: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphRun: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
    graphRunNodeFailover: async () => ({
      ok: false,
      error: { code: "x", message: "unused", retryable: false },
    }),
  };
  return { bridge, writes };
}

const NODES = [
  {
    id: "n1",
    title: "n1",
    harness: "shell",
    model: "",
    dependsOn: [],
    prompt: "x",
    enabled: true,
  },
];

function fixturePolicy(): GraphPolicy {
  return {
    approvedRuntimes: [{ harness: "opencode", model: "claude-sonnet-4" }],
    fallbackRuntime: null,
    adversarial: { enabled: false, maxIterations: 3 },
    delegate: false,
  };
}

describe("useSubagentPolicy", () => {
  afterEach(cleanup);

  it("is NOT interactive when the document is null for an unknown reason (an unreadable/too-large file)", () => {
    const { bridge, writes } = makeBridge(() => ({ ok: true }));
    const view = renderHook(() =>
      useSubagentPolicy({
        graphBridge: bridge,
        workspaceId: "ws1",
        document: null,
      }),
    );
    expect(view.result.current.interactive).toBe(false);
    act(() => view.result.current.save(fixturePolicy()));
    // The save must be a no-op: writing `nodes: []` here would silently
    // replace real content this build simply could not read.
    expect(writes).toHaveLength(0);
  });

  it("IS interactive when the document is null because the workspace genuinely has no graph yet", async () => {
    const { bridge, writes } = makeBridge(() => ({ ok: true }));
    const view = renderHook(() =>
      useSubagentPolicy({
        graphBridge: bridge,
        workspaceId: "ws1",
        document: null,
        allowEmptyStart: true,
      }),
    );
    expect(view.result.current.interactive).toBe(true);
    act(() => view.result.current.save(fixturePolicy()));
    await waitFor(() => expect(view.result.current.saveStatus).toBe("saved"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty("intent");
  });

  it("resolves the default policy when the document carries none", () => {
    const { bridge } = makeBridge(() => ({ ok: true }));
    const view = renderHook(() =>
      useSubagentPolicy({
        graphBridge: bridge,
        workspaceId: "ws1",
        document: doc(NODES),
      }),
    );
    expect(view.result.current.policy.approvedRuntimes).toEqual([]);
    expect(view.result.current.policy.delegate).toBe(false);
  });

  it("resolves the document's real policy when present", () => {
    const { bridge } = makeBridge(() => ({ ok: true }));
    const view = renderHook(() =>
      useSubagentPolicy({
        graphBridge: bridge,
        workspaceId: "ws1",
        document: doc(NODES, fixturePolicy()),
      }),
    );
    expect(view.result.current.policy.approvedRuntimes).toHaveLength(1);
  });

  it("a save sends policy only and never resends a stale nodes snapshot", async () => {
    const { bridge, writes } = makeBridge(() => ({ ok: true }));
    const view = renderHook(() =>
      useSubagentPolicy({
        graphBridge: bridge,
        workspaceId: "ws1",
        document: doc(NODES),
      }),
    );
    act(() => view.result.current.save(fixturePolicy()));
    await waitFor(() => expect(view.result.current.saveStatus).toBe("saved"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty("nodes");
    expect(writes[0].policy.approvedRuntimes).toHaveLength(1);
  });

  it("a failed save reports the error and never claims saved", async () => {
    const { bridge } = makeBridge(() => ({
      ok: false,
      message: "workspace not found",
    }));
    const view = renderHook(() =>
      useSubagentPolicy({
        graphBridge: bridge,
        workspaceId: "ws1",
        document: doc(NODES),
      }),
    );
    act(() => view.result.current.save(fixturePolicy()));
    await waitFor(() => expect(view.result.current.saveStatus).toBe("error"));
    expect(view.result.current.saveError).toBe("workspace not found");
  });

  it("serializes rapid edits and flush waits for the final persisted policy", async () => {
    let resolveFirst: (() => void) | null = null;
    const bridge: GraphBridge = {
      graphRead: async () => ({
        ok: false,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphWriteIntent: async () => {
        throw new Error("Unexpected node write");
      },
      graphWritePolicy: (params) => {
        if (!resolveFirst) {
          return new Promise((resolve) => {
            resolveFirst = () =>
              resolve({
                ok: true,
                result: {
                  graph: {
                    version: 1,
                    intent: { nodes: [], policy: params.policy },
                    state: { updatedAt: "now", nodes: [] },
                  },
                },
              });
          });
        }
        return Promise.resolve({
          ok: true,
          result: {
            graph: {
              version: 1,
              intent: { nodes: [], policy: params.policy },
              state: { updatedAt: "now", nodes: [] },
            },
          },
        });
      },
      graphCompile: async () => ({
        ok: false,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphRun: async () => ({
        ok: false,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphRunNodeFailover: async () => ({
        ok: false,
        error: { code: "x", message: "unused", retryable: false },
      }),
    };
    const view = renderHook(() =>
      useSubagentPolicy({
        graphBridge: bridge,
        workspaceId: "ws1",
        document: doc(NODES),
      }),
    );
    act(() => view.result.current.save(fixturePolicy()));
    act(() => view.result.current.save({ ...fixturePolicy(), delegate: true }));
    await waitFor(() => expect(resolveFirst).not.toBeNull());
    expect(view.result.current.saveStatus).toBe("saving");
    expect(view.result.current.policy.delegate).toBe(true);
    act(() => resolveFirst?.());
    await act(async () => {
      expect(await view.result.current.flush()).toBe(true);
    });
    expect(view.result.current.saveStatus).toBe("saved");
  });
});
