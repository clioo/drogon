import { ipcRenderer } from "electron";
import type { UsageBridge } from "../shared/usage-contract";

/** Preload side of the usage bridge; the main side lives in main/usage/service. */
export const usageBridge: UsageBridge = {
  snapshot: () => ipcRenderer.invoke("drogon:usageSnapshot"),
  refresh: () => ipcRenderer.invoke("drogon:usageRefresh"),
  setAwake: (mode) => ipcRenderer.invoke("drogon:usageSetAwake", mode),
};
