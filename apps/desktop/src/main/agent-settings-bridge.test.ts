import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { AGENT_SETTINGS_DEFAULTS } from "../shared/agent-settings-contract";
const { handlers, callNative } = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (event: unknown, input?: unknown) => Promise<unknown>
  >(),
  callNative: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      name: string,
      handler: (event: unknown, input?: unknown) => Promise<unknown>,
    ) => handlers.set(name, handler),
  },
}));
vi.mock("./native-client", () => ({ callNative }));
import { registerAgentSettingsBridge } from "./agent-settings-bridge";
const webContents = { mainFrame: {} };
const event = { sender: webContents, senderFrame: webContents.mainFrame };
beforeEach(() => {
  callNative.mockReset();
  handlers.clear();
  registerAgentSettingsBridge(() => ({ webContents }) as BrowserWindow);
});
describe("Agents IPC boundary", () => {
  test("settings updates pass through the validated native endpoint", async () => {
    callNative.mockResolvedValue({
      ok: true,
      result: { initialized: true, settings: AGENT_SETTINGS_DEFAULTS },
    });
    const result = await handlers.get("drogon:agentSettingsUpdate")!(event, {
      updates: { defaultTuiAgent: "pi" },
    });
    expect(callNative).toHaveBeenCalledWith("agent.settings_update", {
      updates: { defaultTuiAgent: "pi" },
    });
    expect(result).toEqual({
      ok: true,
      result: { initialized: true, settings: AGENT_SETTINGS_DEFAULTS },
    });
  });
  test("foreign frames and unknown preferences never reach the daemon", async () => {
    for (const [sender, input] of [
      [{ ...event, senderFrame: {} }, { updates: {} }],
      [event, { updates: { bogus: true } }],
      [event, { updates: { agentCmdOverrides: { unknown: "x" } } }],
    ]) {
      expect(
        await handlers.get("drogon:agentSettingsUpdate")!(sender, input),
      ).toMatchObject({ ok: false });
    }
    expect(callNative).not.toHaveBeenCalled();
  });
  test("unreachable service and malformed results remain failures", async () => {
    callNative.mockResolvedValueOnce({
      ok: false,
      error: { code: "unreachable", message: "Offline", retryable: true },
    });
    expect(await handlers.get("drogon:agentSettingsGet")!(event)).toMatchObject(
      { ok: false, error: { code: "unreachable" } },
    );
    callNative.mockResolvedValueOnce({ ok: true, result: { settings: {} } });
    expect(await handlers.get("drogon:agentSettingsGet")!(event)).toMatchObject(
      { ok: false, error: { code: "contract_violation" } },
    );
  });
});
