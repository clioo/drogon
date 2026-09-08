// Draft-state unit tests for the fork-ported
// `mentu-session-draft-state.ts`: issue formatting, the
// validation-gated draft apply, and the per-path draft map helpers.

import { describe, expect, it } from "vitest";
import {
  applyMentuDraftSource,
  formatMentuValidationIssues,
  hasMentuDraftForPath,
  withoutMentuDraftSource,
  withMentuDraftSource,
} from "./mentu-session-draft-state";
import { parseMentuRecipeJson } from "./recipe-validation/mentu-recipe-validation";
import { stringifyMentuRecipeDocument } from "./recipe-validation/mentu-recipe-serialization";

const SOURCE = JSON.stringify({
  name: "hello",
  steps: [{ label: "build", prompt: "make", timeout: 30 }],
});

function baseDocument() {
  const parsed = parseMentuRecipeJson(JSON.parse(SOURCE));
  if (!parsed.ok) throw new Error("fixture must parse");
  return {
    path: ".mentu/recipes/hello.json",
    recipe: parsed.recipe,
    source: SOURCE,
    raw: parsed.raw,
    unknownFields: parsed.unknownFields,
  };
}

describe("mentu draft state", () => {
  it("formats validation issues like the fork (path: message, joined)", () => {
    expect(
      formatMentuValidationIssues([
        { path: "name", message: "must be a non-empty string" },
        { path: "steps", message: "must be an array" },
      ]),
    ).toBe("name: must be a non-empty string · steps: must be an array");
  });

  it("applies a valid draft source while retaining unknown fields", () => {
    const document = baseDocument();
    const edited = JSON.stringify({
      name: "hello",
      future: true,
      steps: [{ label: "build", prompt: "make all", timeout: 30 }],
    });
    const applied = applyMentuDraftSource(document, edited);
    expect("document" in applied).toBe(true);
    if (!("document" in applied)) return;
    expect(applied.document.recipe.steps?.[0].prompt).toBe("make all");
    expect(stringifyMentuRecipeDocument(applied.document)).toContain('"future": true');
  });

  it("refuses an invalid draft with the fork's issue message, keeping the document", () => {
    const document = baseDocument();
    const applied = applyMentuDraftSource(document, JSON.stringify({ name: "", steps: [] }));
    expect(applied).toMatchObject({
      message: expect.stringContaining("name: must be a non-empty string"),
    });
  });

  it("refuses non-JSON draft text with a JSON error, not a validation dump", () => {
    const applied = applyMentuDraftSource(baseDocument(), "{not json");
    expect("message" in applied).toBe(true);
    if (!("message" in applied)) return;
    expect(typeof applied.message).toBe("string");
  });

  it("tracks per-path drafts without disturbing sibling paths", () => {
    expect(hasMentuDraftForPath(undefined, ".mentu/recipes/a.json")).toBe(false);
    const state = { draftSourceByPath: {} };
    expect(hasMentuDraftForPath(state, null)).toBe(false);
    const withA = withMentuDraftSource(state, ".mentu/recipes/a.json", "{}");
    expect(hasMentuDraftForPath({ draftSourceByPath: withA }, ".mentu/recipes/a.json")).toBe(true);
    expect(hasMentuDraftForPath({ draftSourceByPath: withA }, ".mentu/recipes/b.json")).toBe(
      false,
    );
    const withoutA = withoutMentuDraftSource({ draftSourceByPath: withA }, ".mentu/recipes/a.json");
    expect(hasMentuDraftForPath({ draftSourceByPath: withoutA }, ".mentu/recipes/a.json")).toBe(
      false,
    );
  });
});
