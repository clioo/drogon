import { ipcRenderer } from "electron";
import type {
  BotCreateInput,
  BotHistoryInput,
  BotRunTurnInput,
} from "../shared/bot-contract";

/** Flat additions to `window.drogon.*` for R2-S (create/run/history);
 *  `botSnapshot` stays where it already is in preload/index.ts. Channels
 *  are handled by main/bot-bridge.ts's own `registerBotBridge`. */
export const botBridgeExtras = {
  botCreate: (value: BotCreateInput) =>
    ipcRenderer.invoke("drogon:botCreate", value),
  botRun: (value: BotRunTurnInput) =>
    ipcRenderer.invoke("drogon:botRun", value),
  botHistory: (value: BotHistoryInput) =>
    ipcRenderer.invoke("drogon:botHistory", value),
};
