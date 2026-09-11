// MIT Copyright (c) 2026 Lovecast Inc.
// The work-graph AUTHORING canvas: the "design it yourself" surface the
// owner asked for when he saw the honest-but-passive empty state. Direct
// manipulation over the `intent` half of `.drogon/graph.json`:
//
//   - add a node, name it, give it the prompt, pick harness + model;
//   - drag cards to position them; drag a card's port onto another card
//     to draw a dependency edge (B waits on A); click to select and edit;
//     Delete removes the selected node;
//   - auto-layout exists but is ONLY ever an explicit request — nothing
//     here reflows a position the user set deliberately;
//   - Save persists through the daemon's `graph.write_intent` (atomic,
//     intent-half-only, unknown fields merged forward); this component
//     never serializes a `state` key — that half is the daemon's;
//   - Run goes through the ONE existing execution path: `graph.compile`
//     shows the runtime's own findings first, `graph.run` mints the
//     daemon's approval and launches. No second engine.
//
// Honesty while designing (non-negotiable):
//   - a node with NO state record renders as "Designed — never run"
//     (dashed border): designing intent must never look like work
//     happened;
//   - observed statuses come verbatim from the state records the pane
//     last read, never estimated;
//   - editing the model of a node whose session is live says "Applies at
//     the next launch" — never "applied";
//   - a live node's harness is locked with the reason and the honest
//     alternative ("start a new session with harness X"), and the node
//     cannot be deleted while alive ("stop session" is the honest move);
//   - harness and model choices come from the REAL catalogs
//     (`harness.list`, `harness.models` — PRs #426/#436/#453); a host
//     that enumerates nothing says so instead of fabricating a menu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutGrid,
  Play,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { GraphBridge, GraphCompileResult } from "../../../../shared/graph-contract";
import type {
  Harness,
} from "../../../../shared/session-contract";
import {
  stateNodeFor,
  type WorkGraphDocument,
} from "../../../../shared/work-graph-contract";
import { workGraphStatusLabel } from "./work-graph-status";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Checkbox } from "../../components/ui/checkbox";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useHarnessCatalog } from "../mentu/mentu-harness-catalog";
import { useMentuModelCatalog } from "../mentu/mentu-model-catalog";
import { MentuModelPicker } from "../mentu/MentuModelPicker";
import {
  modelCatalogReadout,
  modelOptionsFromCatalog,
} from "../mentu/mentu-model-registry";
import { knownModelsFor } from "../mentu/mentu-known-models";
import {
  DESIGN_NODE_HEIGHT,
  DESIGN_NODE_WIDTH,
  addDesignerNode,
  applyAutoLayout,
  connectDesignerNodes,
  deleteDesignerNode,
  disconnectDesignerNodes,
  draftCycle,
  draftFromIntentNodes,
  markDesignerSaved,
  updateDesignerNode,
  type ConnectRefusal,
  type DesignerNode,
  type WorkGraphDraft,
} from "./work-graph-designer";
import { toIntentPayload } from "./work-graph-designer";
import { WorkGraphStatusIcon } from "./work-graph-status-icon";

/** The zoom contract the read view uses (clamped CSS transform scale). */
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;

/** Harnesses the graph→recipe compiler can actually execute today
 *  (`crates/drogon-core/src/graph/compiler.rs`). Anything else is honest
 *  in the picker: selectable, but labelled as not runnable yet, and the
 *  compile findings refuse it authoritatively. */
const RUNNABLE_AGENT_HARNESSES = new Set(["claude", "codex", "pi"]);

/** The ids the daemon registers as harnesses (see mentu-model-catalog). */
const REGISTERED_HARNESSES = ["claude", "pi", "opencode", "antigravity", "codex"];

type DragState = {
  id: string;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
};

type ConnectState = {
  fromId: string;
  x: number;
  y: number;
};

export type RunPhase =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "review"; compile: GraphCompileResult; target: { nodeId?: string; nodeIds?: string[] } }
  | { kind: "running"; label: string }
  | { kind: "launched"; runId: string; label: string };

