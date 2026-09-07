// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon toggle-group port
// (src/renderer/src/components/ui/toggle-group.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("ToggleGroup", () => {
  it("renders single-selection items with the source data attributes", () => {
    render(
      <ToggleGroup type="single" defaultValue="dark" variant="outline" size="sm" aria-label="Theme">
        <ToggleGroupItem value="light">Light</ToggleGroupItem>
        <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
      </ToggleGroup>,
    );

    const group = getSlot("toggle-group");
    expect(group.getAttribute("data-variant")).toBe("outline");
    expect(group.getAttribute("data-size")).toBe("sm");
    expect(group.getAttribute("data-spacing")).toBe("0");
    const items = document.querySelectorAll('[data-slot="toggle-group-item"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("data-variant")).toBe("outline");
    expect(items[0].getAttribute("data-size")).toBe("sm");
    expect(items[0].getAttribute("data-state")).toBe("off");
    expect(items[1].getAttribute("data-state")).toBe("on");

    fireEvent.click(items[0]);
    expect(items[0].getAttribute("data-state")).toBe("on");
    expect(items[1].getAttribute("data-state")).toBe("off");
  });
});
