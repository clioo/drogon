// The settings dialog is gone (now a full page): this pins the redirect
// contract plus the page-level search filter the sidebar and pane share.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { redirectSettingsToPage, SettingsPanel } from "./settings-panel";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SettingsSidebar } from "./features/settings/SettingsSidebar";
import {
  filterSettingsSections,
  matchesSettingsSearch,
  normalizeSettingsSearchQuery,
  SETTINGS_SEARCH_BUCKETS,
} from "./features/settings/settings-search";
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

describe("SettingsPanel redirect (dialog -> settings page route)", () => {
  it("renders nothing itself", () => {
    const html = renderToString(
      createElement(SettingsPanel, {
        onOpenPage: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    expect(html).toBe("");
  });

  it("navigates to the page with the section, then closes the caller", () => {
    const onOpenPage = vi.fn();
    const onClose = vi.fn();
    redirectSettingsToPage({ onOpenPage, onClose, initialSection: "agents" });
    expect(onOpenPage).toHaveBeenCalledOnce();
    expect(onOpenPage).toHaveBeenCalledWith("agents");
    expect(onClose).toHaveBeenCalledOnce();
    // Order matters: the page route must exist before the caller dismisses.
    expect(onOpenPage.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0]!,
    );
  });
});

describe("settings search filter (sidebar + pane share this)", () => {
  it("empty query matches every section in nav order", () => {
    expect(filterSettingsSections("")).toEqual([
      "agents",
      "git",
      "appearance",
      "notifications",
      "shortcuts",
    ]);
  });

  it("matches titles, descriptions and keywords case-insensitively", () => {
    expect(filterSettingsSections("theme")).toEqual(["appearance"]);
    expect(filterSettingsSections("HARNESS")).toEqual(["agents"]);
    expect(filterSettingsSections("keyboard")).toEqual(["shortcuts"]);
    expect(filterSettingsSections("github")).toEqual(["git"]);
    expect(filterSettingsSections("notify")).toEqual(["notifications"]);
  });

  it("requires every token to match", () => {
    expect(filterSettingsSections("theme harness")).toEqual([]);
    expect(filterSettingsSections("terminal font")).toEqual(["appearance"]);
  });

  it("normalizes case and whitespace", () => {
    expect(normalizeSettingsSearchQuery("  Theme   DARK ")).toBe("theme dark");
    const appearance = SETTINGS_SEARCH_BUCKETS.find((b) => b.id === "appearance")!;
    expect(matchesSettingsSearch("", appearance)).toBe(true);
    expect(matchesSettingsSearch("system", appearance)).toBe(true);
    expect(matchesSettingsSearch("nope", appearance)).toBe(false);
  });
});

describe("SettingsPage chrome (Orca settings-page-renderer parity)", () => {
  const noop = () => {};
  function page(section?: "appearance" | "agents" | "shortcuts" | "git" | "notifications"): string {
    return renderToString(
      createElement(SettingsPage, {
        theme: "system",
        onThemeChange: noop,
        terminalFontSize: 13,
        onTerminalFontSizeChange: noop,
        terminalGpuAcceleration: "auto",
        onTerminalGpuAccelerationChange: noop,
        inspectorVisible: true,
        onInspectorChange: noop,
        statusBarVisible: true,
        onStatusBarVisibleChange: noop,
        tasksButtonVisible: true,
        onTasksButtonVisibleChange: noop,
        automationsButtonVisible: true,
        onAutomationsButtonVisibleChange: noop,
        titlebarAppNameVisible: true,
        onTitlebarAppNameVisibleChange: noop,
        harnesses: [],
        defaultHarnessId: "",
        onDefaultHarnessChange: noop,
        harnessDefaults: {},
        onHarnessDefaultChange: noop,
        notifyOnAgentNeedsInput: true,
        onNotifyChange: noop,
        workspacePath: null,
        initialSection: section,
        onBack: noop,
      }),
    );
  }

  it("renders the sidebar nav as complementary with Back to app and Search settings", () => {
    const html = page();
    expect(html).toContain("<aside");
    expect(html).toContain("Back to app");
    expect(html).toContain('placeholder="Search settings"');
    expect(html).toContain("⌘");
  });

  it("marks the active section with aria-current and renders its pane", () => {
    const html = page("agents");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Default harness");
  });

  it("lists only the matching sections in the nav while searching", () => {
    const noop = () => {};
    const html = renderToString(
      createElement(SettingsSidebar, {
        activeSectionId: "appearance",
        visibleSectionIds: ["appearance"],
        searchQuery: "theme",
        onSearchChange: noop,
        onBack: noop,
        onSelectSection: noop,
      }),
    );
    expect(html).toContain("Appearance");
    expect(html).not.toContain("Agents");
    expect(html).not.toContain("Notifications");
  });

  it("renders the Appearance pane with a 24px/600 h2 and Interface/Terminal subsections", () => {
    const html = page("appearance");
    expect(html).toContain("text-2xl font-semibold");
    expect(html).toContain(">Appearance</h2>");
    expect(html).toContain(">Interface</h3>");
    expect(html).toContain(">Terminal</h3>");
    expect(html).toContain('aria-label="Theme"');
  });
});

describe("store round-trip: the full settings surface persists through the same wiring App.tsx uses", () => {
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
