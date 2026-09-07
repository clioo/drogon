import { describe, expect, test } from "vitest";
import {
  isWideSidebarHeader,
  resolveAppChromeLayout,
  SIDEBAR_HEADER_COMPACT_MIN_WIDTH,
} from "./app-chrome-layout";

const SETTINGS = "settings";

function layout(route: string | null, sidebarOpen = true) {
  return resolveAppChromeLayout({
    route,
    settingsRouteId: SETTINGS,
    sidebarOpen,
    sidebarWidth: 280,
  });
}

describe("app chrome layout", () => {
  test("sessions view mounts sidebar-column chrome at the sidebar width", () => {
    const chrome = layout(null);
    expect(chrome.showSidebar).toBe(true);
    expect(chrome.showChromeControls).toBe(true);
    expect(chrome.showHistoryControls).toBe(true);
    expect(chrome.floating).toBe(false);
    expect(chrome.leftChromeWidth).toBe(280);
  });

  test("collapsed sidebar floats the header over the content", () => {
    const chrome = layout(null, false);
    expect(chrome.showSidebar).toBe(true);
    expect(chrome.showChromeControls).toBe(true);
    expect(chrome.showHistoryControls).toBe(true);
    expect(chrome.floating).toBe(true);
    expect(chrome.leftChromeWidth).toBe(null);
  });

  test("task/bot/automation pages keep the sidebar chrome", () => {
    for (const route of ["tasks", "bots", "automations"]) {
      const chrome = layout(route);
      expect(chrome.showSidebar).toBe(true);
      expect(chrome.showChromeControls).toBe(true);
      expect(chrome.showHistoryControls).toBe(true);
    }
  });

  test("settings full page hides the sidebar and every titlebar control", () => {
    for (const sidebarOpen of [true, false]) {
      const chrome = layout(SETTINGS, sidebarOpen);
      expect(chrome.showSidebar).toBe(false);
      expect(chrome.showChromeControls).toBe(false);
      expect(chrome.showHistoryControls).toBe(false);
      expect(chrome.floating).toBe(false);
      expect(chrome.leftChromeWidth).toBe(null);
    }
  });

  test("projects header compacts below the source width", () => {
    expect(SIDEBAR_HEADER_COMPACT_MIN_WIDTH).toBe(235);
    expect(isWideSidebarHeader(280)).toBe(true);
    expect(isWideSidebarHeader(235)).toBe(true);
    expect(isWideSidebarHeader(234)).toBe(false);
  });
});
