// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Integration tests for the ported MentuPanel over a fake `MentuBridge`:
// header copy and the full-tab affordance, recipe selection through the
// shared store, the Review → Approve & run flow into a running execution,
// the execution-failed message with its evidence shortcut, and the wide
// tab's Graph/Run/Evidence/Metrics tabs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  MentuBridge,
  MentuRecipeDetail,
  MentuRun,
} from "../../../../shared/mentu-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { MENTU_OPEN_TAB_EVENT, MentuPanel } from "./MentuPanel";
import { mentuStore } from "./mentu-store";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const HASH = "c".repeat(64);

function recipe(): MentuRecipeDetail {
  return {
    id: "demo",
    path: ".mentu/recipes/demo.json",
    name: "demo",
    description: null,
    contentHash: HASH,
    steps: [
      {
        label: "build",
        backend: "shell",
        description: "Build it.",
        dependsOn: [],
        timeoutSeconds: 30,
        verifyCommands: [],
      },
      {
        label: "test",
        backend: "shell",
        description: null,
        dependsOn: ["build"],
        timeoutSeconds: null,
        verifyCommands: [],
      },
    ],
    source: '{"name":"demo"}',
  };
}

function failedRun(): MentuRun {
  return {
    id: "run-9",
    workspaceId: "ws",
    recipeId: "demo",
    approvalId: "approval-9",
    mentuRunId: "run_fixture_9",
    status: "failed",
    startedAt: "t",
    endedAt: "t",
    steps: [],
    error: "test failed",
    retryOf: null,
  };
}

function runningRun(): MentuRun {
  return { ...failedRun(), id: "run-10", status: "running", error: null };
}

const ok = <T,>(result: T) => ({ ok: true as const, result });

function fakeBridge(): MentuBridge & Record<string, ReturnType<typeof vi.fn>> {
  return {
    mentuRecipes: vi.fn(async () => ok({ recipes: [{ id: "demo", path: "demo", name: "demo", valid: true, issue: null }] })),
    mentuRecipe: vi.fn(async () => ok({ recipe: recipe() })),
    mentuRuntime: vi.fn(async () =>
      ok({
        runtime: {
          available: true,
          path: "/bin/mentu-recipes",
          version: "fixture",
          expectedRevision: "r",
          expectedSha256: "s",
          actualSha256: "s",
          lockMatches: true,
          message: null,
        },
      }),
    ),
    mentuApprove: vi.fn(async () =>
      ok({
        approval: { id: "approval-1", workspaceId: "ws", recipeId: "demo", contentHash: HASH, approvedAt: "t" },
      }),
    ),
    mentuRun: vi.fn(async () => ok({ run: runningRun() })),
    mentuRuns: vi.fn(async () => ok({ runs: [] as MentuRun[] })),
    mentuRunStatus: vi.fn(async () => ok({ run: runningRun() })),
    mentuRetry: vi.fn(async () => ok({ run: runningRun() })),
    mentuCancel: vi.fn(async () => ok({ run: { ...runningRun(), status: "cancelled" as const } })),
  };
}

async function selectRecipe(ws: string) {
  mentuStore.set(ws, { selectedRecipeId: "demo" });
  await waitFor(() => expect(screen.getByTestId("mentu-panel-plan")).toBeTruthy());
}

