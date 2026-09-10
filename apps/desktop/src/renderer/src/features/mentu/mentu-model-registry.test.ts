// MIT Copyright (c) 2026 Lovecast Inc.
// Honesty-contract tests for the model registry: known ids stay tiny and
// defensible, observed ids come only from the loaded document, and the
// status line never claims a count nobody queried.

import { describe, expect, it } from "vitest";
import type { MentuRecipeDefinition } from "./recipe-validation/mentu-recipe-document";
import {
  knownModelsForHarness,
  modelCatalogStatusLine,
  recipeObservedModels,
} from "./mentu-model-registry";

describe("knownModelsForHarness", () => {
  it("has a defensible entry for claude and nothing invented for other harnesses", () => {
    expect(knownModelsForHarness("claude")).toEqual([
      { id: "claude-sonnet-5", note: "recommended" },
    ]);
    expect(knownModelsForHarness("pi")).toEqual([]);
    expect(knownModelsForHarness("opencode")).toEqual([]);
    expect(knownModelsForHarness("antigravity")).toEqual([]);
    expect(knownModelsForHarness("codex")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(knownModelsForHarness("Claude")).toEqual(knownModelsForHarness("claude"));
  });
});

function recipe(steps: MentuRecipeDefinition["steps"]): MentuRecipeDefinition {
  return { name: "demo", steps };
}

describe("recipeObservedModels", () => {
  it("collects model ids from other steps on the same backend, deduped and ordered", () => {
    const models = recipeObservedModels(
      recipe([
        { label: "a", backend: "claude", model: "claude-sonnet-5" },
        { label: "b", backend: "claude", model: "claude-sonnet-5" },
        { label: "c", backend: "claude", model: "claude-opus-5" },
        { label: "d", backend: "codex", model: "codex-mini" },
        { label: "e", backend: "shell" },
      ]),
      "claude",
      null,
    );
    expect(models).toEqual(["claude-sonnet-5", "claude-opus-5"]);
  });

  it("excludes the step currently being edited", () => {
    const models = recipeObservedModels(
      recipe([
        { label: "current", backend: "claude", model: "claude-sonnet-5" },
        { label: "other", backend: "claude", model: "claude-opus-5" },
      ]),
      "claude",
      "current",
    );
    expect(models).toEqual(["claude-opus-5"]);
  });

  it("falls back to the recipe root backend when a step omits its own", () => {
    const models = recipeObservedModels(
      { name: "demo", backend: "claude", steps: [{ label: "a", model: "claude-sonnet-5" }] },
      "claude",
      null,
    );
    expect(models).toEqual(["claude-sonnet-5"]);
  });

  it("returns nothing for a null recipe or blank harness", () => {
    expect(recipeObservedModels(null, "claude", null)).toEqual([]);
    expect(recipeObservedModels(recipe([]), "  ", null)).toEqual([]);
  });
});

describe("modelCatalogStatusLine", () => {
  it("says plainly when there is nothing to offer", () => {
    expect(modelCatalogStatusLine("claude", [], [])).toBe(
      "No known or recipe-observed model ids for claude yet — enter an exact id manually (not host-verified).",
    );
  });

  it("reports the real, actually-computed counts and their provenance", () => {
    const line = modelCatalogStatusLine(
      "claude",
      [{ id: "claude-sonnet-5", note: "recommended" }],
      ["claude-opus-5"],
    );
    expect(line).toBe("2 model ids available (1 known · 1 from this recipe) · not host-confirmed");
  });

  it("never claims a live sync", () => {
    const line = modelCatalogStatusLine("claude", [{ id: "x", note: "n" }], []);
    expect(line.toLowerCase()).not.toContain("synced via drogon-cli");
  });
});
