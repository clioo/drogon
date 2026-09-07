// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-views.tsx`: GraphView,
// EvidenceView, MetricsView and EmptyRecipeState with the reference's DOM,
// Tailwind classes, copy, icons and ARIA. Adapted only in the data layer:
// evidence projects this repo's `MentuRun` (per-step status, exit code,
// duration, attempts, output/error paths, error text) and the loaded
// `MentuRecipeDetail` (declared verify commands). Metrics the daemon run
// record does not carry (token counts, cost, models, invocation counts)
// render the reference's honest "unavailable" states; Drogon estimates
// nothing.

import { Activity, ArrowRight, Clock3, FileJson, Gauge } from "lucide-react";
import type { MentuRecipeDetail, MentuRun } from "../../../../shared/mentu-contract";
import { Badge } from "../../components/ui/badge";
import {
  groupStepAttempts,
  nodeRunRecord,
  type RecipeGraph,
} from "./recipe-graph";
import { RecipeVerification } from "./RecipeVerification";
import { statusLabel } from "./run-status";

function MetricValue({ value, exact }: { value: string; exact: boolean }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <p className="font-medium">{value}</p>
      <Badge variant="outline" className="mt-2 text-[10px]">
        {exact ? "Exact · run record" : "Unavailable"}
      </Badge>
    </div>
  );
}

function formatAttempts(attempts: number | null): string {
  if (attempts === null) return "unknown lifetime attempts";
  return `${attempts} lifetime attempt${attempts === 1 ? "" : "s"}`;
}

