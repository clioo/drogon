import { describe, expect, it } from "vitest";
import {
  BOT_HARNESS_IDS,
  buildBotCreateBody,
  emptyBotCreateForm,
  isBotCreateFormReady,
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

  it("builds a born-empty body with explicitModel forced null and trimmed memories", () => {
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

  it("never includes responsibilities or a session in the create body (native's born-empty invariant)", () => {
    const body = buildBotCreateBody(emptyBotCreateForm());
    expect(body).not.toHaveProperty("responsibilities");
    expect(body).not.toHaveProperty("currentSession");
  });
});
