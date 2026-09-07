import { describe, expect, test } from "vitest";
import {
  clampSidebarWidth,
  loadSidebarOpen,
  loadSidebarWidth,
  nextSidebarWidth,
  saveSidebarOpen,
  saveSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./sidebar-width";

function memoryStorage(values: Record<string, string> = {}) {
  const store = new Map(Object.entries(values));
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("sidebar width", () => {
  test("defaults to 280 and clamps to 220–500", () => {
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(280);
    expect(SIDEBAR_MIN_WIDTH).toBe(220);
    expect(SIDEBAR_MAX_WIDTH).toBe(500);
    expect(clampSidebarWidth(280)).toBe(280);
    expect(clampSidebarWidth(100)).toBe(220);
    expect(clampSidebarWidth(900)).toBe(500);
    expect(clampSidebarWidth(Number.NaN)).toBe(280);
  });

  test("width persists and round-trips, invalid values fall back", () => {
    const storage = memoryStorage();
    expect(loadSidebarWidth(storage)).toBe(280);
    saveSidebarWidth(storage, 320);
    expect(loadSidebarWidth(storage)).toBe(320);
    saveSidebarWidth(storage, 10_000);
    expect(loadSidebarWidth(storage)).toBe(500);
    expect(loadSidebarWidth(memoryStorage({ "drogon:shell:sidebar-width": "nope" }))).toBe(
      280,
    );
  });

  test("open flag persists, defaulting to open", () => {
    const storage = memoryStorage();
    expect(loadSidebarOpen(storage)).toBe(true);
    saveSidebarOpen(storage, false);
    expect(loadSidebarOpen(storage)).toBe(false);
  });

  test("drag delta widens rightward and clamps", () => {
    expect(nextSidebarWidth(280, 100, 140)).toBe(320);
    expect(nextSidebarWidth(280, 100, 60)).toBe(240);
    expect(nextSidebarWidth(220, 100, 0)).toBe(220);
    expect(nextSidebarWidth(500, 100, 400)).toBe(500);
  });
});
