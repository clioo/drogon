/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/main/ipc/native-notification-delivery.ts click-to-navigate binding
   (adapter: preload side only — subscribes to the focus/state channels the
   main notifications service emits). */
import { ipcRenderer } from "electron";
import {
  notificationsIpcChannels,
  type FocusSessionEvent,
  type NotificationsBridge,
  type SessionStateChangedEvent,
} from "../shared/notifications-contract";

/** `window.drogon.notifications.*` namespace; main side in main/notifications/service. */
export const notifications: NotificationsBridge = {
  getEnabled: () => ipcRenderer.invoke(notificationsIpcChannels.getEnabled),
  setEnabled: (enabled) =>
    ipcRenderer.invoke(notificationsIpcChannels.setEnabled, enabled),
  onFocusSession: (listener: (event: FocusSessionEvent) => void) => {
    const wrapped = (_event: unknown, value: FocusSessionEvent) =>
      listener(value);
    ipcRenderer.on(notificationsIpcChannels.focusSession, wrapped);
    return () =>
      ipcRenderer.removeListener(notificationsIpcChannels.focusSession, wrapped);
  },
  onStateChanged: (listener: (event: SessionStateChangedEvent) => void) => {
    const wrapped = (_event: unknown, value: SessionStateChangedEvent) =>
      listener(value);
    ipcRenderer.on(notificationsIpcChannels.stateChanged, wrapped);
    return () =>
      ipcRenderer.removeListener(
        notificationsIpcChannels.stateChanged,
        wrapped,
      );
  },
};
