import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../shared/session-contract";

const bridge: DesktopBridge = {
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
};
contextBridge.exposeInMainWorld("drogon", Object.freeze(bridge));
