import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoInstallBundledMentuRuntime,
  dispatchMentuRequest,
  type MentuMethod,
} from "./mentu-bridge";
import type { Result } from "../shared/session-contract";

const runResult = {
  id: "run-1",
  workspaceId: "ws1",
  recipeId: "hello",
  approvalId: "appr-1",
  mentuRunId: "run_20260907202509_15F1772D",
  status: "succeeded",
  startedAt: "2026-09-07T20:25:09Z",
  endedAt: "2026-09-07T20:25:09Z",
  steps: [
    {
      label: "say-hello",
      backend: "shell",
      status: "succeeded",
      exitCode: 0,
      outputPath: ".mentu/runs/run_20260907202509_15F1772D/say-hello.stdout",
      errorPath: ".mentu/runs/run_20260907202509_15F1772D/say-hello.stderr",
    },
  ],
};

describe("mentu bridge admission", () => {
  it("validates input before invoking the service", async () => {
    let called = false;
    const result = await dispatchMentuRequest(
      "mentuRecipe",
      { workspaceId: "ws1" }, // missing recipeId
      async () => {
        called = true;
        return { ok: true, result: {} };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("rejects a content hash that is not 64 hex characters", async () => {
    let called = false;
    const result = await dispatchMentuRequest(
      "mentuApprove",
      { workspaceId: "ws1", recipeId: "hello", contentHash: "not-a-hash" },
      async () => {
        called = true;
        return { ok: true, result: {} };
      },
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("maps each bridge method to its native RPC method", async () => {
    const seen: string[] = [];
    const spy = async (method: string): Promise<Result<unknown>> => {
      seen.push(method);
      return { ok: true, result: { recipes: [] } };
    };
    await dispatchMentuRequest("mentuRecipes", { workspaceId: "ws1" }, spy);
    expect(seen).toEqual(["mentu.recipes"]);
  });

  it("maps recipe save to mentu.recipe_save and validates its content", async () => {
    const seen: Array<[string, unknown]> = [];
    const spy = async (method: string, params: object): Promise<Result<unknown>> => {
      seen.push([method, params]);
      return {
        ok: true,
        result: {
          recipe: {
            id: "hello",
            path: ".mentu/recipes/hello.json",
            name: "hello",
            contentHash: "a".repeat(64),
            steps: [],
            source: "{}",
          },
        },
      };
    };
    const saved = await dispatchMentuRequest(
      "mentuRecipeSave",
      { workspaceId: "ws1", recipeId: "hello", content: '{"name":"hello","steps":[]}' },
      spy,
    );
    expect(saved.ok).toBe(true);
    expect(seen[0][0]).toBe("mentu.recipe_save");

    // Empty content never reaches the service.
    let called = false;
    const refused = await dispatchMentuRequest(
      "mentuRecipeSave",
      { workspaceId: "ws1", recipeId: "hello", content: "" },
      async () => {
        called = true;
        return { ok: true, result: {} };
      },
    );
    expect(refused.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("passes typed service errors through untouched", async () => {
    const result = await dispatchMentuRequest(
      "mentuRun",
      { workspaceId: "ws1", recipeId: "hello", approvalId: "a1" },
      async () => ({
        ok: false,
        error: {
          code: "mentu_runtime_unavailable",
          message: "runtime not verified",
          retryable: false,
        },
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "mentu_runtime_unavailable" },
    });
  });

  it("refuses a native result that does not match the run contract", async () => {
    const result = await dispatchMentuRequest(
      "mentuRunStatus",
      { runId: "run-1" },
      async () => ({ ok: true, result: { run: { id: "run-1" } } }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed run result for every run-shaped method", async () => {
    const methods: MentuMethod[] = [
      "mentuRun",
      "mentuRunStatus",
      "mentuRetry",
      "mentuCancel",
    ];
    for (const method of methods) {
      const input =
        method === "mentuRun"
          ? { workspaceId: "ws1", recipeId: "hello", approvalId: "a1" }
          : { runId: "run-1" };
      const result = await dispatchMentuRequest(method, input, async () => ({
        ok: true,
        result: { run: runResult },
      }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.result).toMatchObject({ run: runResult });
    }
  });
});

describe("mentu runtime auto-install (journey J9 fresh-install usability)", () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function fixtureSourcePath(): string {
    const dir = mkdtempSync(join(tmpdir(), "mentu-auto-install-"));
    scratch.push(dir);
    const source = join(dir, "mentu-recipes");
    writeFileSync(source, "#!/bin/sh\necho fixture\n");
    return source;
  }

  it("does nothing when no bundled runtime exists at the source path", async () => {
    let called = false;
    await autoInstallBundledMentuRuntime(async () => {
      called = true;
      return { ok: true, result: {} };
    }, join(tmpdir(), "does-not-exist", "mentu-recipes"));
    expect(called).toBe(false);
  });

  it("installs a bundled runtime and logs the result", async () => {
    const source = fixtureSourcePath();
    const seen: Array<[string, unknown]> = [];
    await autoInstallBundledMentuRuntime(async (method, params) => {
      seen.push([method, params]);
      return { ok: true, result: { status: "installed" } };
    }, source);
    expect(seen).toEqual([["mentu.runtime_install", { sourcePath: source }]]);
  });

  it("retries a retryable failure, then gives up and logs the failure", async () => {
    const source = fixtureSourcePath();
    let calls = 0;
    await autoInstallBundledMentuRuntime(
      async () => {
        calls += 1;
        return {
          ok: false,
          error: { code: "unverifiable", message: "daemon not ready", retryable: true },
        };
      },
      source,
      0,
      3,
    );
    expect(calls).toBe(3);
  });

  it("gives up immediately on a non-retryable failure", async () => {
    const source = fixtureSourcePath();
    let calls = 0;
    await autoInstallBundledMentuRuntime(async () => {
      calls += 1;
      return {
        ok: false,
        error: {
          code: "mentu_runtime_lock_mismatch",
          message: "does not match the lock",
          retryable: false,
        },
      };
    }, source);
    expect(calls).toBe(1);
  });
});
