// MIT Copyright (c) 2026 Lovecast Inc.
// Ported in structure from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-controller.ts` /
// `use-recipe-pane-controller.ts`: one controller object feeds
// RecipePaneHeader, RecipePaneContent and MentuPanel so the right-sidebar
// panel and the wide tab render the same state. Adapted to this repo's
// data layer: the `MentuBridge` RPCs (`mentu.recipes/recipe/runtime/
// approve/run/runs/run_status/retry/cancel`) and the shared
// `features/mentu` store for selection, mode and draft source. The
// reference's session/execution-host scope, check/doctor/draft-apply and
// step-editing concepts have no daemon RPC here and are not modeled.

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MentuApproval,
  MentuBridge,
  MentuRecipeDetail,
  MentuRecipeSummary,
  MentuRun,
  MentuRuntimeInfo,
} from "../../../../shared/mentu-contract";
import type { MentuPaneMode } from "../../../../shared/persistence-contracts/mentu-pane-types";
import { buildRecipeGraph, type RecipeGraph } from "./recipe-graph";
import { useMentuState } from "./mentu-store";
import type { MentuRuntimeMessageKind } from "./MentuRuntimeMessage";

const POLL_INTERVAL_MS = 750;

export type MentuReview = {
  recipeName: string;
  contentHash: string;
  stepCount: number;
  steps: { label: string; backend: string }[];
  runner: string;
};

export type MentuPaneController = {
  workspaceId: string;
  loading: boolean;
  loadingRecipe: boolean;
  recipes: MentuRecipeSummary[];
  validEntries: MentuRecipeSummary[];
  invalidCount: number;
  selectedRecipeId: string | null;
  setSelectedRecipeId: (recipeId: string | null) => void;
  recipe: MentuRecipeDetail | null;
  runtime: MentuRuntimeInfo | null;
  runtimeMessage: string | null;
  runtimeMessageKind: MentuRuntimeMessageKind;
  approval: MentuApproval | null;
  review: MentuReview | null;
  run: MentuRun | null;
  runs: MentuRun[];
  graph: RecipeGraph | null;
  selectedNodeId: string | null;
  setSelectedNodeId: (nodeId: string) => void;
  selectedNode: RecipeGraph["nodes"][number] | null;
  mode: MentuPaneMode;
  setMode: (mode: MentuPaneMode) => void;
  draftSource: string;
  busy: boolean;
  operationRunning: boolean;
  error: string | null;
  stageReview: () => void;
  clearReview: () => void;
  approveAndRun: () => Promise<void>;
  retry: () => Promise<void>;
  cancelRun: () => Promise<void>;
};

