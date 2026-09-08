// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/menu/register-app-menu.ts (template structure, display-only
//     chord hints, Appearance submenu, registerAppMenu/rebuildAppMenu)
//   src/main/startup/main-process-i18n-menu.ts (callback wiring shape)
// Adapted: no i18n (English literals are the source's fallbacks), no
// updater/crash-reporter items (out of MVP by rule), Show Orca Mobile Button
// omitted (Mobile is out of the MVP), Help opens the Drogon repo/README
// externally, and zoom acts on the focused window's page zoom in main (this
// repo's keybinding table assigns the zoom chords to the native menu with no
// renderer handler). Sidebar/settings/appearance toggles forward to the
// renderer over the shared menu contract because the renderer owns them.
import { BrowserWindow, Menu, app } from "electron";
import {
  formatKeybindingList,
  getEffectiveKeybindingsForAction,
  getKeybindingPlatform,
} from "../../shared/keybindings";
import type {
  AppearanceMenuKey,
  AppearanceMenuState,
  AppMenuCommand,
} from "../../shared/menu-contract";
import { createAppMenuSelectionItem } from "./app-menu-selection-item";

export type { AppearanceMenuKey, AppearanceMenuState };

export const EXPLORE_DROGON_URL = "https://github.com/clioo/drogon";
export const DROGON_README_URL = "https://github.com/clioo/drogon#readme";

type RegisterAppMenuOptions = {
  onOpenSettings: () => void
  onOpenExploreDrogon: (window?: Electron.BaseWindow | null) => void
  onOpenGettingStarted: (window?: Electron.BaseWindow | null) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onToggleLeftSidebar: () => void
  onToggleRightSidebar: () => void
  onToggleAppearance: (key: AppearanceMenuKey) => void
  getAppearanceState: () => AppearanceMenuState
  // Why: the macOS app-menu title. Passed the per-branch dev label since
  // app.name is pinned to a stable value for Keychain-key stability.
  appMenuLabel?: string
}

function zoomFocusedWindow(step: "in" | "out" | "reset"): void {
  const webContents = BrowserWindow.getFocusedWindow()?.webContents;
  if (!webContents) {
    return;
  }
  if (step === "reset") {
    webContents.setZoomLevel(0);
    return;
  }
  const level = webContents.getZoomLevel();
  webContents.setZoomLevel(
    step === "in" ? Math.min(8, level + 0.5) : Math.max(-8, level - 0.5),
  );
}

