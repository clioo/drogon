// MIT Copyright (c) 2026 Lovecast Inc.
// Ported literally from the read-only reference
// `src/shared/mentu-recipe-fields.ts`: the known-field sets the
// serializer uses to preserve unknown fields across edits.

export const MENTU_RECIPE_ROOT_FIELDS = new Set([
  "type",
  "name",
  "description",
  "backend",
  "model",
  "env",
  "providers",
  "cloud",
  "hooks",
  "max_parallel",
  "steps",
  "recipes",
]);

export const MENTU_RECIPE_STEP_FIELDS = new Set([
  "label",
  "backend",
  "model",
  "prompt",
  "prompt_file",
  "dir",
  "env",
  "timeout",
  "completion_keyword",
  "depends_on",
  "max_retries",
  "retry_backoff_ms",
  "max_output_bytes",
  "reasoning",
  "thinking",
  "max_output_tokens",
  "allowed_tools",
  "disallowed_tools",
  "expected_changes",
  "verify",
]);

export const MENTU_RECIPE_NODE_FIELDS = new Set(["label", "recipe", "depends_on", "vars"]);