export function useMentuPaneController(
  bridge: MentuBridge,
  workspaceId: string,
): MentuPaneController {
  const [state, setState] = useMentuState(workspaceId);
  const [recipes, setRecipes] = useState<MentuRecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipe, setRecipe] = useState<MentuRecipeDetail | null>(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [runtime, setRuntime] = useState<MentuRuntimeInfo | null>(null);
  const [approval, setApproval] = useState<MentuApproval | null>(null);
  const [review, setReview] = useState<MentuReview | null>(null);
  const [run, setRun] = useState<MentuRun | null>(null);
  const [runs, setRuns] = useState<MentuRun[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void bridge.mentuRecipes({ workspaceId }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) setRecipes(result.result.recipes);
      else setError(result.error.message);
    });
    void bridge.mentuRuntime().then((result) => {
      if (cancelled) return;
      if (result.ok) setRuntime(result.result.runtime);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setApproval(null);
    setReview(null);
    setRun(null);
    setRuns([]);
    setConflict(null);
    if (!state.selectedRecipeId) {
      setRecipe(null);
      return;
    }
    setLoadingRecipe(true);
    const selectedId = state.selectedRecipeId;
    void bridge
      .mentuRecipe({ workspaceId, recipeId: selectedId })
      .then((result) => {
        if (cancelled) return;
        setLoadingRecipe(false);
        if (result.ok) {
          setRecipe(result.result.recipe);
          setState({ draftSource: result.result.recipe.source });
        } else {
          setRecipe(null);
          setError(result.error.message);
        }
      });
    void bridge.mentuRuns({ workspaceId }).then((result) => {
      if (cancelled || !result.ok) return;
      const history = result.result.runs.filter((entry) => entry.recipeId === selectedId);
      setRuns(history);
      const active = state.activeRunId
        ? history.find((entry) => entry.id === state.activeRunId) ?? null
        : null;
      setRun(active ?? history[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState is stable per workspace
  }, [bridge, workspaceId, state.selectedRecipeId]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    let cancelled = false;
    const timer = setInterval(() => {
      void bridge.mentuRunStatus({ runId: run.id }).then((result) => {
        if (cancelled || result.ok === false) return;
        setRun(result.result.run);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bridge, run]);

  const graph = useMemo(
    () => (recipe ? buildRecipeGraph(recipe.steps) : null),
    [recipe],
  );
  const selectedNode = graph?.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
  const validEntries = useMemo(() => recipes.filter((entry) => entry.valid), [recipes]);
  const invalidCount = recipes.length - validEntries.length;

  const runtimeAvailable = runtime?.available === true && runtime?.lockMatches === true;

  let runtimeMessage: string | null = null;
  let runtimeMessageKind: MentuRuntimeMessageKind = "unavailable";
  if (runtime && !runtimeAvailable) {
    runtimeMessage = runtime.message ?? "Mentu Recipes is unavailable on the execution host.";
    runtimeMessageKind = "unavailable";
  } else if (conflict) {
    runtimeMessage = conflict;
    runtimeMessageKind = "conflict";
  } else if (run && (run.status === "failed" || run.status === "unavailable")) {
    runtimeMessage = run.error ?? "The latest run did not complete.";
    runtimeMessageKind = "execution-failed";
  } else if (error && !recipe) {
    runtimeMessage = error;
    runtimeMessageKind = "invalid";
  }

  const setSelectedRecipeId = useCallback(
    (recipeId: string | null) => {
      setError(null);
      setState({ selectedRecipeId: recipeId, selectedNodeId: null });
    },
    [setState],
  );

  const setMode = useCallback(
    (mode: MentuPaneMode) => setState({ mode }),
    [setState],
  );

  const setSelectedNodeId = useCallback(
    (nodeId: string) => setState({ selectedNodeId: nodeId }),
    [setState],
  );

  const stageReview = useCallback(() => {
    if (!recipe) return;
    setReview({
      recipeName: recipe.name,
      contentHash: recipe.contentHash,
      stepCount: recipe.steps.length,
      steps: recipe.steps.map((step) => ({ label: step.label, backend: step.backend })),
      runner: runtime?.version ?? runtime?.expectedRevision ?? "unknown",
    });
  }, [recipe, runtime]);

  const clearReview = useCallback(() => setReview(null), []);

  const approveAndRun = useCallback(async () => {
    if (!recipe || !state.selectedRecipeId || !review) return;
    setBusy(true);
    setError(null);
    const approved = await bridge.mentuApprove({
      workspaceId,
      recipeId: state.selectedRecipeId,
      contentHash: recipe.contentHash,
    });
    if (!approved.ok) {
      setBusy(false);
      // The daemon reports a changed recipe as `invalid_argument` with a
      // "changed since" message; surface that as the conflict notice.
      if (approved.error.message.includes("changed since")) {
        setApproval(null);
        setReview(null);
        setConflict("The recipe changed on disk since it was loaded. Reload it before running.");
      } else {
        setError(approved.error.message);
      }
      return;
    }
    // The recipe may have changed between review and approval: re-read it
    // so approval never binds a stale hash.
    const fresh = await bridge.mentuRecipe({ workspaceId, recipeId: state.selectedRecipeId });
    if (!fresh.ok || fresh.result.recipe.contentHash !== approved.result.approval.contentHash) {
      setBusy(false);
      setApproval(null);
      setReview(null);
      setConflict("The recipe changed on disk since it was loaded. Reload it before running.");
      return;
    }
    setApproval(approved.result.approval);
    const started = await bridge.mentuRun({
      workspaceId,
      recipeId: state.selectedRecipeId,
      approvalId: approved.result.approval.id,
    });
    setBusy(false);
    if (started.ok) {
      setRun(started.result.run);
      setState({ activeRunId: started.result.run.id });
    } else {
      setError(started.error.message);
    }
  }, [bridge, workspaceId, recipe, review, state.selectedRecipeId, setState]);

  const retry = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    const result = await bridge.mentuRetry({ runId: run.id });
    setBusy(false);
    if (result.ok) {
      setRun(result.result.run);
      setState({ activeRunId: result.result.run.id });
    } else setError(result.error.message);
  }, [bridge, run, setState]);

  const cancelRun = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    const result = await bridge.mentuCancel({ runId: run.id });
    setBusy(false);
    if (result.ok) setRun(result.result.run);
  }, [bridge, run]);

  return {
    workspaceId,
    loading,
    loadingRecipe,
    recipes,
    validEntries,
    invalidCount,
    selectedRecipeId: state.selectedRecipeId,
    setSelectedRecipeId,
    recipe,
    runtime,
    runtimeMessage,
    runtimeMessageKind,
    approval,
    review,
    run,
    runs,
    graph,
    selectedNodeId: state.selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    mode: state.mode,
    setMode,
    draftSource: state.draftSource,
    busy,
    operationRunning: run?.status === "running",
    error,
    stageReview,
    clearReview,
    approveAndRun,
    retry,
    cancelRun,
  };
}
