// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/MentuPanel.tsx`: the Mentu
// right-sidebar panel with the reference's DOM, Tailwind classes, copy,
// icons, keyboard and ARIA. Adapted only in the data layer: state comes
// from this repo's `MentuPaneController` (mentu.* daemon RPCs through the
// bridge plus the shared features/mentu store), so the panel and the wide
// tab stay in sync. The reference's session-scope card has no counterpart
// in this repo's model; the header keeps the workspace-source line instead.
// `variant="tab"` renders the wide tab surface; both read/write the same
// shared state.

import { ExternalLink, Network, Settings2 } from "lucide-react";
import type { MentuBridge } from "../../../../shared/mentu-contract";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { MentuRuntimeMessage } from "./MentuRuntimeMessage";
import { RecipePane } from "./RecipePane";
import { useMentuPaneController } from "./recipe-pane-controller";
import { EvidenceView, GraphView } from "./recipe-pane-views";
import { RunControls } from "./recipe-pane-run-controls";

export type MentuPanelProps = {
  bridge: MentuBridge;
  workspaceId: string;
  variant?: "panel" | "tab";
  /** Opens the wide Mentu tab. Defaults to a `drogon:open-mentu-tab`
   *  window event the shell may listen for. */
  onOpenFullTab?: () => void;
};

export const MENTU_OPEN_TAB_EVENT = "drogon:open-mentu-tab";

export function MentuPanel({
  bridge,
  workspaceId,
  variant = "panel",
  onOpenFullTab,
}: MentuPanelProps) {
  if (variant === "tab") {
    return <RecipePane bridge={bridge} workspaceId={workspaceId} />;
  }
  return <MentuPanelBody bridge={bridge} workspaceId={workspaceId} onOpenFullTab={onOpenFullTab} />;
}

function MentuPanelBody({
  bridge,
  workspaceId,
  onOpenFullTab,
}: {
  bridge: MentuBridge;
  workspaceId: string;
  onOpenFullTab?: () => void;
}) {
  const controller = useMentuPaneController(bridge, workspaceId);
  const showingEvidence = controller.mode === "evidence";
  const runtimeAvailable =
    controller.runtime?.available === true && controller.runtime?.lockMatches === true;

  const openNativeTab = (): void => {
    if (onOpenFullTab) {
      onOpenFullTab();
      return;
    }
    window.dispatchEvent(
      new CustomEvent(MENTU_OPEN_TAB_EVENT, { detail: { workspaceId } }),
    );
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 py-3"
      data-testid="mentu-panel"
    >
      <div className="flex shrink-0 items-start gap-2">
        <Network className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">Mentu</h1>
          <p className="text-xs text-muted-foreground">Workspace source: .mentu/recipes</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          onClick={openNativeTab}
        >
          <ExternalLink />
          Open full tab
        </Button>
      </div>

      <Select
        value={controller.selectedRecipeId ?? ""}
        onValueChange={(value) => controller.setSelectedRecipeId(value || null)}
        disabled={controller.loading || controller.busy || controller.validEntries.length === 0}
      >
        <SelectTrigger size="sm" className="shrink-0" aria-label="Recipe">
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

      <div
        className="grid shrink-0 grid-cols-2 gap-1 rounded-md border border-border bg-card p-1"
        role="tablist"
        aria-label="Mentu inspector view"
      >
        <Button
          size="sm"
          variant={showingEvidence ? "ghost" : "secondary"}
          role="tab"
          aria-selected={!showingEvidence}
          onClick={() => controller.setMode("graph")}
        >
          Plan
        </Button>
        <Button
          size="sm"
          variant={showingEvidence ? "secondary" : "ghost"}
          role="tab"
          aria-selected={showingEvidence}
          onClick={() => controller.setMode("evidence")}
        >
          Evidence
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 pr-2">
          {controller.runtimeMessage ? (
            <div
              className="rounded-md border border-border bg-card p-3 text-xs text-muted-foreground"
              role={
                ["invalid", "execution-failed"].includes(controller.runtimeMessageKind)
                  ? "alert"
                  : "status"
              }
              data-testid="mentu-panel-status"
            >
              <MentuRuntimeMessage
                kind={controller.runtimeMessageKind}
                message={controller.runtimeMessage}
                onOpenEvidence={() => controller.setMode("evidence")}
              />
            </div>
          ) : null}
          {controller.loading || controller.loadingRecipe ? (
            <div className="space-y-2" data-testid="mentu-panel-loading">
              <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
              <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            </div>
          ) : showingEvidence ? (
            <EvidenceView run={controller.run} recipe={controller.recipe} />
          ) : controller.graph?.valid ? (
            <div data-testid="mentu-panel-plan">
              <GraphView
                graph={controller.graph}
                run={controller.run}
                selectedNodeId={controller.selectedNodeId}
                onSelectNode={controller.setSelectedNodeId}
              />
              {controller.selectedNode ? (
                <div className="mt-3 rounded-md border border-border bg-card p-3 text-xs">
                  <p className="font-medium">{controller.selectedNode.label}</p>
                  <p className="mt-1 text-muted-foreground">
                    Step selected. Open the full tab for details and execution.
                  </p>
                </div>
              ) : null}
              {controller.recipe ? (
                <div className="mt-3">
                  <RunControls
                    review={controller.review}
                    owner={controller.workspaceId}
                    runtimeAvailable={runtimeAvailable}
                    dependencyGraphValid={controller.graph.valid}
                    operationRunning={controller.operationRunning}
                    busy={controller.busy}
                    run={controller.run}
                    approval={controller.approval}
                    onStageReview={controller.stageReview}
                    onApproveAndRun={() => void controller.approveAndRun()}
                    onRetry={() => void controller.retry()}
                    onCancel={() => void controller.cancelRun()}
                    onClearReview={controller.clearReview}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a valid recipe to inspect its plan.
            </p>
          )}
        </div>
      </ScrollArea>

      <details
        className="shrink-0 rounded-md border border-border bg-card p-3"
        data-testid="mentu-advanced"
      >
        <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <Settings2 className="size-3.5 text-muted-foreground" />
          Sources and settings
        </summary>
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Source JSON is the exact recipe bytes the approval hash binds. It is read-only here;
            edit the file under .mentu/recipes to change it.
          </p>
          <Textarea
            value={controller.draftSource}
            readOnly
            aria-label="Mentu source JSON"
            className="min-h-32 resize-y font-mono text-[11px]"
          />
        </div>
      </details>

      <Badge variant="outline" className="w-fit shrink-0 text-[10px]">
        Review required before host execution
      </Badge>
    </div>
  );
}
