import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from "electron";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { bridgeSchemas } from "../shared/bridge-validation";
import type { Result, Status } from "../shared/session-contract";
import {
  appearanceMenuStateSchema,
  menuIpcChannels,
  setUnreadDockBadgeCountSchema,
  type AppearanceMenuState,
} from "../shared/menu-contract";
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from "../shared/window-state-contract";
import {
  DROGON_README_URL,
  EXPLORE_DROGON_URL,
  rebuildAppMenu,
  registerAppMenu,
  sendAppMenuCommandToWindow,
  zoomFocusedWindow,
} from "./menu/register-app-menu";
import { setUnreadDockBadgeCount } from "./dock/unread-badge";
import {
  installWindowStateLifecycle,
  loadWindowState,
  restorableBounds,
  revealRestoredWindow,
  type MainWindowStateLifecycle,
} from "./window/window-state";
import { buildMainWindowChromeOptions } from "./window/window-chrome";
import { readBuildInfo } from "./build-info";
import { registerAutomationIpc } from "./automation-bridge";
import { dispatchFileRequest } from "./file-bridge";
import { registerGitBridge } from "./git-bridge";
import { registerProjectBridge } from "./project-bridge";
import { registerShellBridge } from "./shell-bridge";
import { registerSettingsProbes } from "./settings-probes";
import { registerSettingsCliBridge } from "./settings-bridge";
import { registerFontsBridge } from "./fonts";
import { registerTasksBridge } from "./tasks-bridge";
import { registerBrowserIpc } from "./browser/browser-ipc";
import { registerNotificationsIpc } from "./notifications/service";
import { startBrowserRelay } from "./browser/relay-poller";
import { dispatchBotSnapshot, registerBotBridge } from "./bot-bridge";
import { autoInstallBundledMentuRuntime, registerMentuBridge } from "./mentu-bridge";
import {
  readCursorMismatches,
  writeByteCountMismatches,
} from "./byte-consistency";
import { buildDaemonPath } from "./daemon-path";
import {
  callNative,
  dataDirectory,
  observeLocalEndpoint,
  type LocalEndpointObservation,
} from "./native-client";
import {
  bootstrapNativeRuntime,
  spawnDetachedDaemon,
} from "./native-runtime-bootstrap";
// R1-A: self-registering usage IPC (snapshot/refresh/awake); the module owns
// its channels and validation, this line only loads it.
import { registerUsageIpc } from "./usage/service";
// R13-B: additive Ports-panel channel (drogon:workspacePorts).
import { listWorkspacePorts } from "./usage/workspace-port-list";

// Bounds one probe connection attempt within the overall bootstrap budget
// below; not a substitute for it (the overall budget is what actually
// prevents the whole bootstrap from hanging).
const LOCAL_ENDPOINT_PROBE_TIMEOUT_MS = 2_000;

app.setName("Drogon");
// Test harnesses set DROGON_BACKGROUND_WINDOW=1 so the window never steals the
// user's focus: shown inactive under an accessory activation policy, with
// occluded-window throttling off so CDP-driven checks keep full speed.
const backgroundWindow = process.env.DROGON_BACKGROUND_WINDOW === "1";
if (backgroundWindow) {
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  // macOS activates a regular app the moment it finishes launching (menu bar
  // switches, Dock bounces) — long before whenReady/createWindow. Becoming an
  // accessory with no Dock tile BEFORE launch completes is the only way a
  // test instance never takes the user's focus.
  if (process.platform === "darwin") {
    try {
      app.setActivationPolicy("accessory");
      app.dock?.hide();
    } catch (error) {
      console.warn("[window] background activation policy:", error);
    }
  }
}
if (process.env.DROGON_ELECTRON_PROFILE)
  app.setPath("userData", path.resolve(process.env.DROGON_ELECTRON_PROFILE));
const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid desktop request.",
    retryable: false,
  },
};
function contractViolation(message: string) {
  return {
    ok: false as const,
    error: { code: "internal_error", message, retryable: false },
  };
}
let window: BrowserWindow | null = null;
let windowStateLifecycle: MainWindowStateLifecycle | null = null;

/** Parses the dev seam "WxH+X+Y"; null when absent or malformed. */
function parseWindowBoundsEnv(raw: string | undefined): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!raw) return null;
  const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(raw);
  if (!match) return null;
  const [width, height, x, y] = match.slice(1).map(Number);
  return { x, y, width, height };
}

