// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Render tests for the orca-drogon collapsible port
// (src/renderer/src/components/ui/collapsible.tsx).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";
import { getSlot } from "./radix-jsdom-stubs";

afterEach(cleanup);

describe("Collapsible", () => {
  it("renders the source data-slots and toggles content visibility", () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Details</CollapsibleContent>
      </Collapsible>,
    );

    expect(getSlot("collapsible")).toBeTruthy();
    const trigger = getSlot("collapsible-trigger");
    expect(trigger.getAttribute("data-state")).toBe("closed");
    const content = getSlot("collapsible-content");
    expect(content.getAttribute("hidden")).not.toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("data-state")).toBe("open");
    expect(content.getAttribute("hidden")).toBeNull();
    expect(content.textContent).toBe("Details");
  });
});
