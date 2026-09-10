// MIT Copyright (c) 2026 Lovecast Inc.
// Honest classification of a workspace's `.mentu/recipes` directory for the
// Mentu empty state. The daemon's `mentu.recipes` reports the recipes it
// found (invalid files included, with their issue) but — by design — an
// absent directory is just an empty catalog, so "missing" versus "present
// but empty" versus "present with files" needs one real `files.list` probe
// of the directory itself. `unknown` covers the degraded paths (no files
// capability, no bridge): the UI then says less instead of guessing.

import type { FileBridge } from "../../../../shared/file-contract";
import type { MentuRecipeSummary } from "../../../../shared/mentu-contract";

export const MENTU_RECIPES_DIR = ".mentu/recipes";

/** Why the recipe surface has nothing to show, as observed on disk. */
export type MentuRecipeDirectoryStatus =
  | { kind: "unknown" }
  | { kind: "missing" }
  | { kind: "empty" }
  | { kind: "present"; fileCount: number }
  | { kind: "failed"; reason: string };

export type MentuInvalidRecipe = {
  id: string;
  path: string;
  issue: string;
};

/** One real listing of `.mentu/recipes`, classified for display. */
export async function probeMentuRecipeDirectory(
  fileBridge: FileBridge | null,
  input: { hostId: string | null; workspaceId: string },
): Promise<MentuRecipeDirectoryStatus> {
  if (!fileBridge || input.hostId === null) return { kind: "unknown" };
  const result = await fileBridge.fileList({
    hostId: input.hostId,
    workspaceId: input.workspaceId,
    path: MENTU_RECIPES_DIR,
  });
  if (!result.ok) {
    // The daemon reports an absent directory as a lookup failure ("directory
    // not found"); anything else is a real error worth naming verbatim.
    return /not found/i.test(result.error.message)
      ? { kind: "missing" }
      : { kind: "failed", reason: result.error.message };
  }
  // A directory holding no recipe FILES is the "present but empty" case,
  // whatever subdirectories it may have.
  const files = result.result.entries.filter((entry) => entry.kind === "file");
  return files.length === 0
    ? { kind: "empty" }
    : { kind: "present", fileCount: files.length };
}

export type ProbeMentuRecipeDirectoryParams = Parameters<
  typeof probeMentuRecipeDirectory
>;

/** Every recipe file the daemon refused, with its filename and reason. */
export function invalidMentuRecipes(
  recipes: MentuRecipeSummary[],
): MentuInvalidRecipe[] {
  return recipes
    .filter((recipe) => !recipe.valid)
    .map((recipe) => ({
      id: recipe.id,
      path: recipe.path,
      issue: recipe.issue ?? "Recipe is missing \"name\" or \"steps\".",
    }));
}

/** Shape of the runtime report the surface needs (shared/mentu-contract's
 *  MentuRuntimeInfo, narrowed to the fields this copy reasons about). */
export type MentuRuntimeProbe = {
  available: boolean;
  lockMatches: boolean;
  actualSha256: string | null;
  message: string | null;
};

/**
 * The empty state's runtime line: when the optional runtime is not usable
 * on this host, say so — and blame the HOST, never the workspace. Null
 * when the runtime is fine or simply unknown (no report yet).
 */
export function mentuRuntimeNote(
  runtime: MentuRuntimeProbe | null | undefined,
): string | null {
  if (!runtime) return null;
  const detail = runtime.message ? ` Runtime report: ${runtime.message}` : "";
  if (runtime.actualSha256 === null) {
    return (
      "The optional Mentu runtime is not installed on this host, so recipes " +
      "can be viewed here but not run. That is a machine-level setting, not " +
      "a problem with this workspace." +
      detail
    );
  }
  if (!runtime.available || !runtime.lockMatches) {
    return (
      "A Mentu runtime exists on this host but does not match the approved " +
      "runtime lock, so recipes can be viewed here but not run." +
      detail
    );
  }
  return null;
}

/**
 * The empty state's honest one-line verdict, from the on-disk probe plus
 * the daemon's own catalog. Pure so the copy is unit-testable.
 */
export function describeMentuRecipeDirectory(
  status: MentuRecipeDirectoryStatus,
  recipes: MentuRecipeSummary[],
): string {
  const validCount = recipes.filter((recipe) => recipe.valid).length;
  if (validCount > 0) {
    return "Select a recipe above to view its graph here.";
  }
  switch (status.kind) {
    case "missing":
      return "No .mentu/recipes directory yet — this workspace has never had a recipe.";
    case "empty":
      return "The .mentu/recipes directory exists but holds no recipe files.";
    case "present":
      return `The .mentu/recipes directory holds ${status.fileCount} file${
        status.fileCount === 1 ? "" : "s"
      } and none of them is a valid recipe.`;
    case "failed":
      return `The .mentu/recipes directory could not be read: ${status.reason}`;
    case "unknown":
      return "Select a valid workspace recipe to view its graph.";
  }
}
