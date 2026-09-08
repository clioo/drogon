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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type {
  MentuRecipeDocument,
  MentuRecipeStep,
  MentuRecipeValidationIssue,
} from "./recipe-validation/mentu-recipe-document";
import { parseMentuRecipeJson } from "./recipe-validation/mentu-recipe-validation";
import { stringifyMentuRecipeDocument } from "./recipe-validation/mentu-recipe-serialization";
import {
  applyMentuDraftSource,
  formatMentuValidationIssues,
  hasMentuDraftForPath,
  withMentuDraftSource,
  withoutMentuDraftSource,
  type MentuDraftState,
} from "./mentu-session-draft-state";
import {
  updateRecipeStepDocument,
  type RecipeStepDraft,
} from "./recipe-pane-editor";

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
  /** The draft differs from the saved recipe bytes (dirty mark). */
  dirty: boolean;
  /** Fork-validator issues on the draft text; empty unless dirty. */
  draftIssues: MentuRecipeValidationIssue[];
  /** The selected step projected from the draft document, for the inspector. */
  editStep: MentuRecipeStep | null;
  /** Backends in use across the draft, for the inspector's backend select. */
  availableBackends: string[];
  /** The draft's root backend, shown as the inspector's inherit option. */
  inheritBackendLabel: string | null;
  /** Whether the draft text parses into an editable document at all. */
  editable: boolean;
  saveNotice: string | null;
  saving: boolean;
  setDraftSource: (source: string) => void;
  discardDraft: () => void;
  applyDraft: () => boolean;
  saveDraft: () => Promise<void>;
  saveSelectedStep: (draft: RecipeStepDraft) => Promise<void>;
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
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  // Per-path text drafts, distinct from the saved recipe bytes (the fork's
  // `draftSourceByPath`): switching recipes preserves each open draft, and
  // Save/Discard resolve it against the saved source.
  const [drafts, setDrafts] = useState<MentuDraftState>({ draftSourceByPath: {} });
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

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
    setSaveNotice(null);
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
          // A preserved per-path draft survives the reload; otherwise the
          // draft seeds from the saved bytes (clean, not dirty).
          const path = result.result.recipe.path;
          const map = draftsRef.current;
          setState({
            draftSource: hasMentuDraftForPath(map, path)
              ? map.draftSourceByPath[path]
              : result.result.recipe.source,
          });
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

  // The effective draft text: the per-path draft when one exists, else the
  // saved bytes. `state.draftSource` mirrors it for the panel's read-only
  // source view; the map is the edit authority.
  const draftSource =
    recipe && hasMentuDraftForPath(drafts, recipe.path)
      ? drafts.draftSourceByPath[recipe.path]
      : (recipe?.source ?? state.draftSource);
  const dirty = recipe !== null && draftSource !== recipe.source;

  // The saved bytes parsed into an edit document (null when the saved
  // recipe itself fails the editor's validation — a daemon-tolerant
  // recipe the structured editor cannot project).
  const savedDocument = useMemo<MentuRecipeDocument | null>(() => {
    if (!recipe) return null;
    try {
      const parsed = parseMentuRecipeJson(JSON.parse(recipe.source));
      if (!parsed.ok) return null;
      return {
        path: recipe.path,
        recipe: parsed.recipe,
        source: recipe.source,
        raw: parsed.raw,
        unknownFields: parsed.unknownFields,
      };
    } catch {
      return null;
    }
  }, [recipe]);

  // The draft projected into an edit document; null while the draft text
  // has errors (the inspector then refuses structured edits until the
  // text is fixed or discarded).
  const editDocument = useMemo<MentuRecipeDocument | null>(() => {
    if (!recipe || !savedDocument) return null;
    if (draftSource === recipe.source) return savedDocument;
    const applied = applyMentuDraftSource(savedDocument, draftSource);
    if (!("document" in applied)) return null;
    return { ...applied.document, source: draftSource };
  }, [recipe, savedDocument, draftSource]);

  // Live fork-validator issues on the draft text. Untouched recipes are
  // never flagged: the daemon tolerates recipes (e.g. a shell step with
  // no prompt) the editor's stricter validation would otherwise reject.
  const draftIssues = useMemo<MentuRecipeValidationIssue[]>(() => {
    if (!recipe || draftSource === recipe.source) return [];
    try {
      const parsed = parseMentuRecipeJson(JSON.parse(draftSource));
      return parsed.ok ? [] : parsed.issues;
    } catch (error) {
      return [
        {
          path: "$",
          message: error instanceof Error ? error.message : "Draft source is not valid JSON.",
        },
      ];
    }
  }, [recipe, draftSource]);

  const editStep: MentuRecipeStep | null =
    editDocument?.recipe.steps?.find((step) => step.label === selectedNode?.label) ?? null;
  const availableBackends = useMemo(() => {
    const backends = (editDocument ?? savedDocument)?.recipe.steps
      ?.map((step) => step.backend)
      .filter((backend): backend is string => Boolean(backend));
    return [...new Set([...(backends ?? []), "shell"])];
  }, [editDocument, savedDocument]);
  const inheritBackendLabel = (editDocument ?? savedDocument)?.recipe.backend ?? null;

  const runtimeAvailable = runtime?.available === true && runtime?.lockMatches === true;

  let runtimeMessage: string | null = null;
  let runtimeMessageKind: MentuRuntimeMessageKind = "unavailable";
  if (conflict) {
    runtimeMessage = conflict;
    runtimeMessageKind = "conflict";
  } else if (error) {
    // Save/edit/approve failures surface in the header banner like the
    // fork's save errors, ahead of the persistent runtime notice.
    runtimeMessage = error;
    runtimeMessageKind = "invalid";
  } else if (runtime && !runtimeAvailable) {
    runtimeMessage = runtime.message ?? "Mentu Recipes is unavailable on the execution host.";
    runtimeMessageKind = "unavailable";
  } else if (run && (run.status === "failed" || run.status === "unavailable")) {
    runtimeMessage = run.error ?? "The latest run did not complete.";
    runtimeMessageKind = "execution-failed";
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
    // A review binds the saved content hash; staging one over unsaved
    // edits would review bytes that can never run.
    if (draftSource !== recipe.source) {
      setError("Save or discard your recipe edits before reviewing.");
      return;
    }
    setReview({
      recipeName: recipe.name,
      contentHash: recipe.contentHash,
      stepCount: recipe.steps.length,
      steps: recipe.steps.map((step) => ({ label: step.label, backend: step.backend })),
      runner: runtime?.version ?? runtime?.expectedRevision ?? "unknown",
    });
  }, [draftSource, recipe, runtime]);

  const clearReview = useCallback(() => setReview(null), []);

  const approveAndRun = useCallback(async () => {
    if (!recipe || !state.selectedRecipeId || !review) return;
    if (draftSource !== recipe.source) {
      setError("Save or discard your recipe edits before running.");
      return;
    }
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
  }, [bridge, workspaceId, recipe, review, draftSource, state.selectedRecipeId, setState]);

  const setDraftText = useCallback(
    (source: string) => {
      if (!recipe) return;
      // Editing invalidates a staged review/approval: they bind the saved
      // hash, never the draft. Reverting to the saved bytes keeps them.
      const edited = source !== recipe.source;
      setDrafts({
        draftSourceByPath: edited
          ? withMentuDraftSource(draftsRef.current, recipe.path, source)
          : withoutMentuDraftSource(draftsRef.current, recipe.path),
      });
      setState({ draftSource: source });
      if (edited) {
        setReview(null);
        setApproval(null);
      }
      setSaveNotice(null);
    },
    [recipe, setState],
  );

  const setDraftSource = setDraftText;

  const discardDraft = useCallback(() => {
    if (!recipe) return;
    setDrafts({ draftSourceByPath: withoutMentuDraftSource(draftsRef.current, recipe.path) });
    setState({ draftSource: recipe.source });
    setError(null);
    setSaveNotice(null);
  }, [recipe, setState]);

  // Local pre-check: the draft text must satisfy the editor's validation
  // before it is worth projecting or saving. The daemon re-validates on
  // save regardless — it stays the authority for refusal.
  const applyDraft = useCallback((): boolean => {
    if (!recipe) return false;
    if (draftSource === recipe.source) {
      setError(null);
      return true;
    }
    if (draftIssues.length > 0) {
      setError(formatMentuValidationIssues(draftIssues));
      return false;
    }
    setError(null);
    return true;
  }, [draftIssues, draftSource, recipe]);

  const persistSource = useCallback(
    async (content: string) => {
      if (!recipe || !state.selectedRecipeId) return;
      if (!bridge.mentuRecipeSave) {
        setError("Recipe saving is unavailable in this desktop build.");
        return;
      }
      setSaving(true);
      setBusy(true);
      setError(null);
      setSaveNotice(null);
      const saved = await bridge.mentuRecipeSave({
        workspaceId,
        recipeId: state.selectedRecipeId,
        content,
      });
      setSaving(false);
      setBusy(false);
      if (!saved.ok) {
        setError(saved.error.message);
        return;
      }
      setRecipe(saved.result.recipe);
      setDrafts({
        draftSourceByPath: withoutMentuDraftSource(draftsRef.current, recipe.path),
      });
      setState({ draftSource: saved.result.recipe.source });
      // The save invalidated every approval bound to the old hash on the
      // daemon; drop the client-side review/approval too, so running the
      // edited recipe requires a fresh review.
      setApproval(null);
      setReview(null);
      setConflict(null);
      setSaveNotice("Saved. Review the new content before running.");
    },
    [bridge, workspaceId, recipe, state.selectedRecipeId, setState],
  );

  const saveDraft = useCallback(async () => {
    if (!recipe || draftSource === recipe.source) return;
    await persistSource(draftSource);
  }, [draftSource, persistSource, recipe]);

  // Structured step edit over the draft document, then straight through
  // `mentu.recipe_save` like the fork's inspector save.
  const saveSelectedStep = useCallback(
    async (draft: RecipeStepDraft) => {
      if (!recipe || !savedDocument) {
        setError("Reload the source recipe before saving edits.");
        return;
      }
      if (!selectedNode) {
        setError("Select a step to edit its configuration.");
        return;
      }
      const base = draftSource === recipe.source ? savedDocument : editDocument;
      if (!base) {
        setError(
          draftIssues.length > 0
            ? `Fix or discard the draft source errors before editing steps: ${formatMentuValidationIssues(draftIssues)}`
            : "The draft source cannot be projected for editing; discard it and retry.",
        );
        return;
      }
      const update = updateRecipeStepDocument(base, selectedNode.label, draft);
      if (!update.ok) {
        setError(update.message);
        return;
      }
      const next = stringifyMentuRecipeDocument(update.document);
      setDraftText(next);
      await persistSource(next);
    },
    [
      draftIssues,
      draftSource,
      editDocument,
      persistSource,
      recipe,
      savedDocument,
      selectedNode,
      setDraftText,
    ],
  );

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
    draftSource,
    dirty,
    draftIssues,
    editStep,
    availableBackends,
    inheritBackendLabel,
    editable: savedDocument !== null,
    saveNotice,
    saving,
    setDraftSource,
    discardDraft,
    applyDraft,
    saveDraft,
    saveSelectedStep,
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
