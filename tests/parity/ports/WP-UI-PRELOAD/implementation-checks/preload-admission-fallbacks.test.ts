import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserWindowCloseGuard } from "../../../../../apps/desktop/src/preload/browser-window-close-installation";
import { admitCloseActiveTabPayload } from "../../../../../apps/desktop/src/preload/close-active-tab-payload-admission";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("close-active-tab admission completeness", () => {
  it("copies only the admitted source id from objects with extra fields", () => {
    const input = { sourceId: "page-1", ignored: "not forwarded" };
    expect(admitCloseActiveTabPayload(input)).toEqual({
      kind: "source",
      payload: { sourceId: "page-1" },
    });
  });

  it("accepts inherited nonempty source ids using the source structural rule", () => {
    const input = Object.create({ sourceId: "inherited-page" });
    expect(admitCloseActiveTabPayload(input)).toEqual({
      kind: "source",
      payload: { sourceId: "inherited-page" },
    });
  });
});

describe("browser close guard fallback", () => {
  it("uses assignment when defineProperty is unavailable", () => {
    const nativeClose = vi.fn();
    const target = { close: nativeClose };
    const pageWindow = new Proxy(target, {
      defineProperty: () => {
        throw new Error("defineProperty unavailable");
      },
      set: (object, property, value) => Reflect.set(object, property, value, object),
    });
    vi.stubGlobal("window", pageWindow);

    installBrowserWindowCloseGuard();

    expect(window.close()).toBeUndefined();
    expect(window.close).not.toBe(nativeClose);
  });

  it("remains non-throwing when neither definition nor assignment can replace close", () => {
    const nativeClose = vi.fn();
    const pageWindow = {} as Window;
    Object.defineProperty(pageWindow, "close", {
      configurable: false,
      writable: false,
      value: nativeClose,
    });
    vi.stubGlobal("window", pageWindow);

    expect(() => installBrowserWindowCloseGuard()).not.toThrow();
    expect(window.close).toBe(nativeClose);
  });
});
