// MIT Copyright (c) 2026 Lovecast Inc.
// Honesty-contract tests for the live model-catalog projection: options
// come only from the host enumeration plus the open recipe's own ids, the
// status line reports counts actually computed and provenance actually
// received, and empty/stale/failed/unsupported states each say exactly
// what happened — never a fabricated "synced" claim.

import { describe, expect, it } from "vitest";
import type {
  HarnessModelEntry,
  HarnessModelsCatalog,
} from "../../../../shared/session-contract";
import type { MentuRecipeDefinition } from "./recipe-validation/mentu-recipe-document";
import {
  MODEL_CATALOG_STALE_MS,
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
      configScope: "private-isolated-root (credential-free)",
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
    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      id: "kimi-for-coding",
      group: "catalog",
      verified: true,
      recommended: true,
    });
    expect(options[0].notes).toContain("kimi-coding");
    expect(options[0].notes).toContain("ctx 262.1K");
    expect(options[0].notes).toContain("thinking");
    expect(options[1]).toMatchObject({
      id: "qwen3.8-flash-next",
      verified: true,
      recommended: false,
    });
    expect(options[1].notes).toContain("max out 4.1K");
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
    expect(options.map((option) => option.id)).toEqual([
      "kimi-for-coding",
      "glm-5.3-flash",
    ]);
    expect(options[1]).toMatchObject({
      group: "observed",
      verified: false,
      recommended: false,
      notes: ["from this recipe"],
    });
  });

  it("offers nothing when the catalog is null and the recipe observes nothing", () => {
    expect(
      modelOptionsFromCatalog({
        catalog: null,
        recipe: { name: "demo", steps: [] },
        harness: "pi",
        excludeStepLabel: null,
      }),
    ).toEqual([]);
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
    expect(recipeObservedModels(recipe, "pi", "current")).toEqual([
      "glm-5.3-flash",
    ]);
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

  it("reports the real count and the real provenance for an enumerated catalog", () => {
    const readout = modelCatalogReadout({
      catalog: catalog({
        entries: [entry(), entry({ provider: "zai", id: "glm-5.3-flash" })],
      }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
    });
    expect(readout.statusLine).toContain("2 models enumerated by pi 0.85.1");
    expect(readout.statusLine).toContain("credential-free");
    expect(readout.statusLine).toContain("probed just now");
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
    // The provenance row still shows the real (empty) probe.
    expect(readout.provenanceLine).toContain("probed just now");
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

  it("reports an unsupported enumeration surface instead of inventing entries", () => {
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
    });
    expect(readout.empty).toBe(false);
    expect(readout.statusLine).toContain("no model enumeration surface");
    expect(readout.statusLine).toContain("unverified");
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
    // A host-enumerated typed id gets no such flag.
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
        note: "auth-gated enumeration under a private isolated config: absence is not proof",
      }),
      loading: false,
      error: null,
      harness: "pi",
      registered: true,
      now: NOW,
    });
    expect(readout.noteLine).toContain("auth-gated");
  });
});
