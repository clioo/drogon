// MIT Copyright (c) 2026 Lovecast Inc.
// Honesty-contract tests for the live model-catalog projection: options
// come from the host enumeration, the curated known catalog (always marked
// unverified) and the open recipe's own ids; the status line reports counts
// actually computed and provenance actually received; empty/stale/failed/
// unsupported states each say exactly what happened — never a fabricated
// "synced" claim. The picker's search is `filterModelOptions`.

import { describe, expect, it } from "vitest";
import type {
  HarnessModelEntry,
  HarnessModelsCatalog,
} from "../../../../shared/session-contract";
import type { MentuRecipeDefinition } from "./recipe-validation/mentu-recipe-document";
import { knownModelsFor } from "./mentu-known-models";
import {
  MODEL_CATALOG_STALE_MS,
  filterModelOptions,
  isModelCatalogStale,
  modelCatalogAge,
  modelCatalogReadout,
  modelOptionsFromCatalog,
  recipeObservedModels,
} from "./mentu-model-registry";

const NOW = 1_800_000_000_000;

function entry(overrides: Partial<HarnessModelEntry> = {}): HarnessModelEntry {
  return {
    provider: "kimi-coding",
    id: "kimi-for-coding",
    context: "262.1K",
    maxOutput: "32.8K",
    thinking: true,
    images: true,
    ...overrides,
  };
}

function catalog(overrides: Partial<HarnessModelsCatalog> = {}): HarnessModelsCatalog {
  return {
    harness: "pi",
    availability: "available",
    executable: "/usr/local/bin/pi",
    provenance: {
      executable: "/usr/local/bin/pi",
      argv: ["--list-models"],
      version: "0.85.1",
      probedAtEpochMs: NOW - 5_000,
      configScope: "private-isolated-root (user config linked read-only: auth.json)",
    },
    entries: [],
    status: "enumerated",
    note: null,
    retainedRoots: [],
    ...overrides,
  };
}

describe("modelOptionsFromCatalog", () => {
  it("offers host-enumerated entries as verified, with real reported facts as notes", () => {
    const options = modelOptionsFromCatalog({
      catalog: catalog({
        entries: [
          entry({ id: "kimi-for-coding", thinking: true }),
          entry({
            provider: "dgx-spark",
            id: "qwen3.8-flash-next",
            context: "131.1K",
            maxOutput: "4.1K",
            thinking: false,
            images: false,
          }),
        ],
      }),
      recipe: null,
      harness: "pi",
      excludeStepLabel: null,
    });
    const host = options.filter((option) => option.group === "catalog");
    expect(host).toHaveLength(2);
    expect(host[0]).toMatchObject({
      id: "kimi-for-coding",
      verified: true,
      recommended: true,
    });
    expect(host[0].notes).toContain("kimi-coding");
    expect(host[0].notes).toContain("ctx 262.1K");
    expect(host[0].notes).toContain("thinking");
    expect(host[1]).toMatchObject({
      id: "qwen3.8-flash-next",
      verified: true,
      recommended: false,
    });
    expect(host[1].notes).toContain("max out 4.1K");
  });

  it("merges the curated known catalog as UNVERIFIED and never duplicates a host id", () => {
    const options = modelOptionsFromCatalog({
      catalog: catalog({ harness: "claude", entries: [entry({ provider: null, id: "opus" })] }),
      recipe: null,
      harness: "claude",
      excludeStepLabel: null,
    });
    const known = options.filter((option) => option.group === "known");
    // `opus` is host-enumerated here, so the known seed for it is deduped.
    expect(known.map((option) => option.id)).not.toContain("opus");
    expect(known.map((option) => option.id)).toContain("sonnet");
    expect(known.every((option) => option.verified === false)).toBe(true);
    expect(known.every((option) => option.notes.some((note) => note.includes("unverified")))).toBe(
      true,
    );
    // The host entry stays verified.
    expect(options.find((option) => option.id === "opus")).toMatchObject({
      group: "catalog",
      verified: true,
    });
  });

  it("adds recipe-observed ids as unverified and never duplicates a host-enumerated one", () => {
    const recipe: MentuRecipeDefinition = {
      name: "demo",
      steps: [
        { label: "other", backend: "pi", model: "kimi-for-coding" },
        { label: "sibling", backend: "pi", model: "glm-5.3-flash" },
      ],
    };
    const options = modelOptionsFromCatalog({
      catalog: catalog({ entries: [entry()] }),
      recipe,
      harness: "pi",
      excludeStepLabel: null,
    });
    const observed = options.filter((option) => option.group === "observed");
    expect(observed).toEqual([
      expect.objectContaining({
        id: "glm-5.3-flash",
        verified: false,
        notes: ["from this recipe"],
      }),
    ]);
  });

  it("offers the known seed even when the catalog is null, and nothing for a harness with no seed", () => {
    const claude = modelOptionsFromCatalog({
      catalog: null,
      recipe: { name: "demo", steps: [] },
      harness: "claude",
      excludeStepLabel: null,
    });
    expect(claude.length).toBeGreaterThan(0);
    expect(claude.every((option) => option.group === "known")).toBe(true);
    expect(
      modelOptionsFromCatalog({
        catalog: null,
        recipe: null,
        harness: "antigravity",
        excludeStepLabel: null,
      }),
    ).toEqual([]);
  });
});

