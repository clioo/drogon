// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-root-validation.ts`: providers/hooks/cloud
// root sections. Only the import source is adapted (the sibling
// document-types module).

import type { MentuJsonObject, MentuRecipeValidationIssue } from "./mentu-recipe-document";
import {
  cloneMentuRecipeValue,
  isMentuRecipeObject,
  isMentuRecipeString,
  parseOptionalMentuString,
} from "./mentu-recipe-value-validation";

const PROVIDER_APIS = new Set(["responses", "chat_completions", "cli", "shell", "pi"]);
const HOOK_FIELDS = ["before_run", "before_step", "after_step", "on_error", "after_run"] as const;

export function validateMentuProviders(
  value: unknown,
  issues: MentuRecipeValidationIssue[],
): MentuJsonObject | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isMentuRecipeObject(value)) {
    issues.push({ path: "providers", message: "must be an object" });
    return undefined;
  }
  for (const [name, provider] of Object.entries(value)) {
    const providerPath = `providers.${name}`;
    if (!isMentuRecipeObject(provider)) {
      issues.push({ path: providerPath, message: "must be an object" });
      continue;
    }
    if (
      provider.api !== undefined &&
      provider.api !== null &&
      (typeof provider.api !== "string" || !PROVIDER_APIS.has(provider.api))
    ) {
      issues.push({
        path: `${providerPath}.api`,
        message: "must be responses, chat_completions, cli, shell, or pi",
      });
    }
    parseOptionalMentuString(provider.base_url, `${providerPath}.base_url`, issues);
    parseOptionalMentuString(provider.api_key_env, `${providerPath}.api_key_env`, issues);
    parseOptionalMentuString(provider.api_key_vault, `${providerPath}.api_key_vault`, issues);
    parseOptionalMentuString(provider.model, `${providerPath}.model`, issues);
  }
  return cloneMentuRecipeValue(value);
}

export function validateMentuHooks(
  value: unknown,
  issues: MentuRecipeValidationIssue[],
): MentuJsonObject | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isMentuRecipeObject(value)) {
    issues.push({ path: "hooks", message: "must be an object" });
    return undefined;
  }
  for (const field of HOOK_FIELDS) {
    const commands = value[field];
    if (commands === undefined || commands === null) {
      continue;
    }
    if (!Array.isArray(commands) || commands.some((command) => !isMentuRecipeString(command))) {
      issues.push({ path: `hooks.${field}`, message: "must be an array of strings" });
    }
  }
  return cloneMentuRecipeValue(value);
}

export function validateMentuCloud(
  value: unknown,
  issues: MentuRecipeValidationIssue[],
): MentuJsonObject | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isMentuRecipeObject(value)) {
    issues.push({ path: "cloud", message: "must be an object" });
    return undefined;
  }
  for (const field of ["enabled", "evaluate_steps"]) {
    const setting = value[field];
    if (setting !== undefined && setting !== null && typeof setting !== "boolean") {
      issues.push({ path: `cloud.${field}`, message: "must be a boolean" });
    }
  }
  return cloneMentuRecipeValue(value);
}
