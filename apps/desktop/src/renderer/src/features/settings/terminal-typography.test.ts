// MIT Copyright (c) 2026 Lovecast Inc. Ports the source's
// shared/terminal-fonts.test.ts weight contract and pins the renderer
// adaptation: platform family defaults, envelope validation, suggestion
// filtering/rendering, the xterm family stack, editor-follows-terminal
// resolution, typography search and the xterm option projection.
import { describe, expect, test, vi, afterEach } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_WEIGHT,
  DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
  TERMINAL_FONT_WEIGHT_MAX,
  TERMINAL_FONT_WEIGHT_MIN,
  buildTerminalFontFamily,
  defaultTerminalFontFamily,
  filterFontSuggestions,
  getFallbackTerminalFonts,
  getRenderedFontSuggestions,
  getTerminalTypographySearchEntries,
  isEditorFontFamily,
  isTerminalFontFamily,
  matchesTerminalTypographySearch,
  mergeFontSuggestions,
  normalizeTerminalFontWeight,
  normalizeTerminalFontWeightBold,
  projectTerminalTypographyOptions,
  requestSystemFontFamilies,
  resolveDefaultTerminalFontFamily,
  resolveEditorFontFamily,
  resolveTerminalFontWeights,
} from "./terminal-typography";

describe("terminal font weights (source terminal-fonts.ts contract)", () => {
  test("falls back to the source defaults when the value is missing", () => {
    expect(normalizeTerminalFontWeight(undefined)).toBe(
      DEFAULT_TERMINAL_FONT_WEIGHT,
    );
    expect(normalizeTerminalFontWeightBold(undefined)).toBe(
      DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
    );
    expect(DEFAULT_TERMINAL_FONT_WEIGHT).toBe(500);
    expect(DEFAULT_TERMINAL_FONT_WEIGHT_BOLD).toBe(700);
  });

  test("clamps both weights to the supported xterm range", () => {
    expect(normalizeTerminalFontWeight(10)).toBe(100);
    expect(normalizeTerminalFontWeight(1200)).toBe(900);
    expect(normalizeTerminalFontWeightBold(10)).toBe(100);
    expect(normalizeTerminalFontWeightBold(1200)).toBe(900);
    expect(TERMINAL_FONT_WEIGHT_MIN).toBe(100);
    expect(TERMINAL_FONT_WEIGHT_MAX).toBe(900);
  });

  test("rounds to whole weights like the xterm option expects", () => {
    expect(normalizeTerminalFontWeight(450.4)).toBe(450);
    expect(normalizeTerminalFontWeight(450.5)).toBe(451);
  });

  test("defaults to a pair that straddles the boundary between real font faces", () => {
    expect(resolveTerminalFontWeights(undefined, undefined)).toEqual({
      fontWeight: 500,
      fontWeightBold: 700,
    });
  });

  test("does not derive bold from the base weight", () => {
    expect(resolveTerminalFontWeights(800, undefined)).toEqual({
      fontWeight: 800,
      fontWeightBold: DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
    });
    expect(resolveTerminalFontWeights(300, 400)).toEqual({
      fontWeight: 300,
      fontWeightBold: 400,
    });
    expect(resolveTerminalFontWeights(700, 700)).toEqual({
      fontWeight: 700,
      fontWeightBold: 700,
    });
  });
});

describe("terminal font family defaults", () => {
  test("matches the source platform default (SF Mono / Cascadia / DejaVu)", () => {
    expect(defaultTerminalFontFamily("darwin")).toBe("SF Mono");
    expect(defaultTerminalFontFamily("mac")).toBe("SF Mono");
    expect(defaultTerminalFontFamily("win32")).toBe("Cascadia Mono");
    expect(defaultTerminalFontFamily("linux")).toBe("DejaVu Sans Mono");
    expect(defaultTerminalFontFamily(undefined)).toBe("SF Mono");
  });

  test("resolves from the renderer platform when detectable", () => {
    expect(typeof resolveDefaultTerminalFontFamily()).toBe("string");
    expect(resolveDefaultTerminalFontFamily().length).toBeGreaterThan(0);
  });
});

describe("terminal font family validation", () => {
  test("accepts names and empty (no preference)", () => {
    expect(isTerminalFontFamily("SF Mono")).toBe(true);
    expect(isTerminalFontFamily("")).toBe(true);
    expect(isEditorFontFamily("")).toBe(true);
    expect(isEditorFontFamily("JetBrains Mono")).toBe(true);
  });

  test("rejects control characters and overlong values", () => {
    expect(isTerminalFontFamily("a\0b")).toBe(false);
    expect(isTerminalFontFamily("a\nb")).toBe(false);
    expect(isTerminalFontFamily("x".repeat(257))).toBe(false);
    expect(isTerminalFontFamily(12)).toBe(false);
    expect(isEditorFontFamily("a\x7fb")).toBe(false);
    expect(isEditorFontFamily(null)).toBe(false);
  });
});

