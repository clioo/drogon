// MIT Copyright (c) 2026 Lovecast Inc. Drogon-new tests for the MVP
// TerminalContextMenu.tsx (the source menu's split-down/quick-commands/
// native chat are out of the subset; copy strings for the kept items are
// exact).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import TerminalContextMenu from "./TerminalContextMenu";

function renderMenu(open: boolean, canSplit = true): string {
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
  });

  it("hides the split section once the tab already holds two panes", () => {
    const html = renderMenu(true, false);
    expect(html).not.toContain("Split Terminal Right");
    expect(html.match(/role="menuitem"/g)).toHaveLength(6);
  });

  it("positions the menu at the requesting point", () => {
    const html = renderMenu(true);
    expect(html).toContain("left:100px");
    expect(html).toContain("top:200px");
  });
});
