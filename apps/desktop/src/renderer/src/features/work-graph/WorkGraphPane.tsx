// MIT Copyright (c) 2026 Lovecast Inc.
// The Work Graph: the Mentu tab's new content. A leader-and-children view
// of the work and the agents doing it, read live from
// `<workspace>/.drogon/graph.json` — the file whose `intent` half is the
// human's plan and whose `state` half is what the daemon actually
// observed. Structure and chrome (dotted-grid canvas, zoom controls,
// level rows, SELECTED badge, inspector column) follow this repo's
// existing Mentu graph rendering (`features/mentu/recipe-pane-views.tsx`)
// rather than any new graph library.
//
// Evidence lives ON the node. The daemon embeds the run-record STEP in the
// state half's `evidence` (`{ runId, mentuRunId, step }` — see
// `crates/drogon-core/src/graph/state.rs`); the step's stdout/stderr
// CONTENT is not part of the file, so the inspector resolves it through
// the EXISTING `mentu.run_evidence` RPC using the state node's run id —
// the same seam the Mentu Evidence view uses. No invented paths.
//
// Honesty rules, non-negotiable (see shared/work-graph-contract.ts):
//   - every status, timestamp, stream and token value renders EXACTLY
//     what the daemon's records carry — the view estimates nothing;
//   - `unverifiable` is rendered as its own outcome (loss of contact),
//     never folded into failed or succeeded;
//   - a shell node's token/cost metrics are NOT APPLICABLE (a distinct
//     rendering from "unavailable");
//   - `running` appears only because the backend says a process is
//     confirmed live.
//
// Phase 1 is read-only: this pane performs no writes of any kind, to
// `state` or to `intent`. Per-node retry/resume and intent editing arrive
// with the backend's graph.* RPCs (landed daemon-side in PR #444) behind
// a preload bridge — never invented paths.

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleHelp,
  FileJson,
  Loader2,
  Maximize,
  Minus,
  Network,
  Plus,
  RefreshCw,
} from "lucide-react";
import type { FileBridge } from "../../../../shared/file-contract";
import type {
  MentuBridge,
  MentuRunEvidenceResult,
} from "../../../../shared/mentu-contract";
import {
  intentModel,
  isShellHarness,
  stateNodeFor,
  type WorkGraphDocument,
  type WorkGraphEvidence,
} from "../../../../shared/work-graph-contract";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { dependencyTitles, type WorkGraphLayout } from "./work-graph-layout";
import { buildWorkGraphLayout } from "./work-graph-layout";
import { formatDurationMs, summarizeWorkGraph } from "./work-graph-metrics";
import { useWorkGraphSource } from "./work-graph-source";
import {
  workGraphStatusLabel,
  workGraphStatusToneClass,
} from "./work-graph-status";

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;
const ZOOM_DEFAULT = 100;

/** The node's own observed status as a glyph — never a decorative
 *  always-green check. Unknown statuses get the neutral outline circle. */
function WorkGraphStatusIcon({
  status,
}: {
  status: string | undefined | null;
}): React.JSX.Element {
  const className = `size-4 shrink-0 ${workGraphStatusToneClass(status)}`;
  if (status === "running")
    return <Loader2 className={`${className} animate-spin motion-reduce:animate-none`} aria-hidden />;
  if (status === "succeeded") return <CheckCircle2 className={className} aria-hidden />;
  if (status === "failed") return <AlertCircle className={className} aria-hidden />;
  if (status === "blocked") return <CircleDashed className={className} aria-hidden />;
  if (status === "unverifiable") return <CircleHelp className={className} aria-hidden />;
  return <Circle className={className} aria-hidden />;
}

