import { describe, expect, test } from "vitest";
import { MENTU_CAPABILITY } from "../../shared/mentu-contract";
import type { MentuBridge } from "../../shared/mentu-contract";
import { createGatedMentuBridge, isMentuAvailable } from "./mentu-mount";

const passthrough: MentuBridge = {
  mentuRecipes: async () => {
    throw new Error("must not be called");
  },
  mentuRecipe: async () => {
    throw new Error("must not be called");
  },
  mentuRuntime: async () => {
    throw new Error("must not be called");
  },
  mentuApprove: async () => {
    throw new Error("must not be called");
  },
  mentuRun: async () => {
    throw new Error("must not be called");
  },
  mentuRuns: async () => {
    throw new Error("must not be called");
  },
  mentuRunStatus: async () => {
    throw new Error("must not be called");
  },
  mentuRetry: async () => {
    throw new Error("must not be called");
  },
  mentuCancel: async () => {
    throw new Error("must not be called");
  },
};

describe("mentu mount", () => {
  test("capability gate mirrors the advertised service contract", () => {
    expect(isMentuAvailable([MENTU_CAPABILITY])).toBe(true);
    expect(isMentuAvailable(["files.v1"])).toBe(false);
  });

  test("gated bridge refuses every method while mentu.v1 is withheld", async () => {
    const gated = createGatedMentuBridge(passthrough, () => false);
    for (const result of [
      await gated.mentuRecipes({ workspaceId: "ws1" }),
      await gated.mentuRecipe({ workspaceId: "ws1", recipeId: "hello" }),
      await gated.mentuRuntime(),
      await gated.mentuApprove({
        workspaceId: "ws1",
        recipeId: "hello",
        contentHash: "a".repeat(64),
      }),
      await gated.mentuRun({
        workspaceId: "ws1",
        recipeId: "hello",
        approvalId: "a1",
      }),
      await gated.mentuRuns({ workspaceId: "ws1" }),
      await gated.mentuRunStatus({ runId: "run-1" }),
      await gated.mentuRetry({ runId: "run-1" }),
      await gated.mentuCancel({ runId: "run-1" }),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: "unsupported_capability", retryable: true },
      });
    }
  });

  test("gated bridge passes through to the source while allowed", async () => {
    let called: string[] = [];
    const source: MentuBridge = {
      ...passthrough,
      mentuRecipes: async () => {
        called.push("mentuRecipes");
        return { ok: true, result: { recipes: [] } };
      },
    };
    const gated = createGatedMentuBridge(source, () => true);
    const result = await gated.mentuRecipes({ workspaceId: "ws1" });
    expect(result).toEqual({ ok: true, result: { recipes: [] } });
    expect(called).toEqual(["mentuRecipes"]);
  });

  test("gated bridge forwards the optional evidence method when present", async () => {
    const payload = { runId: "run-1", mentuRunId: "run_x", evidence: [] };
    const source: MentuBridge = {
      ...passthrough,
      mentuRunEvidence: async () => ({ ok: true, result: payload }),
    };
    const allowed = createGatedMentuBridge(source, () => true);
    expect(await allowed.mentuRunEvidence?.({ runId: "run-1" })).toEqual({
      ok: true,
      result: payload,
    });
    const refused = createGatedMentuBridge(source, () => false);
    expect(await refused.mentuRunEvidence?.({ runId: "run-1" })).toMatchObject({
      ok: false,
      error: { code: "unsupported_capability", retryable: true },
    });
  });

  test("gated bridge omits the evidence method when the source lacks it", () => {
    const gated = createGatedMentuBridge(passthrough, () => true);
    expect(gated.mentuRunEvidence).toBeUndefined();
  });

  test("gated bridge forwards the optional recipe-save method when present", async () => {
    const payload = {
      recipe: {
        id: "hello",
        path: ".mentu/recipes/hello.json",
        name: "hello",
        description: null,
        contentHash: "b".repeat(64),
        steps: [],
        source: "{}",
      },
    };
    const source: MentuBridge = {
      ...passthrough,
      mentuRecipeSave: async () => ({ ok: true, result: payload }),
    };
    const allowed = createGatedMentuBridge(source, () => true);
    expect(
      await allowed.mentuRecipeSave?.({
        workspaceId: "ws1",
        recipeId: "hello",
        content: "{}",
      }),
    ).toEqual({ ok: true, result: payload });
    const refused = createGatedMentuBridge(source, () => false);
    expect(
      await refused.mentuRecipeSave?.({
        workspaceId: "ws1",
        recipeId: "hello",
        content: "{}",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "unsupported_capability", retryable: true },
    });
  });

  test("gated bridge omits the recipe-save method when the source lacks it", () => {
    const gated = createGatedMentuBridge(passthrough, () => true);
    expect(gated.mentuRecipeSave).toBeUndefined();
  });
});
