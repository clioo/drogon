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

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

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
});
