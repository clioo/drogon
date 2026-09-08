import { describe, expect, it } from "vitest";
import {
  applyThemeToRoot,
  resolveEffectiveTheme,
  resolveInspectorDefault,
} from "./theme";
import type { ThemeRoot } from "./theme";

function fakeRoot(...initial: string[]) {
  const classes = new Set<string>(initial);
  const classList = {
    add: (name: string) => classes.add(name),
    remove: (name: string) => classes.delete(name),
    contains: (name: string) => classes.has(name),
    toString: () => [...classes].join(" "),
  };
  const root = { classList } as ThemeRoot;
  return { root, classes, classList };
}

describe("resolveEffectiveTheme", () => {
  it("resolves system to the OS color scheme", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
  });
  it("lets an explicit dark or light win over the system scheme", () => {
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("dark", true)).toBe("dark");
    expect(resolveEffectiveTheme("light", false)).toBe("light");
  });
});

describe("applyThemeToRoot", () => {
  it("adds .dark for dark and removes it for light", () => {
    const dark = fakeRoot();
    applyThemeToRoot(dark.root, "dark");
    expect(dark.classList.contains("dark")).toBe(true);
    const light = fakeRoot("dark");
    applyThemeToRoot(light.root, "light");
    expect(light.classList.contains("dark")).toBe(false);
  });
  it("touches only the .dark class", () => {
    const scenario = fakeRoot("other-hook");
    applyThemeToRoot(scenario.root, "dark");
    expect([...scenario.classes].sort()).toEqual(["dark", "other-hook"]);
    applyThemeToRoot(scenario.root, "light");
    expect([...scenario.classes]).toEqual(["other-hook"]);
  });
  it("is idempotent on repeated application", () => {
    const scenario = fakeRoot();
    applyThemeToRoot(scenario.root, "dark");
    applyThemeToRoot(scenario.root, "dark");
    expect(darkCount(scenario.classList)).toBe(1);
    applyThemeToRoot(scenario.root, "light");
    applyThemeToRoot(scenario.root, "light");
    expect(scenario.classList.contains("dark")).toBe(false);
  });
});

function darkCount(classList: ReturnType<typeof fakeRoot>["classList"]) {
  let seen = 0;
  for (const name of classList.toString().split(" "))
    if (name === "dark") seen += 1;
  return seen;
}

describe("resolveInspectorDefault", () => {
  it("prefers the saved value in both directions", () => {
    expect(resolveInspectorDefault(false)).toBe(false);
    expect(resolveInspectorDefault(true)).toBe(true);
  });
  it("keeps the sidebar visible when nothing is saved", () => {
    expect(resolveInspectorDefault(null)).toBe(true);
  });
});
