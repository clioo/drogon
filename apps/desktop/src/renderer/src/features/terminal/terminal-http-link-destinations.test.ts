// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-link-open-hints.ts
// and src/renderer/src/lib/http-link-routing.ts; see
// terminal-http-link-destinations.ts for the mapping.
import { describe, expect, test } from "vitest";
import {
  getTerminalUrlOpenHint,
  terminalHttpLinkActionDestinationsFor,
  terminalHttpLinkClickDestination,
  terminalHttpLinkDestinationLabel,
} from "./terminal-http-link-destinations";

describe("terminalHttpLinkActionDestinationsFor", () => {
  test("preference on names Drogon primary, system alternate", () => {
    expect(terminalHttpLinkActionDestinationsFor(true)).toEqual({
      primary: "drogon",
      alternate: "system",
    });
  });
  test("preference off names system primary, Drogon alternate (fork default)", () => {
    expect(terminalHttpLinkActionDestinationsFor(false)).toEqual({
      primary: "system",
      alternate: "drogon",
    });
  });
});

describe("terminalHttpLinkClickDestination", () => {
  test("Shift states the system browser outright", () => {
    expect(terminalHttpLinkClickDestination(true, true)).toBe("system");
    expect(terminalHttpLinkClickDestination(true, false)).toBe("system");
  });
  test("a plain modifier click follows the preference", () => {
    expect(terminalHttpLinkClickDestination(false, true)).toBe("drogon");
    expect(terminalHttpLinkClickDestination(false, false)).toBe("system");
    expect(terminalHttpLinkClickDestination(undefined, false)).toBe("system");
  });
});

describe("terminalHttpLinkDestinationLabel", () => {
  test("fork popover copy with the app name", () => {
    expect(terminalHttpLinkDestinationLabel("drogon")).toBe("Drogon Browser");
    expect(terminalHttpLinkDestinationLabel("system")).toBe("System Browser");
  });
});

describe("getTerminalUrlOpenHint", () => {
  test("matches the source copy", () => {
    expect(getTerminalUrlOpenHint({ isMac: true })).toBe(
      "Click for actions, ⌘+click to open, or ⇧⌘+click for system browser",
    );
    expect(getTerminalUrlOpenHint({ isMac: false })).toBe(
      "Click for actions, Ctrl+click to open, or Shift+Ctrl+click for system browser",
    );
  });
});
