// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon badge port
// (src/renderer/src/components/ui/badge.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

import { Badge } from "./badge";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Badge", () => {
  it("renders a span with data-slot and the default variant recipe", () => {
    const screen = render(<Badge>Stale</Badge>);
    const el = getSlot("badge");
    expect(el.tagName).toBe("SPAN");
    expect(el.getAttribute("data-variant")).toBe("default");
    expect(el.className).toContain("rounded-full");
    expect(el.className).toContain("bg-primary");
    expect(el.className).toContain("text-primary-foreground");
    expect(el.textContent).toBe("Stale");
  });

  it("applies non-default variant classes", () => {
    const screen = render(<Badge variant="outline">3</Badge>);
    const el = getSlot("badge");
    expect(el.getAttribute("data-variant")).toBe("outline");
    expect(el.className).toContain("border-border");
    expect(el.className).toContain("text-foreground");
  });

  it("renders asChild through the Radix Slot", () => {
    const screen = render(
      <Badge asChild>
        <a href="#pip">pip</a>
      </Badge>,
    );
    const el = getSlot("badge");
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("#pip");
  });
});
