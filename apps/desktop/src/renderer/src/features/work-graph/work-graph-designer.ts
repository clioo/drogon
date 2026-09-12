// MIT Copyright (c) 2026 Lovecast Inc.
// The graph designer's EDITOR MODEL: pure functions over an in-memory
// draft of `.drogon/graph.json`'s `intent` half. No React, no I/O, no
// bridge — the component layer (WorkGraphDesigner.tsx) drives these and
// then persists through `graph.write_intent`, whose daemon-side store is
// the only writer of the file (atomic, intent-only, unknown-fields-merged).
//
// Contract notes this module enforces (mirroring
// `crates/drogon-protocol/src/graph.rs` and the store's merge semantics):
//   - a dependency edge A→B means "B depends on A" (A runs first);
//   - self-edges, duplicate edges, unknown dependencies and CYCLES are
//     refused — never silently rewritten;
//   - nodes the designer cannot parse (written by a newer tool, say) are
//     preserved VERBATIM through a save, because the daemon's merge keeps
//     only the nodes the payload still carries — dropping one would be a
//     silent deletion;
//   - unknown FIELDS on known nodes ride through untouched;
//   - the serialized payload NEVER contains a `state` key: `state` is the
//     daemon's half, observed, never authored here;
//   - the designer's canvas coordinates ride in each node's optional
//     `position` field — deliberately unknown to the daemon, preserved by
//     its merge, never execution semantics;
//   - auto-layout exists but is only ever EXPLICITLY requested: nothing
//     here reflows a position the user set deliberately.

import { z } from "zod";
import {
  designableIntentNodeSchema,
  graphWriteIntentPayloadSchema,
  type DesignableIntentNode,
} from "../../../../shared/graph-contract";

export const GRAPH_MAX_NODES = 200;
/** Card geometry, in canvas coordinates (CSS px at 100% zoom). */
export const DESIGN_NODE_WIDTH = 224;
export const DESIGN_NODE_HEIGHT = 96;
export const DESIGN_NODE_GAP_X = 96;
export const DESIGN_NODE_GAP_Y = 40;

/** One node under design. Known contract fields are typed; unknown fields
 *  captured by the passthrough parse ride in `extra` and serialize back
 *  untouched. */
export type DesignerNode = {
  id: string;
  title: string;
  harness: string;
  /** Exact model id, or "" for shell / harness default. */
  model: string;
  prompt: string;
  enabled: boolean;
  dependsOn: string[];
  verifyCommands: string[];
  provider: { baseUrl: string; apiKeyEnv: string } | null;
  /** Canvas coordinates; undefined = never positioned (auto-layout will). */
  position: { x: number; y: number } | null;
  extra: Record<string, unknown>;
  /** True while the node was added THIS session and never saved: its id
   *  may still be re-derived from the title. Cleared on save; a saved node
   *  keeps its id forever (the state half maps runs by id). */
  provisional: boolean;
};

export type DesignerIssue = {
  nodeId?: string;
  message: string;
};

export type WorkGraphDraft = {
  nodes: DesignerNode[];
  /** Nodes present in the file this build could not parse; preserved
   *  verbatim through any save, listed as issues, never editable. */
  preservedNodes: DesignableIntentNode[];
  issues: DesignerIssue[];
};

/** The known contract keys; everything else a passthrough parse produced
 *  lands in `extra` and rides back untouched. */
const KNOWN_NODE_KEYS = new Set([
  "id",
  "title",
  "harness",
  "model",
  "dependsOn",
  "prompt",
  "enabled",
  "verifyCommands",
  "provider",
  "position",
]);

export function emptyDraft(): WorkGraphDraft {
  return { nodes: [], preservedNodes: [], issues: [] };
}

/** Parses the intent nodes of the currently loaded document (or [] for a
 *  brand-new graph) into a draft. Unparseable nodes become preserved
 *  verbatim + an honest issue — never dropped, never invented. */
