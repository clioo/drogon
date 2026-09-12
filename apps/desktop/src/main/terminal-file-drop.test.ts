import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    ipcMain: {
      removeAllListeners: vi.fn((channel: string) => listeners.delete(channel)),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener);
      }),
    },
  };
});

vi.mock("electron", () => electron);

import {
  TERMINAL_FILE_DROP_CHANNEL,
  TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL,
} from "../shared/terminal-file-drop-contract";
import { registerTerminalFileDropBridge } from "./terminal-file-drop";

describe("main terminal file-drop relay", () => {
  beforeEach(() => {
    electron.listeners.clear();
    electron.ipcMain.removeAllListeners.mockClear();
    electron.ipcMain.on.mockClear();
  });

  function setup() {
    const send = vi.fn();
    const webContents = {
      isDestroyed: vi.fn(() => false),
      send,
    };
    const window = {
      isDestroyed: vi.fn(() => false),
      webContents,
    };
    registerTerminalFileDropBridge(() => window as never);
    const relay = electron.listeners.get(
      TERMINAL_FILE_DROP_FROM_PRELOAD_CHANNEL,
    );
    return { relay, send, webContents, window };
  }

  it("relays only valid drops from the owning renderer", () => {
    const { relay, send, webContents } = setup();
    const payload = { paths: ["/tmp/a"], tabId: "tab-1", paneLeafId: "pane-1" };

    relay?.({ sender: { id: 99 } }, payload);
    expect(send).not.toHaveBeenCalled();

    relay?.({ sender: webContents }, payload);
    expect(send).toHaveBeenCalledWith(TERMINAL_FILE_DROP_CHANNEL, payload);

    relay?.({ sender: webContents }, { paths: [42] });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("drops events when the window or its webContents is gone", () => {
    const { relay, send, window, webContents } = setup();
    const payload = { paths: ["/tmp/a"], paneLeafId: "pane-1" };

    window.isDestroyed.mockReturnValue(true);
    relay?.({ sender: webContents }, payload);
    webContents.isDestroyed.mockReturnValue(true);
    window.isDestroyed.mockReturnValue(false);
    relay?.({ sender: webContents }, payload);

    expect(send).not.toHaveBeenCalled();
  });
});
