// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ReproDemoSection } from "./ReproDemoSection";
import { resetReproDemo, type ReproDemoBridge } from "./use-repro-demo";

afterEach(() => {
  cleanup();
  // The suite shares one jsdom window across files: a catalog left here
  // becomes another file's bridge.
  delete (window as { drogon?: unknown }).drogon;
});
// The demo's run state outlives this component on purpose (the tour unmounts
// the panel mid-run), so each case starts from a cleared store — and from a
// window with no harness catalog until a case installs one.
beforeEach(() => {
  resetReproDemo();
  delete (window as { drogon?: unknown }).drogon;
});
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const ok = <T,>(result: T) => ({ ok: true as const, result });

/** The product's own catalogs, as the daemon would answer them: which
 *  harnesses are installed here, and what each one lists. */
function stubCatalogs(input: {
  harnesses: { harnessId: string; displayName: string }[];
  models: Record<string, string[]>;
}): void {
  window.drogon = {
    harnesses: async () =>
      ok({
        hostId: "host-1",
        harnesses: input.harnesses.map((harness) => ({
          ...harness,
          availability: "available",
          executable: `/fixture/${harness.harnessId}`,
        })),
      }),
    harnessModels: async ({ harnessId: harness }: { harnessId: string }) =>
      ok({
        hostId: "host-1",
        catalog: {
          harness,
          availability: "available",
          executable: `/fixture/${harness}`,
          provenance: {
            executable: `/fixture/${harness}`,
            argv: [harness, "--list-models"],
            version: "1.0.0",
            probedAtEpochMs: Date.now(),
            configScope: "user",
          },
          entries: (input.models[harness] ?? []).map((id) => ({
            provider: null,
            id,
            context: null,
            maxOutput: null,
            thinking: null,
            images: null,
          })),
          status: "enumerated" as const,
          note: null,
          retainedRoots: [],
        },
      }),
  } as unknown as typeof window.drogon;
}