export function draftFromIntentNodes(
  intentNodes: ReadonlyArray<unknown>,
): WorkGraphDraft {
  const draft = emptyDraft();
  for (const raw of intentNodes ?? []) {
    const parsed = designableIntentNodeSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? issue.path.join(".") : "node";
      draft.issues.push({
        message: `A node this build cannot edit is preserved as-is (${where}: ${issue?.message ?? "invalid"})`,
      });
      if (raw !== null && typeof raw === "object") {
        draft.preservedNodes.push(raw as DesignableIntentNode);
      }
      continue;
    }
    const value = parsed.data as DesignableIntentNode & Record<string, unknown>;
    const extra: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "state") {
        // A `state` key never rides through — not at the payload's top
        // level and not hiding inside a node. `state` is the daemon's
        // half; the designer strips it and says so.
        draft.issues.push({
          message: `Node ${String(value.id)} carried a \`state\` key; it was dropped — that half is the daemon's, observed, never authored here.`,
        });
        continue;
      }
      if (!KNOWN_NODE_KEYS.has(key)) extra[key] = entry;
    }
    draft.nodes.push({
      id: value.id,
      title: value.title,
      harness: value.harness,
      model: value.model ?? "",
      prompt: value.prompt ?? "",
      enabled: value.enabled ?? true,
      dependsOn: [...(value.dependsOn ?? [])],
      verifyCommands: [...(value.verifyCommands ?? [])],
      provider: value.provider ? { ...value.provider } : null,
      position: value.position ? { ...value.position } : null,
      extra,
      provisional: false,
    });
  }
  return draft;
}

/** A slug id from a title: readable, unique in the draft, contract-sized
 *  (<= 64 bytes). `plan` → `plan`, second `plan` → `plan-2`. */
export function designerNodeId(title: string, existingIds: ReadonlySet<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "node";
  let candidate = base;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

/** Adds a node. The caller supplies canvas placement (or null to let
 *  auto-layout / the default placement handle it). */
export function addDesignerNode(
  draft: WorkGraphDraft,
  seed: Partial<Pick<DesignerNode, "title" | "harness" | "model" | "prompt" | "position">> = {},
): { draft: WorkGraphDraft; node: DesignerNode } {
  if (draft.nodes.length + draft.preservedNodes.length >= GRAPH_MAX_NODES) {
    return {
      draft: withIssue(draft, { message: `The graph is limited to ${GRAPH_MAX_NODES} nodes.` }),
      node: undefined as unknown as DesignerNode,
    };
  }
  const title = seed.title?.trim() || "New node";
  const id = designerNodeId(
    title,
    new Set([
      ...draft.nodes.map((node) => node.id),
      ...draft.preservedNodes.map((node) => node.id),
    ]),
  );
  const node: DesignerNode = {
    id,
    title,
    harness: seed.harness ?? "shell",
    model: seed.model ?? "",
    prompt: seed.prompt ?? "",
    enabled: true,
    dependsOn: [],
    verifyCommands: [],
    provider: null,
    position: seed.position ?? null,
    extra: {},
    provisional: true,
  };
  return { draft: { ...draft, nodes: [...draft.nodes, node] }, node };
}

function withIssue(draft: WorkGraphDraft, issue: DesignerIssue): WorkGraphDraft {
  return { ...draft, issues: [...draft.issues, issue] };
}

export function updateDesignerNode(
  draft: WorkGraphDraft,
  id: string,
  patch: Partial<Pick<DesignerNode, "title" | "harness" | "model" | "prompt" | "enabled" | "position" | "provider" | "verifyCommands">>,
): WorkGraphDraft {
  // A never-saved node's id is still derivable from its title, so a
  // rename re-derives it (deduped against the others). A saved node NEVER
  // changes id — the daemon's state records map runs to nodes by id.
  // When a provisional id DOES change, every edge that named the old id
  // is remapped so a rename can never dangle a dependency.
  const target = draft.nodes.find((candidate) => candidate.id === id);
  let derivedId: string | null = null;
  if (target?.provisional && patch.title !== undefined) {
    const derived = designerNodeId(
      patch.title,
      new Set(
        draft.nodes
          .filter((other) => other.id !== id)
          .map((other) => other.id),
      ),
    );
    if (derived !== id) derivedId = derived;
  }
  return {
    ...draft,
    nodes: draft.nodes.map((candidate) => {
      if (candidate.id === id) {
        const next = { ...candidate, ...patch };
        if (derivedId !== null) next.id = derivedId;
        return next;
      }
      if (derivedId !== null) {
        return {
          ...candidate,
          dependsOn: candidate.dependsOn.map((dep) => (dep === id ? derivedId : dep)),
        };
      }
      return candidate;
    }),
  };
}

/** Removes a node and every dependency edge that named it. The caller (UI
 *  layer) refuses first when a live session makes the node undeletable. */
export function deleteDesignerNode(draft: WorkGraphDraft, id: string): WorkGraphDraft {
  return {
    ...draft,
    nodes: draft.nodes
      .filter((node) => node.id !== id)
      .map((node) => ({
        ...node,
        dependsOn: node.dependsOn.filter((dep) => dep !== id),
      })),
  };
}

/** Clears the provisional flag after a successful save: from now on the
 *  persisted ids are immutable identity. */
export function markDesignerSaved(draft: WorkGraphDraft): WorkGraphDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) => ({ ...node, provisional: false })),
  };
}