// The View > Appearance checkbox marks read this snapshot; the renderer —
// which owns the settings store — reports each change over the menu contract
// and main rebuilds the menu (source: main-process-i18n-menu.ts
// getAppearanceState + onToggleAppearance, adapted since Drogon has no
// main-side store).
let appearanceMenuState: AppearanceMenuState = {
  statusBarVisible: true,
  tasksButtonVisible: true,
  automationsButtonVisible: true,
  titlebarAppNameVisible: true,
};

function sendFromTrustedRenderer(command: Parameters<typeof sendAppMenuCommandToWindow>[1]) {
  sendAppMenuCommandToWindow(window, command);
}

function registerAppMenuIpc() {
  ipcMain.handle(menuIpcChannels.appearanceState, (event, payload: unknown) => {
    if (!window || event.sender !== window.webContents) return false;
    const validated = appearanceMenuStateSchema.safeParse(payload);
    if (!validated.success) return false;
    appearanceMenuState = validated.data;
    rebuildAppMenu();
    return true;
  });
  ipcMain.handle(
    menuIpcChannels.setUnreadDockBadgeCount,
    (event, count: unknown) => {
      if (!window || event.sender !== window.webContents) return false;
      const validated = setUnreadDockBadgeCountSchema.safeParse(count);
      if (!validated.success) return false;
      setUnreadDockBadgeCount(validated.data);
      return true;
    },
  );
}

function registerAppMenuBar() {
  registerAppMenu({
    onOpenSettings: () => sendFromTrustedRenderer({ type: "open-settings" }),
    onOpenExploreDrogon: (targetWindow) => {
      void targetWindow;
      void shell.openExternal(EXPLORE_DROGON_URL);
    },
    onOpenGettingStarted: (targetWindow) => {
      void targetWindow;
      void shell.openExternal(DROGON_README_URL);
    },
    // Why: this repo's keybinding table assigns the zoom chords to the native
    // menu with no renderer handler, so main zooms the focused window's page.
    onZoomIn: () => zoomFocusedWindow("in"),
    onZoomOut: () => zoomFocusedWindow("out"),
    onZoomReset: () => zoomFocusedWindow("reset"),
    onToggleLeftSidebar: () =>
      sendFromTrustedRenderer({ type: "toggle-left-sidebar" }),
    onToggleRightSidebar: () =>
      sendFromTrustedRenderer({ type: "toggle-right-sidebar" }),
    onToggleAppearance: (key) =>
      sendFromTrustedRenderer({ type: "toggle-appearance", key }),
    getAppearanceState: () => appearanceMenuState,
  });
}

