// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-graph.ts`: the recipe
// dependency DAG projection plus the per-step attempt-record helpers.
// Adapted only in the data layer: nodes project this repo's
// `MentuStep` (label/backend/dependsOn — the daemon recipe format has no
// child recipes, so every node is a step) and attempt records project
// `MentuStepRun` (attempts/duration/exit code from the daemon run record).

import type {
  MentuStep,
  MentuStepRun,
} from "../../../../shared/mentu-contract";

export type RecipeGraphNode = {
  id: string;
  label: string;
  kind: "step";
  dependencies: string[];
  step?: MentuStep;
  depth: number;
};

export type RecipeGraph = {
  valid: boolean;
  nodes: RecipeGraphNode[];
  cycle: string[] | null;
  issues: string[];
};

/** Projects recipe steps directly into a dependency DAG. */
export function buildRecipeGraph(steps: MentuStep[]): RecipeGraph {
  const nodes: RecipeGraphNode[] = [];
  const labels = new Map<string, string>();
  const issues: string[] = [];
  const addLabel = (label: string, id: string): void => {
    if (labels.has(label)) {
      issues.push(`Duplicate dependency label: ${label}`);
      return;
    }
    labels.set(label, id);
  };

  for (const step of steps ?? []) {
    const id = `step:${step.label}`;
    addLabel(step.label, id);
    nodes.push({ id, label: step.label, kind: "step", dependencies: [], step, depth: 0 });
  }

  const nodeByLabel = new Map(nodes.map((node) => [node.label, node]));
  for (const node of nodes) {
    const declaredDependencies = node.step?.dependsOn ?? [];
    for (const dependency of declaredDependencies) {
      const dependencyNode = nodeByLabel.get(dependency);
      if (!dependencyNode) {
        issues.push(`${node.label}: unknown dependency ${dependency}`);
        continue;
      }
      node.dependencies.push(dependencyNode.id);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] | null = null;
  const visit = (node: RecipeGraphNode): number => {
    if (cycle) {
      return 0;
    }
    if (visiting.has(node.id)) {
      cycle = [node.label];
      return 0;
    }
    if (visited.has(node.id)) {
      return node.depth;
    }
    visiting.add(node.id);
    let depth = 0;
    for (const dependencyId of node.dependencies) {
      const dependency = nodes.find((candidate) => candidate.id === dependencyId);
      if (dependency) {
        depth = Math.max(depth, visit(dependency) + 1);
      }
    }
    visiting.delete(node.id);
    visited.add(node.id);
    node.depth = depth;
    return depth;
  };
  for (const node of nodes) {
    visit(node);
  }

  return {
    valid: issues.length === 0 && cycle === null,
    nodes: cycle ? [] : nodes,
    cycle,
    issues,
  };
}

/** Orders same-label attempt records oldest to newest using the recorded
 *  lifetime attempts count, with array position as a tiebreaker. */
function sortAttemptRecords(steps: MentuStepRun[]): MentuStepRun[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const diff = (a.step.attempts ?? 0) - (b.step.attempts ?? 0);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ step }) => step);
}

/** Every recorded attempt for a step label, oldest first. Empty when there
 *  is no run or no matching records. */
export function stepAttemptRecords(
  steps: MentuStepRun[] | null | undefined,
  label: string,
): MentuStepRun[] {
  if (!steps) {
    return [];
  }
  return sortAttemptRecords(steps.filter((step) => step.label === label));
}

/** Groups a run's step records by label, preserving first-seen label order;
 *  each group's attempts are oldest first. */
export function groupStepAttempts(
  steps: MentuStepRun[],
): { label: string; attempts: MentuStepRun[] }[] {
  const order: string[] = [];
  const byLabel = new Map<string, MentuStepRun[]>();
  for (const step of steps) {
    if (!byLabel.has(step.label)) {
      order.push(step.label);
      byLabel.set(step.label, []);
    }
    byLabel.get(step.label)?.push(step);
  }
  return order.map((label) => ({
    label,
    attempts: sortAttemptRecords(byLabel.get(label) ?? []),
  }));
}

/** The newest recorded attempt for a step label, per actual attempt
 *  ordering — not necessarily the first match. */
export function nodeRunRecord(
  steps: MentuStepRun[] | null | undefined,
  label: string,
): MentuStepRun | null {
  const records = stepAttemptRecords(steps, label);
  return records.at(-1) ?? null;
}
