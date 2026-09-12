// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";
import { DEFAULT_GRAPH_POLICY } from "../../../../shared/graph-contract";
import { useOrchestratorRun } from "./use-orchestrator-run";

afterEach(cleanup);
const main = {
  id: "orchestrator-main",
  title: "Main agent",
  harness: "pi",
  model: "fixture",
  prompt: "Implement task",
  dependsOn: [],
  enabled: true,
};
const run: OrchestratorRun = {
  id: "run-1",
  workspaceId: "ws",
  main,
  policy: DEFAULT_GRAPH_POLICY,
  status: "running",
  phase: "main",
  iteration: 1,
  steps: [],
  startedAt: "now",
  updatedAt: "now",
};

it("observes a daemon run after remount and never stops it on unmount", async () => {
  const stop = vi.fn();
  const bridge = {
    graphOrchestratorStatus: vi.fn(async () => ({ ok: true, result: { run } })),
    graphOrchestratorStop: stop,
  } as unknown as GraphBridge;
  const view = renderHook(() => useOrchestratorRun(bridge, "ws"));
  await waitFor(() => expect(view.result.current.run?.id).toBe("run-1"));
  view.unmount();
  expect(stop).not.toHaveBeenCalled();
  const restored = renderHook(() => useOrchestratorRun(bridge, "ws"));
  await waitFor(() =>
    expect(restored.result.current.run?.status).toBe("running"),
  );
});

it("starts concrete main work with optional adversarial mode off", async () => {
  const start = vi.fn(async () => ({ ok: true, result: { run } }));
  const bridge = { graphOrchestratorStart: start } as unknown as GraphBridge;
  const view = renderHook(() => useOrchestratorRun(bridge, "ws"));
  await act(async () => view.result.current.start(main));
  expect(start).toHaveBeenCalledWith({ workspaceId: "ws", main });
  expect(view.result.current.run?.policy.adversarial.enabled).toBe(false);
});

it("reports lost contact without converting a running run to exited or passed", async () => {
  const bridge = {
    graphOrchestratorStart: async () => ({ ok: true, result: { run } }),
    graphOrchestratorStatus: async () => {
      throw new Error("contact lost");
    },
  } as unknown as GraphBridge;
  const view = renderHook(() => useOrchestratorRun(bridge, "ws", 10));
  await act(async () => view.result.current.start(main));
  await waitFor(() =>
    expect(view.result.current.error).toContain("contact lost"),
  );
  expect(view.result.current.run?.status).toBe("running");
});

it("ignores a stale poll started during launch that resolves after the launch", async () => {
  let finishStart: ((value: unknown) => void) | undefined;
  let finishPoll: ((value: unknown) => void) | undefined;
  const bridge = {
    graphOrchestratorStart: () =>
      new Promise((resolve) => {
        finishStart = resolve;
      }),
    graphOrchestratorStatus: () =>
      new Promise((resolve) => {
        finishPoll = resolve;
      }),
  } as unknown as GraphBridge;
  const view = renderHook(() => useOrchestratorRun(bridge, "ws", 10));
  await act(async () => {
    finishPoll?.({ ok: true, result: { run: null } });
  });
  let launching: Promise<void>;
  act(() => {
    launching = view.result.current.start(main);
  });
  finishPoll = undefined;
  await waitFor(() => expect(finishPoll).toBeDefined());
  await act(async () => {
    finishStart?.({ ok: true, result: { run } });
    await launching;
  });
  await act(async () => {
    finishPoll?.({ ok: true, result: { run: null } });
  });
  expect(view.result.current.run?.id).toBe("run-1");
});
