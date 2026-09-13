// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import {
  resetReproDemo,
  mainNodeFor,
  policyFor,
  releaseInstructions,
  useReproDemo,
  type MonitorView,
  type ReproDemoBridge,
} from "./use-repro-demo";
import { DEFAULT_REPRO_RUNTIME } from "./repro-demo-plan";
import { REPRO_SCENARIO_SPEC_PATH } from "./repro-demo-scenario";

const ok = <T,>(result: T) => ({ ok: true as const, result });

/** A clock the bounded waits can actually exhaust, and a sleep that never
 *  costs real time: the test exercises the same code the demo runs, including
 *  its timeouts. */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

type Fakes = {
  monitorViews: MonitorView[];
  runStates: ({ id: string; status?: string; steps?: unknown[] } | null)[];
};

function makeBridge(fakes: Fakes) {
  const writes: string[] = [];
  const calls: string[] = [];
  let monitorIndex = 0;
  let runIndex = 0;
  const bridge: ReproDemoBridge = {
    status: async () => ok({ hostId: "host-1" }),
    quickSessionCreate: async () => {
      calls.push("quickSessionCreate");
      return ok({ project: { id: "p1", name: "dog-tinder-demo" }, workspaceId: "ws-1" });
    },
    fileWrite: async (input) => {
      writes.push(input.path);
      return ok({});
    },
    botCreate: async () => {
      calls.push("botCreate");
      return ok({ id: "bot-1" });
    },
    botMonitorCreate: async (input) => {
      calls.push(`botMonitorCreate:${input.resource}:${input.cron}`);
      return ok({ monitorId: "mon-1", ruleKind: "local_file_digest.v1" });
    },
    botMonitorApprove: async () => {
      calls.push("botMonitorApprove");
      return ok({ approved: true });
    },
    botMonitorList: async () => {
      const view =
        fakes.monitorViews[Math.min(monitorIndex, fakes.monitorViews.length - 1)];
      monitorIndex += 1;
      return ok({ monitors: [view] });
    },
    graphWritePolicy: async () => {
      calls.push("graphWritePolicy");
      return ok({});
    },
    graphOrchestratorStart: async () => {
      calls.push("graphOrchestratorStart");
      return ok({ run: { id: "run-panel" } });
    },
    graphOrchestratorStatus: async () => {
      const run = fakes.runStates[Math.min(runIndex, fakes.runStates.length - 1)];
      runIndex += 1;
      return ok({ run: run as never });
    },
    graphObservabilityStatus: async () =>
      ok({
        observability: {
          evidence: [
            {
              id: "ev-1",
              status: "finding",
              summary: "Adversarial test: undo is missing.",
              role: "test",
              timestamp: "2026-09-13T00:00:00Z",
            },
          ],
          usage: [
            {
              role: "main",
              harness: "opencode",
              model: "fixture/dog-tinder",
              inputTokens: 1_000_000,
              outputTokens: 0,
            },
          ],
        },
      }),
  };
  return { bridge, writes, calls };
}

const runtime = { ...DEFAULT_REPRO_RUNTIME, harness: "opencode", model: "fixture/dog-tinder" };

// The run state lives outside React so the tour can unmount the panel; each
// case therefore starts by clearing it.
beforeEach(() => resetReproDemo());

