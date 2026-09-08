// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new tests for the MVP
// TerminalContextMenu.tsx (the source menu's split-down/quick-commands/
// native chat are out of the subset; copy strings for the kept items are
// exact).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import TerminalContextMenu from "./TerminalContextMenu";

function renderMenu(
  open: boolean,
  canSplit = true,
  canCopySessionId = false,
): string {
  return renderToString(
    createElement(TerminalContextMenu, {
      open,
      menuPoint: { x: 100, y: 200 },
      onOpenChange: () => {},
      onCopy: () => {},
      onSelectAll: () => {},
      onPaste: () => {},
      canSplit,
      splitShortcut: "⌘D",
      onSplitRight: () => {},
      canCopySessionId,
      onCopySessionId: () => {},
      onCopyTerminalId: () => {},
      onClearScreen: () => {},
      onClosePane: () => {},
    }),
  );
}

describe("TerminalContextMenu", () => {
  it("renders nothing while closed", () => {
    expect(renderMenu(false)).toBe("");
  });

  it("renders the MVP items with the source's copy and menu semantics", () => {
    const html = renderMenu(true);
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Terminal actions"');
    for (const item of [
      "Copy",
      "Select All",
      "Paste",
      "Split Terminal Right",
      "Copy Terminal ID",
      "Clear Screen",
      "Close Pane",
    ]) {
      expect(html).toContain(item);
    }
    expect(html).toContain("⌘D");
    expect(html.match(/role="menuitem"/g)).toHaveLength(7);
    // Source order: the destructive Close Pane ends its section and
    // Clear Screen (no hint) is the last item.
    const closeAt = html.indexOf("Close Pane");
    const clearAt = html.indexOf("Clear Screen");
    expect(closeAt).toBeGreaterThan(html.indexOf("Copy Terminal ID"));
    expect(clearAt).toBeGreaterThan(closeAt);
  });

  it("hides the split section once the tab already holds two panes", () => {
    const html = renderMenu(true, false);
    expect(html).not.toContain("Split Terminal Right");
    expect(html.match(/role="menuitem"/g)).toHaveLength(6);
  });

  it("shows Copy Session ID only for agent sessions, like the source gate", () => {
    expect(renderMenu(true)).not.toContain("Copy Session ID");
    const html = renderMenu(true, true, true);
    expect(html).toContain("Copy Session ID");
    expect(html.match(/role="menuitem"/g)).toHaveLength(8);
    // It sits just above Copy Terminal ID, like the source.
    expect(html.indexOf("Copy Session ID")).toBeLessThan(
      html.indexOf("Copy Terminal ID"),
    );
  });

  it("positions the menu at the requesting point", () => {
    const html = renderMenu(true);
    expect(html).toContain("left:100px");
    expect(html).toContain("top:200px");
  });
});
