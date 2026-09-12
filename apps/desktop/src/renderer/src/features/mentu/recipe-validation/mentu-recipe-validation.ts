// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-validation.ts`: the whole-recipe parser and
// its `validate`/`require`/`clone` conveniences. Only the import
// sources are adapted (sibling modules in this directory).

import type {
  MentuJsonValue,
  MentuRecipeDefinition,
  MentuRecipeNode,
  MentuRecipeParseResult,
  MentuRecipeStep,
  MentuRecipeType,
  MentuRecipeUnknownFields,
  MentuRecipeValidationIssue,
} from "./mentu-recipe-document";
import { validateMentuRecipeDependencies } from "./mentu-recipe-dependencies";
import { parseMentuRecipeNode, parseMentuRecipeStep } from "./mentu-recipe-entry-validation";
import {
  MENTU_RECIPE_NODE_FIELDS,
  MENTU_RECIPE_ROOT_FIELDS,
  MENTU_RECIPE_STEP_FIELDS,
} from "./mentu-recipe-fields";
import {
  validateMentuCloud,
  validateMentuHooks,
  validateMentuProviders,
} from "./mentu-recipe-root-validation";
import {
  cloneMentuRecipeValue,
  collectUnknownMentuFields,
  isMentuRecipeObject,
  isMentuRecipeString,
  parseMentuInteger,
  parseMentuStringMap,
  parseOptionalMentuString,
} from "./mentu-recipe-value-validation";

const TYPES = new Set<MentuRecipeType>(["sequence", "formula", "compound", "pipeline", "parallel"]);

export class MentuRecipeValidationError extends Error {
  constructor(readonly issues: MentuRecipeValidationIssue[]) {
    super(issues[0] ? `${issues[0].path}: ${issues[0].message}` : "Invalid Work Graph recipe");
    this.name = "MentuRecipeValidationError";
  }
}

export function parseMentuRecipeJson(input: unknown): MentuRecipeParseResult {
  if (!isMentuRecipeObject(input)) {
    return { ok: false, issues: [{ path: "$", message: "recipe must be a JSON object" }] };
  }
  const issues: MentuRecipeValidationIssue[] = [];
  const type = input.type === undefined || input.type === null ? "sequence" : input.type;
  if (!isMentuRecipeString(type) || !TYPES.has(type as MentuRecipeType)) {
    issues.push({ path: "type", message: "must be a supported Work Graph recipe type" });
  }
  if (!isMentuRecipeString(input.name) || input.name.trim().length === 0) {
    issues.push({ path: "name", message: "must be a non-empty string" });
  }

  const steps = Array.isArray(input.steps)
    ? input.steps
        .map((item, index) => parseMentuRecipeStep(item, index, issues))
        .filter((item): item is MentuRecipeStep => item !== null)
    : undefined;
  const nodes = Array.isArray(input.recipes)
    ? input.recipes
        .map((item, index) => parseMentuRecipeNode(item, index, issues))
        .filter((item): item is MentuRecipeNode => item !== null)
    : undefined;
  if (!Array.isArray(input.steps)) {
    issues.push({ path: "steps", message: "must be an array" });
  }
  if (input.recipes !== undefined && !Array.isArray(input.recipes)) {
    issues.push({ path: "recipes", message: "must be an array" });
  }

  const effectiveType = type as MentuRecipeType;
  if (
    (effectiveType === "sequence" || effectiveType === "formula") &&
    (!steps || steps.length === 0)
  ) {
    issues.push({ path: "steps", message: "recipe requires at least one step" });
  }
  if (
    effectiveType !== "sequence" &&
    effectiveType !== "formula" &&
    (!nodes || nodes.length === 0)
  ) {
    issues.push({ path: "recipes", message: "recipe requires at least one recipe node" });
  }
  if (steps) {
    validateEntries(
      steps.map((item) => item.label),
      steps.map((item) => item.depends_on),
      "steps",
      "step labels must be unique",
      issues,
    );
  }
  if (nodes) {
    validateEntries(
      nodes.map((item) => item.label ?? item.recipe),
      nodes.map((item) => item.depends_on),
      "recipes",
      "recipe node labels must be unique",
      issues,
    );
  }

  const description = parseOptionalMentuString(input.description, "description", issues);
  const backend = parseOptionalMentuString(input.backend, "backend", issues);
  const model = parseOptionalMentuString(input.model, "model", issues);
  const env = parseMentuStringMap(input.env, "env", issues);
  const providers = validateMentuProviders(input.providers, issues);
  const cloud = validateMentuCloud(input.cloud, issues);
  const hooks = validateMentuHooks(input.hooks, issues);
  const maxParallel = parseMentuInteger(input.max_parallel, "max_parallel", issues);
  if (issues.length) {
    return { ok: false, issues, raw: cloneMentuRecipeValue(input) };
  }

  const recipe: MentuRecipeDefinition = {
    ...(input.type !== undefined && input.type !== null ? { type: effectiveType } : {}),
    name: input.name as string,
    ...(description !== undefined ? { description } : {}),
    ...(backend !== undefined ? { backend } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(env ? { env } : {}),
    ...(providers ? { providers } : {}),
    ...(cloud ? { cloud } : {}),
    ...(hooks ? { hooks } : {}),
    ...(maxParallel !== undefined ? { max_parallel: maxParallel } : {}),
    ...(steps ? { steps } : {}),
    ...(nodes ? { recipes: nodes } : {}),
  };
  const raw = cloneMentuRecipeValue(input);
  const unknownFields: MentuRecipeUnknownFields = {
    root: collectUnknownMentuFields(raw, MENTU_RECIPE_ROOT_FIELDS),
    steps: collectArrayUnknownFields(raw.steps, MENTU_RECIPE_STEP_FIELDS),
    recipes: collectArrayUnknownFields(raw.recipes, MENTU_RECIPE_NODE_FIELDS),
  };
  return { ok: true, recipe, raw, unknownFields };
}

function validateEntries(
  labels: string[],
  dependencies: (string[] | undefined)[],
  path: string,
  duplicateMessage: string,
  issues: MentuRecipeValidationIssue[],
): void {
  if (new Set(labels).size !== labels.length) {
    issues.push({ path, message: duplicateMessage });
  }
  validateMentuRecipeDependencies(labels, dependencies, path, issues);
}

function collectArrayUnknownFields(
  value: MentuJsonValue | undefined,
  known: Set<string>,
): Record<string, ReturnType<typeof collectUnknownMentuFields>> {
  return Object.fromEntries(
    (Array.isArray(value) ? value : []).map((item, index) => [
      String(index),
      isMentuRecipeObject(item) ? collectUnknownMentuFields(item, known) : {},
    ]),
  );
}

export function validateMentuRecipe(input: unknown): MentuRecipeParseResult {
  return parseMentuRecipeJson(input);
}

export function requireMentuRecipe(input: unknown): MentuRecipeDefinition {
  const result = parseMentuRecipeJson(input);
  if (!result.ok) {
    throw new MentuRecipeValidationError(result.issues);
  }
  return result.recipe;
}

export function cloneMentuRecipeJson<T extends MentuJsonValue>(value: T): T {
  return cloneMentuRecipeValue(value);
}
