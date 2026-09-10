import { ipcRenderer } from "electron";
import type {
  BotCreateInput,
  BotDeleteInput,
  BotHistoryInput,
  BotMonitorListInput,
  BotResponsibilityCreateInput,
  BotResponsibilityDeleteInput,
  BotRunTurnInput,
} from "../shared/bot-contract";

/** Flat additions to `window.drogon.*` for R2-S (create/run/history),
 *  R7-E (responsibility create/delete) and R9-C (bot delete);
 *  `botSnapshot` stays where it already is in preload/index.ts. Channels
 *  are handled by main/bot-bridge.ts's own `registerBotBridge`. */
export const botBridgeExtras = {
  botCreate: (value: BotCreateInput) =>
    ipcRenderer.invoke("drogon:botCreate", value),
  botRun: (value: BotRunTurnInput) =>
    ipcRenderer.invoke("drogon:botRun", value),
  botHistory: (value: BotHistoryInput) =>
    ipcRenderer.invoke("drogon:botHistory", value),
  botResponsibilityCreate: (value: BotResponsibilityCreateInput) =>
    ipcRenderer.invoke("drogon:botResponsibilityCreate", value),
  botResponsibilityDelete: (value: BotResponsibilityDeleteInput) =>
    ipcRenderer.invoke("drogon:botResponsibilityDelete", value),
  botDelete: (value: BotDeleteInput) =>
    ipcRenderer.invoke("drogon:botDelete", value),
  /** Bots-page monitor read (`bot.monitor_list`): the REAL durable
   *  monitor state behind the redesigned page's MONITORS column. */
  botMonitorList: (value: BotMonitorListInput) =>
    ipcRenderer.invoke("drogon:botMonitorList", value),
};
