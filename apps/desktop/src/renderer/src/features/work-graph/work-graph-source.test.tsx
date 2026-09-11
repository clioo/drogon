// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Source-seam tests: the pane's only data path is fileRead of
// `.drogon/graph.json`. The reader must surface missing/read-error/invalid
// states honestly, poll fast while the daemon reports a live process and
// slow otherwise, and NEVER write — the bridge fake throws on fileWrite so
// any write fails the test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { FileBridge, FileReadResult } from "../../../shared/file-contract";
import type { Result } from "../../../shared/session-contract";
import type { WorkGraphDocument } from "../../../shared/work-graph-contract";
import { useWorkGraphSource } from "./work-graph-source";

function fixtureDocument(state: WorkGraphDocument["state"]["nodes"]): WorkGraphDocument {
  return {
    version: 1,
    intent: {
      nodes: [
        {
          id: "n0",
          title: "Leader",
          harness: "pi",
          model: null,
          dependsOn: [],
          prompt: "",
          enabled: true,
        },
      ],
    },
    state: { updatedAt: "2026-09-11T12:00:00.000Z", nodes: state },
  };
}

function fakeBridge(raw: string | null, options: { failWrite?: boolean } = {}): FileBridge {
  return {
    fileList: async () => {
      throw new Error("not used");
    },
    fileRead: async (): Promise<Result<FileReadResult>> => {
      if (raw === null) {
        return {
          ok: false,
          error: { code: "not_found", message: "file not found", retryable: false },
        };
      }
      return {
        ok: true,
        result: {
          hostId: "host",
          workspaceId: "ws",
          content: raw,
          size: raw.length,
          mtime: "2026-09-11T12:00:00.000Z",
        },
      };
    },
    fileWrite: async () => {
      if (options.failWrite) throw new Error("the work graph must never write");
      throw new Error("the work graph must never write");
    },
  };
}

let renderResult: { source: ReturnType<typeof useWorkGraphSource>["source"] } | null = null;

function Harness({ bridge }: { bridge: FileBridge | null }) {
  const { source } = useWorkGraphSource({
    fileBridge: bridge,
    hostId: "host",
    workspaceId: "ws",
  });
  renderResult = { source };
  return <div data-testid="harness" />;
}

describe("useWorkGraphSource", () => {
  afterEach(cleanup);

  it("loads a valid graph", async () => {
    const document = fixtureDocument([{ id: "n0", status: "running" }]);
    render(<Harness bridge={fakeBridge(JSON.stringify(document))} />);
    await waitFor(() => expect(renderResult?.source.kind).toBe("loaded"));
    if (renderResult?.source.kind !== "loaded") return;
    expect(renderResult.source.document.state.nodes[0].status).toBe("running");
  });

  it("renders a missing file as a normal empty state, not an error", async () => {
    render(<Harness bridge={fakeBridge(null)} />);
    await waitFor(() => expect(renderResult?.source.kind).toBe("missing"));
  });

  it("renders invalid JSON as an honest refusal with the parse detail", async () => {
    render(<Harness bridge={fakeBridge("{broken")} />);
    await waitFor(() => expect(renderResult?.source.kind).toBe("invalid"));
    if (renderResult?.source.kind !== "invalid") return;
    expect(renderResult.source.message).toContain("not valid JSON");
  });

  it("polls every second while a node is running and drops to ten when not", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(
        async (): Promise<Result<FileReadResult>> => ({
          ok: true,
          result: {
            hostId: "host",
            workspaceId: "ws",
            content: JSON.stringify(
              fixtureDocument([{ id: "n0", status: "running" }]),
            ),
            size: 10,
            mtime: "2026-09-11T12:00:00.000Z",
          },
        }),
      );
      const bridge: FileBridge = {
        fileList: async () => {
          throw new Error("not used");
        },
        fileRead: read,
      };
      render(
        <Harness bridge={bridge} />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      const initialCalls = read.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);

      // Running: fast cadence — roughly one read per second.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      const runningCalls = read.mock.calls.length - initialCalls;
      expect(runningCalls).toBeGreaterThanOrEqual(2);
      expect(runningCalls).toBeLessThanOrEqual(4);

      // Daemon settles the node: one more fast read flips `running` off,
      // then the cadence drops to the idle 10s.
      read.mockImplementation(
        async (): Promise<Result<FileReadResult>> => ({
          ok: true,
          result: {
            hostId: "host",
            workspaceId: "ws",
            content: JSON.stringify(fixtureDocument([{ id: "n0", status: "succeeded" }])),
            size: 10,
            mtime: "2026-09-11T12:00:00.000Z",
          },
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      const settledCalls = read.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(read.mock.calls.length - settledCalls).toBe(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(read.mock.calls.length - settledCalls).toBeGreaterThanOrEqual(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
