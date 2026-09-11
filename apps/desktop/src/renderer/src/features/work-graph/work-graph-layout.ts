// MIT Copyright (c) 2026 Lovecast Inc.
// Work-graph DAG projection: the intent nodes of `.drogon/graph.json`
// layered for display. Structure adapted from this repo's proven
// `features/mentu/recipe-graph.ts` (longest-path layering plus cycle
// detection) but keyed by stable node id (the contract's `id`, never
// reused) instead of recipe labels, and carrying each node's resolved
// dependency TITLES so the view can name the parent a node waits on.

import type { WorkGraphIntentNode } from "../../../../shared/work-graph-contract";

export type WorkGraphNode = {
  id: string;
  title: string;
  harness: string;
  model: string | null;
  prompt: string;
  enabled: boolean;
  /** Resolved dependency ids (only those that exist in the graph). */
  dependencies: string[];
  /** 0 = no dependencies (the graph's left column). */
  depth: number;
};

export type WorkGraphLayout = {
  nodes: WorkGraphNode[];
  /** The dependency cycle's node titles, when one exists. A cyclic graph
   *  renders the refusal, never a made-up ordering. */
  cycle: string[] | null;
  issues: string[];
};

/** Layers the intent nodes for display. Unknown and duplicate dependencies
 *  become named issues instead of silent rewrites; cycles refuse layout. */
export function buildWorkGraphLayout(
  intentNodes: WorkGraphIntentNode[],
): WorkGraphLayout {
  const issues: string[] = [];
  const nodes: WorkGraphNode[] = [];
  const byId = new Map<string, WorkGraphNode>();

  for (const intent of intentNodes ?? []) {
    if (byId.has(intent.id)) {
      issues.push(`Duplicate node id: ${intent.id}`);
      continue;
    }
    const node: WorkGraphNode = {
      id: intent.id,
      title: intent.title,
      harness: intent.harness,
      model: intent.model ?? null,
      prompt: intent.prompt,
      enabled: intent.enabled,
      dependencies: [],
      depth: 0,
    };
    nodes.push(node);
    byId.set(intent.id, node);
  }

  for (const intent of intentNodes ?? []) {
    const node = byId.get(intent.id);
    if (!node) continue; // duplicate already reported
    for (const dependency of intent.dependsOn ?? []) {
      if (!byId.has(dependency)) {
        issues.push(`${intent.title}: unknown dependency ${dependency}`);
        continue;
      }
      if (dependency === intent.id) {
        issues.push(`${intent.title}: depends on itself`);
        continue;
      }
      node.dependencies.push(dependency);
    }
  }

  // Longest-path layering with the reference's visiting/visited guards.
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] | null = null;
  const visit = (node: WorkGraphNode): number => {
    if (cycle) return 0;
    if (visiting.has(node.id)) {
      cycle = [node.title];
      return 0;
    }
    if (visited.has(node.id)) return node.depth;
    visiting.add(node.id);
    let depth = 0;
    for (const dependencyId of node.dependencies) {
      const dependency = byId.get(dependencyId);
      if (dependency) depth = Math.max(depth, visit(dependency) + 1);
    }
    visiting.delete(node.id);
    visited.add(node.id);
    node.depth = depth;
    return depth;
  };
  for (const node of nodes) visit(node);

  return {
    nodes: cycle ? [] : nodes,
    cycle,
    issues,
  };
}

/** Titles of the (existing) dependencies of one laid-out node, in declared
 *  order — what the inspector and node card name as "waits for". */
export function dependencyTitles(
  layout: WorkGraphLayout,
  node: WorkGraphNode,
): string[] {
  const byId = new Map(layout.nodes.map((entry) => [entry.id, entry]));
  return node.dependencies
    .map((id) => byId.get(id)?.title ?? id)
    .filter(Boolean);
}
