// MIT Copyright (c) 2026 Lovecast Inc.
// Real model-catalog projection for the Mentu inspector's Model field.
// The daemon's `harness.models` RPC (see `mentu-model-catalog.ts`) probes
// the harness's own enumeration command under credential-free isolation;
// this module turns that answer into what the combobox offers and what
// the status/provenance rows say — with the C01 honesty contract intact:
//
//   - Only ids the host actually enumerated are offered as host-verified.
//   - Model ids the CURRENTLY LOADED recipe's other steps already carry
//     for the same harness stay offered, marked "from this recipe" and
//     NOT host-verified (real data from the open document, never
//     upgraded).
//   - An empty, stale, failed, or unavailable catalog says exactly that.
//     The status line reports counts actually computed and provenance
//     actually received — never a fabricated "synced" claim.
//   - A manually typed id is never silently confirmed: if it is not in
//     the host enumeration it rides unverified (and even a listed
//     absence is not proof — the enumeration is auth-gated for pi).
//
// The RECOMMENDED marker renders only where Drogon has a defensible
// recommendation AND the host enumerated the id; the static list alone
// never renders anything.

import type {
  HarnessModelsCatalog,
  HarnessModelsStatus,
} from "../../../../shared/session-contract";
import type { MentuRecipeDefinition } from "./recipe-validation/mentu-recipe-document";
import { KNOWN_MODEL_CATALOG_VERSION, knownModelsFor } from "./mentu-known-models";

/** How long after its probe a catalog is labelled stale in the UI. The
 *  count stays real either way — staleness is rendered, never hidden. */
export const MODEL_CATALOG_STALE_MS = 10 * 60 * 1000;

/** Model ids Drogon itself recommends per harness, from evidence in this
 *  repository (the native dogfood journey's claude id; the canonical
 *  enumerated pi entry used across the C01 contract suite). Applied ONLY
 *  as a marker on ids the host enumerated this run — never rendered from
 *  the static list alone. */
const KNOWN_RECOMMENDED: Record<string, string[]> = {
  claude: ["claude-sonnet-5"],
  pi: ["kimi-for-coding"],
};

export type ModelOption = {
  id: string;
  /** Where the option came from: the host catalog, the curated known
   *  catalog, or the open recipe. */
  group: "catalog" | "known" | "observed";
  /** True only when the HOST enumerated this id. */
  verified: boolean;
  /** Drogon-recommended AND host-enumerated. */
  recommended: boolean;
  /** Real per-model notes (reported capability facts, recipe origin). */
  notes: string[];
};

/** Case-insensitive substring filter over a model option: matches the id,
 *  the provider/family (carried in `notes`) and any other reported note.
 *  This is the search behind the picker's small search box. */
export function filterModelOptions(
  options: ModelOption[],
  query: string,
): ModelOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (option) =>
      option.id.toLowerCase().includes(needle) ||
      option.notes.some((note) => note.toLowerCase().includes(needle)),
  );
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

/** Combobox options: host-enumerated entries first (verified), then the
 *  curated known catalog for ids the host did not enumerate (unverified,
 *  explicitly labelled), then recipe-observed ids (unverified, "from this
 *  recipe"). Notes are the harness's own reported facts, uninterpreted;
 *  the recommended marker requires both lists to agree. */
