import { ipcRenderer } from "electron";
import {
  PROJECTS_CHANGED_CHANNEL,
  type ProjectBridge,
} from "../shared/project-contract";

/** `window.drogon.project.*` namespace; channels are handled by main/project-bridge.ts. */
export const project: ProjectBridge = {
  projectAdd: (value) => ipcRenderer.invoke("drogon:projectAdd", value),
  projectList: () => ipcRenderer.invoke("drogon:projectList"),
  projectRemove: (value) => ipcRenderer.invoke("drogon:projectRemove", value),
  projectUpdate: (value) => ipcRenderer.invoke("drogon:projectUpdate", value),
  quickSessionCreate: (value) =>
    ipcRenderer.invoke("drogon:quickSessionCreate", value),
  sparsePresets: (value) => ipcRenderer.invoke("drogon:sparsePresets", value),
  saveSparsePreset: (value) =>
    ipcRenderer.invoke("drogon:saveSparsePreset", value),
  worktreeCreate: (value) => ipcRenderer.invoke("drogon:worktreeCreate", value),
  worktreeBranchSearch: (value) =>
    ipcRenderer.invoke("drogon:worktreeBranchSearch", value),
  worktreeList: (value) => ipcRenderer.invoke("drogon:worktreeList", value),
  worktreeRemove: (value) => ipcRenderer.invoke("drogon:worktreeRemove", value),
  worktreeRename: (value) => ipcRenderer.invoke("drogon:worktreeRename", value),
  worktreeUpdate: (value) => ipcRenderer.invoke("drogon:worktreeUpdate", value),
  // Issue #146: registry pushes from main's `project.changes` poller (same
  // subscribe/unsubscribe shape as preload/notifications.ts).
  onProjectsChanged: (listener: (revision: string) => void) => {
    const wrapped = (_event: unknown, revision: unknown) => {
      if (typeof revision === "string") listener(revision);
    };
    ipcRenderer.on(PROJECTS_CHANGED_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(PROJECTS_CHANGED_CHANNEL, wrapped);
  },
};