describe("the in-app demo run", () => {
  test("arms the watch before the spec exists, then lets the firing release the work", async () => {
    const clock = fakeClock();
    const { bridge, writes, calls } = makeBridge({
      monitorViews: [
        { monitorId: "mon-1", lastCheckOutcome: "error", lastError: "NotFound" },
        {
          monitorId: "mon-1",
          lastCheckOutcome: "changed",
          lastEventId: "mev_1",
          firing: { lastEventId: "mev_1", lastOutcome: "dispatched" },
        },
      ],
      runStates: [
        { id: "run-1", status: "running", steps: [] },
        {
          id: "run-1",
          status: "passed",
          steps: [
            { iteration: 1, phase: "test", status: "succeeded", verdict: "findings" },
            { iteration: 2, phase: "test", status: "succeeded", verdict: "pass" },
          ],
        },
      ],
    });

    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 2 });
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    const state = result.current.state;
    expect(state.failure).toBeNull();
    expect(state.releasedBy).toBe("monitor");
    expect(state.firingEventId).toBe("mev_1");
    expect(state.workflowStatus).toBe("passed");
    expect(state.rounds).toHaveLength(2);
    expect(state.cost?.bucket).toBe("exact");
    expect(state.cost?.totalUsd).toBeCloseTo(3, 6);
    expect(state.evidence).toHaveLength(1);
    for (const phase of Object.values(state.phases)) {
      expect(phase.status).toBe("done");
    }

    // The seed and the node land first; the spec — the change the watch is
    // waiting for — is written only after the monitor has checked once.
    expect(writes).toEqual([
      "package.json",
      "fixtures/dogs.json",
      "tests/deck.test.mjs",
      ".drogon/repro-main-node.json",
      REPRO_SCENARIO_SPEC_PATH,
    ]);
    expect(calls).toContain("botMonitorCreate:specs/dog-tinder.md:* * * * *");
    expect(calls).toContain("botMonitorApprove");
    // The monitor released it, so the panel never started the workflow itself.
    expect(calls).not.toContain("graphOrchestratorStart");
  });

  test("a watch that never releases the work is reported, and the panel starts it", async () => {
    const clock = fakeClock();
    const { bridge, calls } = makeBridge({
      monitorViews: [
        { monitorId: "mon-1", lastCheckOutcome: "no_change" },
      ],
      runStates: [
        { id: "run-panel", status: "exhausted", steps: [{ iteration: 1, phase: "test", verdict: "findings", status: "succeeded" }] },
      ],
    });

    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    const state = result.current.state;
    expect(state.releasedBy).toBe("panel");
    expect(state.phases.firing.status).toBe("failed");
    expect(state.phases.firing.note).toMatch(/never fired/);
    expect(calls).toContain("graphOrchestratorStart");
    expect(state.workflowStatus).toBe("exhausted");
    expect(state.failure).toBeNull();
  });

  test("a refused dispatch is a failure with the daemon's reason, not a silent retry", async () => {
    const clock = fakeClock();
    const { bridge } = makeBridge({
      monitorViews: [
        {
          monitorId: "mon-1",
          lastCheckOutcome: "changed",
          lastEventId: "mev_2",
          firing: {
            lastEventId: "mev_2",
            lastOutcome: "dispatch_failed",
            lastDetail: "harness.start refused: invalid_argument: nope",
          },
        },
      ],
      runStates: [{ id: "run-panel", status: "passed", steps: [] }],
    });

    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(result.current.state.phases.firing.note).toMatch(/dispatch_failed/);
    expect(result.current.state.phases.firing.note).toMatch(/nope/);
    expect(result.current.state.releasedBy).toBe("panel");
  });

  test("a failing bridge stops the run with the reason on the phase that failed", async () => {
    const clock = fakeClock();
    const { bridge } = makeBridge({ monitorViews: [], runStates: [] });
    const failing: ReproDemoBridge = {
      ...bridge,
      quickSessionCreate: async () => ({
        ok: false as const,
        error: { code: "io_error", message: "disk is full", retryable: false },
      }),
    };

    const { result } = renderHook(() => useReproDemo(failing, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(result.current.state.failure).toMatch(/disk is full/);
    expect(result.current.state.phases.workspace.status).toBe("failed");
  });

  test("nothing runs without a bridge", async () => {
    const clock = fakeClock();
    const { result } = renderHook(() => useReproDemo(null, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });
    expect(result.current.state.running).toBe(false);
    expect(result.current.state.workspaceId).toBeNull();
  });
});

