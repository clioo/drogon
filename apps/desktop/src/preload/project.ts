import { ipcRenderer } from "electron";
import type { ProjectBridge } from "../shared/project-contract";

/** `window.drogon.project.*` namespace; channels are handled by main/project-bridge.ts. */
export const project: ProjectBridge = {
  projectAdd: (value) => ipcRenderer.invoke("drogon:projectAdd", value),
  projectList: () => ipcRenderer.invoke("drogon:projectList"),
  projectRemove: (value) => ipcRenderer.invoke("drogon:projectRemove", value),
  worktreeCreate: (value) => ipcRenderer.invoke("drogon:worktreeCreate", value),
  worktreeList: (value) => ipcRenderer.invoke("drogon:worktreeList", value),
  worktreeRemove: (value) =>
    ipcRenderer.invoke("drogon:worktreeRemove", value),
};
