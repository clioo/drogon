// Pure-logic tests for the SettingsPanel wiring. This vitest project has no
// jsdom/happy-dom and no @testing-library (verified absent repo-wide), so DOM
// rendering/real focus/Tab dispatch cannot be exercised here. The panel is a
// native <dialog>.showModal(): the browser itself supplies focus-into-dialog,
// Tab/Shift+Tab trapping and inert background, so attachSettingsDialogLifecycle
// below is the entire seam our own code owns for that behavior, and it is
// exercised against a fake dialog that mimics the real showModal/close/event
// contract. Real-browser confirmation of the native trap/outside-dismiss/
// Escape/focus-restore behavior is left to the CDP harness (out of this
// dispatch's file scope). The exported handlers below are exactly what the
// component's radio/checkbox/dialog wiring uses, so testing them directly
// covers the real interaction logic. Real-browser persistence (select dark,
// reload, .dark applied, localStorage updated) is verified separately by a
// throwaway CDP script (see worker_done report).
import { describe, expect, it, vi } from "vitest";
import {
  attachSettingsDialogLifecycle,
  buildThemeOptionsState,
  handleInspectorCheckboxChange,
  handleThemeRadioChange,
  isSettingsBackdropClick,
  SETTINGS_PANEL_STYLES,
  THEME_OPTIONS,
} from "./settings-panel";
import { SettingsStore } from "./settings-store";
import type { StorageLike, Theme } from "./settings-store";

/** Minimal fake satisfying the slice of HTMLDialogElement the lifecycle uses. */
class FakeDialog {
  open = false;
  private listeners = new Map<string, Set<() => void>>();
  showModal = vi.fn(() => {
    this.open = true;
  });
  close = vi.fn(() => {
    this.open = false;
    this.dispatch("close");
  });
  addEventListener = vi.fn((type: string, listener: () => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  });
  removeEventListener = vi.fn((type: string, listener: () => void) => {
    this.listeners.get(type)?.delete(listener);
  });
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

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

describe("attachSettingsDialogLifecycle (native modal open/close/focus-restore)", () => {
  it("opens the dialog as a real modal on attach, so the browser moves focus in and traps Tab/Shift+Tab", () => {
    const dialog = new FakeDialog();
    const opener = { focus: vi.fn() };
    attachSettingsDialogLifecycle(dialog, opener, vi.fn());
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
  });

  it("native Escape/cancel firing the dialog's close event calls onClose exactly once", () => {
    const dialog = new FakeDialog();
    const onClose = vi.fn();
    attachSettingsDialogLifecycle(dialog, { focus: vi.fn() }, onClose);
    // Escape triggers the browser's native cancel -> close default action;
    // simulated here by dispatching the resulting native "close" event.
    dialog.dispatch("close");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cleanup closes an still-open dialog and restores focus to the opener", () => {
    const dialog = new FakeDialog();
    const opener = { focus: vi.fn() };
    const cleanup = attachSettingsDialogLifecycle(dialog, opener, vi.fn());
    cleanup();
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it("cleanup does not re-close an already-closed dialog, but still restores focus", () => {
    const dialog = new FakeDialog();
    const opener = { focus: vi.fn() };
    const onClose = vi.fn();
    const cleanup = attachSettingsDialogLifecycle(dialog, opener, onClose);
    dialog.close(); // e.g. user pressed Escape before unmount
    cleanup();
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(opener.focus).toHaveBeenCalledOnce();
  });

  it("cleanup restores focus even with no opener (defensive: opener may be unmounted)", () => {
    const dialog = new FakeDialog();
    expect(() =>
      attachSettingsDialogLifecycle(dialog, null, vi.fn())(),
    ).not.toThrow();
  });

  it("cleanup removes the close listener so a later native close does not call onClose again", () => {
    const dialog = new FakeDialog();
    const onClose = vi.fn();
    const cleanup = attachSettingsDialogLifecycle(
      dialog,
      { focus: vi.fn() },
      onClose,
    );
    cleanup();
    onClose.mockClear();
    dialog.dispatch("close");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("isSettingsBackdropClick (outside-interaction dismissal)", () => {
  const dialog = {
    getBoundingClientRect: () => ({
      left: 10,
      right: 100,
      top: 10,
      bottom: 100,
    }),
  };
  it("is true when the click target is the dialog element itself (native ::backdrop click)", () => {
    expect(
      isSettingsBackdropClick(
        { target: dialog, clientX: 0, clientY: 0 },
        dialog,
      ),
    ).toBe(true);
  });
  it("is false when the click target is a control inside the dialog", () => {
    const innerButton = {};
    expect(
      isSettingsBackdropClick(
        { target: innerButton, clientX: 20, clientY: 20 },
        dialog,
      ),
    ).toBe(false);
  });
  it("does not dismiss when dialog padding itself receives the click", () => {
    expect(
      isSettingsBackdropClick(
        { target: dialog, clientX: 15, clientY: 15 },
        dialog,
      ),
    ).toBe(false);
  });
});

describe("SETTINGS_PANEL_STYLES (canonical type scale, layer tier, narrow viewport)", () => {
  it("uses only the documented 12/13/14px type scale, not invented rem sizes", () => {
    expect(SETTINGS_PANEL_STYLES).not.toMatch(/0?\.\d+rem/);
    expect(SETTINGS_PANEL_STYLES).toMatch(/font-size:\s*14px/);
    expect(SETTINGS_PANEL_STYLES).toMatch(/font-size:\s*13px/);
    expect(SETTINGS_PANEL_STYLES).toMatch(/font-size:\s*12px/);
  });
  it("uses the source floating/popover layer tier (z-index: 10), not an invented 20", () => {
    expect(SETTINGS_PANEL_STYLES).toMatch(/z-index:\s*10\b/);
    expect(SETTINGS_PANEL_STYLES).not.toMatch(/z-index:\s*20\b/);
  });
  it("clamps width to the viewport so a narrow window doesn't overflow off-screen", () => {
    expect(SETTINGS_PANEL_STYLES).toMatch(
      /width:\s*min\(260px,\s*calc\(100vw - 32px\)\)/,
    );
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
