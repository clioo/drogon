// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-views.tsx`: GraphView,
// EvidenceView, MetricsView and EmptyRecipeState with the reference's DOM,
// Tailwind classes, copy, icons and ARIA. Adapted only in the data layer:
// evidence projects this repo's `MentuRun` (per-step status, exit code,
// duration, attempts, output/error paths, error text) plus the loaded
// `MentuStepEvidence` (per-step stdout/stderr `{reference, path, content}`
// with the fork's 512 KiB cap and `content_truncated` /
// `reference_outside_run_directory` reasons) and the loaded
// `MentuRecipeDetail` (declared verify commands). The fork's view stops at
// "captured/unavailable" per stream; this view additionally renders the
// loaded content in scrollable blocks (the only way to show evidence
// CONTENT the daemon went to read), spelling truncation with the full
// path. Metrics the daemon run record does not carry (cost, invocation
// counts) render the reference's honest "unavailable" states; observed
// token usage and models render through the dedicated MentuUsageMetrics
// component when the record carries them. Drogon estimates nothing.
//
// Target-design additions (owner-supplied mockup): a dotted-grid canvas
// with real zoom controls (CSS transform scale, clamped 50%-200%, plus a
// fit-to-view reset — local to this component, no fake "connected" state),
// a check-circle-family status glyph reflecting the node's ACTUAL run
// record (never a decorative always-green icon), and a SELECTED badge with
// a destructive-accent border plus the named single dependency for the
// selected node. The dependency-COUNT phrase (`Depends on N node(s)`)
// keeps its exact existing text when nothing is selected — the name
// suffix only appends for the selected node, so this stays an additive
// change.

import { useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock3,
  FileJson,
  FilePlus2,
  FolderOpen,
  Gauge,
  Loader2,
  Maximize,
  Minus,
  Plus,
} from "lucide-react";
import type {
  MentuRecipeDetail,
  MentuReferencedOutput,
  MentuRun,
  MentuStepEvidence,
} from "../../../../shared/mentu-contract";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  groupStepAttempts,
  nodeRunRecord,
  type RecipeGraph,
} from "./recipe-graph";
import { RecipeVerification } from "./RecipeVerification";
import { statusLabel, statusToneClass } from "./run-status";
import { UsageStepMetrics, UsageTokenCards } from "./MentuUsageMetrics";
import {
  runHasAgentSteps,
  USAGE_CARD_BADGE,
  type UsageCardKind,
} from "./usage-projection";

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 100;

/** The node's own run-record status as a glyph, never a bare decorative
 *  checkmark: no record renders a neutral outline circle, a run in
 *  progress spins, and success/failure use the same tone convention as
 *  the rest of the panel (`statusToneClass`). */
function NodeStatusIcon({
  status,
}: {
  status: MentuRun["steps"][number]["status"] | undefined;
}): React.JSX.Element {
  const className = `size-4 shrink-0 ${statusToneClass(status)}`;
  if (status === "running") return <Loader2 className={`${className} animate-spin`} aria-hidden />;
  if (status === "succeeded") return <CheckCircle2 className={className} aria-hidden />;
  if (status === "failed" || status === "unavailable")
    return <AlertCircle className={className} aria-hidden />;
  return <Circle className={className} aria-hidden />;
}

function MetricValue({
  value,
  exact,
  kind,
}: {
  value: string;
  exact: boolean;
  kind?: UsageCardKind;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs">
      <p className="font-medium">{value}</p>
      <Badge variant="outline" className="mt-2 text-[10px]">
        {USAGE_CARD_BADGE[kind ?? (exact ? "exact" : "partial")]}
      </Badge>
    </div>
  );
}

function formatAttempts(attempts: number | null): string {
  if (attempts === null) return "unknown lifetime attempts";
  return `${attempts} lifetime attempt${attempts === 1 ? "" : "s"}`;
}

/** Whether a stream counts as captured: loaded evidence decides by its
 *  content (the fork's `outputs[label].stdout.content !== null` rule);
 *  before evidence arrives, a recorded path is the honest fallback. */
