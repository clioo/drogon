// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon dropdown-menu port, including the required
// keyboard check: arrow navigation highlights items.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { getSlot, installRadixJsdomStubs } from "./radix-jsdom-stubs";

// Radix menu navigation defers focus moves to a setTimeout.
const flushDeferredFocus = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("DropdownMenu", () => {
  it("renders the source slots, menu roles and surface recipe when open", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Worktree</DropdownMenuLabel>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    const content = getSlot("dropdown-menu-content");
    expect(content.getAttribute("role")).toBe("menu");
    expect(content.className).toContain("backdrop-blur-2xl");
    expect(content.className).toContain("min-w-[11rem]");
    const items = document.querySelectorAll('[data-slot="dropdown-menu-item"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("role")).toBe("menuitem");
    expect(items[1].getAttribute("data-variant")).toBe("destructive");
    expect(getSlot("dropdown-menu-label").textContent).toBe("Worktree");
    expect(getSlot("dropdown-menu-trigger").getAttribute("aria-haspopup")).toBe("menu");
  });

  it("navigates items with the arrow keys", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    // Enter opens the (modal) menu from the trigger; Radix focuses and
    // highlights the first item on open.
    fireEvent.keyDown(getSlot("dropdown-menu-trigger"), { key: "Enter" });
    await flushDeferredFocus();
    expect(getSlot("dropdown-menu-content")).toBeTruthy();

    const item = (index: number) =>
      document.querySelectorAll('[data-slot="dropdown-menu-item"]')[index] as HTMLElement;
    expect(item(0).getAttribute("data-highlighted")).toBe("");

    // ArrowDown moves the highlight to the next item.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    await flushDeferredFocus();
    expect(item(0).hasAttribute("data-highlighted")).toBe(false);
    expect(item(1).getAttribute("data-highlighted")).toBe("");
  });
});