describe("knownModelsFor", () => {
  it("has a short, labelled seed for claude/codex and none for antigravity", () => {
    expect(knownModelsFor("claude").map((seed) => seed.id)).toEqual(
      expect.arrayContaining(["opus", "sonnet", "haiku"]),
    );
    expect(knownModelsFor("Codex").map((seed) => seed.id)).toEqual(
      expect.arrayContaining(["gpt-5.6-luna"]),
    );
    expect(knownModelsFor("antigravity")).toEqual([]);
  });
});

describe("filterModelOptions", () => {
  const options = modelOptionsFromCatalog({
    catalog: catalog({
      entries: [
        entry({ provider: "kimi-coding", id: "kimi-for-coding" }),
        entry({ provider: "nvidia", id: "moonshotai/kimi-k2.6" }),
        entry({ provider: "zai", id: "glm-5.3-flash", context: null, maxOutput: null }),
      ],
    }),
    recipe: null,
    harness: "pi",
    excludeStepLabel: null,
  });

  it("matches id, provider/family and other notes, case-insensitively", () => {
    expect(filterModelOptions(options, "GLM").map((option) => option.id)).toEqual([
      "glm-5.3-flash",
    ]);
    expect(filterModelOptions(options, "moonshotai").map((option) => option.id)).toEqual([
      "moonshotai/kimi-k2.6",
    ]);
    expect(filterModelOptions(options, "nvidia").map((option) => option.id)).toEqual([
      "moonshotai/kimi-k2.6",
      "qwen3.8-flash-next-nvidia-nvfp4",
    ]);
    expect(filterModelOptions(options, "KIMI")).toHaveLength(2);
  });

  it("returns every option for a blank query", () => {
    expect(filterModelOptions(options, "   ")).toBe(options);
  });
});

describe("recipeObservedModels", () => {
  it("collects deduped model ids from other steps on the same backend", () => {
    const models = recipeObservedModels(
      {
        name: "demo",
        steps: [
          { label: "a", backend: "claude", model: "claude-sonnet-5" },
          { label: "b", backend: "claude", model: "claude-sonnet-5" },
          { label: "c", backend: "codex", model: "codex-mini" },
        ],
      },
      "claude",
      null,
    );
    expect(models).toEqual(["claude-sonnet-5"]);
  });

  it("excludes the step being edited and returns nothing for a blank harness", () => {
    const recipe: MentuRecipeDefinition = {
      name: "demo",
      steps: [
        { label: "current", backend: "pi", model: "kimi-for-coding" },
        { label: "other", backend: "pi", model: "glm-5.3-flash" },
      ],
    };
    expect(recipeObservedModels(recipe, "pi", "current")).toEqual(["glm-5.3-flash"]);
    expect(recipeObservedModels(null, "pi", null)).toEqual([]);
    expect(recipeObservedModels(recipe, "  ", null)).toEqual([]);
  });
});

