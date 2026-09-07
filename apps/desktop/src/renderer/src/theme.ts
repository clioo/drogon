// Pure theme/chrome helpers for the V2 shell. No direct document or
// matchMedia access here — callers inject the root element and the system
// scheme, keeping the logic testable without a DOM. The `.dark` class hook is
// the existing main.css `@custom-variant dark (&:is(.dark *))`; no CSS changes
// are needed or made by this module.

export type EffectiveTheme = "dark" | "light";

/** Structural subset of Element the applier needs; documentElement satisfies it. */
export type ThemeRoot = {
  classList: { add(name: string): void; remove(name: string): void };
};

/**
 * Resolves the stored theme choice against the OS color scheme. "system"
 * follows the OS; explicit "dark"/"light" always win.
 */
export function resolveEffectiveTheme(
  theme: "system" | EffectiveTheme,
  systemDark: boolean,
): EffectiveTheme {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

/**
 * Applies the theme by toggling exactly the `.dark` class on the root
 * element. classList add/remove are idempotent, so repeated application
 * neither duplicates nor disturbs unrelated classes.
 */
export function applyThemeToRoot(root: ThemeRoot, theme: EffectiveTheme): void {
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

/**
 * Initial inspector visibility: a saved user choice always wins; the
 * viewport default applies only when nothing has been saved yet (null).
 */
export function resolveInspectorDefault(
  viewportWide: boolean,
  saved: boolean | null,
): boolean {
  return saved !== null ? saved : viewportWide;
}
