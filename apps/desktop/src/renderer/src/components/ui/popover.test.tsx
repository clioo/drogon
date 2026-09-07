// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon popover port
// (src/renderer/src/components/ui/popover.tsx).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { getSlot, installRadixJsdomStubs } from "./radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("Popover", () => {
  it("toggles from the trigger and renders portaled content with the source recipe", () => {
    const screen = render(
      <Popover>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>
          <span>Popover body</span>
        </PopoverContent>
      </Popover>,
    );

    const trigger = getSlot("popover-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const content = getSlot("popover-content");
    expect(content.className).toContain("rounded-md");
    expect(content.className).toContain("backdrop-blur-2xl");
    expect(content.textContent).toContain("Popover body");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    screen.unmount();
  });
});
