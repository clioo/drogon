// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/menu/register-app-menu.test.ts
// Adapted to the ported surface: no updater/crash items, no i18n, appearance
// state without the mobile key, Help opens the Drogon repo/README.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildFromTemplateMock,
  setApplicationMenuMock,
  getFocusedWindowMock,
  getFocusedWebContentsMock,
  sendActionToFirstResponderMock,
} = vi.hoisted(() => ({
  buildFromTemplateMock: vi.fn(),
  setApplicationMenuMock: vi.fn(),
  getFocusedWindowMock: vi.fn(),
  getFocusedWebContentsMock: vi.fn(),
  sendActionToFirstResponderMock: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: getFocusedWindowMock,
  },
  Menu: {
    buildFromTemplate: buildFromTemplateMock,
    setApplicationMenu: setApplicationMenuMock,
    sendActionToFirstResponder: sendActionToFirstResponderMock,
  },
  app: {
    name: "Drogon",
  },
  webContents: {
    getFocusedWebContents: getFocusedWebContentsMock,
  },
}));

import {
  registerAppMenu,
  rebuildAppMenu,
} from "./register-app-menu";

const isMac = process.platform === "darwin";

function buildMenuOptions() {
  return {
    onOpenSettings: vi.fn(),
    onOpenExploreDrogon: vi.fn(),
    onOpenGettingStarted: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onToggleLeftSidebar: vi.fn(),
    onToggleRightSidebar: vi.fn(),
    onToggleAppearance: vi.fn(),
    getAppearanceState: vi.fn(() => ({
      statusBarVisible: true,
      tasksButtonVisible: true,
      automationsButtonVisible: true,
      titlebarAppNameVisible: true,
    })),
  };
}

type MenuOptions = ReturnType<typeof buildMenuOptions>;

function getTemplate(): Electron.MenuItemConstructorOptions[] {
  const call = buildFromTemplateMock.mock.calls.at(-1);
  return call?.[0] as Electron.MenuItemConstructorOptions[];
}

function getSubmenu(
  template: Electron.MenuItemConstructorOptions[],
  label: string,
): Electron.MenuItemConstructorOptions[] {
  const item = template.find((entry) => entry.label === label);
  return (item?.submenu ?? []) as Electron.MenuItemConstructorOptions[];
}

