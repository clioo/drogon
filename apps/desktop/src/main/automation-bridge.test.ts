import { describe, expect, it, vi } from "vitest";
import { dispatchAutomationRequest } from "./automation-bridge";

const SUMMARY = {
  id: "a1",
  name: "nightly",
  cron: "* * * * *",
  workspaceId: "w1",
  harness: "pi",
  prompt: "sweep",
  enabled: true,
  nextRunAt: 1000,
  lastRunAt: null,
  lastRun: null,
};

describe("dispatchAutomationRequest", () => {
  it("rejects a malformed envelope without calling native", async () => {
    const call = vi.fn();
    const result = await dispatchAutomationRequest({ op: "nope" }, call);
    expect(result.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects invalid create input without calling native", async () => {
    const call = vi.fn();
    const result = await dispatchAutomationRequest(
      { op: "create", params: { name: "x" } },
      call,
    );
    expect(result.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("forwards list and validates the native result", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      result: { automations: [SUMMARY] },
    }));
    const result = await dispatchAutomationRequest({ op: "list", params: {} }, call);
    expect(call).toHaveBeenCalledWith("automation.list", {});
    expect(result).toEqual({ ok: true, result: { automations: [SUMMARY] } });
  });

  it("maps runNow to automation.run_now and checks the contract", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      result: {
        automationId: "a1",
        runId: "ar:x",
        outcome: "dispatched",
        status: "dispatched",
        refusal: null,
        error: null,
      },
    }));
    const result = await dispatchAutomationRequest(
      { op: "runNow", params: { id: "a1" } },
      call,
    );
    expect(call).toHaveBeenCalledWith("automation.run_now", { id: "a1" });
    expect(result.ok).toBe(true);
  });

  it("refuses a history response for another automation", async () => {
    const call = vi.fn(async () => ({
      ok: true as const,
      result: {
        runs: [
          {
            id: "ar:x",
            automationId: "other",
            status: "completed",
            trigger: "manual",
            scheduledFor: 1,
            workspaceId: "w1",
            terminalSessionId: "s1",
            error: null,
            exitCode: 0,
            startedAt: 1,
            dispatchedAt: 1,
            createdAt: 1,
          },
        ],
      },
    }));
    const result = await dispatchAutomationRequest(
      { op: "history", params: { automationId: "a1" } },
      call,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal_error");
  });

  it("passes native errors through verbatim", async () => {
    const call = vi.fn(async () => ({
      ok: false as const,
      error: { code: "not_found", message: "gone", retryable: false },
    }));
    const result = await dispatchAutomationRequest(
      { op: "delete", params: { id: "a1" } },
      call,
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "not_found", message: "gone", retryable: false },
    });
  });
});
