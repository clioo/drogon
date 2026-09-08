// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/mentu-session-draft-state.ts`: the
// draft-source helpers (a per-path text draft distinct from the saved
// document, its validation-gated apply, and issue formatting). Only the
// state type is adapted: the fork threads its app-store persisted state,
// while this repo's tab keeps a plain `draftSourceByPath` map (see
// `MentuDraftState`), so the helpers take that shape directly.

import type {
  MentuRecipeDocument,
  MentuRecipeValidationIssue,
} from "./recipe-validation/mentu-recipe-document";
import { parseMentuRecipeJson } from "./recipe-validation/mentu-recipe-validation";

/** The tab-local persisted draft: edited source text keyed by recipe path. */
export type MentuDraftState = {
  draftSourceByPath: Record<string, string>;
};

export function formatMentuValidationIssues(issues: MentuRecipeValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join(" · ");
}

export function applyMentuDraftSource(
  document: MentuRecipeDocument,
  source: string,
): { document: MentuRecipeDocument } | { message: string } {
  try {
    const parsed = parseMentuRecipeJson(JSON.parse(source) as unknown);
    if (!parsed.ok) {
      return { message: formatMentuValidationIssues(parsed.issues) };
    }
    return {
      document: {
        ...document,
        recipe: parsed.recipe,
        raw: parsed.raw,
        unknownFields: parsed.unknownFields,
      },
    };
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Draft source is not valid JSON." };
  }
}

export function hasMentuDraftForPath(
  state: MentuDraftState | undefined,
  path: string | null,
): path is string {
  return Boolean(path && state && Object.hasOwn(state.draftSourceByPath, path));
}

export function withMentuDraftSource(
  state: MentuDraftState | undefined,
  path: string,
  source: string,
): Record<string, string> {
  return { ...state?.draftSourceByPath, [path]: source };
}

export function withoutMentuDraftSource(
  state: MentuDraftState | undefined,
  path: string,
): Record<string, string> {
  const next = { ...state?.draftSourceByPath };
  delete next[path];
  return next;
}
