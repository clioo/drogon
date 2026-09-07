// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/renderer/src/components/mentu/RecipePaneHeader.tsx`: the wide-tab
// header with the reference's DOM, Tailwind classes, copy, icons, keyboard
// and ARIA. Only the controller type is adapted (this repo's
// `MentuPaneController` over the mentu.* daemon RPCs).

import { AlertCircle, Network } from "lucide-react";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { MentuRuntimeMessage } from "./MentuRuntimeMessage";
import type { MentuPaneController } from "./recipe-pane-controller";

export function RecipePaneHeader({
  controller,
}: {
  controller: MentuPaneController;
}): React.JSX.Element {
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">Mentu</h1>
            <p className="truncate text-xs text-muted-foreground">
              Workspace source: .mentu/recipes
            </p>
          </div>
        </div>
        <div className="ml-auto flex min-w-[220px] items-center gap-2">
          <Label htmlFor="recipe-selector" className="sr-only">
            Recipe
          </Label>
          <Select
            value={controller.selectedRecipeId ?? ""}
            onValueChange={(value) => controller.setSelectedRecipeId(value || null)}
            disabled={
              controller.loading || controller.busy || controller.validEntries.length === 0
            }
          >
            <SelectTrigger id="recipe-selector" size="sm" className="min-w-0 flex-1">
              <SelectValue
                placeholder={controller.loading ? "Discovering recipes…" : "Select a recipe"}
              />
            </SelectTrigger>
            <SelectContent>
              {controller.validEntries.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name ?? entry.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {controller.runtimeMessage ? (
        <div
          className="flex shrink-0 items-start gap-2 border-b border-border bg-card px-4 py-3 text-xs text-muted-foreground"
          role={
            ["invalid", "execution-failed"].includes(controller.runtimeMessageKind)
              ? "alert"
              : "status"
          }
          data-testid="recipe-runtime-status"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <MentuRuntimeMessage
            kind={controller.runtimeMessageKind}
            message={controller.runtimeMessage}
            onOpenEvidence={() => controller.setMode("evidence")}
          />
        </div>
      ) : null}
    </>
  );
}
