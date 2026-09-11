// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Header tests for the target-design "Run Recipe" button: it reuses the
// SAME review -> approve & run state machine `RunControls` drives, stays
// disabled until the graph, runtime and busy state honestly allow a run,
// and the refresh affordance calls the controller's real refresh.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { RecipePaneHeader } from "./RecipePaneHeader";
import type { MentuPaneController } from "./recipe-pane-controller";
import type { MentuRun } from "../../../../shared/mentu-contract";
import type { Session } from "../../../../shared/session-contract";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function mainSession(): Session {
  return {
    id: "s-1",
    workspaceId: "ws",
    hostId: "host-1",
    incarnation: "inc-1",
    command: "claude",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: "2026-09-07T00:00:00Z",
    harnessId: "claude",
    agentState: "idle",
  };
}

function fixtureController(overrides: Partial<MentuPaneController> = {}): MentuPaneController {
  return {
    workspaceId: "ws",
    loading: false,
    loadingRecipe: false,
    recipes: [],
    validEntries: [],
    invalidCount: 0,
    refreshRecipes: vi.fn(),
    workspacePath: null,
    recipesDirectory: { kind: "unknown" },
    directorySummary: "Select a valid workspace recipe to view its graph.",
    invalidRecipes: [],
    nestedFindings: [],
    recipesPathLabel: ".mentu/recipes",
    canCreateStarter: false,
    creatingStarter: false,
    createStarterError: null,
    createStarterRecipe: vi.fn(),
    selectedRecipeId: "demo",
    setSelectedRecipeId: vi.fn(),
    recipe: {
      id: "demo",
      path: ".mentu/recipes/demo.json",
      name: "demo",
      description: null,
      contentHash: "a".repeat(64),
      steps: [],
      source: "{}",
    },
    runtime: {
      available: true,
      lockMatches: true,
      expectedRevision: "r",
      expectedSha256: "s",
      path: "/usr/local/bin/mentu-recipes",
      version: "0.5.0",
      actualSha256: "s",
      message: null,
    },
    runtimeMessage: null,
    runtimeMessageKind: "unavailable",
    approval: null,
    review: null,
    run: null,
    runs: [],
    evidence: null,
    evidenceLoading: false,
    evidenceError: null,
    graph: { valid: true, nodes: [], cycle: null, issues: [] },
    selectedNodeId: null,
    setSelectedNodeId: vi.fn(),
    selectedNode: null,
    mode: "graph",
    setMode: vi.fn(),
    draftSource: "{}",
    dirty: false,
    draftIssues: [],
    editStep: null,
    availableBackends: [],
    inheritBackendLabel: null,
    recipeDefinition: null,
    harnessCatalog: [],
    harnessCatalogLoading: false,
    harnessCatalogError: null,
    refreshHarnessCatalog: vi.fn(),
    editable: true,
    saveNotice: null,
    saving: false,
    setDraftSource: vi.fn(),
    discardDraft: vi.fn(),
    applyDraft: vi.fn(),
    saveDraft: vi.fn(),
    saveSelectedStep: vi.fn(),
    busy: false,
    operationRunning: false,
    error: null,
    mainSession: null,
    mainSessionReady: false,
    dispatching: false,
    delivering: false,
    dispatchNotice: null,
    stageReview: vi.fn(),
    clearReview: vi.fn(),
    approveAndRun: vi.fn(),
    retry: vi.fn(),
    cancelRun: vi.fn(),
    ...overrides,
  };
}