describe("running it again", () => {
  test("every run takes its own identity, so a second run never collides", async () => {
    const clock = fakeClock();
    const handles: string[] = [];
    const names: string[] = [];
    const capture = (): ReproDemoBridge => {
      const { bridge } = makeBridge({
        monitorViews: [
          {
            monitorId: "mon-1",
            lastCheckOutcome: "changed",
            lastEventId: "mev_1",
            firing: { lastEventId: "mev_1", lastOutcome: "dispatched" },
          },
        ],
        runStates: [{ id: "run-1", status: "passed", steps: [] }],
      });
      return {
        ...bridge,
        quickSessionCreate: async (input) => {
          names.push(input.name ?? "");
          return ok({
            project: { id: "p1", name: input.name ?? "" },
            workspaceId: "ws-1",
          });
        },
        botCreate: async (input) => {
          const body = (input as { botId: string; body: { displayIdentity: { handle: string } } });
          handles.push(`${body.botId}|${body.body.displayIdentity.handle}`);
          return ok({ id: body.botId });
        },
      };
    };

    for (const _ of [0, 1]) {
      resetReproDemo();
      const { result } = renderHook(() => useReproDemo(capture(), { ...clock, tour: () => {} }));
      await act(async () => {
        await result.current.run({ runtime, iterations: 1 });
      });
      await waitFor(() => expect(result.current.state.running).toBe(false));
    }

    expect(handles).toHaveLength(2);
    // The bot handle is an identity the daemon refuses to reuse: a fixed one
    // made the second run fail with "handle is already owned".
    expect(handles[0]).not.toBe(handles[1]);
    for (const entry of handles) expect(entry).toMatch(/^dog-tinder-[0-9a-f]{6}\|dog-tinder-[0-9a-f]{6}$/);
    expect(names[0]).not.toBe(names[1]);
    for (const name of names) expect(name).toMatch(/^dog-tinder-[0-9a-f]{6}$/);
  });
});

describe("the guided tour", () => {
  test("opens the Work Graph when the rounds start, then follows the views", async () => {
    const clock = fakeClock();
    const tour: unknown[] = [];
    const { bridge } = makeBridge({
      monitorViews: [
        {
          monitorId: "mon-1",
          lastCheckOutcome: "changed",
          lastEventId: "mev_1",
          firing: { lastEventId: "mev_1", lastOutcome: "dispatched" },
        },
      ],
      runStates: [{ id: "run-1", status: "passed", steps: [] }],
    });

    const { result } = renderHook(() =>
      useReproDemo(bridge, { ...clock, tour: (request) => tour.push(request) }),
    );
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });

    // The viewer is shown what was configured (the Bots page) as soon as the
    // bot and its watch exist, then the real canvas once the rounds begin, and
    // the ledgers' own tabs at the end.
    expect(tour).toEqual([
      { kind: "open-bots", workspaceId: "ws-1" },
      { kind: "open-work-graph", workspaceId: "ws-1" },
      { kind: "focus-view", view: "graph" },
      { kind: "focus-view", view: "evidence" },
      { kind: "focus-view", view: "usage" },
    ]);
  });

  test("a run that fails before the rounds never navigates away", async () => {
    const clock = fakeClock();
    const tour: unknown[] = [];
    const { bridge } = makeBridge({ monitorViews: [], runStates: [] });
    const failing: ReproDemoBridge = {
      ...bridge,
      botCreate: async () => ({
        ok: false as const,
        error: { code: "invalid_argument", message: "no bot", retryable: false },
      }),
    };

    const { result } = renderHook(() =>
      useReproDemo(failing, { ...clock, tour: (request) => tour.push(request) }),
    );
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });
    expect(tour).toEqual([]);
    expect(result.current.state.failure).toMatch(/no bot/);
  });
});

describe("what the released session is told", () => {
  test("names the exact command and the workspace it runs in", () => {
    const instructions = releaseInstructions("ws-7");
    expect(instructions).toContain(
      "drogon-cli graph orchestrator-start --workspace ws-7 --file .drogon/repro-main-node.json",
    );
    expect(instructions).toMatch(/Do not implement the deck yourself/);
  });

  test("the policy turns the bounded adversarial loop on, and never delegate too", () => {
    const policy = policyFor(runtime, 3);
    expect(policy.adversarial).toEqual({ enabled: true, maxIterations: 3 });
    expect(policy.delegate).toBe(false);
    expect(policy.approvedRuntimes).toEqual([
      { harness: "opencode", model: "fixture/dog-tinder" },
    ]);
  });

  test("the main node carries the spec as its task", () => {
    const node = mainNodeFor(runtime, "# Spec\nswipe");
    expect(node.id).toBe("orchestrator-main");
    expect(node.dependsOn).toEqual([]);
    expect(node.prompt).toMatch(/# Spec/);
    expect(node.harness).toBe("opencode");
  });
});
