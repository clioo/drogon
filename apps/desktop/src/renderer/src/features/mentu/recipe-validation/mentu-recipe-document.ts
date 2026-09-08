// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-contract.ts` (type declarations only): the
// JSON value model, recipe definition, edit document (which retains the
// raw source object so unknown fields round-trip) and validation issue
// shapes. The re-exported runtime (`mentu-recipe-validation`,
// `mentu-recipe-serialization`, `mentu-run-contract`) is intentionally
// not re-exported here: each lives in its sibling module so this repo's
// tab-local editor imports only what the data layer needs.

export type MentuJsonPrimitive = string | number | boolean | null;
export type MentuJsonValue = MentuJsonPrimitive | MentuJsonValue[] | MentuJsonObject;
export type MentuJsonObject = { [key: string]: MentuJsonValue };

export type MentuRecipeType = "sequence" | "formula" | "compound" | "pipeline" | "parallel";

export type MentuVerifyGrepPresent = {
  file: string;
  pattern: string;
  min?: number;
  max?: number;
  description?: string;
};

export type MentuVerifyGrepAbsent = {
  file: string;
  pattern: string;
  description?: string;
};

export type MentuVerifyFileAbsent = { file: string; description?: string };

export type MentuVerifyRequirements = {
  grep_present?: MentuVerifyGrepPresent[];
  grep_absent?: MentuVerifyGrepAbsent[];
  file_absent?: MentuVerifyFileAbsent[];
  git_clean_outside?: string[];
  commands?: string[];
};

export type MentuRecipeStep = {
  label: string;
  backend?: string;
  model?: string;
  prompt?: string;
  prompt_file?: string;
  dir?: string;
  env?: Record<string, string>;
  timeout?: number;
  completion_keyword?: string;
  depends_on?: string[];
  max_retries?: number;
  retry_backoff_ms?: number;
  max_output_bytes?: number;
  reasoning?: string;
  thinking?: string;
  max_output_tokens?: number;
  allowed_tools?: string[];
  disallowed_tools?: string[];
  expected_changes?: string[];
  verify?: MentuVerifyRequirements;
};

export type MentuRecipeNode = {
  label?: string;
  recipe: string;
  depends_on?: string[];
  vars?: Record<string, string>;
};

export type MentuRecipeDefinition = {
  type?: MentuRecipeType;
  name: string;
  description?: string;
  backend?: string;
  model?: string;
  env?: Record<string, string>;
  providers?: MentuJsonObject;
  cloud?: MentuJsonObject;
  hooks?: MentuJsonObject;
  max_parallel?: number;
  steps?: MentuRecipeStep[];
  recipes?: MentuRecipeNode[];
};

export type MentuRecipeUnknownFields = {
  root: MentuJsonObject;
  steps: Record<string, MentuJsonObject>;
  recipes: Record<string, MentuJsonObject>;
};

export type MentuRecipeDocument = {
  path: string;
  recipe: MentuRecipeDefinition;
  /** Exact source observed on load; used to reject stale concurrent writes. */
  source?: string;
  /** The decoded source object, retained so future editors can round-trip unknown fields. */
  raw: MentuJsonObject;
  unknownFields: MentuRecipeUnknownFields;
};

export type MentuRecipeValidationIssue = { path: string; message: string };
export type MentuRecipeParseResult =
  | {
      ok: true;
      recipe: MentuRecipeDefinition;
      raw: MentuJsonObject;
      unknownFields: MentuRecipeUnknownFields;
    }
  | { ok: false; issues: MentuRecipeValidationIssue[]; raw?: MentuJsonObject };