export function modelOptionsFromCatalog(input: {
  catalog: HarnessModelsCatalog | null;
  recipe: MentuRecipeDefinition | null;
  harness: string;
  excludeStepLabel: string | null;
}): ModelOption[] {
  const options: ModelOption[] = [];
  const enumerated = new Set<string>();
  if (input.catalog) {
    const recommended = new Set(
      KNOWN_RECOMMENDED[input.harness.trim().toLowerCase()] ?? [],
    );
    for (const entry of input.catalog.entries) {
      if (enumerated.has(entry.id)) continue;
      enumerated.add(entry.id);
      const notes: string[] = [];
      if (entry.provider) notes.push(entry.provider);
      if (entry.context) notes.push(`ctx ${entry.context}`);
      if (entry.maxOutput) {
        notes.push(`max out ${entry.maxOutput}`);
      }
      if (entry.thinking) notes.push("thinking");
      if (entry.images) notes.push("images");
      options.push({
        id: entry.id,
        group: "catalog",
        verified: true,
        recommended: recommended.has(entry.id),
        notes,
      });
    }
  }
  // Curated known catalog (option (b)): never host-verified, always marked
  // with its provenance, deduped against ids the host already enumerated.
  for (const seed of knownModelsFor(input.harness)) {
    if (enumerated.has(seed.id)) continue;
    enumerated.add(seed.id);
    options.push({
      id: seed.id,
      group: "known",
      verified: false,
      recommended: false,
      notes: [seed.note],
    });
  }
  for (const id of recipeObservedModels(
    input.recipe,
    input.harness,
    input.excludeStepLabel,
  )) {
    if (enumerated.has(id)) continue;
    options.push({
      id,
      group: "observed",
      verified: false,
      recommended: false,
      notes: ["from this recipe"],
    });
  }
  return options;
}

/** Honest age text for a probe timestamp; `null` when the answer carries
 *  no usable freshness (which the status line then says instead). */
export function modelCatalogAge(
  catalog: HarnessModelsCatalog | null,
  now: number,
): string | null {
  const probedAt = catalog?.provenance?.probedAtEpochMs;
  if (!catalog || !probedAt) return null;
  const ageMs = Math.max(0, now - probedAt);
  if (ageMs < 60_000) return "just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function isModelCatalogStale(
  catalog: HarnessModelsCatalog | null,
  now: number,
): boolean {
  const probedAt = catalog?.provenance?.probedAtEpochMs;
  if (!probedAt) return false;
  return now - probedAt > MODEL_CATALOG_STALE_MS;
}

function versionText(catalog: HarnessModelsCatalog): string {
  return catalog.provenance?.version ?? "unknown version";
}

/// The label for status lines: the harness's own wire id plus the version
/// its `--version` probe reported. (Not the executable basename — a
/// version-pinned install like `.../claude/versions/2.1.267` would render
/// a bare version number there.) The full executable path rides in the
/// provenance row instead.
function baseLabel(catalog: HarnessModelsCatalog): string {
  return `${catalog.harness} ${versionText(catalog)}`;
}

const STATUS_TEXT: Record<HarnessModelsStatus, string> = {
  enumerated: "enumerated",
  not_installed: "not installed",
  unsupported_surface: "no model enumeration surface",
  unsupported_platform: "host enumeration unavailable on this platform",
  parse_failed: "enumeration output could not be parsed",
  timed_out: "enumeration timed out",
  probe_failed: "enumeration failed",
  isolation_failed: "probe isolation failed",
};

export type ModelCatalogReadout = {
  /** The one-line status under the Model field (count + provenance or an
   *  honest statement of what is missing). Always present. */
  statusLine: string;
  /** The provenance row (source, version, scope, age, daemon note);
   *  null when there is no real probe record to show. */
  provenanceLine: string | null;
  /** The daemon's own honesty note (auth-gating, failure evidence),
   *  bounded for rendering; null when the daemon sent none. */
  noteLine: string | null;
  /** True when the catalog is real, enumerated, and EMPTY — the honest
   *  "no models discovered" state. */
  empty: boolean;
  stale: boolean;
  /** Ids the host enumerated this run (for the typed-id unverified note). */
  enumeratedIds: Set<string>;
};

/** The status/provenance readout for the Model field. Every branch
 *  reports what the daemon actually answered — a count only exists when
 *  entries were received; failures, empty answers and unsupported
 *  surfaces each get their own honest sentence. */
