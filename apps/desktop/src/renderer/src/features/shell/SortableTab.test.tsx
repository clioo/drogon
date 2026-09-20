// @vitest-environment jsdom
// Issue #606: the subagent-group disclosure a strip tab carries — the
// chevron that folds a leader's group, the "+N" that says how many tabs it
// took with it, and the markers that tell a leader tab from a member. The
// chevron sits inside a tab that arms drag on pointerdown and switches tabs
// on click, so its event containment is part of the contract.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableTab } from "./SortableTab";
// `?raw` and not node:fs: this suite runs in jsdom, where import.meta.url is
// not a file URL.
import sortableTabSource from "./SortableTab.tsx?raw";

afterEach(cleanup);

function renderTab(
  overrides: Partial<React.ComponentProps<typeof SortableTab>> = {},
) {
  const props: React.ComponentProps<typeof SortableTab> = {
    id: "lead",
    title: "Terminal 1",
    ariaLabel: "Terminal 1 live",
    closeLabel: "Close Terminal 1 session",
    icon: <span />,
    retry: null,
    isActive: false,
    isPinned: false,
    hasTabsToRight: false,
    hasTabsToLeft: false,
    tabCount: 1,
    closeDisabled: false,
    onActivate: () => {},
    onClose: () => {},
    onCloseOthers: () => {},
    onCloseToRight: () => {},
    onCloseToLeft: () => {},
    onTogglePin: () => {},
    onCommitTitle: () => {},
    onStripKeyDown: () => {},
    ...overrides,
  };
  return render(
    <DndContext>
      <SortableContext items={[props.id]}>
        <SortableTab {...props} />
      </SortableContext>
    </DndContext>,
  );
}

const group = (expanded: boolean, onToggle = () => {}) => ({
  childCount: 2,
  expanded,
  onToggle,
});

describe("SortableTab subagent group disclosure (#606)", () => {
  it("shows no disclosure on a tab that leads nothing", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: /child agents?$/ })).toBeNull();
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("data-lineage-parent")).toBeNull();
    expect(tab.getAttribute("data-lineage-child")).toBeNull();
    expect(tab.className).not.toContain("tab-lineage-parent");
  });

  it("marks a leader tab and names what its chevron will fold", () => {
    renderTab({ lineage: group(true) });
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("data-lineage-parent")).toBe("true");
    expect(tab.className).toContain("tab-lineage-parent");
    expect(tab.getAttribute("data-lineage-collapsed")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Hide 2 child agents" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("says how many tabs a fold took, and offers to bring them back", () => {
    renderTab({ lineage: group(false) });
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("data-lineage-collapsed")).toBe("true");
    expect(
      tab.querySelector('[data-lineage-child-count="true"]')?.textContent,
    ).toBe("+2");
    const toggle = screen.getByRole("button", { name: "Show 2 child agents" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("counts one subagent in the singular", () => {
    renderTab({ lineage: { childCount: 1, expanded: true, onToggle: () => {} } });
    expect(
      screen.getByRole("button", { name: "Hide 1 child agent" }),
    ).toBeTruthy();
  });

  it("hides the count while the group is open", () => {
    renderTab({ lineage: group(true) });
    expect(
      screen.getByRole("tab").querySelector('[data-lineage-child-count="true"]'),
    ).toBeNull();
  });

  it("marks a member tab, without giving it a chevron of its own", () => {
    renderTab({ id: "kid", lineageDepth: 1 });
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("data-lineage-child")).toBe("true");
    expect(tab.className).toContain("tab-lineage-child");
    expect(screen.queryByRole("button", { name: /child agents?$/ })).toBeNull();
  });

  it("folds the group without also selecting its leader", () => {
    // The tab root switches tabs on click and arms drag on pointerdown;
    // a chevron that leaked either would select the leader on every fold.
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    renderTab({ lineage: group(true, onToggle), onActivate });
    const toggle = screen.getByRole("button", { name: "Hide 2 child agents" });
    fireEvent.pointerDown(toggle, { button: 0 });
    fireEvent.mouseDown(toggle, { button: 0 });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("keeps Enter and Space on the chevron, not on the strip", () => {
    const onStripKeyDown = vi.fn();
    renderTab({ lineage: group(true), onStripKeyDown });
    const toggle = screen.getByRole("button", { name: "Hide 2 child agents" });
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.keyDown(toggle, { key: " " });
    expect(onStripKeyDown).not.toHaveBeenCalled();
    // Other keys still reach the strip's roving-tabindex handler.
    fireEvent.keyDown(toggle, { key: "ArrowRight" });
    expect(onStripKeyDown).toHaveBeenCalledTimes(1);
  });

  it("drops the count and the chevron out of the way while renaming", () => {
    renderTab({ lineage: group(false) });
    fireEvent.doubleClick(screen.getByRole("tab"));
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(
      screen
        .getByRole("tab")
        .querySelector('[data-lineage-child-count="true"]'),
    ).toBeNull();
  });
});

describe("SortableTab declares the group disclosure it accepts (#606)", () => {
  // Types are erased before a test runs, so the declared surface can only be
  // pinned by reading it. It still matters: it is what tells a caller the
  // chevron is opt-in and what the count means.
  it("takes an optional group, and an optional depth for a member", () => {
    expect(sortableTabSource).toContain("lineage?: {");
    expect(sortableTabSource).toContain("childCount: number;");
    expect(sortableTabSource).toContain("expanded: boolean;");
    expect(sortableTabSource).toContain("onToggle: () => void;");
    expect(sortableTabSource).toContain("lineageDepth?: number;");
    // Optional on purpose: every existing call site renders unchanged.
    expect(sortableTabSource).toContain("lineage = null");
    expect(sortableTabSource).toContain("lineageDepth = 0");
  });
});
