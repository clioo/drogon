// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import {
  resetReproDemo,
  mainNodeFor,
  policyFor,
  releaseInstructions,
  useReproDemo,
  type ReproDemoBridge,
} from "./use-repro-demo";
import { REPRO_SCENARIO_SPEC_PATH } from "./repro-demo-scenario";
import {
  REPRO_MAIN_NODE_PATH,
  cancelReproDemo,
  dispatchPrompt,
  removeDemoRuns,
} from "./repro-demo-store";

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
  /** What `graph.orchestrator_status` answers, poll after poll (the last
   *  entry repeats). `null` is "no workflow yet". */
  runStates: ({ id: string; status?: string; steps?: unknown[] } | null)[];
  /** The bot's session as the daemon lists it, poll after poll. */
  botSession?: { verdict: string; exitCode?: number | null }[];
  /** What the bot answers the prompt with. Dispatched by default. */
  receipt?: { outcome: string; session: { sessionId: string; incarnation: string } | null; error?: string };
};

function makeBridge(fakes: Fakes) {
  const writes: string[] = [];
  const calls: string[] = [];
  const prompts: unknown[] = [];
  let runIndex = 0;
  let sessionIndex = 0;
  const bridge: ReproDemoBridge = {
    status: async () => ok({ hostId: "host-1" }),
    projectCreate: async () => {
      calls.push("projectCreate");
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
    botRun: async (input) => {
      calls.push("botRun");
      prompts.push(input);
      return ok(
        fakes.receipt ?? {
          outcome: "dispatched",
          session: { sessionId: "sess-bot", incarnation: "inc-1" },
          error: null,
        },
      );
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
  if (fakes.botSession) {
    const states = fakes.botSession;
    bridge.sessionList = async () => {
      const state = states[Math.min(sessionIndex, states.length - 1)];
      sessionIndex += 1;
      return ok({ sessions: [{ id: "sess-bot", ...state }] });
    };
  }
  return { bridge, writes, calls, prompts };
}

const runtime = { harness: "opencode", model: "fixture/dog-tinder" };

// The run state lives outside React so the tour can unmount the panel; each
// case therefore starts by clearing it.
beforeEach(() => resetReproDemo());

describe("the in-app demo run", () => {
  test("sends the bot the prompt, and the bot's session admits the workflow", async () => {
    const clock = fakeClock();
    const { bridge, writes, calls, prompts } = makeBridge({
      runStates: [
        null,
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
      botSession: [{ verdict: "live" }],
    });

    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 2 });
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    const state = result.current.state;
    expect(state.failure).toBeNull();
    expect(state.releasedBy).toBe("bot");
    expect(state.dispatch).toEqual({ sessionId: "sess-bot", incarnation: "inc-1" });
    expect(state.workflowId).toBe("run-1");
    expect(state.workflowStatus).toBe("passed");
    expect(state.rounds).toHaveLength(2);
    expect(state.cost?.bucket).toBe("exact");
    expect(state.cost?.totalUsd).toBeCloseTo(3, 6);
    expect(state.evidence).toHaveLength(1);
    for (const phase of Object.values(state.phases)) {
      expect(phase.status).toBe("done");
    }

    // The whole repository — spec included — is in place before the bot
    // exists, so its session and every worker read the same files.
    expect(writes).toEqual([
      "package.json",
      "fixtures/dogs.json",
      "tests/deck.test.mjs",
      REPRO_SCENARIO_SPEC_PATH,
      REPRO_MAIN_NODE_PATH,
    ]);
    expect(calls).toEqual([
      "projectCreate",
      "botCreate",
      "graphWritePolicy",
      "botRun",
    ]);
    // The prompt goes on the runtime the viewer picked, unattended, and
    // names the exact command; the bot admitted it, so the panel never did.
    const prompt = prompts[0] as {
      botId: string;
      prompt: string;
      harness: { harnessId: string; model?: string; provider?: string; permissionMode?: string };
    };
    expect(prompt.botId).toBe("bot-1");
    expect(prompt.harness).toEqual({
      harnessId: "opencode",
      model: "fixture/dog-tinder",
      permissionMode: "unattended",
    });
    expect(prompt.prompt).toContain(
      `drogon-cli graph orchestrator-start --workspace ws-1 --file ${REPRO_MAIN_NODE_PATH}`,
    );
    expect(calls).not.toContain("graphOrchestratorStart");
  });

  test("a bot session that exits without admitting the workflow is replaced by the panel, and the panel says so", async () => {
    const clock = fakeClock();
    const { bridge, calls } = makeBridge({
      runStates: [null, null, { id: "run-panel", status: "passed", steps: [] }],
      botSession: [{ verdict: "live" }, { verdict: "exited", exitCode: 1 }],
    });

    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    const state = result.current.state;
    expect(state.failure).toBeNull();
    expect(state.releasedBy).toBe("panel");
    expect(state.releaseNote).toMatch(/exited \(code 1\) without admitting/);
    expect(state.workflowId).toBe("run-panel");
    expect(calls.filter((call) => call === "graphOrchestratorStart")).toHaveLength(1);
    expect(state.phases.workflow.note).toMatch(/admitted by this panel/);
  });

  test("a bot session still working is never raced: the panel waits the whole budget", async () => {
    const clock = fakeClock();
    const { bridge, calls } = makeBridge({
      runStates: [null],
      botSession: [{ verdict: "live" }],
    });
    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 2 });
    });
    expect(clock.now()).toBeGreaterThanOrEqual(10 * 60_000);
    expect(result.current.state.failure).toMatch(/never admitted the workflow/);
    expect(result.current.state.phases.workflow.status).toBe("failed");
    expect(calls).not.toContain("graphOrchestratorStart");
  });

  test("without the session list the panel only waits; it never guesses the bot is gone", async () => {
    const clock = fakeClock();
    const { bridge, calls } = makeBridge({ runStates: [null] });
    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 2 });
    });
    expect(result.current.state.failure).toMatch(/never admitted the workflow/);
    expect(calls).not.toContain("graphOrchestratorStart");
  });

  test("a bot that refuses the prompt is a failure with the daemon's reason, not a silent retry", async () => {
    const clock = fakeClock();
    const { bridge, calls } = makeBridge({
      runStates: [null],
      receipt: {
        outcome: "refused",
        session: null,
        error: "harness.start refused: invalid_argument: nope",
      },
    });

    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });

    await waitFor(() => expect(result.current.state.running).toBe(false));
    expect(result.current.state.phases.prompt.status).toBe("failed");
    expect(result.current.state.phases.prompt.note).toMatch(/refused/);
    expect(result.current.state.phases.prompt.note).toMatch(/nope/);
    expect(result.current.state.releasedBy).toBeNull();
    expect(result.current.state.failure).toMatch(/refused/);
    expect(calls).not.toContain("graphOrchestratorStart");
  });

  test("a failing bridge stops the run with the reason on the phase that failed", async () => {
    const clock = fakeClock();
    const { bridge } = makeBridge({ runStates: [] });
    const failing: ReproDemoBridge = {
      ...bridge,
      projectCreate: async () => ({
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

  test("stopping during the admission wait never launches fallback work", async () => {
    const clock = fakeClock();
    const { bridge, calls } = makeBridge({
      runStates: [null],
      botSession: [{ verdict: "exited", exitCode: 0 }],
    });
    bridge.graphOrchestratorStatus = async () => {
      cancelReproDemo();
      return ok({ run: null });
    };
    const { result } = renderHook(() => useReproDemo(bridge, clock));
    await act(async () => { await result.current.run({ runtime, iterations: 2 }); });
    expect(result.current.state.failure).toMatch(/Tour stopped/);
    expect(result.current.state.running).toBe(false);
    expect(calls).not.toContain("graphOrchestratorStart");
  });

  test("stopping setup holds admission until the pending call settles", async () => {
    const clock = fakeClock();
    const { bridge, calls } = makeBridge({ runStates: [] });
    let finish!: () => void;
    bridge.projectCreate = () => new Promise((resolve) => {
      finish = () => resolve(ok({ project: { id: "p1", name: "demo" }, workspaceId: "ws-1" }));
    });
    const { result } = renderHook(() => useReproDemo(bridge, clock));
    let running!: Promise<void>;
    await act(async () => { running = result.current.run({ runtime, iterations: 2 }); });
    act(() => result.current.cancel());
    expect(result.current.state.running).toBe(true);
    await act(async () => { finish(); await running; });
    expect(result.current.state.running).toBe(false);
    expect(calls).not.toContain("botCreate");
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
        runStates: [{ id: "run-1", status: "passed", steps: [] }],
      });
      return {
        ...bridge,
        projectCreate: async (input) => {
          names.push(input.name);
          return ok({
            project: { id: "p1", name: input.name },
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
    for (const entry of handles) expect(entry).toMatch(/^white-walker-[0-9a-f]{6}\|white-walker-[0-9a-f]{6}$/);
    expect(names[0]).not.toBe(names[1]);
    for (const name of names) expect(name).toMatch(/^dog-tinder-[0-9a-f]{6}$/);
  });
});

describe("the guided tour", () => {
  test("leaves Settings once the bot is ready, then preserves the session the viewer chooses", async () => {
    const clock = fakeClock();
    const tour: unknown[] = [];
    const { bridge } = makeBridge({
      runStates: [{ id: "run-1", status: "passed", steps: [] }],
    });

    const { result } = renderHook(() =>
      useReproDemo(bridge, {
        ...clock,
        tour: (request) => tour.push(request),
      }),
    );
    await act(async () => {
      await result.current.run({ runtime, iterations: 1 });
    });

    // The only automatic handoff reveals the normal shell and its Chats row.
    // Main-agent, worker, telemetry and usage navigation remains entirely
    // viewer-controlled, so the demo cannot pull them off a session mid-read.
    expect(tour).toEqual([{ kind: "open-bots", workspaceId: "ws-1" }]);
  });

  test("a failed run returns to the demo panel so its reason is visible", async () => {
    const clock = fakeClock();
    const tour: unknown[] = [];
    const { bridge } = makeBridge({ runStates: [] });
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
    expect(tour).toEqual([{ kind: "open-demo" }]);
    expect(result.current.state.failure).toMatch(/no bot/);
  });
});

describe("what the bot is told", () => {
  test("its standing instructions name the exact command and the workspace it runs in", () => {
    const instructions = releaseInstructions("ws-7");
    expect(instructions).toContain(
      "drogon-cli graph orchestrator-start --workspace ws-7 --file .drogon/repro-main-node.json",
    );
    expect(instructions).toContain("Bot dispatcher");
    expect(instructions).toContain("end this Bot turn");
    expect(instructions).not.toContain("orchestration worker-start");
    expect(instructions).not.toContain("orchestration check");
  });

  test("the prompt carries the task and repeats the one command, concretely", () => {
    const prompt = dispatchPrompt("ws-7");
    expect(prompt).toContain("Dog Tinder");
    expect(prompt).toContain(
      "drogon-cli graph orchestrator-start --workspace ws-7 --file .drogon/repro-main-node.json",
    );
    expect(prompt).not.toMatch(/<[a-z-]+>/);
    expect(prompt).toContain("Do not build the deck yourself");
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
    const node = mainNodeFor(runtime, "# Spec\nswipe", "ws-7");
    expect(node.id).toBe("orchestrator-main");
    expect(node.dependsOn).toEqual([]);
    expect(node.prompt).toMatch(/# Spec/);
    expect(node.harness).toBe("opencode");
    expect(node.prompt).toContain("main agent of the dispatched Dog Tinder graph");
    expect(node.prompt).toContain("orchestration worker-start");
    expect(node.prompt).toContain("orchestration check");
    expect(node.prompt).not.toContain("graph orchestrator-start");
  });
});

describe("tidying up after the demo", () => {
  test("removes only the demo's own bots and projects, and keeps going past a failure", async () => {
    const { bridge } = makeBridge({ runStates: [] });
    const deletedBots: string[] = [];
    const removedProjects: { id: string; deleteFiles?: boolean }[] = [];
    const housekeeping: ReproDemoBridge = {
      ...bridge,
      botSnapshot: async () =>
        ok({
          bots: [
            { id: "b1", displayIdentity: { handle: "white-walker-ab12cd" } },
            { id: "b2", displayIdentity: { handle: "dog-tinder-1a2b" } },
            { id: "b3", displayIdentity: { handle: "arya" } },
            { id: "b4", displayIdentity: { handle: null } },
            { id: "b5", displayIdentity: { handle: "white-walker-ffffff" } },
          ],
        }),
      botDelete: async (input) => {
        if (input.botId === "b5")
          return { ok: false as const, error: { code: "io_error", message: "busy", retryable: true } };
        deletedBots.push(input.botId);
        return ok({});
      },
      projectList: async () =>
        ok({
          projects: [
            { id: "p1", name: "dog-tinder-ab12cd" },
            { id: "p2", name: "dog-tinder-demo-20260913231828", quickSession: true },
            { id: "p3", name: "mentu-ai" },
            { id: "p4", name: "dog-tinder" },
          ],
        }),
      projectRemove: async (input) => {
        removedProjects.push(input);
        return ok({});
      },
    };
    const report = await removeDemoRuns(housekeeping);
    expect(deletedBots).toEqual(["b1", "b2"]);
    expect(removedProjects).toEqual([
      { id: "p1", deleteFiles: true },
      { id: "p2", deleteFiles: true },
    ]);
    expect(report).toEqual({
      bots: 2,
      projects: 2,
      errors: ["bot white-walker-ffffff: busy"],
    });
  });

  test("does nothing without the housekeeping channels", async () => {
    const { bridge } = makeBridge({ runStates: [] });
    expect(await removeDemoRuns(bridge)).toEqual({ bots: 0, projects: 0, errors: [] });
  });
});
