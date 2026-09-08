// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// The matchMedia shim serves the dark-scheme query from the native signal
// (the web contents' media state can be wrong — the #241 bug); updates flow
// through setNativeDark, which synthesizes change events for listeners.
import { describe, expect, test, beforeEach } from "vitest";
import {
  resetMatchMediaShimForTests,
  setNativeDarkForTests,
  installMatchMediaShim,
} from "./native-theme-sync";

describe("installMatchMediaShim", () => {
  beforeEach(() => {
    resetMatchMediaShimForTests();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  test("dark query reflects the native signal, live via change events", () => {
    installMatchMediaShim(() => window);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    expect(media.matches).toBe(false);
    let events = 0;
    let seen: boolean | null = null;
    media.addEventListener("change", () => {
      events += 1;
      // Listeners re-read .matches (the synthesized event may be a plain
      // Event where MediaQueryListEvent is unavailable).
      seen = media.matches;
    });
    setNativeDarkForTests(true);
    expect(media.matches).toBe(true);
    expect(seen).toBe(true);
    setNativeDarkForTests(false);
    expect(media.matches).toBe(false);
    expect(seen).toBe(false);
  });

  test("removeEventListener stops the updates", () => {
    installMatchMediaShim(() => window);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let calls = 0;
    const listener = () => {
      calls += 1;
    };
    media.addEventListener("change", listener);
    setNativeDarkForTests(true);
    expect(calls).toBe(1);
    media.removeEventListener("change", listener);
    setNativeDarkForTests(false);
    expect(calls).toBe(1);
  });

  test("other queries pass through untouched", () => {
    installMatchMediaShim(() => window);
    // jsdom has no matchMedia; the shim installs its own for the dark query.
    const real = window.matchMedia("(min-width: 1101px)");
    expect(real.media).toBe("(min-width: 1101px)");
    expect(typeof real.matches).toBe("boolean");
  });
});
