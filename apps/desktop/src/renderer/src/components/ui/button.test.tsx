// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon button port
// (src/renderer/src/components/ui/button.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Button, buttonVariants } from "./button";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Button", () => {
  it("renders the source data attributes and default recipe", () => {
    const screen = render(<Button>Run</Button>);
    const el = getSlot("button");
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("data-variant")).toBe("default");
    expect(el.getAttribute("data-size")).toBe("default");
    expect(el.className).toContain("bg-primary");
    expect(el.className).toContain("text-primary-foreground");
    expect(el.textContent).toBe("Run");
  });

  it("applies outline/ghost variants and non-default sizes", () => {
    render(
      <>
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close">
          x
        </Button>
      </>,
    );
    const outline = buttonVariants({ variant: "outline", size: "sm" });
    expect(outline).toContain("border-border");
    expect(outline).toContain("h-8");
    const ghostIcon = buttonVariants({ variant: "ghost", size: "icon" });
    expect(ghostIcon).toContain("hover:bg-accent");
    expect(ghostIcon).toContain("size-9");
  });

  it("keeps Drogon's existing asChild export working", () => {
    const screen = render(
      <Button asChild>
        <a href="#run">Run</a>
      </Button>,
    );
    const el = getSlot("button");
    expect(el.tagName).toBe("A");
  });
});
