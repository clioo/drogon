import { ipcRenderer } from "electron";
import {
  browserIpcChannels,
  type BrowserBridge,
  type BrowserStateEvent,
} from "../shared/browser-contract";

/** `window.drogon.browser.*` namespace; channels are handled by main/browser/browser-ipc.ts. */
export const browser: BrowserBridge = {
  createTab: (value) => ipcRenderer.invoke(browserIpcChannels.createTab, value),
  closeTab: (value) => ipcRenderer.invoke(browserIpcChannels.closeTab, value),
  navigate: (value) => ipcRenderer.invoke(browserIpcChannels.navigate, value),
  back: (value) => ipcRenderer.invoke(browserIpcChannels.back, value),
  forward: (value) => ipcRenderer.invoke(browserIpcChannels.forward, value),
  reload: (value) => ipcRenderer.invoke(browserIpcChannels.reload, value),
  stop: (value) => ipcRenderer.invoke(browserIpcChannels.stop, value),
  setBounds: (value) => ipcRenderer.invoke(browserIpcChannels.setBounds, value),
  snapshot: (value) => ipcRenderer.invoke(browserIpcChannels.snapshot, value),
  onState: (listener: (event: BrowserStateEvent) => void) => {
    const wrapped = (_event: unknown, state: BrowserStateEvent) => listener(state);
    ipcRenderer.on(browserIpcChannels.state, wrapped);
    return () => ipcRenderer.removeListener(browserIpcChannels.state, wrapped);
  },
};
