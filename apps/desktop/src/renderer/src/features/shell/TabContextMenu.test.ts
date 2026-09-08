import { describe, expect, it } from "vitest";
import { buildTabMenuPolicy } from "./TabContextMenu";

describe("buildTabMenuPolicy", () => {
  it("guards Close on pinned tabs and exposes rename for sessions only", () => {
    const session = buildTabMenuPolicy({
      kind: "session",
      isPinned: true,
      tabCount: 3,
      hasTabsToRight: true,
      hasTabsToLeft: false,
    });
    expect(session.closeDisabled).toBe(true);
    expect(session.renameVisible).toBe(true);
    expect(session.closeOthersDisabled).toBe(false);
    expect(session.closeToRightDisabled).toBe(false);
    expect(session.closeToLeftDisabled).toBe(true);

    const browser = buildTabMenuPolicy({
      kind: "browser",
      isPinned: false,
      tabCount: 1,
      hasTabsToRight: false,
      hasTabsToLeft: false,
    });
    expect(browser.closeDisabled).toBe(false);
    expect(browser.renameVisible).toBe(false);
    expect(browser.closeOthersDisabled).toBe(true);
  });

  it("disables directional closes at the strip ends", () => {
    const first = buildTabMenuPolicy({
      kind: "session",
      isPinned: false,
      tabCount: 2,
      hasTabsToRight: true,
      hasTabsToLeft: false,
    });
    expect(first.closeToLeftDisabled).toBe(true);
    expect(first.closeToRightDisabled).toBe(false);
  });
});