export function buildAppMenuTemplate(
  options: RegisterAppMenuOptions,
): Electron.MenuItemConstructorOptions[] {
  const {
    onOpenSettings,
    onOpenExploreDrogon,
    onOpenGettingStarted,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleAppearance,
    getAppearanceState,
  } = options;

  const isMac = process.platform === "darwin";
  const appearance = getAppearanceState();
  const shortcutLabel = (actionId: string): string => {
    const bindings = getEffectiveKeybindingsForAction(
      actionId,
      getKeybindingPlatform(process.platform),
    );
    return formatKeybindingList(bindings, getKeybindingPlatform(process.platform));
  };

  const reloadFocusedWindow = (ignoreCache: boolean): void => {
    const webContents = BrowserWindow.getFocusedWindow()?.webContents;
    if (!webContents) {
      return;
    }

    if (ignoreCache) {
      webContents.reloadIgnoringCache();
      return;
    }

    webContents.reload();
  };

  const settingsItem: Electron.MenuItemConstructorOptions = {
    label: `Settings\t${shortcutLabel("app.settings")}`,
    click: () => onOpenSettings()
  };

  const featureTourItem: Electron.MenuItemConstructorOptions = {
    label: "Explore Drogon",
    click: (_menuItem, window) => onOpenExploreDrogon(window)
  };

  const setupGuideItem: Electron.MenuItemConstructorOptions = {
    label: "Getting Started with Drogon",
    click: (_menuItem, window) => onOpenGettingStarted(window)
  };

  // Why: the macOS app-menu (named after the app) is mandatory on darwin and
  // owns hide/hideOthers/unhide/services/quit roles that only make sense in
  // the system menu bar. On Windows/Linux that menu would render as a
  // redundant "Drogon" entry with roles that don't apply, so we omit it there
  // and distribute its items across File / Help instead.
  const macAppMenu: Electron.MenuItemConstructorOptions = {
    label: options.appMenuLabel ?? app.name,
    submenu: [
      { role: "about" },
      settingsItem,
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" }
    ]
  };

  const fileMenu: Electron.MenuItemConstructorOptions = {
    label: "File",
    // Why: on Windows/Linux there is no app-named menu, so Settings and
    // Quit live under File — matching the common platform convention and
    // keeping all user-facing actions reachable from the in-window menu bar.
    submenu: [
      settingsItem,
      { type: "separator" },
      { role: "quit", label: "Exit" }
    ]
  };

  // Why: keep native menu hints while letting non-macOS Ctrl+Z/Ctrl+Y reach the focused terminal or DOM control.
  const undoRedoOptions: Electron.MenuItemConstructorOptions = isMac
    ? {}
    : { registerAccelerator: false };
  const editMenu: Electron.MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo", ...undoRedoOptions },
      { role: "redo", ...undoRedoOptions },
      { type: "separator" },
      { role: "cut" },
      createAppMenuSelectionItem({ action: "copy", label: "Copy", isMac }),
      {
        label: "Paste",
        accelerator: "CmdOrCtrl+V",
        click: () => {
          // Why: a focused terminal pane is not a native editable control,
          // so raw Electron paste cannot know which surface owns it; the
          // renderer routes the request to the focused input.
          const focusedWindow = BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.webContents.send("ui:appMenuPaste");
            return;
          }

          // Why: a macOS native panel (open/save, Go to Folder) leaves no
          // focused BrowserWindow, so overriding the paste role would strand
          // Cmd+V as a no-op.
          if (isMac) {
            Menu.sendActionToFirstResponder("paste:");
          }
        }
      },
      createAppMenuSelectionItem({ action: "select-all", label: "Select All", isMac })
    ]
  };

  // Why: mirror VS Code's View > Appearance submenu so users can toggle
  // sidebar/status-bar/tasks-button/titlebar-activity from the menu bar as
  // well as from the settings pane. Electron doesn't reactively update
  // menu items when the backing state changes, so rebuildAppMenu() must be
  // called after every appearance update — each build reads current
  // appearance state through getAppearanceState() and produces a fresh
  // template with accurate `checked` values.
  const appearanceSubmenu: Electron.MenuItemConstructorOptions = {
    label: "Appearance",
    submenu: [
      {
        // Why: display-only shortcut hint — not a real accelerator. The
        // renderer owns the sidebar chords, and a menu accelerator here
        // would intercept the chord before the renderer's keydown handler
        // fires. Sidebar open/closed lives in the renderer store, so we
        // forward a toggle request rather than mirroring state in main.
        label: `Toggle Left Sidebar\t${shortcutLabel("sidebar.left.toggle")}`,
        click: () => onToggleLeftSidebar()
      },
      {
        // Why: display-only shortcut hint for the same reason as above.
        label: `Toggle Right Sidebar\t${shortcutLabel("sidebar.right.toggle")}`,
        click: () => onToggleRightSidebar()
      },
      {
        label: "Show Status Bar",
        type: "checkbox",
        checked: appearance.statusBarVisible,
        click: () => onToggleAppearance("statusBarVisible")
      },
      { type: "separator" },
      {
        label: "Show Tasks Button",
        type: "checkbox",
        checked: appearance.tasksButtonVisible,
        click: () => onToggleAppearance("tasksButtonVisible")
      },
      {
        label: "Show Automations Button",
        type: "checkbox",
        checked: appearance.automationsButtonVisible,
        click: () => onToggleAppearance("automationsButtonVisible")
      },
      {
        label: "Show Titlebar App Name",
        type: "checkbox",
        checked: appearance.titlebarAppNameVisible,
        click: () => onToggleAppearance("titlebarAppNameVisible")
      }
    ]
  };

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      {
        label: "Reload",
        click: () => reloadFocusedWindow(false)
      },
      {
        label: `Force Reload\t${shortcutLabel("app.forceReload")}`,
        click: () => reloadFocusedWindow(true)
      },
      { role: "toggleDevTools" },
      { type: "separator" },
      {
        label: `Reset Size\t${shortcutLabel("zoom.reset")}`,
        click: () => onZoomReset()
      },
      {
        label: `Zoom In\t${shortcutLabel("zoom.in")}`,
        click: () => onZoomIn()
      },
      {
        label: `Zoom Out\t${shortcutLabel("zoom.out")}`,
        click: () => onZoomOut()
      },
      { type: "separator" },
      {
        // Why: display-only shortcut hint — do NOT set `accelerator` here.
        // Menu accelerators intercept key events at the main-process level
        // before the renderer's keydown handler fires. The overlay
        // mutual-exclusion logic (which runs in the renderer) would be
        // bypassed if this were a real accelerator binding.
        label: `Open Worktree Palette\t${shortcutLabel("worktree.palette")}`
      },
      { type: "separator" },
      { role: "togglefullscreen" },
      { type: "separator" },
      appearanceSubmenu
    ]
  };

  const windowMenu: Electron.MenuItemConstructorOptions = {
    label: "Window",
    submenu: [{ role: "minimize" }, { role: "zoom" }]
  };

  const helpMenu: Electron.MenuItemConstructorOptions = {
    label: "Help",
    submenu: [
      featureTourItem,
      setupGuideItem,
      // Why: on Windows/Linux there is no app-named menu, so the About role
      // is redistributed here, matching the source minus the updater item.
      ...(isMac
        ? []
        : ([
            { type: "separator" },
            { role: "about" },
          ] satisfies Electron.MenuItemConstructorOptions[])),
    ],
  };

  return [
    ...(isMac ? [macAppMenu] : []),
    ...(isMac ? [] : [fileMenu]),
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu
  ];
}

