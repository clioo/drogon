// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon tooltip port, including the required
// keyboard check: focusing the trigger shows the tooltip.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { getSlot, installRadixJsdomStubs } from "./radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("Tooltip", () => {
  it("focus on the trigger shows the tooltip content", async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Settings</TooltipTrigger>
          <TooltipContent>Open settings</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    // Tooltip.Root is context-only (no DOM node); the trigger carries the
    // state assertions.
    const trigger = getSlot("tooltip-trigger");
    expect(trigger.getAttribute("data-state")).toBe("closed");

    fireEvent.focus(trigger);
    await waitFor(() => {
      // Radix marks zero-delay opens as "instant-open".
      expect(trigger.getAttribute("data-state")).toBe("instant-open");
    });

    const content = getSlot("tooltip-content");
    expect(content.getAttribute("role")).toBe("tooltip");
    expect(content.textContent).toContain("Open settings");
    expect(trigger.getAttribute("aria-describedby")).toBeTruthy();
  });
});
