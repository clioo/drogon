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
  MentuStepEvidence,
} from "../../../../shared/mentu-contract";
import type { FileBridge } from "../../../../shared/file-contract";
import type { Harness, Session } from "../../../../shared/session-contract";
import type { MentuPaneMode } from "../../../../shared/persistence-contracts/mentu-pane-types";
import {
  composeMentuRunPrompt,
  defaultMentuDispatchDeps,
  describeMentuDispatchFailure,
  dispatchMentuRunPrompt,
  isMentuMainSessionLive,
  type MentuDispatchDeps,
} from "./mentu-run-dispatch";
import { buildRecipeGraph, type RecipeGraph } from "./recipe-graph";
import { subscribeWorkspaceFilesChanged } from "../file-explorer/files-watch";
import { useMentuState } from "./mentu-store";
import { useHarnessCatalog } from "./mentu-harness-catalog";
import type { MentuRuntimeMessageKind } from "./MentuRuntimeMessage";
import type {
  MentuRecipeDefinition,
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
  describeMentuRecipeDirectory,
  invalidMentuRecipes,
  mentuRuntimeNote,
  probeMentuRecipeDirectory,
  probeNestedMentuRecipes,
  type MentuInvalidRecipe,
  type MentuNestedRecipeFinding,
  type MentuRecipeDirectoryStatus,
} from "./recipe-directory-state";
import {
  updateRecipeStepDocument,
  type RecipeStepDraft,
} from "./recipe-pane-editor";

const POLL_INTERVAL_MS = 750;

/** The starter recipe the empty state offers to create: one deterministic
 *  shell step, runnable by the pinned runtime without any model inference. */
export function STARTER_RECIPE(name: string) {
  return {
    name,
    description:
      "Starter recipe created by Drogon. Edit the step, then Review and run.",
    steps: [
      {
        label: "hello",
        backend: "shell",
        prompt: "printf 'Hello from Mentu\\n'",
        timeout: 30,
      },
    ],
  };
}

/** How long the Run Recipe button stays in its "waiting for the agent"
 *  state after the prompt was delivered and before a run row appears. The
 *  agent has to read the skill and invoke `drogon-cli mentu run`; a prompt
 *  the agent declined must not leave a spinner running forever, so this is
 *  a hard bound with an honest notice at the end of it. */
export const MENTU_DISPATCH_HOLD_MS = 90_000;

/** Everything the dispatch path needs from outside the Mentu data layer:
 *  the workspace's main agent session (for display) and the session
 *  transport used to deliver the prompt. */
export type MentuDispatchContext = {
  activeSessionId: string | null;
  mainSession: Session | null;
  deps?: MentuDispatchDeps;
};

