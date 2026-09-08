// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc. Unit tests for the renderer's
   live-tick subscription (R16-L #157): workspace filtering and the
   absent-channel fallback. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeWorkspaceFilesChanged } from "./files-watch";
import type { FilesWatchBridge } from "../../../../shared/file-contract";

afterEach(() => {
  const holder = window as unknown as { drogon?: object };
  if (holder.drogon) delete (holder.drogon as { filesWatch?: unknown }).filesWatch;
});

function installBridge(bridge: FilesWatchBridge) {
  const holder = window as unknown as { drogon?: { filesWatch?: FilesWatchBridge } };
  holder.drogon ??= {};
  holder.drogon.filesWatch = bridge;
}

describe("subscribeWorkspaceFilesChanged", () => {
  it("forwards ticks for its own workspace only", () => {
    const listeners: Array<(tick: { workspaceId: string }) => void> = [];
    installBridge({
      onFilesChanged: (listener) => {
        listeners.push(listener);
        return () => {};
      },
    });
    const own = vi.fn();
    const unsubscribe = subscribeWorkspaceFilesChanged("ws-1", own);
    listeners[0]({ workspaceId: "ws-1" });
    listeners[0]({ workspaceId: "ws-2" });
    listeners[0]({ workspaceId: "ws-1" });
    expect(own).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("unsubscribes the preload channel", () => {
    const remove = vi.fn();
    installBridge({ onFilesChanged: () => remove });
    subscribeWorkspaceFilesChanged("ws-1", () => {})();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("subscribes to nothing when the preload channel is absent", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkspaceFilesChanged("ws-1", listener);
    expect(unsubscribe()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });
});
