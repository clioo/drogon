// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/renderer/src/components/mentu/RecipePaneHeader.tsx`: the wide-tab
// header with the reference's DOM, Tailwind classes, copy, icons, keyboard
// and ARIA. Only the controller type is adapted (this repo's
// `MentuPaneController` over the mentu.* daemon RPCs).
//
// Target-design additions (owner-supplied mockup): an "Active Workspace"
// chip beside the title (true for every render — this panel only ever
// shows the workspace the shell handed it), a refresh icon button that
// re-loads the recipe list and the current recipe (real network calls,
// not decorative), and a prominent "Run Recipe" primary button in the
// app's destructive/red accent. The button reuses the EXACT same
// review -> approve & run state machine `RunControls` already drives
// (`controller.review`/`stageReview`/`approveAndRun`) so it is a second
// entry point into real, already-gated behavior, never a parallel path.

import { AlertCircle, Network, Play, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
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
  const runtimeAvailable =
    controller.runtime?.available === true && controller.runtime?.lockMatches === true;
  const runDisabled =
    controller.busy ||
    controller.saving ||
    controller.operationRunning ||
    !controller.recipe ||
    controller.graph?.valid !== true ||
    !runtimeAvailable;
  const runLabel = controller.review ? "Approve & run recipe" : "Run Recipe";
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-medium">Mentu</h1>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                Active Workspace
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              Workspace source: .mentu/recipes
            </p>
          </div>
        </div>
        {/* Why min(220px,100%): the fork pins this cluster at 220px, but
            this surface can legitimately be narrower (Mentu as a tab with
            both sidebars open); below 220px the cluster becomes the column
            width and wraps instead of escaping the surface. */}
        <div className="ml-auto flex min-w-[min(220px,100%)] flex-wrap items-center gap-2">
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
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={controller.loading || controller.busy}
            onClick={() => controller.refreshRecipes()}
            aria-label="Refresh recipes"
          >
            <RefreshCw className={`size-3.5 ${controller.loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={runDisabled}
            data-testid="mentu-run-recipe"
            onClick={() =>
              controller.review ? void controller.approveAndRun() : controller.stageReview()
            }
          >
            <Play />
            {runLabel}
          </Button>
        </div>
      </div>
      {controller.dirty ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2"
          data-testid="recipe-draft-status"
        >
          <Badge variant="secondary">Unsaved changes</Badge>
          <p className="text-xs text-muted-foreground">
            The draft differs from the saved recipe. Saving requires a fresh review before running.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => controller.discardDraft()}
              disabled={controller.busy || controller.saving}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => void controller.saveDraft()}
              disabled={controller.busy || controller.saving}
            >
              {controller.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
      {controller.selectedRecipeId && controller.invalidRecipes.length > 0 ? (
        // Why: a recipe file the daemon refuses must never be silently
        // skipped just because a valid recipe happens to be selected —
        // this banner names every refused file with its reason, in the
        // user's own workspace terms.
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground"
          role="status"
          data-testid="recipe-invalid-banner"
        >
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {controller.invalidRecipes
              .map((recipe) => `${recipe.path} — ${recipe.issue}`)
              .join(" · ")}
          </span>
        </div>
      ) : null}
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
