// Fork parity for the terminal paste/copy clipboard channel (fixes #357):
// the app renderer must be able to use the async Clipboard API while the
// browser pane guests (which share the default session) stay denied.
import { describe, expect, test } from "vitest";
import {
  APP_WINDOW_CLIPBOARD_PERMISSIONS,
  isAppWindowClipboardPermissionAllowed,
} from "./browser-permission-policy";
import {
  lockDownGuestSession,
  type GuestSessionLike,
} from "./browser-host";

function capturingSession(appWindowWebContentsId?: number): {
  request: (
    webContents: { id: number } | undefined,
    permission: string,
  ) => boolean;
  check: (webContents: { id: number } | undefined, permission: string) => boolean;
} {
  let requestHandler: (
    webContents: { id: number } | undefined,
    permission: string,
    callback: (allow: boolean) => void,
  ) => void = () => {};
  let checkHandler: (
    webContents: { id: number } | undefined,
    permission: string,
  ) => boolean = () => false;
  const session = {
    setPermissionRequestHandler(handler: typeof requestHandler): void {
      requestHandler = handler;
    },
    setPermissionCheckHandler(handler: typeof checkHandler): void {
      checkHandler = handler;
    },
    on(): void {},
  } satisfies GuestSessionLike;
  lockDownGuestSession(session, appWindowWebContentsId);
  return {
    request: (webContents, permission) => {
      let decision: boolean | null = null;
      requestHandler(webContents, permission, (allow) => {
        decision = allow;
      });
      return decision === true;
    },
    check: (webContents, permission) => checkHandler(webContents, permission),
  };
}

describe("browser permission policy", () => {
  test("app window frame gets clipboard-read and clipboard-sanitized-write", () => {
    const policy = capturingSession(42);
    for (const permission of APP_WINDOW_CLIPBOARD_PERMISSIONS) {
      expect(policy.request({ id: 42 }, permission)).toBe(true);
      expect(policy.check({ id: 42 }, permission)).toBe(true);
    }
  });

  test("guest frames are denied even for clipboard permissions", () => {
    const policy = capturingSession(42);
    for (const permission of APP_WINDOW_CLIPBOARD_PERMISSIONS) {
      expect(policy.request({ id: 7 }, permission)).toBe(false);
      expect(policy.check({ id: 7 }, permission)).toBe(false);
    }
    // Unknown frames (no id to compare) stay denied as well.
    expect(policy.request(undefined, "clipboard-read")).toBe(false);
    expect(policy.check(undefined, "clipboard-read")).toBe(false);
  });

  test("non-clipboard permissions stay denied for every frame", () => {
    const policy = capturingSession(42);
    for (const permission of ["media", "fullscreen", "pointerLock", "geolocation"]) {
      expect(policy.request({ id: 42 }, permission)).toBe(false);
      expect(policy.check({ id: 42 }, permission)).toBe(false);
    }
  });

  test("no app-window id means deny-all (early boot, unit tests)", () => {
    const policy = capturingSession(undefined);
    expect(policy.request({ id: 42 }, "clipboard-read")).toBe(false);
    expect(policy.check({ id: 42 }, "clipboard-read")).toBe(false);
    expect(
      isAppWindowClipboardPermissionAllowed("clipboard-read", { id: 1 }, null),
    ).toBe(false);
    expect(
      isAppWindowClipboardPermissionAllowed("clipboard-read", null, 1),
    ).toBe(false);
  });
});
