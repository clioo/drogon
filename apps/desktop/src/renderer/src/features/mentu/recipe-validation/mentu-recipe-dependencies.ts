// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-dependencies.ts`: unknown-dependency and
// cycle detection over step/node labels. Only the import source is
// adapted (the sibling document-types module).

import type { MentuRecipeValidationIssue } from "./mentu-recipe-document";

export function validateMentuRecipeDependencies(
  labels: string[],
  values: (string[] | undefined)[],
  path: string,
  issues: MentuRecipeValidationIssue[],
): void {
  const known = new Set(labels);
  const edges = new Map(labels.map((label, index) => [label, values[index] ?? []]));
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
