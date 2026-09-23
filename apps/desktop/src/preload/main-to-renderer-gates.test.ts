// Phase 1 preload: fail-closed gates on main -> renderer listener bridges.
// Every bridge below receives frames from the main process and must drop
// malformed payloads instead of forwarding them into renderer listeners.
// Each test pins the DROP decision: the matching mutation delivers the
// malformed frame and the test fails.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    ipcRenderer: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        handlers.set(channel, listener);
      }),
      removeListener: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      invoke: vi.fn(),
    },
  };
});

vi.mock("electron", () => electron);

import { NATIVE_THEME_CHANGED_CHANNEL } from "./native-theme";
import { PROJECTS_CHANGED_CHANNEL } from "../shared/project-contract";
import { MENTU_OPEN_TAB_CHANNEL } from "../shared/mentu-contract";
import { menuIpcChannels } from "../shared/menu-contract";

// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, so a statically
// imported bridge would stay bound to whichever file's `electron` mock won
// the import race and `emit` below would miss its listener. Rebinding the
// bridges to this file's mock after a registry reset keeps every assertion
// below deterministic under any file order.
let appMenu: typeof import("./app-menu").appMenu;
let mentu: typeof import("./mentu").mentu;
let nativeTheme: typeof import("./native-theme").nativeTheme;
let project: typeof import("./project").project;

beforeAll(async () => {
  vi.resetModules();
  ({ appMenu } = await import("./app-menu"));
  ({ mentu } = await import("./mentu"));
  ({ nativeTheme } = await import("./native-theme"));
  ({ project } = await import("./project"));
});

beforeEach(() => {
  electron.handlers.clear();
  electron.ipcRenderer.on.mockClear();
  electron.ipcRenderer.removeListener.mockClear();
  electron.ipcRenderer.invoke.mockClear();
});

afterAll(() => {
  vi.resetModules();
});

function emit(channel: string, payload: unknown): void {
  electron.handlers.get(channel)?.({}, payload);
}

describe("nativeTheme.onChange drops malformed OS theme frames", () => {
  it("forwards a well-formed theme state", () => {
    const seen: unknown[] = [];
    const dispose = nativeTheme.onChange((state) => seen.push(state));
    emit(NATIVE_THEME_CHANGED_CHANNEL, { shouldUseDarkColors: true });
    expect(seen).toEqual([{ shouldUseDarkColors: true }]);
    dispose();
  });

  it.each([null, undefined, 42, "dark", { shouldUseDarkColors: "yes" }, {}, { shouldUseDarkColors: 1 }])(
    "drops malformed frame %# instead of throwing into the listener",
    (payload) => {
      const seen: unknown[] = [];
      const dispose = nativeTheme.onChange((state) => seen.push(state));
      expect(() => emit(NATIVE_THEME_CHANGED_CHANNEL, payload)).not.toThrow();
      expect(seen).toEqual([]);
      dispose();
    },
  );

  it("unsubscribes the exact wrapped listener", () => {
    const listener = vi.fn();
    const dispose = nativeTheme.onChange(listener);
    const wrapped = electron.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === NATIVE_THEME_CHANGED_CHANNEL,
    )?.[1];
    dispose();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      NATIVE_THEME_CHANGED_CHANNEL,
      wrapped,
    );
    emit(NATIVE_THEME_CHANGED_CHANNEL, { shouldUseDarkColors: false });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("project.onProjectsChanged forwards only string revisions", () => {
  it("forwards a string revision", () => {
    const seen: unknown[] = [];
    const dispose = project.onProjectsChanged!((revision) => seen.push(revision));
    emit(PROJECTS_CHANGED_CHANNEL, "rev-9");
    expect(seen).toEqual(["rev-9"]);
    dispose();
  });

  it.each([42, null, undefined, {}, ["rev-9"], true])(
    "drops non-string revision %#",
    (payload) => {
      const seen: unknown[] = [];
      const dispose = project.onProjectsChanged!((revision) => seen.push(revision));
      emit(PROJECTS_CHANGED_CHANNEL, payload);
      expect(seen).toEqual([]);
      dispose();
    },
  );
});

describe("mentu.onOpenTab admits only schema-valid open-tab requests", () => {
  it("forwards a valid request", () => {
    const seen: unknown[] = [];
    const dispose = mentu.onOpenTab!((request) => seen.push(request));
    emit(MENTU_OPEN_TAB_CHANNEL, { requestId: "r-1", workspaceId: "w-1" });
    expect(seen).toEqual([{ requestId: "r-1", workspaceId: "w-1" }]);
    dispose();
  });

  it.each([
    null,
    {},
    { requestId: "", workspaceId: "w-1" },
    { workspaceId: "w-1" },
    { requestId: "r-1" },
    { requestId: "r-1", workspaceId: "w-1", recipeId: 42 },
  ])("drops malformed request %#", (payload) => {
    const seen: unknown[] = [];
    const dispose = mentu.onOpenTab!((request) => seen.push(request));
    emit(MENTU_OPEN_TAB_CHANNEL, payload);
    expect(seen).toEqual([]);
    dispose();
  });
});

describe("appMenu.onCommand admits only known shell menu commands", () => {
  it("forwards a known command", () => {
    const seen: unknown[] = [];
    const dispose = appMenu.onCommand((command) => seen.push(command));
    emit(menuIpcChannels.appMenuCommand, { type: "open-settings" });
    expect(seen).toEqual([{ type: "open-settings" }]);
    dispose();
  });

  it.each([
    null,
    {},
    { type: "self-destruct" },
    { type: "toggle-appearance", key: "not-a-flag" },
    "open-settings",
    42,
  ])("drops unknown command %#", (payload) => {
    const seen: unknown[] = [];
    const dispose = appMenu.onCommand((command) => seen.push(command));
    emit(menuIpcChannels.appMenuCommand, payload);
    expect(seen).toEqual([]);
    dispose();
  });

  it("unsubscribes the exact wrapped listener", () => {
    const listener = vi.fn();
    const dispose = appMenu.onCommand(listener);
    const wrapped = electron.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === menuIpcChannels.appMenuCommand,
    )?.[1];
    dispose();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      menuIpcChannels.appMenuCommand,
      wrapped,
    );
  });
});
