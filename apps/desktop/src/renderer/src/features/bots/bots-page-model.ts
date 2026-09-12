/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/use-bots-page-controller.ts (`createBot`'s
   field-mapping logic) and src/shared/drogon-bot-characters.ts's
   `drogonBotDisplayName` default fallback. Adapter: harness policy is
   restricted to the 5 real HarnessId values this repo's harness.start
   admits (no free-text harness id, no explicitModel at creation -- native's
   born-empty contract requires it null); responsibilities are never part of
   the create payload (native creates a Bot with zero responsibilities by
   invariant, enforced independently in crates/drogon-core). */

import type {
  BotCreateInput,
  BotRunHarnessOverrides,
  BotsPanelBot,
  BotsPanelHostObservation,
  BotMonitorHealth,
  BotMonitorView,
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
  "codex",
] as const;
export type BotHarnessId = (typeof BOT_HARNESS_IDS)[number];

/** Source `getAgentLabel`, restricted to this repo's 5 admitted harness ids. */
const HARNESS_LABELS: Record<BotHarnessId, string> = {
  claude: "Claude",
  pi: "Pi",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  codex: "Codex",
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
 *  means no overrides. `permissionMode` is `unattended` for Pi and Codex: a
 *  bot run is headless with no approval-answer affordance (an inherited
 *  prompt would stall it at `needs_input` forever), and these are the
 *  harnesses whose explicit flags are part of the native headless contract.
 *  Other harnesses keep inherited prompts rather than silently escalating
 *  theirs. */
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
  if (harnessId === "pi" || harnessId === "codex") {
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

/** Whether a harness exposes a mechanism to reopen a prior conversation
 *  (Defect 2). Every harness this app launches does — Claude Code, Pi,
 *  OpenCode and Antigravity take `--continue`; Codex takes the
 *  `resume --last` subcommand. The helper exists so a caller can refuse
 *  honestly instead of presenting a blank session as a continuation if an
 *  unknown/unsupported harness ever appears. */
export function harnessSupportsConversationResume(
  harnessId: string | null | undefined,
): boolean {
  return (
    harnessId === "claude" ||
    harnessId === "pi" ||
    harnessId === "opencode" ||
    harnessId === "antigravity" ||
    harnessId === "codex"
  );
}

/**
 * What the Bots page must SAY about a reopen, or `null` when there is nothing
 * to disclose. Reopening a Bot's session always runs the harness's own resume
 * path, but the strength of that resume depends on whether the daemon recorded
 * the provider conversation the harness reported:
 *
 * - `resumeByIdentity` set: the launch names THAT conversation, so nothing
 *   needs saying — the session comes back as itself.
 * - `resumeByIdentity` null and the harness can continue: the best available
 *   answer is the CLI's own most-recent conversation in the Bot's home. That
 *   is a real continuation, but it is not the recorded one, so the page says
 *   which conversation it asked for instead of implying an exact restore.
 * - harness without a resume verb: a NEW session opens, and the page says so
 *   rather than presenting it as a continuation.
 */
export function botReopenNotice(input: {
  harnessId: string;
  resumeByIdentity?: "session" | "bot-record" | null;
}): string | null {
  if (!harnessSupportsConversationResume(input.harnessId)) {
    return `${input.harnessId} cannot reopen its previous conversation; a NEW session was opened instead.`;
  }
  if (!input.resumeByIdentity) {
    return `${input.harnessId} will reopen its most recent conversation in this Bot's home; no exact session id was recorded for it.`;
  }
  return null;
}
// ---------------------------------------------------------------------------
// Owner-design page model (task_197f6a7eb370). Pure derivations over real
// snapshot/monitor data only — every label below is computed from a stored
// fact, never invented to match the mockup's sample values.
// ---------------------------------------------------------------------------

/** Square avatar tile initials: first character of the first two words,
 *  uppercase. A single-word name yields one initial; an empty name never
 *  happens (native requires a display name). */
export function botInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => {
      for (const ch of word) {
        if (/\p{L}|\p{N}/u.test(ch)) return ch.toUpperCase();
      }
      return "";
    })
    .join("");
  return initials || "?";
}

export type BotStatusPill = {
  label: string;
  tone: "ready" | "idle" | "live";
};

/** True when the bot has nothing configured at all: no responsibilities,
 *  no monitors, no session. Exactly the collapsed-row state the design
 *  calls out. */
export function isBotUnconfigured(
  bot: Pick<BotsPanelBot, "responsibilities" | "currentSession">,
  monitorCount: number,
): boolean {
  return (
    bot.responsibilities.length === 0 &&
    monitorCount === 0 &&
    bot.currentSession === null
  );
}

