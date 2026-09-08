// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-entry-validation.ts`: per-step and
// per-child-recipe parsing. Only the import sources are adapted
// (sibling modules in this directory).

import type {
  MentuRecipeNode,
  MentuRecipeStep,
  MentuRecipeValidationIssue,
} from "./mentu-recipe-document";
import {
  isMentuRecipeObject,
  isMentuRecipeString,
  parseMentuInteger,
  parseMentuStringArray,
  parseMentuStringMap,
  parseOptionalMentuString,
} from "./mentu-recipe-value-validation";
import { parseMentuVerifyRequirements } from "./mentu-recipe-verify-validation";

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function parseMentuRecipeStep(
  value: unknown,
  index: number,
  issues: MentuRecipeValidationIssue[],
): MentuRecipeStep | null {
  const path = `steps[${index}]`;
  if (!isMentuRecipeObject(value)) {
    issues.push({ path, message: "must be an object" });
    return null;
  }
  if (!isMentuRecipeString(value.label) || !LABEL.test(value.label)) {
    issues.push({ path: `${path}.label`, message: "must match the safe recipe label format" });
  }
  if (
    (value.prompt === undefined || value.prompt === null) &&
    (value.prompt_file === undefined || value.prompt_file === null)
  ) {
    issues.push({ path, message: "requires prompt or prompt_file" });
  }
  const prompt = parseOptionalMentuString(value.prompt, `${path}.prompt`, issues);
  const promptFile = parseOptionalMentuString(value.prompt_file, `${path}.prompt_file`, issues);
  const backend = parseOptionalMentuString(value.backend, `${path}.backend`, issues);
  const model = parseOptionalMentuString(value.model, `${path}.model`, issues);
  const dir = parseOptionalMentuString(value.dir, `${path}.dir`, issues);
  const completionKeyword = parseOptionalMentuString(
    value.completion_keyword,
    `${path}.completion_keyword`,
    issues,
  );
  const reasoning = parseOptionalMentuString(value.reasoning, `${path}.reasoning`, issues);
  const thinking = parseOptionalMentuString(value.thinking, `${path}.thinking`, issues);
  const env = parseMentuStringMap(value.env, `${path}.env`, issues);
  const timeout = parseMentuInteger(value.timeout, `${path}.timeout`, issues);
  const dependsOn = parseMentuStringArray(value.depends_on, `${path}.depends_on`, issues);
  const maxRetries = parseMentuInteger(value.max_retries, `${path}.max_retries`, issues);
  const retryBackoff = parseMentuInteger(value.retry_backoff_ms, `${path}.retry_backoff_ms`, issues);
  const maxOutputBytes = parseMentuInteger(
    value.max_output_bytes,
    `${path}.max_output_bytes`,
    issues,
  );
  const maxOutputTokens = parseMentuInteger(
    value.max_output_tokens,
    `${path}.max_output_tokens`,
    issues,
  );
  const allowedTools = parseMentuStringArray(value.allowed_tools, `${path}.allowed_tools`, issues);
  const disallowedTools = parseMentuStringArray(
    value.disallowed_tools,
    `${path}.disallowed_tools`,
    issues,
  );
  const expectedChanges = parseMentuStringArray(
    value.expected_changes,
    `${path}.expected_changes`,
    issues,
  );
  const verification = parseMentuVerifyRequirements(value.verify, `${path}.verify`, issues);
  return {
    label: isMentuRecipeString(value.label) ? value.label : "",
    ...(backend !== undefined ? { backend } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(promptFile !== undefined ? { prompt_file: promptFile } : {}),
    ...(dir !== undefined ? { dir } : {}),
    ...(env ? { env } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(completionKeyword !== undefined ? { completion_keyword: completionKeyword } : {}),
    ...(dependsOn ? { depends_on: dependsOn } : {}),
    ...(maxRetries !== undefined ? { max_retries: maxRetries } : {}),
    ...(retryBackoff !== undefined ? { retry_backoff_ms: retryBackoff } : {}),
    ...(maxOutputBytes !== undefined ? { max_output_bytes: maxOutputBytes } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
    ...(allowedTools ? { allowed_tools: allowedTools } : {}),
    ...(disallowedTools ? { disallowed_tools: disallowedTools } : {}),
    ...(expectedChanges ? { expected_changes: expectedChanges } : {}),
    ...(verification ? { verify: verification } : {}),
  };
}

export function parseMentuRecipeNode(
  value: unknown,
  index: number,
  issues: MentuRecipeValidationIssue[],
): MentuRecipeNode | null {
  const path = `recipes[${index}]`;
  if (!isMentuRecipeObject(value)) {
    issues.push({ path, message: "must be an object" });
    return null;
  }
  if (!isMentuRecipeString(value.recipe) || value.recipe.length === 0) {
    issues.push({ path: `${path}.recipe`, message: "must be a non-empty string" });
  }
  const label = parseOptionalMentuString(value.label, `${path}.label`, issues);
  const dependsOn = parseMentuStringArray(value.depends_on, `${path}.depends_on`, issues);
  const vars = parseMentuStringMap(value.vars, `${path}.vars`, issues);
  return {
    ...(label !== undefined ? { label } : {}),
    recipe: isMentuRecipeString(value.recipe) ? value.recipe : "",
    ...(dependsOn ? { depends_on: dependsOn } : {}),
    ...(vars ? { vars } : {}),
  };
}
