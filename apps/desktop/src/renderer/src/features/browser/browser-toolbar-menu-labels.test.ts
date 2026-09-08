// qa clioo/drogon#179: the toolbar menu must never render a raw `Mod+`
// token. Hints are platform glyphs (⌘R/⌘F on macOS, Ctrl+R/Ctrl+F
// elsewhere), the find row carries the fork's ellipsis, and the zoom
// percentage stays a separate trailing value, not fused into the label.
import { describe, expect, test } from "vitest";
import {
  BROWSER_MENU_FIND_LABEL,
  BROWSER_MENU_RELOAD_LABEL,
  BROWSER_MENU_RESET_ZOOM_LABEL,
  getBrowserMenuShortcutHint,
} from "./browser-toolbar-menu";

describe("browser toolbar menu copy (#179)", () => {
  test("labels match the fork: Reload, Reset zoom, Find in page...", () => {
    expect(BROWSER_MENU_RELOAD_LABEL).toBe("Reload");
    expect(BROWSER_MENU_RESET_ZOOM_LABEL).toBe("Reset zoom");
    expect(BROWSER_MENU_FIND_LABEL).toBe("Find in page...");
  });

  test("macOS hints are ⌘ glyphs, never the Mod token", () => {
    expect(getBrowserMenuShortcutHint("reload", "MacIntel")).toBe("⌘R");
    expect(getBrowserMenuShortcutHint("find", "MacIntel")).toBe("⌘F");
    for (const hint of [
      getBrowserMenuShortcutHint("reload", "MacIntel"),
      getBrowserMenuShortcutHint("find", "MacIntel"),
    ]) {
      expect(hint).not.toContain("Mod");
    }
  });

  test("other platforms read Ctrl+R / Ctrl+F", () => {
    expect(getBrowserMenuShortcutHint("reload", "Win32")).toBe("Ctrl+R");
    expect(getBrowserMenuShortcutHint("find", "Win32")).toBe("Ctrl+F");
    expect(getBrowserMenuShortcutHint("reload", "")).toBe("Ctrl+R");
    expect(getBrowserMenuShortcutHint("find", "Linux x86_64")).toBe("Ctrl+F");
  });
});
