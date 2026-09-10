import { describe, expect, it, vi } from "vitest";
import { dispatchBotRun, dispatchBotSnapshot } from "./bot-bridge";

const input = { hostId: "host", workspaceId: "workspace", locale: "en-US" };
const snapshot = {
  hostId: "host",
  workspaceId: "workspace",
  bots: [],
  history: [],
};
describe("Bot snapshot bridge", () => {
  it("accepts populated scheduled and reactive responsibilities", async () => {
    const responsibility = {
      id: "duty",
      name: "Review",
      instructions: "Review the fixture",
      enabled: true,
      recipe: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const bot = {
      id: "bot",
      characterPreset: "custom",
      displayIdentity: { displayName: "Reviewer", handle: null, title: null },
      harnessPolicy: { defaultHarness: "pi", explicitModel: null },
      instructions: "",
      memories: [],
      currentSession: null,
      createdAt: 1,
      updatedAt: 1,
      responsibilities: [
        {
          ...responsibility,
          kind: "scheduled",
          trigger: { kind: "scheduled", automationId: "automation-1" },
        },
        {
          ...responsibility,
          id: "reactive",
          kind: "reactive",
          trigger: { kind: "reactive", event: null },
        },
      ],
    };
    const result = { ...snapshot, bots: [bot] };
    expect(
      await dispatchBotSnapshot(input, async () => ({ ok: true, result })),
    ).toEqual({ ok: true, result });
  });
  it("passes the explicit scope without inventing a folder", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: snapshot }));
    expect(await dispatchBotSnapshot(input, call)).toEqual({
      ok: true,
      result: snapshot,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith("bot.snapshot", input);
  });
  it.each([
    { workspaceId: "workspace", locale: "en-US" },
    { ...input, folder: "/other" },
    { ...input, locale: "" },
  ])("rejects invalid input before IPC", async (value) => {
    const call = vi.fn();
    expect(await dispatchBotSnapshot(value, call)).toMatchObject({
      ok: false,
      error: { code: "invalid_argument" },
    });
    expect(call).not.toHaveBeenCalled();
  });
  it.each([
    { ...snapshot, hostId: "other" },
    { ...snapshot, workspaceId: "other" },
    { ...snapshot, bots: [{}] },
    { ...snapshot, history: [{}] },
  ])("rejects wrong scope and malformed records", async (value) => {
    expect(
      await dispatchBotSnapshot(input, async () => ({
        ok: true,
        result: value,
      })),
    ).toMatchObject({ ok: false, error: { code: "internal_error" } });
  });
  it.each([
    "method_not_found",
    "snapshot_too_large",
    "unsupported_host",
    "storage_error",
  ])("preserves %s without local fallback", async (code) => {
    const error = { code, message: "Exact native error", retryable: false };
    expect(
      await dispatchBotSnapshot(input, async () => ({ ok: false, error })),
    ).toEqual({ ok: false, error });
  });
});

const runInput = {
  hostId: "host",
  workspaceId: "workspace",
  requestId: "req-run-1",
  botId: "bot-1",
  prompt: "Hi!",
  harness: { harnessId: "pi" },
};
const runReceipt = {
  requestId: "bot-chat:req-run-1",
  hostId: "host",
  workspaceId: "workspace",
  automationRunId: null,
  responsibilityRunId: null,
  messageId: "msg-1",
  session: { sessionId: "sess-1", incarnation: "inc-1" },
  outcome: "dispatched",
  refusal: null,
  reason: null,
  error: null,
  observedAt: null,
  recordedAt: 1,
};
describe("Bot run bridge", () => {
  it("passes a workspace-scoped turn through and demands the exact echo", async () => {
    const call = vi.fn(async () => ({ ok: true as const, result: runReceipt }));
    expect(await dispatchBotRun(runInput, call)).toEqual({
      ok: true,
      result: runReceipt,
    });
    const { requestId, ...params } = runInput;
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.run",
      params,
      requestId,
    );
  });
  it("admits the app-global '' scope and accepts native's owning-workspace echo (#348/R17-E)", async () => {
    // Reads are app-global and mutations ride the same live scope: '' must
    // reach native (which resolves the bot's owning folder), and the
    // receipt echoes THAT workspace — never '' — so the gate accepts the
    // resolved id instead of demanding an exact '' echo.
    const resolved = { ...runReceipt, workspaceId: "owning-workspace" };
    const call = vi.fn(async () => ({ ok: true as const, result: resolved }));
    expect(
      await dispatchBotRun({ ...runInput, workspaceId: "" }, call),
    ).toEqual({ ok: true, result: resolved });
    const { requestId, ...rest } = runInput;
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.run",
      { ...rest, workspaceId: "" },
      requestId,
    );
  });
  it("rejects an empty echo for an app-global request and a mismatched echo for a scoped one", async () => {
    await expect(
      dispatchBotRun({ ...runInput, workspaceId: "" }, async () => ({
        ok: true as const,
        result: { ...runReceipt, workspaceId: "" },
      })),
    ).resolves.toMatchObject({ ok: false, error: { code: "internal_error" } });
    await expect(
      dispatchBotRun(runInput, async () => ({
        ok: true as const,
        result: { ...runReceipt, workspaceId: "other" },
      })),
    ).resolves.toMatchObject({ ok: false, error: { code: "internal_error" } });
  });
  it("still rejects malformed turns before IPC, even app-global ones", async () => {
    const call = vi.fn();
    expect(
      await dispatchBotRun(
        { ...runInput, workspaceId: "", botId: "" },
        call,
      ),
    ).toMatchObject({ ok: false, error: { code: "invalid_argument" } });
    expect(call).not.toHaveBeenCalled();
  });
});