export type ConnectRefusal =
  | { kind: "unknown"; message: string }
  | { kind: "self"; message: string }
  | { kind: "duplicate"; message: string }
  | { kind: "cycle"; message: string };

/** Connects `fromId → toId` (toId will depend on fromId). Refuses unknown
 *  ids, self-edges, duplicates and — before anything is mutated — any edge
 *  that would close a cycle. */
export function connectDesignerNodes(
  draft: WorkGraphDraft,
  fromId: string,
  toId: string,
): { draft: WorkGraphDraft; refusal: ConnectRefusal | null } {
  const known = new Set(draft.nodes.map((node) => node.id));
  if (!known.has(fromId) || !known.has(toId)) {
    return {
      draft,
      refusal: { kind: "unknown", message: "Both nodes must exist to draw a dependency." },
    };
  }
  if (fromId === toId) {
    return {
      draft,
      refusal: { kind: "self", message: "A node cannot depend on itself." },
    };
  }
  const target = draft.nodes.find((node) => node.id === toId);
  if (target?.dependsOn.includes(fromId)) {
    return {
      draft,
      refusal: {
        kind: "duplicate",
        message: "That dependency is already drawn.",
      },
    };
  }
  if (wouldCreateCycle(draft.nodes, fromId, toId)) {
    return {
      draft,
      refusal: {
        kind: "cycle",
        message:
          "That edge would close a dependency cycle: a node cannot end up waiting on itself.",
      },
    };
  }
  return {
    draft: {
      ...draft,
      nodes: draft.nodes.map((node) =>
        node.id === toId
          ? { ...node, dependsOn: [...node.dependsOn, fromId] }
          : node,
      ),
    },
    refusal: null,
  };
}

/** Removes the dependency edge `fromId → toId` when present. */
export function disconnectDesignerNodes(
  draft: WorkGraphDraft,
  fromId: string,
  toId: string,
): WorkGraphDraft {
  return {
    ...draft,
    nodes: draft.nodes.map((node) =>
      node.id === toId
        ? { ...node, dependsOn: node.dependsOn.filter((dep) => dep !== fromId) }
        : node,
    ),
  };
}

/** True when adding `fromId → toId` (toId will depend on fromId) would
 *  close a cycle: fromId already (transitively) depends on toId. */
export function wouldCreateCycle(
  nodes: ReadonlyArray<Pick<DesignerNode, "id" | "dependsOn">>,
  fromId: string,
  toId: string,
): boolean {
  // Walk UP the dependency chain from fromId (following dependsOn edges):
  // reaching toId means fromId already depends on toId, so the new edge
  // would make toId wait on fromId while it waits on toId.
  const edges = new Map<string, string[]>();
  for (const node of nodes) edges.set(node.id, [...node.dependsOn]);
  const stack = [fromId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === toId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of edges.get(current) ?? []) stack.push(next);
  }
  return false;
}

/** The draft's cycle, as node titles, when one exists (a preserved node's
 *  edges are unknowable here, so only editable nodes participate — the
 *  daemon still refuses the whole write if the preserved shape is cyclic). */
export function draftCycle(draft: WorkGraphDraft): string[] | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const byId = new Map(draft.nodes.map((node) => [node.id, node]));
  let cycle: string[] | null = null;
  const visit = (id: string): void => {
    if (cycle) return;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      cycle = stack
        .slice(start === -1 ? 0 : start)
        .concat(id)
        .map((nodeId) => byId.get(nodeId)?.title ?? nodeId);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    visiting.delete(id);
    stack.pop();
    visited.add(id);
  };
  for (const node of draft.nodes) visit(node.id);
  return cycle;
}

/** The canvas coordinates the draft already carries vs the ones the
 *  auto-layout WOULD assign — surfaced so the button can say what it will
 *  move before the user asks it to. Auto-layout is a request, never an
 *  implicit reflow. */
export function autoLayoutPositions(
  draft: WorkGraphDraft,
): Map<string, { x: number; y: number }> {
  // Longest-path layering over editable nodes (same algorithm as the read
  // view's layout), then columns left→right by depth, rows top→bottom in
  // first-seen order.
  const byId = new Map(draft.nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id) as number;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let value = 0;
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) value = Math.max(value, depthOf(dep) + 1);
    }
    visiting.delete(id);
    visited.add(id);
    depth.set(id, value);
    return value;
  };
  for (const node of draft.nodes) depthOf(node.id);
  const columns = new Map<number, string[]>();
  for (const node of draft.nodes) {
    const column = depth.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node.id]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const [column, ids] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, row) => {
      positions.set(id, {
        x: column * (DESIGN_NODE_WIDTH + DESIGN_NODE_GAP_X) + 24,
        y: row * (DESIGN_NODE_HEIGHT + DESIGN_NODE_GAP_Y) + 24,
      });
    });
  }
  return positions;
}

