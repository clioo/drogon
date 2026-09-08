// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-value-validation.ts`: primitive JSON
// predicates and per-field parsers. Only the import source is adapted
// (the sibling document-types module in this directory).

import type {
  MentuJsonObject,
  MentuJsonValue,
  MentuRecipeValidationIssue,
} from "./mentu-recipe-document";

export function isMentuRecipeObject(value: unknown): value is MentuJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMentuRecipeString(value: unknown): value is string {
  return typeof value === "string";
}

export function cloneMentuRecipeValue<T extends MentuJsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function collectUnknownMentuFields(
  value: MentuJsonObject,
  known: Set<string>,
): MentuJsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !known.has(key))
      .map(([key, item]) => [key, cloneMentuRecipeValue(item)]),
  );
}

export function parseOptionalMentuString(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isMentuRecipeString(value)) {
    issues.push({ path, message: "must be a string" });
    return undefined;
  }
  return value;
}

export function parseMentuStringArray(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => !isMentuRecipeString(item))) {
    issues.push({ path, message: "must be an array of strings" });
    return undefined;
  }
  return [...value];
}

export function parseMentuStringMap(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isMentuRecipeObject(value)) {
    issues.push({ path, message: "must be an object of strings" });
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isMentuRecipeString(item)) {
      issues.push({ path: `${path}.${key}`, message: "must be a string" });
    } else {
      result[key] = item;
    }
  }
  return result;
}

export function parseMentuInteger(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push({ path, message: "must be an integer" });
    return undefined;
  }
  return value;
}
