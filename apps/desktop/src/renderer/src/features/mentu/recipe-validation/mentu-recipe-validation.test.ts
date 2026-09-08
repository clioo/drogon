// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// `src/shared/mentu-recipe-contract.test.ts` (validation and
// serialization cases): the fork's recipe contract behavior, exercised
// against the sibling port. Adapted only where the fork depends on
// modules not ported here: the checked-in-recipes case reads this repo's
// `.mentu/recipes`, and the run-contract cases (`LOCAL_RUN_EVIDENCE`,
// `classifyMentuRunStatus`) are omitted with the unported run contract.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseMentuRecipeJson } from "./mentu-recipe-validation";
import {
  serializeMentuRecipeDocument,
  stringifyMentuRecipeDocument,
} from "./mentu-recipe-serialization";

describe("ported Mentu recipe validation", () => {
  it("accepts every checked-in Drogon recipe", () => {
    const recipeRoot = path.resolve(process.cwd(), "..", "..", ".mentu", "recipes");
    const failures = readdirSync(recipeRoot)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .flatMap((name) => {
        const parsed = parseMentuRecipeJson(
          JSON.parse(readFileSync(path.join(recipeRoot, name), "utf8")) as unknown,
        );
        return parsed.ok ? [] : [{ name, issues: parsed.issues }];
      });
    expect(failures).toEqual([]);
  });

  it("validates the public schema and retains unknown fields for editing", () => {
    const parsed = parseMentuRecipeJson({
      name: "release",
      description: "initial",
      future_root_field: { enabled: true },
      steps: [
        {
          label: "build",
          prompt: "Build it",
          thinking: "high",
          expected_changes: ["src/**"],
          verify: {
            grep_present: [{ file: "README.md", pattern: "Mentu", min: 1 }],
            commands: ["pnpm test"],
            future_verify_field: { keep: true },
          },
          future_step_field: ["keep-me"],
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const document = {
      path: "/workspace/.mentu/recipes/release.json",
      recipe: { ...parsed.recipe, description: "edited" },
      raw: parsed.raw,
      unknownFields: parsed.unknownFields,
    };
    const roundTripped = serializeMentuRecipeDocument(document);
    expect(roundTripped.future_root_field).toEqual({ enabled: true });
    expect(roundTripped.steps).toEqual([
      {
        label: "build",
        prompt: "Build it",
        thinking: "high",
        expected_changes: ["src/**"],
        verify: {
          grep_present: [{ file: "README.md", pattern: "Mentu", min: 1 }],
          commands: ["pnpm test"],
          future_verify_field: { keep: true },
        },
        future_step_field: ["keep-me"],
      },
    ]);
    expect(roundTripped.description).toBe("edited");
    expect(stringifyMentuRecipeDocument(document)).toContain("future_step_field");
  });

  it("keeps the public optional type optional and accepts compound child recipes", () => {
    const parsed = parseMentuRecipeJson({
      name: "compound",
      type: "compound",
      steps: [],
      recipes: [{ recipe: "child" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.recipe.type).toBe("compound");

    const sequence = parseMentuRecipeJson({
      name: "default-sequence",
      steps: [{ label: "step", prompt: "run" }],
    });
    expect(sequence.ok).toBe(true);
    if (!sequence.ok) {
      return;
    }
    const roundTripped = serializeMentuRecipeDocument({
      path: "/workspace/.mentu/recipes/default-sequence.json",
      recipe: sequence.recipe,
      raw: sequence.raw,
      unknownFields: sequence.unknownFields,
    });
    expect(roundTripped.type).toBeUndefined();
  });

  it("rejects malformed known public fields while retaining the invalid source object", () => {
    const parsed = parseMentuRecipeJson({
      name: "malformed",
      description: 42,
      providers: { custom: { api: "not-an-api" } },
      hooks: { before_run: ["ok", 3] },
      steps: [
        {
          label: "step",
          prompt: "run",
          timeout: "slow",
        },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.raw?.description).toBe(42);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        { path: "description", message: "must be a string" },
        {
          path: "providers.custom.api",
          message: "must be responses, chat_completions, cli, shell, or pi",
        },
        { path: "hooks.before_run", message: "must be an array of strings" },
        { path: "steps[0].timeout", message: "must be an integer" },
      ]),
    );
  });

  it("rejects unsafe labels, missing prompts, unknown dependencies, and cycles", () => {
    const result = parseMentuRecipeJson({
      name: "invalid",
      steps: [
        { label: "bad label", depends_on: ["missing"], prompt: "one" },
        { label: "second", depends_on: ["second"], prompt: "two" },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.map((issue) => issue.message).join(" ")).toMatch(
      /safe recipe label|unknown dependency|dependency cycle/,
    );
  });

  it("uses the public object shape for verification requirements", () => {
    const valid = parseMentuRecipeJson({
      name: "verified",
      steps: [
        {
          label: "verify",
          prompt: "Verify it",
          verify: {
            grep_absent: [{ file: "README.md", pattern: "TODO" }],
            file_absent: [{ file: ".env" }],
            git_clean_outside: ["src/"],
            commands: ["pnpm tc"],
          },
        },
      ],
    });
    expect(valid.ok).toBe(true);

    const invalid = parseMentuRecipeJson({
      name: "old-shape",
      steps: [{ label: "verify", prompt: "Verify it", verify: [] }],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.issues).toContainEqual({
        path: "steps[0].verify",
        message: "must be an object",
      });
    }
  });
});