export function WorkGraphDesigner({
  graphBridge,
  workspaceId,
  document,
  onDone,
  onSaved,
  onIntentSaved,
  onRunLaunched,
}: {
  /** The gated graph bridge; null renders an honest refusal to edit (an
   *  old preload build cannot reach the ownership-enforcing RPC). */
  graphBridge: GraphBridge | null;
  workspaceId: string;
  /** The last document the pane read: the seed for editing and the source
   *  of the observed state records (statuses render verbatim from it). */
  document: WorkGraphDocument | null;
  /** Back to the read-only view (and a refresh). */
  onDone: () => void;
  /** Called after a successful save with the fresh document. */
  onSaved?: (document: WorkGraphDocument) => void;
  /** Called after a successful save with the exact intent payload nodes
   *  just written — lets the parent keep a saved workflow's node snapshot
   *  in sync with what actually runs (work-graph-workflows). */
  onIntentSaved?: (nodes: Record<string, unknown>[]) => void;
  /** Called right after `graph.run` launches successfully, with the run id
   *  and the exact compiled node set — the parent's adversarial-review
   *  loop (work-graph-workflows) hangs off this, not off any polling of
   *  its own inside this component (which unmounts when the user switches
   *  back to the read-only view). */
  onRunLaunched?: (info: { runId: string; nodeIds: string[] }) => void;
}): React.JSX.Element {
  const seed = useMemo(
    () => draftFromIntentNodes(document?.intent.nodes ?? []),
    [document],
  );
  const [draft, setDraft] = useState<WorkGraphDraft>(seed);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [run, setRun] = useState<RunPhase>({ kind: "idle" });
  const planeRef = useRef<HTMLDivElement>(null);

  const harnessCatalog = useHarnessCatalog();
  const liveStatus = useCallback(
    (nodeId: string) => (document ? stateNodeFor(document, nodeId)?.status ?? null : null),
    [document],
  );

  const cycle = useMemo(() => draftCycle(draft), [draft]);
  const { payload, issues } = useMemo(() => toIntentPayload(draft), [draft]);
  const selected = draft.nodes.find((node) => node.id === selectedId) ?? null;

  const mutate = useCallback((next: WorkGraphDraft) => {
    setDraft(next);
    setDirty(true);
  }, []);

  const showRefusal = useCallback((refusal: ConnectRefusal) => {
    setNotice(refusal.message);
  }, []);

  // --- pointer interactions ------------------------------------------------

  const canvasPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = planeRef.current?.getBoundingClientRect();
      const scale = zoom / 100;
      return rect
        ? { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
        : { x: 0, y: 0 };
    },
    [zoom],
  );

  const startDrag = useCallback(
    (node: DesignerNode, event: React.PointerEvent) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const point = canvasPoint(event.clientX, event.clientY);
      const x = node.position?.x ?? 24;
      const y = node.position?.y ?? 24;
      setDrag({ id: node.id, offsetX: point.x - x, offsetY: point.y - y, x, y });
      setSelectedId(node.id);
    },
    [canvasPoint],
  );

  const startConnect = useCallback((nodeId: string, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setSelectedId(nodeId);
    setConnect({ fromId: nodeId, x: event.clientX, y: event.clientY });
  }, []);

  const applyPosition = useCallback(
    (current: WorkGraphDraft, id: string, position: { x: number; y: number }) =>
      ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === id ? { ...node, position } : node,
        ),
      }) as WorkGraphDraft,
    [],
  );

  useEffect(() => {
    if (!drag && !connect) return;
    const onMove = (event: PointerEvent): void => {
      if (drag) {
        const point = canvasPoint(event.clientX, event.clientY);
        setDrag((current) =>
          current
            ? {
                ...current,
                x: Math.max(0, point.x - current.offsetX),
                y: Math.max(0, point.y - current.offsetY),
              }
            : current,
        );
      } else if (connect) {
        setConnect((current) =>
          current ? { ...current, x: event.clientX, y: event.clientY } : current,
        );
      }
    };
    const finish = (event: PointerEvent): void => {
      if (drag) {
        const { id, x, y } = drag;
        setDrag(null);
        mutate(
          applyPosition(draft, id, {
            x: Math.round(x),
            y: Math.round(y),
          }),
        );
      } else if (connect) {
        const fromId = connect.fromId;
        setConnect(null);
        // `document` (the prop) shadows the global; go through window.
        const target = window.document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest("[data-design-node-id]");
        const toId = target?.getAttribute("data-design-node-id");
        if (toId && toId !== fromId) {
          const result = connectDesignerNodes(draft, fromId, toId);
          if (result.refusal) showRefusal(result.refusal);
          else mutate(result.draft);
        }
      }
    };
    const cancel = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDrag(null);
        setConnect(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("keydown", cancel);
    };
  }, [drag, connect, draft, canvasPoint, mutate, showRefusal, applyPosition]);

  // --- saving --------------------------------------------------------------

  const save = useCallback(async () => {
    if (!graphBridge) {
      setSaveState({
        kind: "error",
        message: "Saving is unavailable in this desktop build (no graph bridge).",
      });
      return;
    }
    const built = toIntentPayload(draft);
    if (built.issues.length > 0) {
      setSaveState({ kind: "error", message: built.issues.join(" ") });
      return;
    }
    setSaveState({ kind: "saving" });
    setNotice(null);
    // The payload schema proves the { nodes } shape; the narrowed cast is
    // the contract type (which deliberately stays loose over node fields
    // so unknown ones ride through).
    const result = await graphBridge.graphWriteIntent({
      workspaceId,
      intent: built.payload as { nodes: unknown[] },
    });
    if (!result.ok) {
      setSaveState({ kind: "error", message: result.error.message });
      return;
    }
    setSaveState({ kind: "saved", at: new Date().toLocaleTimeString() });
    setDirty(false);
    setDraft((current) => markDesignerSaved(current));
    onSaved?.(result.result.graph as unknown as WorkGraphDocument);
    onIntentSaved?.(built.payload.nodes);
  }, [draft, graphBridge, onSaved, onIntentSaved, workspaceId]);

  // --- running (through the ONE existing compiler path) ---------------------

  const compile = useCallback(
    async (target: { nodeId?: string; nodeIds?: string[] }) => {
      if (!graphBridge) {
        setNotice("Running is unavailable in this desktop build (no graph bridge).");
        return;
      }
      setRun({ kind: "compiling" });
      const result = await graphBridge.graphCompile({ workspaceId, ...target });
      if (!result.ok) {
        setRun({ kind: "idle" });
        setNotice(result.error.message);
        return;
      }
      setRun({ kind: "review", compile: result.result, target });
    },
    [graphBridge, workspaceId],
  );

  const approveRun = useCallback(async () => {
    if (run.kind !== "review" || !graphBridge) return;
    const { target, compile: compiled } = run;
    const errors = compiled.findings.filter((finding) => finding.severity === "error");
    if (errors.length > 0) {
      setRun({ kind: "idle" });
      setNotice(
        `The compiled graph would not validate, so it was not executed: ${errors
          .map((finding) => `${finding.code}: ${finding.message}`)
          .join("; ")}`,
      );
      return;
    }
    setRun({ kind: "running", label: "Launching through the pinned runtime…" });
    const result = await graphBridge.graphRun({ workspaceId, ...target });
    if (!result.ok) {
      setRun({ kind: "idle" });
      setNotice(result.error.message);
      return;
    }
    setRun({ kind: "launched", runId: result.result.run.id, label: "Running" });
    onRunLaunched?.({ runId: result.result.run.id, nodeIds: result.result.compile.nodeIds });
  }, [graphBridge, run, workspaceId, onRunLaunched]);

  const allNodeIds = useMemo(() => draft.nodes.map((node) => node.id), [draft]);
  const runDisabledReason =
    allNodeIds.length === 0
      ? "Add a node first."
      : issues.length > 0 || cycle
        ? "Fix the validation issues before running."
        : null;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
      data-testid="work-graph-designer"
    >
      {/* Toolbar */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2"
        data-testid="design-toolbar"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const result = addDesignerNode(draft, {
              position: defaultPlacement(draft),
            });
            if (!result.node) {
              setNotice(result.draft.issues.at(-1)?.message ?? "Cannot add another node.");
              return;
            }
            mutate(result.draft);
            setSelectedId(result.node.id);
            setNotice(null);
          }}
          data-testid="design-add-node"
        >
          <Plus className="size-3.5" aria-hidden />
          Add node
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => mutate(applyAutoLayout(draft))}
          aria-label="Auto-layout: arrange every node in dependency order"
          data-testid="design-auto-layout"
        >
          <LayoutGrid className="size-3.5" aria-hidden />
          Auto-layout
        </Button>
        <div className="flex items-center gap-1" data-testid="design-zoom">
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 10))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Zoom out"
          >
            −
          </Button>
          <span className="min-w-10 text-center text-[11px] tabular-nums text-muted-foreground">
            {zoom}%
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 10))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Zoom in"
          >
            +
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {selectedId ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => compile({ nodeId: selectedId })}
              disabled={runDisabledReason !== null}
              title={runDisabledReason ?? undefined}
              data-testid="design-run-selected"
            >
              <Play className="size-3.5" aria-hidden />
              Run to selected
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => compile({ nodeIds: allNodeIds })}
            disabled={runDisabledReason !== null}
            title={runDisabledReason ?? undefined}
            data-testid="design-run"
          >
            <Play className="size-3.5" aria-hidden />
            Run graph
          </Button>
          <Button
            type="button"
            size="sm"
            variant={dirty ? "default" : "outline"}
            onClick={() => void save()}
            disabled={saveState.kind === "saving"}
            data-testid="design-save"
          >
            <Save className="size-3.5" aria-hidden />
            {saveState.kind === "saving" ? "Saving…" : "Save intent"}
            {dirty ? <span aria-hidden>•</span> : null}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDone}
            data-testid="design-done"
          >
            Done
          </Button>
        </div>
      </div>

      {/* Status line: honest, single place. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-1.5 text-[11px] text-muted-foreground">
        {saveState.kind === "saved" ? (
          <span role="status" data-testid="design-status-saved">
            Intent saved at {saveState.at} — the daemon owns everything else in the file.
          </span>
        ) : null}
        {saveState.kind === "error" ? (
          <span role="alert" data-testid="design-status-error">
            {saveState.message}
          </span>
        ) : null}
        {notice ? (
          <span role="status" data-testid="design-notice">
            {notice}
          </span>
        ) : null}
        {cycle ? (
          <span role="alert" data-testid="design-cycle" className="text-destructive">
            Dependency cycle: {cycle.join(" → ")} — fix it before this graph can run.
          </span>
        ) : null}
        {dirty ? <span data-testid="design-dirty">Unsaved changes</span> : null}
        <span className="ml-auto">
          Drag a node&apos;s right port onto another node to make the second wait on the first.
        </span>
      </div>

      {/* Review panel: what compiling produced, before anything runs. */}
      {run.kind === "review" ? (
        <div
          className="shrink-0 border-b border-border bg-card px-4 py-3 text-xs"
          data-testid="design-review"
          role="dialog"
          aria-label="Review the compiled graph before running"
        >
          <p className="font-medium">
            Compiled {run.compile.nodeIds.length} node{run.compile.nodeIds.length === 1 ? "" : "s"}{" "}
            in execution order: {run.compile.nodeIds.join(" → ")}
          </p>
          <p className="mt-1 text-muted-foreground">
            Recipe {run.compile.recipeId} · content {run.compile.contentHash.slice(0, 12)}… ·{" "}
            {run.compile.findings.length} finding{run.compile.findings.length === 1 ? "" : "s"} from
            the runtime&apos;s own check
          </p>
          {run.compile.findings.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {run.compile.findings.map((finding, index) => (
                <li
                  key={`${finding.code}:${index}`}
                  className={
                    finding.severity === "error" ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  [{finding.severity}] {finding.code}
                  {finding.nodeId ? ` (${finding.nodeId})` : ""}: {finding.message}
                  {finding.recommendation ? ` — ${finding.recommendation}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void approveRun()} data-testid="design-review-approve">
              Approve &amp; run
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setRun({ kind: "idle" })}
              data-testid="design-review-cancel"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {run.kind === "running" ? (
        <p className="shrink-0 border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground" role="status" data-testid="design-run-launching">
          Launching through the pinned runtime…
        </p>
      ) : null}
      {run.kind === "launched" ? (
        <div
          className="shrink-0 border-b border-border bg-card px-4 py-2 text-xs"
          role="status"
          data-testid="design-run-launched"
        >
          <p>
            Run <span className="font-mono">{run.runId}</span> launched. The daemon records each
            node&apos;s outcome as it happens.
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-1" onClick={onDone} data-testid="design-watch">
            Watch the graph
          </Button>
        </div>
      ) : null}

      {/* Canvas + inspector */}
      <div className="grid min-h-0 flex-1 grid-rows-2 gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] lg:grid-rows-1">
        <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border bg-card">
          <div
            ref={planeRef}
            className="relative origin-top-left transition-transform"
            style={{
              transform: `scale(${zoom / 100})`,
              minWidth: planeSize(draft).width,
              minHeight: planeSize(draft).height,
              backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
            data-testid="design-plane"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedId(null);
                setNotice(null);
              }
            }}
          >
            {/* Edges under the cards. */}
            <svg
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
              aria-hidden
              data-testid="design-edges"
            >
              {draft.nodes.flatMap((node) =>
                node.dependsOn.flatMap((dep) => {
                  const from = draft.nodes.find((other) => other.id === dep);
                  if (!from) return [];
                  const a = cardAnchor(from, draft, drag);
                  const b = cardAnchor(node, draft, drag);
                  const midX = (a.x + b.x) / 2;
                  return [
                    <path
                      key={`${dep}->${node.id}`}
                      d={`M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`}
                      fill="none"
                      stroke="var(--border)"
                      strokeWidth={2}
                      data-design-edge={`${dep}->${node.id}`}
                    />,
                  ];
                }),
              )}
              {connect
                ? (() => {
                    const from = draft.nodes.find((node) => node.id === connect.fromId);
                    if (!from) return null;
                    const a = cardAnchor(from, draft, drag);
                    const point = canvasPoint(connect.x, connect.y);
                    const midX = (a.x + point.x) / 2;
                    return (
                      <path
                        d={`M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${point.y}, ${point.x} ${point.y}`}
                        fill="none"
                        stroke="var(--ring)"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                      />
                    );
                  })()
                : null}
            </svg>
            {draft.nodes.map((node) => {
              const status = liveStatus(node.id);
              const selectedNode = selectedId === node.id;
              const live = status === "running";
              const position = drag?.id === node.id ? { x: drag.x, y: drag.y } : node.position ?? { x: 24, y: 24 };
              return (
                <div
                  key={node.id}
                  data-design-node-id={node.id}
                  data-testid={`design-node-${node.id}`}
                  role="button"
                  tabIndex={0}
                  aria-selected={selectedNode}
                  aria-label={`Node ${node.title}`}
                  className={`absolute rounded-lg border-2 bg-card p-3 text-left transition-[border-color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    selectedNode
                      ? "border-ring shadow-md"
                      : status
                        ? "border-border hover:bg-accent/50"
                        : // Designed, never run: the dashed border is the honesty mark.
                          "border-dashed border-muted-foreground/40 hover:bg-accent/50"
                  } ${drag?.id === node.id ? "cursor-grabbing shadow-lg" : "cursor-grab"}`}
                  style={{
                    left: position.x,
                    top: position.y,
                    width: DESIGN_NODE_WIDTH,
                    minHeight: DESIGN_NODE_HEIGHT,
                  }}
                  onPointerDown={(event) => startDrag(node, event)}
                  onClick={() => setSelectedId(node.id)}
                  onKeyDown={(event) => {
                    if ((event.key === "Delete" || event.key === "Backspace") && !live) {
                      event.preventDefault();
                      mutate(deleteDesignerNode(draft, node.id));
                      setSelectedId(null);
                    }
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <WorkGraphStatusIcon status={status} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.title}</span>
                    {selectedNode ? (
                      <Badge variant="secondary" className="text-[9px] tracking-wide">
                        SELECTED
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">
                      {node.harness}
                    </Badge>
                    {node.model ? (
                      <span className="truncate font-mono text-[10px]">{node.model}</span>
                    ) : null}
                    {!node.enabled ? <span>not to relaunch</span> : null}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground" data-testid={`design-node-state-${node.id}`}>
                    {status
                      ? workGraphStatusLabel(status)
                      : "Designed — never run"}
                  </p>
                  {live ? (
                    <Badge
                      variant="outline"
                      className="mt-1 text-[9px]"
                      data-testid={`design-node-live-${node.id}`}
                    >
                      Live session — harness locked
                    </Badge>
                  ) : null}
                  {/* The connect port: drag from here onto another card. */}
                  <button
                    type="button"
                    aria-label={`Draw a dependency from ${node.title}`}
                    className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full border-2 border-border bg-background hover:border-ring hover:ring-2 hover:ring-ring/40"
                    data-testid={`design-node-port-${node.id}`}
                    onPointerDown={(event) => startConnect(node.id, event)}
                    onKeyDown={(event) => event.stopPropagation()}
                  />
                </div>
              );
            })}
            {draft.nodes.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-16 mx-auto max-w-sm text-center" data-testid="design-empty-hint">
                <p className="text-sm font-medium">An empty canvas is an empty plan.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add a node, give it the prompt, pick its harness and model, and draw what waits
                  on what. Saving writes only the plan half of .drogon/graph.json.
                </p>
              </div>
            ) : null}
          </div>
        </ScrollArea>
        <div className="min-h-0 min-w-0">
          <ScrollArea className="h-full min-h-0">
            {selected ? (
              <NodeInspector
                key={selected.id}
                node={selected}
                draft={draft}
                graphDocument={document}
                harnesses={harnessCatalog.harnesses}
                harnessError={harnessCatalog.error}
                onChange={(patch) => {
                  const next = updateDesignerNode(draft, selected.id, patch);
                  // A provisional rename re-derives the id; keep the
                  // selection on the node, not on its old label.
                  if (!next.nodes.some((node) => node.id === selected.id)) {
                    const rederived = next.nodes.find(
                      (node) => node.title === patch.title,
                    );
                    if (rederived) setSelectedId(rederived.id);
                  }
                  mutate(next);
                }}
                onConnectToggle={(dep, present) => {
                  if (present) mutate(disconnectDesignerNodes(draft, dep, selected.id));
                  else {
                    const result = connectDesignerNodes(draft, dep, selected.id);
                    if (result.refusal) showRefusal(result.refusal);
                    else mutate(result.draft);
                  }
                }}
                onDelete={() => {
                  mutate(deleteDesignerNode(draft, selected.id));
                  setSelectedId(null);
                }}
              />
            ) : (
              <div
                className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground"
                data-testid="design-inspector-empty"
              >
                Select a node to edit its name, prompt, harness and model — or add one to begin.
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function defaultPlacement(draft: WorkGraphDraft): { x: number; y: number } {
  const rightmost = draft.nodes.reduce(
    (max, node) => Math.max(max, (node.position?.x ?? 24) + DESIGN_NODE_WIDTH),
    0,
  );
  return { x: rightmost + 48, y: 24 + draft.nodes.length * 8 };
}

function planeSize(draft: WorkGraphDraft): { width: number; height: number } {
  let width = 800;
  let height = 480;
  for (const node of draft.nodes) {
    width = Math.max(width, (node.position?.x ?? 0) + DESIGN_NODE_WIDTH + 96);
    height = Math.max(height, (node.position?.y ?? 0) + DESIGN_NODE_HEIGHT + 96);
  }
  return { width, height };
}

/** Where the edge endpoints sit for a node, honoring an in-flight drag. */
function cardAnchor(
  node: DesignerNode,
  _draft: WorkGraphDraft,
  drag: DragState | null,
): { x: number; y: number } {
  const position =
    drag?.id === node.id ? { x: drag.x, y: drag.y } : node.position ?? { x: 24, y: 24 };
  return {
    x: position.x + DESIGN_NODE_WIDTH,
    y: position.y + DESIGN_NODE_HEIGHT / 2,
  };
}

/** The selected node's editor: name, prompt, harness, model, enabled, and
 *  the dependency checkboxes — with the live-session honesty rules. */
function NodeInspector({
  node,
  draft,
  graphDocument,
  harnesses,
  harnessError,
  onChange,
  onConnectToggle,
  onDelete,
}: {
  node: DesignerNode;
  draft: WorkGraphDraft;
  graphDocument: WorkGraphDocument | null;
  harnesses: Harness[];
  harnessError: string | null;
  onChange: (patch: Partial<Pick<DesignerNode, "title" | "harness" | "model" | "prompt" | "enabled" | "verifyCommands">>) => void;
  onConnectToggle: (depId: string, currentlyDepends: boolean) => void;
  onDelete: () => void;
}): React.JSX.Element {
  const state = graphDocument ? stateNodeFor(graphDocument, node.id) : null;
  const live = state?.status === "running";
  const shell = node.harness === "shell";
  const modelCatalog = useMentuModelCatalog(shell ? "" : node.harness);
  const options = useMemo(
    () =>
      modelOptionsFromCatalog({
        catalog: modelCatalog.catalog,
        recipe: null,
        harness: shell ? "" : node.harness,
        excludeStepLabel: null,
      }),
    [modelCatalog.catalog, node.harness, shell],
  );
  const readout = modelCatalogReadout({
    catalog: modelCatalog.catalog,
    loading: modelCatalog.loading,
    error: modelCatalog.error,
    harness: node.harness,
    registered: REGISTERED_HARNESSES.includes(node.harness.trim().toLowerCase()),
    now: Date.now(),
    selectedModel: node.model,
    knownCount: shell ? 0 : knownModelsFor(node.harness).length,
  });
  const others = draft.nodes.filter((other) => other.id !== node.id);
  return (
    <div className="space-y-3 text-xs" data-testid="design-inspector" aria-label={`Edit node ${node.title}`}>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="design-field-title" className="text-xs text-muted-foreground">
            Name
          </Label>
          <span className="font-mono text-[10px] text-muted-foreground">{node.id}</span>
        </div>
        <Input
          id="design-field-title"
          value={node.title}
          onChange={(event) => onChange({ title: event.target.value })}
          className="mt-1 h-8 text-xs"
          data-testid="design-field-title"
        />
        <div className="mt-2 flex items-start justify-between gap-2">
          <Label htmlFor="design-field-prompt" className="text-xs text-muted-foreground">
            Prompt / task
          </Label>
          <span className="text-[10px] text-muted-foreground">{node.prompt.length} chars</span>
        </div>
        <Textarea
          id="design-field-prompt"
          value={node.prompt}
          onChange={(event) => onChange({ prompt: event.target.value })}
          className="mt-1 min-h-20 text-xs"
          placeholder="What should this node do?"
          data-testid="design-field-prompt"
        />
        <div className="mt-2 flex items-center gap-2">
          <Checkbox
            id="design-field-enabled"
            checked={node.enabled}
            onCheckedChange={(checked) => onChange({ enabled: checked === true })}
            data-testid="design-field-enabled"
          />
          <Label htmlFor="design-field-enabled" className="text-xs text-muted-foreground">
            Enabled (a disabled node is blocked, never launched)
          </Label>
        </div>
        <div className="mt-2">
          <Label htmlFor="design-field-verify" className="text-xs text-muted-foreground">
            Verify commands (one per line, optional)
          </Label>
          <Textarea
            id="design-field-verify"
            value={node.verifyCommands.join("\n")}
            onChange={(event) =>
              onChange({
                verifyCommands: event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0),
              })
            }
            className="mt-1 min-h-12 font-mono text-[11px]"
            placeholder="true"
            data-testid="design-field-verify"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Deterministic checks that decide the node&apos;s outcome — an agent node with none is
            only completed by its own printed keyword.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <Label className="text-xs text-muted-foreground">Harness</Label>
        <Select
          value={node.harness}
          onValueChange={(value) => onChange({ harness: value, model: "" })}
          disabled={live}
        >
          <SelectTrigger size="sm" className="mt-1 min-w-0" aria-label="Harness" data-testid="design-field-harness">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shell">shell — run a local command</SelectItem>
            {harnesses.map((harness) => (
              <SelectItem key={harness.harnessId} value={harness.harnessId}>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{harness.displayName}</span>
                  {harness.availability !== "available" ? (
                    <span className="text-[10px] text-muted-foreground">
                      ({harness.availability === "missing" ? "not installed" : "launcher unsupported"})
                    </span>
                  ) : null}
                  {!RUNNABLE_AGENT_HARNESSES.has(harness.harnessId) ? (
                    <span className="text-[10px] text-muted-foreground">
                      · no recipe adapter yet
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {harnessError ? (
          <p className="mt-1 text-[11px] text-destructive" role="status">
            Harness catalog unavailable: {harnessError}
          </p>
        ) : null}
        {live ? (
          <p className="mt-1 text-[11px] text-muted-foreground" data-testid="design-harness-locked">
            This node&apos;s session is live, so its harness cannot change. Start a new session with
            harness X if you need a different one — the change would apply at the next launch, not
            now.
          </p>
        ) : null}

        {shell ? (
          <p className="mt-2 text-[11px] text-muted-foreground" data-testid="design-shell-no-model">
            A shell node runs a local command — it has no model, and token metrics never apply to
            it.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="design-field-model" className="text-xs text-muted-foreground">
                Model
              </Label>
              <MentuModelPicker
                options={options}
                selected={node.model}
                onSelect={(model) => onChange({ model })}
                emptyReason={
                  modelCatalog.error
                    ? `The host enumerated nothing for ${node.harness}: ${modelCatalog.error}`
                    : modelCatalog.catalog
                      ? `The host enumerated no models for ${node.harness} (${modelCatalog.catalog.status}). Type an exact id — it rides unverified.`
                      : null
                }
              />
            </div>
            <Input
              id="design-field-model"
              value={node.model}
              onChange={(event) => onChange({ model: event.target.value })}
              placeholder="harness default"
              className="h-8 font-mono text-xs"
              data-testid="design-field-model"
            />
            <p className="text-[11px] text-muted-foreground" data-testid="design-model-readout">
              {readout.statusLine}
            </p>
            {live && state ? (
              <p className="text-[11px]" data-testid="design-next-launch-badge">
                Applies at the next launch — the live session keeps its current model.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <Label className="text-xs text-muted-foreground">Waits on</Label>
        {others.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">No other nodes yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {others.map((other) => {
              const depends = node.dependsOn.includes(other.id);
              return (
                <li key={other.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`design-dep-${other.id}`}
                    checked={depends}
                    onCheckedChange={() => onConnectToggle(other.id, depends)}
                    data-testid={`design-dep-${other.id}`}
                  />
                  <Label htmlFor={`design-dep-${other.id}`} className="min-w-0 flex-1 truncate text-xs">
                    {other.title}
                  </Label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">Danger zone</Label>
          <Trash2 className="size-3.5 text-muted-foreground" aria-hidden />
        </div>
        {live ? (
          <p className="mt-1 text-[11px] text-muted-foreground" data-testid="design-delete-refused">
            This node has a live session, so it cannot be deleted. Stop the session first — that is
            the honest action, not a silent removal.
          </p>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="mt-2"
            onClick={onDelete}
            data-testid="design-delete"
          >
            <X className="size-3.5" aria-hidden />
            Delete node
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        A dashed card was designed but never run. Observed statuses come only from the daemon&apos;s
        state records; clearing the model field returns the node to its harness default.
      </p>
    </div>
  );
}

