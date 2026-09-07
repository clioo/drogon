// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new tests for the adapted
// terminal-link-activation.ts (gesture predicates are a verbatim port; the
// platform hook is inlined).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTerminalLinkActionActivation,
  isTerminalLinkDirectActivation,
  isTerminalOwnedLinkGesture,
} from "./terminal-link-activation";

function macUserAgent() {
  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  });
}

function linuxUserAgent() {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("terminal link gestures", () => {
  it("requires ⌘ on macOS and Ctrl elsewhere", () => {
    macUserAgent();
    expect(
      isTerminalLinkDirectActivation({ button: 0, metaKey: true, ctrlKey: false }),
    ).toBe(true);
    expect(
      isTerminalLinkDirectActivation({ button: 0, metaKey: false, ctrlKey: true }),
    ).toBe(false);

    linuxUserAgent();
    expect(
      isTerminalLinkDirectActivation({ button: 0, metaKey: false, ctrlKey: true }),
    ).toBe(true);
    expect(
      isTerminalLinkDirectActivation({ button: 0, metaKey: true, ctrlKey: false }),
    ).toBe(false);
  });

  it("rejects non-left buttons and Alt-modified gestures", () => {
    macUserAgent();
    expect(
      isTerminalLinkDirectActivation({
        button: 2,
        metaKey: true,
        ctrlKey: false,
      }),
    ).toBe(false);
    expect(
      isTerminalLinkDirectActivation({
        button: 0,
        metaKey: true,
        ctrlKey: false,
        altKey: true,
      }),
    ).toBe(false);
  });

  it("treats a plain click as the action gesture", () => {
    linuxUserAgent();
    expect(
      isTerminalLinkActionActivation({
        button: 0,
        metaKey: false,
        ctrlKey: false,
      }),
    ).toBe(true);
    expect(
      isTerminalLinkActionActivation({
        button: 0,
        metaKey: false,
        ctrlKey: true,
      }),
    ).toBe(false);
    expect(isTerminalOwnedLinkGesture(undefined)).toBe(false);
  });
});
