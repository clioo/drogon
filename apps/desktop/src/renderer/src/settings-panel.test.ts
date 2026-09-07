// Pure-logic tests for the SettingsPanel wiring. This vitest project has no
// jsdom/happy-dom and no @testing-library (verified absent repo-wide), so DOM
// rendering/event-dispatch cannot be exercised here. The exported handlers
// below are exactly what the component's radio/checkbox/dialog onChange and
// onKeyDown wire to, so testing them directly covers the real interaction
// logic; only the actual DOM event dispatch is left to CDP. Real-browser
// persistence (select dark, reload, .dark applied, localStorage updated) is
// verified separately by a throwaway CDP script (see worker_done report).
import { describe, expect, it, vi } from "vitest";
import {
  buildThemeOptionsState,
  handleInspectorCheckboxChange,
  handleSettingsKeyDown,
  handleThemeRadioChange,
  THEME_OPTIONS,
} from "./settings-panel";
import { SettingsStore } from "./settings-store";
import type { StorageLike, Theme } from "./settings-store";

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("buildThemeOptionsState (aria/props mapping)", () => {
  it("marks exactly the current theme as checked, in system/light/dark order", () => {
    expect(buildThemeOptionsState("dark")).toEqual([
      { value: "system", label: "System", checked: false },
      { value: "light", label: "Light", checked: false },
      { value: "dark", label: "Dark", checked: true },
    ]);
  });
  it("reflects system and light as the checked option", () => {
    expect(buildThemeOptionsState("system").map((o) => o.checked)).toEqual([
      true,
      false,
      false,
    ]);
    expect(buildThemeOptionsState("light").map((o) => o.checked)).toEqual([
      false,
      true,
      false,
    ]);
  });
  it("exposes exactly the three catalog-anchored theme values", () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual([
      "system",
      "light",
      "dark",
    ]);
  });
});

describe("handleThemeRadioChange", () => {
  it("selecting dark calls onThemeChange('dark')", () => {
    const onThemeChange = vi.fn();
    handleThemeRadioChange("dark", onThemeChange);
    expect(onThemeChange).toHaveBeenCalledExactlyOnceWith("dark");
  });
  it("selecting light or system calls onThemeChange with that value", () => {
    const onThemeChange = vi.fn();
    handleThemeRadioChange("light", onThemeChange);
    handleThemeRadioChange("system", onThemeChange);
    expect(onThemeChange).toHaveBeenNthCalledWith(1, "light");
    expect(onThemeChange).toHaveBeenNthCalledWith(2, "system");
  });
  it("ignores a value outside the Theme union without calling onThemeChange", () => {
    const onThemeChange = vi.fn();
    handleThemeRadioChange("blurple", onThemeChange);
    expect(onThemeChange).not.toHaveBeenCalled();
  });
});

describe("handleInspectorCheckboxChange", () => {
  it("passes the checkbox's checked state straight through", () => {
    const onInspectorChange = vi.fn();
    handleInspectorCheckboxChange(true, onInspectorChange);
    handleInspectorCheckboxChange(false, onInspectorChange);
    expect(onInspectorChange).toHaveBeenNthCalledWith(1, true);
    expect(onInspectorChange).toHaveBeenNthCalledWith(2, false);
  });
});

describe("handleSettingsKeyDown", () => {
  it("Escape calls onClose and prevents default", () => {
    const onClose = vi.fn();
    const preventDefault = vi.fn();
    handleSettingsKeyDown({ key: "Escape", preventDefault }, onClose);
    expect(onClose).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });
  it("any other key does not call onClose or preventDefault", () => {
    const onClose = vi.fn();
    const preventDefault = vi.fn();
    handleSettingsKeyDown({ key: "Enter", preventDefault }, onClose);
    handleSettingsKeyDown({ key: "a", preventDefault }, onClose);
    expect(onClose).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("store round-trip: theme + inspector persist through the same wiring App.tsx uses", () => {
  it("persists a dark theme + hidden inspector across a fresh store instance", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, { namespace: "ui" });
    const onThemeChange = (theme: Theme) => store.set("theme", theme);
    const onInspectorChange = (visible: boolean) =>
      store.set("inspectorVisible", visible);

    handleThemeRadioChange("dark", onThemeChange);
    handleInspectorCheckboxChange(false, onInspectorChange);
    store.flush();

    const reloaded = new SettingsStore(storage, { namespace: "ui" });
    expect(reloaded.get("theme")).toBe("dark");
    expect(reloaded.get("inspectorVisible")).toBe(false);
  });
});