describe("font suggestion filtering (source settings-form-option-filter.ts)", () => {
  const fonts = ["SF Mono", "Menlo", "JetBrains Mono", "Fira Code", "Cascadia Mono"];

  test("empty query returns every suggestion in order", () => {
    expect(filterFontSuggestions(fonts, "")).toEqual(fonts);
    expect(filterFontSuggestions(fonts, "   ")).toEqual(fonts);
  });

  test("ranks starts-with before contains", () => {
    expect(filterFontSuggestions(fonts, "fi")).toEqual(["Fira Code"]);
    expect(filterFontSuggestions(fonts, "mono")).toEqual([
      "SF Mono",
      "JetBrains Mono",
      "Cascadia Mono",
    ]);
  });

  test("oversized queries match nothing instead of scanning", () => {
    expect(filterFontSuggestions(fonts, "x".repeat(3 * 1024))).toEqual([]);
  });

  test("render caps the list but keeps the highlighted option reachable", () => {
    const many = Array.from({ length: 500 }, (_, i) => `Font ${i}`);
    const rendered = getRenderedFontSuggestions(many, 499);
    expect(rendered).toHaveLength(320);
    expect(rendered[rendered.length - 1]).toEqual({
      font: "Font 499",
      sourceIndex: 499,
    });
    expect(getRenderedFontSuggestions([], 0)).toEqual([]);
  });

  test("merges system fonts over previous fonts without duplicates", () => {
    expect(mergeFontSuggestions(["B", "A"], ["A", "C"])).toEqual(["B", "A", "C"]);
  });

  test("fallback list is non-empty on every platform", () => {
    expect(getFallbackTerminalFonts().length).toBeGreaterThan(0);
  });
});

describe("terminal font family stack (source buildFontFamily)", () => {
  test("quotes the configured family first, then the fallback chain", () => {
    const stack = buildTerminalFontFamily("JetBrains Mono");
    expect(stack.startsWith('"JetBrains Mono", ')).toBe(true);
    expect(stack).toContain('"SF Mono"');
    expect(stack).toContain("monospace");
    expect(stack.endsWith("monospace")).toBe(true);
  });

  test("never duplicates a family already present (case-insensitive)", () => {
    const stack = buildTerminalFontFamily("sf mono");
    const occurrences = stack.split(",").filter((p) => p.toLowerCase().includes("sf mono"));
    expect(occurrences).toHaveLength(1);
  });

  test("empty preference yields the bare fallback chain", () => {
    const stack = buildTerminalFontFamily("");
    expect(stack).toContain('"SF Mono"');
    expect(stack.startsWith('"')).toBe(true);
  });
});

describe("editor font resolution (empty follows the terminal font)", () => {
  test("empty editor font falls back to the terminal font", () => {
    expect(
      resolveEditorFontFamily({ editorFontFamily: "", terminalFontFamily: "Menlo" }),
    ).toBe("Menlo");
    expect(resolveEditorFontFamily({ terminalFontFamily: "Menlo" })).toBe("Menlo");
  });

  test("an explicit editor font wins over the terminal font", () => {
    expect(
      resolveEditorFontFamily({
        editorFontFamily: "Fira Code",
        terminalFontFamily: "Menlo",
      }),
    ).toBe("Fira Code");
  });

  test("whitespace-only editor font still follows the terminal font", () => {
    expect(
      resolveEditorFontFamily({ editorFontFamily: "   ", terminalFontFamily: "Menlo" }),
    ).toBe("Menlo");
  });

  test("nothing configured resolves to the generic monospace", () => {
    expect(resolveEditorFontFamily(null)).toBe("monospace");
    expect(resolveEditorFontFamily({})).toBe("monospace");
  });
});

describe("terminal typography search", () => {
  test("declares the source rows in source order", () => {
    expect(getTerminalTypographySearchEntries().map((e) => e.title)).toEqual([
      "Font Size",
      "Font Family",
      "Font Weight",
      "Bold Font Weight",
      "Editor Font Family",
    ]);
  });

  test("matches on title, description and keyword tokens", () => {
    expect(matchesTerminalTypographySearch("")).toBe(true);
    expect(matchesTerminalTypographySearch("font family")).toBe(true);
    expect(matchesTerminalTypographySearch("bold weight")).toBe(true);
    expect(matchesTerminalTypographySearch("editor code")).toBe(true);
    expect(matchesTerminalTypographySearch("text size")).toBe(true);
    expect(matchesTerminalTypographySearch("no-such-setting")).toBe(false);
  });
});

describe("xterm option projection", () => {
  test("projects the four consumed options with normalized weights", () => {
    expect(
      projectTerminalTypographyOptions({
        terminalFontSize: 14,
        terminalFontFamily: "JetBrains Mono",
        terminalFontWeight: 450.5,
        terminalFontWeightBold: 2000,
      }),
    ).toEqual({
      fontFamily: buildTerminalFontFamily("JetBrains Mono"),
      fontSize: 14,
      fontWeight: 451,
      fontWeightBold: 900,
    });
  });

  test("missing keys resolve to the live defaults, never undefined", () => {
    const projected = projectTerminalTypographyOptions({});
    expect(projected.fontSize).toBe(13);
    expect(projected.fontWeight).toBe(500);
    expect(projected.fontWeightBold).toBe(700);
    expect(projected.fontFamily).toContain("monospace");
  });
});

describe("system font bridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("resolves [] when the preload bridge is absent (tests, older builds)", async () => {
    vi.stubGlobal("window", undefined as unknown as Window);
    await expect(requestSystemFontFamilies()).resolves.toEqual([]);
  });
});
