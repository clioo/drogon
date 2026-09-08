// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-serialization.ts`: merges an edited recipe
// definition back over its raw source object so unknown fields survive
// a save. Only the import sources are adapted (sibling modules).

import type {
  MentuJsonObject,
  MentuJsonValue,
  MentuRecipeDocument,
  MentuVerifyRequirements,
} from "./mentu-recipe-document";
import {
  MENTU_RECIPE_NODE_FIELDS,
  MENTU_RECIPE_ROOT_FIELDS,
  MENTU_RECIPE_STEP_FIELDS,
} from "./mentu-recipe-fields";
import { mergeMentuVerifyRequirements } from "./mentu-recipe-verify-validation";

function isObject(value: unknown): value is MentuJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T extends MentuJsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeArrayItem(
  source: MentuJsonValue | undefined,
  index: number,
  value: object,
  fields: Set<string>,
): MentuJsonObject {
  const original = Array.isArray(source) && isObject(source[index]) ? clone(source[index]) : {};
  const typedValue = value as MentuJsonObject;
  const next = { ...original, ...typedValue };
  if (isObject(typedValue.verify)) {
    next.verify = mergeMentuVerifyRequirements(
      original.verify,
      typedValue.verify as unknown as MentuVerifyRequirements,
    );
  }
  for (const field of fields) {
    if (typedValue[field] === undefined) {
      delete next[field];
    }
  }
  return next;
}

export function serializeMentuRecipeDocument(document: MentuRecipeDocument): MentuJsonObject {
  const result = clone(document.raw);
  const recipe = document.recipe as unknown as MentuJsonObject;
  for (const field of MENTU_RECIPE_ROOT_FIELDS) {
    if (recipe[field] === undefined) {
      delete result[field];
    } else {
      result[field] = clone(recipe[field]);
    }
  }
  if (document.recipe.steps) {
    result.steps = document.recipe.steps.map((item, index) =>
      mergeArrayItem(document.raw.steps, index, item, MENTU_RECIPE_STEP_FIELDS),
    );
  }
  if (document.recipe.recipes) {
    result.recipes = document.recipe.recipes.map((item, index) =>
      mergeArrayItem(document.raw.recipes, index, item, MENTU_RECIPE_NODE_FIELDS),
    );
  }
  return result;
}

export function stringifyMentuRecipeDocument(document: MentuRecipeDocument): string {
  return `${JSON.stringify(serializeMentuRecipeDocument(document), null, 2)}\n`;
}