describe("modelCatalogReadout", () => {
  it("says plainly when the backend is not a registered harness", () => {
    const readout = modelCatalogReadout({
      catalog: null,
      loading: false,
      error: null,
      harness: "openai",
      registered: false,
      now: NOW,
    });
    expect(readout.statusLine).toContain("runtime-owned");
    expect(readout.statusLine).toContain("unverified");
    expect(readout.provenanceLine).toBeNull();
  });

  it("surfaces a failed load as an explicit status, never a silent empty list", () => {
    const readout = modelCatalogReadout({
      catalog: null,
      loading: false,
      error: "daemon unreachable",
      harness: "pi",
      registered: true,
      now: NOW,
    });
    expect(readout.statusLine).toBe("Model catalog unavailable: daemon unreachable");
  });

  it("renders a waiting line while the probe is in flight", () => {
    const readout = modelCatalogReadout({
      catalog: null,
      loading: true,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
    });
    expect(readout.statusLine).toContain("Probing");
  });

  it("reports the real count, the real provenance and the known-catalog count", () => {
    const readout = modelCatalogReadout({
      catalog: catalog({
        entries: [entry(), entry({ provider: "zai", id: "glm-5.3-flash" })],
      }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
      knownCount: 1,
    });
    expect(readout.statusLine).toContain("2 models enumerated by pi 0.85.1");
    expect(readout.statusLine).toContain("user config linked read-only");
    expect(readout.statusLine).toContain("probed just now");
    expect(readout.statusLine).toContain("plus 1 known-catalog id");
    expect(readout.provenanceLine).toContain("exe: /usr/local/bin/pi");
    expect(readout.provenanceLine).toContain("via --list-models");
    expect(readout.provenanceLine?.toLowerCase()).not.toContain("synced via");
  });

  it("renders the honest empty state instead of a fabricated count", () => {
    const readout = modelCatalogReadout({
      catalog: catalog({ entries: [] }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
    });
    expect(readout.empty).toBe(true);
    expect(readout.statusLine).toContain("No models discovered for pi");
    expect(readout.statusLine).toContain("unverified");
    expect(readout.provenanceLine).toContain("probed just now");
  });

  it("is not 'empty' when the curated known catalog offers alternates", () => {
    const readout = modelCatalogReadout({
      catalog: catalog({ entries: [] }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
      knownCount: 2,
    });
    expect(readout.empty).toBe(false);
    expect(readout.statusLine).toContain("curated known catalog");
  });

  it("labels a stale catalog as stale", () => {
    const stale = catalog({
      provenance: {
        executable: "/usr/local/bin/pi",
        argv: ["--list-models"],
        version: "0.85.1",
        probedAtEpochMs: NOW - MODEL_CATALOG_STALE_MS - 1,
        configScope: "private-isolated-root (credential-free)",
      },
      entries: [entry()],
    });
    expect(isModelCatalogStale(stale, NOW)).toBe(true);
    const readout = modelCatalogReadout({
      catalog: stale,
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
    });
    expect(readout.stale).toBe(true);
    expect(readout.statusLine).toContain("STALE");
    expect(readout.provenanceLine).toContain("STALE");
  });

  it("formats the probe age honestly across minutes and hours", () => {
    const probed = (msAgo: number) =>
      catalog({
        provenance: {
          executable: "/usr/local/bin/pi",
          argv: ["--list-models"],
          version: "0.85.1",
          probedAtEpochMs: NOW - msAgo,
          configScope: "scope",
        },
      });
    expect(modelCatalogAge(probed(30_000), NOW)).toBe("just now");
    expect(modelCatalogAge(probed(5 * 60_000), NOW)).toBe("5 min ago");
    expect(modelCatalogAge(probed(3 * 3_600_000), NOW)).toBe("3 h ago");
    expect(modelCatalogAge(catalog({ provenance: null }), NOW)).toBeNull();
  });

  it("reports an unsupported enumeration surface and still names the known catalog", () => {
    const readout = modelCatalogReadout({
      catalog: catalog({
        harness: "claude",
        status: "unsupported_surface",
        entries: [],
        note: "no enumeration command captured",
      }),
      loading: false,
      error: null,
      harness: "claude",
      registered: true,
      now: NOW,
      knownCount: 5,
    });
    expect(readout.empty).toBe(false);
    expect(readout.statusLine).toContain("no model enumeration surface");
    expect(readout.statusLine).toContain("curated known catalog");
    expect(readout.noteLine).toContain("no enumeration command");
  });

  it("reports not_installed, probe_failed and parse_failed as exactly what they are", () => {
    for (const [status, expected] of [
      ["not_installed", "not installed on this host"],
      ["probe_failed", "enumeration failed"],
      ["parse_failed", "could not be parsed"],
      ["timed_out", "timed out"],
      ["isolation_failed", "isolation failed"],
      ["unsupported_platform", "unavailable on this platform"],
    ] as const) {
      const readout = modelCatalogReadout({
        catalog: catalog({ status, entries: [], provenance: null }),
        loading: false,
        error: null,
        harness: "pi",
        registered: true,
        now: NOW,
      });
      expect(readout.statusLine).toContain(expected);
      expect(readout.empty).toBe(false);
    }
  });

  it("flags a typed id that the host did not enumerate instead of confirming it", () => {
    const readout = modelCatalogReadout({
      catalog: catalog({ entries: [entry()] }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
      selectedModel: "never-enumerated-model",
    });
    expect(readout.statusLine).toContain("'never-enumerated-model'");
    expect(readout.statusLine).toContain("unverified");
    const confirmed = modelCatalogReadout({
      catalog: catalog({ entries: [entry()] }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
      selectedModel: "kimi-for-coding",
    });
    expect(confirmed.statusLine).not.toContain("carried unverified");
  });

  it("carries the daemon's honesty note bounded", () => {
    const readout = modelCatalogReadout({
      catalog: catalog({
        note: "enumeration scope is recorded in provenance; absence is not proof",
      }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
    });
    expect(readout.noteLine).toContain("scope");
  });
});
