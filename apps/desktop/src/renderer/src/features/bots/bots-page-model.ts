/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/use-bots-page-controller.ts (`createBot`'s
   field-mapping logic) and src/shared/drogon-bot-characters.ts's
   `drogonBotDisplayName` default fallback. Adapter: harness policy is
   restricted to the 4 real HarnessId values this repo's harness.start
   admits (no free-text harness id, no explicitModel at creation -- native's
   born-empty contract requires it null); responsibilities are never part of
   the create payload (native creates a Bot with zero responsibilities by
   invariant, enforced independently in crates/drogon-core). */

import type {
  BotCreateInput,
  BotRunHarnessOverrides,
} from "../../../../shared/bot-contract";
import type { BotCharacterPreset } from "./bot-characters";
import { BOT_CHARACTERS, botDisplayName } from "./bot-characters";
import { previewCronFires } from "../automations/automation-cron-preview";

/** Source `PRESETS` (the fork's bots-page-model re-exports its shared
 *  character list under this name for the picker). */
export const PRESETS = BOT_CHARACTERS;

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

/** Source `applyBotCharacterPreset`: character style is composed at launch,
 *  never written over the user's purpose. */
export function applyBotCharacterPreset(
  form: BotCreateFormValues,
  preset: BotCharacterPreset,
): Partial<BotCreateFormValues> {
  return { preset, instructions: form.instructions };
}

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
 *  of responsibilities/session. `explicitModel` carries the form's Model
 *  field verbatim (the fork controller's `model.trim() || null`): the
 *  create boundary admits `string | null` (R16-S deviation) and native
 *  bounds it, so a Pi bot keeps its provider/model selection for `bot.run`
 *  to resolve. */
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
    harnessPolicy: {
      defaultHarness: form.harnessId,
      explicitModel: form.model.trim() || null,
    },
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

/** Splits the stored `explicitModel` (`provider/model`, the create form's
 *  Model field shape) into `bot.run` harness overrides. No slash (or an
 *  empty side) means a bare model id, which Pi also accepts; null/blank
 *  means no overrides. `permissionMode` is `unattended` for Pi only: a bot
 *  run is headless with no approval-answer affordance (an inherited prompt
 *  would stall it at `needs_input` forever, as the daemon probe showed),
 *  and Pi's flag trusts only the run's project files -- other harnesses
 *  keep inherited prompts rather than silently escalating theirs. */
export function buildBotRunHarness(
  harnessId: string,
  explicitModel: string | null,
): BotRunHarnessOverrides {
  const overrides: BotRunHarnessOverrides = { harnessId };
  const model = (explicitModel ?? "").trim();
  if (model) {
    const slash = model.indexOf("/");
    if (slash > 0 && slash < model.length - 1) {
      overrides.provider = model.slice(0, slash);
      overrides.model = model.slice(slash + 1);
    } else {
      overrides.model = model;
    }
  }
  if (harnessId === "pi") {
    overrides.permissionMode = "unattended";
  }
  return overrides;
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
