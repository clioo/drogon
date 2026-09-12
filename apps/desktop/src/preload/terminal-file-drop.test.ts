// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    ipcRenderer: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn(),
      send: vi.fn(),
    },
    webUtils: {
      getPathForFile: vi.fn((file: File) => `/resolved/${file.name}`),
    },
  };
});

vi.mock("electron", () => electron);

import {
  TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL,
  WORKSPACE_FILE_PATH_MIME,
} from "../shared/terminal-file-drop-contract";
import {
  installTerminalFileDropHandlers,
  terminalFileDrop,
} from "./terminal-file-drop";

describe("preload terminal native file drops", () => {
  beforeEach(() => {
    electron.ipcRenderer.send.mockClear();
    electron.webUtils.getPathForFile.mockClear();
  });

  it("resolves OS File objects and sends the owning pane target", () => {
    const pane = document.createElement("div");
    pane.dataset.nativeFileDropTarget = "terminal";
    pane.dataset.terminalTabId = "tab-1";
    pane.dataset.terminalPaneLeafId = "pane-2";
    const child = document.createElement("div");
    pane.append(child);
    document.body.append(pane);
    installTerminalFileDropHandlers();

    const file = new File(["contents"], "a file.txt");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: ["Files"],
        files: { 0: file, length: 1 },
      },
    });

    child.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(electron.webUtils.getPathForFile).toHaveBeenCalledWith(file);
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith(
      TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL,
      {
        paths: ["/resolved/a file.txt"],
        tabId: "tab-1",
        paneLeafId: "pane-2",
      },
    );
    pane.remove();
  });

  it("does not consume internal Explorer drags in preload", () => {
    const pane = document.createElement("div");
    pane.dataset.nativeFileDropTarget = "terminal";
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: ["Files", WORKSPACE_FILE_PATH_MIME],
        files: { length: 0 },
      },
    });
    pane.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(electron.ipcRenderer.send).not.toHaveBeenCalled();
  });

  it("fans main-process payloads out to subscribers and supports cleanup", () => {
    const listener = vi.fn();
    const dispose = terminalFileDrop.onDrop(listener);
    const ipcListener = electron.listeners.get("drogon:terminalFileDrop");
    ipcListener?.({}, { paths: ["/tmp/a"], paneLeafId: "pane-1" });
    ipcListener?.({}, { paths: [42] });

    expect(listener).toHaveBeenCalledWith({
      paths: ["/tmp/a"],
      paneLeafId: "pane-1",
    });
    dispose();
    ipcListener?.({}, { paths: ["/tmp/b"] });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