describe("RecipePaneHeader Run Recipe button", () => {
  it("shows an Active Workspace chip and a red-accent Run Recipe button", () => {
    render(<RecipePaneHeader controller={fixtureController()} />);
    expect(screen.getByText("Active Workspace")).toBeTruthy();
    const button = screen.getByTestId("mentu-run-recipe");
    expect(button.textContent).toContain("Run Recipe");
    expect(button.getAttribute("data-variant")).toBe("destructive");
  });

  it("stages a review on first click, and approves & runs once a review is staged", () => {
    const stageReview = vi.fn();
    const { rerender } = render(
      <RecipePaneHeader controller={fixtureController({ stageReview })} />,
    );
    fireEvent.click(screen.getByTestId("mentu-run-recipe"));
    expect(stageReview).toHaveBeenCalledTimes(1);

    const approveAndRun = vi.fn().mockResolvedValue(undefined);
    rerender(
      <RecipePaneHeader
        controller={fixtureController({
          approveAndRun,
          review: {
            recipeName: "demo",
            contentHash: "a".repeat(64),
            stepCount: 1,
            steps: [{ label: "build", backend: "shell" }],
            runner: "1.0",
          },
        })}
      />,
    );
    expect(screen.getByTestId("mentu-run-recipe").textContent).toContain("Approve & run recipe");
    fireEvent.click(screen.getByTestId("mentu-run-recipe"));
    expect(approveAndRun).toHaveBeenCalledTimes(1);
  });

  it("disables the button honestly when the runtime is unavailable, busy, or the graph is invalid", () => {
    render(
      <RecipePaneHeader
        controller={fixtureController({
          runtime: {
      available: false,
      lockMatches: false,
      expectedRevision: "r",
      expectedSha256: "s",
      path: null,
      version: null,
      actualSha256: null,
      message: null,
    },
        })}
      />,
    );
    expect((screen.getByTestId("mentu-run-recipe") as HTMLButtonElement).disabled).toBe(true);
  });

  it("wires the refresh button to the controller's real refreshRecipes call", () => {
    const refreshRecipes = vi.fn();
    render(<RecipePaneHeader controller={fixtureController({ refreshRecipes })} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh recipes" }));
    expect(refreshRecipes).toHaveBeenCalledTimes(1);
  });

  it("turns into a live running indicator while a run is in flight and returns to idle", () => {
    const runningRun: MentuRun = {
      id: "run-row-1",
      workspaceId: "ws",
      recipeId: "demo",
      approvalId: "appr-1",
      mentuRunId: "run_fixture_1",
      status: "running",
      startedAt: "2026-09-07T00:00:00Z",
      endedAt: null,
      steps: [
        {
          label: "build",
          backend: "shell",
          status: "succeeded",
          exitCode: 0,
          durationSeconds: 1,
          attempts: 1,
          outputPath: null,
          errorPath: null,
          error: null,
          verification: null,
        },
      ],
      error: null,
      retryOf: null,
    };
    const { rerender } = render(
      <RecipePaneHeader
        controller={fixtureController({ run: runningRun, operationRunning: true })}
      />,
    );
    const running = screen.getByTestId("mentu-run-recipe");
    expect(running.getAttribute("data-running")).toBe("true");
    expect(running.textContent).toContain("Running… 1 step recorded");
    expect(running.querySelector(".animate-spin")).toBeTruthy();

    // The prompt is in flight but the daemon has no run row yet: still
    // animating, and labeled as such rather than as a live run.
    rerender(
      <RecipePaneHeader
        controller={fixtureController({ run: null, dispatching: true })}
      />,
    );
    const starting = screen.getByTestId("mentu-run-recipe");
    expect(starting.getAttribute("data-running")).toBe("true");
    expect(starting.textContent).toContain("Starting run…");

    // Delivery itself is in flight (waiting for a busy main session to
    // become safe to type into): also animated, with its own honest label.
    rerender(
      <RecipePaneHeader controller={fixtureController({ run: null, delivering: true })} />,
    );
    const delivering = screen.getByTestId("mentu-run-recipe");
    expect(delivering.getAttribute("data-running")).toBe("true");
    expect(delivering.textContent).toContain("Waiting for agent…");

    // Settled: the indicator stops because the STATE says so, not a timer.
    rerender(
      <RecipePaneHeader
        controller={fixtureController({ run: { ...runningRun, status: "succeeded", endedAt: "2026-09-07T00:00:02Z" } })}
      />,
    );
    const idle = screen.getByTestId("mentu-run-recipe");
    expect(idle.getAttribute("data-running")).toBe("false");
    expect(idle.textContent).toContain("Run Recipe");
    expect(idle.querySelector(".animate-spin")).toBeNull();
  });

  it("says what happened when the prompt was delivered, and when there is no agent session", () => {
    const { rerender } = render(
      <RecipePaneHeader
        controller={fixtureController({
          mainSession: mainSession(),
          mainSessionReady: true,
          dispatchNotice: "Prompt delivered to agent session s-1. Waiting for it to start the run…",
        })}
      />,
    );
    expect(screen.getByTestId("mentu-dispatch-notice").textContent).toContain(
      "Prompt delivered to agent session s-1",
    );

    rerender(
      <RecipePaneHeader
        controller={fixtureController({ mainSession: null, mainSessionReady: false })}
      />,
    );
    expect(screen.getByTestId("mentu-main-session-hint").textContent).toContain(
      "No agent session open in this workspace",
    );
  });
});
