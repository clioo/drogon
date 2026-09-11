import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../shared/session-contract";
import { daemon } from "./daemon";
import type {
  FilesChangedTick,
  FilesWatchBridge,
} from "../shared/file-contract";
import { automationBridge } from "./automation";
import { installBrowserWindowCloseGuard } from "./browser-window-close-installation";
import { usageBridge } from "./usage";
import { git } from "./git";
import { project } from "./project";
import { shell } from "./shell";
import { browser } from "./browser";
import { settings } from "./settings";
import { agentSettings } from "./agent-settings";
import { nativeTheme } from "./native-theme";
import { notifications } from "./notifications";
import { tasks } from "./tasks";
// R17-A additive wiring: jira namespace (granted preload/jira.ts).
import { jira } from "./jira";
import { mentu } from "./mentu";
import { botBridgeExtras } from "./bot";
import { appMenu } from "./app-menu";
import { ui } from "./workspace-ui-preferences";
import { skills } from "./skills";
// Meetings (additive): read-only Write That Down notes namespace.
import { meetings } from "./meetings";
// Work-graph authoring (additive): the designer's graph.* seam — the ONLY
// renderer path to graph.write_intent/graph.compile/graph.run, each of
// which the daemon gates behind the graph.v1 capability and its
// ownership-enforcing store.
import { graph } from "./graph";

contextBridge.executeInMainWorld({ func: installBrowserWindowCloseGuard });

const bridge: DesktopBridge = {
  automation: automationBridge,
  botSnapshot: (value) => ipcRenderer.invoke("drogon:botSnapshot", value),
  fileList: (value) => ipcRenderer.invoke("drogon:fileList", value),
  fileRead: (value) => ipcRenderer.invoke("drogon:fileRead", value),
  fileWrite: (value) => ipcRenderer.invoke("drogon:fileWrite", value),
  fileCreate: (value) => ipcRenderer.invoke("drogon:fileCreate", value),
  fileRename: (value) => ipcRenderer.invoke("drogon:fileRename", value),
  fileDelete: (value) => ipcRenderer.invoke("drogon:fileDelete", value),
  fileSearch: (value) => ipcRenderer.invoke("drogon:fileSearch", value),
  // R16-AM (coordinator-owned one-liner): git-ignored visible rows.
  fileIgnored: (value) => ipcRenderer.invoke("drogon:fileIgnored", value),
  status: () => ipcRenderer.invoke("drogon:status"),
  workspaces: () => ipcRenderer.invoke("drogon:workspaces"),
  addWorkspace: (value) => ipcRenderer.invoke("drogon:addWorkspace", value),
  chooseFolder: () => ipcRenderer.invoke("drogon:chooseFolder"),
  sessions: (value) => ipcRenderer.invoke("drogon:sessions", value),
  // Additive (R12-E restart reuse): the optional launch argv rides the same
  // channel as an object; the bare-string shape is unchanged.
  start: (value, launch) =>
    ipcRenderer.invoke(
      "drogon:start",
      launch
        ? {
            workspaceId: value,
            ...(launch.command !== undefined ? { command: launch.command } : {}),
            ...(launch.args !== undefined ? { args: launch.args } : {}),
            // Additive (R16-BC, #275): explicit spawn directory.
            ...(launch.cwd !== undefined ? { cwd: launch.cwd } : {}),
          }
        : value,
    ),
  read: (value) => ipcRenderer.invoke("drogon:read", value),
  write: (value) => ipcRenderer.invoke("drogon:write", value),
  resize: (value) => ipcRenderer.invoke("drogon:resize", value),
  stop: (value) => ipcRenderer.invoke("drogon:stop", value),
  // R16-AL2 (issue #228): close stops a live PTY and forgets the record;
  // forget removes a handle-less record. Both return the final Session.
  close: (value) => ipcRenderer.invoke("drogon:close", value),
  forget: (value) => ipcRenderer.invoke("drogon:forget", value),
  harnesses: () => ipcRenderer.invoke("drogon:harnesses"),
  harnessModels: (value) => ipcRenderer.invoke("drogon:harnessModels", value),
  startHarness: (value) => ipcRenderer.invoke("drogon:startHarness", value),
  buildInfo: () => ipcRenderer.invoke("drogon:buildInfo"),
  daemon,
  usage: usageBridge,
  // R13-B Ports panel (additive); rows are read by main/usage's
  // listWorkspacePorts behind the drogon:workspacePorts channel.
  // Additive (R16-BC): "Stop Process" rides its own gated channel to the
  // daemon's ports.kill.
  workspacePorts: {
    list: (value) => ipcRenderer.invoke("drogon:workspacePorts", value),
    kill: (value) => ipcRenderer.invoke("drogon:workspacePortsKill", value),
  },
  settings,
  agentSettings,
  // R16-AD3 (#241): additive nativeTheme relay (optional namespace; main
  // side in main/native-theme-bridge.ts).
  nativeTheme,
};
// Reconciles the granted namespaces (git, browser, notifications, tasks,
// project, shell and the R2-S botCreate/botRun/botHistory additions) with
// the coordinator-owned DesktopBridge type without editing it: a
// runtime-only merge before the freeze, so no existing key changes shape.
// R14-B adds the appMenu namespace (native menu commands, appearance state,
// dock badge).
/**
 * Live workspace-change ticks from main's filesystem watcher (R16-L
 * #157): one coarse `{ workspaceId }` push per debounced batch. Payloads
 * are shape-checked before reaching the renderer; anything else is
 * dropped, never forwarded.
 */
const filesWatch: FilesWatchBridge = {
  onFilesChanged: (listener: (tick: FilesChangedTick) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => {
      const tick = payload as Partial<FilesChangedTick> | null;
      if (tick && typeof tick.workspaceId === "string") {
        listener({ workspaceId: tick.workspaceId });
      }
    };
    ipcRenderer.on("drogon:filesChanged", wrapped);
    return () => {
      ipcRenderer.removeListener("drogon:filesChanged", wrapped);
    };
  },
};
Object.assign(
  bridge,
  { git, browser, notifications, shell, tasks, project, mentu },
  // R17-A additive wiring: jira namespace (runtime-only merge, same
  // pattern as the namespaces above).
  { jira },
  botBridgeExtras,
  { appMenu },
  { filesWatch },
  { ui, skills },
  // Additive: meetings (read-only notes index).
  { meetings },
  // Work-graph authoring (additive): the designer's graph.* namespace.
  { graph },
);
contextBridge.exposeInMainWorld("drogon", Object.freeze(bridge));
