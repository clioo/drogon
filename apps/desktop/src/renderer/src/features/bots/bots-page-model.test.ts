import { describe, expect, it } from "vitest";
import {
  BOT_HARNESS_IDS,
  PRESETS,
  applyBotCharacterPreset,
  buildBotCreateBody,
  buildBotRunHarness,
  emptyBotCreateForm,
  emptyResponsibilityForm,
  isBotCreateFormReady,
  isResponsibilityFormReady,
} from "./bots-page-model";

describe("bots-page-model", () => {
  it("defaults to a ready-to-submit form (preset carries a display name)", () => {
    const form = emptyBotCreateForm();
    expect(isBotCreateFormReady(form)).toBe(true);
    expect(BOT_HARNESS_IDS).toContain(form.harnessId);
  });

  it("is not ready when preset is none and no name is supplied", () => {
    expect(
      isBotCreateFormReady({
        ...emptyBotCreateForm(),
        preset: "none",
        displayName: "",
      }),
    ).toBe(false);
  });

  it("builds a born-empty body with trimmed memories and a null model when blank", () => {
    const body = buildBotCreateBody({
      preset: "arya",
      displayName: "",
      handle: "  watcher  ",
      title: "",
      harnessId: "claude",
      model: "",
      instructions: "Guard the realm.",
      memories: "One fact\n\n  Another fact  \n",
    });
    expect(body).toEqual({
      characterPreset: "arya",
      displayIdentity: {
        displayName: "Arya Stark",
        handle: "watcher",
        title: null,
      },
      harnessPolicy: { defaultHarness: "claude", explicitModel: null },
      instructions: "Guard the realm.",
      memories: ["One fact", "Another fact"],
    });
  });

  it("carries the Pi provider/model string into explicitModel (R16-S, fork controller parity)", () => {
    const body = buildBotCreateBody({
      ...emptyBotCreateForm(),
      harnessId: "pi",
      model: "  dgx-spark/qwen3.8-flash-next-nvidia-nvfp4  ",
    });
    expect(body.harnessPolicy).toEqual({
      defaultHarness: "pi",
      explicitModel: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
    });
    expect(
      buildBotCreateBody({ ...emptyBotCreateForm(), model: "   " })
        .harnessPolicy.explicitModel,
    ).toBeNull();
  });

  it("splits a provider/model string into bot.run overrides, unattended for Pi only", () => {
    expect(
      buildBotRunHarness("pi", "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"),
    ).toEqual({
      harnessId: "pi",
      provider: "dgx-spark",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      permissionMode: "unattended",
    });
    // Bare model id (no slash): Pi accepts it as --model.
    expect(buildBotRunHarness("pi", "qwen3.8-flash")).toEqual({
      harnessId: "pi",
      model: "qwen3.8-flash",
      permissionMode: "unattended",
    });
    // Null/blank: no model overrides, but Pi runs still go unattended.
    expect(buildBotRunHarness("pi", null)).toEqual({
      harnessId: "pi",
      permissionMode: "unattended",
    });
    // Other harnesses keep inherited prompts (no silent escalation).
    expect(buildBotRunHarness("claude", null)).toEqual({
      harnessId: "claude",
    });
    expect(buildBotRunHarness("claude", "sonnet")).toEqual({
      harnessId: "claude",
      model: "sonnet",
    });
  });

  it("never includes responsibilities or a session in the create body (native's born-empty invariant)", () => {
    const body = buildBotCreateBody(emptyBotCreateForm());
    expect(body).not.toHaveProperty("responsibilities");
    expect(body).not.toHaveProperty("currentSession");
  });
});

describe("character presets (source PRESETS parity)", () => {
  it("lists every character once, starting with the default preset", () => {
    expect(PRESETS.length).toBeGreaterThan(6);
    expect(PRESETS[0]).toEqual({ value: "arya", label: "Arya Stark" });
    expect(new Set(PRESETS.map((entry) => entry.value)).size).toBe(
      PRESETS.length,
    );
  });

  it("applies the preset without touching the user's purpose", () => {
    const form = {
      ...emptyBotCreateForm(),
      instructions: "Guard the realm.",
    };
    expect(applyBotCharacterPreset(form, "tyrion")).toEqual({
      preset: "tyrion",
      instructions: "Guard the realm.",
    });
  });
});

describe("responsibility form model", () => {
  const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);

  it("defaults to the every-minute schedule the Automations page uses", () => {
    expect(emptyResponsibilityForm()).toEqual({
      name: "",
      cron: "* * * * *",
      prompt: "",
    });
  });

  it("is ready only with a name, a prompt and a previewable cron", () => {
    expect(
      isResponsibilityFormReady(
        { name: "Duty", cron: "* * * * *", prompt: "Do it." },
        NOW,
      ),
    ).toBe(true);
    expect(
      isResponsibilityFormReady(
        { name: "  ", cron: "* * * * *", prompt: "Do it." },
        NOW,
      ),
    ).toBe(false);
    expect(
      isResponsibilityFormReady(
        { name: "Duty", cron: "* * * * *", prompt: "  " },
        NOW,
      ),
    ).toBe(false);
    expect(
      isResponsibilityFormReady(
        { name: "Duty", cron: "FREQ=DAILY", prompt: "Do it." },
        NOW,
      ),
    ).toBe(false);
  });
});
