/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/preload/api/ui-bridge-tab-and-browser-commands.ts (appMenu paste and
   selection listeners) and src/renderer/src/hooks/useUnreadDockBadge.ts
   (setUnreadDockBadgeCount channel shape; adapter: main side in
   main/menu/register-app-menu.ts wiring and main/dock/unread-badge.ts). */
import { ipcRenderer } from "electron";
import {
  menuIpcChannels,
  appMenuCommandSchema,
  appearanceMenuStateSchema,
  setUnreadDockBadgeCountSchema,
  type AppMenuBridge,
  type AppMenuCommand,
  type AppMenuSelectionAction,
  type AppearanceMenuState,
} from "../shared/menu-contract";

/** `window.drogon.appMenu.*` namespace; main side in main/menu + main/index. */
export const appMenu: AppMenuBridge = {
  onPaste: (listener: () => void) => {
    const wrapped = () => listener();
    ipcRenderer.on(menuIpcChannels.appMenuPaste, wrapped);
    return () => ipcRenderer.removeListener(menuIpcChannels.appMenuPaste, wrapped);
  },
  onSelectionAction: (listener: (action: AppMenuSelectionAction) => void) => {
    const wrapped = (_event: unknown, action: AppMenuSelectionAction) =>
      listener(action);
    ipcRenderer.on(menuIpcChannels.appMenuSelectionAction, wrapped);
    return () =>
      ipcRenderer.removeListener(menuIpcChannels.appMenuSelectionAction, wrapped);
  },
  onCommand: (listener: (command: AppMenuCommand) => void) => {
    const wrapped = (_event: unknown, command: unknown) => {
      const validated = appMenuCommandSchema.safeParse(command);
      if (validated.success) listener(validated.data);
    };
    ipcRenderer.on(menuIpcChannels.appMenuCommand, wrapped);
    return () =>
      ipcRenderer.removeListener(menuIpcChannels.appMenuCommand, wrapped);
  },
  reportAppearanceState: (state: AppearanceMenuState) =>
    ipcRenderer.invoke(
      menuIpcChannels.appearanceState,
      appearanceMenuStateSchema.parse(state),
    ),
  setUnreadDockBadgeCount: (count: number) =>
    ipcRenderer.invoke(
      menuIpcChannels.setUnreadDockBadgeCount,
      setUnreadDockBadgeCountSchema.parse(count),
    ),
  // Dev-only menu invoke seam (non-packaged builds); absent in packaged apps.
  invokeMenuItem: (label: string) =>
    ipcRenderer.invoke(menuIpcChannels.menuInvoke, label),
};
