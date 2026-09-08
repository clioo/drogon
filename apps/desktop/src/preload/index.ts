import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../shared/session-contract";
import { automationBridge } from "./automation";
import { installBrowserWindowCloseGuard } from "./browser-window-close-installation";
import { usageBridge } from "./usage";
import { git } from "./git";
import { project } from "./project";
import { shell } from "./shell";
import { browser } from "./browser";
import { settings } from "./settings";
import { notifications } from "./notifications";
import { tasks } from "./tasks";
import { mentu } from "./mentu";
import { botBridgeExtras } from "./bot";

contextBridge.executeInMainWorld({ func: installBrowserWindowCloseGuard });

const bridge: DesktopBridge = {
  automation: automationBridge,
  botSnapshot: (value) => ipcRenderer.invoke("drogon:botSnapshot", value),
  fileList: (value) => ipcRenderer.invoke("drogon:fileList", value),
  fileRead: (value) => ipcRenderer.invoke("drogon:fileRead", value),
  fileWrite: (value) => ipcRenderer.invoke("drogon:fileWrite", value),
  fileCreate: (value) => ipcRenderer.invoke("drogon:fileCreate", value),
  fileRename: (value) => ipcRenderer.invoke("drogon:fileRename", value),
  fileDelete: (value) => ipcRenderer.invoke("drogon:fileDelete", value),
  status: () => ipcRenderer.invoke("drogon:status"),
  workspaces: () => ipcRenderer.invoke("drogon:workspaces"),
  addWorkspace: (value) => ipcRenderer.invoke("drogon:addWorkspace", value),
  chooseFolder: () => ipcRenderer.invoke("drogon:chooseFolder"),
  sessions: (value) => ipcRenderer.invoke("drogon:sessions", value),
  start: (value) => ipcRenderer.invoke("drogon:start", value),
  read: (value) => ipcRenderer.invoke("drogon:read", value),
  write: (value) => ipcRenderer.invoke("drogon:write", value),
  resize: (value) => ipcRenderer.invoke("drogon:resize", value),
  stop: (value) => ipcRenderer.invoke("drogon:stop", value),
  harnesses: () => ipcRenderer.invoke("drogon:harnesses"),
  startHarness: (value) => ipcRenderer.invoke("drogon:startHarness", value),
  buildInfo: () => ipcRenderer.invoke("drogon:buildInfo"),
  usage: usageBridge,
  settings,
};
// Reconciles the granted namespaces (git, browser, notifications, tasks,
// project, shell and the R2-S botCreate/botRun/botHistory additions) with
// the coordinator-owned DesktopBridge type without editing it: a
// runtime-only merge before the freeze, so no existing key changes shape.
Object.assign(
  bridge,
  { git, browser, notifications, shell, tasks, project, mentu },
  botBridgeExtras,
);
contextBridge.exposeInMainWorld("drogon", Object.freeze(bridge));
