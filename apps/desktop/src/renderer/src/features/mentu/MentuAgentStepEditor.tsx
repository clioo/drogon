// MIT Copyright (c) 2026 Lovecast Inc.
// C03 agent-step execution editor: the executable harness/model selector
// for one selected agent step. It edits the inspector draft's `provider`
// (selection-layer only: the Pi providers-map binding name, never
// inferred) and `model` (the step's exact model id) and renders the
// selection verdict distinctly — unavailable, stale, unsupported or
// manual-unverified — with the reason inline instead of a bare label.
// DOM, Tailwind classes and copy follow the surrounding
// `recipe-pane-inspector.tsx` (ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-inspector.tsx`); only
// the Model field changes from read-only to editable, and only for
// agent steps. Shell steps keep the reference's read-only branch in the
// inspector and never mount this editor.
//
// Live catalog edition: the quick-pick combobox, its status line, the
// provenance row and the per-model notes are driven by the daemon's real
// `harness.models` answer (projected by `mentu-model-registry.ts`) —
// host-enumerated entries (the only verified ones), then recipe-observed
// ids ("from this recipe", unverified). The free-text Input stays the
// single source of truth for the model id itself; a typed id that the
// host did not enumerate is never silently confirmed.

import { Cpu, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type { ApprovedSelectionVerdict } from "./mentu-approved-selection";
import type { ModelCatalogReadout, ModelOption } from "./mentu-model-registry";

const VERDICT_TONE: Record<ApprovedSelectionVerdict["kind"], string> = {
  unavailable: "text-destructive",
  stale: "text-destructive",
  unsupported: "text-destructive",
  unverified: "text-muted-foreground",
};

const MODEL_DEFAULT_VALUE = "__harness_default__";
/** No `SelectItem` ever carries this value, so the trigger always falls
 *  back to its placeholder text: this select is a one-shot quick-pick
 *  menu, not a persistent value display (the Input beside it is that). */
const QUICK_PICK_TRIGGER_VALUE = "__quick_pick_trigger__";

export function MentuAgentStepEditor({
  backend,
  provider,
  model,
  showProvider,
  verdict,
  disabled,
  onChangeProvider,
  onChangeModel,
  modelOptions = [],
  catalogReadout = null,
  onRefreshCatalog,
}: {
  /** Effective backend the step executes with (draft, step, root, shell). */
  backend: string;
  /** Pi providers-map binding name; selection-layer only, not a recipe field. */
  provider: string;
  /** Exact model id; empty means the harness default. */
  model: string;
  /** True for pi-family backends, the only ones with a provider binding. */
  showProvider: boolean;
  verdict: ApprovedSelectionVerdict;
  disabled: boolean;
  onChangeProvider: (provider: string) => void;
  onChangeModel: (model: string) => void;
  /** Combobox options projected from the real daemon catalog (verified
   *  host-enumerated ids) plus the open recipe's own observed ids;
   *  empty when neither source has anything to offer. */
  modelOptions?: ModelOption[];
  /** The honest status/provenance readout for the current catalog state;
   *  omitted (never a fabricated default) when the caller has nothing. */
  catalogReadout?: ModelCatalogReadout | null;
  onRefreshCatalog?: () => void;
}): React.JSX.Element {
  const hasQuickPicks = modelOptions.length > 0;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="recipe-step-model" className="text-xs text-muted-foreground">
            Model
          </Label>
          <span className="text-[10px] text-muted-foreground">recipe contract</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            id="recipe-step-model"
            value={model}
            onChange={(event) => onChangeModel(event.target.value)}
            placeholder="Harness default"
            disabled={disabled}
            className="h-8 text-xs"
            aria-describedby="recipe-step-selection-verdict"
          />
          {hasQuickPicks ? (
            <Select
              value={QUICK_PICK_TRIGGER_VALUE}
              onValueChange={(value) =>
                onChangeModel(value === MODEL_DEFAULT_VALUE ? "" : value)
              }
              disabled={disabled}
            >
              <SelectTrigger
                size="sm"
                className="h-8 w-auto shrink-0 text-[11px]"
                aria-label="Model quick pick"
              >
                <SelectValue placeholder="Models" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MODEL_DEFAULT_VALUE}>
                  default <span className="ml-2 text-muted-foreground">harness default</span>
                </SelectItem>
                {modelOptions.map((option) => (
                  <SelectItem key={`${option.group}:${option.id}`} value={option.id}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{option.id}</span>
                      {option.id === model ? " ✓" : ""}
                      {option.recommended ? (
                        <span className="shrink-0 text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400">
                          recommended
                        </span>
                      ) : null}
                      <span className="truncate text-[10px] text-muted-foreground">
                        {option.notes.join(" · ")}
                        {option.group === "observed" ? " · unverified" : ""}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {onRefreshCatalog ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              onClick={onRefreshCatalog}
              aria-label="Refresh model catalog"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Exact model id for the {backend} step. Empty uses the harness default; never substituted.
        </p>
        {catalogReadout ? (
          <p
            className={`text-[11px] ${catalogReadout.stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
            data-testid="model-catalog-status"
          >
            {catalogReadout.statusLine}
          </p>
        ) : null}
        {catalogReadout?.provenanceLine ? (
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="model-catalog-provenance"
          >
            {catalogReadout.provenanceLine}
          </p>
        ) : null}
        {catalogReadout?.noteLine ? (
          <p className="text-[11px] italic text-muted-foreground" data-testid="model-catalog-note">
            {catalogReadout.noteLine}
          </p>
        ) : null}
      </div>
      {showProvider ? (
        <div className="space-y-1.5">
          <Label htmlFor="recipe-step-provider" className="text-xs text-muted-foreground">
            Provider binding
          </Label>
          <Input
            id="recipe-step-provider"
            value={provider}
            onChange={(event) => onChangeProvider(event.target.value)}
            placeholder="e.g. kimi-coding"
            disabled={disabled}
            className="h-8 text-xs"
            aria-describedby="recipe-step-selection-verdict"
          />
          <p className="text-[11px] text-muted-foreground">
            Names the recipe providers entry carrying the base URL, exact model and one
            credential source. Never inferred from the harness name.
          </p>
        </div>
      ) : null}
      <p
        id="recipe-step-selection-verdict"
        role="status"
        className={`text-[11px] ${VERDICT_TONE[verdict.kind]}`}
      >
        {verdict.reason}
      </p>
    </div>
  );
}