function MetricCard({
  value,
  exact,
  partial = false,
}: {
  value: string;
  exact: boolean;
  /** Some recorded values plus explicitly-counted unknowns: the total is
   *  neither fully exact nor unavailable, and the badge says so. */
  partial?: boolean;
}): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card p-3 text-xs">
      <p className="break-words font-medium">{value}</p>
      <Badge variant="outline" className="mt-2 text-[10px]">
        {exact ? "Exact · state record" : partial ? "Partial · unknowns counted" : "Unavailable"}
      </Badge>
    </div>
  );
}

/** One stdio stream resolved for the node's run through
 *  `mentu.run_evidence`: content in a scrollable block, the daemon's
 *  truncation reason spelled out with the full path, read failures as
 *  muted text. Mirrors the Mentu Evidence view's rendering. */
function EvidenceStream({
  label,
  output,
}: {
  label: string;
  output: { content: string | null; path: string | null; error: string | null };
}): React.JSX.Element | null {
  if (
    (output.content === null || output.content === undefined) &&
    !output.path &&
    !output.error
  ) {
    return null;
  }
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
  if (output.error && output.error !== "content_truncated") {
    return (
      <p className="mt-1 text-muted-foreground">
        {label} unavailable: {output.error}
      </p>
    );
  }
  return (
    <div className="mt-2 min-w-0">
      <p className="text-muted-foreground">{label} (no content recorded)</p>
      {output.path ? <p className="mt-1 font-mono text-muted-foreground">{output.path}</p> : null}
    </div>
  );
}

/** The drift pair exactly as the task defines it: which paths the node
 *  EXPECTED versus which it CREATED, rendered only when the state record
 *  carries one — never invented. */