describe("MentuPanel", () => {
  it("renders the header copy and opens the full tab", async () => {
    const ws = `ws-header-${Math.random()}`;
    const bridge = fakeBridge();
    const onOpenFullTab = vi.fn();
    render(<MentuPanel bridge={bridge} workspaceId={ws} onOpenFullTab={onOpenFullTab} />);
    expect(screen.getByText("Workspace source: .mentu/recipes")).toBeTruthy();
    fireEvent.click(screen.getByText("Open full tab"));
    expect(onOpenFullTab).toHaveBeenCalledTimes(1);

    const seen: string[] = [];
    window.addEventListener(MENTU_OPEN_TAB_EVENT, () => seen.push("opened"), { once: true });
    cleanup();
    render(<MentuPanel bridge={bridge} workspaceId={ws} />);
    fireEvent.click(screen.getByText("Open full tab"));
    expect(seen).toEqual(["opened"]);
  });

  it("runs Review → Approve & run into a cancellable execution", async () => {
    const ws = `ws-flow-${Math.random()}`;
    const bridge = fakeBridge();
    render(<MentuPanel bridge={bridge} workspaceId={ws} />);
    await selectRecipe(ws);
    expect(screen.getByText("build")).toBeTruthy();

    fireEvent.click(screen.getByTestId("mentu-run"));
    await waitFor(() => expect(screen.getByTestId("mentu-review")).toBeTruthy());
    expect(screen.getByText("Approve & run")).toBeTruthy();

    fireEvent.click(screen.getByText("Approve & run"));
    await waitFor(() => expect(screen.getByTestId("mentu-cancel")).toBeTruthy());
    expect(bridge.mentuApprove).toHaveBeenCalledTimes(1);
    expect(bridge.mentuRun).toHaveBeenCalledTimes(1);
  });

  it("routes an execution failure to the evidence view", async () => {
    const ws = `ws-failed-${Math.random()}`;
    const bridge = fakeBridge();
    bridge.mentuRuns = vi.fn(async () => ok({ runs: [failedRun()] }));
    render(<MentuPanel bridge={bridge} workspaceId={ws} />);
    await selectRecipe(ws);
    expect(screen.getByText("Recipe execution failed:")).toBeTruthy();
    fireEvent.click(screen.getByText("View evidence"));
    await waitFor(() => expect(screen.getByTestId("recipe-evidence")).toBeTruthy());
    // The failure surfaces both in the runtime message and the evidence.
    expect(screen.getAllByText("test failed")).toHaveLength(2);
  });

  it("shares the running execution between the panel and the full tab", async () => {
    const ws = `ws-sync-${Math.random()}`;
    const bridge = fakeBridge();
    render(<MentuPanel bridge={bridge} workspaceId={ws} />);
    render(<MentuPanel bridge={bridge} workspaceId={ws} variant="tab" />);
    // The tab's run controls live on its Run tab; the panel keeps its
    // default Plan view.
    mentuStore.set(ws, { selectedRecipeId: "demo", mode: "run" });
    const tab = await waitFor(() => screen.getByTestId("recipe-pane"));
    await waitFor(() =>
      expect(
        within(tab).getByTestId("mentu-run"),
      ).toBeTruthy(),
    );

    // Review and approve in the tab only: the panel adopts the published
    // run instead of keeping its earlier (empty) row.
    fireEvent.click(within(tab).getByTestId("mentu-run"));
    await waitFor(() => expect(within(tab).getByText("Approve & run")).toBeTruthy());
    fireEvent.click(within(tab).getByText("Approve & run"));

    // Both mounts show the same running execution with a Cancel control.
    await waitFor(() => expect(screen.getAllByTestId("mentu-cancel")).toHaveLength(2));
    const panel = screen.getByTestId("mentu-panel");
    expect(
      within(panel).getByTestId("mentu-run-status").textContent,
    ).toContain("Running…");
    expect(
      within(tab).getByTestId("mentu-run-status").textContent,
    ).toContain("Running…");
  });

  it("renders the wide tab with the reference tab order", async () => {
    const ws = `ws-tab-${Math.random()}`;
    const bridge = fakeBridge();
    render(<MentuPanel bridge={bridge} workspaceId={ws} variant="tab" />);
    expect(screen.getByTestId("recipe-pane")).toBeTruthy();
    for (const tab of ["Graph", "Run", "Evidence", "Metrics"]) {
      expect(screen.getByText(tab)).toBeTruthy();
    }
    mentuStore.set(ws, { selectedRecipeId: "demo" });
    await waitFor(() => expect(screen.getByTestId("recipe-graph")).toBeTruthy());
    // jsdom clicks do not move focus; Radix Tabs activates on focus, so
    // focus the trigger first like a real browser mousedown would.
    const selectTab = (label: string) => {
      const trigger = screen.getByText(label).closest("button")!;
      trigger.focus();
      fireEvent.click(trigger);
    };
    selectTab("Metrics");
    // No run is loaded yet, so the metrics tab shows its honest empty state.
    await waitFor(() =>
      expect(
        screen.getByText("No measurements are available until a run record is loaded."),
      ).toBeTruthy(),
    );
    selectTab("Run");
    await waitFor(() =>
      expect(screen.getByText("Run the selected source recipe")).toBeTruthy(),
    );
  });
});
