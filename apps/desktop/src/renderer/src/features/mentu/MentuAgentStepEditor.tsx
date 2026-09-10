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

import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import type { ApprovedSelectionVerdict } from "./mentu-approved-selection";

const VERDICT_TONE: Record<ApprovedSelectionVerdict["kind"], string> = {
  unavailable: "text-destructive",
  stale: "text-destructive",
  unsupported: "text-destructive",
  unverified: "text-muted-foreground",
};

export function MentuAgentStepEditor({
  backend,
  provider,
  model,
  showProvider,
  verdict,
  disabled,
  onChangeProvider,
  onChangeModel,
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
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="recipe-step-model" className="text-xs text-muted-foreground">
          Model
        </Label>
        <Input
          id="recipe-step-model"
          value={model}
          onChange={(event) => onChangeModel(event.target.value)}
          placeholder="Harness default"
          disabled={disabled}
          className="h-8 text-xs"
          aria-describedby="recipe-step-selection-verdict"
        />
        <p className="text-[11px] text-muted-foreground">
          Exact model id for the {backend} step. Empty uses the harness default; never substituted.
        </p>
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
