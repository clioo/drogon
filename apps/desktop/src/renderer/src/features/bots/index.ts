// Exported-but-unmounted Bots panel surface for V2 mounting. Do not mount
// this module from App.tsx/main.tsx here; V2 owns the single App mount point.
export { BotsPanel, default } from "./BotsPanel";
export type {
  BotsPanelBot,
  BotsPanelHistoryEntry,
  BotsPanelHostObservation,
  BotsPanelProps,
  BotsPanelRecipeLink,
  BotsPanelResponsibility,
  BotsPanelResponsibilityKind,
  BotsPanelSession,
  BotsPanelSnapshot,
  BotsPanelTrigger,
} from "./bots-panel-contracts";
export {
  HARNESS_DEFAULT_MODEL_LABEL,
  READY_FOR_A_PURPOSE,
  botDescription,
  modelLabel,
  projectBotRows,
  projectHistoryRows,
  projectResponsibilityRows,
  triggerLabel,
} from "./bots-panel-projection";
