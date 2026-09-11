import type {
  BotsPanelBot,
  BotsPanelHostObservation,
  BotsPanelHistoryEntry,
  BotsPanelProps,
  BotsPanelResponsibility,
  BotsPanelTrigger,
} from "./bots-panel-contracts";

// Pure display projections for the Bots panel. Ordering semantics follow the
// admitted storage contracts: the bot list is locale-sorted by display name
// (source listBots: displayName.localeCompare) and history arrives newest-first
// from the store — the panel preserves that order and never re-sorts or
// invents joins. Host observations are evidence labels only, never automation
// status or a completion verdict.

export const READY_FOR_A_PURPOSE = "Ready for a purpose";
export const HARNESS_DEFAULT_MODEL_LABEL = "Harness default";
export const SESSION_LINKED_LABEL = "Session linked";
export const SESSION_NONE_LABEL = "No session yet";

/** Persisted session association only. This is a storage fact about a link,
 *  never a liveness verdict — a stored session can be stale. */
export type BotsPanelSessionLink = "linked" | "none";

export type BotsPanelBotRow = {
  id: string;
  displayName: string;
  handle: string | null;
  description: string;
  harness: string;
  modelLabel: string;
  scheduledCount: number;
  reactiveCount: number;
  enabledCount: number;
  sessionLink: BotsPanelSessionLink;
};

export type BotsPanelResponsibilityRow = {
  id: string;
  name: string;
  kind: BotsPanelResponsibility["kind"];
  triggerLabel: string;
  recipeRef: string | null;
  enabled: boolean;
  canManualRun: boolean;
};

export type BotsPanelHistoryRow = {
  runId: string;
  startedAt: number;
  endedAt: number | null;
  hostObservation: BotsPanelHistoryEntry["run"]["hostObservation"];
  responsibilityName: string | null;
  automationName: string | null;
  automationRunNumber: number | null;
  automationRunStatus: string | null;
  triggerLabel: "Scheduled" | "Manual" | "Monitor event";
};

/** Display label for how a history run was invoked. A `null` invocation
 *  predates native's stamp, and every such row was recorded through
 *  `bot.run` (the scheduler never wrote responsibility runs), so `null`
 *  reads as manual -- never invented, just the only possible origin. A
 *  `reactive` row was released by a monitor event through the delegation
 *  drain — neither a schedule fire nor a human click. */
export function historyTriggerLabel(
  invocation: BotsPanelHistoryEntry["run"]["invocation"],
): "Scheduled" | "Manual" | "Monitor event" {
  if (invocation === "scheduled") return "Scheduled";
  if (invocation === "reactive") return "Monitor event";
  return "Manual";
}

export function botDescription(
  entry: Pick<BotsPanelBot, "displayIdentity" | "instructions">,
): string {
  const title = entry.displayIdentity.title?.trim();
  if (title) return title;
  const instructions = entry.instructions.trim();
  if (instructions) return instructions;
  return READY_FOR_A_PURPOSE;
}

export function modelLabel(policy: BotsPanelBot["harnessPolicy"]): string {
  return policy.explicitModel ?? HARNESS_DEFAULT_MODEL_LABEL;
}

export function triggerLabel(trigger: BotsPanelTrigger): string {
  if (trigger.kind === "scheduled") return trigger.automationId;
  return trigger.event ?? "connected event";
}

export function projectBotRows(bots: BotsPanelBot[]): BotsPanelBotRow[] {
  return [...bots]
    .sort((left, right) =>
      left.displayIdentity.displayName.localeCompare(
        right.displayIdentity.displayName,
      ),
    )
    .map((entry) => ({
      id: entry.id,
      displayName: entry.displayIdentity.displayName,
      handle: entry.displayIdentity.handle,
      description: botDescription(entry),
      harness: entry.harnessPolicy.defaultHarness,
      modelLabel: modelLabel(entry.harnessPolicy),
      scheduledCount: entry.responsibilities.filter(
        (item) => item.kind === "scheduled",
      ).length,
      reactiveCount: entry.responsibilities.filter(
        (item) => item.kind === "reactive",
      ).length,
      enabledCount: entry.responsibilities.filter((item) => item.enabled)
        .length,
      sessionLink: entry.currentSession !== null ? "linked" : "none",
    }));
}

/** Liveness comes only from the caller's observation map, rendered verbatim.
 *  It never reads the bot record: a stored (possibly stale) session never
 *  becomes a liveness verdict, and an unobserved bot gets null — no claim. */
export function projectSessionLiveness(
  botId: string,
  observedLivenessByBotId: BotsPanelProps["observedLivenessByBotId"],
): BotsPanelHostObservation | null {
  return observedLivenessByBotId?.[botId] ?? null;
}

export function projectResponsibilityRows(
  bot: Pick<BotsPanelBot, "responsibilities">,
): BotsPanelResponsibilityRow[] {
  return bot.responsibilities.map((item) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    triggerLabel: triggerLabel(item.trigger),
    recipeRef: item.recipe?.recipeRef ?? null,
    enabled: item.enabled,
    canManualRun: item.kind === "scheduled" && item.enabled,
  }));
}

export function projectHistoryRows(
  history: BotsPanelHistoryEntry[],
): BotsPanelHistoryRow[] {
  return history.map((entry) => ({
    runId: entry.run.id,
    startedAt: entry.run.startedAt,
    endedAt: entry.run.endedAt,
    hostObservation: entry.run.hostObservation,
    responsibilityName: entry.responsibilityName,
    automationName: entry.automationName,
    automationRunNumber: entry.automationRunNumber,
    automationRunStatus: entry.automationRunStatus,
    triggerLabel: historyTriggerLabel(entry.run.invocation),
  }));
}
