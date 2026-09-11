// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Chrome-parity pins for the strip tabs: the Mentu tab must share the
// terminal/browser/editor tab structure exactly — same width box (with the
// #235 h-full fix so it never renders shorter than its siblings), same
// state/border/drop-indicator classes, same truncation, same close
// affordance placement, same focus/ARIA shape.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { EditorStripTab } from "./EditorStripTab";
import { MentuStripTab, MENTU_TAB_LABEL } from "./MentuStripTab";
import { editorTabId, type EditorTabState } from "../editor-tab";

afterEach(cleanup);

function renderMentu(handlers: { onActivate?: () => void; onClose?: () => void } = {}) {
  return render(
    <TooltipProvider>
      <MentuStripTab
        isActive
        isPinned={false}
        hasTabsToRight
        onActivate={handlers.onActivate ?? (() => {})}
        onClose={handlers.onClose ?? (() => {})}
      />
    </TooltipProvider>,
  );
}

const fileTab: EditorTabState = {
  tabId: editorTabId("ws-1", "src/app.ts"),
  workspaceId: "ws-1",
  path: "src/app.ts",
  dirty: false,
};

/** The tab-root classes every strip tab must share (tab-chrome.ts wiring). */
function sharedRootClasses(className: string): string[] {
  return className
    .split(/\s+/)
    .filter((token) =>
      [
        "group",
        "relative",
        "flex",
        "h-full",
        "items-center",
        "px-1.5",
        "text-xs",
        "cursor-pointer",
        "select-none",
        "border-t",
        "border-r",
        "border-border",
        "bg-card",
        "text-muted-foreground",
        "text-foreground",
        "hover:text-foreground",
      ].includes(token),
    )
    .sort();
}

describe("strip tab chrome parity", () => {
  it("gives the Mentu tab the exact shared root classes of the editor tab", () => {
    const mentu = renderMentu().getByRole("tab", { name: MENTU_TAB_LABEL });
    const editor = render(
      <TooltipProvider>
        <EditorStripTab
          tab={fileTab}
          isActive
          hasTabsToRight
          onActivate={() => {}}
          onClose={() => {}}
        />
      </TooltipProvider>,
    ).getByRole("tab", { name: "app.ts" });
    expect(sharedRootClasses(mentu.className)).toEqual(
      sharedRootClasses(editor.className),
    );
  });

  it("keeps the h-full width box so the tab fills the strip row (#235)", () => {
    // The container div sits between the stretched strip wrapper and the
    // h-full tab root; without h-full it collapses to content height and
    // the tab renders shorter than the terminal tabs (the bug Carlos saw).
    const { container } = renderMentu();
    const widthBox = container.querySelector("div");
    expect(widthBox?.className).toContain("w-[180px]");
    expect(widthBox?.className).toContain("h-full");
  });

  it("renders the same ARIA shape as the sibling tabs", () => {
    const tab = renderMentu().getByRole("tab", { name: MENTU_TAB_LABEL });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("aria-controls")).toBe("mentu-tab-panel");
    expect(tab.getAttribute("data-tab-id")).toBe("mentu-tab");
    expect(tab.getAttribute("data-pinned")).toBe("false");
    expect(tab.getAttribute("tabindex")).toBe("0");
  });

  it("truncates the label and places the close button like the siblings", () => {
    const { container } = renderMentu();
    const tab = screen.getByRole("tab", { name: MENTU_TAB_LABEL });
    const label = tab.querySelector("span.min-w-0.flex-1.truncate");
    expect(label?.textContent).toBe(MENTU_TAB_LABEL);
    const close = container.querySelector('[data-tab-close-button="true"]');
    expect(close).not.toBeNull();
    expect(close?.getAttribute("aria-label")).toBe(`Close tab ${MENTU_TAB_LABEL}`);
    // The close button is the tab root's last element child, like every
    // sibling tab (label, then trailing affordances).
    expect(tab.lastElementChild).toBe(close);
  });

  it("activates on click and Enter, and closes from its close button", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const { container } = renderMentu({ onActivate, onClose });
    const tab = screen.getByRole("tab", { name: MENTU_TAB_LABEL });
    fireEvent.click(tab);
    expect(onActivate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(tab, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('[data-tab-close-button="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
