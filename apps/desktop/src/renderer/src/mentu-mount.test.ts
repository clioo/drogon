import { describe, expect, test } from "vitest";
import { MENTU_CAPABILITY } from "../../shared/mentu-contract";
import type { MentuBridge } from "../../shared/mentu-contract";
import {
  MENTU_ROUTE_ID,
  createGatedMentuBridge,
  isMentuAvailable,
  registerMentuRoute,
} from "./mentu-mount";
import { createRouteRegistry, resolveRoute } from "./route-panel-contract";

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

  test("registers the Mentu route gated on mentu.v1", () => {
    const registry = registerMentuRoute(
      createRouteRegistry({
        capabilities: [MENTU_CAPABILITY],
        fallbackId: MENTU_ROUTE_ID,
      }),
      passthrough,
    );
    const descriptor = resolveRoute(registry, MENTU_ROUTE_ID);
    expect(descriptor.id).toBe(MENTU_ROUTE_ID);
    expect(descriptor.capability).toBe(MENTU_CAPABILITY);
  });
});
