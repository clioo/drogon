import { describe, expect, it, vi } from "vitest";
import { dispatchBotCreate } from "./bot-create-bridge";

const body = {
  characterPreset: "custom",
  displayIdentity: { displayName: "Reviewer", handle: null, title: null },
  harnessPolicy: { defaultHarness: "pi", explicitModel: null },
  instructions: "Review changes",
  memories: [],
};
const input = {
  hostId: "host",
  workspaceId: "folder",
  requestId: "retry-identity",
  botId: "bot",
  body,
};
const created = {
  ...body,
  id: "bot",
  responsibilities: [],
  currentSession: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("Bot creation boundary (not registered)", () => {
  it("leaves semantic catalogs to the native service", async () => {
    const next = {
      ...input,
      body: { ...body, characterPreset: "future-preset" },
    };
    const error = {
      code: "invalid_argument",
      message: "Native preset refusal",
      retryable: false,
    };
    const call = vi.fn(async () => ({ ok: false as const, error }));
    expect(await dispatchBotCreate(next, call)).toEqual({ ok: false, error });
    const { requestId, ...params } = next;
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.create",
      params,
      requestId,
    );
  });

  it("preserves transport ambiguity without retrying", async () => {
    const failure = new Error("Connection lost after submission");
    const call = vi.fn(async () => {
      throw failure;
    });
    await expect(dispatchBotCreate(input, call)).rejects.toBe(failure);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps retry identity out of params and preserves explicit folder scope", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: created }));
    expect(await dispatchBotCreate(input, call)).toEqual({
      ok: true,
      result: created,
    });
    const { requestId, ...params } = input;
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.create",
      params,
      requestId,
    );
  });

  it.each([
    null,
    { ...input, requestId: undefined },
    { ...input, requestId: "" },
    { ...input, hostId: "" },
    { ...input, folder: "/untrusted" },
    { ...input, body: { ...body, id: "injected" } },
    { ...input, body: { ...body, responsibilities: [{}] } },
    { ...input, body: { ...body, currentSession: {} } },
    {
      ...input,
      body: {
        ...body,
        displayIdentity: { ...body.displayIdentity, extra: true },
      },
    },
  ])(
    "rejects malformed or authority-bearing input before native transport",
    async (value) => {
      const call = vi.fn();
      expect(await dispatchBotCreate(value, call)).toMatchObject({
        ok: false,
        error: { code: "invalid_argument" },
      });
      expect(call).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...created, id: "wrong" },
    { ...created, currentSession: { sessionId: "invented" } },
    { ...created, responsibilities: [{}] },
    { ...created, createdAt: Number.NaN },
    {},
  ])(
    "rejects malformed, nonempty or mismatched created records",
    async (result) => {
      expect(
        await dispatchBotCreate(input, async () => ({ ok: true, result })),
      ).toMatchObject({
        ok: false,
        error: { code: "internal_error" },
      });
    },
  );

  it("passes a Pi provider/model string through to native (R16-S string|null policy)", async () => {
    const withModel = {
      ...input,
      body: {
        ...body,
        harnessPolicy: {
          defaultHarness: "pi",
          explicitModel: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
        },
      },
    };
    const call = vi.fn(async () => ({ ok: true as const, result: created }));
    expect(await dispatchBotCreate(withModel, call)).toEqual({
      ok: true,
      result: created,
    });
    const { requestId, ...params } = withModel;
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.create",
      params,
      requestId,
    );
  });

  it("accepts a server-minted identity when none was requested", async () => {
    const { botId: _, ...withoutId } = input;
    expect(
      await dispatchBotCreate(withoutId, async () => ({
        ok: true,
        result: created,
      })),
    ).toEqual({ ok: true, result: created });
  });

  it.each([
    "method_not_found",
    "unsupported_host",
    "unauthorized",
    "request_conflict",
    "storage_error",
  ])("preserves %s without retries or a local fallback", async (code) => {
    const error = { code, message: "Exact native error", retryable: false };
    const call = vi.fn(async () => ({ ok: false as const, error }));
    expect(await dispatchBotCreate(input, call)).toEqual({ ok: false, error });
    expect(call).toHaveBeenCalledTimes(1);
  });
});