function streamCaptured(
  output: MentuReferencedOutput | undefined,
  outputPath: string | null | undefined,
): boolean {
  if (output) return output.content !== null && output.content !== undefined;
  return outputPath !== null && outputPath !== undefined;
}

/** One loaded stdio stream: its content in a scrollable block, the
 *  daemon's truncation reason spelled out with the full path, other read
 *  failures as muted error text. Nothing renders for a stream with no
 *  content and no error — the availability line above already says
 *  "unavailable". */
function EvidenceStream({
  label,
  output,
}: {
  label: string;
  output: MentuReferencedOutput;
}): React.JSX.Element | null {
  if ((output.content === null || output.content === undefined) && !output.error) return null;
  if (output.content !== null && output.content !== undefined && output.content.length > 0) {
    const truncated = output.error === "content_truncated";
    return (
      <div className="mt-2 min-w-0">
        <p className="text-muted-foreground">
          {label}
          {truncated ? " (truncated to the first 512 KiB)" : ""}
        </p>
        <pre
          aria-label={`${label} output`}
          className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono whitespace-pre-wrap break-words text-foreground"
        >
          {output.content}
        </pre>
        {truncated && output.path ? (
          <p className="mt-1 text-muted-foreground">Full output at {output.path}</p>
        ) : null}
      </div>
    );
  }
  if (output.error && output.error !== "content_truncated" && output.reference) {
    return (
      <p className="mt-1 text-muted-foreground">
        {label} unavailable: {output.error}
      </p>
    );
  }
  return null;
}

/** Real, functional zoom over the graph canvas: a CSS transform scale the
 *  buttons actually change (clamped, keyboard-operable via the Select-free
 *  plain buttons below), never a decorative control that does nothing. */
