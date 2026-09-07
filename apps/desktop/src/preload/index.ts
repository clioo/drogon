import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../shared/session-contract";
import { installBrowserWindowCloseGuard } from "./browser-window-close-installation";
import { usageBridge } from "./usage";

contextBridge.executeInMainWorld({ func: installBrowserWindowCloseGuard });

const bridge: DesktopBridge = {
  botSnapshot: (value) => ipcRenderer.invoke("drogon:botSnapshot", value),
  fileList: (value) => ipcRenderer.invoke("drogon:fileList", value),
  fileRead: (value) => ipcRenderer.invoke("drogon:fileRead", value),
  fileWrite: (value) => ipcRenderer.invoke("drogon:fileWrite", value),
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
};
contextBridge.exposeInMainWorld("drogon", Object.freeze(bridge));
