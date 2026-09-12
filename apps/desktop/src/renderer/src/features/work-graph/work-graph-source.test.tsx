// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// The source hook's seam choice: when a graph bridge is present, reads go
// through the daemon's projecting `graph.read` (the state half advances
// with the run); without one, the raw files bridge parses the bytes. Both
// paths must surface the daemon's refusals honestly and never invent a
// document.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FileBridge, FileReadResult } from "../../../../shared/file-contract";
import type {
  GraphBridge,
  GraphResult,
} from "../../../../shared/graph-contract";
import type { Result } from "../../../../shared/session-contract";
import { useWorkGraphSource } from "./work-graph-source";

function ok<T>(result: T): Result<T> {
  return { ok: true, result };
}

const GRAPH: GraphResult = {
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
    state: {
      updatedAt: "2026-09-11T12:00:00.000Z",
      nodes: [{ id: "n1", status: "succeeded" }],
    },
  },
};

describe("work-graph-source", () => {
  afterEach(cleanup);

  it("reads through graph.read when the graph bridge is present", async () => {
    let graphReads = 0;
    let fileReads = 0;
    const graphBridge: GraphBridge = {
      graphRead: async () => {
        graphReads += 1;
        return ok(GRAPH);
      },
      graphWriteIntent: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphCompile: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphRun: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphRunNodeFailover: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
    };
    const fileBridge: FileBridge = {
      fileRead: async () => {
        fileReads += 1;
        throw new Error("the files bridge must not be used when graph.v1 reads");
      },
    } as unknown as FileBridge;
    const { result } = renderHook(() =>
      useWorkGraphSource({
        fileBridge,
        graphBridge,
        hostId: "host",
        workspaceId: "ws",
      }),
    );
    await waitFor(() => expect(result.current.source.kind).toBe("loaded"));
    expect(graphReads).toBe(1);
    expect(fileReads).toBe(0);
    if (result.current.source.kind !== "loaded") throw new Error("unreachable");
    expect(result.current.source.document.state.nodes[0]?.status).toBe("succeeded");
    expect(result.current.source.fileUpdatedAt).toBe("2026-09-11T12:00:00.000Z");
  });

  it("falls back to the files bridge when no graph bridge exists", async () => {
    const raw = JSON.stringify(GRAPH.graph);
    const fileBridge: FileBridge = {
      fileList: async () => {
        throw new Error("not used");
      },
      fileRead: async (): Promise<Result<FileReadResult>> => ({
        ok: true,
        result: {
          hostId: "host",
          workspaceId: "ws",
          path: ".drogon/graph.json",
          content: raw,
          size: raw.length,
          mtime: "2026-09-11T12:00:00.000Z",
        },
      }),
    } as unknown as FileBridge;
    const { result } = renderHook(() =>
      useWorkGraphSource({ fileBridge, hostId: "host", workspaceId: "ws" }),
    );
    await waitFor(() => expect(result.current.source.kind).toBe("loaded"));
    if (result.current.source.kind !== "loaded") throw new Error("unreachable");
    expect(result.current.source.document.intent.nodes).toHaveLength(1);
  });

  it("surfaces a graph.read refusal as read_error, never as fake success", async () => {
    const graphBridge: GraphBridge = {
      graphRead: async () => ({
        ok: false as const,
        error: {
          code: "workspace_not_found",
          message: "workspace not found",
          retryable: false,
        },
      }),
      graphWriteIntent: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphCompile: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphRun: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
      graphRunNodeFailover: async () => ({
        ok: false as const,
        error: { code: "x", message: "unused", retryable: false },
      }),
    };
    const { result } = renderHook(() =>
      useWorkGraphSource({ graphBridge, hostId: "host", workspaceId: "ws" }),
    );
    await waitFor(() => expect(result.current.source.kind).toBe("read_error"));
    if (result.current.source.kind !== "read_error") throw new Error("unreachable");
    expect(result.current.source.message).toContain("workspace not found");
  });
});