function buildAndApplyMenu(options: RegisterAppMenuOptions): Electron.MenuItemConstructorOptions[] {
  const template = buildAppMenuTemplate(options);
  lastMenuTemplate = template;
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  return template;
}

let lastRegisterOptions: RegisterAppMenuOptions | null = null
let lastMenuTemplate: Electron.MenuItemConstructorOptions[] | null = null

export function registerAppMenu(options: RegisterAppMenuOptions): void {
  lastRegisterOptions = options
  buildAndApplyMenu(options)
}

/** Rebuild the application menu using the options from the most recent
 *  registerAppMenu call. Used to refresh checkbox `checked` state when
 *  settings that feed the Appearance submenu change, since Electron's
 *  menu items do not reactively re-render when the backing state updates. */
export function rebuildAppMenu(): void {
  if (lastRegisterOptions) {
    buildAndApplyMenu(lastRegisterOptions)
  }
}

/** Last built template (test seam: lets unit tests and the dev-only
 *  `drogon:menuInvoke` IPC trigger items without OS menu automation). */
export function getLastMenuTemplate(): Electron.MenuItemConstructorOptions[] | null {
  return lastMenuTemplate;
}

function submenuEntries(
  item: Electron.MenuItemConstructorOptions,
): Electron.MenuItemConstructorOptions[] {
  return (item.submenu ?? []) as Electron.MenuItemConstructorOptions[];
}

/** Invoke the first item whose label (before the `\t` chord hint) matches,
 *  searching nested submenus. Returns true when a click handler ran. */
export function invokeAppMenuItemByLabel(label: string): boolean {
  if (!lastMenuTemplate || !label) return false;
  const stack = [...lastMenuTemplate];
  while (stack.length > 0) {
    const item = stack.pop() as Electron.MenuItemConstructorOptions;
    const bare = item.label?.split("\t")[0];
    if (bare === label && typeof item.click === "function") {
      item.click({} as never, {} as never, {} as never);
      return true;
    }
    stack.push(...submenuEntries(item));
  }
  return false;
}

/** Convenience wiring used by main/index.ts: forward one shell command to the
 *  focused window's renderer over the shared menu contract. */
export function sendAppMenuCommandToWindow(
  window: BrowserWindow | null,
  command: AppMenuCommand,
): void {
  window?.webContents.send("ui:appMenuCommand", command);
}

export { zoomFocusedWindow };
