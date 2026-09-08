// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-verify-validation.ts`: the `verify`
// requirements object shape (grep/file/commands). Only the import
// source is adapted (the sibling document-types module).

import type {
  MentuJsonObject,
  MentuJsonValue,
  MentuRecipeValidationIssue,
  MentuVerifyFileAbsent,
  MentuVerifyGrepAbsent,
  MentuVerifyGrepPresent,
  MentuVerifyRequirements,
} from "./mentu-recipe-document";

const VERIFY_FIELDS = [
  "grep_present",
  "grep_absent",
  "file_absent",
  "git_clean_outside",
  "commands",
] as const;

function object(value: unknown): value is MentuJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T extends MentuJsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function optionalString(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push({ path, message: "must be a string" });
    return undefined;
  }
  return value;
}

function optionalInteger(
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

function array(value: unknown, path: string, issues: MentuRecipeValidationIssue[]): unknown[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return [];
  }
  return value;
}

function grepPresent(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): MentuVerifyGrepPresent[] {
  return array(value, path, issues).flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!object(item) || typeof item.file !== "string" || typeof item.pattern !== "string") {
      issues.push({ path: itemPath, message: "requires string file and pattern fields" });
      return [];
    }
    const min = optionalInteger(item.min, `${itemPath}.min`, issues);
    const max = optionalInteger(item.max, `${itemPath}.max`, issues);
    const description = optionalString(item.description, `${itemPath}.description`, issues);
    return [
      {
        file: item.file,
        pattern: item.pattern,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    ];
  });
}

function grepAbsent(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): MentuVerifyGrepAbsent[] {
  return array(value, path, issues).flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!object(item) || typeof item.file !== "string" || typeof item.pattern !== "string") {
      issues.push({ path: itemPath, message: "requires string file and pattern fields" });
      return [];
    }
    const description = optionalString(item.description, `${itemPath}.description`, issues);
    return [
      {
        file: item.file,
        pattern: item.pattern,
        ...(description !== undefined ? { description } : {}),
      },
    ];
  });
}

function fileAbsent(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): MentuVerifyFileAbsent[] {
  return array(value, path, issues).flatMap((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!object(item) || typeof item.file !== "string") {
      issues.push({ path: itemPath, message: "requires a string file field" });
      return [];
    }
    const description = optionalString(item.description, `${itemPath}.description`, issues);
    return [
      {
        file: item.file,
        ...(description !== undefined ? { description } : {}),
      },
    ];
  });
}

function strings(value: unknown, path: string, issues: MentuRecipeValidationIssue[]): string[] {
  const values = array(value, path, issues);
  if (values.some((item) => typeof item !== "string")) {
    issues.push({ path, message: "must contain only strings" });
    return [];
  }
  return values as string[];
}

export function parseMentuVerifyRequirements(
  value: unknown,
  path: string,
  issues: MentuRecipeValidationIssue[],
): MentuVerifyRequirements | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!object(value)) {
    issues.push({ path, message: "must be an object" });
    return undefined;
  }
  return {
    ...(value.grep_present !== undefined && value.grep_present !== null
      ? { grep_present: grepPresent(value.grep_present, `${path}.grep_present`, issues) }
      : {}),
    ...(value.grep_absent !== undefined && value.grep_absent !== null
      ? { grep_absent: grepAbsent(value.grep_absent, `${path}.grep_absent`, issues) }
      : {}),
    ...(value.file_absent !== undefined && value.file_absent !== null
      ? { file_absent: fileAbsent(value.file_absent, `${path}.file_absent`, issues) }
      : {}),
    ...(value.git_clean_outside !== undefined && value.git_clean_outside !== null
      ? {
          git_clean_outside: strings(value.git_clean_outside, `${path}.git_clean_outside`, issues),
        }
      : {}),
    ...(value.commands !== undefined && value.commands !== null
      ? { commands: strings(value.commands, `${path}.commands`, issues) }
      : {}),
  };
}

export function mergeMentuVerifyRequirements(
  source: MentuJsonValue | undefined,
  value: MentuVerifyRequirements,
): MentuJsonObject {
  const original = object(source) ? clone(source) : {};
  const typed = value as unknown as MentuJsonObject;
  const merged = { ...original, ...clone(typed) };
  for (const field of VERIFY_FIELDS) {
    if (typed[field] === undefined) {
      delete merged[field];
    }
  }
  return merged;
}
