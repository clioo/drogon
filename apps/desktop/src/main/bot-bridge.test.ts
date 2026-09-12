import { describe, expect, it, vi } from "vitest";
import {
  dispatchBotMonitorApprove,
  dispatchBotMonitorList,
  dispatchBotRun,
  dispatchBotSnapshot,
} from "./bot-bridge";

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
  homeNotice: null,
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
  it("rejects a foreign-host receipt for scoped and app-global requests (cross-host replay)", async () => {
    // Sibling dispatchers bind hostId exactly; the run gate did not, so a
    // receipt stamped with a foreign host plus a plausible workspace was
    // accepted. Native authorizes asserted==derived on success, so an
    // exact host match is correct for both scopes.
    const foreign = { ...runReceipt, hostId: "foreign-host" };
    await expect(
      dispatchBotRun(runInput, async () => ({
        ok: true as const,
        result: foreign,
      })),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
    await expect(
      dispatchBotRun({ ...runInput, workspaceId: "" }, async () => ({
        ok: true as const,
        result: { ...foreign, workspaceId: "owning-workspace" },
      })),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "internal_error" },
    });
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

  it("admits the open-session resume flag and forwards it verbatim", async () => {
    // Defect 2: the main-process input gate must accept `resume` on an
    // open-session dispatch, or the renderer's resume request dies as
    // "Invalid Bot run request." before it ever reaches native.
    const call = vi.fn(async () => ({ ok: true as const, result: runReceipt }));
    const openResume = {
      hostId: "host",
      workspaceId: "workspace",
      requestId: "req-open-1",
      botId: "bot-1",
      interactive: true,
      resume: true,
      harness: { harnessId: "pi" },
    };
    expect(await dispatchBotRun(openResume, call)).toEqual({
      ok: true,
      result: runReceipt,
    });
    const { requestId, ...params } = openResume;
    expect(call).toHaveBeenCalledExactlyOnceWith("bot.run", params, requestId);
  });

  it("refuses resume on a chat turn before IPC", async () => {
    const call = vi.fn();
    expect(await dispatchBotRun({ ...runInput, resume: true }, call)).toMatchObject({
      ok: false,
      error: { code: "invalid_argument" },
    });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("Bot monitor list bridge", () => {
  const monitorInput = { hostId: "host", workspaceId: "", botId: "bot-1" };
  const monitorView = {
    monitorId: "mon-1",
    version: 1,
    ruleKind: "local_file_digest.v1",
    projectId: "proj-1",
    enabled: true,
    approved: true,
    responsibilityId: null,
    cursor: "crc-1",
    lastEventId: null,
    health: "healthy",
    trigger: { kind: "scheduled", cron: "*/5 * * * *" },
    consecutiveErrors: 0,
    lastError: null,
    lastNotice: null,
    failureThreshold: 3,
    lastCheckAtMs: null,
    lastCheckOutcome: null,
    incidentCount: 0,
    delegationsToday: { used: 0, max: 10 },
    firing: null,
    resource: "notes/status.md",
    maxBytes: 65536,
  };

  it("admits the app-global '' request and demands native's resolved workspace echo", async () => {
    const result = {
      hostId: "host",
      botId: "bot-1",
      workspaceId: "resolved-ws",
      monitors: [monitorView],
    };
    const call = vi.fn(async () => ({ ok: true as const, result }));
    expect(await dispatchBotMonitorList(monitorInput, call)).toEqual({
      ok: true,
      result,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith("bot.monitor_list", monitorInput);
  });

  it("rejects a resolved-echo of '' and a foreign bot id", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      result: {
        hostId: "host",
        botId: "bot-1",
        workspaceId: "",
        monitors: [],
      },
    }));
    expect((await dispatchBotMonitorList(monitorInput, call)).ok).toBe(false);
    const foreign = vi.fn(async () => ({
      ok: true as const,
      result: {
        hostId: "host",
        botId: "bot-other",
        workspaceId: "resolved-ws",
        monitors: [],
      },
    }));
    expect((await dispatchBotMonitorList(monitorInput, foreign)).ok).toBe(false);
  });

  it("rejects malformed monitor rows and unknown health values", async () => {
    const badHealth = vi.fn(async () => ({
      ok: true as const,
      result: {
        hostId: "host",
        botId: "bot-1",
        workspaceId: "resolved-ws",
        monitors: [{ ...monitorView, health: "fine" }],
      },
    }));
    expect((await dispatchBotMonitorList(monitorInput, badHealth)).ok).toBe(
      false,
    );
    const badShape = vi.fn(async () => ({
      ok: true as const,
      result: {
        hostId: "host",
        botId: "bot-1",
        workspaceId: "resolved-ws",
        monitors: [{ ...monitorView, failureThreshold: "three" }],
      },
    }));
    expect((await dispatchBotMonitorList(monitorInput, badShape)).ok).toBe(
      false,
    );
  });

  it("refuses malformed requests before the native call", async () => {
    const call = vi.fn();
    expect(
      (
        await dispatchBotMonitorList(
          { hostId: "", workspaceId: "", botId: "" },
          call,
        )
      ).ok,
    ).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("Bot monitor approval bridge", () => {
  const approveInput = {
    hostId: "host",
    workspaceId: "",
    botId: "bot-1",
    monitorId: "mon-1",
  };

  it("admits the app-global '' request, echoes the resolved scope and demands a confirmed approval", async () => {
    const result = {
      hostId: "host",
      botId: "bot-1",
      workspaceId: "resolved-ws",
      monitorId: "mon-1",
      approved: true,
      approvalHash: "a".repeat(64),
    };
    const call = vi.fn(async () => ({ ok: true as const, result }));
    expect(await dispatchBotMonitorApprove(approveInput, call)).toEqual({
      ok: true,
      result,
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      "bot.monitor_approve",
      approveInput,
    );
  });

  it("rejects an echo of '', a foreign bot/monitor id, or an unconfirmed approval", async () => {
    const cases: Array<{
      botId: string;
      workspaceId: string;
      monitorId: string;
      approved: boolean;
    }> = [
      { ...approveInput, workspaceId: "", approved: true },
      { ...approveInput, botId: "bot-other", approved: true },
      { ...approveInput, monitorId: "mon-other", approved: true },
      { ...approveInput, approved: false },
    ];
    for (const override of cases) {
      const call = vi.fn(async () => ({
        ok: true as const,
        result: {
          hostId: "host",
          botId: override.botId,
          workspaceId: override.workspaceId === "" ? "" : "resolved-ws",
          monitorId: override.monitorId,
          approved: override.approved,
          approvalHash: "a".repeat(64),
        },
      }));
      expect((await dispatchBotMonitorApprove(approveInput, call)).ok).toBe(
        false,
      );
    }
  });

  it("refuses malformed requests before the native call", async () => {
    const call = vi.fn();
    expect(
      (
        await dispatchBotMonitorApprove(
          { hostId: "", workspaceId: "", botId: "", monitorId: "" },
          call,
        )
      ).ok,
    ).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});
