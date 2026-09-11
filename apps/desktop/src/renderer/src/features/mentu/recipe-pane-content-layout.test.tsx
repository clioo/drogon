// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Layout regression for the packaged-acceptance Evidence failure: in a
// narrow main column the Graph/Run/Evidence/Metrics tab list used to
// overflow the recipe surface and paint beneath the right sidebar, whose
// rows intercepted the clicks aimed at the hidden triggers. The view list
// must render inside a clipping, horizontally scrollable wrapper and the
// App's tab panel must clip its surface to its own column.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { RecipePaneContent } from "./RecipePaneContent";
import type { MentuPaneController } from "./recipe-pane-controller";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function fixtureController(
  overrides: Partial<MentuPaneController> = {},
): MentuPaneController {
  return {
    workspaceId: "ws",
    loading: false,
    loadingRecipe: false,
    recipes: [],
    validEntries: [],
    invalidCount: 0,
    refreshRecipes: vi.fn(),
    workspacePath: "/tmp/ws",
    recipesDirectory: { kind: "missing" },
    directorySummary: "No .mentu/recipes directory yet — this workspace has never had a recipe.",
    invalidRecipes: [],
    nestedFindings: [],
    recipesPathLabel: "/tmp/ws/.mentu/recipes",
    canCreateStarter: false,
    creatingStarter: false,
    createStarterError: null,
    createStarterRecipe: vi.fn(),
    selectedRecipeId: null,
    setSelectedRecipeId: vi.fn(),
    recipe: null,
    runtime: null,
    runtimeMessage: null,
    runtimeMessageKind: "unavailable",
    approval: null,
    review: null,
    run: null,
    runs: [],
    evidence: null,
    evidenceLoading: false,
    evidenceError: null,
    graph: null,
    selectedNodeId: null,
    setSelectedNodeId: vi.fn(),
    selectedNode: null,
    mode: "graph",
    setMode: vi.fn(),
    draftSource: "",
    dirty: false,
    draftIssues: [],
    editStep: null,
    availableBackends: ["shell"],
    inheritBackendLabel: null,
    recipeDefinition: null,
    harnessCatalog: [],
    harnessCatalogLoading: false,
    harnessCatalogError: null,
    refreshHarnessCatalog: vi.fn(),
    editable: false,
    saveNotice: null,
    saving: false,
    setDraftSource: vi.fn(),
    discardDraft: vi.fn(),
    applyDraft: vi.fn(() => true),
    saveDraft: vi.fn(async () => {}),
    saveSelectedStep: vi.fn(async () => {}),
    busy: false,
    operationRunning: false,
    error: null,
    stageReview: vi.fn(),
    clearReview: vi.fn(),
    approveAndRun: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    cancelRun: vi.fn(async () => {}),
    ...overrides,
  } as MentuPaneController;
}

describe("RecipePaneContent narrow-column layout", () => {
  it("scrolls the view tabs inside the surface instead of escaping its column", () => {
    render(<RecipePaneContent controller={fixtureController()} />);
    const wrapper = document.querySelector(".recipe-pane-view-tabs");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("overflow-x-auto");
    expect(wrapper?.className).toContain("min-w-0");
    // The active-underline compensation: 1px of bottom padding inside the
    // clip, handed back to layout with a negative margin.
    expect(wrapper?.className).toContain("pb-px");
    expect(wrapper?.className).toContain("-mb-px");
    // The four views stay exactly as the fork labels them.
    for (const name of ["Graph", "Run", "Evidence", "Metrics"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }
  });

  it("shows the honest empty state with the real recipes path", () => {
    render(<RecipePaneContent controller={fixtureController()} />);
    expect(
      screen.getByText(
        "No .mentu/recipes directory yet — this workspace has never had a recipe.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("/tmp/ws/.mentu/recipes")).toBeTruthy();
  });
});
