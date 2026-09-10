// Editor-projection unit tests for the fork-ported
// `recipe-pane-editor.ts`: the step draft projection, validated document
// updates (backend, dependencies, timeout, retries, verify commands), and
// the refusal paths (bad integers, unknown steps, re-parse failures).

import { describe, expect, it } from "vitest";
import {
  draftForRecipeStep,
  updateRecipeStepDocument,
} from "./recipe-pane-editor";
import { parseMentuRecipeJson } from "./recipe-validation/mentu-recipe-validation";
import { serializeMentuRecipeDocument } from "./recipe-validation/mentu-recipe-serialization";

const SOURCE = JSON.stringify({
  name: "hello",
  backend: "shell",
  steps: [
    {
      label: "build",
      prompt: "make",
      timeout: 30,
      depends_on: [],
      verify: { commands: ["test -f out.txt"] },
    },
    { label: "test", prompt: "make test", depends_on: ["build"] },
  ],
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

describe("recipe pane editor", () => {
  it("projects a step into an editable draft, including verify commands", () => {
    const document = baseDocument();
    const draft = draftForRecipeStep(document.recipe.steps![0]);
    expect(draft).toMatchObject({
      backend: "",
      dependencies: "",
      timeout: "30",
      retries: "",
      verifyCommands: "test -f out.txt",
    });
    expect(draftForRecipeStep(document.recipe.steps![1]).verifyCommands).toBe("");
  });

  it("updates backend, dependencies, timeout, retries and verify commands", () => {
    const updated = updateRecipeStepDocument(baseDocument(), "test", {
      backend: "pi",
      model: "",
      dependencies: "build",
      timeout: "60",
      retries: "2",
      verifyCommands: "pnpm test\ntest -f report.xml",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const serialized = serializeMentuRecipeDocument(updated.document);
    const steps = serialized.steps as Record<string, unknown>[];
    const test = steps[1] as Record<string, unknown>;
    expect(test.backend).toBe("pi");
    expect(test.depends_on).toEqual(["build"]);
    expect(test.timeout).toBe(60);
    expect(test.max_retries).toBe(2);
    expect((test.verify as Record<string, unknown>).commands).toEqual([
      "pnpm test",
      "test -f report.xml",
    ]);
    // Untouched steps and fields (like prompt) survive the update.
    expect((steps[0] as Record<string, unknown>).prompt).toBe("make");
  });

  it("clears verify commands while keeping the step's other verify requirements", () => {
    const parsed = parseMentuRecipeJson({
      name: "hello",
      steps: [
        {
          label: "build",
          prompt: "make",
          verify: {
            commands: ["old"],
            grep_absent: [{ file: "README.md", pattern: "TODO" }],
          },
        },
      ],
    });
    if (!parsed.ok) throw new Error("fixture must parse");
    const updated = updateRecipeStepDocument(
      {
        path: "p",
        recipe: parsed.recipe,
        raw: parsed.raw,
        unknownFields: parsed.unknownFields,
      },
      "build",
      { backend: "", model: "", dependencies: "", timeout: "", retries: "", verifyCommands: "  " },
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const verify = serializeMentuRecipeDocument(updated.document).steps as Record<
      string,
      unknown
    >[];
    expect(verify[0]).not.toHaveProperty("verify.commands");
    expect((verify[0].verify as Record<string, unknown>).grep_absent).toEqual([
      { file: "README.md", pattern: "TODO" },
    ]);
  });

  it("persists the exact model id on an agent step", () => {
    const updated = updateRecipeStepDocument(baseDocument(), "test", {
      backend: "codex",
      model: "gpt-5.6-luna",
      dependencies: "build",
      timeout: "",
      retries: "",
      verifyCommands: "",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const steps = serializeMentuRecipeDocument(updated.document).steps as Record<
      string,
      unknown
    >[];
    expect(steps[1].backend).toBe("codex");
    expect(steps[1].model).toBe("gpt-5.6-luna");
    // The sibling shell step gains no model field.
    expect(steps[0]).not.toHaveProperty("model");
  });

  it("refuses a model on a shell-effective step instead of storing it", () => {
    const document = baseDocument();
    const draft = draftForRecipeStep(document.recipe.steps![0]);
    const refused = updateRecipeStepDocument(document, "build", {
      ...draft,
      model: "gpt-5.6-luna",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("shell backend");
  });

  it("refuses non-integer timeouts and retries with field messages", () => {
    const document = baseDocument();
    const draft = draftForRecipeStep(document.recipe.steps![0]);
    expect(updateRecipeStepDocument(document, "build", { ...draft, timeout: "slow" })).toEqual({
      ok: false,
      message: "Timeout must be a non-negative integer.",
    });
    expect(updateRecipeStepDocument(document, "build", { ...draft, retries: "-1" })).toEqual({
      ok: false,
      message: "Retries must be a non-negative integer.",
    });
  });

  it("refuses unknown steps and edits that break re-validation", () => {
    const document = baseDocument();
    const draft = draftForRecipeStep(document.recipe.steps![0]);
    expect(updateRecipeStepDocument(document, "missing", draft)).toEqual({
      ok: false,
      message: "Recipe step missing is no longer available.",
    });
    // A dependency on no known label fails the re-parse.
    const bad = updateRecipeStepDocument(document, "build", { ...draft, dependencies: "ghost" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.message).toContain("unknown dependency: ghost");
  });
});
