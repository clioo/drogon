// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-inspector.tsx`: the
// selected-node inspector with the reference's DOM, Tailwind classes, copy,
// icons, keyboard handling and ARIA. Adapted only in the data layer: the
// reference edits against an adapter catalog this repo's daemon does not
// expose, so the backend select lists the draft's backends in use (plus the
// daemon default), Model stays on the reference's read-only branch, and the
// draft gains an editable Verify commands field (one command per line)
// because this repo's daemon surfaces `verify.commands` per step.

import { useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
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
import type { MentuRecipeStep } from "./recipe-validation/mentu-recipe-document";
import type { RecipeGraphNode } from "./recipe-graph";
import { draftForRecipeStep, type RecipeStepDraft } from "./recipe-pane-editor";

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

export function SelectedNodeInspector({
  node,
  editStep,
  backends,
  inheritBackendLabel,
  editable,
  disabled,
  saving,
  onSave,
}: {
  node: RecipeGraphNode | null;
  editStep: MentuRecipeStep | null;
  backends: string[];
  inheritBackendLabel: string | null;
  editable: boolean;
  disabled: boolean;
  saving: boolean;
  onSave: (draft: RecipeStepDraft) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState<RecipeStepDraft>(() =>
    editStep ? draftForRecipeStep(editStep) : EMPTY_DRAFT,
  );
  useEffect(() => {
    setDraft(editStep ? draftForRecipeStep(editStep) : EMPTY_DRAFT);
  }, [node?.id, editStep]);

  const backendOptions = useMemo(() => {
    const available = backends;
    return [...new Set(editStep?.backend ? [editStep.backend, ...available] : available)];
  }, [backends, editStep?.backend]);
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
        <div>
          <h2 className="text-sm font-medium">Selected node</h2>
          <p className="text-xs text-muted-foreground">
            Step edits are written back to the Mentu JSON.
          </p>
        </div>
      </div>
      {node && editStep ? (
        <ScrollArea className="min-h-0 flex-1 pr-2">
          <div className="space-y-3">
            <ReadOnlyField label="Node" value={`${node.label} (${node.kind})`} />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Harness / backend</Label>
              <Select
                value={draft.backend || INHERIT_VALUE}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    backend: value === INHERIT_VALUE ? "" : value,
                    model: "",
                  }))
                }
                disabled={disabled || backendOptions.length === 0}
              >
                <SelectTrigger size="sm" aria-label="Harness / backend">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT_VALUE}>
                    Inherit {inheritBackendLabel ?? "Mentu default"}
                  </SelectItem>
                  {backendOptions.map((backend) => (
                    <SelectItem key={backend} value={backend}>
                      {backend}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            <div className="space-y-1.5">
              <Label htmlFor="recipe-step-dependencies" className="text-xs text-muted-foreground">
                Depends on
              </Label>
              <Input
                id="recipe-step-dependencies"
                value={draft.dependencies}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, dependencies: event.target.value }))
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
                    setDraft((current) => ({ ...current, timeout: event.target.value }))
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
                    setDraft((current) => ({ ...current, retries: event.target.value }))
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
                  setDraft((current) => ({ ...current, verifyCommands: event.target.value }))
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
            <Button
              size="sm"
              className="w-full"
              disabled={disabled || saving}
              onClick={() => void onSave(draft)}
            >
              <Save />
              {saving ? "Saving…" : "Save to Mentu JSON"}
            </Button>
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
