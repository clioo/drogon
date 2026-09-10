import { describe, expect, it, vi } from "vitest";
import {
  dispatchBotDelete,
  dispatchBotResponsibilityCreate,
  dispatchBotResponsibilityDelete,
} from "./bot-bridge";

const scope = { hostId: "host", workspaceId: "workspace" };
const createInput = {
  ...scope,
  requestId: "req-1",
  botId: "bot-1",
  name: "Nightly review",
  schedule: "* * * * *",
  prompt: "Review incoming work.",
};
const createResult = {
  ...scope,
  botId: "bot-1",
  responsibilityId: "resp-1",
  automationId: "auto-1",
};
const deleteInput = {
  ...scope,
  requestId: "req-2",
  botId: "bot-1",
  responsibilityId: "resp-1",
};
const deleteResult = {
  ...scope,
  botId: "bot-1",
  responsibilityId: "resp-1",
  removed: true,
  automationId: "auto-1",
};

describe("Bot responsibility-create bridge", () => {
  it("strips requestId into the native envelope and passes params through", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: createResult }));
    expect(await dispatchBotResponsibilityCreate(createInput, call)).toEqual({
      ok: true,
      result: createResult,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.responsibility_create",
      {
        hostId: "host",
        workspaceId: "workspace",
        botId: "bot-1",
        name: "Nightly review",
        schedule: "* * * * *",
        prompt: "Review incoming work.",
      },
      "req-1",
    );
  });
  it.each([
    { ...createInput, name: "" },
    { ...createInput, schedule: "" },
    { ...createInput, extra: true },
    { ...createInput, requestId: "" },
  ])("rejects invalid input before IPC", async (value) => {
    const call = vi.fn();
    expect(await dispatchBotResponsibilityCreate(value, call)).toMatchObject({
      ok: false,
      error: { code: "invalid_argument" },
    });
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    { ...createResult, botId: "other" },
    { ...createResult, workspaceId: "other" },
    { ...createResult, hostId: "other" },
  ])("rejects results outside the requested scope", async (value) => {
    expect(
      await dispatchBotResponsibilityCreate(createInput, async () => ({
        ok: true,
        result: value,
      })),
    ).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });
});

describe("Bot responsibility-delete bridge", () => {
  it("strips requestId into the native envelope and passes params through", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: deleteResult }));
    expect(await dispatchBotResponsibilityDelete(deleteInput, call)).toEqual({
      ok: true,
      result: deleteResult,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.responsibility_delete",
      {
        hostId: "host",
        workspaceId: "workspace",
        botId: "bot-1",
        responsibilityId: "resp-1",
      },
      "req-2",
    );
  });
  it.each([
    { ...deleteInput, responsibilityId: "" },
    { ...deleteInput, extra: true },
  ])("rejects invalid input before IPC", async (value) => {
    const call = vi.fn();
    expect(await dispatchBotResponsibilityDelete(value, call)).toMatchObject({
      ok: false,
      error: { code: "invalid_argument" },
    });
    expect(call).not.toHaveBeenCalled();
  });
  it("rejects results naming a different responsibility", async () => {
    expect(
      await dispatchBotResponsibilityDelete(deleteInput, async () => ({
        ok: true,
        result: { ...deleteResult, responsibilityId: "other" },
      })),
    ).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });
  it("admits the panel scope's locale but strips it before the native call", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: deleteResult }));
    expect(
      await dispatchBotResponsibilityDelete(
        { ...deleteInput, locale: "en-US" },
        call,
      ),
    ).toEqual({ ok: true, result: deleteResult });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.responsibility_delete",
      {
        hostId: "host",
        workspaceId: "workspace",
        botId: "bot-1",
        responsibilityId: "resp-1",
      },
      "req-2",
    );
  });
});

const botDeleteInput = { ...scope, requestId: "req-3", botId: "bot-1" };
const botDeleteResult = {
  ...scope,
  botId: "bot-1",
  removed: true,
  automationIds: ["auto-1"],
};

