import { ipcRenderer } from "electron";
import type { GitBridge } from "../shared/git-contract";

/** `window.drogon.git.*` namespace; channels are handled by main/git-bridge.ts. */
export const git: GitBridge = {
  gitStatus: (value) => ipcRenderer.invoke("drogon:gitStatus", value),
  gitDiff: (value) => ipcRenderer.invoke("drogon:gitDiff", value),
  gitStage: (value) => ipcRenderer.invoke("drogon:gitStage", value),
  gitUnstage: (value) => ipcRenderer.invoke("drogon:gitUnstage", value),
  gitCommit: (value) => ipcRenderer.invoke("drogon:gitCommit", value),
  gitPush: (value) => ipcRenderer.invoke("drogon:gitPush", value),
  gitPrCreate: (value) => ipcRenderer.invoke("drogon:gitPrCreate", value),
};
