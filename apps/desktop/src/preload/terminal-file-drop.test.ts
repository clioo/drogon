// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, so a statically
// imported bridge would stay bound to whichever file's `electron` mock won
// the import race (sibling preload tests mock the same module without
// `send`/`webUtils`). Rebinding after a registry reset keeps the drop
// assertions below deterministic under any file order.
let installTerminalFileDropHandlers: typeof import("./terminal-file-drop").installTerminalFileDropHandlers;
let terminalFileDrop: typeof import("./terminal-file-drop").terminalFileDrop;

beforeAll(async () => {
  vi.resetModules();
  ({ installTerminalFileDropHandlers, terminalFileDrop } = await import("./terminal-file-drop"));
});

afterAll(() => {
  vi.resetModules();
});

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