/** Status pill, honest by construction:
 *  - an observed-live session is the daemon's own verdict → "In session";
 *  - nothing configured (no responsibilities, monitors or session) is the
 *    design's muted "Idle";
 *  - everything else renders the design's green "Ready for a purpose"
 *    (the bot exists and is idle-ready, exactly like the mock's configured
 *    bot). `unverifiable`/`exited` observations make NO live claim. */
export function botStatusPill(input: {
  bot: Pick<BotsPanelBot, "responsibilities" | "currentSession">;
  monitorCount: number;
  observedLiveness?: BotsPanelHostObservation;
}): BotStatusPill {
  if (input.observedLiveness === "live") {
    return { label: "In session", tone: "live" };
  }
  if (isBotUnconfigured(input.bot, input.monitorCount)) {
    return { label: "Idle", tone: "idle" };
  }
  return { label: "Ready for a purpose", tone: "ready" };
}

/** The header count chip: bots that are more than idle — configured or
 *  observed in-session. Zero stays "0 active": a real count, never hidden. */
export function countActiveBots(
  bots: BotsPanelBot[],
  monitorsByBotId: Record<string, BotMonitorView[]>,
  observedLivenessByBotId?: Record<string, BotsPanelHostObservation>,
): number {
  return bots.filter((bot) => {
    const pill = botStatusPill({
      bot,
      monitorCount: monitorsByBotId[bot.id]?.length ?? 0,
      observedLiveness: observedLivenessByBotId?.[bot.id],
    });
    return pill.tone !== "idle";
  }).length;
}

/** Case-insensitive client-side filter over real fields only: display
 *  name, handle, title/instructions description, responsibility names. */
