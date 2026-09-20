// Phase 1 preload: fail-closed gates on renderer -> main invoke bridges.
// Invalid renderer payloads must throw in preload, before any IPC leaves
// for main. Each throw-test pins the THROW decision: the matching mutation
// passes the payload through and the test fails.
import { describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  ipcRenderer: {
    on: vi.fn(),
    removeListener: vi.fn(),
    invoke: vi.fn(),
  },
}));

vi.mock("electron", () => electron);

import { appMenu } from "./app-menu";
import { mentu } from "./mentu";
import { MENTU_OPEN_TAB_RESULT_CHANNEL } from "../shared/mentu-contract";
import { menuIpcChannels } from "../shared/menu-contract";

const APPEARANCE_STATE = {
  statusBarVisible: true,
  tasksButtonVisible: false,
  automationsButtonVisible: true,
  titlebarAppNameVisible: false,
};

describe("mentu.reportOpenTab never resolves the CLI wait with a bogus verdict", () => {
  it("invokes the exact result channel with a valid verdict", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce(true);
    await mentu.reportOpenTab!({ requestId: "r-1", ok: true });
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      MENTU_OPEN_TAB_RESULT_CHANNEL,
      { requestId: "r-1", ok: true },
    );
  });

  it.each([
    {},
    { requestId: "", ok: true },
    { requestId: "r-1" },
    { requestId: "r-1", ok: "yes" },
    null,
  ])("throws on bogus verdict %# without touching IPC", (verdict) => {
    electron.ipcRenderer.invoke.mockClear();
    expect(() => mentu.reportOpenTab!(verdict as never)).toThrow();
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled();
  });
});

describe("appMenu.reportAppearanceState validates before main rebuilds the menu", () => {
  it("invokes the exact channel with a complete flag set", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce(true);
    await appMenu.reportAppearanceState(APPEARANCE_STATE);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      menuIpcChannels.appearanceState,
      APPEARANCE_STATE,
    );
  });

  it.each([
    {},
    { statusBarVisible: true },
    { ...APPEARANCE_STATE, statusBarVisible: "yes" },
    null,
  ])("throws on partial verdict %# without touching IPC", (state) => {
    electron.ipcRenderer.invoke.mockClear();
    expect(() => appMenu.reportAppearanceState(state as never)).toThrow();
    expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled();
  });
});

describe("appMenu.setUnreadDockBadgeCount clamps at the preload boundary", () => {
  it.each([0, 7, 9999])("forwards in-range count %d", async (count) => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce(true);
    await appMenu.setUnreadDockBadgeCount(count);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      menuIpcChannels.setUnreadDockBadgeCount,
      count,
    );
  });

  it.each([-1, 10000, 1.5, Number.NaN])(
    "throws on out-of-range count %d without touching IPC",
    (count) => {
      electron.ipcRenderer.invoke.mockClear();
      expect(() => appMenu.setUnreadDockBadgeCount(count)).toThrow();
      expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled();
    },
  );
});
