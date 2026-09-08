// MIT Copyright (c) 2026 Lovecast Inc.
// `window.drogon.nativeTheme` namespace (#241, additive): relays Electron's
// nativeTheme state and 'updated' events between main and the renderer so
// the "System" theme resolves from shouldUseDarkColors with live OS updates.
import { ipcRenderer } from "electron";
import type {
  NativeThemeBridge,
  NativeThemeSource,
  NativeThemeState,
} from "../shared/settings-contract";

export const NATIVE_THEME_CHANGED_CHANNEL = "drogon:nativeThemeChanged";

export const nativeTheme: NativeThemeBridge = {
  state: () => ipcRenderer.invoke("drogon:nativeThemeState"),
  setThemeSource: (theme: NativeThemeSource) =>
    ipcRenderer.invoke("drogon:nativeThemeSource", theme),
  onChange: (listener: (state: NativeThemeState) => void) => {
    const wrapped = (_event: unknown, state: unknown) => {
      // Malformed payloads are dropped, never thrown into the listener.
      if (
        typeof state === "object" &&
        state !== null &&
        typeof (state as NativeThemeState).shouldUseDarkColors === "boolean"
      )
        listener(state as NativeThemeState);
    };
    ipcRenderer.on(NATIVE_THEME_CHANGED_CHANNEL, wrapped);
    return () =>
      ipcRenderer.removeListener(NATIVE_THEME_CHANGED_CHANNEL, wrapped);
  },
};
