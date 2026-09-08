import { ipcRenderer } from "electron";
import {
  browserIpcChannels,
  type BrowserBridge,
  type BrowserChordEvent,
  type BrowserContextMenuEvent,
  type BrowserFindResultEvent,
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
  getState: () => ipcRenderer.invoke(browserIpcChannels.getState),
  onState: (listener: (event: BrowserStateEvent) => void) => {
    const wrapped = (_event: unknown, state: BrowserStateEvent) => listener(state);
    ipcRenderer.on(browserIpcChannels.state, wrapped);
    // Replay the host's current tabs on subscribe: without it a fresh
    // subscriber (renderer reload, workspace reselect) shows an empty
    // strip until the next host event, while the guests stay alive in
    // main. A duplicate live event is idempotent downstream (React state
    // set to the same list), so subscribe-first-then-pull never loses one.
    void (ipcRenderer.invoke(browserIpcChannels.getState) as Promise<unknown>).then(
      (result) => {
        if (
          result &&
          typeof result === "object" &&
          (result as { ok?: unknown }).ok === true &&
          Array.isArray(
            (result as { result?: { tabs?: unknown } }).result?.tabs,
          )
        ) {
          listener((result as { result: BrowserStateEvent }).result);
        }
      },
      () => {},
    );
    return () => ipcRenderer.removeListener(browserIpcChannels.state, wrapped);
  },
  // Additive (R11-B chrome): reload/zoom/find/devtools plus the guest
  // find-result and context-menu events the pane chrome subscribes to.
  hardReload: (value) => ipcRenderer.invoke(browserIpcChannels.hardReload, value),
  zoomIn: (value) => ipcRenderer.invoke(browserIpcChannels.zoomIn, value),
  zoomOut: (value) => ipcRenderer.invoke(browserIpcChannels.zoomOut, value),
  zoomReset: (value) => ipcRenderer.invoke(browserIpcChannels.zoomReset, value),
  findInPage: (value) => ipcRenderer.invoke(browserIpcChannels.findInPage, value),
  stopFind: (value) => ipcRenderer.invoke(browserIpcChannels.stopFind, value),
  openDevTools: (value) => ipcRenderer.invoke(browserIpcChannels.openDevTools, value),
  onFindResult: (listener: (event: BrowserFindResultEvent) => void) => {
    const wrapped = (_event: unknown, result: BrowserFindResultEvent) =>
      listener(result);
    ipcRenderer.on(browserIpcChannels.findResult, wrapped);
    return () => ipcRenderer.removeListener(browserIpcChannels.findResult, wrapped);
  },
  onContextMenu: (listener: (event: BrowserContextMenuEvent) => void) => {
    const wrapped = (_event: unknown, menu: BrowserContextMenuEvent) =>
      listener(menu);
    ipcRenderer.on(browserIpcChannels.contextMenu, wrapped);
    return () => ipcRenderer.removeListener(browserIpcChannels.contextMenu, wrapped);
  },
  // Additive (R12-E): pane chords captured from the focused guest
  // webContents (main-side before-input-event forwarder).
  onChord: (listener: (event: BrowserChordEvent) => void) => {
    const wrapped = (_event: unknown, chord: BrowserChordEvent) =>
      listener(chord);
    ipcRenderer.on(browserIpcChannels.chord, wrapped);
    return () => ipcRenderer.removeListener(browserIpcChannels.chord, wrapped);
  },
};