function EvidenceDrift({
  drift,
}: {
  drift: { expected: string[]; created: string[] } | null | undefined;
}): React.JSX.Element | null {
  if (!drift) return null;
  const hasAny = drift.expected.length > 0 || drift.created.length > 0;
  if (!hasAny) return null;
  return (
    <div className="mt-2 min-w-0" data-testid="work-graph-node-drift">
      <p className="text-muted-foreground">Drift (expected vs created)</p>
      <div className="mt-1 grid gap-2 @md/work-graph-inspector:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border bg-card p-2">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Expected</p>
          {drift.expected.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {drift.expected.map((path) => (
                <li key={`expected:${path}`} className="break-all font-mono text-[11px]">
                  {path}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">none recorded</p>
          )}
        </div>
        <div className="min-w-0 rounded-md border border-border bg-card p-2">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Created</p>
          {drift.created.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {drift.created.map((path) => (
                <li key={`created:${path}`} className="break-all font-mono text-[11px]">
                  {path}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">none recorded</p>
          )}
        </div>
      </div>
    </div>
  );
}

const KNOWN_EVIDENCE_KEYS = new Set(["runId", "mentuRunId", "step", "drift"]);

/** Evidence keys the schema does not know yet, rendered verbatim so the
 *  daemon's newer fields are spelled out — never silently dropped. */
function UnknownEvidence({
  evidence,
}: {
  evidence: WorkGraphEvidence;
}): React.JSX.Element | null {
  const unknown = Object.keys(evidence).filter((key) => !KNOWN_EVIDENCE_KEYS.has(key));
  if (unknown.length === 0) return null;
  const raw: Record<string, unknown> = {};
  for (const key of unknown) raw[key] = evidence[key];
  return (
    <details
      className="mt-2 rounded-md border border-border bg-card p-2"
      data-testid="work-graph-node-evidence-unknown"
    >
      <summary className="cursor-pointer text-[11px] text-muted-foreground">
        {unknown.length} more evidence field{unknown.length === 1 ? "" : "s"} from the state record
      </summary>
      <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap break-words">
        {JSON.stringify(raw, null, 2)}
      </pre>
    </details>
  );
}

/** The token-metrics line with the exact shell/agent distinction: a shell
 *  node HAS no token fields (not applicable); an agent node reports them
 *  or honestly says unavailable. Renders from the state record alone —
 *  evidence presence does not change which words apply. */
function UsageLine({
  shell,
  step,
}: {
  shell: boolean;
  step: WorkGraphEvidence["step"];
}): React.JSX.Element {
  const usage = step?.usage ?? null;
  if (shell) {
    // Not applicable ≠ unavailable: a shell node HAS no model/token
    // fields by contract.
    return (
      <p className="mt-2 text-muted-foreground" data-testid="work-graph-node-usage-na">
        Token metrics: not applicable (shell node)
      </p>
    );
  }
  if (!usage) {
    return (
      <p className="mt-2 text-muted-foreground">
        Token metrics: unavailable (agent node, no usage in the state record)
      </p>
    );
  }
  return (
    <p className="mt-2" data-testid="work-graph-node-usage">
      <span className="text-muted-foreground">Model:</span> {step?.model ?? "unavailable"}
      <br />
      <span className="text-muted-foreground">Input tokens:</span>{" "}
      {typeof usage.inputTokens === "number" && usage.usageKnown !== false
        ? usage.inputTokens
        : "unavailable"}
      <br />
      <span className="text-muted-foreground">Output tokens:</span>{" "}
      {typeof usage.outputTokens === "number" && usage.usageKnown !== false
        ? usage.outputTokens
        : "unavailable"}
    </p>
  );
}

type ResolvedEvidence =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "resolved"; result: MentuRunEvidenceResult };

/** Resolves the node's recorded stdout/stderr through the EXISTING
 *  `mentu.run_evidence` RPC (the same seam the Mentu Evidence view uses),
 *  matched to the node's compiled step label. No run id, no bridge, or a
 *  refusal each render honestly — never as empty success. */
function useRunEvidence(
  mentuBridge: MentuBridge | null,
  runId: string | null | undefined,
  stepLabel: string | null | undefined,
): ResolvedEvidence {
  const [state, setState] = useState<ResolvedEvidence>({ kind: "none" });
  useEffect(() => {
    if (!runId || !stepLabel) {
      setState({ kind: "none" });
      return;
    }
    if (!mentuBridge?.mentuRunEvidence) {
      setState({ kind: "error", message: "Evidence content is unavailable in this build." });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    mentuBridge
      .mentuRunEvidence({ runId })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ kind: "error", message: result.error.message });
          return;
        }
        setState({ kind: "resolved", result: result.result });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [mentuBridge, runId, stepLabel]);
  return state;
}

/** The selected node's evidence and metrics, on the node: exit code,
 *  streams, drift, usage. Shell/agent distinction is exact. */
function WorkGraphNodeInspector({
  document,
  layout,
  nodeId,
  mentuBridge,
}: {
  document: WorkGraphDocument;
  layout: WorkGraphLayout;
  nodeId: string | null;
  mentuBridge: MentuBridge | null;
}): React.JSX.Element {
  const intentNode = nodeId ? layout.nodes.find((node) => node.id === nodeId) ?? null : null;
  const state = intentNode ? stateNodeFor(document, intentNode.id) : null;
  const step = state?.evidence?.step ?? null;
  const evidenceStreams = useRunEvidence(
    mentuBridge,
    state?.runId ?? state?.evidence?.runId ?? null,
    step?.label ?? null,
  );
  if (!intentNode) {
    return (
      <div
        className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground"
        data-testid="work-graph-inspector-empty"
      >
        Select a node to see its status, evidence and metrics.
      </div>
    );
  }
  const status = state?.status ?? "idle";
  const evidence = state?.evidence ?? null;
  const shell = isShellHarness(intentNode.harness);
  const deps = dependencyTitles(layout, intentNode);
  const streams =
    evidenceStreams.kind === "resolved"
      ? (evidenceStreams.result.evidence.find((entry) => entry.label === step?.label) ?? null)
      : null;
  return (
    <div
      className="@container/work-graph-inspector min-w-0 space-y-3 text-xs [overflow-wrap:anywhere]"
      data-testid="work-graph-node-inspector"
      aria-label={`Node ${intentNode.title}`}
    >
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <WorkGraphStatusIcon status={status} />
          <span className="min-w-0 flex-1 font-medium">{intentNode.title}</span>
          <Badge variant="outline" className="text-[10px]">
            {workGraphStatusLabel(status)}
          </Badge>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">
            {intentNode.harness}
          </Badge>
          {intentModel(intentNode) ? (
            <span className="font-mono text-[11px]">{intentModel(intentNode)}</span>
          ) : (
            <span className="text-[11px]">
              {shell ? "no model (shell)" : "harness default model"}
            </span>
          )}
          {!intentNode.enabled ? (
            <Badge
              variant="outline"
              className="text-[10px]"
              data-testid="work-graph-node-disabled-badge"
            >
              Disabled — not to relaunch
            </Badge>
          ) : null}
        </p>
        {intentNode.prompt ? (
          <p className="mt-2 rounded-md bg-muted/40 p-2 break-words whitespace-pre-wrap text-foreground">
            {intentNode.prompt}
          </p>
        ) : null}
        <p className="mt-2 text-muted-foreground">
          {deps.length > 0
            ? `Depends on ${deps.length} node${deps.length === 1 ? "" : "s"}: ${deps.join(", ")}`
            : "No dependencies"}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-3" data-testid="work-graph-node-run">
        <p className="flex items-center gap-1.5 font-medium">
          <Activity className="size-3.5 text-muted-foreground" aria-hidden />
          Run record
        </p>
        {state ? (
          <>
            <dl className="mt-2 space-y-1">
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                <dt className="text-muted-foreground">Started</dt>
                <dd className="min-w-0 break-all">{state.startedAt ?? "unavailable"}</dd>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                <dt className="text-muted-foreground">Ended</dt>
                <dd className="min-w-0 break-all">
                  {state.endedAt ?? (status === "running" ? "running" : "unavailable")}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                <dt className="text-muted-foreground">Duration</dt>
                <dd className="min-w-0 break-all">
                  {typeof step?.durationSeconds === "number"
                    ? formatDurationMs(step.durationSeconds * 1000)
                    : "unavailable"}
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                <dt className="text-muted-foreground">Run</dt>
                <dd className="min-w-0 break-all font-mono">{state.runId ?? "unavailable"}</dd>
              </div>
              {state.mentuRunId ?? evidence?.mentuRunId ? (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                  <dt className="text-muted-foreground">Runtime run</dt>
                  <dd className="min-w-0 break-all font-mono">
                    {state.mentuRunId ?? evidence?.mentuRunId}
                  </dd>
                </div>
              ) : null}
            </dl>
            <UsageLine shell={shell} step={step} />
            {evidence ? (
              <>
                <p className="mt-2">
                  Exit code:{" "}
                  <span className="font-mono">
                    {typeof step?.exitCode === "number" ? step.exitCode : "unavailable"}
                  </span>
                </p>
                <EvidenceDrift drift={evidence.drift ?? null} />
                {streams ? (
                  <>
                    <EvidenceStream label="stdout" output={streams.stdout} />
                    <EvidenceStream label="stderr" output={streams.stderr} />
                  </>
                ) : evidenceStreams.kind === "loading" ? (
                  <p className="mt-2 text-muted-foreground">Loading stdout and stderr…</p>
                ) : evidenceStreams.kind === "error" ? (
                  <p role="status" className="mt-2 text-muted-foreground">
                    Evidence content unavailable: {evidenceStreams.message}
                  </p>
                ) : null}
                {step?.outputPath ? (
                  <p className="mt-1 font-mono text-muted-foreground">stdout: {step.outputPath}</p>
                ) : null}
                {step?.errorPath ? (
                  <p className="mt-1 font-mono text-muted-foreground">stderr: {step.errorPath}</p>
                ) : null}
                <UnknownEvidence evidence={evidence} />
              </>
            ) : (
              <p className="mt-2 text-muted-foreground">
                No evidence recorded yet for this node.
              </p>
            )}
            {state.lastError ?? step?.error ? (
              <p role="alert" className="mt-2 text-destructive">
                {state.lastError ?? step?.error}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-muted-foreground">
            The daemon has not recorded a run for this node yet.
          </p>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Values come verbatim from .drogon/graph.json's state records. Drogon estimates nothing.
      </p>
    </div>
  );
}

/** Groups laid-out nodes by layer depth, preserving first-seen order
 *  inside each layer. */
function groupNodesByDepth(
  nodes: WorkGraphLayout["nodes"],
): Map<number, WorkGraphLayout["nodes"]> {
  const levels = new Map<number, WorkGraphLayout["nodes"]>();
  for (const node of nodes) {
    const level = levels.get(node.depth) ?? [];
    level.push(node);
    levels.set(node.depth, level);
  }
  return levels;
}

/** Real, functional zoom over the canvas — the same contract as the
 *  Mentu graph's zoom controls (clamped CSS transform scale). */
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

export function WorkGraphPane({
  fileBridge,
  mentuBridge = null,
  hostId,
  workspaceId,
}: {
  fileBridge: FileBridge | null;
  /** The gated Mentu bridge, so a selected node can resolve its recorded
   *  stdout/stderr through the existing `mentu.run_evidence` RPC. Optional;
   *  without it the streams report honestly as unavailable. */
  mentuBridge?: MentuBridge | null;
  hostId: string | null;
  workspaceId: string;
}): React.JSX.Element {
  const { source, refresh, refreshing } = useWorkGraphSource({
    fileBridge,
    hostId,
    workspaceId,
  });
  const { zoom, zoomIn, zoomOut, fitToView } = useGraphZoom();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const document = source.kind === "loaded" ? source.document : null;
  const fileUpdatedAt = source.kind === "loaded" ? source.fileUpdatedAt : null;
  const layout = useMemo(
    () => buildWorkGraphLayout(document?.intent.nodes ?? []),
    [document],
  );
  const totals = useMemo(() => (document ? summarizeWorkGraph(document) : null), [document]);
  const runningCount = totals?.byStatus["running"] ?? 0;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
      data-testid="work-graph-pane"
    >
      {/* Header: what this surface is, where the truth lives, how fresh. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-medium">Work Graph</h1>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                Active Workspace
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              Workspace source: .drogon/graph.json
              {fileUpdatedAt ? ` · state updated ${fileUpdatedAt}` : ""}
              {runningCount > 0 ? ` · ${runningCount} running` : ""}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh work graph"
            data-testid="work-graph-refresh"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
          </Button>
        </div>
      </div>

      {document && totals ? (
        <>
          {/* Graph-level aggregate: the summary the old Metrics header
              provided, over the graph's own state records. */}
          <div
            className="shrink-0 border-b border-border bg-card px-4 py-3"
            data-testid="work-graph-totals"
          >
            <div className="@container/work-graph-totals">
              <div className="grid gap-2 @md/work-graph-totals:grid-cols-2 @2xl/work-graph-totals:grid-cols-4">
                <MetricCard
                  value={
                    totals.durationTotalMs !== null
                      ? `Duration: ${formatDurationMs(totals.durationTotalMs)}${
                          totals.durationUnknownCount > 0
                            ? ` + ${totals.durationUnknownCount} unknown`
                            : ""
                        }`
                      : "Duration: unavailable"
                  }
                  exact={totals.durationTotalMs !== null && totals.durationUnknownCount === 0}
                  partial={totals.durationTotalMs !== null && totals.durationUnknownCount > 0}
                />
                <MetricCard
                  value={
                    totals.inputTokens !== null
                      ? `Input tokens: ${totals.inputTokens}${
                          totals.agentUsageUnavailableCount > 0
                            ? ` + ${totals.agentUsageUnavailableCount} unavailable`
                            : ""
                        }`
                    : totals.shellNodeCount === totals.nodeCount
                      ? "Input tokens: not applicable (shell nodes only)"
                      : "Input tokens: unavailable"
                  }
                  exact={totals.inputTokens !== null && totals.agentUsageUnavailableCount === 0}
                  partial={totals.inputTokens !== null && totals.agentUsageUnavailableCount > 0}
                />
                <MetricCard
                  value={
                    totals.outputTokens !== null
                      ? `Output tokens: ${totals.outputTokens}${
                          totals.agentUsageUnavailableCount > 0
                            ? ` + ${totals.agentUsageUnavailableCount} unavailable`
                            : ""
                        }`
                    : totals.shellNodeCount === totals.nodeCount
                      ? "Output tokens: not applicable (shell nodes only)"
                      : "Output tokens: unavailable"
                  }
                  exact={totals.outputTokens !== null && totals.agentUsageUnavailableCount === 0}
                  partial={totals.outputTokens !== null && totals.agentUsageUnavailableCount > 0}
                />
                <MetricCard value="Cost: unavailable" exact={false} />
              </div>
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {(["running", "succeeded", "failed", "blocked", "unverifiable", "idle"] as const).map(
                (status) =>
                  (totals.byStatus[status] ?? 0) > 0 ? (
                    <Badge
                      key={status}
                      variant="outline"
                      className={`text-[10px] ${workGraphStatusToneClass(status)}`}
                      data-testid={`work-graph-total-${status}`}
                    >
                      {totals.byStatus[status]} {workGraphStatusLabel(status)}
                    </Badge>
                  ) : null,
              )}
              <span>
                {totals.nodeCount} node{totals.nodeCount === 1 ? "" : "s"} · updates every second
                while a node runs
              </span>
            </p>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)]">
              {/* max-h below lg: the stacked single-column layout must scroll
                  WITHIN the canvas, never let its content run under the
                  inspector column below it — an unbounded canvas used to
                  paint nodes beneath the inspector and intercept the clicks
                  aimed at them at the acceptance's narrow widths. */}
              <ScrollArea className="max-h-[46vh] min-h-0 rounded-lg border border-border bg-card p-3 lg:max-h-none">
                <div className="relative min-w-0" data-testid="work-graph-canvas">
                  <div
                    className="pointer-events-none absolute inset-0 -m-3 rounded-lg opacity-60 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px] dark:opacity-30"
                    aria-hidden
                  />
                  <div
                    className="relative mb-3 flex items-center gap-1"
                    data-testid="work-graph-zoom"
                  >
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
                  {layout.cycle ? (
                    <div
                      className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-sm"
                      role="alert"
                    >
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Invalid dependency graph</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Dependency cycle: {layout.cycle.join(" → ")}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="@container/work-graph relative min-w-0 origin-top-left space-y-3 transition-transform"
                      style={{ transform: `scale(${zoom / 100})` }}
                      data-testid="work-graph"
                      role="tree"
                      aria-label="Work dependency graph"
                    >
                      {[...groupNodesByDepth(layout.nodes).entries()]
                        .sort((left, right) => left[0] - right[0])
                        .map(([depth, nodes]) => (
                          <div
                            key={depth}
                            className="flex items-stretch gap-2"
                            data-work-graph-level={depth}
                          >
                            {depth > 0 ? (
                              <ArrowRight
                                className="mt-3 size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                            ) : null}
                            <div className="grid min-w-0 flex-1 gap-2 @md/work-graph:grid-cols-2 @2xl/work-graph:grid-cols-3">
                              {nodes.map((node) => {
                                const state = stateNodeFor(document, node.id);
                                const status = state?.status ?? "idle";
                                const selected = selectedNodeId === node.id;
                                return (
                                  <button
                                    key={node.id}
                                    type="button"
                                    role="treeitem"
                                    aria-selected={selected}
                                    data-work-graph-node={node.id}
                                    onClick={() => setSelectedNodeId(node.id)}
                                    className={`min-w-0 rounded-lg border-2 p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                                      selected
                                        ? "border-destructive bg-accent text-accent-foreground"
                                        : "border-border bg-card hover:bg-accent/50"
                                    }`}
                                  >
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                      <WorkGraphStatusIcon status={status} />
                                      {/* flex-1 + wrap: on a narrow tab column the status badge
                                          wraps to its own line instead of starving the title to a
                                          zero-width box (the acceptance drives 760px with both
                                          sidebars open — a real state, not a probe artifact). */}
                                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                        {node.title}
                                      </span>
                                      {selected ? (
                                        <Badge
                                          variant="destructive"
                                          className="text-[9px] tracking-wide"
                                          data-testid="work-graph-node-selected-badge"
                                        >
                                          SELECTED
                                        </Badge>
                                      ) : (
                                        <Badge
                                          variant="outline"
                                          className={`text-[10px] ${workGraphStatusToneClass(status)}`}
                                          data-work-graph-status={status}
                                        >
                                          {workGraphStatusLabel(status)}
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="mt-2 flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                      <Badge variant="secondary" className="text-[10px]">
                                        {node.harness}
                                      </Badge>
                                      {intentModel(node) ? (
                                        <span className="truncate font-mono text-[11px]">
                                          {intentModel(node)}
                                        </span>
                                      ) : null}
                                      {!node.enabled ? (
                                        <Badge variant="outline" className="text-[10px]">
                                          not to relaunch
                                        </Badge>
                                      ) : null}
                                    </p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      {layout.nodes.length === 0 ? (
                        <p className="p-3 text-sm text-muted-foreground">
                          The work graph has no intent nodes.
                        </p>
                      ) : null}
                      {layout.issues.length > 0 ? (
                        <p
                          role="status"
                          className="mt-2 rounded-md border border-border bg-card p-2 text-xs text-muted-foreground"
                          data-testid="work-graph-layout-issues"
                        >
                          {layout.issues.join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="min-h-0 min-w-0">
                <ScrollArea className="h-full min-h-0">
                  <WorkGraphNodeInspector
                    document={document}
                    layout={layout}
                    nodeId={selectedNodeId}
                    mentuBridge={mentuBridge}
                  />
                </ScrollArea>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {source.kind === "loading" ? (
            <div className="w-full max-w-md space-y-2" data-testid="work-graph-loading">
              <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
              <div className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
            </div>
          ) : source.kind === "missing" ? (
            <div
              className="w-full max-w-md rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground"
              data-testid="work-graph-empty"
            >
              <FileJson className="mx-auto mb-2 block size-5" />
              <p className="text-center font-medium text-foreground">{source.message}</p>
              <p className="mt-2 text-center text-xs">
                The daemon writes this file as it observes work in this workspace: the{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                  intent
                </code>{" "}
                half is the plan, the{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                  state
                </code>{" "}
                half is what actually happened.
              </p>
            </div>
          ) : source.kind === "invalid" ? (
            <div
              className="w-full max-w-md rounded-lg border border-border bg-card p-4 text-sm"
              role="alert"
              data-testid="work-graph-invalid"
            >
              <p className="font-medium">The work graph could not be rendered</p>
              <p className="mt-1 text-xs text-muted-foreground">{source.message}</p>
              {source.detail ? (
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] break-words whitespace-pre-wrap">
                  {source.detail}
                </pre>
              ) : null}
            </div>
          ) : source.kind === "read_error" ? (
            <div
              className="w-full max-w-md rounded-lg border border-border bg-card p-4 text-sm"
              role="alert"
              data-testid="work-graph-read-error"
            >
              <p className="font-medium">Reading .drogon/graph.json failed</p>
              <p className="mt-1 text-xs text-muted-foreground">{source.message}</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
