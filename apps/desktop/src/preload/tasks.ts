import { ipcRenderer } from "electron";
import type { TasksBridge } from "../shared/tasks-contract";

/** `window.drogon.tasks.*` namespace; channels are handled by main/tasks-bridge.ts. */
export const tasks: TasksBridge = {
  tasksList: (value) => ipcRenderer.invoke("drogon:tasksList", value),
  tasksShow: (value) => ipcRenderer.invoke("drogon:tasksShow", value),
  tasksStart: (value) => ipcRenderer.invoke("drogon:tasksStart", value),
  tasksLinks: (value) => ipcRenderer.invoke("drogon:tasksLinks", value),
  tasksRemotes: (value) => ipcRenderer.invoke("drogon:tasksRemotes", value),
  tasksProjects: () => ipcRenderer.invoke("drogon:tasksProjects", {}),
  tasksWorktrees: (value) => ipcRenderer.invoke("drogon:tasksWorktrees", value),
};
