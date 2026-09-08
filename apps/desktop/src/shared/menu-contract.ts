// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
//   src/main/menu/register-app-menu.ts (channel names, AppearanceMenuState,
//   AppMenuSelectionAction),
//   src/preload/api/ui-bridge-tab-and-browser-commands.ts (appMenu paste and
//     selection listener shape),
//   src/main/startup/main-process-i18n-menu.ts (toggle forwarding and
//     appearance state feeding the menu checkbox marks).
// Adapted: Drogon's appearance settings live in the renderer settings store,
// so main holds no copy — the renderer reports the state and main rebuilds
// the menu; the Show Orca Mobile Button key is out of the MVP. Paste,
// selection, sidebar/settings toggles forward over one command channel
// because the renderer owns those surfaces.
import { z } from "zod";

/** Source channel names, kept verbatim for parity. */
export const menuIpcChannels = {
  /** Main -> renderer: menu Paste with no focused editable target. */
  appMenuPaste: "ui:appMenuPaste",
  /** Main -> renderer: Copy / Select All aimed at the page selection. */
  appMenuSelectionAction: "ui:appMenuSelectionAction",
  /** Main -> renderer: one channel for the shell-owned menu commands. */
  appMenuCommand: "ui:appMenuCommand",
  /** Renderer -> main: appearance checkbox marks + menu rebuild. */
  appearanceState: "ui:appMenuAppearanceState",
  /** Renderer -> main: macOS dock unread badge count. */
  setUnreadDockBadgeCount: "app:setUnreadDockBadgeCount",
  /** Renderer -> main (dev only, non-packaged): trigger a menu item by label. */
  menuInvoke: "drogon:menuInvoke",
} as const;

/** The four appearance flags the View > Appearance submenu checkbox-marks. */
export const appearanceMenuKeys = [
  "statusBarVisible",
  "tasksButtonVisible",
  "automationsButtonVisible",
  "titlebarAppNameVisible",
] as const;
export type AppearanceMenuKey = (typeof appearanceMenuKeys)[number];

export type AppearanceMenuState = Record<AppearanceMenuKey, boolean>;

export const appearanceMenuStateSchema = z.object({
  statusBarVisible: z.boolean(),
  tasksButtonVisible: z.boolean(),
  automationsButtonVisible: z.boolean(),
  titlebarAppNameVisible: z.boolean(),
});

export const setUnreadDockBadgeCountSchema = z.number().int().min(0).max(9999);

export type AppMenuSelectionAction = "copy" | "select-all";

/** Shell-owned commands the native menu forwards to the renderer. */
export type AppMenuCommand =
  | { type: "open-settings" }
  | { type: "toggle-left-sidebar" }
  | { type: "toggle-right-sidebar" }
  | { type: "toggle-appearance"; key: AppearanceMenuKey };

export const appMenuCommandSchema: z.ZodType<AppMenuCommand> = z.discriminatedUnion(
  "type",
  [
    z.object({ type: z.literal("open-settings") }),
    z.object({ type: z.literal("toggle-left-sidebar") }),
    z.object({ type: z.literal("toggle-right-sidebar") }),
    z.object({ type: z.literal("toggle-appearance"), key: z.enum(appearanceMenuKeys) }),
  ],
);

export interface AppMenuBridge {
  onPaste(listener: () => void): () => void;
  onSelectionAction(
    listener: (action: AppMenuSelectionAction) => void,
  ): () => void;
  onCommand(listener: (command: AppMenuCommand) => void): () => void;
  /** Reports the appearance flags; main stores them and rebuilds the menu. */
  reportAppearanceState(state: AppearanceMenuState): Promise<boolean>;
  /** macOS dock badge; darwin-only in main, a no-op elsewhere. */
  setUnreadDockBadgeCount(count: number): Promise<boolean>;
  /** Dev only: invoke a native menu item by bare label; false when absent. */
  invokeMenuItem?(label: string): Promise<boolean>;
}

// Optional like the granted `git`/`browser`/`notifications` namespaces
// (supplied at runtime by preload via Object.assign, never constructed in
// the bridge literal), so older preloads without it keep typechecking.
declare module "./session-contract" {
  interface DesktopBridge {
    appMenu?: AppMenuBridge;
  }
}