export function GraphView({
  graph,
  run,
  selectedNodeId,
  onSelectNode,
}: {
  graph: RecipeGraph;
  run: MentuRun | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}): React.JSX.Element {
  const levels = new Map<number, (typeof graph.nodes)[number][]>();
  for (const node of graph.nodes) {
    const nodesAtLevel = levels.get(node.depth) ?? [];
    nodesAtLevel.push(node);
    levels.set(node.depth, nodesAtLevel);
  }
  return (
    <div
      className="@container/mentu-graph min-w-0 space-y-3"
      data-testid="recipe-graph"
      role="tree"
      aria-label="Recipe dependency graph"
    >
      {[...levels.entries()]
        .sort(([left], [right]) => left - right)
        .map(([level, nodes]) => (
          <div key={level} className="flex items-stretch gap-2" data-recipe-graph-level={level}>
            {level > 0 ? (
              <ArrowRight className="mt-3 size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : null}
            <div className="grid min-w-0 flex-1 gap-2 @md/mentu-graph:grid-cols-2 @2xl/mentu-graph:grid-cols-3">
              {nodes.map((node) => {
                const record = nodeRunRecord(run?.steps, node.label);
                return (
                  <button
                    key={node.id}
                    type="button"
                    role="treeitem"
                    aria-selected={selectedNodeId === node.id}
                    data-recipe-node={node.label}
                    onClick={() => onSelectNode(node.id)}
                    className={`min-w-0 rounded-lg border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${selectedNodeId === node.id ? "border-ring bg-accent text-accent-foreground" : "border-border bg-card hover:bg-accent/50"}`}
                  >
                    <div className="flex items-center gap-2">
                      <Activity className="size-4 shrink-0" />
                      <span className="min-w-0 truncate text-sm font-medium">{node.label}</span>
                      {record ? (
                        <Badge variant="outline" className="ml-auto text-[10px]">
                          {statusLabel(record.status)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {node.dependencies.length > 0
                        ? `Depends on ${node.dependencies.length} node${node.dependencies.length === 1 ? "" : "s"}`
                        : "No dependencies"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

export function EvidenceView({
  run,
  recipe,
}: {
  run: MentuRun | null;
  recipe: MentuRecipeDetail | null;
}): React.JSX.Element {
  if (!run) {
    return (
      <p className="text-sm text-muted-foreground">No run evidence is loaded for this recipe.</p>
    );
  }
  return (
    <div
      className="@container/mentu-evidence min-w-0 space-y-3 [overflow-wrap:anywhere]"
      data-testid="recipe-evidence"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{recipe?.name ?? run.recipeId}</Badge>
        <Badge variant="secondary">{statusLabel(run.status)}</Badge>
        <span className="text-xs text-muted-foreground">Run {run.mentuRunId ?? run.id}</span>
      </div>
      <div className="grid gap-2 @md/mentu-evidence:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border bg-card p-3 text-xs">
          <p className="text-muted-foreground">Run</p>
          <p className="mt-1 font-medium">{run.mentuRunId ?? run.id}</p>
        </div>
        <div className="min-w-0 rounded-md border border-border bg-card p-3 text-xs">
          <p className="text-muted-foreground">Outcome</p>
          <p className="mt-1 font-medium">{statusLabel(run.status)}</p>
        </div>
      </div>
      {run.error ? (
        <p role="alert" className="text-xs text-destructive">
          {run.error}
        </p>
      ) : null}
      <div className="space-y-2">
        {groupStepAttempts(run.steps).map(({ label, attempts }) => {
          const latest = attempts.at(-1)!;
          return (
            <div
              key={`step:${label}`}
              className="rounded-md border border-border bg-card p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Activity className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 font-medium">{label}</span>
                <span className="ml-auto min-w-0 text-muted-foreground">
                  {statusLabel(latest.status)}
                  {latest.exitCode !== null && latest.exitCode !== undefined
                    ? ` · exit ${latest.exitCode}`
                    : ""}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">
                {latest.backend} · {formatAttempts(latest.attempts)}{" "}
                {latest.durationSeconds !== null && latest.durationSeconds !== undefined
                  ? `· ${latest.durationSeconds}s`
                  : "· duration unavailable"}
              </p>
              <RecipeVerification verification={latest.verification} />
              <p className="mt-1 text-muted-foreground">
                stdout {latest.outputPath ? "captured" : "unavailable"} · stderr{" "}
                {latest.errorPath ? "captured" : "unavailable"}
              </p>
              {latest.outputPath ? (
                <p className="mt-1 font-mono text-muted-foreground">stdout: {latest.outputPath}</p>
              ) : null}
              {latest.errorPath ? (
                <p className="mt-1 font-mono text-muted-foreground">stderr: {latest.errorPath}</p>
              ) : null}
              {latest.error ? <p className="mt-1 text-destructive">{latest.error}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MetricsView({ run }: { run: MentuRun | null }): React.JSX.Element {
  if (!run) {
    return (
      <p className="text-sm text-muted-foreground">
        No measurements are available until a run record is loaded.
      </p>
    );
  }
  const knownDurations = run.steps
    .map((step) => step.durationSeconds)
    .filter((value): value is number => typeof value === "number");
  const durationTotal = knownDurations.reduce((total, value) => total + value, 0);
  const durationUnknown = run.steps.length - knownDurations.length;
  const durationValue =
    knownDurations.length === 0
      ? "Duration: unavailable"
      : `Duration: ${durationTotal}s${durationUnknown > 0 ? ` + ${durationUnknown} unknown` : ""}`;
  return (
    <div
      className="@container/mentu-metrics min-w-0 space-y-3 [overflow-wrap:anywhere]"
      data-testid="recipe-metrics"
    >
      <p className="text-xs text-muted-foreground">
        Recipe totals aggregate only values directly reported by this Mentu run record. Missing
        values remain unavailable; Drogon does not estimate them.
      </p>
      <div className="grid gap-2 @md/mentu-metrics:grid-cols-2 @2xl/mentu-metrics:grid-cols-4">
        <MetricValue value={durationValue} exact={knownDurations.length > 0 && durationUnknown === 0} />
        <MetricValue value="Input tokens: unavailable" exact={false} />
        <MetricValue value="Output tokens: unavailable" exact={false} />
        <MetricValue value="Cost: unavailable" exact={false} />
      </div>
      <p className="text-xs text-muted-foreground">
        Scope: recipe · session aggregate: unavailable
      </p>
      <div className="space-y-2">
        {groupStepAttempts(run.steps).map(({ label, attempts }) => {
          const latest = attempts.at(-1)!;
          const attemptTotal = latest.attempts ?? attempts.length;
          return (
            <div key={`metric:${label}`} className="rounded-md border border-border bg-card p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Gauge className="size-4 text-muted-foreground" />
                {label}
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {attemptTotal} lifetime attempt{attemptTotal === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {attempts.map((step, index) => (
                  <div
                    key={`metric:${label}:${index}:${step.outputPath ?? ""}:${step.errorPath ?? ""}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
                  >
                    {attempts.length > 1 ? (
                      <Badge variant="outline" className="text-[10px]">
                        Attempt {index + 1} of {attempts.length}
                      </Badge>
                    ) : null}
                    <span>Outcome: {statusLabel(step.status)}</span>
                    <span>
                      <Clock3 className="mr-1 inline size-3" />
                      {step.durationSeconds !== null && step.durationSeconds !== undefined
                        ? `${step.durationSeconds}s`
                        : "unavailable"}
                    </span>
                    <span>
                      Process exit:{" "}
                      {step.exitCode !== null && step.exitCode !== undefined
                        ? step.exitCode
                        : "unavailable"}
                    </span>
                    <span>Harness: {step.backend}</span>
                    <span>Model: unavailable</span>
                    <span>Input tokens: unavailable</span>
                    <span>Output tokens: unavailable</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function EmptyRecipeState({ invalidCount }: { invalidCount: number }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      <div>
        <FileJson className="mx-auto mb-2 size-5" />
        <p>Select a valid workspace recipe to view its graph.</p>
        {invalidCount > 0 ? (
          <p className="mt-1 text-xs">
            {invalidCount} invalid recipe file{invalidCount === 1 ? "" : "s"} hidden from selection.
          </p>
        ) : null}
      </div>
    </div>
  );
}
