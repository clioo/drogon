import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchMentuRequest,
  installOfficialMentuRuntime,
  isMentuRuntimePlatformSupported,
  MENTU_RUNTIME_LOCK_REVISION,
  MENTU_RUNTIME_LOCK_SHA256,
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

describe("optional Mentu runtime installation", () => {
  it("only advertises installation on Apple silicon macOS", () => {
    expect(isMentuRuntimePlatformSupported("darwin", "arm64")).toBe(true);
    expect(isMentuRuntimePlatformSupported("darwin", "x64")).toBe(false);
    expect(isMentuRuntimePlatformSupported("linux", "arm64")).toBe(false);
  });

  const missingRuntime = {
    available: false,
    path: null,
    version: null,
    expectedRevision: MENTU_RUNTIME_LOCK_REVISION,
    expectedSha256: MENTU_RUNTIME_LOCK_SHA256,
    actualSha256: null,
    lockMatches: false,
    message: "not installed",
  };
  const installedRuntime = {
    ...missingRuntime,
    available: true,
    path: "/fixture/mentu-recipes",
    version: "0.5.0",
    actualSha256: MENTU_RUNTIME_LOCK_SHA256,
    lockMatches: true,
    message: null,
  };

  it("refuses non-Apple-silicon hosts without downloading or calling the daemon", async () => {
    const call = vi.fn();
    const fetchImpl = vi.fn();
    const result = await installOfficialMentuRuntime({
      platform: "linux",
      arch: "x64",
      call,
      fetchImpl,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "mentu_install_unsupported" },
    });
    expect(call).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not download when the verified runtime is already installed", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      result: { runtime: installedRuntime },
    }));
    const fetchImpl = vi.fn();
    const result = await installOfficialMentuRuntime({
      platform: "darwin",
      arch: "arm64",
      call,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, result: { runtime: installedRuntime } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads on explicit request, verifies the bytes, then asks the daemon to install", async () => {
    const bytes = Buffer.from("fixture mentu runtime");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const seen: Array<[string, object]> = [];
    const call = vi.fn(async (method: string, params: object) => {
      seen.push([method, params]);
      if (method === "mentu.runtime")
        return { ok: true as const, result: { runtime: missingRuntime } };
      return {
        ok: true as const,
        result: { status: "installed", runtime: installedRuntime },
      };
    });
    const fetchImpl = vi.fn(async () => new Response(bytes));

    const result = await installOfficialMentuRuntime({
      platform: "darwin",
      arch: "arm64",
      call,
      fetchImpl,
      expectedSha256: digest,
      releaseUrl: "https://example.invalid/mentu-recipes",
    });

    expect(result).toEqual({ ok: true, result: { runtime: installedRuntime } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seen.map(([method]) => method)).toEqual([
      "mentu.runtime",
      "mentu.runtime_install",
    ]);
    expect(seen[1]?.[1]).toMatchObject({
      sourcePath: expect.stringContaining("drogon-mentu-install-"),
    });
  });

  it("rejects altered downloads before the daemon install call", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      result: { runtime: missingRuntime },
    }));
    const result = await installOfficialMentuRuntime({
      platform: "darwin",
      arch: "arm64",
      call,
      fetchImpl: async () => new Response("altered"),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "mentu_download_invalid", retryable: false },
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("turns network failures into an honest retryable Settings message", async () => {
    const result = await installOfficialMentuRuntime({
      platform: "darwin",
      arch: "arm64",
      call: async () => ({
        ok: true as const,
        result: { runtime: missingRuntime },
      }),
      fetchImpl: async () => {
        throw new TypeError("fetch failed: network is down");
      },
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "mentu_download_failed",
        message: "Could not download the pinned Mentu runtime. Check your network connection and try again.",
        retryable: true,
      },
    });
  });
});