describe("registerAppMenu", () => {
  beforeEach(() => {
    buildFromTemplateMock.mockReset();
    setApplicationMenuMock.mockReset();
    getFocusedWindowMock.mockReset();
    getFocusedWebContentsMock.mockReset();
    sendActionToFirstResponderMock.mockReset();
    buildFromTemplateMock.mockImplementation((template) => ({ template }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows reload shortcuts as display-only menu hints", () => {
    registerAppMenu(buildMenuOptions());

    expect(buildFromTemplateMock).toHaveBeenCalledTimes(1);
    const viewSubmenu = getSubmenu(getTemplate(), "View");
    const expectedForceReloadLabel = `Force Reload\t${isMac ? "⌘⇧R" : "Ctrl+Shift+R"}`;

    expect(viewSubmenu).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Reload" })]),
    );

    const reloadItem = viewSubmenu.find((item) => item.label === "Reload");
    expect(reloadItem?.accelerator).toBeUndefined();
    const forceReloadItem = viewSubmenu.find(
      (item) => item.label === expectedForceReloadLabel,
    );
    expect(forceReloadItem).toBeDefined();
    expect(forceReloadItem?.accelerator).toBeUndefined();
  });

  it("reloads the focused window from the view menu", () => {
    const reloadMock = vi.fn();
    const reloadIgnoringCacheMock = vi.fn();
    getFocusedWindowMock.mockReturnValue({
      webContents: {
        id: 101,
        reload: reloadMock,
        reloadIgnoringCache: reloadIgnoringCacheMock,
      },
    });

    const options = buildMenuOptions();
    registerAppMenu(options);

    const reloadItem = getSubmenu(getTemplate(), "View").find(
      (item) => item.label === "Reload",
    );
    reloadItem?.click?.({} as never, {} as never, {} as never);

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(reloadIgnoringCacheMock).not.toHaveBeenCalled();
  });

  it("force reloads the focused window from the view menu", () => {
    const reloadMock = vi.fn();
    const reloadIgnoringCacheMock = vi.fn();
    getFocusedWindowMock.mockReturnValue({
      webContents: {
        id: 102,
        reload: reloadMock,
        reloadIgnoringCache: reloadIgnoringCacheMock,
      },
    });

    registerAppMenu(buildMenuOptions());

    const forceReloadItem = getSubmenu(getTemplate(), "View").find((item) =>
      item.label?.startsWith("Force Reload\t"),
    );
    forceReloadItem?.click?.({} as never, {} as never, {} as never);

    expect(reloadIgnoringCacheMock).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("shows the worktree palette shortcut as a display-only menu hint", () => {
    registerAppMenu(buildMenuOptions());

    const viewSubmenu = getSubmenu(getTemplate(), "View");
    const expectedLabel = `Open Worktree Palette\t${isMac ? "⌘J" : "Ctrl+Shift+J"}`;
    const paletteItem = viewSubmenu.find((item) => item.label === expectedLabel);

    expect(paletteItem).toBeDefined();
    expect(paletteItem?.accelerator).toBeUndefined();
  });

  it("labels zoom entries with every table chord, comma-joined", () => {
    registerAppMenu(buildMenuOptions());

    const viewSubmenu = getSubmenu(getTemplate(), "View");
    const labels = viewSubmenu.map((item) => item.label);
    expect(labels).toContain(`Reset Size\t${isMac ? "⌘0" : "Ctrl+0"}`);
    expect(labels).toContain(
      `Zoom In\t${
        isMac ? "⌘=, ⌘⇧+, ⌘Numpad +" : "Ctrl+=, Ctrl+Shift++, Ctrl+Numpad +"
      }`,
    );
    expect(labels).toContain(
      `Zoom Out\t${isMac ? "⌘-, ⌘Numpad -" : "Ctrl+-, Ctrl+Numpad -"}`,
    );
  });

  it("routes zoom, settings and help items through their callbacks", () => {
    getFocusedWindowMock.mockReturnValue(null);
    const options = buildMenuOptions();
    registerAppMenu(options);

    const viewSubmenu = getSubmenu(getTemplate(), "View");
    viewSubmenu
      .find((item) => item.label?.startsWith("Reset Size"))
      ?.click?.({} as never, {} as never, {} as never);
    viewSubmenu
      .find((item) => item.label?.startsWith("Zoom In"))
      ?.click?.({} as never, {} as never, {} as never);
    viewSubmenu
      .find((item) => item.label?.startsWith("Zoom Out"))
      ?.click?.({} as never, {} as never, {} as never);

    expect(options.onZoomReset).toHaveBeenCalledTimes(1);
    expect(options.onZoomIn).toHaveBeenCalledTimes(1);
    expect(options.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it.each(["darwin", "linux", "win32"] as const)(
    "routes Edit > Paste through coordinated paste ownership on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      const send = vi.fn();
      const hostContents = { send };
      getFocusedWindowMock.mockReturnValue({ webContents: hostContents });
      getFocusedWebContentsMock.mockReturnValue(hostContents);
      registerAppMenu(buildMenuOptions());

      const editSubmenu = getSubmenu(getTemplate(), "Edit");
      const pasteItem = editSubmenu.find((item) => item.label === "Paste");

      expect(pasteItem).toBeDefined();
      expect(pasteItem?.role).toBeUndefined();
      expect(pasteItem?.accelerator).toBe("CmdOrCtrl+V");

      pasteItem?.click?.({} as never, {} as never, {} as never);

      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith("ui:appMenuPaste");
      expect(sendActionToFirstResponderMock).not.toHaveBeenCalled();
    },
  );

  it.each(["darwin", "linux", "win32"] as const)(
    "preserves terminal undo and redo chords on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      registerAppMenu(buildMenuOptions());

      const editSubmenu = getSubmenu(getTemplate(), "Edit");
      const expectedRegistration = platform === "darwin" ? undefined : false;
      const undoItem = editSubmenu.find((item) => item.role === "undo");
      const redoItem = editSubmenu.find((item) => item.role === "redo");

      expect(undoItem?.accelerator).toBeUndefined();
      expect(redoItem?.accelerator).toBeUndefined();
      expect(undoItem && "registerAccelerator" in undoItem).toBe(
        platform !== "darwin",
      );
      expect(redoItem && "registerAccelerator" in redoItem).toBe(
        platform !== "darwin",
      );
      expect(undoItem?.registerAccelerator).toBe(expectedRegistration);
      expect(redoItem?.registerAccelerator).toBe(expectedRegistration);
    },
  );

  it("keeps selection actions native in a focused guest webview", () => {
    const send = vi.fn();
    const guestContents = { copy: vi.fn(), selectAll: vi.fn() };
    getFocusedWindowMock.mockReturnValue({ webContents: { send } });
    getFocusedWebContentsMock.mockReturnValue(guestContents);
    registerAppMenu(buildMenuOptions());

    const editSubmenu = getSubmenu(getTemplate(), "Edit");
    editSubmenu
      .find((item) => item.label === "Copy")
      ?.click?.({} as never, {} as never, {} as never);
    editSubmenu
      .find((item) => item.label === "Select All")
      ?.click?.({} as never, {} as never, {} as never);

    expect(guestContents.copy).toHaveBeenCalledOnce();
    expect(guestContents.selectAll).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux", "win32"] as const)(
    "routes Edit selection actions through the focused window on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      const send = vi.fn();
      getFocusedWindowMock.mockReturnValue({ webContents: { send } });
      registerAppMenu(buildMenuOptions());

      const editSubmenu = getSubmenu(getTemplate(), "Edit");
      const copyItem = editSubmenu.find((item) => item.label === "Copy");
      const selectAllItem = editSubmenu.find((item) => item.label === "Select All");

      expect(copyItem?.role).toBeUndefined();
      expect(selectAllItem?.role).toBeUndefined();
      expect(copyItem?.accelerator).toBe(platform === "darwin" ? "Command+C" : undefined);
      expect(selectAllItem?.accelerator).toBe(
        platform === "darwin" ? "Command+A" : undefined,
      );

      copyItem?.click?.({} as never, {} as never, {} as never);
      selectAllItem?.click?.({} as never, {} as never, {} as never);

      expect(send.mock.calls).toEqual([
        ["ui:appMenuSelectionAction", "copy"],
        ["ui:appMenuSelectionAction", "select-all"],
      ]);
    },
  );

  it("routes macOS selection actions to the native responder without a focused window", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    getFocusedWindowMock.mockReturnValue(null);
    registerAppMenu(buildMenuOptions());

    const editSubmenu = getSubmenu(getTemplate(), "Edit");
    editSubmenu
      .find((item) => item.label === "Copy")
      ?.click?.({} as never, {} as never, {} as never);
    editSubmenu
      .find((item) => item.label === "Select All")
      ?.click?.({} as never, {} as never, {} as never);

    expect(sendActionToFirstResponderMock.mock.calls).toEqual([
      ["copy:"],
      ["selectAll:"],
    ]);
  });

  it("routes Edit > Paste to the native first responder once on macOS without a focused window", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    getFocusedWindowMock.mockReturnValue(null);
    registerAppMenu(buildMenuOptions());

    const pasteItem = getSubmenu(getTemplate(), "Edit").find(
      (item) => item.label === "Paste",
    );
    pasteItem?.click?.({} as never, {} as never, {} as never);

    expect(sendActionToFirstResponderMock).toHaveBeenCalledOnce();
    expect(sendActionToFirstResponderMock).toHaveBeenCalledWith("paste:");
  });

  it.each(["linux", "win32"] as const)(
    "does not invoke the native paste responder on %s without a focused window",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      getFocusedWindowMock.mockReturnValue(null);
      registerAppMenu(buildMenuOptions());

      const pasteItem = getSubmenu(getTemplate(), "Edit").find(
        (item) => item.label === "Paste",
      );
      // Why: this case asserts only a negative, so it would pass green if the item vanished.
      expect(pasteItem).toBeDefined();
      pasteItem?.click?.({} as never, {} as never, {} as never);

      expect(sendActionToFirstResponderMock).not.toHaveBeenCalled();
    },
  );

  it.each(["linux", "win32"] as const)(
    "puts Settings and Exit under File on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      registerAppMenu(buildMenuOptions());

      const template = getTemplate();
      // Why: no redundant app-named "Drogon" menu should exist on non-mac — the
      // app-menu contents (Settings, Exit, About) have been redistributed so
      // users see them in File / Help instead.
      expect(template.find((item) => item.label === "Drogon")).toBeUndefined();

      const fileLabels = getSubmenu(template, "File").map((item) => item.label);
      expect(fileLabels[0]).toBe("Settings\tCtrl+,");
      expect(fileLabels).toEqual(
        expect.arrayContaining(["Settings\tCtrl+,", "Exit"]),
      );
    },
  );

  it("keeps the macOS app-named menu with Settings and quit roles", () => {
    registerAppMenu(buildMenuOptions());

    const template = getTemplate();
    const appSubmenu = getSubmenu(template, "Drogon");
    const appLabels = appSubmenu.map((item) => item.label);
    expect(appLabels[0]).toBeUndefined(); // { role: 'about' }
    expect(appLabels).toContain(`Settings\t⌘,`);
    expect(appSubmenu.map((item) => item.role)).toEqual([
      "about",
      undefined,
      undefined,
      "services",
      undefined,
      "hide",
      "hideOthers",
      "unhide",
      undefined,
      "quit",
    ]);
    // Why: on macOS File should NOT duplicate Settings/Exit — those live in
    // the system app menu.
    expect(template.find((item) => item.label === "File")).toBeUndefined();
  });

  it("opens the Drogon repo and README through the Help menu", () => {
    const options = buildMenuOptions();
    registerAppMenu(options);

    const helpLabels = getSubmenu(getTemplate(), "Help").map(
      (item) => item.label,
    );
    expect(helpLabels).toEqual(["Explore Drogon", "Getting Started with Drogon"]);

    const targetWindow = {} as Electron.BaseWindow;
    getSubmenu(getTemplate(), "Help")
      .find((entry) => entry.label === "Explore Drogon")
      ?.click?.({} as never, targetWindow, {} as never);
    getSubmenu(getTemplate(), "Help")
      .find((entry) => entry.label === "Getting Started with Drogon")
      ?.click?.({} as never, targetWindow, {} as never);

    expect(options.onOpenExploreDrogon).toHaveBeenCalledWith(targetWindow);
    expect(options.onOpenGettingStarted).toHaveBeenCalledWith(targetWindow);
  });

  it.each(["linux", "win32"] as const)(
    "redistributes the About role under Help on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      registerAppMenu(buildMenuOptions());

      const helpItems = getSubmenu(getTemplate(), "Help");
      expect(helpItems.map((item) => item.role ?? item.label ?? "separator")).toEqual([
        "Explore Drogon",
        "Getting Started with Drogon",
        "separator",
        "about",
      ]);
    },
  );

  it("never registers updater or crash-reporter items", () => {
    registerAppMenu(buildMenuOptions());

    const template = getTemplate();
    const allLabels: (string | undefined)[] = [];
    for (const top of template) {
      allLabels.push(top.label);
      for (const entry of ((top.submenu ?? []) as Electron.MenuItemConstructorOptions[])) {
        allLabels.push(entry.label);
      }
    }
    expect(allLabels).not.toContain("Check for Updates...");
    expect(allLabels).not.toContain("Report Crash...");
  });

  it("exposes an Appearance submenu under View with checkbox items reflecting state", () => {
    const options = buildMenuOptions();
    options.getAppearanceState.mockReturnValue({
      statusBarVisible: true,
      tasksButtonVisible: false,
      automationsButtonVisible: false,
      titlebarAppNameVisible: true,
    });
    registerAppMenu(options);

    const viewSubmenu = getSubmenu(getTemplate(), "View");
    const appearanceEntry = viewSubmenu.find((item) => item.label === "Appearance");
    expect(appearanceEntry).toBeDefined();

    const appearanceSubmenu = (appearanceEntry?.submenu ??
      []) as Electron.MenuItemConstructorOptions[];
    expect(appearanceSubmenu.map((item) => item.label ?? "separator")).toEqual([
      `Toggle Left Sidebar\t${isMac ? "⌘B" : "Ctrl+B"}`,
      `Toggle Right Sidebar\t${isMac ? "⌘L" : "Ctrl+L"}`,
      "Show Status Bar",
      "separator",
      "Show Tasks Button",
      "Show Automations Button",
      "Show Titlebar App Name",
    ]);

    const tasksItem = appearanceSubmenu.find(
      (item) => item.label === "Show Tasks Button",
    );
    expect(tasksItem?.type).toBe("checkbox");
    expect(tasksItem?.checked).toBe(false);

    const automationsItem = appearanceSubmenu.find(
      (item) => item.label === "Show Automations Button",
    );
    expect(automationsItem?.type).toBe("checkbox");
    expect(automationsItem?.checked).toBe(false);

    const statusBarItem = appearanceSubmenu.find(
      (item) => item.label === "Show Status Bar",
    );
    expect(statusBarItem?.checked).toBe(true);

    const titlebarItem = appearanceSubmenu.find(
      (item) => item.label === "Show Titlebar App Name",
    );
    expect(titlebarItem?.checked).toBe(true);

    // Mobile is out of the MVP.
    expect(
      appearanceSubmenu.find((item) => item.label?.includes("Mobile")),
    ).toBeUndefined();
  });

  it("routes Appearance checkbox clicks through onToggleAppearance", () => {
    const options = buildMenuOptions();
    registerAppMenu(options);

    const viewSubmenu = getSubmenu(getTemplate(), "View");
    const appearanceSubmenu = (viewSubmenu.find(
      (item) => item.label === "Appearance",
    )?.submenu ?? []) as Electron.MenuItemConstructorOptions[];

    appearanceSubmenu
      .find((item) => item.label === "Show Tasks Button")
      ?.click?.({} as never, {} as never, {} as never);
    appearanceSubmenu
      .find((item) => item.label === "Show Automations Button")
      ?.click?.({} as never, {} as never, {} as never);
    appearanceSubmenu
      .find((item) => item.label === "Show Status Bar")
      ?.click?.({} as never, {} as never, {} as never);
    appearanceSubmenu
      .find((item) => item.label === "Show Titlebar App Name")
      ?.click?.({} as never, {} as never, {} as never);

    expect(options.onToggleAppearance).toHaveBeenCalledWith("tasksButtonVisible");
    expect(options.onToggleAppearance).toHaveBeenCalledWith(
      "automationsButtonVisible",
    );
    expect(options.onToggleAppearance).toHaveBeenCalledWith("statusBarVisible");
    expect(options.onToggleAppearance).toHaveBeenCalledWith(
      "titlebarAppNameVisible",
    );
  });

  it("routes sidebar toggle items through their callbacks without real accelerators", () => {
    const options = buildMenuOptions();
    registerAppMenu(options);

    const viewSubmenu = getSubmenu(getTemplate(), "View");
    const appearanceSubmenu = (viewSubmenu.find(
      (item) => item.label === "Appearance",
    )?.submenu ?? []) as Electron.MenuItemConstructorOptions[];

    const leftLabel = `Toggle Left Sidebar\t${isMac ? "⌘B" : "Ctrl+B"}`;
    const rightLabel = `Toggle Right Sidebar\t${isMac ? "⌘L" : "Ctrl+L"}`;

    appearanceSubmenu
      .find((item) => item.label === leftLabel)
      ?.click?.({} as never, {} as never, {} as never);
    appearanceSubmenu
      .find((item) => item.label === rightLabel)
      ?.click?.({} as never, {} as never, {} as never);

    expect(options.onToggleLeftSidebar).toHaveBeenCalledTimes(1);
    expect(options.onToggleRightSidebar).toHaveBeenCalledTimes(1);
    // Why: these entries must not bind Cmd/Ctrl+B/L as real accelerators —
    // the renderer's keydown handler owns those chords.
    expect(appearanceSubmenu.find((item) => item.label === leftLabel)?.accelerator).toBeUndefined();
    expect(appearanceSubmenu.find((item) => item.label === rightLabel)?.accelerator).toBeUndefined();
  });

  it("orders the top-level menus and the View submenu like the source", () => {
    registerAppMenu(buildMenuOptions());

    const template = getTemplate();
    const topLevel = template.map((item) => item.label ?? "");
    if (isMac) {
      expect(topLevel).toEqual(["Drogon", "Edit", "View", "Window", "Help"]);
    } else {
      expect(topLevel).toEqual(["File", "Edit", "View", "Window", "Help"]);
    }

    const roles = getSubmenu(getTemplate(), "View").map(
      (item) => item.role ?? undefined,
    );
    expect(roles).toContain("toggleDevTools");
    expect(roles).toContain("togglefullscreen");
    expect(getSubmenu(getTemplate(), "Window").map((item) => item.role)).toEqual([
      "minimize",
      "zoom",
    ]);
  });

  it("rebuildAppMenu re-applies a fresh template with updated checkbox marks", () => {
    const options = buildMenuOptions();
    registerAppMenu(options);

    const appearanceLabels = () => {
      const latest = getTemplate();
      const viewSubmenu = getSubmenu(latest, "View");
      const appearanceSubmenu = (viewSubmenu.find(
        (item) => item.label === "Appearance",
      )?.submenu ?? []) as Electron.MenuItemConstructorOptions[];
      return appearanceSubmenu.find((item) => item.label === "Show Tasks Button")
        ?.checked;
    };
    expect(appearanceLabels()).toBe(true);

    options.getAppearanceState.mockReturnValue({
      statusBarVisible: true,
      tasksButtonVisible: false,
      automationsButtonVisible: true,
      titlebarAppNameVisible: true,
    });
    rebuildAppMenu();

    expect(buildFromTemplateMock).toHaveBeenCalledTimes(2);
    expect(appearanceLabels()).toBe(false);
  });
});
