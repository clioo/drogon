// MIT Copyright (c) 2026 Lovecast Inc. Tests for main/fonts.ts (ported
// from the Orca reference src/main/system-fonts.ts): per-platform parsing,
// dedupe/sort/dot-file filtering, curated fallbacks and memoization. The
// runner is always stubbed — tests never spawn OS font tools.
import { describe, expect, test, beforeEach } from "vitest";
import {
  fallbackFonts,
  listSystemFontFamilies,
  resetCachedSystemFonts,
  type FontListRunner,
} from "./fonts";

const ok =
  (stdout: string): FontListRunner =>
  async () => ({ ok: true, stdout });
const fail: FontListRunner = async () => ({ ok: false, reason: "nope" });

beforeEach(() => {
  resetCachedSystemFonts();
});

describe("listSystemFontFamilies", () => {
  test("parses macOS system_profiler JSON into sorted unique families", async () => {
    const stdout = JSON.stringify({
      SPFontsDataType: [
        { typefaces: [{ family: "Menlo" }, { family: "Menlo" }] },
        { typefaces: [{ family: "SF Mono" }, { family: ".AppleSystemUIFont" }] },
      ],
    });
    let calls = 0;
    const runner: FontListRunner = async (file, args) => {
      calls += 1;
      expect(file).toBe("system_profiler");
      expect(args).toEqual(["SPFontsDataType", "-json"]);
      return { ok: true, stdout };
    };
    expect(await listSystemFontFamilies(runner, "darwin")).toEqual([
      "Menlo",
      "SF Mono",
    ]);
    // Memoized: the OS tool runs once no matter how many callers ask.
    expect(await listSystemFontFamilies(runner, "darwin")).toEqual([
      "Menlo",
      "SF Mono",
    ]);
    expect(calls).toBe(1);
  });

  test("parses Linux fc-list output across comma-separated families", async () => {
    const fonts = await listSystemFontFamilies(
      ok("DejaVu Sans Mono,DejaVu Sans Mono\nLiberation Mono\n"),
      "linux",
    );
    expect(fonts).toEqual(["DejaVu Sans Mono", "Liberation Mono"]);
  });

  test("parses Windows InstalledFontCollection names", async () => {
    const fonts = await listSystemFontFamilies(
      ok("Cascadia Mono\r\nConsolas\r\n"),
      "win32",
    );
    expect(fonts).toEqual(["Cascadia Mono", "Consolas"]);
  });

  test("falls back to the curated list when the OS tool fails", async () => {
    expect(await listSystemFontFamilies(fail, "darwin")).toEqual(
      fallbackFonts("darwin"),
    );
  });

  test("falls back when the tool yields no families", async () => {
    expect(await listSystemFontFamilies(ok(""), "linux")).toEqual(
      fallbackFonts("linux"),
    );
  });
});

describe("fallbackFonts", () => {
  test("matches the source per-platform curated lists", () => {
    expect(fallbackFonts("darwin")).toEqual([
      "SF Mono",
      "Menlo",
      "Monaco",
      "JetBrains Mono",
      "Fira Code",
    ]);
    expect(fallbackFonts("win32")).toEqual([
      "Cascadia Mono",
      "Consolas",
      "Lucida Console",
      "JetBrains Mono",
      "Fira Code",
    ]);
    expect(fallbackFonts("linux")).toContain("DejaVu Sans Mono");
  });
});