function bridgeThatRuns(seen: { bots: unknown[] } = { bots: [] }): ReproDemoBridge {
  return {
    status: async () => ok({ hostId: "host-1" }),
    projectCreate: async (input) =>
      ok({ project: { id: "p1", name: input.name }, workspaceId: "ws-1" }),
    fileWrite: async () => ok({}),
    botCreate: async (input) => {
      seen.bots.push(input);
      return ok({ id: "bot-1" });
    },
    botRun: async () =>
      ok({
        outcome: "dispatched",
        session: { sessionId: "sess-bot-9", incarnation: "inc-9" },
        error: null,
      }),
    sessionList: async () => ok({ sessions: [{ id: "sess-bot-9", verdict: "live" }] }),
    graphWritePolicy: async () => ok({}),
    graphOrchestratorStart: async () => ok({ run: { id: "run-panel" } }),
    graphOrchestratorStatus: async () =>
      ok({
        run: {
          id: "run-1",
          status: "passed",
          steps: [
            {
              iteration: 1,
              phase: "main",
              status: "succeeded",
              verdict: "pass",
              runtime: { harness: "pi", model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4" },
              isFallback: false,
            },
          ],
        },
      }),
    graphObservabilityStatus: async () =>
      ok({
        observability: {
          evidence: [
            {
              id: "ev-1",
              status: "completed",
              summary: "Code review: undo implemented and verified.",
              role: "review",
              timestamp: "2026-09-13T00:00:00Z",
            },
          ],
          usage: [
            {
              role: "review",
              harness: "pi",
              model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
              inputTokens: 1000,
              outputTokens: 100,
            },
          ],
        },
      }),
  };
}

describe("Settings → Reproducible demo", () => {
  test("proposes the product's default harness and the model it lists, then runs on them", async () => {
    stubCatalogs({
      harnesses: [
        { harnessId: "claude", displayName: "Claude Code" },
        { harnessId: "opencode", displayName: "OpenCode" },
      ],
      models: { opencode: ["fixture/dog-tinder", "fixture/other"], claude: [] },
    });
    const seen = { bots: [] as unknown[] };
    render(<ReproDemoSection bridge={bridgeThatRuns(seen)} defaultHarnessId="opencode" />);
    // Nothing is proposed before the catalogs answer; then the harness's own
    // first listed model is, without anyone typing an id.
    await waitFor(() =>
      expect(screen.getByTestId("repro-demo-model-value").textContent).toBe(
        "fixture/dog-tinder",
      ),
    );
    expect(screen.getByText(/Proposed from what OpenCode lists/)).toBeTruthy();
    expect(
      screen.getByTestId("repro-demo-phase-workspace").getAttribute("data-status"),
    ).toBe("idle");
    // The subagents mirror the main agent, so nothing else needs choosing.
    await waitFor(() =>
      expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByTestId("repro-demo-subagents-model-value").textContent).toBe(
      "fixture/dog-tinder",
    );

    fireEvent.click(screen.getByTestId("repro-demo-run"));
    await waitFor(() => expect(seen.bots).toHaveLength(1));
    const bot = seen.bots[0] as {
      body: {
        harnessPolicy: { defaultHarness: string; explicitModel: string | null };
        displayIdentity: { displayName: string; handle: string };
      };
    };
    expect(bot.body.harnessPolicy).toEqual({
      defaultHarness: "opencode",
      explicitModel: "fixture/dog-tinder",
    });
    // The bot that delegates is named for what it is, with the run's tag.
    expect(bot.body.displayIdentity.displayName).toMatch(/^White walker [0-9a-f]{6}$/);
    expect(bot.body.displayIdentity.handle).toMatch(/^white-walker-[0-9a-f]{6}$/);
  });

  test("a harness that needs an exact model id blocks the run until one is picked", async () => {
    stubCatalogs({
      harnesses: [{ harnessId: "pi", displayName: "Pi" }],
      models: { pi: [] },
    });
    render(<ReproDemoSection bridge={bridgeThatRuns()} defaultHarnessId="pi" />);
    await waitFor(() =>
      expect(screen.getByTestId("repro-demo-blocked").textContent).toMatch(
        /Pi needs an exact model id/,
      ),
    );
    expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("repro-demo-model-value").textContent).toBe("harness default");
  });

  test("falls back to the first installed harness when the product's default is not here", async () => {
    stubCatalogs({
      harnesses: [{ harnessId: "codex", displayName: "Codex CLI" }],
      models: { codex: ["gpt-5.3-codex"] },
    });
    const seen = { bots: [] as unknown[] };
    render(<ReproDemoSection bridge={bridgeThatRuns(seen)} defaultHarnessId="pi" />);
    await waitFor(() =>
      expect(screen.getByTestId("repro-demo-model-value").textContent).toBe("gpt-5.3-codex"),
    );
    fireEvent.click(screen.getByTestId("repro-demo-run"));
    await waitFor(() => expect(seen.bots).toHaveLength(1));
    expect(
      (seen.bots[0] as { body: { harnessPolicy: { defaultHarness: string } } }).body
        .harnessPolicy.defaultHarness,
    ).toBe("codex");
  });

  test("a run walks the phases, shows the bot's session, the rounds and the cost", async () => {
    stubCatalogs({
      harnesses: [{ harnessId: "opencode", displayName: "OpenCode" }],
      models: { opencode: ["fixture/dog-tinder"] },
    });
    render(<ReproDemoSection bridge={bridgeThatRuns()} defaultHarnessId="opencode" />);
    await waitFor(() =>
      expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("repro-demo-run"));

    await waitFor(
      () =>
        expect(
          screen.getByTestId("repro-demo-phase-evidence").getAttribute("data-status"),
        ).toBe("done"),
      { timeout: 15_000 },
    );
    expect(screen.getByTestId("repro-demo-dispatch").textContent).toMatch(/sess-bot-9/);
    expect(screen.getByTestId("repro-demo-rounds").textContent).toMatch(/pass/);
    // The free local model is priced as declared-free, not as a bill.
    expect(screen.getByTestId("repro-demo-cost").textContent).toMatch(
      /no rate in the card|measurement/,
    );
    expect(screen.getByTestId("repro-demo-release").textContent).toMatch(
      /the bot's own session/,
    );
    expect(screen.getByTestId("repro-demo-evidence").textContent).toMatch(/Agent telemetry/);
    // The last widget that changed is the one holding the focus ring.
    expect(
      screen.getByTestId("repro-demo-evidence").getAttribute("data-spotlight"),
    ).toBe("on");
    // Both surfaces of the run stay one click away from the panel.
    expect(screen.getByTestId("repro-demo-show-orchestration").textContent).toMatch(
      /Show the sessions/,
    );
    expect(screen.getByTestId("repro-demo-show-telemetry").textContent).toMatch(
      /Show the telemetry/,
    );
  }, 20_000);

  test("reopening the panel after a run shows what ran, not a fresh proposal", async () => {
    stubCatalogs({
      harnesses: [{ harnessId: "opencode", displayName: "OpenCode" }],
      models: { opencode: ["fixture/first", "fixture/dog-tinder"] },
    });
    const { unmount } = render(
      <ReproDemoSection bridge={bridgeThatRuns()} defaultHarnessId="opencode" />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("repro-demo-model-value").textContent).toBe("fixture/first"),
    );
    // The viewer picks a different listed model through the product's picker
    // (the main agent's; the subagents have one of their own).
    fireEvent.click(screen.getAllByRole("button", { name: "Browse models" })[0]);
    fireEvent.click(await screen.findByRole("option", { name: /fixture\/dog-tinder/ }));
    expect(screen.getByTestId("repro-demo-model-value").textContent).toBe("fixture/dog-tinder");
    expect(screen.getByText("Your pick.")).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("repro-demo-run"));
    await waitFor(() =>
      expect(screen.getByTestId("repro-demo-run-name").textContent).toMatch(/dog-tinder-/),
    );

    // The tour unmounts this panel when it takes the viewer to the sessions.
    unmount();
    render(<ReproDemoSection bridge={bridgeThatRuns()} defaultHarnessId="opencode" />);
    expect(screen.getByTestId("repro-demo-model-value").textContent).toBe("fixture/dog-tinder");
  }, 20_000);

  test("a build without the channels the demo needs says so instead of offering a dead button", () => {
    render(<ReproDemoSection bridge={null} />);
    expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/does not expose every channel/).textContent).toMatch(
      /does not expose every channel/,
    );
  });

  test("with no supported harness installed, the run is blocked and says why", async () => {
    stubCatalogs({ harnesses: [], models: {} });
    render(<ReproDemoSection bridge={bridgeThatRuns()} />);
    await waitFor(() =>
      expect(screen.getByTestId("repro-demo-blocked").textContent).toMatch(
        /No supported harness is installed here/,
      ),
    );
    expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the subagents' runtime", () => {
  test("follows the main agent until it is changed, then proposes from its own list", async () => {
    stubCatalogs({
      harnesses: [
        { harnessId: "claude", displayName: "Claude Code" },
        { harnessId: "pi", displayName: "Pi" },
      ],
      models: {
        claude: ["claude-sonnet-5", "claude-opus-5"],
        pi: ["dgx-spark/qwen3.8-flash-next-nvidia-nvfp4", "openai/gpt-5.6"],
      },
    });
    const { renderHook, act, waitFor: wait } = await import("@testing-library/react");
    const { useDemoRuntime } = await import("./ReproDemoSection");
    const { result } = renderHook(() => {
      const main = useDemoRuntime({ initial: null, defaultHarnessId: "claude" });
      const subagents = useDemoRuntime({
        initial: null,
        defaultHarnessId: "claude",
        follow: { harness: main.harness, model: main.model },
      });
      return { main, subagents };
    });
    // Nothing is proposed before the catalogs answer; then the main agent gets
    // the host's recommended Claude model, and the subagents mirror it.
    await wait(() => expect(result.current.main.model).toBe("claude-sonnet-5"));
    await wait(() => expect(result.current.subagents.model).toBe("claude-sonnet-5"));
    expect(result.current.subagents.harness).toBe("claude");
    expect(result.current.subagents.following).toBe(true);

    // A Claude Code main agent delegating to Pi workers: the subagents get
    // Pi's own list, proposed the same way.
    act(() => result.current.subagents.chooseHarness("pi"));
    expect(result.current.subagents.following).toBe(false);
    await wait(() =>
      expect(result.current.subagents.model).toBe("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"),
    );
    expect(result.current.main.harness).toBe("claude");
    expect(result.current.main.model).toBe("claude-sonnet-5");
  });

  test("the policy the run writes approves the subagents' runtime, the bot gets the main one", async () => {
    stubCatalogs({
      harnesses: [{ harnessId: "opencode", displayName: "OpenCode" }],
      models: { opencode: ["fixture/dog-tinder"] },
    });
    const seen = { bots: [] as unknown[] };
    const policies: unknown[] = [];
    const bridge = {
      ...bridgeThatRuns(seen),
      graphWritePolicy: async (input: unknown) => {
        policies.push(input);
        return ok({});
      },
    } as ReproDemoBridge;
    render(<ReproDemoSection bridge={bridge} defaultHarnessId="opencode" />);
    await waitFor(() =>
      expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByTestId("repro-demo-subagents-model-value").textContent).toBe(
      "fixture/dog-tinder",
    );
    fireEvent.click(screen.getByTestId("repro-demo-run"));
    await waitFor(() => expect(policies).toHaveLength(1));
    expect((policies[0] as { policy: { approvedRuntimes: unknown[] } }).policy.approvedRuntimes).toEqual([
      { harness: "opencode", model: "fixture/dog-tinder" },
    ]);
  });
});
