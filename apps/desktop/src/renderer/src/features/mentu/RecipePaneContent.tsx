// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/renderer/src/components/mentu/RecipePaneContent.tsx`: the Graph /
// Run / Evidence / Metrics tabs with the reference's DOM, Tailwind classes,
// copy, icons, keyboard and ARIA. Adapted only in the data layer (this
// repo's `MentuPaneController`): the Run tab's source-JSON editor writes
// through `mentu.recipe_save` with Save/Discard over a draft distinct
// from the saved recipe, and the result card reports the run record's
// status and error instead of raw command output.

import { CircleDashed, Gauge, Network, Play, FileJson, Stethoscope } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
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
              <SelectedNodeInspector
                node={controller.selectedNode}
                editStep={controller.editStep}
                backends={controller.availableBackends}
                inheritBackendLabel={controller.inheritBackendLabel}
                editable={controller.editable}
                // Editing is gated on busyness only, not on runtime
                // availability: unlike the fork's host-routed save (which
                // needed an `available` capability), `mentu.recipe_save`
                // is daemon-local validation plus an atomic file write.
                // Execution (Review/Approve&run below) stays runtime-gated.
                disabled={controller.busy || controller.saving}
                saving={controller.saving}
                onSave={(draft) => controller.saveSelectedStep(draft)}
              />
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
                  <summary className="cursor-pointer text-xs font-medium">
                    Source JSON
                    {controller.dirty ? (
                      <Badge variant="secondary" className="ml-2">
                        Unsaved changes
                      </Badge>
                    ) : null}
                  </summary>
                  <div className="mt-3 space-y-2">
                    <Textarea
                      value={controller.draftSource}
                      onChange={(event) => controller.setDraftSource(event.target.value)}
                      aria-label="Mentu source JSON"
                      className="min-h-48 resize-y font-mono text-[11px]"
                      disabled={controller.busy || controller.saving}
                    />
                    {controller.draftIssues.length > 0 ? (
                      <p className="text-xs text-destructive" role="alert">
                        {controller.draftIssues
                          .map((issue) => `${issue.path}: ${issue.message}`)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {controller.error ? (
                      <p className="text-xs text-destructive" role="alert">
                        {controller.error}
                      </p>
                    ) : null}
                    {controller.saveNotice ? (
                      <p className="text-xs text-muted-foreground" role="status">
                        {controller.saveNotice}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => void controller.saveDraft()}
                        disabled={
                          !controller.dirty || controller.busy || controller.saving
                        }
                      >
                        {controller.saving ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => controller.applyDraft()}
                        disabled={
                          !controller.recipe ||
                          !controller.dirty ||
                          controller.busy ||
                          controller.saving
                        }
                      >
                        Apply draft
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => controller.discardDraft()}
                        disabled={
                          !controller.dirty || controller.busy || controller.saving
                        }
                      >
                        Discard
                      </Button>
                    </div>
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