function registerBridge() {
  registerGitBridge(() => window);
  registerProjectBridge(() => window);
  registerShellBridge(() => window);
  registerSettingsProbes(() => window);
  registerSettingsCliBridge(() => window);
  registerFontsBridge(() => window);
  registerTasksBridge(() => window);
  registerBotBridge(() => window);
  registerMentuBridge(() => window);
  for (const [method, schema] of Object.entries(bridgeSchemas)) {
    ipcMain.handle(`drogon:${method}`, async (event, input: unknown) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return invalid;
      const validated = schema.safeParse(input);
      if (!validated.success) return invalid;
      const value = validated.data;
      switch (method) {
        case "botSnapshot":
          return dispatchBotSnapshot(value);
        case "fileList":
        case "fileRead":
        case "fileWrite":
        case "fileCreate":
        case "fileRename":
        case "fileDelete":
        case "fileSearch":
          return dispatchFileRequest(method, value);
        case "status":
          return callNative("status", {});
        case "workspaces":
          return callNative("workspace.list", {});
        case "addWorkspace":
          return callNative("workspace.register", { path: value });
        case "chooseFolder": {
          const chosen = await dialog.showOpenDialog(window, {
            properties: ["openDirectory"],
          });
          return chosen.canceled ? null : (chosen.filePaths[0] ?? null);
        }
        case "sessions":
          return callNative("session.list", { workspaceId: value });
        case "start": {
          // Additive (R12-E restart reuse): the input is either the bare
          // workspaceId or an object carrying the prior session's recorded
          // argv; an absent command keeps the exact prior default-shell
          // behavior, and the daemon fills its own default when omitted.
          const launch =
            typeof value === "string"
              ? { workspaceId: value }
              : (value as {
                  workspaceId: string;
                  command?: string;
                  args?: string[];
                });
          return callNative("session.start", {
            workspaceId: launch.workspaceId,
            ...(launch.command !== undefined
              ? { command: launch.command }
              : {
                  command:
                    process.platform === "win32"
                      ? process.env.ComSpec || "cmd.exe"
                      : process.env.SHELL || "/bin/sh",
                }),
            ...(launch.args !== undefined ? { args: launch.args } : { args: [] }),
            cols: 80,
            rows: 24,
          });
        }
        case "read": {
          const result = await callNative("session.read", {
            ...(value as object),
            limitBytes: 65536,
          });
          if (result.ok) {
            const read = result.result as {
              dataBase64: string;
              startCursor: number;
              nextCursor: number;
            };
            if (
              readCursorMismatches(
                read.dataBase64,
                read.startCursor,
                read.nextCursor,
              )
            )
              return contractViolation(
                "The service's cursor advance does not match the decoded byte count.",
              );
          }
          return result;
        }
        case "write": {
          const data = bridgeSchemas.write.parse(value);
          const result = await callNative("session.write", {
            sessionId: data.sessionId,
            incarnation: data.incarnation,
            dataBase64: Buffer.from(data.text, "utf8").toString("base64"),
          });
          if (result.ok) {
            const written = result.result as { acceptedBytes: number };
            if (writeByteCountMismatches(data.text, written.acceptedBytes))
              return contractViolation(
                "The service accepted a different byte count than was sent.",
              );
          }
          return result;
        }
        case "resize":
          return callNative("session.resize", value as object);
        case "stop":
          return callNative("session.stop", value as object);
        case "harnesses":
          return callNative("harness.list", {});
        case "startHarness": {
          const { requestId, ...params } = value as {
            requestId: string;
          } & Record<string, unknown>;
          return callNative("harness.start", params, requestId);
        }
        case "buildInfo":
          return readBuildInfo(process.resourcesPath);
        case "workspacePorts":
          return listWorkspacePorts(
            (value as { workspaceId: string }).workspaceId,
          );
        default:
          return invalid;
      }
    });
  }
}

