import { app, BrowserWindow, dialog, ipcMain, Menu, session } from "electron";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { bridgeSchemas } from "../shared/bridge-validation";
import type { Result, Status } from "../shared/session-contract";
import { readBuildInfo } from "./build-info";
import { registerAutomationIpc } from "./automation-bridge";
import { dispatchFileRequest } from "./file-bridge";
import { registerGitBridge } from "./git-bridge";
import { registerSettingsProbes } from "./settings-probes";
import { registerBrowserIpc } from "./browser/browser-ipc";
import { registerNotificationsIpc } from "./notifications/service";
import { dispatchBotSnapshot } from "./bot-bridge";
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

// Bounds one probe connection attempt within the overall bootstrap budget
// below; not a substitute for it (the overall budget is what actually
// prevents the whole bootstrap from hanging).
const LOCAL_ENDPOINT_PROBE_TIMEOUT_MS = 2_000;

app.setName("Drogon");
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

function registerBridge() {
  registerGitBridge(() => window);
  registerSettingsProbes(() => window);
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
        case "start":
          return callNative("session.start", {
            workspaceId: value,
            command:
              process.platform === "win32"
                ? process.env.ComSpec || "cmd.exe"
                : process.env.SHELL || "/bin/sh",
            args: [],
            cols: 80,
            rows: 24,
          });
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
        default:
          return invalid;
      }
    });
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Drogon",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.on("ready-to-show", () => window?.show());
  window.on("closed", () => {
    window = null;
  });
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
      if (window) {
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
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [{ role: "appMenu" as const }]
          : []),
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    registerBridge();
    registerAutomationIpc(
      (event) =>
        window !== null &&
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame,
    );
    registerUsageIpc();
    registerBrowserIpc(() => window);
    registerNotificationsIpc(() => window);
    await bootstrapDaemon();
    createWindow();
    app.on("activate", () => {
      if (!window) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
