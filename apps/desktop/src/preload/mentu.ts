import { ipcRenderer } from "electron";
import type { MentuBridge } from "../shared/mentu-contract";

/** `window.drogon.mentu.*` namespace; channels are handled by main/mentu-bridge.ts. */
export const mentu: MentuBridge = {
  mentuRecipes: (value) => ipcRenderer.invoke("drogon:mentuRecipes", value),
  mentuRecipe: (value) => ipcRenderer.invoke("drogon:mentuRecipe", value),
  mentuRecipeSave: (value) => ipcRenderer.invoke("drogon:mentuRecipeSave", value),
  mentuRuntime: () => ipcRenderer.invoke("drogon:mentuRuntime", {}),
  mentuApprove: (value) => ipcRenderer.invoke("drogon:mentuApprove", value),
  mentuRun: (value) => ipcRenderer.invoke("drogon:mentuRun", value),
  mentuRuns: (value) => ipcRenderer.invoke("drogon:mentuRuns", value),
  mentuRunStatus: (value) =>
    ipcRenderer.invoke("drogon:mentuRunStatus", value),
  mentuRunEvidence: (value) =>
    ipcRenderer.invoke("drogon:mentuRunEvidence", value),
  mentuRetry: (value) => ipcRenderer.invoke("drogon:mentuRetry", value),
  mentuCancel: (value) => ipcRenderer.invoke("drogon:mentuCancel", value),
};