function createWindow() {
  // Window-state restore (source createMainWindow + Store.windowBounds):
  // saved bounds win only when bigger than the minimum and meaningfully
  // visible on an attached display; first launch stays 1400×920.
  const saved = loadWindowState();
  const savedBounds = restorableBounds(saved, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
  if (savedBounds) {
    console.log("[window] Restoring persisted windowBounds:", savedBounds);
  }
  if (saved.maximized) {
    console.log("[window] Restoring persisted windowMaximized");
  }
  window = new BrowserWindow({
    width: savedBounds?.width ?? DEFAULT_WINDOW_WIDTH,
    height: savedBounds?.height ?? DEFAULT_WINDOW_HEIGHT,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    title: "Drogon",
    // R16-E window chrome (source createMainWindow.ts:98-115): hiddenInset
    // keeps the native traffic lights inside the sidebar titlebar row on
    // macOS; the renderer drag regions in assets/main.css do the moving.
    ...buildMainWindowChromeOptions(process.platform),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: !backgroundWindow,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  // Why: maximize before the first show so no un-maximized frame flashes
  // (source revealInitialWindow maximizes in the same hook); the background
  // seam reveals inactive so the user keeps keyboard focus.
  window.on("ready-to-show", () => {
    if (window) {
      revealRestoredWindow({
        window,
        savedMaximized: saved.maximized,
        backgroundWindow,
      });
    }
  });
  window.on("closed", () => {
    window = null;
  });
  windowStateLifecycle?.dispose();
  windowStateLifecycle = installWindowStateLifecycle({ mainWindow: window });
  // Dev-only window-bounds seam (like DROGON_ELECTRON_PROFILE): Electron's
  // CDP exposes no Browser domain and macOS AX automation is not granted,
  // so the relaunch oracle drives the real resize/move path through this
  // "WxH+X+Y" env instead of a synthetic test double.
  const seamBounds = parseWindowBoundsEnv(process.env.DROGON_WINDOW_BOUNDS);
  if (!app.isPackaged && seamBounds) {
    window.setBounds(seamBounds);
  } else if (backgroundWindow) {
    // Test launches park the window at the bottom-right edge of the work area
    // so it stays out of the user's way; macOS keeps a corner on screen and
    // occlusion throttling is off, so CDP captures still render.
    const area = screen.getPrimaryDisplay().workArea;
    window.setPosition(area.x + area.width - 120, area.y + area.height - 60);
  }
  console.log("[window] Window bounds at startup:", window.getBounds(),
    "maximized:", window.isMaximized());
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

/**
 * Attaches to a healthy existing service, or spawns the packaged `drogond`
 * exactly once, before the window (and therefore the renderer's first
 * `status` call) is created. Never removes a socket or force-kills an
 * incumbent — `drogond`'s own endpoint lock decides ownership; this only
 * decides whether *this* process tries starting one candidate.
 */
async function bootstrapDaemon(): Promise<void> {
  // A window must open even if the runtime's own path resolution throws
  // (e.g. an unset `APPDATA`); an unreachable service is still an honest,
  // recoverable state the renderer already reports, never a blank app.
  let dataDir: string;
  try {
    dataDir = dataDirectory();
  } catch (error) {
    console.error(
      `[drogon] native runtime bootstrap: cannot resolve the data directory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }
  const binaryName = process.platform === "win32" ? "drogond.exe" : "drogond";
  const binaryPath = path.join(process.resourcesPath, "bin", binaryName);
  const outcome = await bootstrapNativeRuntime({
    isPackaged: app.isPackaged,
    platform: process.platform,
    binaryExists: () => existsSync(binaryPath),
    checkStatus: (signal) =>
      callNative("status", {}, undefined, signal) as Promise<Result<Status>>,
    observeLocalEndpoint: async (signal): Promise<LocalEndpointObservation> => {
      // A data directory that doesn't exist yet (fresh install: `drogond`
      // has never run here) is absence, same as the probe connection
      // itself refusing/not-existing. Any other resolution failure (e.g. a
      // permissions error on a parent directory) is left ambiguous rather
      // than assumed absent.
      let resolvedDataDir: string;
      try {
        resolvedDataDir = await realpath(dataDir);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "ENOENT"
          ? { kind: "absent" }
          : { kind: "ambiguous", reason: code ?? "data-directory-unreadable" };
      }
      return observeLocalEndpoint(
        resolvedDataDir,
        process.platform,
        LOCAL_ENDPOINT_PROBE_TIMEOUT_MS,
        signal,
      );
    },
    spawnDaemon: () =>
      spawnDetachedDaemon(binaryPath, ["--data-dir", dataDir], {
        ...process.env,
        PATH: buildDaemonPath(process.env.PATH, process.platform, homedir()),
      }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollIntervalMs: 250,
    deadlineMs: 10_000,
  });
  if (outcome.kind !== "already-healthy" && outcome.kind !== "not-packaged")
    // Honest, observable failure reporting: the renderer's own "Connect to
    // Drogon" state already surfaces an unreachable service; this is the
    // operator-facing record of *why*, without inventing new UI for it.
    console.error(
      `[drogon] native runtime bootstrap: ${JSON.stringify(outcome)}`,
    );
}

// Isolated acceptance profiles intentionally run multiple instances side by
// side (each with its own userData/data directory); the OS-level
// single-instance lock must not treat those as duplicates of each other.
const isolatedProfile = Boolean(process.env.DROGON_ELECTRON_PROFILE);
const holdsSingleInstanceLock =
  isolatedProfile || app.requestSingleInstanceLock();
if (!holdsSingleInstanceLock) {
  app.quit();
} else {
  if (!isolatedProfile) {
    app.on("second-instance", () => {
      // A test instance never raises itself, even when a duplicate launch
      // hands it the single-instance lock.
      if (window && !backgroundWindow) {
        if (window.isMinimized()) window.restore();
        window.focus();
      }
    });
  }
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerAppMenuBar();
    registerAppMenuIpc();
    registerBridge();
    registerAutomationIpc(
      (event) =>
        window !== null &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame,
    );
    registerUsageIpc();
    startBrowserRelay(registerBrowserIpc(() => window));
    registerNotificationsIpc(() => window);
    await bootstrapDaemon();
    void autoInstallBundledMentuRuntime();
    if (backgroundWindow && process.platform === "darwin")
      app.setActivationPolicy("accessory");
    createWindow();
    app.on("activate", () => {
      if (!window) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