export function modelCatalogReadout(input: {
  catalog: HarnessModelsCatalog | null;
  loading: boolean;
  error: string | null;
  harness: string;
  /** Whether the backend names a Drogon-registered harness at all. */
  registered: boolean;
  now: number;
  /** The draft's typed model id, for the never-silently-confirmed note. */
  selectedModel?: string;
  /** How many curated known-catalog ids are offered for this harness (not
   *  host-enumerated). Reported separately so the status never mixes the
   *  two provenances. */
  knownCount?: number;
}): ModelCatalogReadout {
  const harness = input.harness.trim() || "this harness";
  const knownCount = input.knownCount ?? 0;
  const knownSuffix =
    knownCount > 0
      ? ` The curated known catalog (v${KNOWN_MODEL_CATALOG_VERSION}) offers ${knownCount} id${knownCount === 1 ? "" : "s"} below, unverified on this host.`
      : "";
  const emptySet = new Set<string>();
  if (!input.registered) {
    return {
      statusLine: `'${harness}' is a runtime-owned backend; the daemon has no model catalog for it — enter an exact id manually (unverified).`,
      provenanceLine: null,
      noteLine: null,
      empty: false,
      stale: false,
      enumeratedIds: emptySet,
    };
  }
  if (input.error) {
    return {
      statusLine: `Model catalog unavailable: ${input.error}`,
      provenanceLine: null,
      noteLine: null,
      empty: false,
      stale: false,
      enumeratedIds: emptySet,
    };
  }
  if (input.loading || !input.catalog) {
    return {
      statusLine: `Probing the host model catalog for ${harness}…`,
      provenanceLine: null,
      noteLine: null,
      empty: false,
      stale: false,
      enumeratedIds: emptySet,
    };
  }
  const catalog = input.catalog;
  const age = modelCatalogAge(catalog, input.now);
  const stale = isModelCatalogStale(catalog, input.now);
  const ageText = age ? ` · probed ${age}` : "";
  const staleText = stale ? "STALE — " : "";
  const base = baseLabel(catalog);
  const scope = catalog.provenance?.configScope;
  const provenanceParts = [
    catalog.executable ? `exe: ${catalog.executable}` : null,
    catalog.provenance?.argv.length
      ? `via ${catalog.provenance.argv.join(" ")}`
      : null,
    scope ? `scope: ${scope}` : null,
    age ? `probed ${age}` : "probe time unknown",
  ].filter(Boolean);
  const provenanceLine = `${staleText}${provenanceParts.join(" · ")}`;
  const noteLine = catalog.note
    ? catalog.note.length > 220
      ? `${catalog.note.slice(0, 217)}…`
      : catalog.note
    : null;
  const enumeratedIds = new Set(catalog.entries.map((entry) => entry.id));

  if (catalog.status !== "enumerated") {
    const reason = STATUS_TEXT[catalog.status];
    const statusLine =
      catalog.status === "not_installed"
        ? `${harness} is not installed on this host; no host model catalog exists.${knownSuffix}`
        : catalog.status === "unsupported_surface"
          ? `${harness} exposes no model enumeration surface on this host (version ${versionText(catalog)}); enter an exact id manually — it rides unverified.${knownSuffix}`
          : `${staleText}Host model catalog for ${harness}: ${reason}; no host-enumerated models are offered. Refresh to retry.${knownSuffix}`;
    return {
      statusLine,
      provenanceLine: catalog.provenance ? provenanceLine : null,
      noteLine,
      empty: false,
      stale,
      enumeratedIds,
    };
  }
  if (catalog.entries.length === 0) {
    return {
      statusLine: `No models discovered for ${harness} under ${scope ?? "the probe scope"}${ageText}; enter an exact id manually — it rides unverified.${knownSuffix}`,
      provenanceLine: provenanceLine,
      noteLine,
      empty: knownCount === 0,
      stale,
      enumeratedIds,
    };
  }
  let statusLine = `${staleText}${catalog.entries.length} model${catalog.entries.length === 1 ? "" : "s"} enumerated by ${base}${scope ? ` · ${scope}` : ""}${ageText}`;
  if (knownCount > 0) {
    statusLine += ` · plus ${knownCount} known-catalog id${knownCount === 1 ? "" : "s"} (unverified on this host)`;
  }
  const typed = input.selectedModel?.trim();
  if (typed && !enumeratedIds.has(typed)) {
    statusLine += ` — typed id '${typed}' is not in this enumeration; carried unverified.`;
  }
  return {
    statusLine,
    provenanceLine,
    noteLine,
    empty: false,
    stale,
    enumeratedIds,
  };
}
