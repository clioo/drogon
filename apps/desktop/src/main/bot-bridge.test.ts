import { describe, expect, it, vi } from "vitest";
import { dispatchBotSnapshot } from "./bot-bridge";

const input = { hostId: "host", workspaceId: "workspace", locale: "en-US" };
const snapshot = {
  hostId: "host",
  workspaceId: "workspace",
  bots: [],
  history: [],
};
describe("Bot snapshot bridge", () => {
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
