// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon dialog port, including the required
// keyboard check: Escape closes the dialog.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

function mount(onOpenChange?: (open: boolean) => void) {
  return render(
    <Dialog open onOpenChange={onOpenChange}>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>Remove worktree</DialogTitle>
        <DialogDescription>This cannot be undone.</DialogDescription>
        <DialogFooter>footer</DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("renders the source slots, ARIA roles and translucent surface recipe", () => {
    mount();

    const content = getSlot("dialog-content");
    expect(content.getAttribute("role")).toBe("dialog");
    expect(content.getAttribute("data-state")).toBe("open");
    expect(content.className).toContain("bg-background/96");
    expect(content.className).toContain("backdrop-blur-2xl");
    expect(getSlot("dialog-title").textContent).toBe("Remove worktree");
    expect(getSlot("dialog-description").className).toContain("text-muted-foreground");
    expect(getSlot("dialog-footer")).toBeTruthy();
    // Built-in close affordance from the source.
    expect(getSlot("dialog-close").textContent).toContain("Close");
  });

  it("Escape closes the dialog", () => {
    const onOpenChange = vi.fn();
    mount(onOpenChange);

    fireEvent.keyDown(getSlot("dialog-content"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
