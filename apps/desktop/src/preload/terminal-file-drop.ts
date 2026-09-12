// MIT Copyright (c) 2026 Lovecast Inc.
// Electron 44 keeps filesystem paths out of renderer File objects. Resolve
// them here with webUtils, then relay only the terminal pane's bounded paths.
import { ipcRenderer, webUtils } from "electron";
import {
  hasNativeTerminalFileDragTypes,
  isTerminalFileDropPayload,
  resolveTerminalFileDropTarget,
  TERMINAL_FILE_DROP_CHANNEL,
  TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL,
  MAX_TERMINAL_FILE_DROP_PATHS,
  validateTerminalFileDropPaths,
  WORKSPACE_FILE_PATH_MIME,
  WORKSPACE_FILE_PATHS_MIME,
  type TerminalFileDropBridge,
  type TerminalFileDropPayload,
  type TerminalFileDropPathEntry,
} from "../shared/terminal-file-drop-contract";

let installed = false;
let ipcListenerInstalled = false;
const listenerSet = new Set<(payload: TerminalFileDropPayload) => void>();

const onNativeFileDrop = (_event: unknown, payload: unknown): void => {
  if (!isTerminalFileDropPayload(payload)) return;
  listenerSet.forEach((listener) => listener(payload));
};

function targetForEvent(event: DragEvent) {
  const entries: TerminalFileDropPathEntry[] = [];
  for (const entry of event.composedPath()) {
    if (!(entry instanceof HTMLElement)) continue;
    entries.push({
      nativeFileDropTarget: entry.dataset.nativeFileDropTarget,
      terminalTabId: entry.dataset.terminalTabId,
      terminalPaneLeafId: entry.dataset.terminalPaneLeafId,
    });
  }
  return resolveTerminalFileDropTarget(entries);
}

function nativeFilePaths(event: DragEvent): string[] {
  const files = event.dataTransfer?.files;
  if (
    !files ||
    files.length === 0 ||
    files.length > MAX_TERMINAL_FILE_DROP_PATHS
  )
    return [];

  const paths: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    try {
      const filePath = webUtils.getPathForFile(files[index]);
      if (filePath) paths.push(filePath);
    } catch {
      // A File supplied by a renderer or a stale drag can be pathless. Drop it.
    }
  }
  return paths;
}

function relayNativeFileDrop(event: DragEvent): void {
  const target = targetForEvent(event);
  if (!target) return;
  const types = event.dataTransfer?.types;
  const typeValues = types ? Array.from(types) : [];
  if (
    typeValues.includes(WORKSPACE_FILE_PATH_MIME) ||
    typeValues.includes(WORKSPACE_FILE_PATHS_MIME)
  ) {
    return;
  }
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  event.preventDefault();
  event.stopPropagation();

  const paths = nativeFilePaths(event);
  if (paths.length === 0) return;
  if (validateTerminalFileDropPaths(paths).status !== "accepted") return;
  const payload: TerminalFileDropPayload = { paths, ...target };
  ipcRenderer.send(TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL, payload);
}

export function installTerminalFileDropHandlers(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    "dragover",
    (event) => {
      const target = targetForEvent(event);
      if (!target) return;
      if (!hasNativeTerminalFileDragTypes(event.dataTransfer?.types)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    true,
  );
  document.addEventListener("drop", relayNativeFileDrop, true);
}

export const terminalFileDrop: TerminalFileDropBridge = {
  onDrop(listener) {
    if (!ipcListenerInstalled) {
      ipcRenderer.on(TERMINAL_FILE_DROP_CHANNEL, onNativeFileDrop);
      ipcListenerInstalled = true;
    }
    listenerSet.add(listener);
    return () => {
      listenerSet.delete(listener);
      if (listenerSet.size === 0 && ipcListenerInstalled) {
        ipcRenderer.removeListener(
          TERMINAL_FILE_DROP_CHANNEL,
          onNativeFileDrop,
        );
        ipcListenerInstalled = false;
      }
    };
  },
};
