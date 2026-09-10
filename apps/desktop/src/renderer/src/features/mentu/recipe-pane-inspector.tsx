// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-inspector.tsx`: the
// selected-node inspector with the reference's DOM, Tailwind classes, copy,
// icons, keyboard handling and ARIA. Adapted only in the data layer: the
// reference edits against an adapter catalog this repo's daemon does not
// expose, so the backend select lists the draft's backends in use (plus the
// daemon default and, when supplied, the real registered-harness catalog
// from `harness.list` — see `harnessCatalog` below); the Model field stays
// on the reference's read-only branch for shell steps, while agent steps
// mount `MentuAgentStepEditor` (editable exact model id, Pi-only provider
// binding, selection verdict, live model catalog quick-pick driven by the
// daemon's real `harness.models` probe — host-enumerated entries only are
// verified; recipe-observed ids stay marked "from this recipe"),
// agent-gated like the daemon (`updateRecipeStepDocument` refuses a model
// on a shell-effective step); and the draft gains an editable Verify
// commands field (one command per line) because this repo's daemon
// surfaces `verify.commands` per step.
//
// Target-design additions (owner-supplied mockup): a lock glyph marks the
// read-only Node identity, a link glyph marks Depends on, and a
// "JSON synced" chip reflects real save state (derived from `saving` plus
// a local comparison of the in-progress draft against the step's saved
// values — never a decorative always-on chip). The Harness / backend
// field renders a real catalog (`harnessCatalog`, `harnessCatalogLoading`,
// `harnessCatalogError`, `onRefreshHarnessCatalog` — all optional so
// existing callers/tests that only pass `backends: string[]` keep
// rendering exactly as before).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Link2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import type { Harness, HarnessModelsCatalog } from "../../../../shared/session-contract";
import type {
  MentuRecipeDefinition,
  MentuRecipeStep,
} from "./recipe-validation/mentu-recipe-document";
import type { RecipeGraphNode } from "./recipe-graph";
import { draftForRecipeStep, stepDraftsEqual, type RecipeStepDraft } from "./recipe-pane-editor";
import { MentuAgentStepEditor } from "./MentuAgentStepEditor";
import {
  modelCatalogReadout,
  modelOptionsFromCatalog,
} from "./mentu-model-registry";
import { isRegisteredHarness, useMentuModelCatalog } from "./mentu-model-catalog";
import {
  classifySelection,
  conflictMessage,
  type ApprovedSelectionVerdict,
  type SaveConflict,
} from "./mentu-approved-selection";

const INHERIT_VALUE = "__inherit__";

const EMPTY_DRAFT: RecipeStepDraft = {
  backend: "",
  model: "",
  dependencies: "",
  timeout: "",
  retries: "",
  verifyCommands: "",
};

function ReadOnlyField({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} readOnly aria-label={label} className="h-8 text-xs" />
    </div>
  );
}

/** True harness availability text, no invention: mirrors
 *  `HarnessAvailability` verbatim rather than collapsing it to a bare
 *  "available"/"not available" binary. */
function availabilityLabel(availability: Harness["availability"]): string {
  switch (availability) {
    case "available":
      return "Engine registered";
    case "missing":
      return "Not installed on this host";
    case "unsupported_launcher":
      return "Unsupported launcher on this OS";
    default:
      return availability;
  }
}

