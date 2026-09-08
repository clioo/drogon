// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Menu rows/order/ARIA for the per-project "Project actions" menu ported
   from Orca's repo-header-project-actions.tsx. Radix portals menu content
   to document.body, so these mount under jsdom (the repo's
   radix-jsdom-stubs pattern) instead of SSR: SSR never includes portal
   content, open or not. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Project } from "../../../../shared/session-contract";
import { ProjectActionsMenu } from "./project-actions-menu";
import { TooltipProvider } from "../../components/ui/tooltip";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

function project(name = "drogon"): Project {
  return {
    id: "p1",
    hostId: "h1",
    path: `/work/${name}`,
    name,
    kind: "git",
    defaultBaseRef: null,
  };
}

function mount(
  overrides: Partial<Parameters<typeof ProjectActionsMenu>[0]> = {},
) {
  return render(
    <TooltipProvider>
      <ProjectActionsMenu
        project={project()}
        disabled={false}
        defaultOpen
        onOpenSettings={() => {}}
        onRemove={() => {}}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

function menuItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-slot="dropdown-menu-item"]',
    ),
  );
}

describe("ProjectActionsMenu", () => {
  test("trigger names the project", () => {
    mount({ defaultOpen: false });
    const trigger = document.querySelector(
      '[aria-label="Project actions for drogon"]',
    );
    expect(trigger).toBeTruthy();
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
  });

  test("rows are Project Settings, separator, destructive Remove Project", () => {
    mount();
    const items = menuItems();
    expect(items.map((item) => item.textContent)).toEqual([
      "Project Settings",
      "Remove Project",
    ]);
    // Exactly the two rows: no group, icon or visibility rows (MVP has
    // no backing stores for them — see the PR not-ported list).
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Change Project Icon");
    expect(body).not.toContain("New group from project");
    expect(body).not.toContain("Move to group");
    expect(body).not.toContain("Remove from group");
    expect(body).not.toContain("worktree");
    // The destructive row carries the variant, the settings row does not.
    expect(items[0]?.getAttribute("data-variant")).not.toBe("destructive");
    expect(items[1]?.getAttribute("data-variant")).toBe("destructive");
    // The separator sits between the two rows, like the source.
    const content = document.querySelector(
      '[data-slot="dropdown-menu-content"]',
    );
    const separator = content?.querySelector(
      '[data-slot="dropdown-menu-separator"]',
    );
    expect(separator).toBeTruthy();
    // The separator sits between the two rows, like the source.
    expect(
      Boolean(
        items[0]?.compareDocumentPosition(separator as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        items[1]?.compareDocumentPosition(separator as Node) &
          Node.DOCUMENT_POSITION_PRECEDING,
      ),
    ).toBe(true);
  });

  test("menu opens to the bottom-end like the source", () => {
    mount();
    const content = document.querySelector(
      '[data-slot="dropdown-menu-content"]',
    );
    expect(content?.getAttribute("role")).toBe("menu");
    expect(content?.getAttribute("data-side")).toBe("bottom");
    expect(content?.getAttribute("data-align")).toBe("end");
  });

  test("closed menu renders only the trigger", () => {
    mount({ defaultOpen: false });
    expect(
      document.querySelector('[aria-label="Project actions for drogon"]'),
    ).toBeTruthy();
    expect(menuItems()).toHaveLength(0);
  });

  test("disabled state disables both rows", () => {
    mount({ disabled: true });
    const items = menuItems();
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.getAttribute("aria-disabled")).toBe("true");
    }
  });

  test("Project Settings calls through to settings", () => {
    const onOpenSettings = vi.fn();
    mount({ onOpenSettings, onRemove: () => {} });
    // Radix selects on the full pointer gesture, not a bare click.
    const item = menuItems()[0] as HTMLElement;
    fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(item, { pointerType: "mouse", button: 0 });
    fireEvent.click(item);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  test("Remove Project calls through to remove", () => {
    const onRemove = vi.fn();
    mount({ onOpenSettings: () => {}, onRemove });
    const item = menuItems()[1] as HTMLElement;
    fireEvent.pointerDown(item, { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(item, { pointerType: "mouse", button: 0 });
    fireEvent.click(item);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