/** Applies the auto-layout's positions to the draft. Called only from the
 *  explicit Auto-layout action. */
export function applyAutoLayout(draft: WorkGraphDraft): WorkGraphDraft {
  const positions = autoLayoutPositions(draft);
  return {
    ...draft,
    nodes: draft.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    })),
  };
}

/** Validation mirrors of the daemon's `GraphNodeIntent::validate`, so the
 *  author sees the refusal before the IPC hop rather than after. Returns
 *  the list of problems; empty means the payload is sendable. */
const textEncoder = new TextEncoder();

export function draftValidationIssues(draft: WorkGraphDraft): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const node of draft.nodes) {
    if (seen.has(node.id)) issues.push(`Duplicate node id: ${node.id}`);
    seen.add(node.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(node.id))
      issues.push(
        `Node id ${JSON.stringify(node.id)} must match [A-Za-z0-9][A-Za-z0-9_.:-]{0,63}.`,
      );
    if (node.title.trim().length === 0 || textEncoder.encode(node.title).length > 512)
      issues.push(`Node ${node.id}: title must be 1..=512 bytes.`);
    if (!/^[a-z0-9-]{1,64}$/.test(node.harness))
      issues.push(`Node ${node.id}: pick a harness from the catalog.`);
    if (node.model.length > 256)
      issues.push(`Node ${node.id}: model id must be at most 256 bytes.`);
    if (node.prompt.trim().length === 0 || node.prompt.length > 65_536)
      issues.push(`Node ${node.id}: give it a prompt (1..=65536 bytes).`);
    if (node.dependsOn.length > 64)
      issues.push(`Node ${node.id}: too many dependencies.`);
    for (const dep of node.dependsOn) {
      if (dep === node.id)
        issues.push(`Node ${node.id} depends on itself.`);
      else if (!seen.has(dep) && !draft.nodes.some((other) => other.id === dep))
        issues.push(`Node ${node.id} depends on unknown node ${dep}.`);
    }
  }
  if (draft.nodes.length + draft.preservedNodes.length > GRAPH_MAX_NODES)
    issues.push(`The graph is limited to ${GRAPH_MAX_NODES} nodes.`);
  return issues;
}

/** The exact `intent` payload a save sends: known fields serialize in the
 *  daemon's own order (id, title, harness, model, dependsOn, prompt,
 *  enabled, provider?, verifyCommands?, position?), unknown fields ride
 *  untouched, and there is NO `state` key — ever. Nodes that must exist to
 *  be editable but are contract-invalid stay in the payload; the daemon
 *  re-validates and refuses the whole write, which the UI surfaces. */
export function toIntentPayload(draft: WorkGraphDraft): {
  payload: { nodes: Record<string, unknown>[] };
  issues: string[];
} {
  const issues = draftValidationIssues(draft);
  const nodes: Record<string, unknown>[] = draft.nodes.map((node) => {
    const serialized: Record<string, unknown> = {
      id: node.id,
      title: node.title,
      harness: node.harness,
      model: node.model,
      dependsOn: [...node.dependsOn],
      prompt: node.prompt,
      enabled: node.enabled,
    };
    if (node.provider) serialized.provider = { ...node.provider };
    if (node.verifyCommands.length > 0) serialized.verifyCommands = [...node.verifyCommands];
    if (node.position) serialized.position = { ...node.position };
    for (const [key, value] of Object.entries(node.extra)) serialized[key] = value;
    return serialized;
  });
  const payload = { nodes: [...nodes, ...draft.preservedNodes] };
  const checked = graphWriteIntentPayloadSchema.safeParse(payload);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    issues.push(issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid intent payload.");
  }
  if (textEncoder.encode(JSON.stringify(payload)).length > 65_536 * 8) {
    // Sanity bound only; the daemon's MAX_FILE_BYTES is the real gate.
    issues.push("The graph payload is too large to save.");
  }
  return { payload, issues };
}

/** The schema the component uses to parse a saved document's intent back
 *  (round-trip check in tests). */
export const roundTripIntentNodeSchema = z.object({ id: z.string() }).passthrough();
