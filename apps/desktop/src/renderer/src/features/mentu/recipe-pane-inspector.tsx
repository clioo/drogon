// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-inspector.tsx`: the
// selected-node inspector with the reference's DOM, Tailwind classes, copy,
// icons and ARIA. Adapted only in the data layer: this repo's daemon
// exposes no step-editing RPC, so every field renders read-only from the
// loaded `MentuStep` (backend, dependencies, timeout, description,
// declared verify commands) and there is no Save affordance.

import { ShieldCheck } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import type { RecipeGraphNode } from "./recipe-graph";

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
}: {
  node: RecipeGraphNode | null;
}): React.JSX.Element {
  const step = node?.step;
  const verification =
    step && step.verifyCommands.length > 0
      ? `commands: ${step.verifyCommands.join(", ")}`
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
            Step details from the loaded recipe source.
          </p>
        </div>
      </div>
      {node && step ? (
        <div className="space-y-3">
          <ReadOnlyField label="Node" value={`${node.label} (${node.kind})`} />
          <ReadOnlyField label="Harness / backend" value={step.backend} />
          <div className="space-y-1.5">
            <ReadOnlyField label="Model" value="Harness default" />
            <p className="text-[11px] text-muted-foreground">
              Steps carry no model selection in this recipe contract.
            </p>
          </div>
          <ReadOnlyField
            label="Depends on"
            value={step.dependsOn.length > 0 ? step.dependsOn.join(", ") : "None"}
          />
          <div className="grid grid-cols-2 gap-2">
            <ReadOnlyField
              label="Timeout (seconds)"
              value={step.timeoutSeconds?.toString() ?? "Harness default"}
            />
            <ReadOnlyField label="Verification" value={verification} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea
              value={step.description ?? "Not specified"}
              readOnly
              aria-label="Description"
              className="min-h-16 resize-none text-xs"
            />
          </div>
        </div>
      ) : node ? (
        <p className="text-xs text-muted-foreground">
          Child recipes are inspected from their own source file. Select a step to edit runtime
          configuration.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Select a node to inspect its execution contract.
        </p>
      )}
    </section>
  );
}