/** A prompt that was delivered and whose run row has not been seen yet. */
type MentuPendingDispatch = {
  approvalId: string;
  recipeId: string;
  sessionId: string;
  dispatchedAt: number;
};

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
  /** Re-runs the real recipe-list and runtime-info loads (the header's
   *  refresh affordance). */
  refreshRecipes: () => void;
  /** Absolute workspace root, for showing the real recipes path. */
  workspacePath: string | null;
  /** Observed state of this workspace's `.mentu/recipes` directory
   *  (missing / empty / files / unreadable / unknown), so the empty state
   *  can say which situation the user is actually in. */
  recipesDirectory: MentuRecipeDirectoryStatus;
  directorySummary: string;
  /** Every recipe file the daemon refused, with filename and reason. */
  invalidRecipes: MentuInvalidRecipe[];
  /** Nested `<subproject>/.mentu/recipes` directories found when the root
   *  has none: reported with provenance, never mixed into selection. */
  nestedFindings: MentuNestedRecipeFinding[];
  /** Human path of the workspace's recipe directory (absolute when the
   *  workspace path is known). */
  recipesPathLabel: string;
  /** True when the surface can actually create the starter recipe (real
   *  files write available for this workspace). */
  canCreateStarter: boolean;
  creatingStarter: boolean;
  createStarterError: string | null;
  /** Writes `.mentu/recipes/starter.json` (next free number if taken)
   *  through the real files write, then selects it. */
  createStarterRecipe: () => Promise<void>;
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
  /** Loaded stdio evidence for the current run (null until the daemon
   *  answers); shared across mounts through the store cache. */
  evidence: MentuStepEvidence[] | null;
  evidenceLoading: boolean;
  evidenceError: string | null;
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
  /** The draft (or saved) recipe definition, for the inspector's honest
   *  "observed in this recipe" model quick-pick. Null before a recipe
   *  parses. */
  recipeDefinition: MentuRecipeDefinition | null;
  /** Real registered-harness catalog (`harness.list`) for the inspector's
   *  Harness / backend select — never a Mentu-local guess. */
  harnessCatalog: Harness[];
  harnessCatalogLoading: boolean;
  harnessCatalogError: string | null;
  refreshHarnessCatalog: () => void;
  /** Whether the draft text parses into an editable document at all. */
  editable: boolean;
  saveNotice: string | null;
  saving: boolean;
  setDraftSource: (source: string) => void;
  discardDraft: () => void;
  applyDraft: () => boolean;
  saveDraft: () => Promise<void>;
  saveSelectedStep: (
    draft: RecipeStepDraft,
    stepLabel: string,
  ) => Promise<{ ok: boolean; message: string | null }>;
  busy: boolean;
  operationRunning: boolean;
  error: string | null;
  /** The main agent session the Run Recipe prompt is delivered to, as the
   *  shell last listed it; null when the workspace has none. */
  mainSession: Session | null;
  /** False when there is no main agent session, or the one there is has
   *  exited: Run Recipe will refuse rather than type into it. */
  mainSessionReady: boolean;
  /** A delivered prompt whose run has not been observed yet: the button's
   *  "starting" animation is driven by this, never by a timer. */
  dispatching: boolean;
  /** The delivery itself is in flight (usually: waiting for a busy main
   *  session to reach a state where typing is safe). */
  delivering: boolean;
  /** The honest outcome of the last dispatch (delivered where, or why it
   *  was refused). Never silently cleared without a replacement. */
  dispatchNotice: string | null;
  stageReview: () => void;
  clearReview: () => void;
  approveAndRun: () => Promise<void>;
  retry: () => Promise<void>;
  cancelRun: () => Promise<void>;
};