export function filterBots(
  bots: BotsPanelBot[],
  rawQuery: string,
): BotsPanelBot[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return bots;
  return bots.filter((bot) => {
    const haystack = [
      bot.displayIdentity.displayName,
      bot.displayIdentity.handle ?? "",
      bot.displayIdentity.title ?? "",
      bot.instructions,
      ...bot.responsibilities.map((item) => item.name),
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export type MonitorHealthPill = {
  label: string;
  tone: "watching" | "warning" | "failing" | "muted";
};

/** The daemon's own durable health verdict, mapped to a chip. `healthy`
 *  reads as the design's "Watching" — a monitor with a cursor and zero
 *  errors is exactly that — while every degraded state keeps its real
 *  name. */
export function monitorHealthPill(health: BotMonitorHealth): MonitorHealthPill {
  switch (health) {
    case "healthy":
      return { label: "Watching", tone: "watching" };
    case "degraded":
      return { label: "Degraded", tone: "warning" };
    case "failing":
      return { label: "Failing", tone: "failing" };
    case "needs_approval":
      return { label: "Needs approval", tone: "warning" };
    case "disabled":
      return { label: "Paused", tone: "muted" };
  }
}

/** Card title for a monitor: the watched resource when the rule kind
 *  carries one, else the rule kind itself (fail-closed, like the
 *  renderer's own MonitorCard). Never a fabricated name — monitors have
 *  no name field in the store. A `github_pr.v1` watch names the
 *  repository it watches (the daemon flattens `repo` into the view);
 *  that is the owner's headline case and must never render as a bare
 *  internal token. */
export function monitorTitle(view: BotMonitorView): string {
  if (view.ruleKind === "github_pr.v1") {
    return typeof view.repo === "string" && view.repo.length > 0
      ? view.repo
      : view.ruleKind;
  }
  const resource =
    typeof view.resource === "string" && view.resource
      ? view.resource
      : typeof view.scriptPath === "string" && view.scriptPath
        ? view.scriptPath
        : null;
  return resource ?? view.ruleKind;
}

/**
 * The SOURCE cell, honest per rule kind — never the bare rule kind for a
 * kind this build renders:
 * - a `github_pr.v1` watch shows the repository it watches and its case
 *   (the filter, with the login it compares against);
 * - a file watch shows its path; a script watch shows its script path;
 * - an http poll's URL text is sealed daemon-side (only its hash
 *   travels), so the cell says that in words instead of printing the
 *   hash as if it were the URL;
 * - an unknown kind keeps the fail-closed raw-token fallback.
 */
export function monitorSourceLabel(view: BotMonitorView): string {
  switch (view.ruleKind) {
    case "github_pr.v1": {
      const repo =
        typeof view.repo === "string" && view.repo ? view.repo : null;
      const filter =
        typeof view.filter === "string" && view.filter ? view.filter : null;
      const login =
        typeof view.login === "string" && view.login ? view.login : null;
      if (!repo) return view.ruleKind;
      const caseText = filter
        ? login
          ? `case: ${filter} (${login})`
          : `case: ${filter}`
        : null;
      return caseText ? `${repo} · ${caseText}` : repo;
    }
    case "local_file_digest.v1":
      return typeof view.resource === "string" && view.resource
        ? view.resource
        : view.ruleKind;
    case "script_command.v1":
      return typeof view.scriptPath === "string" && view.scriptPath
        ? view.scriptPath
        : view.ruleKind;
    case "http_poll.v1": {
      const hash = typeof view.urlHash === "string" ? view.urlHash : "";
      const prefix = hash.slice(0, 8);
      return `URL sealed by the daemon${prefix ? ` (hash ${prefix}…)` : ""}`;
    }
    default:
      return view.ruleKind;
  }
}

export type MonitorLastCheck = {
  /** "Healthy" | "Degraded" | "Failing" — the durable verdict. */
  healthLabel: string;
  /** Relative age of the newest real check row, e.g. "8m ago". */
  ageLabel: string;
} | null;
/** LAST CHECK cell: health word + the newest durable check row's age, or
 *  null when no check has ever run (the store has no row to show). */
export function monitorLastCheck(
  view: BotMonitorView,
  now: number = Date.now(),
): MonitorLastCheck {
  if (view.lastCheckAtMs === null || view.lastCheckAtMs === undefined) {
    return null;
  }
  const healthLabel =
    view.health === "healthy"
      ? "Healthy"
      : view.health === "degraded"
        ? "Degraded"
        : view.health === "failing"
          ? "Failing"
          : null;
  const deltaMs = Math.max(0, now - view.lastCheckAtMs);
  const minutes = Math.floor(deltaMs / 60_000);
  const ageLabel =
    deltaMs < 60_000
      ? "now"
      : minutes < 60
        ? `${minutes}m ago`
        : `${Math.floor(minutes / 60)}h ago`;
  return {
    healthLabel: healthLabel ?? "Checked",
    ageLabel,
  };
}

/** The trigger cell: "Manual" or the real cron expression. */
export function monitorTriggerLabel(
  trigger: BotMonitorView["trigger"],
): string {
  return trigger.kind === "scheduled" ? trigger.cron : "Manual";
}

/** ACTION cell: what the monitor releases when it fires. Bound monitors
 *  name their responsibility (by name when the bot still carries it, else
 *  by id); unbound monitors observe and record only — an honest absence,
 *  not a promise. */
export function monitorActionLabel(
  view: Pick<BotMonitorView, "responsibilityId">,
  responsibilityName: string | null,
): string {
  if (!view.responsibilityId) return "Observes only";
  return `Dispatches ${responsibilityName ?? view.responsibilityId}`;
}

export type MonitorLastFiring = {
  /** The settled delegation verdict, worded for the card. */
  label: string;
  /** True when the verdict is one a user should look into. */
  adverse: boolean;
  /** The honest refusal reason, when the daemon recorded one. */
  detail: string | null;
  /** The released case's own resource (`pull/42` for a pull-request
   *  watch, the watched path for a file watch) — WHAT the firing
   *  released. Null on evidence rows written before the daemon's
   *  delegation schema version 3. */
  caseLabel: string | null;
  /** Relative age of the firing, e.g. "8m ago". */
  ageLabel: string;
};

const MONITOR_FIRING_LABELS: Record<
  NonNullable<BotMonitorView["firing"]>["lastOutcome"],
  { label: string; adverse: boolean }
> = {
  dispatched: { label: "Prompt sent", adverse: false },
  joined_existing: { label: "Prompt sent (replay)", adverse: false },
  refused: { label: "Refused", adverse: true },
  orphaned: { label: "Target missing", adverse: true },
  cap_exceeded: { label: "Cap reached", adverse: true },
  stale_skipped: { label: "Too old to act", adverse: true },
};

/** LAST FIRING cell: the newest durable delegation verdict for this
 *  monitor with its age, or null when the monitor has never released an
 *  action. Every wording maps 1:1 to a stored outcome — nothing invented. */
export function monitorLastFiring(
  view: BotMonitorView,
  now: number = Date.now(),
): MonitorLastFiring | null {
  if (!view.firing) return null;
  const wording = MONITOR_FIRING_LABELS[view.firing.lastOutcome];
  if (!wording) return null;
  const deltaMs = Math.max(0, now - view.firing.lastAtMs);
  const minutes = Math.floor(deltaMs / 60_000);
  const ageLabel =
    deltaMs < 60_000
      ? "now"
      : minutes < 60
        ? `${minutes}m ago`
        : `${Math.floor(minutes / 60)}h ago`;
  return {
    label: wording.label,
    adverse: wording.adverse,
    detail: view.firing.lastDetail,
    caseLabel: view.firing.lastResource,
    ageLabel,
  };
}

/** Collapsed-row muted line: what is genuinely true about the bot. The
 *  "Standby workspace initialized" suffix is only claimed when the daemon
 *  actually provisioned the bot's dedicated home. */
export function collapsedRowNote(
  bot: Pick<BotsPanelBot, "home">,
): string {
  return bot.home
    ? "No automations or monitors yet · Standby workspace initialized"
    : "No automations or monitors yet";
}
