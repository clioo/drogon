import { describe, expect, it } from "vitest";
import { monacoThemeForScheme, readEffectiveSchemeFromRoot } from "./editor-theme";

describe("readEffectiveSchemeFromRoot", () => {
  it("reads dark when the root carries the .dark class", () => {
    expect(readEffectiveSchemeFromRoot({ classList: { contains: () => true } })).toBe("dark");
  });

  it("reads light when the root does not carry .dark", () => {
    expect(readEffectiveSchemeFromRoot({ classList: { contains: () => false } })).toBe("light");
  });

  it("defaults to light when there is no root", () => {
    expect(readEffectiveSchemeFromRoot(null)).toBe("light");
    expect(readEffectiveSchemeFromRoot(undefined)).toBe("light");
  });
});

describe("monacoThemeForScheme", () => {
  it("maps to Monaco's built-in theme ids", () => {
    expect(monacoThemeForScheme("dark")).toBe("vs-dark");
    expect(monacoThemeForScheme("light")).toBe("vs");
  });
});