function useGraphZoom(): {
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
} {
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  return {
    zoom,
    zoomIn: () => setZoom((current) => Math.min(ZOOM_MAX, current + ZOOM_STEP)),
    zoomOut: () => setZoom((current) => Math.max(ZOOM_MIN, current - ZOOM_STEP)),
    fitToView: () => setZoom(ZOOM_DEFAULT),
  };
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
  const { zoom, zoomIn, zoomOut, fitToView } = useGraphZoom();
  const levels = new Map<number, (typeof graph.nodes)[number][]>();
  for (const node of graph.nodes) {
    const nodesAtLevel = levels.get(node.depth) ?? [];
    nodesAtLevel.push(node);
    levels.set(node.depth, nodesAtLevel);
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <div className="relative min-w-0" data-testid="recipe-graph-canvas">
      <div
        className="pointer-events-none absolute inset-0 -m-3 rounded-lg opacity-60 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] dark:opacity-30"
        aria-hidden
      />
      <div className="relative mb-3 flex items-center gap-1" data-testid="recipe-graph-zoom">
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          onClick={zoomIn}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Zoom in"
        >
          <Plus />
        </Button>
        <span className="min-w-10 text-center text-[11px] tabular-nums text-muted-foreground">
          {zoom}%
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          onClick={zoomOut}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Zoom out"
        >
          <Minus />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="outline"
          onClick={fitToView}
          aria-label="Fit to view"
        >
          <Maximize />
        </Button>
      </div>
      <div
        className="@container/mentu-graph relative min-w-0 origin-top-left space-y-3 transition-transform"
        style={{ transform: `scale(${zoom / 100})` }}
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
                    const selected = selectedNodeId === node.id;
                    const onlyDependency =
                      node.dependencies.length === 1
                        ? nodeById.get(node.dependencies[0])?.label
                        : undefined;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        role="treeitem"
                        aria-selected={selected}
                        data-recipe-node={node.label}
                        onClick={() => onSelectNode(node.id)}
                        className={`min-w-0 rounded-lg border-2 p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${selected ? "border-destructive bg-accent text-accent-foreground" : "border-border bg-card hover:bg-accent/50"}`}
                      >
                        <div className="flex items-center gap-2">
                          <NodeStatusIcon status={record?.status} />
                          <span className="min-w-0 truncate text-sm font-medium">
                            {node.label}
                          </span>
                          {selected ? (
                            <Badge
                              variant="destructive"
                              className="ml-auto text-[9px] tracking-wide"
                              data-testid="mentu-node-selected-badge"
                            >
                              SELECTED
                            </Badge>
                          ) : record ? (
                            <Badge variant="outline" className="ml-auto text-[10px]">
                              {statusLabel(record.status)}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {node.dependencies.length > 0
                            ? `Depends on ${node.dependencies.length} node${node.dependencies.length === 1 ? "" : "s"}`
                            : "No dependencies"}
                          {selected && onlyDependency ? (
                            <span className="ml-1 font-mono text-muted-foreground/80">
                              · ({onlyDependency})
                            </span>
                          ) : null}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}

export function EvidenceView({
  run,
  recipe,
  evidence,
  evidenceLoading,
  evidenceError,
}: {
  run: MentuRun | null;
  recipe: MentuRecipeDetail | null;
  /** Loaded stdio evidence for the run; null until `mentu.run_evidence`
   *  answers (or when the bridge has no evidence method). */
  evidence?: MentuStepEvidence[] | null;
  evidenceLoading?: boolean;
  evidenceError?: string | null;
}): React.JSX.Element {
  if (!run) {
    return (
      <p className="text-sm text-muted-foreground">No run evidence is loaded for this recipe.</p>
    );
  }
  const evidenceByLabel = new Map((evidence ?? []).map((entry) => [entry.label, entry]));
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
      {evidenceError ? (
        <p role="status" className="text-xs text-muted-foreground">
          Evidence content unavailable: {evidenceError}
        </p>
      ) : null}
      <div className="space-y-2">
        {groupStepAttempts(run.steps).map(({ label, attempts }) => {
          const latest = attempts.at(-1)!;
          const streams = evidenceByLabel.get(label);
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
                stdout {streamCaptured(streams?.stdout, latest.outputPath) ? "captured" : "unavailable"} · stderr{" "}
                {streamCaptured(streams?.stderr, latest.errorPath) ? "captured" : "unavailable"}
              </p>
              {streams ? (
                <>
                  <EvidenceStream label="stdout" output={streams.stdout} />
                  <EvidenceStream label="stderr" output={streams.stderr} />
                </>
              ) : evidenceLoading ? (
                <p className="mt-1 text-muted-foreground">Loading stdout and stderr…</p>
              ) : null}
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
  const hasAgentSteps = runHasAgentSteps(run.steps);
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
        <UsageTokenCards steps={run.steps} />
        <MetricValue
          value={hasAgentSteps ? "Cost: not reported by the run record" : "Cost: not applicable"}
          exact={false}
          kind={hasAgentSteps ? "not_reported" : "not_applicable"}
        />
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
                    <UsageStepMetrics step={step} />
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

export function EmptyRecipeState({
  invalidCount,
  invalidRecipes = [],
  directory = { kind: "unknown" },
  directorySummary,
  recipesPathLabel,
  workspaceId = null,
  runtimeNote = null,
  nestedFindings = [],
  onRevealNested = null,
  canCreateStarter = false,
  creatingStarter = false,
  createStarterError = null,
  onCreateStarter,
}: {
  /** Kept from the reference: count of files hidden from selection. */
  invalidCount: number;
  /** Full detail for every refused file: filename plus the reason. */
  invalidRecipes?: {
    id: string;
    path: string;
    issue: string;
  }[];
  /** Observed on-disk state of `.mentu/recipes`. */
  directory?: {
    kind: "unknown" | "missing" | "empty" | "failed" | "present";
    fileCount?: number;
    reason?: string;
  };
  /** The honest one-line verdict (see describeMentuRecipeDirectory). */
  directorySummary?: string;
  /** Human path of the recipe directory shown as the source of truth. */
  recipesPathLabel?: string;
  /** Workspace id, for the real `drogon-cli mentu status` invocation. */
  workspaceId?: string | null;
  /** Present when the optional runtime is NOT usable on this host: the
   *  empty state must blame the host, never the workspace. */
  runtimeNote?: string | null;
  /** Nested `<subproject>/.mentu/recipes` directories: reported with their
   *  provenance so recipes one directory down are never a silent void. */
  nestedFindings?: {
    relativeDir: string;
    total: number;
    fileNames: string[];
  }[];
  /** Reveals a nested recipe directory in the OS file manager; null when
   *  the shell bridge cannot (the affordance then hides, not lies). */
  onRevealNested?: ((relativeDir: string) => void) | null;
  canCreateStarter?: boolean;
  creatingStarter?: boolean;
  createStarterError?: string | null;
  onCreateStarter?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
      <div className="w-full max-w-md text-left">
        <FileJson className="mx-auto mb-2 block size-5" />
        <div className="text-center">
          <p className="font-medium text-foreground">
            {directorySummary ?? "Select a valid workspace recipe to view its graph."}
          </p>
          {recipesPathLabel ? (
            <p className="mt-2 text-xs">
              Recipes are read from{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                {recipesPathLabel}
              </code>
            </p>
          ) : null}
        </div>
        {invalidRecipes.length > 0 ? (
          <div className="mt-3" data-testid="recipe-invalid-list">
            <p className="text-xs font-medium text-foreground">
              {invalidCount} recipe file{invalidCount === 1 ? "" : "s"} failed
              validation:
            </p>
            <ul className="mt-1 space-y-1">
              {invalidRecipes.map((recipe) => (
                <li
                  key={recipe.id}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  <span className="font-mono text-foreground">{recipe.path}</span>
                  <span className="mt-0.5 block break-words text-muted-foreground">
                    {recipe.issue}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {nestedFindings.length > 0 ? (
          // Recipes found in a NESTED subproject: reported with provenance
          // (which subproject each came from), never mixed into this
          // workspace's selection and never presented as belonging to the
          // workspace root — the daemon's catalog is root-scoped by design.
          <div className="mt-3" data-testid="recipe-nested-findings">
            <p className="text-xs font-medium text-foreground">
              Recipe{nestedFindings.some((f) => f.total !== 1) ? "s" : ""} were
              found one directory down, under this workspace's subprojects:
            </p>
            <ul className="mt-1 space-y-1">
              {nestedFindings.map((finding) => (
                <li
                  key={finding.relativeDir}
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  <div className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1 break-words">
                      <span className="font-mono text-foreground">
                        {finding.relativeDir}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}— {finding.total} recipe file
                        {finding.total === 1 ? "" : "s"}
                      </span>
                    </span>
                    {onRevealNested ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        data-testid={`recipe-reveal-${finding.relativeDir}`}
                        onClick={() => onRevealNested(finding.relativeDir)}
                      >
                        <FolderOpen />
                        Reveal
                      </Button>
                    ) : null}
                  </div>
                  {finding.fileNames.length > 0 ? (
                    <span className="mt-0.5 block truncate text-muted-foreground">
                      {finding.fileNames.join(", ")}
                      {finding.total > finding.fileNames.length
                        ? `, +${finding.total - finding.fileNames.length} more`
                        : ""}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs">
              Mentu reads only the workspace root path above. Open that
              subproject as its own workspace to view and run its recipes, or
              move them into the root directory.
            </p>
          </div>
        ) : null}
        {runtimeNote ? (
          <p
            className="mt-3 text-xs"
            role="status"
            data-testid="recipe-empty-runtime-note"
          >
            {runtimeNote}
          </p>
        ) : null}
        {canCreateStarter && onCreateStarter ? (
          <div className="mt-4 flex flex-col items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={creatingStarter}
              data-testid="recipe-create-starter"
              onClick={onCreateStarter}
            >
              <FilePlus2 />
              {creatingStarter ? "Creating…" : "Create a starter recipe"}
            </Button>
            <p className="text-xs">
              Writes a runnable one-step recipe into the directory above.
            </p>
            {createStarterError ? (
              <p className="text-xs text-destructive" role="alert">
                {createStarterError}
              </p>
            ) : null}
          </div>
        ) : null}
        {workspaceId ? (
          <p className="mt-4 text-center text-xs">
            Check this workspace from a terminal with{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
              drogon-cli mentu status --workspace {workspaceId}
            </code>
          </p>
        ) : null}
      </div>
    </div>
  );
}
