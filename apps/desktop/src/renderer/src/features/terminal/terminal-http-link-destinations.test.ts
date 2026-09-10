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
  test("Shift opens inside Drogon's own browser", () => {
    expect(terminalHttpLinkClickDestination(true)).toBe("drogon");
  });
  test("a plain click hands the URL to the default browser", () => {
    expect(terminalHttpLinkClickDestination(false)).toBe("system");
    expect(terminalHttpLinkClickDestination(undefined)).toBe("system");
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
      "Click to open in your browser, or ⇧+click for Drogon Browser",
    );
    expect(getTerminalUrlOpenHint({ isMac: false })).toBe(
      "Click to open in your browser, or Shift+click for Drogon Browser",
    );
  });
});