export function SelectedNodeInspector({
  node,
  editStep,
  backends,
  inheritBackendLabel,
  editable,
  disabled,
  saving,
  onCommit,
  runtimeAvailable = true,
  runtimeMessage = null,
  loadedHash = null,
  currentHash = null,
  daemonRefusal = null,
  saveConflict = null,
  onReloadRecipe,
  onReviewCurrent,
  harnessCatalog,
  harnessCatalogLoading = false,
  harnessCatalogError = null,
  onRefreshHarnessCatalog,
  modelCatalog,
  modelCatalogLoading = false,
  modelCatalogError = null,
  onRefreshModelCatalog,
  recipeDefinition = null,
}: {
  node: RecipeGraphNode | null;
  editStep: MentuRecipeStep | null;
  backends: string[];
  inheritBackendLabel: string | null;
  editable: boolean;
  disabled: boolean;
  saving: boolean;
  /** Persist one step draft. Resolves with an explicit result so the
   *  autosave shows a validation/write error inline and never claims a
   *  save it did not make. `stepLabel` is explicit because a selection
   *  change can race the debounce. */
  onCommit: (
    draft: RecipeStepDraft,
    stepLabel: string,
  ) => Promise<{ ok: boolean; message: string | null }>;
  /** Renderer-held selection inputs for the verdict; all optional until
   *  the controller wires them — absent data renders manual-unverified,
   *  never a confirmation. */
  runtimeAvailable?: boolean;
  runtimeMessage?: string | null;
  loadedHash?: string | null;
  currentHash?: string | null;
  daemonRefusal?: string | null;
  /** Stale-save conflict: the draft is preserved; the panel offers
   *  reload/review choices instead of overwriting. */
  saveConflict?: SaveConflict | null;
  onReloadRecipe?: () => void;
  onReviewCurrent?: () => void;
  /** Real registered-harness catalog (`harness.list`), when the caller
   *  supplies one. Omitted keeps the select exactly as before (backends
   *  in use only) — existing callers/tests are unaffected. */
  harnessCatalog?: Harness[];
  harnessCatalogLoading?: boolean;
  harnessCatalogError?: string | null;
  onRefreshHarnessCatalog?: () => void;
  /** Override for the live per-harness model catalog (`harness.models`):
   *  when provided (even as null), it replaces the inspector's own fetch
   *  for the status/quick-pick (tests, preloaded answers). Omitted, the
   *  inspector probes the live catalog itself, keyed on the effective
   *  backend the draft would actually run with. */
  modelCatalog?: HarnessModelsCatalog | null;
  modelCatalogLoading?: boolean;
  modelCatalogError?: string | null;
  onRefreshModelCatalog?: () => void;
  /** The loaded/edited recipe document, for the honest "observed in this
   *  recipe" model quick-pick. Null renders no observed models. */
  recipeDefinition?: MentuRecipeDefinition | null;
}): React.JSX.Element {
  const [draft, setDraft] = useState<RecipeStepDraft>(() =>
    editStep ? draftForRecipeStep(editStep) : EMPTY_DRAFT,
  );
  // Pi providers-map binding name: selection-layer only (the approval
  // binding carries it), never a recipe field, so it lives beside the
  // draft rather than inside it.
  const [provider, setProvider] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitSaving, setCommitSaving] = useState(false);

  // --- Autosave ---------------------------------------------------------
  // The draft is the editor's source of truth; `committedRef` is the last
  // draft the daemon accepted for THIS node. A debounce coalesces keystrokes,
  // blur/Enter force a flush, and a selection change flushes the previous
  // node's edit before adopting the new one. A refused write (invalid draft
  // or daemon error) keeps the draft and shows the message; the last valid
  // JSON on disk is untouched.
  const AUTOSAVE_DELAY_MS = 400;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const committedRef = useRef<RecipeStepDraft>(
    editStep ? draftForRecipeStep(editStep) : EMPTY_DRAFT,
  );
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const labelRef = useRef<string | null>(node?.label ?? null);
  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);

  const runCommit = useCallback(async () => {
    const label = labelRef.current;
    if (!label || !editable) return;
    if (stepDraftsEqual(draftRef.current, committedRef.current)) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    pendingRef.current = false;
    const generation = generationRef.current;
    const snapshot = draftRef.current;
    setCommitSaving(true);
    const result = await onCommitRef.current(snapshot, label);
    inFlightRef.current = false;
    if (pendingRef.current) {
      pendingRef.current = false;
      void runCommit();
    }
    // A selection change moved on: the old node's write already landed (or
    // failed) on disk, and the new node owns the UI state now.
    if (generationRef.current !== generation) return;
    setCommitSaving(false);
    if (result.ok) {
      committedRef.current = snapshot;
      setCommitError(null);
    } else {
      setCommitError(result.message);
    }
  }, [editable]);

  const scheduleCommit = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runCommit();
    }, AUTOSAVE_DELAY_MS);
  }, [runCommit]);

  const flushCommit = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void runCommit();
  }, [runCommit]);

  const updateDraft = useCallback(
    (updater: (current: RecipeStepDraft) => RecipeStepDraft) => {
      const next = updater(draftRef.current);
      draftRef.current = next;
      setDraft(next);
      setCommitError(null);
      scheduleCommit();
    },
    [scheduleCommit],
  );

  // Selection change: flush the previous node's dirty draft (its label is
  // still captured), then adopt the newly selected node's saved values.
  useEffect(() => {
    generationRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void runCommit();
    const initial = editStep ? draftForRecipeStep(editStep) : EMPTY_DRAFT;
    committedRef.current = initial;
    draftRef.current = initial;
    labelRef.current = node?.label ?? null;
    setDraft(initial);
    setProvider("");
    setCommitError(null);
    pendingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editStep is read at switch time only
  }, [node?.id]);

  // Adopt external recipe updates (e.g. a source-editor edit) only while
  // there are no unsaved local edits, so a slow commit never clobbers typing.
  useEffect(() => {
    if (inFlightRef.current) return;
    if (!stepDraftsEqual(draftRef.current, committedRef.current)) return;
    const incoming = editStep ? draftForRecipeStep(editStep) : EMPTY_DRAFT;
    committedRef.current = incoming;
    draftRef.current = incoming;
    setDraft(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStep]);

  const onContainerKeyDown = (event: React.KeyboardEvent): void => {
    // Enter commits like the fork's single-field affordances; textareas keep
    // Enter for newlines (verify commands are one per line).
    if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      flushCommit();
    }
  };

  const backendOptions = useMemo(() => {
    const available = backends;
    return [...new Set(editStep?.backend ? [editStep.backend, ...available] : available)];
  }, [backends, editStep?.backend]);
  const registeredHarnesses = harnessCatalog ?? [];
  const registeredIds = useMemo(
    () => new Set(registeredHarnesses.map((harness) => harness.harnessId)),
    [registeredHarnesses],
  );
  // Backend strings the recipe already uses that are not one of Drogon's
  // registered harnesses (e.g. `shell`, or a Pi providers-map alias) —
  // rendered plainly, exactly like the pre-catalog select did.
  const unregisteredBackendOptions = backendOptions.filter(
    (backend) => !registeredIds.has(backend as Harness["harnessId"]),
  );
  // The backend the step executes with after this edit — the same inherit
  // chain the daemon's snapshot records. Only non-shell steps mount the
  // agent editor; shell steps keep the reference's read-only branch.
  const effectiveBackend =
    draft.backend || editStep?.backend || inheritBackendLabel || "shell";
  const isAgentStep = effectiveBackend.toLowerCase() !== "shell";
  const showProvider =
    isAgentStep &&
    (effectiveBackend.toLowerCase() === "pi" || provider !== "");
  const verdict: ApprovedSelectionVerdict = classifySelection({
    runtimeAvailable,
    runtimeMessage,
    loadedHash,
    currentHash,
    daemonRefusal,
  });
  const selectedHarness = registeredHarnesses.find(
    (harness) => harness.harnessId === effectiveBackend.toLowerCase(),
  );
  // Live model catalog projection: combobox options from the daemon's
  // real enumeration plus the recipe's own observed ids, and the honest
  // status/provenance readout (real counts, real provenance, honest
  // empty/failure/stale states). The fetch lives here — keyed on the
  // draft-effective backend, so a harness switch re-probes exactly the
  // harness the step would run with. An explicit `modelCatalog` prop
  // (tests, preloaded answers) replaces it whole.
  const backendRegistered = isRegisteredHarness(effectiveBackend);
  const liveModelCatalog = useMentuModelCatalog(backendRegistered ? effectiveBackend : "");
  const catalogOverride = modelCatalog !== undefined;
  const resolvedModelCatalog = catalogOverride
    ? (modelCatalog ?? null)
    : liveModelCatalog.catalog;
  const resolvedCatalogLoading =
    modelCatalogLoading || (!catalogOverride && liveModelCatalog.loading);
  const resolvedCatalogError = catalogOverride
    ? modelCatalogError
    : liveModelCatalog.error;
  const resolvedRefreshCatalog = onRefreshModelCatalog ??
    (!catalogOverride ? liveModelCatalog.refresh : undefined);
  const modelOptions = useMemo(
    () =>
      modelOptionsFromCatalog({
        catalog: resolvedModelCatalog,
        recipe: recipeDefinition,
        harness: effectiveBackend,
        excludeStepLabel: node?.label ?? null,
      }),
    [resolvedModelCatalog, recipeDefinition, effectiveBackend, node?.label],
  );
  const catalogReadout = useMemo(
    () =>
      modelCatalogReadout({
        catalog: resolvedModelCatalog,
        loading: resolvedCatalogLoading,
        error: resolvedCatalogError,
        harness: effectiveBackend,
        registered: backendRegistered,
        now: Date.now(),
        selectedModel: draft.model,
        knownCount: modelOptions.filter((option) => option.group === "known").length,
      }),
    [resolvedModelCatalog, resolvedCatalogLoading, resolvedCatalogError, backendRegistered, effectiveBackend, draft.model, modelOptions],
  );
  // Real save-state chip: a refused write wins (an invalid draft must never
  // read "synced"), then in-flight, then unsaved, else synced — never a
  // decorative always-on badge.
  const stepDirty =
    editStep !== null && !stepDraftsEqual(draft, committedRef.current);
  const syncChip = commitError
    ? { label: "Not saved — invalid", tone: "text-destructive" }
    : saving || commitSaving
      ? { label: "Saving…", tone: "text-muted-foreground" }
      : stepDirty
        ? { label: "Unsaved edits", tone: "text-amber-600 dark:text-amber-400" }
        : { label: "JSON synced", tone: "text-emerald-600 dark:text-emerald-400" };
  const verification = editStep?.verify
    ? [
        ...(editStep.verify.commands?.length
          ? [`commands: ${editStep.verify.commands.join(", ")}`]
          : []),
        ...(editStep.verify.grep_present?.length
          ? [`grep present: ${editStep.verify.grep_present.length}`]
          : []),
        ...(editStep.verify.grep_absent?.length
          ? [`grep absent: ${editStep.verify.grep_absent.length}`]
          : []),
        ...(editStep.verify.file_absent?.length
          ? [`file absent: ${editStep.verify.file_absent.length}`]
          : []),
      ].join(" · ") || "Configured"
    : "Not configured";

  return (
    <section
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-card p-3"
      data-testid="recipe-node-inspector"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">Selected node</h2>
          <p className="text-xs text-muted-foreground">
            Step edits are written back to the Mentu JSON.
          </p>
        </div>
        {node && editStep ? (
          <Badge
            variant="outline"
            data-testid="mentu-json-sync-chip"
            className={`shrink-0 gap-1 text-[10px] ${syncChip.tone}`}
          >
            <CheckCircle2 className="size-3" aria-hidden />
            {syncChip.label}
          </Badge>
        ) : null}
      </div>
      {node && editStep ? (
        <ScrollArea className="min-h-0 flex-1 pr-2">
          <div className="space-y-3" onKeyDown={onContainerKeyDown} onBlur={flushCommit}>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Node</Label>
              <div className="relative">
                <Input
                  value={`${node.label} (${node.kind})`}
                  readOnly
                  aria-label="Node"
                  className="h-8 pr-7 text-xs"
                />
                <Lock
                  className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Harness / backend</Label>
                {selectedHarness ? (
                  <span className="text-[10px] text-muted-foreground">
                    {availabilityLabel(selectedHarness.availability)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  value={draft.backend || INHERIT_VALUE}
                  onValueChange={(value) => {
                    // A backend change restarts the execution selection:
                    // the model and provider binding belong to the old one.
                    updateDraft((current) => ({
                      ...current,
                      backend: value === INHERIT_VALUE ? "" : value,
                      model: "",
                    }));
                    setProvider("");
                  }}
                  disabled={disabled || (backendOptions.length === 0 && registeredHarnesses.length === 0)}
                >
                  <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Harness / backend">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_VALUE}>
                      Inherit {inheritBackendLabel ?? "Mentu default"}
                    </SelectItem>
                    {registeredHarnesses.map((harness) => (
                      <SelectItem key={harness.harnessId} value={harness.harnessId}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{harness.displayName}</span>
                          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                            CLI
                          </Badge>
                          {harness.availability !== "available" ? (
                            <span className="text-[10px] text-muted-foreground">
                              ({availabilityLabel(harness.availability)})
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                    {unregisteredBackendOptions.map((backend) => (
                      <SelectItem key={backend} value={backend}>
                        {backend}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {onRefreshHarnessCatalog ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled || harnessCatalogLoading}
                    onClick={onRefreshHarnessCatalog}
                    aria-label="Refresh harness catalog"
                  >
                    <RefreshCw
                      className={`size-3.5 ${harnessCatalogLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                ) : null}
              </div>
              {harnessCatalogError ? (
                <p className="text-[11px] text-destructive" role="status">
                  Harness catalog unavailable: {harnessCatalogError}
                </p>
              ) : null}
            </div>
            {isAgentStep ? (
              <MentuAgentStepEditor
                backend={effectiveBackend}
                provider={provider}
                model={draft.model}
                showProvider={showProvider}
                verdict={verdict}
                disabled={disabled}
                onChangeProvider={setProvider}
                onChangeModel={(model) =>
                  updateDraft((current) => ({ ...current, model }))
                }
                modelOptions={modelOptions}
                catalogReadout={catalogReadout}
                onRefreshCatalog={resolvedRefreshCatalog}
              />
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="recipe-step-model" className="text-xs text-muted-foreground">
                  Model
                </Label>
                <Input
                  id="recipe-step-model"
                  value={editStep.model ?? "Harness default"}
                  readOnly
                  className="h-8 text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Steps carry no model selection in this recipe contract.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="recipe-step-dependencies" className="text-xs text-muted-foreground">
                <Link2 className="mr-1 inline size-3" aria-hidden />
                Depends on
              </Label>
              <Input
                id="recipe-step-dependencies"
                value={draft.dependencies}
                onChange={(event) =>
                  updateDraft((current) => ({ ...current, dependencies: event.target.value }))
                }
                placeholder="build, frontend"
                disabled={disabled}
                className="h-8 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="recipe-step-timeout" className="text-xs text-muted-foreground">
                  Timeout (seconds)
                </Label>
                <Input
                  id="recipe-step-timeout"
                  inputMode="numeric"
                  value={draft.timeout}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, timeout: event.target.value }))
                  }
                  disabled={disabled}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="recipe-step-retries" className="text-xs text-muted-foreground">
                  Retries
                </Label>
                <Input
                  id="recipe-step-retries"
                  inputMode="numeric"
                  value={draft.retries}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, retries: event.target.value }))
                  }
                  disabled={disabled}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <ReadOnlyField
              label="Completion"
              value={editStep.completion_keyword ?? "Harness default"}
            />
            <ReadOnlyField label="Verification" value={verification} />
            <div className="space-y-1.5">
              <Label htmlFor="recipe-step-verify-commands" className="text-xs text-muted-foreground">
                Verify commands
              </Label>
              <Textarea
                id="recipe-step-verify-commands"
                value={draft.verifyCommands}
                onChange={(event) =>
                  updateDraft((current) => ({ ...current, verifyCommands: event.target.value }))
                }
                placeholder="test -f out.txt"
                aria-label="Verify commands"
                disabled={disabled}
                className="min-h-16 resize-y font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">One command per line.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Expected changes</Label>
              <Textarea
                value={editStep.expected_changes?.join("\n") ?? "Not specified"}
                readOnly
                aria-label="Expected changes"
                className="min-h-16 resize-none text-xs"
              />
            </div>
            {commitError ? (
              <p
                role="alert"
                data-testid="mentu-step-save-error"
                className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-[11px] text-destructive"
              >
                Not saved — the recipe JSON on disk is unchanged. {commitError}
              </p>
            ) : null}
            {saveConflict ? (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-2.5"
              >
                <p className="text-xs text-destructive">
                  {conflictMessage(saveConflict)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {onReloadRecipe ? (
                    <Button size="sm" variant="outline" onClick={onReloadRecipe}>
                      Reload recipe
                    </Button>
                  ) : null}
                  {onReviewCurrent ? (
                    <Button size="sm" variant="ghost" onClick={onReviewCurrent}>
                      Review current source
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      ) : node ? (
        <p className="text-xs text-muted-foreground">
          {editable
            ? "The draft source has errors; fix or discard it before editing steps."
            : "This recipe's source cannot be edited structurally. Fix its validation errors in the source JSON."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Select a node to inspect its execution contract.
        </p>
      )}
    </section>
  );
}
