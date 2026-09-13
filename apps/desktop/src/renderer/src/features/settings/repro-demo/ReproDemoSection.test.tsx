// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ReproDemoSection } from "./ReproDemoSection";
import { resetReproDemo, type ReproDemoBridge } from "./use-repro-demo";

afterEach(cleanup);
// The demo's run state outlives this component on purpose (the tour unmounts
// the panel mid-run), so each case starts from a cleared store.
beforeEach(() => resetReproDemo());

const ok = <T,>(result: T) => ({ ok: true as const, result });

function bridgeThatRuns(): ReproDemoBridge {
  let monitorChecks = 0;
  return {
    status: async () => ok({ hostId: "host-1" }),
    quickSessionCreate: async () =>
      ok({ project: { id: "p1", name: "dog-tinder-demo" }, workspaceId: "ws-1" }),
    fileWrite: async () => ok({}),
    botCreate: async () => ok({ id: "bot-1" }),
    botMonitorCreate: async () => ok({ monitorId: "mon-1", ruleKind: "local_file_digest.v1" }),
    botMonitorApprove: async () => ok({ approved: true }),
    botMonitorList: async () => {
      monitorChecks += 1;
      return ok({
        monitors: [
          monitorChecks === 1
            ? { monitorId: "mon-1", lastCheckOutcome: "error", lastError: "NotFound" }
            : {
                monitorId: "mon-1",
                lastCheckOutcome: "changed",
                lastEventId: "mev_9",
                firing: { lastEventId: "mev_9", lastOutcome: "dispatched" },
              },
        ],
      });
    },
    graphWritePolicy: async () => ok({}),
    graphOrchestratorStart: async () => ok({ run: { id: "run-1" } }),
    graphOrchestratorStatus: async () =>
      ok({
        run: {
          id: "run-1",
          status: "passed",
          steps: [
            {
              iteration: 1,
              phase: "review",
              status: "succeeded",
              verdict: "pass",
              runtime: { harness: "pi", model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4" },
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

describe("Settings → Demo reproducible", () => {
  test("opens on the free local lane and shows every phase as pending", () => {
    render(<ReproDemoSection bridge={bridgeThatRuns()} />);
    expect((screen.getByTestId("repro-demo-model") as HTMLInputElement).value).toBe(
      "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
    );
    expect(
      screen.getByTestId("repro-demo-phase-workspace").getAttribute("data-status"),
    ).toBe("idle");
    expect(
      screen.getByTestId("repro-demo-phase-evidence").getAttribute("data-status"),
    ).toBe("idle");
  });

  test("picking another runtime replaces the model with that harness's own", () => {
    render(<ReproDemoSection bridge={bridgeThatRuns()} />);
    fireEvent.change(screen.getByTestId("repro-demo-runtime"), {
      target: { value: "claude" },
    });
    expect((screen.getByTestId("repro-demo-model") as HTMLInputElement).value).toBe("");
  });

  test("a run walks the phases, shows the firing, the rounds and the cost", async () => {
    render(<ReproDemoSection bridge={bridgeThatRuns()} />);
    fireEvent.click(screen.getByTestId("repro-demo-run"));

    await waitFor(
      () =>
        expect(
          screen.getByTestId("repro-demo-phase-evidence").getAttribute("data-status"),
        ).toBe("done"),
      { timeout: 15_000 },
    );
    expect(screen.getByTestId("repro-demo-checks").textContent).toMatch(/mev_9/);
    expect(screen.getByTestId("repro-demo-rounds").textContent).toMatch(/pass/);
    // The free local model is priced as declared-free, not as a bill.
    expect(screen.getByTestId("repro-demo-cost").textContent).toMatch(/sin facturación/);
    expect(screen.getByTestId("repro-demo-release").textContent).toMatch(
      /el monitor del bot/,
    );
    // The last widget that changed is the one holding the focus ring.
    expect(
      screen.getByTestId("repro-demo-evidence").getAttribute("data-spotlight"),
    ).toBe("on");
  }, 20_000);

  test("a build without the channels the demo needs says so instead of offering a dead button", () => {
    render(<ReproDemoSection bridge={null} />);
    expect((screen.getByTestId("repro-demo-run") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/no expone todos los canales/).textContent).toMatch(
      /no expone todos los canales/,
    );
  });
});
