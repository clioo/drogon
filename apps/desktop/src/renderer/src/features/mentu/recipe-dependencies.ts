// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/shared/mentu-recipe-dependencies.ts`: dependency validation over
// step labels plus a topological ordering for execution display. Adapted
// only in the data layer to this repo's `MentuStep` (dependsOn).

import type { MentuStep } from "../../../../shared/mentu-contract";

export type RecipeDependencyIssue = { path: string; message: string };

export function validateRecipeDependencies(
  steps: MentuStep[],
  path: string,
  issues: RecipeDependencyIssue[],
): void {
  const labels = steps.map((step) => step.label);
  const known = new Set(labels);
  const edges = new Map(labels.map((label, index) => [label, steps[index]?.dependsOn ?? []]));
  for (const [label, dependencies] of edges) {
    for (const dependency of dependencies) {
      if (!known.has(dependency)) {
        issues.push({ path: `${path}.${label}`, message: `unknown dependency: ${dependency}` });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (label: string): void => {
    if (visiting.has(label)) {
      issues.push({ path, message: `dependency cycle includes ${label}` });
      return;
    }
    if (visited.has(label)) {
      return;
    }
    visiting.add(label);
    for (const dependency of edges.get(label) ?? []) {
      if (known.has(dependency)) {
        visit(dependency);
      }
    }
    visiting.delete(label);
    visited.add(label);
  };

  for (const label of labels) {
    visit(label);
  }
}

/** Step labels in dependency order (dependencies before dependents).
 *  Labels inside a cycle keep their recipe order after their acyclic
 *  dependencies; unknown dependencies are ignored. */
export function orderStepsByDependency(steps: MentuStep[]): string[] {
  const known = new Set(steps.map((step) => step.label));
  const edges = new Map(
    steps.map((step) => [step.label, (step.dependsOn ?? []).filter((dep) => known.has(dep))]),
  );
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (label: string): void => {
    if (visited.has(label) || visiting.has(label)) {
      return;
    }
    visiting.add(label);
    for (const dependency of edges.get(label) ?? []) {
      visit(dependency);
    }
    visiting.delete(label);
    visited.add(label);
    ordered.push(label);
  };
  for (const step of steps) {
    visit(step.label);
  }
  return ordered;
}
