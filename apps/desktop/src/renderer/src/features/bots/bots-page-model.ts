/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/use-bots-page-controller.ts (`createBot`'s
   field-mapping logic) and src/shared/drogon-bot-characters.ts's
   `drogonBotDisplayName` default fallback. Adapter: harness policy is
   restricted to the 4 real HarnessId values this repo's harness.start
   admits (no free-text harness id, no explicitModel at creation -- native's
   born-empty contract requires it null); responsibilities are never part of
   the create payload (native creates a Bot with zero responsibilities by
   invariant, enforced independently in crates/drogon-core). */

import type { BotCreateInput } from "../../../../shared/bot-contract";
import type { BotCharacterPreset } from "./bot-characters";
import { botDisplayName } from "./bot-characters";
import { previewCronFires } from "../automations/automation-cron-preview";

/** The only harness ids `harness.start` admits (see
 *  apps/desktop/src/shared/bridge-validation.ts's harnessLaunch schema). */
export const BOT_HARNESS_IDS = [
  "claude",
  "pi",
  "opencode",
  "antigravity",
] as const;
export type BotHarnessId = (typeof BOT_HARNESS_IDS)[number];

/** Source `getAgentLabel`, restricted to this repo's 4 admitted harness ids. */
const HARNESS_LABELS: Record<BotHarnessId, string> = {
  claude: "Claude",
  pi: "Pi",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

export function botHarnessLabel(harnessId: string): string {
  return HARNESS_LABELS[harnessId as BotHarnessId] ?? harnessId;
}

export type BotCreateFormValues = {
  preset: BotCharacterPreset;
  displayName: string;
  handle: string;
  title: string;
  harnessId: BotHarnessId;
  /** Ported field for source parity (enabled only for the "pi" harness,
   *  matching source behavior); never sent at creation regardless of value
   *  -- native's born-empty contract requires `explicitModel: null`. */
  model: string;
  instructions: string;
  memories: string;
};

export function emptyBotCreateForm(): BotCreateFormValues {
  return {
    preset: "arya",
    displayName: "",
    handle: "",
    title: "",
    harnessId: "claude",
    model: "",
    instructions: "",
    memories: "",
  };
}

/** Builds the exact `body` shape `botCreateInputSchema` admits: born empty
 *  of responsibilities/session, `explicitModel` forced null at creation. */
export function buildBotCreateBody(
  form: BotCreateFormValues,
): BotCreateInput["body"] {
  return {
    characterPreset: form.preset,
    displayIdentity: {
      displayName: botDisplayName(form.displayName, form.preset),
      handle: form.handle.trim() || null,
      title: form.title.trim() || null,
    },
    harnessPolicy: { defaultHarness: form.harnessId, explicitModel: null },
    instructions: form.instructions,
    memories: form.memories
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

export function isBotCreateFormReady(form: BotCreateFormValues): boolean {
  return botDisplayName(form.displayName, form.preset).length > 0;
}

/** R7-E add-responsibility form: scheduled-only (name, UTC cron, prompt).
 *  The Bot's workspace and harness come from the selected bot/scope at
 *  submit time, never from this form -- no fake schedules. */
export type ResponsibilityFormValues = {
  name: string;
  cron: string;
  prompt: string;
};

export function emptyResponsibilityForm(): ResponsibilityFormValues {
  return { name: "", cron: "* * * * *", prompt: "" };
}

/** Ready only when the daemon could actually schedule it: same cron
 *  preview helper the Automations page uses, so an expression the form
 *  accepts is one the scheduler fires. */
export function isResponsibilityFormReady(
  form: ResponsibilityFormValues,
  nowMs: number = Date.now(),
): boolean {
  return (
    form.name.trim().length > 0 &&
    form.prompt.trim().length > 0 &&
    previewCronFires(form.cron, nowMs) !== null
  );
}
