// MIT Copyright (c) 2026 Lovecast Inc.
// Honest model catalog for the Mentu inspector's Model field. Drogon's
// daemon exposes no live per-harness model-enumeration RPC reachable from
// the renderer today: `drogon_harness::probe_host_catalog` (the real C01-A
// enumeration probe) is wired only into execution-time selection
// validation (`crates/drogon-core/src/mentu/execution.rs`), and
// `crates/drogon-core/src/harness/selection_gate.rs` documents the gap
// explicitly as a "held seam" — an Engine-owned catalog store needs a
// dispatch entry in the coordinator-owned `crates/drogon-core/src/lib.rs`,
// which this feature is not granted to edit. Rather than fabricate a
// live-looking catalog (a fake "synced" claim, invented model ids, or a
// count nobody queried), this module offers two honestly-sourced option
// groups instead:
//   - a tiny, defensible set of model ids Drogon itself ships knowledge of
//     (never claimed host-confirmed — see `KNOWN_MODELS`);
//   - the model ids the CURRENTLY LOADED recipe's own other steps already
//     carry for the same harness (real data, scanned from the document
//     actually open, not hardcoded).
// Both stay carried "manual-unverified" by the existing verdict system
// (`mentu-approved-selection.ts`); this module never upgrades that.

import type { MentuRecipeDefinition } from "./recipe-validation/mentu-recipe-document";

export type KnownModelEntry = {
  id: string;
  note: string;
};

/** Harness ids this static registry has an opinion about, keyed like
 *  `drogon_harness::HarnessId`'s wire spelling (lowercase). Empty/absent
 *  for a harness Drogon has no defensible known-model id for — never
 *  guessed. `claude-sonnet-5` is the one id already established elsewhere
 *  in this codebase's own fixtures (`crates/drogon-cli/tests/
 *  native_dogfood.rs`'s `REAL_MODEL_JOURNEY_MODEL_ID`), so it is not a
 *  fabrication introduced here. */
const KNOWN_MODELS: Record<string, KnownModelEntry[]> = {
  claude: [{ id: "claude-sonnet-5", note: "recommended" }],
};

export function knownModelsForHarness(harness: string): KnownModelEntry[] {
  return KNOWN_MODELS[harness.trim().toLowerCase()] ?? [];
}

/** Model ids the recipe's OTHER steps already carry for this harness,
 *  first-seen order, excluding the step currently being edited and any
 *  blank/duplicate values. Pure projection over the document already
 *  loaded in the editor — no new read, no invention. */
export function recipeObservedModels(
  recipe: MentuRecipeDefinition | null,
  harness: string,
  excludeStepLabel: string | null,
): string[] {
  if (!recipe?.steps) return [];
  const target = harness.trim().toLowerCase();
  if (!target) return [];
  const seen = new Set<string>();
  const models: string[] = [];
  for (const step of recipe.steps) {
    if (step.label === excludeStepLabel) continue;
    const stepBackend = (step.backend ?? recipe.backend ?? "").trim().toLowerCase();
    if (stepBackend !== target) continue;
    const model = step.model?.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

/** Honest provenance/status line for the Model option list: real counts
 *  from what this module actually holds or scanned, never a fabricated
 *  "synced" claim — say so plainly when there is nothing to offer. */
export function modelCatalogStatusLine(
  harness: string,
  known: KnownModelEntry[],
  observed: string[],
): string {
  const total = known.length + observed.length;
  if (total === 0) {
    return `No known or recipe-observed model ids for ${harness} yet — enter an exact id manually (not host-verified).`;
  }
  const parts: string[] = [];
  if (known.length > 0) {
    parts.push(`${known.length} known`);
  }
  if (observed.length > 0) {
    parts.push(`${observed.length} from this recipe`);
  }
  return `${total} model id${total === 1 ? "" : "s"} available (${parts.join(" · ")}) · not host-confirmed`;
}
