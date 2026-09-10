// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/renderer/src/components/mentu/recipe-pane-editor.ts`: the step
// draft projection (`draftForRecipeStep`) and its validated document
// update (`updateRecipeStepDocument`). Two data-layer adaptations:
// `deterministicAdapterModels` is omitted (this repo's daemon exposes no
// adapter catalog, so the inspector's Model field edits the step's own
// `model` id directly — carried manual-unverified until catalog wiring
// lands), and the draft gains a `verifyCommands` field (one command per
// line) because this repo's daemon surfaces `verify.commands` per step
// and the task requires editing them — the fork has no such affordance.
// The model write is agent-gated like the daemon (`recipe.rs`): a model
// on a shell-effective step is refused, never stored as a fake field.

import type { MentuRecipeDocument, MentuRecipeStep } from "./recipe-validation/mentu-recipe-document";
import { parseMentuRecipeJson } from "./recipe-validation/mentu-recipe-validation";
import { serializeMentuRecipeDocument } from "./recipe-validation/mentu-recipe-serialization";

export type RecipeStepDraft = {
  backend: string;
  /** Exact model id for an agent step; empty clears it. Refused on shell steps. */
  model: string;
  dependencies: string;
  timeout: string;
  retries: string;
  /** One `verify.commands` entry per line; empty clears the commands. */
  verifyCommands: string;
};

export type RecipeStepUpdateResult =
  | { ok: true; document: MentuRecipeDocument }
  | { ok: false; message: string };

export function draftForRecipeStep(step: MentuRecipeStep): RecipeStepDraft {
  return {
    backend: step.backend ?? "",
    model: step.model ?? "",
    dependencies: step.depends_on?.join(", ") ?? "",
    timeout: step.timeout?.toString() ?? "",
    retries: step.max_retries?.toString() ?? "",
    verifyCommands: step.verify?.commands?.join("\n") ?? "",
  };
}

function optionalInteger(value: string, label: string): number | undefined | string {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    return `${label} must be a non-negative integer.`;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : `${label} is outside the supported range.`;
}

export function updateRecipeStepDocument(
  document: MentuRecipeDocument,
  stepLabel: string,
  draft: RecipeStepDraft,
): RecipeStepUpdateResult {
  const timeout = optionalInteger(draft.timeout, "Timeout");
  if (typeof timeout === "string") {
    return { ok: false, message: timeout };
  }
  const retries = optionalInteger(draft.retries, "Retries");
  if (typeof retries === "string") {
    return { ok: false, message: retries };
  }
  let found = false;
  const dependencies = [
    ...new Set(draft.dependencies.split(",").map((item) => item.trim())),
  ].filter(Boolean);
  const verifyCommands = draft.verifyCommands
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  // The backend the step executes with after this edit: the draft value,
  // else the step's own, else the recipe root default, else `shell` — the
  // same inherit chain the daemon's snapshot records. Only a non-shell
  // (agent) backend may carry a model id; shell steps must not gain fake
  // agent fields.
  const editedBackend = draft.backend.trim();
  const currentStep = document.recipe.steps?.find((step) => step.label === stepLabel);
  const effectiveBackend =
    editedBackend || currentStep?.backend || document.recipe.backend || "shell";
  const editedModel = draft.model.trim();
  if (editedModel && effectiveBackend.toLowerCase() === "shell") {
    return {
      ok: false,
      message:
        `Step '${stepLabel}' uses the shell backend and carries no model selection; choose an agent backend before setting a model.`,
    };
  }
  const steps = document.recipe.steps?.map((step) => {
    if (step.label !== stepLabel) {
      return step;
    }
    found = true;
    // Replacing `commands` while keeping the step's other `verify`
    // requirements; clearing every command drops an otherwise empty
    // `verify` object so the serializer deletes the field.
    const restVerify = { ...step.verify };
    delete restVerify.commands;
    const hasRestVerify = Object.keys(restVerify).length > 0;
    return {
      ...step,
      backend: draft.backend.trim() || undefined,
      model: editedModel || undefined,
      depends_on: dependencies.length > 0 ? dependencies : undefined,
      timeout,
      max_retries: retries,
      verify:
        verifyCommands.length > 0
          ? { ...step.verify, commands: verifyCommands }
          : hasRestVerify
            ? restVerify
            : undefined,
    };
  });
  if (!found || !steps) {
    return { ok: false, message: `Recipe step ${stepLabel} is no longer available.` };
  }
  const candidate: MentuRecipeDocument = {
    ...document,
    recipe: { ...document.recipe, steps },
  };
  const parsed = parseMentuRecipeJson(serializeMentuRecipeDocument(candidate));
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" · "),
    };
  }
  return {
    ok: true,
    document: {
      ...candidate,
      recipe: parsed.recipe,
      raw: parsed.raw,
      unknownFields: parsed.unknownFields,
    },
  };
}
