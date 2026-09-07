// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new tests for the adapted
// terminal-web-link-click.ts (gesture gate kept verbatim; the opener is
// Drogon's browser authority source).
import { describe, expect, it, vi } from "vitest";
import { handleTerminalWebLinkClick } from "./terminal-web-link-click";

describe("handleTerminalWebLinkClick", () => {
  it("ignores gestures the terminal does not own", () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    // No modifier and no button info counts as action activation in the
    // helper's Partial shape only when all modifiers are absent; a right
    // click (button 2) is never owned.
    const handled = handleTerminalWebLinkClick(
      "https://example.com",
      { button: 2, metaKey: false, ctrlKey: false } as MouseEvent,
      { openUrl },
    );
    expect(handled).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("routes owned gestures to the opener and clears selection", async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const clearSelection = vi.fn();
    const preventDefault = vi.fn();
    const handled = handleTerminalWebLinkClick(
      "https://example.com",
      {
        button: 0,
        metaKey: false,
        ctrlKey: true,
        preventDefault,
      } as unknown as MouseEvent,
      { openUrl, clearSelection },
    );
    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect(clearSelection).toHaveBeenCalled();
  });

  it("reports opener failures without throwing", async () => {
    const openUrl = vi.fn(async () => ({
      ok: false as const,
      message: "blocked",
    }));
    const report = vi.fn();
    const handled = handleTerminalWebLinkClick(
      "https://example.com",
      {
        button: 0,
        metaKey: false,
        ctrlKey: true,
        preventDefault: () => {},
      } as unknown as MouseEvent,
      { openUrl, report },
    );
    expect(handled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith("blocked");
  });
});
