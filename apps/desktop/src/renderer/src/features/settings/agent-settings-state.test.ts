import { describe, expect, test, vi } from "vitest";
import {
  AGENT_SETTINGS_DEFAULTS,
  type AgentSettingsBridge,
} from "../../../../shared/agent-settings-contract";
import { addGeneratedTitles } from "./agent-generated-titles";
import {
  createAgentSettingsState,
  migrateAgentPreferences,
} from "./agent-settings-state";
import {
  applyAgentPermissionMode,
  resolveAgentPermissionModeSummary,
} from "./agent-permissions";
import { cacheCountdown } from "../shell/AgentCacheTimer";
import type { Session } from "../../../../shared/session-contract";

describe("native preference state", () => {
  test.each(["overlap", "retry", "missing-bridge"])(
    "retains migration across %s loads",
    async (mode) => {
      const get = vi.fn<AgentSettingsBridge["get"]>().mockResolvedValue({
        ok: true,
        result: { initialized: false, settings: AGENT_SETTINGS_DEFAULTS },
      });
      const update = vi.fn<AgentSettingsBridge["update"]>().mockResolvedValue({
        ok: true,
        result: { initialized: true, settings: AGENT_SETTINGS_DEFAULTS },
      });
      let available = mode !== "missing-bridge";
      const state = createAgentSettingsState(() =>
        available ? { get, update } : undefined,
      );
      const legacy = { defaultTuiAgent: "pi" as const };
      if (mode === "overlap") {
        const child = state.load();
        await Promise.all([child, state.load(legacy)]);
      } else if (mode === "missing-bridge") {
        await state.load(legacy);
        available = true;
        await state.load();
      } else {
        get.mockResolvedValueOnce({
          ok: false,
          error: { code: "unverifiable", message: "Offline", retryable: true },
        });
        await state.load(legacy);
        await state.load();
      }
      expect(update).toHaveBeenCalledWith({
        updates: legacy,
        onlyIfUninitialized: true,
      });
    },
  );
  test("migration preserves explicit blank and model/effort as quoted launch arguments", () => {
    expect(migrateAgentPreferences({})).toEqual({});
    expect(migrateAgentPreferences({ defaultHarnessId: "" })).toEqual({
      defaultTuiAgent: "blank",
    });
    expect(
      migrateAgentPreferences({
        defaultHarnessId: "pi",
        harnessDefaults: {
          pi: {
            model: "provider/model",
            effort: "high",
            permissionMode: "inherit",
          },
        },
      }),
    ).toEqual({
      defaultTuiAgent: "pi",
      agentDefaultArgs: { pi: "--model 'provider/model' --thinking 'high'" },
    });
  });
  test("failed write leaves acknowledged settings intact and the queue accepts a retry", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { message: "Disk full" } })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          initialized: true,
          settings: { ...AGENT_SETTINGS_DEFAULTS, defaultTuiAgent: "pi" },
        },
      });
    const bridge = {
      get: vi.fn(async () => ({
        ok: true,
        result: { initialized: true, settings: AGENT_SETTINGS_DEFAULTS },
      })),
      update,
    } as AgentSettingsBridge;
    const state = createAgentSettingsState(() => bridge);
    await state.load();
    await expect(state.update({ defaultTuiAgent: "pi" })).rejects.toThrow(
      "Disk full",
    );
    expect(state.getSnapshot().settings.defaultTuiAgent).toBe(null);
    expect(state.getSnapshot().saving).toBe(false);
    await state.update({ defaultTuiAgent: "pi" });
    expect(state.getSnapshot().settings.defaultTuiAgent).toBe("pi");
    expect(state.getSnapshot().error).toBe(null);
  });
  test("queued availability updates calculate against the latest acknowledged state", async () => {
    let settings = structuredClone(AGENT_SETTINGS_DEFAULTS);
    const bridge: AgentSettingsBridge = {
      get: async () => ({ ok: true, result: { settings, initialized: true } }),
      update: async ({ updates }) => {
        settings = { ...settings, ...updates } as typeof settings;
        return { ok: true, result: { settings, initialized: true } };
      },
    };
    const state = createAgentSettingsState(() => bridge);
    await state.load();
    await Promise.all(
      ["pi", "claude"].map((id) =>
        state.update((latest) => ({
          disabledTuiAgents: [
            ...latest.disabledTuiAgents,
            id as "pi" | "claude",
          ],
        })),
      ),
    );
    expect(state.getSnapshot().settings.disabledTuiAgents).toEqual([
      "pi",
      "claude",
    ]);
  });
  test("migration only initializes a pristine native store", async () => {
    const update = vi.fn(async () => ({
      ok: true as const,
      result: { initialized: true, settings: AGENT_SETTINGS_DEFAULTS },
    }));
    const state = createAgentSettingsState(() => ({
      get: async () => ({
        ok: true,
        result: { initialized: false, settings: AGENT_SETTINGS_DEFAULTS },
      }),
      update,
    }));
    await state.load({ defaultTuiAgent: "pi" });
    expect(update).toHaveBeenCalledWith({
      onlyIfUninitialized: true,
      updates: { defaultTuiAgent: "pi" },
    });
  });
});
describe("source permission policy", () => {
  test("global Manual/Yolo preserves explicit custom launch arguments", () => {
    const settings = {
      ...AGENT_SETTINGS_DEFAULTS,
      agentDefaultArgs: {
        ...AGENT_SETTINGS_DEFAULTS.agentDefaultArgs,
        claude: "--model fixture --dangerously-skip-permissions",
      },
    };
    expect(resolveAgentPermissionModeSummary(settings)).toBe("mixed");
    const updates = applyAgentPermissionMode(settings, "manual");
    expect(updates.agentDefaultArgs).toEqual({ codex: "", antigravity: "" });
    expect(updates.agentDefaultArgs).not.toHaveProperty("claude");
    expect(updates.agentDefaultArgs).not.toHaveProperty("pi");
  });
});
describe("real session metadata consumers", () => {
  test("first prompt names stay stable; disabling prevents new names without erasing old ones", () => {
    const first = {
      id: "session",
      agentPromptPreview:
        "Can you please refactor the auth middleware to use JWT tokens?",
    } as Session;
    expect(addGeneratedTitles({}, [first], false)).toEqual({});
    const titles = addGeneratedTitles({}, [first], true);
    expect(titles.session).toBe("Refactor the auth middleware to use JWT");
    expect(
      addGeneratedTitles(
        titles,
        [{ ...first, agentPromptPreview: "another request" }],
        true,
      ),
    ).toBe(titles);
  });
  test("cache countdown follows the source rounding, warning and expiry", () => {
    expect(cacheCountdown(1000, 300000, 1000)).toEqual({
      label: "5:00",
      expired: false,
      warning: false,
    });
    expect(cacheCountdown(1000, 300000, 241000)).toEqual({
      label: "1:00",
      expired: false,
      warning: true,
    });
    expect(cacheCountdown(1000, 300000, 400000)).toEqual({
      label: "0:00",
      expired: true,
      warning: false,
    });
  });
});
