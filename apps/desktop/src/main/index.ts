import { app, BrowserWindow, dialog, ipcMain, Menu, session } from "electron";
import path from "node:path";
import { bridgeSchemas } from "../shared/bridge-validation";
import {
  readCursorMismatches,
  writeByteCountMismatches,
} from "./byte-consistency";
import { callNative } from "./native-client";

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

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  registerBridge();
  createWindow();
  app.on("activate", () => {
    if (!window) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
