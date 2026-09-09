import { ipcRenderer } from "electron";
import type { AgentSettingsBridge } from "../shared/agent-settings-contract";
export const agentSettings: AgentSettingsBridge = {
  get: () => ipcRenderer.invoke("drogon:agentSettingsGet"),
  update: (input) => ipcRenderer.invoke("drogon:agentSettingsUpdate", input),
};
