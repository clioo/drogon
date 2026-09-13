// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  GraphBridge,
  OrchestratorRun,
} from "../../../../shared/graph-contract";
import { DEFAULT_GRAPH_POLICY } from "../../../../shared/graph-contract";
import { useOrchestratorRun } from "./use-orchestrator-run";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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

it("refreshes observers through the same gated bridge after launch", async () => {
  let current: OrchestratorRun | null = null;
  const start = vi.fn(async () => {
    current = run;
    return { ok: true, result: { run } };
  });
  const bridge = {
    graphOrchestratorStart: start,
    graphOrchestratorStatus: vi.fn(async () => ({
      ok: true,
      result: { run: current },
    })),
  } as unknown as GraphBridge;
  const launcher = renderHook(() => useOrchestratorRun(bridge, "ws"));
  const observer = renderHook(() => useOrchestratorRun(bridge, "ws"));
  await act(async () => {});
  expect(observer.result.current.run).toBeNull();
  await act(async () => launcher.result.current.start(main));
  await waitFor(() => expect(observer.result.current.run?.id).toBe("run-1"));
});

it("does not publish run evidence across separate bridge capability scopes", async () => {
  const start = vi.fn(async () => ({ ok: true, result: { run } }));
  const launcher = renderHook(() =>
    useOrchestratorRun(
      { graphOrchestratorStart: start } as unknown as GraphBridge,
      "ws",
    ),
  );
  const observer = renderHook(() =>
    useOrchestratorRun({} as GraphBridge, "ws"),
  );
  await act(async () => {});
  await act(async () => launcher.result.current.start(main));
  expect(observer.result.current.run).toBeNull();
});

it("publishes stop and resume results within one gated bridge scope", async () => {
  const stopped: OrchestratorRun = { ...run, status: "stopped" };
  const resumed: OrchestratorRun = { ...run, id: "run-2" };
  let current = run;
  const bridge = {
    graphOrchestratorStatus: vi.fn(async () => ({
      ok: true,
      result: { run: current },
    })),
    graphOrchestratorStop: vi.fn(async () => {
      current = stopped;
      return { ok: true, result: { run: current } };
    }),
    graphOrchestratorResume: vi.fn(async () => {
      current = resumed;
      return { ok: true, result: { run: current } };
    }),
  } as unknown as GraphBridge;
  const controller = renderHook(() => useOrchestratorRun(bridge, "ws"));
  const observer = renderHook(() => useOrchestratorRun(bridge, "ws"));
  await waitFor(() => expect(controller.result.current.run?.id).toBe("run-1"));
  await act(async () => controller.result.current.stop());
  await waitFor(() =>
    expect(observer.result.current.run?.status).toBe("stopped"),
  );
  await act(async () => controller.result.current.resume());
  await waitFor(() => expect(observer.result.current.run?.id).toBe("run-2"));
});

it("refreshes instead of regressing peers to a delayed mutation snapshot", async () => {
  const older: OrchestratorRun = {
    ...run,
    updatedAt: "2026-09-13T00:00:01Z",
  };
  const newer: OrchestratorRun = {
    ...run,
    phase: "review",
    updatedAt: "2026-09-13T00:00:02Z",
  };
  let current = older;
  let finishStart: ((value: unknown) => void) | undefined;
  const bridge = {
    graphOrchestratorStatus: vi.fn(async () => ({
      ok: true,
      result: { run: current },
    })),
    graphOrchestratorStart: vi.fn(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        }),
    ),
  } as unknown as GraphBridge;
  const controller = renderHook(() => useOrchestratorRun(bridge, "ws", 10));
  const observer = renderHook(() => useOrchestratorRun(bridge, "ws", 10));
  await waitFor(() => expect(observer.result.current.run?.phase).toBe("main"));
  let launch: Promise<void>;
  act(() => {
    launch = controller.result.current.start(main);
  });
  current = newer;
  await waitFor(() =>
    expect(observer.result.current.run?.phase).toBe("review"),
  );
  await act(async () => {
    finishStart?.({ ok: true, result: { run: older } });
    await launch;
  });
  await waitFor(() =>
    expect(observer.result.current.run?.phase).toBe("review"),
  );
});

it("does not regress the controller to a stale non-null mutation reply", async () => {
  const older: OrchestratorRun = {
    ...run,
    phase: "main",
    updatedAt: "2026-09-13T00:00:01Z",
  };
  const newer: OrchestratorRun = {
    ...run,
    phase: "review",
    updatedAt: "2026-09-13T00:00:02Z",
  };
  const bridge = {
    graphOrchestratorStatus: vi.fn(async () => ({
      ok: true,
      result: { run: newer },
    })),
    graphOrchestratorStop: vi.fn(async () => ({
      ok: true,
      result: { run: older },
    })),
  } as unknown as GraphBridge;
  const view = renderHook(() => useOrchestratorRun(bridge, "ws", 10));
  await waitFor(() => expect(view.result.current.run?.phase).toBe("review"));

  await act(async () => view.result.current.stop());

  expect(view.result.current.run?.phase).toBe("review");
  expect(view.result.current.run?.updatedAt).toBe(newer.updatedAt);
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

it("polls promptly while a run is still dispatching", async () => {
  vi.useFakeTimers();
  const dispatching: OrchestratorRun = {
    ...run,
    steps: [
      {
        nodeId: main.id,
        phase: "main",
        iteration: 1,
        status: "dispatching",
        isFallback: false,
        attempts: [],
      },
    ],
  };
  const status = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, result: { run: dispatching } })
    .mockResolvedValue({ ok: true, result: { run } });
  const bridge = { graphOrchestratorStatus: status } as unknown as GraphBridge;
  renderHook(() => useOrchestratorRun(bridge, "ws", 3000, 10_000));
  await act(async () => {});
  expect(status).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(99);
  });
  expect(status).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(status).toHaveBeenCalledTimes(2);
});

it("keeps active polling after a transient empty observation", async () => {
  vi.useFakeTimers();
  const status = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, result: { run } })
    .mockResolvedValueOnce({ ok: true, result: { run: null } })
    .mockResolvedValue({ ok: true, result: { run } });
  const bridge = { graphOrchestratorStatus: status } as unknown as GraphBridge;
  const view = renderHook(() => useOrchestratorRun(bridge, "ws", 3000, 10_000));
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(status).toHaveBeenCalledTimes(2);
  expect(view.result.current.run?.status).toBe("running");
  expect(view.result.current.error).toContain("status is unavailable");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2999);
  });
  expect(status).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(status).toHaveBeenCalledTimes(3);
  expect(view.result.current.error).toBeNull();
});

it("backs off a terminal run even when its last step was dispatching", async () => {
  vi.useFakeTimers();
  const unverifiable: OrchestratorRun = {
    ...run,
    status: "unverifiable",
    steps: [
      {
        nodeId: main.id,
        phase: "main",
        iteration: 1,
        status: "dispatching",
        isFallback: false,
        attempts: [],
      },
    ],
  };
  const status = vi.fn(async () => ({
    ok: true,
    result: { run: unverifiable },
  }));
  const bridge = { graphOrchestratorStatus: status } as unknown as GraphBridge;
  renderHook(() => useOrchestratorRun(bridge, "ws", 3000, 10_000));
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9999);
  });
  expect(status).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(status).toHaveBeenCalledTimes(2);
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
