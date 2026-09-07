// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon sheet port
// (src/renderer/src/components/ui/sheet.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Sheet", () => {
  it("renders a right-side dialog with the source side recipe and close button", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Run history</SheetTitle>
            <SheetDescription>Recent executions</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    );

    const content = getSlot("sheet-content");
    expect(content.getAttribute("role")).toBe("dialog");
    expect(content.getAttribute("data-state")).toBe("open");
    // side="right" variant from sheetContentVariants.
    expect(content.className).toContain("inset-y-0");
    expect(content.className).toContain("right-0");
    expect(content.className).toContain("slide-in-from-right");
    expect(getSlot("sheet-title").textContent).toBe("Run history");
    expect(getSlot("sheet-description").className).toContain("text-muted-foreground");
    expect(getSlot("sheet-close").textContent).toContain("Close");
  });

  it("applies the left side recipe", () => {
    render(
      <Sheet open>
        <SheetContent side="left">
          <SheetTitle>Panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const content = getSlot("sheet-content");
    expect(content.className).toContain("left-0");
    expect(content.className).toContain("slide-in-from-left");
  });
});
