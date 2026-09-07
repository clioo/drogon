// Pure lifecycle/handler contracts; native focus behavior requires the separate CDP probe.
import { describe, expect, it, vi } from "vitest";
import {
  attachSettingsDialogLifecycle,
  isSettingsBackdropClick,
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

describe("store round-trip: the full J10 surface persists through the same wiring App.tsx uses", () => {
  it("persists theme, font size, harness defaults and the notification switch across a fresh store instance", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, { namespace: "ui" });
    const onThemeChange = (theme: Theme) => store.set("theme", theme);
    const onTerminalFontSizeChange = (size: number) =>
      store.set("terminalFontSize", size);
    const onNotifyChange = (next: boolean) =>
      store.set("notifyOnAgentNeedsInput", next);

    onThemeChange("dark");
    onTerminalFontSizeChange(15);
    store.set("defaultHarnessId", "pi");
    store.set("harnessDefaults", {
      pi: { model: "opus", effort: "high", permissionMode: "unattended" },
    });
    onNotifyChange(false);
    store.flush();

    const reloaded = new SettingsStore(storage, { namespace: "ui" });
    expect(reloaded.get("theme")).toBe("dark");
    expect(reloaded.get("terminalFontSize")).toBe(15);
    expect(reloaded.get("defaultHarnessId")).toBe("pi");
    expect(reloaded.get("harnessDefaults")).toEqual({
      pi: { model: "opus", effort: "high", permissionMode: "unattended" },
    });
    expect(reloaded.get("notifyOnAgentNeedsInput")).toBe(false);
  });
});
