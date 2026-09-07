// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon toggle port
// (src/renderer/src/components/ui/toggle.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { Toggle, toggleVariants } from "./toggle";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Toggle", () => {
  it("renders an unpressed toggle and toggles on click", () => {
    render(<Toggle aria-label="Bold">B</Toggle>);
    const el = getSlot("toggle");
    expect(el.getAttribute("aria-pressed")).toBe("false");
    expect(el.className).toContain("hover:bg-muted");
    expect(el.textContent).toBe("B");

    fireEvent.click(el);
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.getAttribute("data-state")).toBe("on");
  });

  it("applies the outline variant and sm size recipes", () => {
    const outlineSm = toggleVariants({ variant: "outline", size: "sm" });
    expect(outlineSm).toContain("border-input");
    expect(outlineSm).toContain("h-8");
    render(
      <Toggle variant="outline" size="sm" aria-label="Italic">
        I
      </Toggle>,
    );
    expect(getSlot("toggle").className).toContain("border-input");
  });
});