export function useMentuPaneController(
  bridge: MentuBridge,
  workspaceId: string,
  options: {
    /** Workspace files bridge: powers the empty state's honest directory
     *  probe and the starter-recipe creation. Absent (or the files
     *  capability withheld) degrades to saying less, never to guessing. */
    fileBridge?: FileBridge | null;
    hostId?: string | null;
    workspacePath?: string | null;
    /** The workspace's main agent session plus the transport Run Recipe
     *  delivers its prompt through (see `mentu-run-dispatch`). Absent means
     *  the dispatch path falls back to `window.drogon`, and the no-session
     *  refusal stays honest instead of guessing. */
    dispatchContext?: MentuDispatchContext;
  } = {},
): MentuPaneController {
  const dispatchContext: MentuDispatchContext = options.dispatchContext ?? {
    activeSessionId: null,
    mainSession: null,
  };
  const [state, setState] = useMentuState(workspaceId);
  const harnessCatalog = useHarnessCatalog();
  const [recipes, setRecipes] = useState<MentuRecipeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [recipe, setRecipe] = useState<MentuRecipeDetail | null>(null);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [runtime, setRuntime] = useState<MentuRuntimeInfo | null>(null);
  const [approval, setApproval] = useState<MentuApproval | null>(null);
  const [review, setReview] = useState<MentuReview | null>(null);
  const [pendingDispatch, setPendingDispatch] =
    useState<MentuPendingDispatch | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);
  // Read through a ref so a dispatch always uses the newest deps without
  // re-creating every callback (and re-running every effect) on each render
  // of the shell's session list. Left null until a dispatch needs it, so a
  // renderer without `window.drogon` (jsdom tests) never touches it.
  const dispatchDepsRef = useRef<MentuDispatchDeps | null>(
    dispatchContext.deps ?? null,
  );
  if (dispatchContext.deps) dispatchDepsRef.current = dispatchContext.deps;
  const activeSessionIdRef = useRef(dispatchContext.activeSessionId);
  activeSessionIdRef.current = dispatchContext.activeSessionId;
  const [run, setRun] = useState<MentuRun | null>(null);
  const [runs, setRuns] = useState<MentuRun[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  // The `${runId}:${status}` the cached evidence was loaded for: the
  // status poll replaces the `run` object every 750 ms, and only a new id
  // or a status transition justifies re-reading the evidence files.
  const evidenceLoadedKey = useRef<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Publishes a newly learned run row to the shared store as well as this
  // mount's local state, so the panel and the tab never disagree about run
  // status (see the adoption effect below). A null reset stays local: it
  // only means this mount has not loaded a row yet, never that no run
  // exists for the recipe.
  const updateRun = useCallback(
    (next: MentuRun | null) => {
      setRun(next);
      if (next) setState({ activeRunId: next.id, activeRun: next });
    },
    [setState],
  );
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  // Per-path text drafts, distinct from the saved recipe bytes (the fork's
  // `draftSourceByPath`): switching recipes preserves each open draft, and
  // Save/Discard resolve it against the saved source.
  const [drafts, setDrafts] = useState<MentuDraftState>({ draftSourceByPath: {} });
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  // Bumped by the header's refresh affordance to re-run the load effect
  // below with the exact same real calls the initial mount makes — never
  // a decorative spinner with nothing behind it.
  const [recipesGeneration, setRecipesGeneration] = useState(0);
  const refreshRecipes = useCallback(() => setRecipesGeneration((value) => value + 1), []);

  // The catalog is a property of the DIRECTORY, never a snapshot of the
  // moment this pane mounted. The right-sidebar Mentu panel is a keep-alive
  // mount (App.tsx `mentuPanelAlive`): it is created as soon as the sidebar
  // has a workspace, so a recipe written afterwards by a Bot, a terminal or
  // another editor used to stay invisible in the selector until the app was
  // reloaded — the owner's "I cannot see the recipe I just created". Main's
  // watcher already reports WHICH workspace changed, debounced (R16-L #157,
  // the same live path the Explorer and Source Control read), so this re-runs
  // exactly the load the Refresh affordance runs.
  useEffect(() => {
    if (!workspaceId) return;
    return subscribeWorkspaceFilesChanged(workspaceId, () =>
      setRecipesGeneration((value) => value + 1),
    );
  }, [workspaceId]);

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
  }, [bridge, workspaceId, recipesGeneration]);

  // The empty state names the real situation on disk (missing directory /
  // empty directory / files that failed to parse), so it probes the actual
  // `.mentu/recipes` directory once per recipe-list generation — the same
  // moments the catalog itself reloads.
  const fileBridge = options?.fileBridge ?? null;
  const hostId = options?.hostId ?? null;
  const workspacePath = options?.workspacePath ?? null;
  const [recipesDirectory, setRecipesDirectory] =
    useState<MentuRecipeDirectoryStatus>({ kind: "unknown" });
  useEffect(() => {
    let cancelled = false;
    void probeMentuRecipeDirectory(fileBridge, { hostId, workspaceId }).then(
      (status) => {
        if (!cancelled) setRecipesDirectory(status);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fileBridge, hostId, workspaceId, recipesGeneration]);
  // Nested subproject findings only matter when the root itself has no
  // recipes to show; the effect skips the extra probes otherwise and
  // re-runs with every refresh so the report always reflects reality.
  const [nestedFindings, setNestedFindings] = useState<
    MentuNestedRecipeFinding[]
  >([]);
  const nestedProbeNeeded =
    recipesDirectory.kind === "missing" || recipesDirectory.kind === "empty";
  useEffect(() => {
    if (!nestedProbeNeeded) {
      setNestedFindings([]);
      return;
    }
    let cancelled = false;
    void probeNestedMentuRecipes(fileBridge, { hostId, workspaceId }).then(
      (findings) => {
        if (!cancelled) setNestedFindings(findings);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fileBridge, hostId, workspaceId, recipesGeneration, nestedProbeNeeded]);

  useEffect(() => {
    let cancelled = false;
    setApproval(null);
    setReview(null);
    setRun(null);
    setRuns([]);
    setConflict(null);
    setSaveNotice(null);
    setPendingDispatch(null);
    setDispatchNotice(null);
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
      updateRun(active ?? history[0] ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState/updateRun only publish what the load learned
  }, [bridge, workspaceId, state.selectedRecipeId]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    let cancelled = false;
    const timer = setInterval(() => {
      void bridge.mentuRunStatus({ runId: run.id }).then((result) => {
        if (cancelled || result.ok === false) return;
        updateRun(result.result.run);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateRun only publishes what the poll learned
  }, [bridge, run]);

  // Run adoption after a delegated dispatch. The prompt carries the exact
  // approval id, and the run row records that id, so "which run did my
  // click cause" is answered by the daemon's own data instead of by timing.
  // The button's "starting" animation lives exactly as long as this does,
  // and ends either on a real run row or on the honest timeout notice.
  useEffect(() => {
    if (!pendingDispatch) return;
    let cancelled = false;
    const check = async (): Promise<void> => {
      const result = await bridge.mentuRuns({ workspaceId });
      if (cancelled || !result.ok) return;
      const adopted = result.result.runs.find(
        (entry) =>
          entry.approvalId === pendingDispatch.approvalId &&
          entry.recipeId === pendingDispatch.recipeId,
      );
      if (adopted) {
        setPendingDispatch(null);
        setDispatchNotice(
          `Run ${adopted.id} started by the agent session ${pendingDispatch.sessionId}.`,
        );
        updateRun(adopted);
        return;
      }
      if (Date.now() - pendingDispatch.dispatchedAt >= MENTU_DISPATCH_HOLD_MS) {
        setPendingDispatch(null);
        setError(
          `The prompt was delivered to session ${pendingDispatch.sessionId}, but no Mentu run has appeared for approval ${pendingDispatch.approvalId} yet. Read that session's reply; nothing was auto-approved or auto-run here.`,
        );
      }
    };
    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateRun only publishes what the poll learned
  }, [bridge, workspaceId, pendingDispatch]);

  // Cross-mount run adoption: whichever mount (panel or tab) published
  // `state.activeRun` last wins, provided it names the recipe this mount
  // selected. `setRun` with the identical object is a React no-op, so a
  // mount adopting its own publish converges without loops.
  useEffect(() => {
    const shared = state.activeRun;
    if (shared && shared.recipeId === state.selectedRecipeId) {
      setRun(shared);
    }
  }, [state.activeRun, state.selectedRecipeId]);

  // Stdio evidence for the current run, loaded once per run id (and again
  // on every status transition, so a finished run's files replace the
  // partial ones). A separate `mentu.run_evidence` call — never part of
  // the status poll — mirroring the fork's separate `mentu.run.read`.
  const evidence = run ? (state.evidenceByRunId[run.id] ?? null) : null;
  useEffect(() => {
    if (!run || !run.mentuRunId) return;
    // The step signature is part of the key on purpose: a live run keeps
    // the id AND the `running` status while its finished steps accumulate,
    // so keying on status alone would freeze Evidence at whatever the run
    // looked like when it started.
    const signatures = run.steps.map((step) => step.status).join(",");
    const key = `${run.id}:${run.status}:${run.steps.length}:${signatures}`;
    if (evidenceLoadedKey.current === key) return;
    if (run.status !== "running" && state.evidenceByRunId[run.id] !== undefined) {
      evidenceLoadedKey.current = key;
      return;
    }
    // Older preload builds have no evidence method: the view falls back
    // to path-only rows instead of failing the whole pane.
    if (!bridge.mentuRunEvidence) return;
    let cancelled = false;
    setEvidenceLoading(true);
    setEvidenceError(null);
    void bridge.mentuRunEvidence({ runId: run.id }).then((result) => {
      if (cancelled) return;
      setEvidenceLoading(false);
      if (result.ok) {
        setState({
          evidenceByRunId: { ...state.evidenceByRunId, [run.id]: result.result.evidence },
        });
        evidenceLoadedKey.current = key;
      } else {
        setEvidenceError(result.error.message);
        // A live run's evidence can legitimately not exist yet (the runtime
        // has not referenced a file). Do not pin the failed key: the next
        // step transition retries the read.
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setState is stable per workspace; the key ref guards re-entry
  }, [bridge, run?.id, run?.status, run?.steps.length]);

  const graph = useMemo(
    () => (recipe ? buildRecipeGraph(recipe.steps) : null),
    [recipe],
  );
  const selectedNode = graph?.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
  const validEntries = useMemo(() => recipes.filter((entry) => entry.valid), [recipes]);
  const invalidCount = recipes.length - validEntries.length;
  const invalidRecipes = useMemo(() => invalidMentuRecipes(recipes), [recipes]);
  const directorySummary = useMemo(
    () => describeMentuRecipeDirectory(recipesDirectory, recipes),
    [recipesDirectory, recipes],
  );
  const recipesPathLabel = workspacePath
    ? `${workspacePath.replace(/\/+$/, "")}/.mentu/recipes`
    : ".mentu/recipes";

  // The empty state's way forward: create a real starter recipe in the real
  // directory through the workspace's own files write (it creates parent
  // directories), then select it so the surface immediately shows the
  // graph. Deterministic naming: `starter.json`, then `starter-2.json`, …
  // — never an overwrite of an existing recipe file.
  const [creatingStarter, setCreatingStarter] = useState(false);
  const [createStarterError, setCreateStarterError] = useState<string | null>(
    null,
  );
  const canCreateStarter = fileBridge !== null && hostId !== null;
  const createStarterRecipe = useCallback(async () => {
    if (!fileBridge || hostId === null) return;
    setCreatingStarter(true);
    setCreateStarterError(null);
    try {
      const taken = new Set(recipes.map((recipe) => recipe.id));
      let name = "starter";
      let suffix = 1;
      while (taken.has(`${name}.json`)) {
        suffix += 1;
        name = `starter-${suffix}`;
      }
      const fileName = `${name}.json`;
      const written = await fileBridge.fileWrite({
        hostId,
        workspaceId,
        path: `.mentu/recipes/${fileName}`,
        content: `${JSON.stringify(STARTER_RECIPE(name), null, 2)}\n`,
        requestId: `mentu-starter-${fileName}-${Date.now()}`,
      });
      if (!written.ok) {
        setCreateStarterError(written.error.message);
        return;
      }
      setState({ selectedRecipeId: fileName, selectedNodeId: null });
      setRecipesGeneration((value) => value + 1);
    } finally {
      setCreatingStarter(false);
    }
  }, [fileBridge, hostId, recipes, setState, workspaceId]);

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

  // `Run Recipe`'s first phase. It used to refuse when the draft differed
  // from the saved recipe; a delegated run makes that refusal wrong — the
  // agent runs what is ON DISK, so an unsaved edit would silently run the
  // old bytes. Save first (the real `mentu.recipe_save`), then stage the
  // review from the SAVED detail, so the hash the human approves is the
  // hash the agent will consume.
  const stageReview = useCallback(() => {
    if (!recipe || !state.selectedRecipeId) return;
    setError(null);
    setDispatchNotice(null);
    void (async () => {
      let detail = recipe;
      if (draftSource !== recipe.source) {
        const saved = await persistSourceRef.current(draftSource);
        if (!saved.ok || !saved.recipe) return;
        detail = saved.recipe;
      }
      setReview({
        recipeName: detail.name,
        contentHash: detail.contentHash,
        stepCount: detail.steps.length,
        steps: detail.steps.map((step) => ({ label: step.label, backend: step.backend })),
        runner: runtime?.version ?? runtime?.expectedRevision ?? "unknown",
      });
    })();
  }, [draftSource, recipe, runtime, state.selectedRecipeId]);

  const clearReview = useCallback(() => setReview(null), []);

  // `Approve & run recipe`'s phase: record the human's approval of that
  // exact content, then HAND THE PROMPT TO THE AGENT. The UI no longer
  // calls `mentu.run` itself: the run row has to be created by the agent's
  // `drogon-cli mentu run`, which consumes this approval (the same seam the
  // CLI refuses to short-circuit). The approval id rides the prompt, so the
  // run the agent starts is attributable to this click.
  const approveAndRun = useCallback(async () => {
    if (!recipe || !state.selectedRecipeId || !review) return;
    if (draftSource !== recipe.source) {
      setError("Save or discard your recipe edits before running.");
      return;
    }
    setBusy(true);
    setError(null);
    setDispatchNotice(null);
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
    const prompt = composeMentuRunPrompt({
      workspaceId,
      recipeId: state.selectedRecipeId,
      contentHash: approved.result.approval.contentHash,
      approvalId: approved.result.approval.id,
    });
    setDelivering(true);
    const dispatched = await dispatchMentuRunPrompt(
      dispatchDepsRef.current ?? defaultMentuDispatchDeps(),
      {
        workspaceId,
        activeSessionId: activeSessionIdRef.current,
        prompt,
      },
    );
    setDelivering(false);
    setBusy(false);
    if (!dispatched.ok) {
      // The approval exists but nothing ran. Say exactly that rather than
      // implying a run started; the human can retry after fixing the cause.
      setError(describeMentuDispatchFailure(dispatched.failure));
      return;
    }
    setPendingDispatch({
      approvalId: approved.result.approval.id,
      recipeId: state.selectedRecipeId,
      sessionId: dispatched.sessionId,
      dispatchedAt: Date.now(),
    });
    setDispatchNotice(
      `Prompt delivered to agent session ${dispatched.sessionId}. Waiting for it to start the run…`,
    );
  }, [bridge, workspaceId, recipe, review, draftSource, state.selectedRecipeId]);

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
    async (
      content: string,
      options?: { autosave?: boolean },
    ): Promise<{
      ok: boolean;
      message: string | null;
      recipe: MentuRecipeDetail | null;
    }> => {
      if (!recipe || !state.selectedRecipeId) {
        return { ok: false, message: "No recipe is loaded.", recipe: null };
      }
      if (!bridge.mentuRecipeSave) {
        const message = "Recipe saving is unavailable in this desktop build.";
        setError(message);
        return { ok: false, message, recipe: null };
      }
      setSaving(true);
      // A step autosave must not flip the whole inspector into `busy` (that
      // disables every input mid-typing); an explicit manual save still does.
      if (!options?.autosave) setBusy(true);
      setError(null);
      setSaveNotice(null);
      const saved = await bridge.mentuRecipeSave({
        workspaceId,
        recipeId: state.selectedRecipeId,
        content,
      });
      setSaving(false);
      if (!options?.autosave) setBusy(false);
      if (!saved.ok) {
        setError(saved.error.message);
        return { ok: false, message: saved.error.message, recipe: null };
      }
      setRecipe(saved.result.recipe);
      setDrafts({
        draftSourceByPath: withoutMentuDraftSource(draftsRef.current, recipe.path),
      });
      setState({ draftSource: saved.result.recipe.source });
      // The save invalidated every approval bound to the old hash on the
      // daemon; drop the client-side review/approval too, so running the
      // edited recipe requires a fresh review (the approval seam is not
      // bypassed by autosave).
      setApproval(null);
      setReview(null);
      setConflict(null);
      setSaveNotice("Saved. Review the new content before running.");
      return { ok: true, message: null, recipe: saved.result.recipe };
    },
    [bridge, workspaceId, recipe, state.selectedRecipeId, setState],
  );

  // The staging path runs before `persistSource` is declared, so it reaches
  // it through a ref instead of reordering the whole controller.
  const persistSourceRef = useRef(persistSource);
  persistSourceRef.current = persistSource;

  const saveDraft = useCallback(async () => {
    if (!recipe || draftSource === recipe.source) return;
    await persistSource(draftSource);
  }, [draftSource, persistSource, recipe]);

  // Structured step edit over the draft document, then straight through
  // `mentu.recipe_save` like the fork's inspector save. Returns an explicit
  // result so the inspector's autosave can surface a refusal inline while
  // leaving the last valid JSON on disk untouched.
  const saveSelectedStep = useCallback(
    async (
      draft: RecipeStepDraft,
      stepLabel: string,
    ): Promise<{ ok: boolean; message: string | null }> => {
      if (!recipe || !savedDocument) {
        const message = "Reload the source recipe before saving edits.";
        setError(message);
        return { ok: false, message };
      }
      if (!stepLabel) {
        const message = "Select a step to edit its configuration.";
        setError(message);
        return { ok: false, message };
      }
      // The label is passed explicitly (not read from `selectedNode`): a
      // debounced commit can land after the selection moved.
      const base = draftSource === recipe.source ? savedDocument : editDocument;
      if (!base) {
        const message =
          draftIssues.length > 0
            ? `Fix or discard the draft source errors before editing steps: ${formatMentuValidationIssues(draftIssues)}`
            : "The draft source cannot be projected for editing; discard it and retry.";
        setError(message);
        return { ok: false, message };
      }
      const update = updateRecipeStepDocument(base, stepLabel, draft);
      if (!update.ok) {
        setError(update.message);
        return { ok: false, message: update.message };
      }
      const next = stringifyMentuRecipeDocument(update.document);
      setDraftText(next);
      return await persistSource(next, { autosave: true });
    },
    [
      draftIssues,
      draftSource,
      editDocument,
      persistSource,
      recipe,
      savedDocument,
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
      updateRun(result.result.run);
    } else setError(result.error.message);
  }, [bridge, run, updateRun]);

  const cancelRun = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    const result = await bridge.mentuCancel({ runId: run.id });
    setBusy(false);
    if (result.ok) updateRun(result.result.run);
  }, [bridge, run, updateRun]);

  return {
    workspaceId,
    loading,
    loadingRecipe,
    recipes,
    validEntries,
    invalidCount,
    refreshRecipes,
    workspacePath,
    recipesDirectory,
    directorySummary,
    invalidRecipes,
    nestedFindings,
    recipesPathLabel,
    canCreateStarter,
    creatingStarter,
    createStarterError,
    createStarterRecipe,
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
    evidence,
    evidenceLoading,
    evidenceError,
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
    recipeDefinition: (editDocument ?? savedDocument)?.recipe ?? null,
    harnessCatalog: harnessCatalog.harnesses,
    harnessCatalogLoading: harnessCatalog.loading,
    harnessCatalogError: harnessCatalog.error,
    refreshHarnessCatalog: harnessCatalog.refresh,
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
    mainSession: dispatchContext.mainSession,
    mainSessionReady: isMentuMainSessionLive(dispatchContext.mainSession),
    dispatching: pendingDispatch !== null,
    delivering,
    dispatchNotice,
    stageReview,
    clearReview,
    approveAndRun,
    retry,
    cancelRun,
  };
}