describe("Bot delete bridge", () => {
  it("strips requestId into the native envelope and passes params through", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: botDeleteResult }));
    expect(await dispatchBotDelete(botDeleteInput, call)).toEqual({
      ok: true,
      result: botDeleteResult,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.delete",
      { hostId: "host", workspaceId: "workspace", botId: "bot-1" },
      "req-3",
    );
  });
  it("admits the panel scope's locale but strips it before the native call", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: botDeleteResult }));
    expect(
      await dispatchBotDelete({ ...botDeleteInput, locale: "en-US" }, call),
    ).toEqual({ ok: true, result: botDeleteResult });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.delete",
      { hostId: "host", workspaceId: "workspace", botId: "bot-1" },
      "req-3",
    );
  });
  it.each([
    { ...botDeleteInput, botId: "" },
    { ...botDeleteInput, extra: true },
  ])("rejects invalid input before IPC", async (value) => {
    const call = vi.fn();
    expect(await dispatchBotDelete(value, call)).toMatchObject({
      ok: false,
      error: { code: "invalid_argument" },
    });
    expect(call).not.toHaveBeenCalled();
  });
  it("rejects results naming a different bot", async () => {
    expect(
      await dispatchBotDelete(botDeleteInput, async () => ({
        ok: true,
        result: { ...botDeleteResult, botId: "other" },
      })),
    ).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });
});

describe("App-global '' scope (#348/R17-E)", () => {
  it("passes '' through for responsibility-create and accepts the owning-workspace echo", async () => {
    const resolved = { ...createResult, workspaceId: "owning-workspace" };
    const call = vi.fn(async () => ({ ok: true as const, result: resolved }));
    expect(
      await dispatchBotResponsibilityCreate(
        { ...createInput, workspaceId: "" },
        call,
      ),
    ).toEqual({ ok: true, result: resolved });
    const { requestId, ...rest } = createInput;
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.responsibility_create",
      { ...rest, workspaceId: "" },
      requestId,
    );
  });
  it("passes '' through for responsibility-delete and accepts the owning-workspace echo", async () => {
    const resolved = { ...deleteResult, workspaceId: "owning-workspace" };
    const call = vi.fn(async () => ({ ok: true as const, result: resolved }));
    expect(
      await dispatchBotResponsibilityDelete(
        { ...deleteInput, workspaceId: "" },
        call,
      ),
    ).toEqual({ ok: true, result: resolved });
  });
  it("passes '' through for bot-delete and accepts the owning-workspace echo", async () => {
    const resolved = { ...botDeleteResult, workspaceId: "owning-workspace" };
    const call = vi.fn(async () => ({ ok: true as const, result: resolved }));
    expect(
      await dispatchBotDelete({ ...botDeleteInput, workspaceId: "" }, call),
    ).toEqual({ ok: true, result: resolved });
  });
  it("accepts the verbatim '' echo for applied app-global deletes", async () => {
    // Native resolves the owning folder for the mutation itself but echoes
    // the requested id in delete receipts: ''-for-'' means applied under
    // the global scope, not a mismatch.
    const call = vi.fn(async () => ({
      ok: true as const,
      result: { ...deleteResult, workspaceId: "" },
    }));
    expect(
      await dispatchBotResponsibilityDelete(
        { ...deleteInput, workspaceId: "" },
        call,
      ),
    ).toEqual({
      ok: true,
      result: { ...deleteResult, workspaceId: "" },
    });
    const botCall = vi.fn(async () => ({
      ok: true as const,
      result: { ...botDeleteResult, workspaceId: "" },
    }));
    expect(
      await dispatchBotDelete({ ...botDeleteInput, workspaceId: "" }, botCall),
    ).toEqual({
      ok: true,
      result: { ...botDeleteResult, workspaceId: "" },
    });
  });
  it("still rejects a mismatched echo for workspace-scoped mutations", async () => {
    await expect(
      dispatchBotResponsibilityCreate(createInput, async () => ({
        ok: true as const,
        result: { ...createResult, workspaceId: "other" },
      })),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
    await expect(
      dispatchBotDelete(botDeleteInput, async () => ({
        ok: true as const,
        result: { ...botDeleteResult, workspaceId: "other" },
      })),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
  });
});
