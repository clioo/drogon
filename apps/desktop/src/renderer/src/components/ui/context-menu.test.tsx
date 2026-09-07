// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon context-menu port
// (src/renderer/src/components/ui/context-menu.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu";
import { getSlot, installRadixJsdomStubs } from "./radix-jsdom-stubs";
import { beforeEach } from "vitest";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("ContextMenu", () => {
  it("opens on contextmenu with the source menu roles and destructive variant", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Row</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Actions</ContextMenuLabel>
          <ContextMenuItem>Rename</ContextMenuItem>
          <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
          <ContextMenuSeparator />
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(getSlot("context-menu-trigger"));

    const content = getSlot("context-menu-content");
    expect(content.getAttribute("role")).toBe("menu");
    expect(content.className).toContain("rounded-[11px]");
    const items = document.querySelectorAll('[data-slot="context-menu-item"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("role")).toBe("menuitem");
    expect(items[1].getAttribute("data-variant")).toBe("destructive");
    expect(items[1].className).toContain("data-[variant=destructive]:text-destructive");
    expect(getSlot("context-menu-label").textContent).toBe("Actions");
    expect(getSlot("context-menu-separator")).toBeTruthy();
  });
});
