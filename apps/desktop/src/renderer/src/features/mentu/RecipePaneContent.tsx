// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/renderer/src/components/mentu/RecipePaneContent.tsx`: the Graph /
// Run / Evidence / Metrics tabs with the reference's DOM, Tailwind classes,
// copy, icons, keyboard and ARIA. Adapted only in the data layer (this
// repo's `MentuPaneController`): the Run tab's source-JSON editor is
// read-only and has no Apply affordance because the daemon exposes no
// recipe-save RPC, and the result card reports the run record's status and
// error instead of raw command output.

import { CircleDashed, Gauge, Network, Play, FileJson, Stethoscope } from "lucide-react";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import type { MentuPaneMode } from "../../../../shared/persistence-contracts/mentu-pane-types";
import { SelectedNodeInspector } from "./recipe-pane-inspector";
import { RunControls } from "./recipe-pane-run-controls";
import { EmptyRecipeState, EvidenceView, GraphView, MetricsView } from "./recipe-pane-views";
import type { MentuPaneController } from "./recipe-pane-controller";
import { statusLabel } from "./run-status";

export function RecipePaneContent({
  controller,
}: {
  controller: MentuPaneController;
}): React.JSX.Element {
  const { graph, recipe } = controller;
  const runtimeAvailable =
    controller.runtime?.available === true && controller.runtime?.lockMatches === true;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
      <Tabs
        value={controller.mode}
        onValueChange={(value) => controller.setMode(value as MentuPaneMode)}
        className="min-h-0 flex-1"
      >
        <TabsList variant="line" className="w-full justify-start border-b border-border">
          <TabsTrigger value="graph">
            <Network />
            Graph
          </TabsTrigger>
          <TabsTrigger value="run">
            <Play />
            Run
          </TabsTrigger>
          <TabsTrigger value="evidence">
            <FileJson />
            Evidence
          </TabsTrigger>
          <TabsTrigger value="metrics">
            <Gauge />
            Metrics
          </TabsTrigger>
        </TabsList>
        <TabsContent value="graph" className="min-h-0 flex-1 pt-3">
          {controller.loading || controller.loadingRecipe ? (
            <div className="space-y-3" data-testid="recipe-loading">
              <div className="h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
              <div className="h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
            </div>
          ) : graph?.valid ? (
            <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]">
              <ScrollArea className="min-h-0 rounded-lg border border-border bg-card p-3">
                <GraphView
                  graph={graph}
                  run={controller.run}
                  selectedNodeId={controller.selectedNodeId}
                  onSelectNode={controller.setSelectedNodeId}
                />
                {graph.nodes.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    This recipe has no steps or child recipes.
                  </p>
                ) : null}
              </ScrollArea>
              <SelectedNodeInspector node={controller.selectedNode} />
            </div>
          ) : graph ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-sm"
              role="alert"
            >
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium">Invalid dependency graph</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {graph.cycle
                    ? `Dependency cycle: ${graph.cycle.join(" → ")}`
                    : graph.issues.join(" · ")}
                </p>
              </div>
            </div>
          ) : (
            <EmptyRecipeState invalidCount={controller.invalidCount} />
          )}
        </TabsContent>
        <TabsContent value="run" className="min-h-0 flex-1 pt-3">
          {recipe ? (
            <ScrollArea className="h-full">
              <div className="space-y-4 pr-2">
                <div className="flex items-start gap-2 rounded-lg border border-border bg-card p-4">
                  <Stethoscope className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Run the selected source recipe</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Operations are routed through the execution host runtime.
                    </p>
                  </div>
                </div>
                <RunControls
                  review={controller.review}
                  owner={controller.workspaceId}
                  runtimeAvailable={runtimeAvailable}
                  dependencyGraphValid={graph?.valid === true}
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
                {controller.run ? (
                  <div className="rounded-lg border border-border bg-card p-3 text-xs">
                    <span className="font-medium">{statusLabel(controller.run.status)}</span>
                    {controller.run.error ? (
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {controller.run.error}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <details className="rounded-lg border border-border bg-card p-3">
                  <summary className="cursor-pointer text-xs font-medium">Source JSON</summary>
                  <div className="mt-3 space-y-2">
                    <Textarea
                      value={controller.draftSource}
                      readOnly
                      aria-label="Mentu source JSON"
                      className="min-h-48 resize-y font-mono text-[11px]"
                    />
                  </div>
                </details>
              </div>
            </ScrollArea>
          ) : (
            <p className="text-sm text-muted-foreground">Select a valid recipe before running.</p>
          )}
        </TabsContent>
        <TabsContent value="evidence" className="min-h-0 flex-1 pt-3">
          <ScrollArea className="h-full">
            <EvidenceView run={controller.run} recipe={controller.recipe} />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="metrics" className="min-h-0 flex-1 pt-3">
          <ScrollArea className="h-full">
            <MetricsView run={controller.run} />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
