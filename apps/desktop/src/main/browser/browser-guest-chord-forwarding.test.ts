// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/main/browser/browser-manager-guest-shortcuts.test.ts (the
// before-input-event forwarding contract), narrowed to the R12-E chord set.
import { describe, expect, it, vi } from "vitest";

import {
  installGuestBrowserChordForwarding,
  matchGuestBrowserChord,
} from "./browser-guest-chord-forwarding";

function input(overrides: Record<string, unknown> = {}) {
  return {
    type: "keyDown",
    key: "l",
    code: "KeyL",
    meta: false,
    control: false,
    shift: false,
    alt: false,
    isAutoRepeat: false,
    ...overrides,
  };
}

describe("matchGuestBrowserChord", () => {
  it("matches the browser defaults on the platform modifier", () => {
    expect(matchGuestBrowserChord(input({ meta: true }), true)).toBe(
      "focus-address-bar",
    );
    expect(matchGuestBrowserChord(input({ control: true }), false)).toBe(
      "focus-address-bar",
    );
    expect(matchGuestBrowserChord(input({ meta: true, key: "r" }), true)).toBe(
      "reload",
    );
    expect(matchGuestBrowserChord(input({ meta: true, key: "f" }), true)).toBe(
      "find",
    );
    expect(matchGuestBrowserChord(input({ meta: true, key: "[" }), true)).toBe(
      "back",
    );
    expect(matchGuestBrowserChord(input({ meta: true, key: "]" }), true)).toBe(
      "forward",
    );
    expect(
      matchGuestBrowserChord(
        input({ meta: true, key: "r", shift: true }),
        true,
      ),
    ).toBe("hard-reload");
  });

  it("rejects the wrong platform modifier, alt, repeat and keyUp", () => {
    // On macOS Ctrl is left for Emacs-style caret moves.
    expect(matchGuestBrowserChord(input({ control: true }), true)).toBeNull();
    expect(matchGuestBrowserChord(input({ meta: true }), false)).toBeNull();
    expect(
      matchGuestBrowserChord(
        input({ meta: true, shift: true, key: "l" }),
        true,
      ),
    ).toBeNull();
    expect(
      matchGuestBrowserChord(
        input({ meta: true, key: "r", shift: true }),
        true,
      ),
    ).toBe("hard-reload");
    expect(
      matchGuestBrowserChord(input({ meta: true, alt: true }), true),
    ).toBeNull();
    expect(
      matchGuestBrowserChord(input({ meta: true, type: "keyUp" }), true),
    ).toBeNull();
    expect(
      matchGuestBrowserChord(input({ meta: true, key: "x" }), true),
    ).toBeNull();
  });
});

describe("installGuestBrowserChordForwarding", () => {
  function guestHarness() {
    const listeners = new Map<string, (...args: never[]) => void>();
    const guest = {
      on: (event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      },
      off: (event: string) => {
        listeners.delete(event);
      },
    };
    return { guest, listeners };
  }

  it("forwards matching chords with the tab id and prevents default", () => {
    const { guest, listeners } = guestHarness();
    const forward = vi.fn();
    installGuestBrowserChordForwarding({
      tabId: "browser-tab-1",
      guest,
      isMac: true,
      forward,
    });
    const handler = listeners.get("before-input-event") as
      ((event: unknown, input: unknown) => void) | undefined;
    expect(handler).toBeDefined();
    const event = { preventDefault: vi.fn() };
    handler!(event, input({ meta: true, key: "l" }));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(forward).toHaveBeenCalledWith({
      tabId: "browser-tab-1",
      chord: "focus-address-bar",
    });
  });

  it("lets non-matching keys reach the page untouched", () => {
    const { guest, listeners } = guestHarness();
    const forward = vi.fn();
    installGuestBrowserChordForwarding({
      tabId: "browser-tab-2",
      guest,
      isMac: true,
      forward,
    });
    const event = { preventDefault: vi.fn() };
    const handler = listeners.get("before-input-event") as (
      event: unknown,
      input: unknown,
    ) => void;
    handler(event, input({ key: "a", meta: true }));
    handler(event, input({ key: "l" }));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("removes the listener on dispose", () => {
    const { guest, listeners } = guestHarness();
    const dispose = installGuestBrowserChordForwarding({
      tabId: "browser-tab-3",
      guest,
      isMac: true,
      forward: () => {},
    });
    expect(listeners.has("before-input-event")).toBe(true);
    dispose();
    expect(listeners.has("before-input-event")).toBe(false);
  });
});
