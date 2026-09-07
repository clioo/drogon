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
  SESSION_LINKED_LABEL,
  SESSION_NONE_LABEL,
  botDescription,
  modelLabel,
  projectBotRows,
  projectHistoryRows,
  projectResponsibilityRows,
  projectSessionLiveness,
  triggerLabel,
} from "./bots-panel-projection";
export type { BotsPanelSessionLink } from "./bots-panel-projection";
export { createBotsPanelDescriptor } from "./bots-panel-descriptor";
export type {
  BotsPanelDescriptor,
  BotsPanelDescriptorInput,
} from "./bots-panel-descriptor";
export { BotResponsibilityCard } from "./BotResponsibilityCard";
export { ResponsibilityFormCard } from "./BotsPageForms";
export {
  emptyResponsibilityForm,
  isResponsibilityFormReady,
} from "./bots-page-model";
export type { ResponsibilityFormValues } from "./bots-page-model";
